import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tempProject,png,triangleGlb} from './fixtures.mjs';
import {initOrUpdateProject,loadProjectState} from '../lib/project/state.js';
import {setWorkflowMode,selectFoundation,planTripoParts,revisionFromSelectedBody} from '../lib/project/workflow.js';
import {importProjectMaterial} from '../lib/project/materials.js';
import {rollbackEditor,runEditorOperation,validateEditorParams,createAiEditRequest,inspectAiEdit,reviewAiEditRequest} from '../lib/project/editor.js';
import {validateRenderRecipe,createRenderRequest,getRenderRequest,runRender,reviewRender,renderContent,settleRender} from '../lib/project/render.js';
import {startStudioHttpServer} from '../lib/host/server.js';
import {buildStudioTools} from '../lib/tools/register-all.js';

const base='http://127.0.0.1:9877';
const blend=Buffer.from('BLENDER-v500tiny-procedural-fixture');
const current=async dir=>(await loadProjectState(dir)).state;
const rev=async dir=>(await current(dir)).stateRevision;
const editId=async dir=>(await current(dir)).editor?.activeRevisionId||null;
const mime=kind=>({foundation_body:'.blend',foundation_head:'.blend',assembly_scene:'.blend',tripo_clothing:'.glb',tripo_hair:'.glb',tripo_accessory:'.glb'})[kind];
async function material(dir,role) {
  const extension=mime(role),file=path.join(dir,'input-'+role+extension);
  await fs.writeFile(file,extension==='.blend'?blend:triangleGlb());
  return (await importProjectMaterial({projectDir:dir,stageId:'4_assembly',role,sourcePath:file,expectedRevision:await rev(dir)})).material;
}
async function adopt(dir,part,materialId) {return selectFoundation({projectDir:dir,part,materialId,expectedRevision:await rev(dir)});}
async function setMode(dir,mode) {return setWorkflowMode({projectDir:dir,mode,expectedRevision:await rev(dir)});}

const legacyHealth={ok:true,stats:{},lease:{},provenance:{}};
function companion({gateway=false,waitOnce=false,wrongReport=false,transportError=false}={}) {
  const sent=[]; let queued=null,collected=0;
  async function execute(scriptFile) {
    const command=JSON.parse(JSON.parse((await fs.readFile(scriptFile,'utf8')).split('\n')[0].slice('COMMAND = '.length)));
    sent.push(command);
    if(command.reportPath){
      await fs.writeFile(command.reportPath,JSON.stringify({requestId:command.requestId,donorSha256:command.donorSha256,meshes:[{name:'Face',vertices:8,shapes:2,dimensions:[.2,.14,.15]}]}));
      return {verdict:'pass',requestId:command.requestId};
    }
    if (command.operation) {
      const C=command;
      await Promise.all([fs.writeFile(C.outputs.blend,blend),fs.writeFile(C.outputs.preview,triangleGlb()),fs.writeFile(C.outputs.report,JSON.stringify({requestId:C.requestId,objects:[{name:'Base',type:'MESH',vertices:160,dimensions:[.57,.28,1.5],shapeKeys:[{name:'Chest',value:0}]},{name:'Rig',type:'ARMATURE',bones:['Head','Neck']}],gates:{},materialInput:C.material?{id:C.material.id,sha256:C.material.sha256}:null}))]);
      return {verdict:'pass',requestId:C.requestId,outputs:C.outputs};
    }
    await fs.writeFile(path.join(command.output,'render.png'),png(...command.pixels));
    const {requestId,revisionId,blendHash,recipe}=command;
    await fs.writeFile(path.join(command.output,'report.json'),JSON.stringify({requestId,revisionId,blendHash:wrongReport?'wrong':blendHash,recipe,blenderVersion:'Fixture 5.3',engine:'BLENDER_EEVEE',meshes:1,toonMaterials:1,notes:[]}));
    return {verdict:'pass',requestId};
  }
  async function fetchImpl(url,options) {
    const route=new URL(url).pathname;
    if (route==='/health') return Response.json(gateway?{ok:true,gateway:{hostId:'unit-host'}}:legacyHealth);
    if (route==='/doctor') return Response.json({kind:'ok'});
    const b=JSON.parse(options.body);
    if (route==='/headless') {
      if (transportError) { sent.push('unknown'); throw new Error('transport dropped after submit'); }
      return Response.json({ok:true,result:{exitCode:0,resultJson:await execute(b.scriptFile)}});
    }
    assert.equal(route,'/job'); assert.equal(options.headers['x-dsh-host-id'],'unit-host');
    if (b.op==='submit') {queued=await execute(b.script_file);return Response.json({job:{id:'queued-1'}});}
    if (b.op==='cancel') return Response.json({ok:true});
    if (waitOnce && collected++===0) return Response.json({job:{state:'running'}});
    return Response.json({job:{state:'completed',result:{exitCode:0,parsed:queued}}});
  }
  return {fetchImpl,sent};
}
async function importLocal(dir,fetchImpl,materialId) {
  await fs.writeFile(path.join(dir,'source.blend'),blend);
  const op=materialId?{operation:'import_material_scene',params:{materialId}}:{operation:'import_blend',params:{sourceBlend:path.join(dir,'source.blend')}};
  return runEditorOperation({projectDir:dir,expectedRevisionId:await editId(dir),blenderPluginUrl:base,fetchImpl,...op});
}

