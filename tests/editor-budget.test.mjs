import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { tempProject, png, triangleGlb } from './fixtures.mjs';
import { initOrUpdateProject,loadProjectState } from '../lib/project/state.js';
import { validateEditorParams,runEditorOperation,rollbackEditor,createAiEditRequest,setEditorView,editorContent } from '../lib/project/editor.js';
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
  return Response.json({ok:true,exitCode:0,resultJson:{verdict:'pass',requestId:command.requestId,outputs:command.outputs}});
};
test('P2 structured editor rejects arbitrary Python and unbounded transforms',()=>{
  assert.throws(()=>validateEditorParams('python',{code:'print(1)'}),/Unknown/);
  assert.throws(()=>validateEditorParams('head_scale',{factor:4}),/scale/);
  assert.throws(()=>validateEditorParams('transform',{objects:['Head'],translation:[NaN,0,0]}),/Transform/);
  assert.throws(()=>validateEditorParams('spring_setup',{hitRadius:99}),/coefficient/);
});
test('P2 editor creates immutable revisions and rollback verifies bytes',async t=>{
  const dir=await tempProject(t),source=path.join(dir,'original.blend');await fs.writeFile(source,'BLENDER-v500original');
  const first=await runEditorOperation({projectDir:dir,operation:'import_blend',params:{sourceBlend:source},fetchImpl:mockCompanion});
  const second=await runEditorOperation({projectDir:dir,operation:'head_scale',params:{factor:.9},expectedRevisionId:first.revisionId,fetchImpl:mockCompanion});
  assert.notEqual(first.revisionId,second.revisionId);assert.equal(await fs.readFile(source,'utf8'),'BLENDER-v500original');
  await assert.rejects(runEditorOperation({projectDir:dir,operation:'audit',expectedRevisionId:first.revisionId,fetchImpl:mockCompanion}),/base revision/);
  await rollbackEditor({projectDir:dir,revisionId:first.revisionId,expectedRevisionId:second.revisionId});
  assert.equal((await loadProjectState(dir)).state.editor.activeRevisionId,first.revisionId);
  assert.equal((await editorContent(dir,first.revisionId)).mime,'model/gltf-binary');
  const r=(await loadProjectState(dir)).state.editor.revisions[0];await fs.appendFile(path.join(dir,r.artifacts.blend.filePath),'tampered');
  await assert.rejects(rollbackEditor({projectDir:dir,revisionId:first.revisionId}),/changed on disk/);
});
test('P2 failed Blender edit never activates a new revision',async t=>{
  const dir=await tempProject(t),source=path.join(dir,'source.blend');await fs.writeFile(source,'BLENDER-v500source');
  const fetchImpl=async(url,init)=>url.endsWith('/headless')?Response.json({ok:true,exitCode:1}):mockCompanion(url,init);
  await assert.rejects(runEditorOperation({projectDir:dir,operation:'import_blend',params:{sourceBlend:source},fetchImpl}),/process failed/);
  assert.equal((await loadProjectState(dir)).state.editor?.activeRevisionId,undefined);
});
test('P2 AI request binds selected objects, camera and revision rather than executing free text',async t=>{
  const dir=await tempProject(t),source=path.join(dir,'source.blend');await fs.writeFile(source,'BLENDER-v500source');
  const base=await runEditorOperation({projectDir:dir,operation:'import_blend',params:{sourceBlend:source},fetchImpl:mockCompanion});
  const out=await createAiEditRequest({projectDir:dir,prompt:'Make the head 5% smaller',objects:['Head'],camera:'left',expectedRevisionId:base.revisionId});
  assert.equal(out.request.baseRevisionId,base.revisionId);assert.equal(out.request.status,'requested');
  await assert.rejects(createAiEditRequest({projectDir:dir,prompt:'edit',objects:['unknown']}),/unknown objects/);
  await setEditorView({projectDir:dir,camera:'right',overlayOpacity:.5});assert.equal((await loadProjectState(dir)).state.editor.view.camera,'right');
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
