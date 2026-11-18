import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadProjectState, updateProjectState } from './state.js';
import { scopedFile, sha256 } from './reviews.js';
import { verifyEditorBlend } from './editor.js';
import { exclusiveProjectOperation } from './operations.js';
import { validatePng } from '../providers/image-router.js';
import { extractStageResult, probeBlenderPluginLink } from '../blender/bridge.js';
import { executeCompanionStage, collectCompanionJob, cancelCompanionJob, callerHeaders } from '../blender/transport.js';

export const RENDER_PRESETS = Object.freeze({
  wine_stage: { zh:'酒红舞台 · 冷色轮廓', en:'Wine stage · cool rim', backdrop:[.16,.015,.041], keyColor:[1,.87,.79], fillColor:[.53,.69,1], rimColor:[.62,.87,1], floor:true, toon:true },
  cool_room: { zh:'冷调室内 · 柔主光', en:'Cool room · soft key', backdrop:[.046,.069,.1], keyColor:[1,.94,.85], fillColor:[.53,.72,1], rimColor:[.9,.93,1], floor:true, toon:false },
  neutral_check: { zh:'中性验收 · 保留原材质', en:'Neutral QC · original shaders', backdrop:[.12,.125,.139], keyColor:[1,1,1], fillColor:[1,1,1], rimColor:[1,1,1], floor:true, toon:false },
});
export const RENDER_CAMERAS = Object.freeze(['front','three_quarter','profile','back']);
export const RENDER_FRAMES = Object.freeze(['full','portrait']);
export const RENDER_SIZES = Object.freeze({ draft:[640,800], review:[960,1200], wide:[1280,720] });
const maxRequests = 80;
const text = (v,n) => typeof v==='string' && v.trim().length>0 && v.length<=n;
const conflict = message => Object.assign(new Error(message),{statusCode:409});