test('routes persist separately; foundation adoption is role/epoch bound, and private part plans do not submit or touch the ledger',async t=>{
  const dir=await tempProject(t);await initOrUpdateProject(dir,{monthlyCreditAllowance:50});
  const first=await current(dir);assert.equal(first.workflow.mode,'illustration');
  const body=await material(dir,'foundation_body'),head=await material(dir,'foundation_head');
  await assert.rejects(()=>adopt(dir,'body',body.id),/Switch/);
  await assert.rejects(()=>setWorkflowMode({projectDir:dir,mode:'base_mesh',expectedRevision:first.stateRevision}),/revision changed/);
  await setMode(dir,'base_mesh');await assert.rejects(()=>adopt(dir,'head','embedded'),/Adopt the source body/);
  await assert.rejects(()=>adopt(dir,'body',head.id),/purpose|role|usage|this operation/i);
  await adopt(dir,'body',body.id);await adopt(dir,'head','embedded');
  assert.equal((await current(dir)).editor,undefined); // selecting does not open Blender
  const a=await planTripoParts({projectDir:dir,kinds:['clothing','hair','accessory'],budget:32,quotedCredits:33});
  assert.equal(a.cap,32);assert.equal(a.withinManualCap,false);assert.equal(a.submissions,0);assert.equal(a.ledgerWrites,0);assert.deepEqual(a.uploads,[]);
  assert.deepEqual(a.tasks.map(x=>x.role),['tripo_clothing','tripo_hair','tripo_accessory']);
  assert.ok(a.tasks.every(x=>x.returnFormat==='GLB'&&x.input==='user_prepared_isolated_part_only'));
  assert.doesNotMatch(JSON.stringify(a),/materials\/|\.blend|\.fbx/i);
  await assert.rejects(()=>planTripoParts({projectDir:dir,kinds:['body'],budget:1}),/Choose clothing/);
  await setMode(dir,'illustration');const after=await current(dir);
  assert.deepEqual(after.stages,first.stages);assert.deepEqual(after.tripoQuota,first.tripoQuota);assert.deepEqual(after.workflow.foundation,{body:body.id,head:'embedded'});
});

test('the base branch verifies adopted Blend inputs and roots; fitting and external parts create separate revisions',async t=>{
  const dir=await tempProject(t);await initOrUpdateProject(dir);
  const body=await material(dir,'foundation_body'),head=await material(dir,'foundation_head'),part=await material(dir,'tripo_clothing'),{fetchImpl,sent}=companion();
  await assert.rejects(()=>importLocal(dir,fetchImpl,body.id),/adopt/);
  await setMode(dir,'base_mesh');await adopt(dir,'body',body.id);await adopt(dir,'head',head.id);
  const opened=await importLocal(dir,fetchImpl,body.id);
  const run=(operation,params,expectedRevisionId=opened.revisionId)=>runEditorOperation({projectDir:dir,operation,params,expectedRevisionId,blenderPluginUrl:base,fetchImpl});
  const fit=await run('fit_foundation',{bodyObject:'Base',scale:[1,1,1.07],shapeValues:[{key:'Chest',value:.5}]});
  assert.equal(fit.editor.revisions.at(-1).parentId,opened.revisionId);assert.equal(revisionFromSelectedBody(await current(dir),fit.revisionId),true);
  const graft=await run('append_foundation_head',{materialId:head.id,objects:['Face','Eyes'],headBone:'Head',replaceHeadObjects:['OldFace']},fit.revisionId);
  assert.equal(graft.editor.revisions.at(-1).materialInput.id,head.id);
  const appended=await run('append_material_mesh',{materialId:part.id},graft.revisionId);
  assert.equal(appended.editor.revisions.at(-1).materialInput.role,'tripo_clothing');assert.equal(sent.length,4);
  await setMode(dir,'illustration');await assert.rejects(()=>run('append_material_mesh',{materialId:part.id},appended.revisionId),/adopted body/);
  await setMode(dir,'base_mesh');const unrelated=await importLocal(dir,fetchImpl);
  assert.equal(revisionFromSelectedBody(await current(dir),unrelated.revisionId),false);
  await assert.rejects(()=>run('fit_foundation',{bodyObject:'Base'},unrelated.revisionId),/adopted body/);
  assert.throws(()=>validateEditorParams('fit_foundation',{bodyObject:'x',scale:[.01,1,1]}),/0.75/);
  assert.throws(()=>validateEditorParams('fit_foundation',{bodyObject:'x',shapeValues:[{key:'Chest',value:1.5}]}),/shape keys/);
  assert.throws(()=>validateEditorParams('append_foundation_head',{materialId:head.id,objects:['face'],headBone:'Head',sourceBlend:'/outside.blend'}),/registered material/);
});

