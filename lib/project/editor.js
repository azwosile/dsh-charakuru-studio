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
import { revisionFromSelectedBody } from './workflow.js';

export const EDITOR_OPERATIONS = ['import_blend','import_checkpoint','import_material_scene','append_material_mesh','apply_material_texture','fit_foundation','append_foundation_head','audit','head_scale','transform','materials','transfer_weights','normalize_weights','configure_vrm','spring_setup','pose_check','export_vrm'];
const IMPORT_OPERATIONS = ['import_blend', 'import_checkpoint', 'import_material_scene'];
const MATERIAL_INTENTS = Object.freeze({ import_material_scene: 'scene', append_material_mesh: 'mesh', apply_material_texture: 'texture', append_foundation_head:'foundation_head' });
const CAMERA_VIEWS = ['front', 'back', 'left', 'right', 'perspective'];
export const AI_EDIT_INTENTS = Object.freeze({
  general:['audit','head_scale','transform','materials','transfer_weights','normalize_weights','configure_vrm','spring_setup','pose_check','export_vrm','fit_foundation','append_foundation_head'],
  foundation_fit:['fit_foundation'], foundation_head:['append_foundation_head'],
  placement:['transform','head_scale','audit'], rigging:['transfer_weights','normalize_weights','configure_vrm','spring_setup','pose_check','audit'],
  delivery:['configure_vrm','export_vrm','materials','audit'],
});
const foundationIntent = name => ['foundation_fit','foundation_head'].includes(name);
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
  const allowed=['sourceMesh','maxTransferDistance','materialMode','objects','scale','translation','rotation','factor','armature','headBone','pivotBone','sourceBlend','vrmAddonPath','vrmAddonModule','humanBones','authors','title','commercialUsage','chains','colliderBones','stiffness','dragForce','hitRadius','gravityPower','skirt','expressions','materialId','textureSlot','bodyObject','shapeValues','keepMeshes','replaceHeadObjects'];
  for(const key of Object.keys(params))if(!allowed.includes(key))throw new Error('Unknown editor parameter '+key);
  const numbers=(x,n,min,max)=>Array.isArray(x)&&x.length===n&&x.every(v=>Number.isFinite(v)&&v>=min&&v<=max);
  if(operation==='transfer_weights'&&(!params.objects?.length||typeof params.sourceMesh!=='string'||!Number.isFinite(params.maxTransferDistance)||params.maxTransferDistance<=0||params.maxTransferDistance>1))throw new Error('Weight transfer requires explicit source, targets and maximum distance up to one meter');
  if(params.objects && (!Array.isArray(params.objects)||params.objects.length>250||params.objects.some(n=>typeof n!=='string'||n.length>200)))throw new Error('Invalid object selection');
  if(operation==='head_scale'&&(!Number.isFinite(params.factor)||params.factor<0.75||params.factor>1.25))throw new Error('Head scale must be between 0.75 and 1.25');
  if(operation==='transform'&&(!params.objects?.length||!numbers(params.scale||[1,1,1],3,0.1,10)||!numbers(params.translation||[0,0,0],3,-10,10)||!numbers(params.rotation||[0,0,0],3,-360,360)))throw new Error('Transform needs explicit objects and bounded scale/translation');
  if(params.rotation!==undefined&&!numbers(params.rotation,3,-360,360))throw new Error('Rotation must be three finite degrees between -360 and 360');
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
  const names = (v, max) => Array.isArray(v) && v.length > 0 && v.length <= max && new Set(v).size===v.length && v.every(n => typeof n==='string' && n.trim() && n.length<=160);
  if (operation === 'fit_foundation') {
    if (typeof params.bodyObject!=='string' || !params.bodyObject.trim() || params.bodyObject.length>160 || !numbers(params.scale||[1,1,1],3,.75,1.3)) throw new Error('Select a body mesh and limit relative stretching to 0.75–1.30');
    if (params.keepMeshes!==undefined && (!names(params.keepMeshes,32) || !params.keepMeshes.includes(params.bodyObject))) throw new Error('Keep-list must include the selected body');
    const shapes=params.shapeValues || [];
    if (!Array.isArray(shapes)||shapes.length>12||new Set(shapes.map(x=>x?.key)).size!==shapes.length||shapes.some(x=>!x||Object.keys(x).some(k=>!['key','value'].includes(k))||typeof x.key!=='string'||!x.key.trim()||x.key.length>160||!Number.isFinite(x.value)||x.value<0||x.value>1)) throw new Error('Set only named existing shape keys from 0 to 1');
  }
  if (operation === 'append_foundation_head' && (!names(params.objects,16) || typeof params.headBone!=='string' || !params.headBone.trim() || params.headBone.length>160 || !numbers(params.scale||[1,1,1],3,.5,2) || !numbers(params.translation||[0,0,0],3,-1,1) || !numbers(params.rotation||[0,0,0],3,-360,360) || (params.replaceHeadObjects!==undefined && !names(params.replaceHeadObjects,16)))) throw new Error('Choose source head meshes, a target head bone, bounded fit and optional old head objects');
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
export async function verifyEditorBlend(projectDir,state,revisionId) {
  const record=revision(state,revisionId).artifacts.blend;
  return {file:await verifyRecord(projectDir,record),sha256:record.sha256};
}
export async function editorContent(projectDir, revisionId, kind='preview') {
  const state=(await loadProjectState(projectDir)).state,r=revision(state,revisionId),record=r.artifacts[kind];
  if(!['preview','vrm','report'].includes(kind)||!record)throw new Error('Requested revision artifact unavailable');
  const file=await verifyRecord(projectDir,record);return {bytes:await fs.readFile(file),mime:kind==='report'?'application/json':'model/gltf-binary'};
}
export async function setEditorView({projectDir,camera='front',overlayAssetId=null,overlayOpacity=0.35,expectedRevision}={}) {
  if(!CAMERA_VIEWS.includes(camera)||!Number.isFinite(overlayOpacity)||overlayOpacity<0||overlayOpacity>1)throw new Error('Invalid viewport state');
  return updateProjectState(projectDir,state=>{if(expectedRevision!==undefined&&expectedRevision!==state.stateRevision)throw new Error('Project view changed; refresh before setting an overlay');state.editor||=schema();if(overlayAssetId&&!state.assets?.items.some(a=>a.id===overlayAssetId&&a.kind==='image'))throw new Error('Reference image not registered in this project');state.editor.view={camera,overlayAssetId,overlayOpacity};});
}
function resolveLineageVrmPath(projectDir, state, activeRev) {
  let cur = activeRev;
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.artifacts?.vrm?.filePath) return path.resolve(projectDir, cur.artifacts.vrm.filePath);
    cur = cur.parentId ? state.editor?.revisions?.find(r => r.id === cur.parentId) : null;
  }
  return null;
}
export async function rollbackEditor({projectDir,revisionId,expectedRevisionId}={}) {
  return updateProjectState(projectDir,async state=>{checkBase(state,expectedRevisionId);const target=revision(state,revisionId);await verifyRecord(projectDir,target.artifacts.blend);await verifyRecord(projectDir,target.artifacts.preview);state.editor.activeRevisionId=target.id;state.editor.lastRollback={at:new Date().toISOString(),to:target.id};if(state.vrmMetadata)state.vrmMetadata.exportedVrmPath=resolveLineageVrmPath(projectDir,state,target);state.auditLog.push({at:new Date().toISOString(),event:'editor.rollback',detail:target.id});});
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
  if (request.foundation && (!revisionFromSelectedBody(state,base.id)||state.workflow?.mode!=='base_mesh'||request.foundation.body!==state.workflow.foundation.body||request.foundation.head!==state.workflow.foundation.head)) throw new Error('Adopted foundations changed; create a new request');
  return request;
}
function aiHandoff(projectDir, request) {
  const context = { projectDir: path.resolve(projectDir), editRequestId: request.id,
    expectedRevisionId: request.baseRevisionId, intent:request.intent||'general', approvedOperations:AI_EDIT_INTENTS[request.intent||'general'], objects: request.objects, camera: request.camera, ...(request.foundation?{foundation:request.foundation}:{}) };
  return {
    request,
    instruction: [
      '请接手 Avatar Studio 中的这条模型修改请求。先核对所选对象与工序，使用 charakuru_blender_avatar，action=editor_operation。',
      '先调用 charakuru_blender_avatar(action=editor_inspect, projectDir, editRequestId) 获取实际网格、形态键与骨架。按范围自己决定参数；不要让用户代填数值，不猜对象名。',
      '执行时传入 projectDir、editRequestId 和 expectedRevisionId；只使用 approvedOperations 中的工序。比例、权重与取景按用户目标拟定。若是换头，等 editor_inspect 的 donor 网格清单；donorPending 时只在同会话再次 inspect 收集，不提交编辑、不猜名称。若不兼容就停下解释。',
      'fit_foundation 使用 bodyObject、armature、0.75–1.30 的相对 XYZ scale、已有 shapeValues；append_foundation_head 使用已采用的 materialId、供体 objects、实际 headBone 和显式对版。拒绝任意 Python、配置路径与上传，不覆盖源文件。',
      '若工具返回待收集作业，调用 editor_collect；仅在生成新版本后让用户回工作台预览并确认。若基础版本不匹配、要求不明确或没有对应工序，请停止并说明。',
      JSON.stringify(context),
      '用户本次修改要求：', request.prompt,
    ].join('\n'),
  };
}
export async function createAiEditRequest({ projectDir, prompt, objects = [], camera = 'front', expectedRevisionId, intent='general' } = {}) {
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 8000) throw new Error('AI edit instruction is required, max 8000 characters');
  if (typeof expectedRevisionId !== 'string' || !expectedRevisionId) throw new Error('A base revision is required for an AI edit request');
  if (!CAMERA_VIEWS.includes(camera)) throw new Error('Invalid viewport state');
  if (!Object.hasOwn(AI_EDIT_INTENTS,intent)) throw new Error('Unknown AI edit intent');
  if (!Array.isArray(objects) || objects.length > 250 || objects.some(n => typeof n !== 'string' || n.length > 200)) throw new Error('Invalid object selection');
  let request;
  await updateProjectState(projectDir, async state => {
    checkBase(state, expectedRevisionId);
    const base = revision(state, expectedRevisionId);
    if(state.editor.requests?.some(r=>r.status==='ready_for_review'&&r.resultRevisionId===base.id))throw new Error('Approve or reject the active AI revision before drafting a new edit');
    if(foundationIntent(intent)&&(state.workflow?.mode!=='base_mesh'||!revisionFromSelectedBody(state,base.id))) throw new Error('Open the adopted body as the current revision before drafting a base edit');
    if(intent==='foundation_head'&&(!state.workflow.foundation.head||state.workflow.foundation.head==='embedded')) throw new Error('Adopt a separate head first');
    const names = new Set((base.audit?.objects || []).map(o => o.name));
    if (objects.some(n => !names.has(n))) throw new Error('AI selection contains unknown objects');
    await verifyRecord(projectDir, base.artifacts.blend);
    request = { id: id(), status: 'requested', createdAt: new Date().toISOString(), baseRevisionId: base.id,
      blendHash: base.artifacts.blend.sha256, intent, ...(foundationIntent(intent)?{foundation:{...state.workflow.foundation}}:{}), objects: [...new Set(objects)], camera, prompt: redactSecrets(prompt.trim()) };
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
export async function inspectAiEdit({projectDir,requestId,blenderPluginUrl='',caller=null,fetchImpl=fetch,signal}={}) {
  return exclusiveProjectOperation(projectDir,async()=>{
    const {state,projectDir:root}=await loadProjectState(projectDir),request=findAiRequest(state||{},requestId);
    checkBase(state,request.baseRevisionId);
    const base=revision(state,request.baseRevisionId);
    requireRequestedEdit(state,requestId,base);
    await verifyRecord(root,base.artifacts.blend);
    const visible=(base.audit?.objects||[]).filter(o=>!o.helper);
    const response={request,allowed:AI_EDIT_INTENTS[request.intent||'general'],inventory:visible.slice(0,250).map(o=>o.type==='ARMATURE'?{name:o.name,type:o.type,bones:o.bones?.slice(0,360)}:{name:o.name,type:o.type,vertices:o.vertices,shapeKeys:o.shapeKeys?.slice(0,80),dimensions:o.dimensions,location:o.location}),truncated:visible.length>250};
    if(request.intent!=='foundation_head')return response;
    const donor=await resolveProjectMaterial(root,request.foundation.head,'foundation_head');
    const updateInspection=value=>updateProjectState(root,next=>{checkBase(next,base.id);requireRequestedEdit(next,requestId,revision(next,base.id)).donorInspection=value;});
    let job=request.donorInspection,receipt;
    if(job?.failed)throw new Error('Donor inspection was not confirmed. Report the failure; use a new request only after reconciliation.');
    if(job?.report)return {...response,donor:{id:donor.record.id,fileName:donor.record.fileName,...job.report}};
    if(job?.jobId){
      const collected=await collectCompanionJob(job,{caller,fetchImpl,signal});
      if(collected.pending)return {...response,donorPending:true,jobId:job.jobId};
      receipt=collected.receipt;
    }else{
      const connection=await probeBlenderPluginLink({blenderPluginUrl,fetchImpl});
      if(!connection.linked)throw new Error(connection.remedyZh||'Companion unavailable for donor inventory');
      const rel='editor/inspect/'+id(),dir=path.join(root,rel),scriptFile=path.join(dir,'inspect.py');
      await fs.mkdir(dir,{recursive:true});
      if(path.relative(await fs.realpath(root),await fs.realpath(dir))!==rel.split('/').join(path.sep))throw new Error('Donor inspection directory escapes project');
      job={reportRel:rel+'/inventory.json',protocol:connection.protocol,baseUrl:connection.baseUrl,caller};
      const c={requestId,inputBlend:donor.file,donorSha256:donor.record.sha256,reportPath:path.join(root,job.reportRel)};
      const python=await fs.readFile(new URL('../blender/inspect-foundation.py',import.meta.url),'utf8');
      await fs.writeFile(scriptFile,`COMMAND = ${JSON.stringify(JSON.stringify(c))}\n`+python,{flag:'wx'});
      receipt=await executeCompanionStage({connection,scriptFile,outdir:dir,executionTarget:'headless',caller,fetchImpl,signal});
      if(receipt.jobId){await updateInspection({...job,jobId:receipt.jobId});return {...response,donorPending:true,jobId:receipt.jobId};}
    }
    try {
      const proof=await extractStageResult(receipt);
      if(receipt.ok===false||receipt.exitCode!==0||proof?.verdict!=='pass'||proof.requestId!==requestId)throw new Error(proof?.error||'Blender did not confirm the donor inventory');
      const reportFile=await scopedFile(root,job.reportRel);
      if((await fs.stat(reportFile)).size>512*1024)throw new Error('Donor inventory exceeds its size limit');
      const report=JSON.parse(await fs.readFile(reportFile,'utf8'));
      if(report.requestId!==requestId||report.donorSha256!==donor.record.sha256||!Array.isArray(report.meshes)||report.meshes.length>250||!report.meshes.length)throw new Error('Donor has no verifiable visible mesh inventory');
      await resolveProjectMaterial(root,donor.record.id,'foundation_head');
      await updateInspection({report});
      return {...response,donor:{id:donor.record.id,fileName:donor.record.fileName,...report}};
    }catch(error){await updateInspection({failed:true}).catch(()=>{});throw error;}
  });
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
      if (state.vrmMetadata) state.vrmMetadata.exportedVrmPath = resolveLineageVrmPath(projectDir, state, target);
      state.auditLog.push({ at: request.reviewedAt, event: 'editor.ai_review', detail: request.id + ':' + request.status });
    });
    return { request: findAiRequest(saved.state, requestId), activeRevisionId: saved.state.editor.activeRevisionId };
  });
}
async function finalize(projectDir,pending,receipt) {
  const detail=await extractStageResult(receipt).catch(()=>null);
  const hasStderrTraceback=String(receipt.stderr||receipt.stderrTail||'').includes('Traceback');
  if(receipt.ok===false||receipt.exitCode!=null&&receipt.exitCode!==0||(hasStderrTraceback&&detail?.verdict!=='pass')){throw new Error('Blender process failed; previous revision remains active: '+(detail?.error||receipt.error||receipt.traceback||String(receipt.stderr||receipt.stderrTail||'').slice(-800)));}
  if(pending.sourcePath&&(await hashFile(pending.sourcePath)).sha256!==pending.sourceHash)throw new Error('Input changed during execution; generated output was not activated');
  if (pending.materialInput) {
    const verified = await resolveProjectMaterial(projectDir, pending.materialInput.id, MATERIAL_INTENTS[pending.operation]);
    if (verified.record.sha256 !== pending.materialInput.sha256) throw new Error('External material changed during execution; candidate revision was not activated');
  }
  const result=detail||await extractStageResult(receipt);
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
    state.editor.revisions.push(record);state.editor.activeRevisionId=record.id;state.editor.pendingJob=null;
    if (pending.operation === 'configure_vrm' && state.vrmMetadata) {
      if (pending.params?.title) state.vrmMetadata.title = pending.params.title;
      if (Array.isArray(pending.params?.authors)) state.vrmMetadata.authors = [...pending.params.authors];
      if (pending.params?.commercialUsage) state.vrmMetadata.commercialUsage = pending.params.commercialUsage;
    }
    if (artifacts.vrm && state.vrmMetadata) {
      state.vrmMetadata.exportedVrmPath = path.resolve(projectDir, artifacts.vrm.filePath);
    } else if (state.vrmMetadata) {
      state.vrmMetadata.exportedVrmPath = resolveLineageVrmPath(projectDir, state, record) || state.vrmMetadata.exportedVrmPath;
    }
    state.auditLog.push({at:record.createdAt,event:'editor.revision',detail:record.id});
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
    if (editRequestId) {
      const prior=revision(state,baseId),request=requireRequestedEdit(state,editRequestId,prior);
      if (!AI_EDIT_INTENTS[request.intent||'general']?.includes(operation)) throw new Error('This operation is outside the approved AI edit scope');
      if(request.objects.length && ['transform','transfer_weights','normalize_weights'].includes(operation) && (!params.objects?.length||params.objects.some(n=>!request.objects.includes(n)))) throw new Error('Target not selected in this AI request');
      if(operation==='fit_foundation' && request.objects.length && !request.objects.includes(params.bodyObject)) throw new Error('Body mesh not selected in this AI request');
      if(request.intent==='foundation_head') {
        if(params.materialId!==request.foundation.head)throw new Error('Donor differs from the AI request');
        const observed=request.donorInspection?.report?.meshes||[];
        if(!observed.length||params.objects.some(name=>!observed.some(m=>m.name===name)))throw new Error('Run editor_inspect and choose only the named donor meshes');
      }
      for(const key of ['vrmAddonPath','vrmAddonModule'])if(params[key]!==undefined && prior.params?.[key]!==undefined && params[key]!==prior.params[key])throw new Error('AI requests cannot choose a new add-on path or module');
    }
    const materialIntent = Object.hasOwn(MATERIAL_INTENTS, operation) ? MATERIAL_INTENTS[operation] : null;
    if (materialIntent && baseId && expectedRevisionId !== baseId) throw new Error('Choose the current editor base revision before using an external material');
    const incoming = materialIntent ? await resolveProjectMaterial(root, params.materialId, materialIntent) : null;
    const materialInput = incoming ? { id: incoming.record.id, role: incoming.record.role, stageId: incoming.record.stageId,
      sha256: incoming.record.sha256, filePath: incoming.record.filePath } : null;
    if (incoming?.record.role==='foundation_body' && (state.workflow?.mode!=='base_mesh'||state.workflow.foundation.body!==params.materialId)) throw new Error('First adopt this body in the base mesh route');
    const baseAction = ['fit_foundation','append_foundation_head'].includes(operation) || /^tripo_(?:clothing|hair|accessory)$/.test(incoming?.record.role||'');
    if (baseAction && (state.workflow?.mode!=='base_mesh' || !baseId || expectedRevisionId!==baseId || !revisionFromSelectedBody(state,baseId))) throw new Error('Open the adopted body as the current editor revision first');
    if (operation==='append_foundation_head' && state.workflow.foundation.head!==params.materialId) throw new Error('Adopt the registered head first');
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
  return exclusiveProjectOperation(projectDir,async()=>{
    const state=(await loadProjectState(projectDir)).state,pending=state.editor?.pendingJob;
    if(!pending)throw new Error('No pending editor job');
    const collected=await collectCompanionJob(pending,{caller,fetchImpl,signal});
    if(collected.pending)return {verdict:'degraded',pending:true,jobId:pending.jobId};
    if(collected.failed){
      await updateProjectState(projectDir,next=>{
        if(next.editor.pendingJob?.jobId!==pending.jobId)throw new Error('Job changed');
        next.editor.lastFailedJob={id:pending.jobId,error:collected.receipt.error};
        next.editor.pendingJob=null;
      });
      return {verdict:'fail',error:collected.receipt.error};
    }
    try {
      return await finalize(path.resolve(projectDir),pending,collected.receipt);
    } catch (error) {
      await updateProjectState(projectDir,next=>{
        if(next.editor?.pendingJob?.jobId===pending.jobId){
          next.editor.pendingJob=null;
          next.editor.lastFailedJob={id:pending.jobId,error:error.message};
        }
      }).catch(()=>{});
      throw error;
    }
  });
}

export async function cancelEditorJob({projectDir,caller=null,fetchImpl=fetch,signal}={}) {
  const state=(await loadProjectState(projectDir)).state,pending=state.editor?.pendingJob;
  if(!pending)throw new Error('No pending editor job');
  const receipt=await cancelCompanionJob(pending,{caller,fetchImpl,signal});
  return {verdict:'degraded',cancelRequested:true,jobId:pending.jobId,receipt,next:'Collect terminal status before resubmitting; cancellation is not an artifact or refund confirmation'};
}
