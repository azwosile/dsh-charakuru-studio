import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadProjectState, updateProjectState } from './state.js';
import { scopedFile, sha256 } from './reviews.js';
import { verifyEditorBlend } from './editor.js';
import { exclusiveProjectOperation } from './operations.js';
import { validatePng } from '../providers/image-router.js';
import { resolveProjectMaterial } from './materials.js';
import { extractStageResult, probeBlenderPluginLink } from '../blender/bridge.js';
import { executeCompanionStage, collectCompanionJob, cancelCompanionJob, callerHeaders } from '../blender/transport.js';

export const RENDER_PRESETS = Object.freeze({
  custom: { zh:'AI 自定布光', en:'Agent-composed lighting', backdrop:[.12,.125,.139], keyColor:[1,1,1], fillColor:[1,1,1], rimColor:[1,1,1], floor:true, toon:false },
  wine_stage: { zh:'酒红舞台 · 冷色轮廓', en:'Wine stage · cool rim', backdrop:[.16,.015,.041], keyColor:[1,.87,.79], fillColor:[.53,.69,1], rimColor:[.62,.87,1], floor:true, toon:true },
  cool_room: { zh:'冷调室内 · 柔主光', en:'Cool room · soft key', backdrop:[.046,.069,.1], keyColor:[1,.94,.85], fillColor:[.53,.72,1], rimColor:[.9,.93,1], floor:true, toon:false },
  neutral_check: { zh:'中性验收 · 保留原材质', en:'Neutral QC · original shaders', backdrop:[.12,.125,.139], keyColor:[1,1,1], fillColor:[1,1,1], rimColor:[1,1,1], floor:true, toon:false },
});
export const RENDER_CAMERAS = Object.freeze(['front','three_quarter','profile','back']);
export const RENDER_FRAMES = Object.freeze(['full','portrait']);
export const RENDER_SIZES = Object.freeze({
  draft: [640, 800],
  review: [960, 1200],
  wide: [1280, 720],
  hd1080: [1920, 1080],
  portrait1080: [1080, 1920],
  uhd4k: [3840, 2160],
  portrait4k: [2160, 3840],
});
const MAX_RENDER_PNG_BYTES = 64 * 1024 * 1024;
const RENDER_RECIPE_KEYS = new Set([
  'preset', 'camera', 'framing', 'size', 'exposure', 'key', 'fill', 'rim', 'toon', 'lighting',
  'engine', 'lensType', 'lens', 'dof', 'yawDeg', 'pitchDeg', 'transparent', 'samples', 'frame',
  'viewTransform', 'look', 'toonOptions', 'passes',
]);
const RENDER_ENGINES = new Set(['eevee', 'cycles']);
const RENDER_LENS_TYPES = new Set(['ortho', 'persp']);
const RENDER_VIEW_TRANSFORMS = new Set(['Standard', 'AgX', 'Filmic']);
const RENDER_LOOKS = new Set(['None', 'Medium High Contrast', 'High Contrast', 'Medium Contrast']);
const RENDER_PASSES = new Set(['albedo', 'normal', 'depth']);
const MATERIAL_ID_PATTERN = /^material_[a-f0-9-]{36}$/;
const maxRequests = 80;
const text = (v,n) => typeof v==='string' && v.trim().length>0 && v.length<=n;
const conflict = message => Object.assign(new Error(message),{statusCode:409});