test('independent render uses a verified immutable revision, local recipe and separate human approval',async t=>{
  const dir=await tempProject(t);await initOrUpdateProject(dir);const {fetchImpl,sent}=companion();
  const edit=await importLocal(dir,fetchImpl);const before=await current(dir);
  const args={projectDir:dir,expectedRevisionId:edit.revisionId,blenderPluginUrl:base,fetchImpl};
  assert.throws(()=>validateRenderRecipe({python:'print(1)'}),/bounded/);
  assert.throws(()=>validateRenderRecipe({style:'not allowed'}),/bounded/);
  assert.throws(()=>validateRenderRecipe({exposure:8}),/out of range/);
  const {request,instruction}=await createRenderRequest({...args,brief:'A quiet cool rim',recipe:{preset:'cool_room',framing:'portrait'}});
  assert.match(instruction,/charakuru_render/);assert.match(instruction,new RegExp(edit.revisionId));
  assert.equal((await getRenderRequest({projectDir:dir,requestId:request.id})).request.status,'requested');
  await assert.rejects(()=>reviewRender({...args,requestId:request.id,decision:'approve'}),/not awaiting/);
  const chosen=await runRender({...args,requestId:request.id,recipe:{fill:1,exposure:.2}});
  assert.equal(chosen.request.status,'ready_for_review');assert.equal(chosen.request.recipe.framing,'portrait');assert.equal(chosen.request.recipe.fill,1);assert.equal(sent.at(-1).blendHash,request.blendHash);
  assert.equal(sent.length,2);await assert.rejects(()=>runRender({...args,requestId:request.id}),/duplicate/);
  const image=await renderContent(dir,request.id);assert.equal(image.mime,'image/png');assert.deepEqual(image.bytes,png(640,800));
  const reviewed=await reviewRender({...args,requestId:request.id,decision:'approve',note:'Human review only'});assert.equal(reviewed.request.status,'approved');
  const after=await current(dir);assert.deepEqual(after.editor,before.editor);assert.deepEqual(after.stages,before.stages);assert.deepEqual(after.tripoQuota,before.tripoQuota);
  const tool=buildStudioTools().find(x=>x.name==='charakuru_render');await assert.rejects(()=>tool.execute({action:'approve',projectDir:dir,requestId:request.id}),/allowed alternatives/);
  await fs.appendFile(path.join(dir,reviewed.request.artifacts.png.filePath),Buffer.from([0]));
  await assert.rejects(()=>renderContent(dir,request.id),/artifact changed/i);
});

