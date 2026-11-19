import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { tempProject, png, glb, triangleGlb } from './fixtures.mjs';
import { initOrUpdateProject,loadProjectState,updateProjectState } from '../lib/project/state.js';
import { validateEditorParams,runEditorOperation,collectEditorJob,rollbackEditor,createAiEditRequest,prepareAiEditHandoff,reviewAiEditRequest,setEditorView,editorContent } from '../lib/project/editor.js';
import { collectReviewEvidence } from '../lib/project/reviews.js';
import { createAccountBudget } from '../lib/providers/account-budget.js';
import { runTurnaroundGeneration } from '../lib/providers/image-router.js';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const mockCompanion=async(url,init)=>{
  if(url.includes(':39877'))throw new Error('fixture unavailable');
  if(url.endsWith('/health'))return Response.json({ok:true,stats:{},lease:{},provenance:{}});
  if(url.endsWith('/doctor'))return Response.json({ok:true,kind:'ok'});
  const body=JSON.parse(init.body),script=await fs.readFile(body.scriptFile,'utf8');
  const command=JSON.parse(JSON.parse(script.split('\n')[0].slice('COMMAND = '.length)));
  await fs.writeFile(command.outputs.blend,'BLENDER-v500fixture-'+command.requestId);
  await fs.writeFile(command.outputs.preview,triangleGlb());
  await fs.writeFile(command.outputs.report,JSON.stringify({objects:[{name:'Head',type:'MESH'}],gates:{weights:true,textures:true}}));
  if(command.operation==='export_vrm'&&command.outputs.vrm)await fs.writeFile(command.outputs.vrm,glb({extensionsUsed:['VRMC_vrm'],extensions:{VRMC_vrm:{specVersion:'1.0'}}}));
  return Response.json({ok:true,exitCode:0,resultJson:{verdict:'pass',requestId:command.requestId,outputs:command.outputs}});
};
test('P2 structured editor rejects arbitrary Python and unbounded transforms',()=>{
  assert.throws(()=>validateEditorParams('python',{code:'print(1)'}),/Unknown/);
  assert.throws(()=>validateEditorParams('head_scale',{factor:4}),/scale/);
  assert.throws(()=>validateEditorParams('transform',{objects:['Head'],translation:[NaN,0,0]}),/Transform/);
  assert.throws(()=>validateEditorParams('spring_setup',{hitRadius:99}),/coefficient/);
  assert.deepEqual(validateEditorParams('transform',{objects:['Head'],rotation:[0,90,-45]}).rotation,[0,90,-45]);
  assert.throws(()=>validateEditorParams('transform',{objects:['Head'],rotation:[0,400,0]}),/Transform|rotation/i);
  assert.deepEqual(validateEditorParams('append_foundation_head',{materialId:'material_00000000-0000-0000-0000-000000000000',objects:['Face'],headBone:'Head',rotation:[0,180,0]}).rotation,[0,180,0]);
});
test('P2 editor creates immutable revisions and rollback verifies bytes',async t=>{
  const dir=await tempProject(t),source=path.join(dir,'original.blend');await fs.writeFile(source,'BLENDER-v500original');
  const first=await runEditorOperation({projectDir:dir,operation:'import_blend',params:{sourceBlend:source},fetchImpl:mockCompanion});
  const ev4=await collectReviewEvidence(dir,(await loadProjectState(dir)).state,'4_assembly');
  assert.ok(ev4.fingerprint);
  const second=await runEditorOperation({projectDir:dir,operation:'head_scale',params:{factor:.9},expectedRevisionId:first.revisionId,fetchImpl:mockCompanion});
  assert.notEqual(first.revisionId,second.revisionId);assert.equal(await fs.readFile(source,'utf8'),'BLENDER-v500original');
  await assert.rejects(runEditorOperation({projectDir:dir,operation:'audit',expectedRevisionId:first.revisionId,fetchImpl:mockCompanion}),/base revision/);
  await rollbackEditor({projectDir:dir,revisionId:first.revisionId,expectedRevisionId:second.revisionId});
  assert.equal((await loadProjectState(dir)).state.editor.activeRevisionId,first.revisionId);
  assert.equal((await editorContent(dir,first.revisionId)).mime,'model/gltf-binary');
  const exported=await runEditorOperation({projectDir:dir,operation:'export_vrm',expectedRevisionId:first.revisionId,fetchImpl:mockCompanion});
  assert.ok((await loadProjectState(dir)).state.vrmMetadata.exportedVrmPath?.endsWith('avatar.vrm'));
  await rollbackEditor({projectDir:dir,revisionId:first.revisionId,expectedRevisionId:exported.revisionId});
  const r=(await loadProjectState(dir)).state.editor.revisions[0];await fs.appendFile(path.join(dir,r.artifacts.blend.filePath),'tampered');
  await assert.rejects(rollbackEditor({projectDir:dir,revisionId:first.revisionId}),/changed on disk/);
});
test('P2 failed Blender edit never activates a new revision',async t=>{
  const dir=await tempProject(t),source=path.join(dir,'source.blend');await fs.writeFile(source,'BLENDER-v500source');
  const fetchImpl=async(url,init)=>url.endsWith('/headless')?Response.json({ok:true,exitCode:1}):mockCompanion(url,init);
  await assert.rejects(runEditorOperation({projectDir:dir,operation:'import_blend',params:{sourceBlend:source},fetchImpl}),/process failed/);
  assert.equal((await loadProjectState(dir)).state.editor?.activeRevisionId,undefined);
  const promotedFetch=async(url,init)=>{
    if(url.endsWith('/headless'))return Response.json({ok:true,kind:'promoted',jobId:'ed-job-1'});
    if(url.endsWith('/job'))return Response.json({ok:true,status:'completed',result:{exitCode:0,resultJson:{verdict:'fail',error:'bad output'}}});
    return mockCompanion(url,init);
  };
  const queued=await runEditorOperation({projectDir:dir,operation:'import_blend',params:{sourceBlend:source},fetchImpl:promotedFetch});
  assert.equal(queued.pending,true);
  await assert.rejects(collectEditorJob({projectDir:dir,fetchImpl:promotedFetch}),/bad output|does not match/);
  assert.equal((await loadProjectState(dir)).state.editor.pendingJob,null,'collectEditorJob clears pendingJob on finalize failure');
});
test('P2 AI request binds selected objects, camera and revision rather than executing free text',async t=>{
  const dir=await tempProject(t),source=path.join(dir,'source.blend');await fs.writeFile(source,'BLENDER-v500source');
  const base=await runEditorOperation({projectDir:dir,operation:'import_blend',params:{sourceBlend:source},fetchImpl:mockCompanion});
  const out=await createAiEditRequest({projectDir:dir,prompt:'Make the head 5% smaller',objects:['Head'],camera:'left',expectedRevisionId:base.revisionId});
  assert.equal(out.request.baseRevisionId,base.revisionId);assert.equal(out.request.status,'requested');
  await assert.rejects(createAiEditRequest({projectDir:dir,prompt:'edit',objects:['unknown'],expectedRevisionId:base.revisionId}),/unknown objects/);
  await setEditorView({projectDir:dir,camera:'right',overlayOpacity:.5});assert.equal((await loadProjectState(dir)).state.editor.view.camera,'right');
});
test('Editor AI handoff is bound to a fingerprinted base and requires a separate visual review', async t => {
  const dir = await tempProject(t), source = path.join(dir,'source.blend');
  await fs.writeFile(source,'BLENDER-v500source');
  const run = opts => runEditorOperation({ projectDir:dir, fetchImpl:mockCompanion, ...opts });
  const base = await run({ operation:'import_blend', params:{sourceBlend:source} });
  const {request} = await createAiEditRequest({ projectDir:dir, prompt:'Shift head', objects:['Head'], expectedRevisionId:base.revisionId });
  const body = { operation:'transform', params:{objects:['Head'],translation:[.1,0,0]}, editRequestId:request.id };
  const handoff = await prepareAiEditHandoff({ projectDir:dir, requestId:request.id });
  assert.match(handoff.instruction, /charakuru_blender_avatar/);
  assert.ok(handoff.instruction.includes(request.id));
  await assert.rejects(run(body),/base revision/);
  await assert.rejects(run({...body,expectedRevisionId:base.revisionId,editRequestId:'missing'}),/not found/);
  await assert.rejects(run({...body,operation:'import_blend',expectedRevisionId:base.revisionId}),/editing operation/);
  const revision = await run({...body,expectedRevisionId:base.revisionId});
  assert.equal(revision.editRequestId,request.id);
  assert.equal(revision.editor.requests[0].status,'ready_for_review');
  assert.equal(revision.editor.requests[0].resultRevisionId,revision.revisionId);
  await assert.rejects(reviewAiEditRequest({projectDir:dir,requestId:request.id,revisionId:base.revisionId,decision:'approve'}),/base revision/);
  const approved = await reviewAiEditRequest({projectDir:dir,requestId:request.id,revisionId:revision.revisionId,decision:'approve'});
  assert.equal(approved.request.status,'approved');
  assert.equal(approved.activeRevisionId,revision.revisionId);
  await assert.rejects(run({...body,expectedRevisionId:revision.revisionId}),/already been processed/);
  const next = await createAiEditRequest({projectDir:dir,prompt:'Change again',expectedRevisionId:revision.revisionId});
  const later = await run({...body,editRequestId:next.request.id,expectedRevisionId:revision.revisionId});
  const rejected = await reviewAiEditRequest({projectDir:dir,requestId:next.request.id,revisionId:later.revisionId,decision:'reject'});
  assert.equal(rejected.request.status,'rejected');
  assert.equal(rejected.activeRevisionId,revision.revisionId);
  assert.ok((await loadProjectState(dir)).state.editor.revisions.some(old => old.id===later.revisionId));
  assert.equal(await fs.readFile(source,'utf8'),'BLENDER-v500source');
});