export function validateRenderRecipe(recipe) {
  if (!recipe || typeof recipe!=='object' || Array.isArray(recipe) || Object.keys(recipe).some(k=>!RENDER_RECIPE_KEYS.has(k))) throw new Error('Use the bounded render recipe, not Python or arbitrary Blender paths');
  const {
    preset='neutral_check', camera='three_quarter', framing='full', size='draft',
    exposure=0, key=1, fill=.8, rim=1, toon=undefined, lighting,
    engine, lensType, lens, dof, yawDeg, pitchDeg, transparent, samples, frame,
    viewTransform, look, toonOptions, passes,
  } = recipe;
  if (!Object.hasOwn(RENDER_PRESETS,preset) || !RENDER_CAMERAS.includes(camera) || !RENDER_FRAMES.includes(framing) || !Object.hasOwn(RENDER_SIZES,size) || (toon!==undefined && typeof toon!=='boolean')) throw new Error('Unknown rendering preset, camera, framing, size or toon flag');
  for (const [value,min,max] of [[exposure,-1.5,1.5],[key,.35,1.8],[fill,.15,1.6],[rim,0,1.8]]) if (!Number.isFinite(value) || value<min || value>max) throw new Error('Render exposure or lighting is out of range');
  if (lighting!==undefined) {
    if (!lighting || typeof lighting!=='object'||Array.isArray(lighting)||Object.keys(lighting).some(k=>!['backdrop','keyColor','fillColor','rimColor','floor'].includes(k))) throw new Error('Use bounded lighting colors, not shaders or file paths');
    for (const [k,v] of Object.entries(lighting)) if(k==='floor'?typeof v!=='boolean':!Array.isArray(v)||v.length!==3||v.some(n=>!Number.isFinite(n)||n<0||n>1))throw new Error('Lighting colors use three numbers from 0 to 1');
  }
  if (engine !== undefined && (typeof engine !== 'string' || !RENDER_ENGINES.has(engine))) throw new Error('Render engine must be eevee or cycles');
  if (lensType !== undefined && (typeof lensType !== 'string' || !RENDER_LENS_TYPES.has(lensType))) throw new Error('Render lensType must be ortho or persp');
  if (lens !== undefined && (!Number.isFinite(lens) || lens < 18 || lens > 200)) throw new Error('Render lens focal length must be between 18 and 200');
  if (dof !== undefined) {
    if (!dof || typeof dof !== 'object' || Array.isArray(dof) || Object.keys(dof).some(k => !['enabled', 'fstop', 'focusDistance'].includes(k))) throw new Error('Use bounded depth-of-field settings (enabled, fstop, focusDistance)');
    if (dof.enabled !== undefined && typeof dof.enabled !== 'boolean') throw new Error('dof.enabled must be a boolean');
    if (dof.fstop !== undefined && (!Number.isFinite(dof.fstop) || dof.fstop < 0.7 || dof.fstop > 22)) throw new Error('dof.fstop must be between 0.7 and 22');
    if (dof.focusDistance !== undefined && (!Number.isFinite(dof.focusDistance) || dof.focusDistance < 0.1 || dof.focusDistance > 50)) throw new Error('dof.focusDistance must be between 0.1 and 50');
  }
  if (yawDeg !== undefined && (!Number.isFinite(yawDeg) || yawDeg < -180 || yawDeg > 180)) throw new Error('Render yawDeg must be between -180 and 180');
  if (pitchDeg !== undefined && (!Number.isFinite(pitchDeg) || pitchDeg < -60 || pitchDeg > 60)) throw new Error('Render pitchDeg must be between -60 and 60');
  if (transparent !== undefined && typeof transparent !== 'boolean') throw new Error('Render transparent flag must be a boolean');
  if (samples !== undefined && (!Number.isInteger(samples) || samples < 4 || samples > 256)) throw new Error('Render samples must be an integer between 4 and 256');
  if (frame !== undefined && (!Number.isInteger(frame) || frame < 0 || frame > 100000)) throw new Error('Render frame must be an integer between 0 and 100000');
  if (viewTransform !== undefined && (typeof viewTransform !== 'string' || !RENDER_VIEW_TRANSFORMS.has(viewTransform))) throw new Error('Render viewTransform must be Standard, AgX or Filmic');
  if (look !== undefined && (typeof look !== 'string' || !RENDER_LOOKS.has(look))) throw new Error('Unsupported color look');
  if (toonOptions !== undefined) {
    if (!toonOptions || typeof toonOptions !== 'object' || Array.isArray(toonOptions) || Object.keys(toonOptions).some(k => !['outline', 'outlineThickness', 'outlineColor', 'faceSdf', 'faceSdfMaterialId', 'specularRim', 'metallicStep'].includes(k))) throw new Error('Use bounded toonOptions without shader scripts or file paths');
    for (const flag of ['outline', 'faceSdf', 'specularRim', 'metallicStep']) {
      if (toonOptions[flag] !== undefined && typeof toonOptions[flag] !== 'boolean') throw new Error(`toonOptions.${flag} must be a boolean`);
    }
    if (toonOptions.outlineThickness !== undefined && (!Number.isFinite(toonOptions.outlineThickness) || toonOptions.outlineThickness < 0.0005 || toonOptions.outlineThickness > 0.005)) throw new Error('toonOptions.outlineThickness must be between 0.0005 and 0.005');
    if (toonOptions.outlineColor !== undefined && (!Array.isArray(toonOptions.outlineColor) || toonOptions.outlineColor.length !== 3 || toonOptions.outlineColor.some(n => !Number.isFinite(n) || n < 0 || n > 1))) throw new Error('toonOptions.outlineColor must be three numbers from 0 to 1');
    if (toonOptions.faceSdfMaterialId !== undefined && (typeof toonOptions.faceSdfMaterialId !== 'string' || !MATERIAL_ID_PATTERN.test(toonOptions.faceSdfMaterialId))) throw new Error('toonOptions.faceSdfMaterialId must be a registered material ID');
  }
  if (passes !== undefined && (!Array.isArray(passes) || passes.length > 3 || new Set(passes).size !== passes.length || passes.some(p => typeof p !== 'string' || !RENDER_PASSES.has(p)))) {
    throw new Error('Render passes must contain up to 3 unique values from albedo, normal, depth');
  }
  return {
    preset, camera, framing, size, exposure, key, fill, rim,
    toon: toon ?? RENDER_PRESETS[preset].toon,
    ...(lighting !== undefined ? { lighting: structuredClone(lighting) } : {}),
    ...(engine !== undefined ? { engine } : {}),
    ...(lensType !== undefined ? { lensType } : {}),
    ...(lens !== undefined ? { lens } : {}),
    ...(dof !== undefined ? { dof: structuredClone(dof) } : {}),
    ...(yawDeg !== undefined ? { yawDeg } : {}),
    ...(pitchDeg !== undefined ? { pitchDeg } : {}),
    ...(transparent !== undefined ? { transparent } : {}),
    ...(samples !== undefined ? { samples } : {}),
    ...(frame !== undefined ? { frame } : {}),
    ...(viewTransform !== undefined ? { viewTransform } : {}),
    ...(look !== undefined ? { look } : {}),
    ...(toonOptions !== undefined ? { toonOptions: structuredClone(toonOptions) } : {}),
    ...(passes !== undefined ? { passes: structuredClone(passes) } : {}),
  };
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
    '由你按人物、构图和用户要求决定光照与镜头，不把参考方案作为默认或硬要求。明确提供 preset（可为 custom）、camera=front/three_quarter/profile/back、framing=full/portrait、size=draft/review/wide/hd1080/portrait1080/uhd4k/portrait4k。可选 engine=eevee/cycles、lensType=ortho/persp、lens=18…200、dof={enabled,fstop,focusDistance}、yawDeg=-180…180、pitchDeg=-60…60、transparent、samples=4…256、frame=0…100000、viewTransform=Standard/AgX/Filmic、look、toonOptions={outline,outlineThickness,outlineColor,faceSdf,faceSdfMaterialId,specularRim,metallicStep}、passes=[albedo,normal,depth]。可在 lighting 中写 backdrop、keyColor、fillColor、rimColor（0 到 1 RGB 三值）和 floor (布尔)，以及 exposure=-1.5…1.5、key=.35…1.8、fill=.15…1.6、rim=0…1.8、toon=true/false。研究例 wine_stage/cool_room/neutral_check 可参考，不必使用。',
    JSON.stringify(args),
    '本次渲染要求：',request.brief,
  ].join('\n')};
}
export async function createRenderRequest({projectDir,brief,recipe,expectedRevisionId,agentOnly=false}={}) {
  if (!text(brief,4000)) throw new Error('Describe the requested render (1–4000 characters)');
  if(agentOnly&&recipe!==undefined)throw new Error('AI render requests do not pin a user-side recipe');
  const suggestion=agentOnly?null:validateRenderRecipe(recipe||{});
  let request;
  await updateProjectState(projectDir,async state=>{
    const revisionId=baseRevision(state,null,expectedRevisionId);
    const source=await verifyEditorBlend(projectDir,state,revisionId);
    state.rendering ||= {requests:[]};
    if (state.rendering.requests.length>=maxRequests) throw new Error('Render history limit reached; archive the project before creating more renders');
    request={id:'render_'+crypto.randomUUID(),revisionId,blendHash:source.sha256,brief:brief.trim(),suggestion,...(agentOnly?{policy:'agent_recipe'}:{}),status:'requested',createdAt:new Date().toISOString()};
    state.rendering.requests.push(request);
    state.auditLog.push({at:request.createdAt,event:'render.request',detail:request.id});
  });
  return handoff(projectDir,request);
}
export async function listRenderRequests({ projectDir } = {}) {
  const loaded = await loadProjectState(projectDir);
  return {
    projectDir: loaded.projectDir,
    activeRevisionId: loaded.state?.editor?.activeRevisionId || null,
    requests: (loaded.state?.rendering?.requests || []).slice().reverse(),
  };
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
  if (receipt?.ok===false || (receipt?.exitCode!=null && receipt.exitCode!==0) || summary?.verdict!=='pass' || summary.requestId!==r.id) throw new Error(summary?.error || 'Companion did not confirm the requested render');
  const pngPath=artifactPath(r.id,'render.png'),reportPath=artifactPath(r.id,'report.json');
  const png=validatePng(await readBound(projectDir,pngPath,MAX_RENDER_PNG_BYTES));
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
    for (const key of ['viewTransform', 'look', 'lensType', 'outlineMeshes', 'faceSdfMaterials', 'preservedMtoon', 'auxiliaryPasses']) {
      if (report[key] !== undefined) row.summary[key] = report[key];
    }
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
export async function runRender({projectDir,requestId,expectedRevisionId,recipe={},actor='agent',blenderPluginUrl='',executionTarget='headless',sessionId='',caller=null,fetchImpl=fetch,signal}={}) {
  return exclusiveProjectOperation(projectDir,async()=>{
    if (!['headless', 'gui_act'].includes(executionTarget)) throw new Error('Invalid Blender execution target');
    const loaded=await loadProjectState(projectDir),root=loaded.projectDir,r=find(loaded.state,requestId);
    if (r.status!=='requested') throw conflict('This render request was already submitted; no duplicate submission');
    const source=await requireBase(root,loaded.state,r,expectedRevisionId);
    if(r.policy==='agent_recipe'&&(actor!=='agent'||!recipe||!['preset','camera','framing','size'].every(k=>Object.hasOwn(recipe,k)))) throw new Error('The DSH agent must choose the palette, camera, framing and size for this request');
    const chosen=validateRenderRecipe({...r.suggestion,...validateOverrides(recipe)});
    let faceSdfPath;
    if (chosen.toonOptions?.faceSdfMaterialId) {
      const resolved=await resolveProjectMaterial(root,chosen.toonOptions.faceSdfMaterialId);
      if (resolved.record.extension?.toLowerCase()!=='.png') throw new Error('Face SDF material must be a PNG texture');
      faceSdfPath=resolved.file;
    }
    const connection=await probeBlenderPluginLink({blenderPluginUrl,fetchImpl});
    if (!connection.linked) throw new Error(connection.remedyZh||'Blender Companion unavailable');
    if (connection.protocol==='gateway-3.1') {
      callerHeaders(caller);
      if (connection.health.gateway.hostId!==caller.hostId) throw new Error('Use an authorized DSH session on the matching Gateway host');
    }
    const dir=await renderFolder(root,r.id),scriptFile=path.join(dir,'render.py');
    const command={requestId:r.id,revisionId:r.revisionId,blendHash:r.blendHash,inputBlend:source.file,recipe:chosen,...(faceSdfPath?{faceSdfPath}:{}),settings:{...RENDER_PRESETS[chosen.preset],...chosen.lighting},pixels:RENDER_SIZES[chosen.size],output:dir};
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
      const target=executionTarget==='gui_act'&&connection.guiReady?'gui_act':'headless';
      const receipt=await executeCompanionStage({connection,scriptFile,outdir:dir,executionTarget:target,engine:chosen.engine||'eevee',sessionId,caller,fetchImpl,signal});
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
  const bytes=await readBound(root,record.filePath,kind==='png'?MAX_RENDER_PNG_BYTES:128*1024);
  if (bytes.length!==record.bytes || sha256(bytes)!==record.sha256) throw conflict('Render artifact changed on disk');
  return {bytes,mime:kind==='png'?'image/png':'application/json'};
}
export async function renderContent(projectDir,id,kind='png') {
  if (!['png','report'].includes(kind)) throw new Error('Unsupported render artifact');
  return verifiedArtifact(projectDir,find((await loadProjectState(projectDir)).state,id),kind);
}