test('stale, tampered, mismatched and uncertain renders fail closed and never rerun a submitted request',async t=>{
  const dir=await tempProject(t);await initOrUpdateProject(dir);const good=companion(),old=await importLocal(dir,good.fetchImpl);
  const a=await createRenderRequest({projectDir:dir,brief:'old base',expectedRevisionId:old.revisionId});
  const newer=await importLocal(dir,good.fetchImpl);const opts={projectDir:dir,expectedRevisionId:newer.revisionId,blenderPluginUrl:base};
  await assert.rejects(()=>runRender({...opts,requestId:a.request.id,fetchImpl:good.fetchImpl}),/revision changed/);
  await assert.rejects(()=>getRenderRequest({projectDir:dir,requestId:a.request.id,forHandoff:true}),/revision changed/);
  const bad=companion({wrongReport:true}),asyncFail=companion({transportError:true});
  for(const [mock,error] of [[bad,/not agree/],[asyncFail,/transport dropped/]]) {
    const b=await createRenderRequest({...opts,brief:'review only'});
    await assert.rejects(()=>runRender({...opts,requestId:b.request.id,fetchImpl:mock.fetchImpl}),error);
    assert.equal((await getRenderRequest({projectDir:dir,requestId:b.request.id})).request.status,'failed');
    await assert.rejects(()=>renderContent(dir,b.request.id),/unavailable/);
    await assert.rejects(()=>runRender({...opts,requestId:b.request.id,fetchImpl:mock.fetchImpl}),/duplicate/);assert.equal(mock.sent.length,1);
  }
  const review=await createRenderRequest({...opts,brief:'awaiting review'});
  await runRender({...opts,requestId:review.request.id,fetchImpl:good.fetchImpl});
  await rollbackEditor({projectDir:dir,revisionId:old.revisionId,expectedRevisionId:newer.revisionId});
  await assert.rejects(()=>reviewRender({...opts,requestId:review.request.id,decision:'reject'}),/revision changed/);
  assert.equal((await renderContent(dir,review.request.id)).mime,'image/png');
  const oldFile=old.editor.revisions.at(-1).artifacts.blend.filePath;
  await fs.appendFile(path.resolve(dir,oldFile),'changed');
  await assert.rejects(()=>createRenderRequest({projectDir:dir,brief:'tampered',expectedRevisionId:old.revisionId}),/changed on disk/);
});

test('render Gateway submits and collects with only the real recorded caller; localhost PNG needs a session',async t=>{
  const dir=await tempProject(t);await initOrUpdateProject(dir);const edit=await importLocal(dir,companion().fetchImpl);
  const {fetchImpl,sent}=companion({gateway:true,waitOnce:true});const caller={hostId:'unit-host',dshSessionId:'test-session',agentId:'agent',role:'main'};
  const {request}=await createRenderRequest({projectDir:dir,brief:'queue',expectedRevisionId:edit.revisionId});
  const opts={projectDir:dir,requestId:request.id,expectedRevisionId:edit.revisionId,blenderPluginUrl:base,fetchImpl};
  await assert.rejects(()=>runRender(opts),/GATEWAY_CALLER_REQUIRED/);assert.equal(sent.length,0);
  assert.equal((await runRender({...opts,caller})).status,'queued');assert.equal(sent.length,1);
  await assert.rejects(()=>settleRender({...opts,caller:{...caller,agentId:'other'}}),/submitting DSH caller/);
  assert.equal((await settleRender({...opts,caller})).status,'queued');
  assert.equal((await settleRender({...opts,caller})).request.status,'ready_for_review');
  const server=await startStudioHttpServer({port:0,config:{registryFile:path.join(dir,'recent.json'),budgetDir:path.join(dir,'budget')}});t.after(()=>server.close());
  const origin=`http://127.0.0.1:${server.port}`,q=new URLSearchParams({projectDir:dir,requestId:request.id});
  assert.equal((await fetch(origin+'/studio/render/content?'+q)).status,403);
  const session=await (await fetch(origin+'/studio/session')).json();q.set('access',session.sessionToken);
  const desktop=await fetch(origin+'/studio/render/content?'+q,{headers:{Origin:'dsh-app://app'}});
  assert.equal(desktop.status,200);assert.equal(desktop.headers.get('content-type'),'image/png');assert.equal(desktop.headers.get('access-control-allow-origin'),'dsh-app://app');
  const foreign=await fetch(origin+'/studio/render/content?'+q,{headers:{Origin:'https://example.net'}});assert.equal(foreign.status,403);
});