export function validateRenderRecipe(recipe) {
  if (!recipe || typeof recipe!=='object' || Array.isArray(recipe) || Object.keys(recipe).some(k=>!['preset','camera','framing','size','exposure','key','fill','rim','toon'].includes(k))) throw new Error('Use the bounded render recipe, not Python or arbitrary Blender paths');
  const {preset='neutral_check',camera='three_quarter',framing='full',size='draft',exposure=0,key=1,fill=.8,rim=1,toon=undefined}=recipe;
  if (!Object.hasOwn(RENDER_PRESETS,preset) || !RENDER_CAMERAS.includes(camera) || !RENDER_FRAMES.includes(framing) || !Object.hasOwn(RENDER_SIZES,size) || (toon!==undefined && typeof toon!=='boolean')) throw new Error('Unknown rendering preset, camera, framing, size or toon flag');
  for (const [value,min,max] of [[exposure,-1.5,1.5],[key,.35,1.8],[fill,.15,1.6],[rim,0,1.8]]) if (!Number.isFinite(value) || value<min || value>max) throw new Error('Render exposure or lighting is out of range');
  return {preset,camera,framing,size,exposure,key,fill,rim,toon:toon??RENDER_PRESETS[preset].toon};
}
function find(state,id) {
  if (typeof id!=='string' || !/^render_[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid render request ID');
  const found=state?.rendering?.requests?.find(r=>r.id===id);
  if (!found) throw new Error('Render request not found in this project');
  return found;
}
function baseRevision(state,r,expected) {
  const active=state.editor?.activeRevisionId;
  if (!expected || expected!==active || (r && r.revisionId!==active)) throw conflict('Active Blender revision changed; create a new render request');
  if (state.editor?.pendingJob) throw conflict('Collect the current Blender edit before rendering');
  return active;
}
function handoff(projectDir, request) {
  const args={action:'run',projectDir:path.resolve(projectDir),requestId:request.id,expectedRevisionId:request.revisionId};
  return {request,instruction:[
    '请在此 DSH 会话完成本机 Blender 渲染。使用 charakuru_render 的 status 查看记录，再按下方用户要求调整 recipe。只调用受限工具，不执行任意脚本，不上传、不修改或批准模型。',
    '用 run 提交一张 PNG，原始基线不改。若返回 queued，用同一 DSH 会话的 collect；若未确认结果，勿自动重发。给出实际输出和限制，回渲染台由用户审阅。',
    '字段：preset=wine_stage/cool_room/neutral_check；camera=front/three_quarter/profile/back；framing=full/portrait；size=draft/review/wide；exposure=-1.5…1.5；key=.35…1.8；fill=.15…1.6；rim=0…1.8；toon=true/false（仅兼容的无透明材质转为明暗阶）。未明确的保持原建议。',
    JSON.stringify({...args,recipe:request.suggestion}),
    '本次渲染要求：',request.brief,
  ].join('\n')};
}
export async function createRenderRequest({projectDir,brief,recipe={},expectedRevisionId}={}) {
  if (!text(brief,4000)) throw new Error('Describe the requested render (1–4000 characters)');
  const suggestion=validateRenderRecipe(recipe);
  let request;
  await updateProjectState(projectDir,async state=>{
    const revisionId=baseRevision(state,null,expectedRevisionId);
    const source=await verifyEditorBlend(projectDir,state,revisionId);
    state.rendering ||= {requests:[]};
    if (state.rendering.requests.length>=maxRequests) throw new Error('Render history limit reached; archive the project before creating more renders');
    request={id:'render_'+crypto.randomUUID(),revisionId,blendHash:source.sha256,brief:brief.trim(),suggestion,status:'requested',createdAt:new Date().toISOString()};
    state.rendering.requests.push(request);
    state.auditLog.push({at:request.createdAt,event:'render.request',detail:request.id});
  });
  return handoff(projectDir,request);
}
export async function getRenderRequest({projectDir,requestId,forHandoff=false}={}) {
  const {state}=await loadProjectState(projectDir),r=find(state,requestId);
  if (forHandoff) {
    if (r.status!=='requested') throw conflict('Create a new request to render again');
    await requireBase(projectDir,state,r,r.revisionId);
    return handoff(projectDir,r);
  }
  const {job,...request}=r;
  return {request,jobId:job?.jobId,stale:state.editor?.activeRevisionId!==r.revisionId};
}
async function requireBase(projectDir,state,r,expected) {
  const source=await verifyEditorBlend(projectDir,state,baseRevision(state,r,expected));
  if (source.sha256!==r.blendHash) throw conflict('Source Blend fingerprint changed; request not used');
  return source;
}
async function renderFolder(root,id) {
  const dir=path.join(root,'blender','renders',id);
  await fs.mkdir(dir,{recursive:true});
  const actual=await fs.realpath(dir);
  if (path.relative(await fs.realpath(root),actual)!==path.join('blender','renders',id)) throw new Error('Render directory must be local to the project');
  return dir;
}
async function readBound(projectDir,rel,limit) {
  const file=await scopedFile(projectDir,rel);
  const stat=await fs.stat(file);
  if (!stat.isFile() || stat.size<1 || stat.size>limit) throw new Error('Invalid render artifact size');
  return fs.readFile(file);
}
const artifactPath = (id,file) => ['blender','renders',id,file].join('/');

async function finalize(projectDir,r,receipt) {
  const summary=await extractStageResult(receipt);
  if (receipt?.ok===false || receipt?.exitCode!==0 || summary?.verdict!=='pass' || summary.requestId!==r.id) throw new Error(summary?.error || 'Companion did not confirm the requested render');
  const pngPath=artifactPath(r.id,'render.png'),reportPath=artifactPath(r.id,'report.json');
  const png=validatePng(await readBound(projectDir,pngPath,20*1024*1024));
  const reportBytes=await readBound(projectDir,reportPath,128*1024);
  const report=JSON.parse(reportBytes.toString('utf8'));
  const [width,height]=RENDER_SIZES[r.recipe.size];
  if (report.requestId!==r.id || report.revisionId!==r.revisionId || report.blendHash!==r.blendHash || JSON.stringify(report.recipe)!==JSON.stringify(r.recipe) || png.readUInt32BE(16)!==width || png.readUInt32BE(20)!==height || typeof report.blenderVersion!=='string') throw new Error('Render report, request and PNG dimensions do not agree');
  let result;
  await updateProjectState(projectDir,async state=>{
    const row=find(state,r.id);
    if (!['rendering','queued'].includes(row.status)) throw conflict('Render request changed');
    await requireBase(projectDir,state,row,row.revisionId);
    row.status='ready_for_review';
    row.finishedAt=new Date().toISOString();
    delete row.job;
    row.artifacts={png:{filePath:pngPath,sha256:sha256(png),bytes:png.length,width,height},report:{filePath:reportPath,sha256:sha256(reportBytes),bytes:reportBytes.length}};
    row.summary={blenderVersion:report.blenderVersion,engine:report.engine,meshes:report.meshes,toonMaterials:report.toonMaterials,notes:report.notes};
    state.auditLog.push({at:row.finishedAt,event:'render.ready_for_review',detail:r.id});
    result=row;
  });
  return {verdict:'pass',scope:'render_artifact_only',request:result};
}
async function fail(projectDir,id,error) {
  await updateProjectState(projectDir,state=>{
    const row=find(state,id);
    if (!['rendering','queued'].includes(row.status)) return;
    row.status='failed';
    row.finishedAt=new Date().toISOString();
    row.error=String(error?.message||error).slice(0,600);
    delete row.job;
    state.auditLog.push({at:row.finishedAt,event:'render.failed',detail:id});
  });
}
export async function runRender({projectDir,requestId,expectedRevisionId,recipe={},actor='agent',blenderPluginUrl='',caller=null,fetchImpl=fetch,signal}={}) {
  return exclusiveProjectOperation(projectDir,async()=>{
    const loaded=await loadProjectState(projectDir),root=loaded.projectDir,r=find(loaded.state,requestId);
    if (r.status!=='requested') throw conflict('This render request was already submitted; no duplicate submission');
    const source=await requireBase(root,loaded.state,r,expectedRevisionId);
    const chosen=validateRenderRecipe({...r.suggestion,...validateOverrides(recipe)});
    const connection=await probeBlenderPluginLink({blenderPluginUrl,fetchImpl});
    if (!connection.linked) throw new Error(connection.remedyZh||'Blender Companion unavailable');
    if (connection.protocol==='gateway-3.1') {
      callerHeaders(caller);
      if (connection.health.gateway.hostId!==caller.hostId) throw new Error('Use an authorized DSH session on the matching Gateway host');
    }
    const dir=await renderFolder(root,r.id),scriptFile=path.join(dir,'render.py');
    const command={requestId:r.id,revisionId:r.revisionId,blendHash:r.blendHash,inputBlend:source.file,recipe:chosen,settings:RENDER_PRESETS[chosen.preset],pixels:RENDER_SIZES[chosen.size],output:dir};
    const code=await fs.readFile(new URL('../blender/render-studio.py',import.meta.url),'utf8');
    await fs.writeFile(scriptFile,`COMMAND = ${JSON.stringify(JSON.stringify(command))}\n${code}`,'utf8');
    await updateProjectState(root,async state=>{
      const row=find(state,r.id);
      await requireBase(root,state,row,expectedRevisionId);
      if (row.status!=='requested') throw conflict('Render request already started');
      row.recipe=chosen;
      row.executedBy=actor==='human'?'human':'agent';
      row.status='rendering';
      row.startedAt=new Date().toISOString();
      state.auditLog.push({at:row.startedAt,event:'render.submit',detail:r.id});
    });
    try {
      const receipt=await executeCompanionStage({connection,scriptFile,outdir:dir,executionTarget:'headless',caller,fetchImpl,signal});
      if (receipt.jobId) {
        await updateProjectState(root,state=>{
          const row=find(state,r.id);
          row.status='queued'; row.job={jobId:receipt.jobId,protocol:connection.protocol,baseUrl:connection.baseUrl,caller};
        });
        return {verdict:'degraded',status:'queued',requestId:r.id,jobId:receipt.jobId};
      }
      return await finalize(root,{...r,recipe:chosen},receipt);
    } catch (error) { await fail(root,r.id,error); throw error; }
  });
}
function validateOverrides(value) {
  // Keep missing keys missing so a partial override inherits the stored settings.
  validateRenderRecipe(value);
  if (Object.hasOwn(value,'preset') && !Object.hasOwn(value,'toon')) return {...value,toon:RENDER_PRESETS[value.preset].toon};
  return value;
}
export async function settleRender({projectDir,requestId,cancel=false,caller=null,fetchImpl=fetch,signal}={}) {
  return exclusiveProjectOperation(projectDir,async()=>{
    const {projectDir:root,state}=await loadProjectState(projectDir),r=find(state,requestId);
    if (r.status!=='queued' || !r.job) throw conflict('No queued render job to collect');
    if (cancel) { await cancelCompanionJob(r.job,{caller,fetchImpl,signal}); return {status:'cancel_requested',requestId:r.id}; }
    const result=await collectCompanionJob(r.job,{caller,fetchImpl,signal});
    if (result.pending) return {verdict:'degraded',status:'queued',requestId:r.id,jobId:r.job.jobId};
    try { if (result.failed) throw new Error(result.receipt.error); return await finalize(root,r,result.receipt); }
    catch (error) { await fail(root,r.id,error); throw error; }
  });
}
export async function reviewRender({projectDir,requestId,expectedRevisionId,decision,note=''}={}) {
  if (!['approve','reject'].includes(decision) || typeof note!=='string' || note.length>1000) throw new Error('Choose a render review decision and a note up to 1000 characters');
  let request;
  await updateProjectState(projectDir,async state=>{
    request=find(state,requestId);
    if (request.status!=='ready_for_review') throw conflict('The render is not awaiting human review');
    await requireBase(projectDir,state,request,expectedRevisionId);
    await Promise.all(['png','report'].map(k=>verifiedArtifact(projectDir,request,k)));
    request.status=decision==='approve'?'approved':'rejected';
    request.review={actor:'human',note:note.trim(),at:new Date().toISOString()};
    state.auditLog.push({at:request.review.at,event:`render.${request.status}`,detail:requestId});
  });
  return {request,modelChanged:false};
}
async function verifiedArtifact(root,r,kind) {
  const record=r.artifacts?.[kind];
  if (!record || record.filePath!==artifactPath(r.id,kind==='png'?'render.png':'report.json')) throw new Error('Render artifact is unavailable');
  const bytes=await readBound(root,record.filePath,kind==='png'?20*1024*1024:128*1024);
  if (bytes.length!==record.bytes || sha256(bytes)!==record.sha256) throw conflict('Render artifact changed on disk');
  return {bytes,mime:kind==='png'?'image/png':'application/json'};
}
export async function renderContent(projectDir,id,kind='png') {
  if (!['png','report'].includes(kind)) throw new Error('Unsupported render artifact');
  return verifiedArtifact(projectDir,find((await loadProjectState(projectDir)).state,id),kind);
}