test('the editor adopts only a verified current project Blender checkpoint into a new revision', async t => {
  const dir = await tempProject(t), source = path.join(dir,'assembled.blend');
  await initOrUpdateProject(dir);
  await assert.rejects(runEditorOperation({projectDir:dir,operation:'import_checkpoint',fetchImpl:mockCompanion}),/No current/);
  await fs.writeFile(source,'BLENDER-v500assembly');
  await updateProjectState(dir, state => {
    state.blenderState.activeBlendFile = source;
    state.blenderState.lastRun = { operation:'stage2_assembly_ratio', artifacts:[{
      path:source,sha256:hash('BLENDER-v500assembly'),validation:'blend_container_only',
    }] };
  });
  const adopted = await runEditorOperation({projectDir:dir,operation:'import_checkpoint',expectedRevisionId:null,fetchImpl:mockCompanion});
  assert.equal(adopted.editor.revisions[0].operation,'import_checkpoint');
  assert.equal(await fs.readFile(source,'utf8'),'BLENDER-v500assembly');
  await fs.appendFile(source,'changed');
  await assert.rejects(runEditorOperation({projectDir:dir,operation:'import_checkpoint',expectedRevisionId:adopted.revisionId,fetchImpl:mockCompanion}),/changed on disk/);
});
test('P4 account holds are shared across projects and concurrent reservation cannot overspend',async t=>{
  const dir=await tempProject(t),ledger=createAccountBudget(dir);await ledger.configure({accountId:'test-account',channel:'tripo_studio',period:'2026-11',limit:10});
  const attempts=await Promise.allSettled(Array.from({length:8},(_,i)=>ledger.reserve({accountId:'test-account',requestId:'request_'+i,fingerprint:hash('input'+i),quotedCost:3,quoteExpiresAt:new Date(Date.now()+60000).toISOString(),projectId:'project-'+i})));
  assert.equal(attempts.filter(x=>x.status==='fulfilled').length,3);assert.equal((await ledger.status('test-account')).held,9);
});
test('P4 request IDs, uncertain billing, cancellation and settlement are conservative and idempotent',async t=>{
  const dir=await tempProject(t),ledger=createAccountBudget(dir),accountId='test-account',requestId='request_1';await ledger.configure({accountId,channel:'tripo_api',period:'2026-11',limit:20});
  const args={accountId,requestId,fingerprint:hash('input'),quotedCost:10,quoteExpiresAt:new Date(Date.now()+60000).toISOString()};
  await ledger.reserve(args);assert.equal((await ledger.reserve(args)).duplicate,true);
  await assert.rejects(ledger.reserve({...args,fingerprint:hash('different')}),/conflicts/);
  await ledger.transition({accountId,requestId,action:'submit'});await ledger.transition({accountId,requestId,action:'uncertain'});
  await assert.rejects(ledger.transition({accountId,requestId,action:'cancel'}),/not proof/);
  await assert.rejects(ledger.configure({accountId,channel:'tripo_api',period:'2026-12',limit:20}),/Unresolved/);
  await ledger.transition({accountId,requestId,action:'settle',actualCost:8,providerTaskId:'task-known'});
  assert.equal((await ledger.transition({accountId,requestId,action:'settle',actualCost:8,providerTaskId:'task-known'})).duplicate,true);
  assert.equal((await ledger.status(accountId)).spent,8);assert.equal((await ledger.status(accountId)).held,0);
});
test('P4 expires quotes and never mixes Studio versus API balances',async t=>{
  const dir=await tempProject(t),l=createAccountBudget(dir),accountId='fixture';await l.configure({accountId,channel:'tripo_studio',period:'2026-11',limit:0});
  await assert.rejects(l.configure({accountId,channel:'tripo_api',period:'2026-11',limit:30}),/separate aliases/);
  await assert.rejects(l.reserve({accountId,requestId:'request_expired',fingerprint:hash('x'),quotedCost:0,quoteExpiresAt:'2020-01-01'}),/expired/);
});
test('P4 duplicate image request returns receipt without another provider call',async t=>{
  const dir=await tempProject(t);await initOrUpdateProject(dir);let calls=0;
  const args={projectDir:dir,requestId:'fixture-image-001',mode:'execute',slots:['head_front'],fetchImpl:async()=>{calls++;return Response.json({data:[{b64_json:png().toString('base64')}]});}};
  await runTurnaroundGeneration(args);const second=await runTurnaroundGeneration(args);assert.equal(second.duplicate,true);assert.equal(calls,1);
  await assert.rejects(runTurnaroundGeneration({...args,slots:['head_back']}),/different inputs/);
});
test('P4 zero-spend default blocks cloud and masquerading remote local endpoints',async t=>{
  const dir=await tempProject(t);await initOrUpdateProject(dir);let calls=0;const fetchImpl=async()=>{calls++;throw Error('must not send');};
  await assert.rejects(runTurnaroundGeneration({projectDir:dir,mode:'execute',modelId:'seedream-5.5',apiModelOverride:'fixture-valid-model',slots:['head_front'],fetchImpl}),/CLOUD_EXECUTION_DISABLED/);
  await assert.rejects(runTurnaroundGeneration({projectDir:dir,mode:'execute',endpoints:{qwenImageUrl:'https://cloud.invalid'},fetchImpl}),/loopback/);assert.equal(calls,0);
});
test('P4 injected offline, 429 and insufficient-balance responses do not automatically resubmit a request',async t=>{
  for(const failure of ['offline',429,402]){
    const dir=await tempProject(t);await initOrUpdateProject(dir);let calls=0;
    const args={projectDir:dir,requestId:'fault-fixture-'+failure,mode:'execute',slots:['head_front'],fetchImpl:async()=>{calls++;if(failure==='offline')throw Error('offline fixture');return new Response('fixture failure',{status:failure});}};
    const first=await runTurnaroundGeneration(args);assert.notEqual(first.verdict,'pass');
    const second=await runTurnaroundGeneration(args);assert.equal(second.duplicate,true);assert.equal(calls,1);
    assert.equal((await loadProjectState(dir)).state.imageRequests[args.requestId].status,'needs_reconciliation');
  }
});
test('P3 explicit weight source and distance bound are mandatory',()=>{
  assert.throws(()=>validateEditorParams('transfer_weights',{objects:['Outfit']}),/explicit source/);
  assert.equal(validateEditorParams('transfer_weights',{objects:['Outfit'],sourceMesh:'Body',maxTransferDistance:.2}).sourceMesh,'Body');
});