test('AI foundation proportion and donor requests inspect immutable inputs, enforce scope and return for review', async t=>{
  const dir=await tempProject(t);await initOrUpdateProject(dir);const {fetchImpl,sent}=companion();
  const body=await material(dir,'foundation_body'), donor=await material(dir,'foundation_head');
  await setMode(dir,'base_mesh');await adopt(dir,'body',body.id);await adopt(dir,'head',donor.id);
  const opened=await importLocal(dir,fetchImpl,body.id);
  const common={projectDir:dir,blenderPluginUrl:base,fetchImpl,expectedRevisionId:opened.revisionId};
  const fit=await createAiEditRequest({...common,intent:'foundation_fit',prompt:'Make the body slightly taller; retain topology and the rig.'});
  assert.match(fit.instruction,/editor_inspect/);assert.match(fit.instruction,/不要让用户代填/);
  const tool=buildStudioTools({config:{blenderPluginUrl:base}}).find(x=>x.name==='charakuru_blender_avatar');
  const summary=await tool.execute({action:'editor_inspect',projectDir:dir,editRequestId:fit.request.id});assert.equal(summary.ok,true);
  assert.deepEqual(summary.allowed,['fit_foundation']);assert.equal(summary.inventory[0].shapeKeys[0].name,'Chest');
  await assert.rejects(runEditorOperation({...common,editRequestId:fit.request.id,operation:'transform',params:{objects:['Base']}}),/outside/);
  const out=await runEditorOperation({...common,editRequestId:fit.request.id,operation:'fit_foundation',params:{bodyObject:'Base',armature:'Rig',scale:[1,1,1.04]}});
  const after=await current(dir);
  assert.equal(after.editor.requests.find(r=>r.id===fit.request.id).status,'ready_for_review');
  await assert.rejects(createAiEditRequest({...common,expectedRevisionId:out.revisionId,prompt:'Another edit'}),/Approve or reject/);
  assert.equal((await reviewAiEditRequest({...common,requestId:fit.request.id,revisionId:out.revisionId,decision:'reject'})).activeRevisionId,opened.revisionId);
  const head=await createAiEditRequest({...common,intent:'foundation_head',prompt:'Pare down to the donor face if the proportions fit.'});
  const params={materialId:donor.id,objects:['Face'],headBone:'Head'};
  await assert.rejects(runEditorOperation({...common,editRequestId:head.request.id,operation:'append_foundation_head',params}),/editor_inspect/);
  const view=await inspectAiEdit({...common,requestId:head.request.id});assert.equal(view.donor.meshes[0].name,'Face');
  assert.equal(await editId(dir),opened.revisionId,'inspection does not create or activate a modeling revision');
  await assert.rejects(runEditorOperation({...common,editRequestId:head.request.id,operation:'append_foundation_head',params:{...params,objects:['Guess']}}),/named donor/);
  const graft=await runEditorOperation({...common,editRequestId:head.request.id,operation:'append_foundation_head',params});
  const reviewed=await reviewAiEditRequest({...common,requestId:head.request.id,revisionId:graft.revisionId,decision:'approve'});
  assert.equal(reviewed.request.status,'approved');assert.equal(reviewed.activeRevisionId,graft.revisionId);
  assert.equal(sent.length,4);
});

test('0.6.1 HTTP render request defers artistic choices to the agent; human direct execution and incomplete recipes cannot run',async t=>{
  const dir=await tempProject(t);await initOrUpdateProject(dir);const {fetchImpl,sent}=companion();
  const edit=await importLocal(dir,fetchImpl),baseState=await current(dir);
  const api=await startStudioHttpServer({port:0,config:{registryFile:path.join(dir,'recents.json')}});t.after(()=>api.close());
  const {sessionToken}=await (await fetch(api.baseUrl+'/studio/session')).json();
  const post=opts=>fetch(api.baseUrl+'/studio/render/request',{method:'POST',headers:{'Content-Type':'application/json','X-Charakuru-Session':sessionToken,Origin:'dsh-app://app'},body:JSON.stringify({projectDir:dir,brief:'Slight side angle, soft cyan rim, darker background',expectedRevisionId:edit.revisionId,...opts})});
  assert.equal((await post({recipe:{preset:'wine_stage'}})).status,400);
  const request=await (await post({})).json();assert.equal(request.request.suggestion,null);assert.equal(request.request.policy,'agent_recipe');assert.match(request.instruction,/可为 custom/);
  const args={projectDir:dir,requestId:request.request.id,expectedRevisionId:edit.revisionId,blenderPluginUrl:base,fetchImpl};
  const recipe={preset:'custom',camera:'profile',framing:'portrait',size:'draft',lighting:{backdrop:[.012,.04,.07],rimColor:[.35,.9,1],floor:false},rim:.75};
  await assert.rejects(runRender({...args,recipe,actor:'human'}),/DSH agent/);
  await assert.rejects(runRender({...args,recipe:{preset:'custom'}}),/DSH agent/);
  assert.throws(()=>validateRenderRecipe({...recipe,lighting:{rimColor:[2,1,1]}}),/0 to 1/);
  const pass=await runRender({...args,recipe});assert.equal(pass.request.status,'ready_for_review');
  assert.deepEqual(sent.at(-1).settings.rimColor,recipe.lighting.rimColor);assert.equal(sent.at(-1).settings.floor,false);
  assert.deepEqual((await current(dir)).editor,baseState.editor);
});
