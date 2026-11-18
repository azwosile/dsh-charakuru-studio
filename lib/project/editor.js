import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadProjectState, updateProjectState, initOrUpdateProject } from './state.js';
import { sha256, scopedFile } from './reviews.js';
import { exclusiveProjectOperation } from './operations.js';
import { probeBlenderPluginLink, extractStageResult } from '../blender/bridge.js';
import { executeCompanionStage, collectCompanionJob, cancelCompanionJob } from '../blender/transport.js';
import { validateGlb } from '../tripo/free-quota-scheduler.js';

export const EDITOR_OPERATIONS = ['import_blend','audit','head_scale','transform','materials','transfer_weights','normalize_weights','configure_vrm','spring_setup','pose_check','export_vrm'];
const id = () => crypto.randomUUID();
const schema = () => ({ version:1, activeRevisionId:null, revisions:[], pendingJob:null, requests:[], view:{camera:'front',overlayAssetId:null,overlayOpacity:0.35} });
function revision(state, revisionId) { const found=state.editor?.revisions.find(r=>r.id===revisionId);if(!found)throw new Error('Editor revision not found');return found; }
function checkBase(state, expectedRevisionId) {
  if(expectedRevisionId!==undefined && expectedRevisionId!==(state.editor?.activeRevisionId||null))throw new Error('Editor base revision changed; reload before editing');
  if(state.editor?.pendingJob)throw new Error('Editor job is pending; collect or cancel it before submitting another operation');
}
export function validateEditorParams(operation, params={}) {
  if(!EDITOR_OPERATIONS.includes(operation))throw new Error('Unknown editor operation');
  if(!params||typeof params!=='object'||Array.isArray(params))throw new Error('Expected editor parameters object');
  const allowed=['sourceMesh','maxTransferDistance','materialMode','objects','scale','translation','factor','armature','headBone','pivotBone','sourceBlend','vrmAddonPath','vrmAddonModule','humanBones','authors','title','commercialUsage','chains','colliderBones','stiffness','dragForce','hitRadius','gravityPower','skirt','expressions'];
  for(const key of Object.keys(params))if(!allowed.includes(key))throw new Error('Unknown editor parameter '+key);
  const numbers=(x,n,min,max)=>Array.isArray(x)&&x.length===n&&x.every(v=>Number.isFinite(v)&&v>=min&&v<=max);
  if(operation==='transfer_weights'&&(!params.objects?.length||typeof params.sourceMesh!=='string'||!Number.isFinite(params.maxTransferDistance)||params.maxTransferDistance<=0||params.maxTransferDistance>1))throw new Error('Weight transfer requires explicit source, targets and maximum distance up to one meter');
  if(params.objects && (!Array.isArray(params.objects)||params.objects.length>200||params.objects.some(n=>typeof n!=='string'||n.length>200)))throw new Error('Invalid object selection');
  if(operation==='head_scale'&&(!Number.isFinite(params.factor)||params.factor<0.75||params.factor>1.25))throw new Error('Head scale must be between 0.75 and 1.25');
  if(operation==='transform'&&(!params.objects?.length||!numbers(params.scale||[1,1,1],3,0.1,10)||!numbers(params.translation||[0,0,0],3,-10,10)))throw new Error('Transform needs explicit objects and bounded scale/translation');
  if(params.materialMode&&!['preserve','pbr'].includes(params.materialMode))throw new Error('Unknown material mode');
  if(params.chains&&(!Array.isArray(params.chains)||params.chains.length>128||params.chains.some(c=>!Array.isArray(c)||c.length<2||c.length>64||c.some(n=>typeof n!=='string'||n.length>200))))throw new Error('Invalid spring chains');
  if(params.colliderBones&&(!Array.isArray(params.colliderBones)||params.colliderBones.length>128||params.colliderBones.some(c=>!c||typeof c.bone!=='string'||!Number.isFinite(c.radius)||c.radius<=0||c.radius>0.5)))throw new Error('Invalid body colliders');
  for(const [key,maximum] of [['stiffness',10],['dragForce',1],['hitRadius',.5],['gravityPower',5]])if(params[key]!==undefined&&(!Number.isFinite(params[key])||params[key]<0||params[key]>maximum))throw new Error('Spring coefficient out of range');
  if(params.authors&&(!Array.isArray(params.authors)||!params.authors.length||params.authors.length>20||params.authors.some(a=>typeof a!=='string'||!a.trim()||a.length>200)))throw new Error('Explicit authors required');
  if(params.humanBones&&Object.entries(params.humanBones).some(([k,v])=>typeof v!=='string'||k.length>80||v.length>200))throw new Error('Invalid humanoid mapping');
  if(params.expressions && params.expressions!=='skip' && params.expressions!=='preserve')throw new Error('Expressions must be skip or preserve; automatic heuristic expressions are not production-certified');
  return structuredClone(params);
}
async function hashFile(file, limit=1024*1024*1024) {
  const stat=await fs.stat(file);if(!stat.isFile()||stat.size===0||stat.size>limit)throw new Error('Invalid artifact size');
  const handle=await fs.open(file,'r');const hash=crypto.createHash('sha256');let size=0;
  try{for await(const chunk of handle.createReadStream()){hash.update(chunk);size+=chunk.length;}}finally{await handle.close().catch(()=>{});}
  return {sha256:hash.digest('hex'),bytes:size};
}
async function verifyRecord(projectDir, record) {
  const file=await scopedFile(projectDir,record.filePath);const current=await hashFile(file);
  if(current.sha256!==record.sha256)throw new Error('Editor artifact changed on disk');return file;
}
export async function editorContent(projectDir, revisionId, kind='preview') {
  const state=(await loadProjectState(projectDir)).state,r=revision(state,revisionId),record=r.artifacts[kind];
  if(!['preview','vrm','report'].includes(kind)||!record)throw new Error('Requested revision artifact unavailable');
  const file=await verifyRecord(projectDir,record);return {bytes:await fs.readFile(file),mime:kind==='report'?'application/json':'model/gltf-binary'};
}
export async function setEditorView({projectDir,camera='front',overlayAssetId=null,overlayOpacity=0.35}={}) {
  if(!['front','back','left','right','perspective'].includes(camera)||!Number.isFinite(overlayOpacity)||overlayOpacity<0||overlayOpacity>1)throw new Error('Invalid viewport state');
  return updateProjectState(projectDir,state=>{state.editor||=schema();if(overlayAssetId&&!state.assets?.items.some(a=>a.id===overlayAssetId&&a.kind==='image'))throw new Error('Reference image not registered in this project');state.editor.view={camera,overlayAssetId,overlayOpacity};});
}
export async function rollbackEditor({projectDir,revisionId,expectedRevisionId}={}) {
  return updateProjectState(projectDir,async state=>{checkBase(state,expectedRevisionId);const target=revision(state,revisionId);await verifyRecord(projectDir,target.artifacts.blend);await verifyRecord(projectDir,target.artifacts.preview);state.editor.activeRevisionId=target.id;state.editor.lastRollback={at:new Date().toISOString(),to:target.id};state.auditLog.push({at:new Date().toISOString(),event:'editor.rollback',detail:target.id});});
}
export async function createAiEditRequest({projectDir,prompt,objects=[],camera='front',expectedRevisionId}={}) {
  if(typeof prompt!=='string'||!prompt.trim()||prompt.length>8000)throw new Error('AI edit instruction is required, max 8000 characters');
  let request;await updateProjectState(projectDir,state=>{checkBase(state,expectedRevisionId);const base=revision(state,state.editor?.activeRevisionId);const names=new Set((base.audit?.objects||[]).map(o=>o.name));if(objects.some(n=>!names.has(n)))throw new Error('AI selection contains unknown objects');request={id:id(),status:'requested',createdAt:new Date().toISOString(),baseRevisionId:base.id,blendHash:base.artifacts.blend.sha256,objects,camera,prompt};state.editor.requests.push(request);state.editor.requests=state.editor.requests.slice(-100);});
  return {request,instruction:`Use charakuru_blender_avatar action=editor_operation with projectDir=${JSON.stringify(projectDir)} and expectedRevisionId=${request.baseRevisionId}. Selected objects=${JSON.stringify(objects)}; camera=${camera}. Request: ${prompt}. Never overwrite source files or claim aesthetic approval from a script receipt.`};
}
async function finalize(projectDir,pending,receipt) {
  if(receipt.ok===false||receipt.exitCode!=null&&receipt.exitCode!==0||String(receipt.stderr||receipt.stderrTail||'').includes('Traceback')){const detail=await extractStageResult(receipt).catch(()=>null);throw new Error('Blender process failed; previous revision remains active: '+(detail?.error||receipt.error||receipt.traceback||String(receipt.stderr||receipt.stderrTail||'').slice(-800)));}
  if(pending.sourcePath&&(await hashFile(pending.sourcePath)).sha256!==pending.sourceHash)throw new Error('Input changed during execution; generated output was not activated');
  const result=await extractStageResult(receipt);
  if(!result||result.requestId!==pending.id||result.verdict!=='pass')throw new Error(result?.error||'Blender editor response does not match the submitted request');
  const artifacts={};
  for(const kind of ['blend','preview','report',...(pending.operation==='export_vrm'?['vrm']:[])]){
    const file=pending.outputs[kind];if(path.resolve(result.outputs?.[kind]||'')!==path.resolve(file))throw new Error('Unexpected editor output path');
    await scopedFile(projectDir,file);const fingerprint=await hashFile(file);
    if(kind==='preview'||kind==='vrm'){const gltf=validateGlb(await fs.readFile(file));if(kind==='vrm'&&!gltf.extensions?.VRMC_vrm)throw new Error('VRM extension missing');}
    artifacts[kind]={...fingerprint,filePath:path.relative(projectDir,file).replaceAll('\\','/')};
  }
  const audit=JSON.parse(await fs.readFile(pending.outputs.report,'utf8'));
  const saved=await updateProjectState(projectDir,state=>{
    state.editor||=schema();if((state.editor.activeRevisionId||null)!==pending.baseRevisionId)throw new Error('Base revision changed during Blender execution; output retained but not activated');
    const record={id:pending.id,parentId:pending.baseRevisionId,operation:pending.operation,createdAt:new Date().toISOString(),artifacts,audit,params:pending.params,sourceHash:pending.sourceHash,visualReview:'required'};
    state.editor.revisions.push(record);state.editor.activeRevisionId=record.id;state.editor.pendingJob=null;state.auditLog.push({at:record.createdAt,event:'editor.revision',detail:record.id});
  });
  return {verdict:'pass',scope:'artifact_and_structural_validation_only',visualReview:'required',revisionId:pending.id,editor:saved.state.editor};
}
export async function runEditorOperation({projectDir,operation='audit',params={},expectedRevisionId,blenderPluginUrl='',caller=null,fetchImpl=fetch,signal}={}) {
  return exclusiveProjectOperation(projectDir,async()=>{
    params=validateEditorParams(operation,params);let loaded=await loadProjectState(projectDir);
    if(!loaded.exists){if(operation!=='import_blend')throw new Error('Initialize project first');await initOrUpdateProject(projectDir);loaded=await loadProjectState(projectDir);}
    const root=loaded.projectDir,state=loaded.state;checkBase(state,expectedRevisionId);const baseId=state.editor?.activeRevisionId||null;
    let source;
    if(operation==='import_blend') {if(typeof params.sourceBlend!=='string'||!params.sourceBlend.toLowerCase().endsWith('.blend'))throw new Error('Choose an existing .blend file');source=path.resolve(params.sourceBlend);}
    else {const base=revision(state,baseId);source=await verifyRecord(root,base.artifacts.blend);for(const key of ['vrmAddonPath','vrmAddonModule'])if(params[key]===undefined&&base.params?.[key])params[key]=base.params[key];}
    const sourceHash=(await hashFile(source)).sha256,requestId=id(),folder=path.join(root,'editor','revisions',requestId);await fs.mkdir(folder,{recursive:true});
    const realRoot=await fs.realpath(root),realFolder=await fs.realpath(folder),relative=path.relative(realRoot,realFolder);if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Editor output directory escapes project');
    const outputs={blend:path.join(folder,'scene.blend'),preview:path.join(folder,'preview.glb'),report:path.join(folder,'audit.json'),vrm:path.join(folder,'avatar.vrm')};
    const pending={id:requestId,baseRevisionId:baseId,operation,params,sourceHash,sourcePath:source,outputs,createdAt:new Date().toISOString()};
    const command={requestId,operation,params,inputBlend:source,outputs};
    const python=await fs.readFile(new URL('../blender/studio-pipeline.py',import.meta.url),'utf8'),scriptFile=path.join(folder,'operation.py');
    await fs.writeFile(scriptFile,`COMMAND = ${JSON.stringify(JSON.stringify(command))}\n`+python,'utf8');
    const connection=await probeBlenderPluginLink({blenderPluginUrl,fetchImpl});if(!connection.linked)throw new Error(connection.remedyZh||'Companion unavailable');
    const receipt=await executeCompanionStage({connection,scriptFile,outdir:folder,executionTarget:'headless',caller,fetchImpl,signal});
    await fs.writeFile(path.join(folder,'companion-receipt.json'),JSON.stringify(receipt,null,2));
    if(receipt.jobId){await updateProjectState(root,next=>{next.editor||=schema();next.editor.pendingJob={...pending,jobId:receipt.jobId,protocol:connection.protocol,baseUrl:connection.baseUrl,caller};});return {verdict:'degraded',pending:true,jobId:receipt.jobId};}
    if((await hashFile(source)).sha256!==sourceHash)throw new Error('Input changed during execution; generated output was not activated');
    return finalize(root,pending,receipt);
  });
}
export async function collectEditorJob({projectDir,caller=null,fetchImpl=fetch,signal}={}) {
  return exclusiveProjectOperation(projectDir,async()=>{const state=(await loadProjectState(projectDir)).state,pending=state.editor?.pendingJob;if(!pending)throw new Error('No pending editor job');const collected=await collectCompanionJob(pending,{caller,fetchImpl,signal});if(collected.pending)return {verdict:'degraded',pending:true,jobId:pending.jobId};if(collected.failed){await updateProjectState(projectDir,next=>{if(next.editor.pendingJob?.jobId!==pending.jobId)throw new Error('Job changed');next.editor.lastFailedJob={id:pending.jobId,error:collected.receipt.error};next.editor.pendingJob=null;});return {verdict:'fail',error:collected.receipt.error};}return finalize(path.resolve(projectDir),pending,collected.receipt);});
}

export async function cancelEditorJob({projectDir,caller=null,fetchImpl=fetch,signal}={}) {
  const state=(await loadProjectState(projectDir)).state,pending=state.editor?.pendingJob;
  if(!pending)throw new Error('No pending editor job');
  const receipt=await cancelCompanionJob(pending,{caller,fetchImpl,signal});
  return {verdict:'degraded',cancelRequested:true,jobId:pending.jobId,receipt,next:'Collect terminal status before resubmitting; cancellation is not an artifact or refund confirmation'};
}
