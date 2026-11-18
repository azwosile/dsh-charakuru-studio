import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadProjectState, updateProjectState, initOrUpdateProject } from './state.js';
import { scopedFile } from './reviews.js';
import { redactSecrets } from '../contracts/lossless.js';
import { exclusiveProjectOperation } from './operations.js';
import { probeBlenderPluginLink, extractStageResult } from '../blender/bridge.js';
import { executeCompanionStage, collectCompanionJob, cancelCompanionJob } from '../blender/transport.js';
import { validateGlb } from '../tripo/free-quota-scheduler.js';
import { resolveProjectMaterial } from './materials.js';

export const EDITOR_OPERATIONS = ['import_blend','import_checkpoint','import_material_scene','append_material_mesh','apply_material_texture','audit','head_scale','transform','materials','transfer_weights','normalize_weights','configure_vrm','spring_setup','pose_check','export_vrm'];
const IMPORT_OPERATIONS = ['import_blend', 'import_checkpoint', 'import_material_scene'];
const MATERIAL_INTENTS = Object.freeze({ import_material_scene: 'scene', append_material_mesh: 'mesh', apply_material_texture: 'texture' });
const CAMERA_VIEWS = ['front', 'back', 'left', 'right', 'perspective'];
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
  const allowed=['sourceMesh','maxTransferDistance','materialMode','objects','scale','translation','factor','armature','headBone','pivotBone','sourceBlend','vrmAddonPath','vrmAddonModule','humanBones','authors','title','commercialUsage','chains','colliderBones','stiffness','dragForce','hitRadius','gravityPower','skirt','expressions','materialId','textureSlot'];
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
  if (Object.hasOwn(MATERIAL_INTENTS, operation)) {
    if (typeof params.materialId !== 'string' || !/^material_[a-f0-9-]{36}$/.test(params.materialId) || params.sourceBlend !== undefined) throw new Error('Choose a registered material ID, not an arbitrary path');
  } else if (params.materialId !== undefined || params.textureSlot !== undefined) throw new Error('Material inputs are not supported for this operation');
  if (operation === 'apply_material_texture' && (!params.objects?.length || !Number.isInteger(params.textureSlot) || params.textureSlot < 0 || params.textureSlot > 127)) throw new Error('Texture application needs named mesh objects and a material slot index from 0 through 127');
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
  if(!CAMERA_VIEWS.includes(camera)||!Number.isFinite(overlayOpacity)||overlayOpacity<0||overlayOpacity>1)throw new Error('Invalid viewport state');
  return updateProjectState(projectDir,state=>{state.editor||=schema();if(overlayAssetId&&!state.assets?.items.some(a=>a.id===overlayAssetId&&a.kind==='image'))throw new Error('Reference image not registered in this project');state.editor.view={camera,overlayAssetId,overlayOpacity};});
}
export async function rollbackEditor({projectDir,revisionId,expectedRevisionId}={}) {
  return updateProjectState(projectDir,async state=>{checkBase(state,expectedRevisionId);const target=revision(state,revisionId);await verifyRecord(projectDir,target.artifacts.blend);await verifyRecord(projectDir,target.artifacts.preview);state.editor.activeRevisionId=target.id;state.editor.lastRollback={at:new Date().toISOString(),to:target.id};state.auditLog.push({at:new Date().toISOString(),event:'editor.rollback',detail:target.id});});
}
function findAiRequest(state, requestId) {
  const request = state.editor?.requests?.find(item => item.id === requestId);
  if (!request) throw new Error('AI edit request not found in this project');
  return request;
}
function requireRequestedEdit(state, requestId, base) {
  const request = findAiRequest(state, requestId);
  if (request.status !== 'requested') throw new Error('AI edit request has already been processed');
  if (request.baseRevisionId !== base.id || request.blendHash !== base.artifacts.blend.sha256) {
    throw new Error('AI edit request base revision changed; create a new request');
  }
  return request;
}
function aiHandoff(projectDir, request) {
  const context = { projectDir: path.resolve(projectDir), editRequestId: request.id,
    expectedRevisionId: request.baseRevisionId, objects: request.objects, camera: request.camera };
  return {
    request,
    instruction: [
      '请接手 Avatar Studio 中的这条模型修改请求。先核对所选对象与工序，使用 charakuru_blender_avatar，action=editor_operation。',
      '必须传入 projectDir、editRequestId 和 expectedRevisionId；将用户要求映射为已有的 editorOperation 和结构化 editorParams。不执行任意 Python，不上传素材，不覆盖源文件。',
      '若工具返回待收集作业，调用 editor_collect；仅在生成新版本后让用户回工作台预览并确认。若基础版本不匹配、要求不明确或没有对应工序，请停止并说明。',
      JSON.stringify(context),
      '用户本次修改要求：', request.prompt,
    ].join('\n'),
  };
}
export async function createAiEditRequest({ projectDir, prompt, objects = [], camera = 'front', expectedRevisionId } = {}) {
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 8000) throw new Error('AI edit instruction is required, max 8000 characters');
  if (typeof expectedRevisionId !== 'string' || !expectedRevisionId) throw new Error('A base revision is required for an AI edit request');
  if (!CAMERA_VIEWS.includes(camera)) throw new Error('Invalid viewport state');
  if (!Array.isArray(objects) || objects.length > 200 || objects.some(n => typeof n !== 'string' || n.length > 200)) throw new Error('Invalid object selection');
  let request;
  await updateProjectState(projectDir, async state => {
    checkBase(state, expectedRevisionId);
    const base = revision(state, expectedRevisionId);
    const names = new Set((base.audit?.objects || []).map(o => o.name));
    if (objects.some(n => !names.has(n))) throw new Error('AI selection contains unknown objects');
    await verifyRecord(projectDir, base.artifacts.blend);
    request = { id: id(), status: 'requested', createdAt: new Date().toISOString(), baseRevisionId: base.id,
      blendHash: base.artifacts.blend.sha256, objects: [...new Set(objects)], camera, prompt: redactSecrets(prompt.trim()) };
    state.editor.requests = [...(state.editor.requests || []), request].slice(-100);
  });
  return aiHandoff(projectDir, request);
}
export async function prepareAiEditHandoff({ projectDir, requestId } = {}) {
  const { state } = await loadProjectState(projectDir);
  const request = findAiRequest(state || {}, requestId);
  checkBase(state, request.baseRevisionId);
  const base = revision(state, request.baseRevisionId);
  requireRequestedEdit(state, requestId, base);
  await verifyRecord(projectDir, base.artifacts.blend);
  return aiHandoff(projectDir, request);
}
export async function reviewAiEditRequest({ projectDir, requestId, revisionId, decision } = {}) {
  if (!['approve', 'reject'].includes(decision) || typeof revisionId !== 'string' || !revisionId) throw new Error('Expected an edit decision and revision ID');
  return exclusiveProjectOperation(projectDir, async () => {
    const saved = await updateProjectState(projectDir, async state => {
      checkBase(state, revisionId);
      const request = findAiRequest(state, requestId);
      if (request.status !== 'ready_for_review' || request.resultRevisionId !== revisionId) throw new Error('AI edit result is not awaiting review for this revision');
      const result = revision(state, revisionId);
      if (result.editRequestId !== request.id || result.parentId !== request.baseRevisionId) throw new Error('AI edit revision lineage does not match');
      const target = decision === 'reject' ? revision(state, request.baseRevisionId) : result;
      await verifyRecord(projectDir, target.artifacts.blend);
      await verifyRecord(projectDir, target.artifacts.preview);
      if (target.artifacts.vrm) await verifyRecord(projectDir, target.artifacts.vrm);
      request.status = decision === 'approve' ? 'approved' : 'rejected';
      request.reviewedAt = new Date().toISOString();
      state.editor.activeRevisionId = target.id;
      state.auditLog.push({ at: request.reviewedAt, event: 'editor.ai_review', detail: request.id + ':' + request.status });
    });
    return { request: findAiRequest(saved.state, requestId), activeRevisionId: saved.state.editor.activeRevisionId };
  });
}
async function finalize(projectDir,pending,receipt) {
  if(receipt.ok===false||receipt.exitCode!=null&&receipt.exitCode!==0||String(receipt.stderr||receipt.stderrTail||'').includes('Traceback')){const detail=await extractStageResult(receipt).catch(()=>null);throw new Error('Blender process failed; previous revision remains active: '+(detail?.error||receipt.error||receipt.traceback||String(receipt.stderr||receipt.stderrTail||'').slice(-800)));}
  if(pending.sourcePath&&(await hashFile(pending.sourcePath)).sha256!==pending.sourceHash)throw new Error('Input changed during execution; generated output was not activated');
  if (pending.materialInput) {
    const verified = await resolveProjectMaterial(projectDir, pending.materialInput.id, MATERIAL_INTENTS[pending.operation]);
    if (verified.record.sha256 !== pending.materialInput.sha256) throw new Error('External material changed during execution; candidate revision was not activated');
  }
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
  if (pending.materialInput && (audit.materialInput?.id !== pending.materialInput.id || audit.materialInput.sha256 !== pending.materialInput.sha256)) throw new Error('Blender audit did not identify the submitted external material');
  const saved=await updateProjectState(projectDir,state=>{
    state.editor||=schema();if((state.editor.activeRevisionId||null)!==pending.baseRevisionId)throw new Error('Base revision changed during Blender execution; output retained but not activated');
    const record={id:pending.id,parentId:pending.baseRevisionId,operation:pending.operation,createdAt:new Date().toISOString(),artifacts,audit,params:pending.params,sourceHash:pending.sourceHash,materialInput:pending.materialInput || null,visualReview:'required'};
    if (pending.editRequestId) {
      const request = requireRequestedEdit(state, pending.editRequestId, revision(state, pending.baseRevisionId));
      request.status = 'ready_for_review';
      request.resultRevisionId = record.id;
      request.finishedAt = record.createdAt;
      record.editRequestId = request.id;
    }
    state.editor.revisions.push(record);state.editor.activeRevisionId=record.id;state.editor.pendingJob=null;state.auditLog.push({at:record.createdAt,event:'editor.revision',detail:record.id});
  });
  return {verdict:'pass',scope:'artifact_and_structural_validation_only',visualReview:'required',revisionId:pending.id,editRequestId:pending.editRequestId,editor:saved.state.editor};
}
export async function runEditorOperation({projectDir,operation='audit',params={},expectedRevisionId,editRequestId,blenderPluginUrl='',caller=null,fetchImpl=fetch,signal}={}) {
  return exclusiveProjectOperation(projectDir,async()=>{
    params=validateEditorParams(operation,params);
    if (editRequestId !== undefined && (typeof editRequestId !== 'string' || !editRequestId ||
      typeof expectedRevisionId !== 'string' || !expectedRevisionId || IMPORT_OPERATIONS.includes(operation))) {
      throw new Error('AI edit execution requires a request ID, its base revision, and an editing operation');
    }
    let loaded=await loadProjectState(projectDir);
    if(!loaded.exists){if(operation!=='import_blend')throw new Error('Initialize project first');await initOrUpdateProject(projectDir);loaded=await loadProjectState(projectDir);}
    const root=loaded.projectDir,state=loaded.state;checkBase(state,expectedRevisionId);const baseId=state.editor?.activeRevisionId||null;
    if (editRequestId) requireRequestedEdit(state, editRequestId, revision(state, baseId));
    const materialIntent = Object.hasOwn(MATERIAL_INTENTS, operation) ? MATERIAL_INTENTS[operation] : null;
    if (materialIntent && baseId && expectedRevisionId !== baseId) throw new Error('Choose the current editor base revision before using an external material');
    const incoming = materialIntent ? await resolveProjectMaterial(root, params.materialId, materialIntent) : null;
    const materialInput = incoming ? { id: incoming.record.id, role: incoming.record.role, stageId: incoming.record.stageId,
      sha256: incoming.record.sha256, filePath: incoming.record.filePath } : null;
    let source;
    if (operation === 'import_material_scene') source = incoming.file;
    else if(operation==='import_blend') {if(typeof params.sourceBlend!=='string'||!params.sourceBlend.toLowerCase().endsWith('.blend'))throw new Error('Choose an existing .blend file');source=path.resolve(params.sourceBlend);}
    else if (operation === 'import_checkpoint') {
      const studio = state.blenderState;
      const artifact = studio?.lastRun?.artifacts?.find(item => item.validation === 'blend_container_only' && item.path === studio.activeBlendFile);
      if (!artifact || !/^[a-f0-9]{64}$/.test(artifact.sha256 || '')) throw new Error('No current, fingerprinted Blender checkpoint in this project');
      source = await verifyRecord(root, { filePath: artifact.path, sha256: artifact.sha256 });
    }
    else {const base=revision(state,baseId);source=await verifyRecord(root,base.artifacts.blend);for(const key of ['vrmAddonPath','vrmAddonModule'])if(params[key]===undefined&&base.params?.[key])params[key]=base.params[key];}
    const sourceHash=(await hashFile(source)).sha256,requestId=id(),folder=path.join(root,'editor','revisions',requestId);await fs.mkdir(folder,{recursive:true});
    const realRoot=await fs.realpath(root),realFolder=await fs.realpath(folder),relative=path.relative(realRoot,realFolder);if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Editor output directory escapes project');
    const outputs={blend:path.join(folder,'scene.blend'),preview:path.join(folder,'preview.glb'),report:path.join(folder,'audit.json'),vrm:path.join(folder,'avatar.vrm')};
    const pending={id:requestId,baseRevisionId:baseId,operation,params,sourceHash,sourcePath:source,outputs,materialInput,createdAt:new Date().toISOString(),...(editRequestId?{editRequestId}:{})};
    const command={requestId,operation,params,inputBlend:source,outputs,material:incoming ? {...materialInput, path:incoming.file} : null};
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
