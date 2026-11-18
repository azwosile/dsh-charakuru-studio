import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tempProject, png, glb, triangleGlb, readyAssetProject } from './fixtures.mjs';
import { REQUIRED_VIEW_SLOTS } from '../lib/constants.js';
import { initOrUpdateProject, loadProjectState, transitionStageCheckpoint } from '../lib/project/state.js';
import { importStudioAsset, selectStudioAsset, scanGeneratedViews, getAssetContent, inspectGlb } from '../lib/project/assets.js';
import { collectReviewEvidence } from '../lib/project/reviews.js';
import { imagePreflight } from '../lib/providers/capabilities.js';
import { detectCompanion, executeCompanionStage, collectCompanionJob, callerFromExecution, parseBody, requestCompanion } from '../lib/blender/transport.js';
import { probeBlenderPluginLink, runBlenderAvatarStage, collectBlenderAvatarJob } from '../lib/blender/bridge.js';
import { startStudioHttpServer } from '../lib/host/server.js';
import { createProjectRegistry } from '../lib/project/registry.js';
import { planTripoFreeQuotaRun } from '../lib/tripo/free-quota-scheduler.js';
const caller = { hostId:'fixture-host', dshSessionId:'fixture-session', agentId:'fixture-agent', role:'main' };
const gateway = { linked:true, baseUrl:'http://127.0.0.1:39877', protocol:'gateway-3.1', health:{ok:true,gateway:{hostId:caller.hostId}}, guiReady:true };
const approve = async dir => { await transitionStageCheckpoint(dir,{action:'request_review'}); return transitionStageCheckpoint(dir,{action:'approve',actor:'user'}); };
const image = (dir, slotId='head_front') => importStudioAsset({projectDir:dir,slotId,dataBase64:png().toString('base64')});

test('P0 preflight blocks unsupported reference editing before any network side effects', () => {
  for(const modelId of ['qwen-image-2.1-local','comfyui-anima-local','seedream-5.5','novelai-v5-cloud']) assert.equal(imagePreflight({modelId,apiModelOverride:'fixture-v5',hasReference:true}).allowed,false);
  assert.equal(imagePreflight({modelId:'novelai-v45-reference',apiModelOverride:'nai-diffusion-4-5-full',hasReference:true,slots:['head_front']}).allowed,true);
  assert.equal(imagePreflight({hasReference:true,mode:'plan_and_export_workflows'}).allowed,true);
  assert.equal(imagePreflight({modelId:'unknown'}).allowed,false);
});

test('P0 protocol detection requires provenance, not port or a generic ok', async () => {
  await assert.rejects(detectCompanion(gateway.baseUrl,{fetchImpl:async()=>Response.json({ok:true})}),/Unknown companion/);
  const detected=await detectCompanion(gateway.baseUrl,{fetchImpl:async url=>Response.json(url.endsWith('health')?gateway.health:{ok:true,kind:'ok'})});
  assert.equal(detected.protocol,'gateway-3.1'); assert.equal(detected.guiReady,true);
  const conflict=await probeBlenderPluginLink({fetchImpl:async url=>Response.json(url.endsWith('health')?gateway.health:{ok:true,kind:'ok'})});
  assert.equal(conflict.protocol,'conflict');assert.equal(conflict.linked,false);
});

test('P0 Gateway never falls back to unauthenticated legacy act/headless', async () => {
  let calls=0; const fetchImpl=async()=>{calls++;return Response.json({ok:true});};
  await assert.rejects(executeCompanionStage({connection:gateway,scriptFile:'fixture.py',fetchImpl}),/CALLER_REQUIRED/);
  await assert.rejects(executeCompanionStage({connection:gateway,caller:{...caller,hostId:'other'},fetchImpl}),/another DSH host/);
  await assert.rejects(executeCompanionStage({connection:gateway,caller,executionTarget:'gui_act',fetchImpl}),/sessionId/);
  assert.equal(calls,0); assert.equal(callerFromExecution({}),null);
});

test('P0 Gateway queue submit/collect maps to actual upstream contract', async () => {
  const posted=[];
  const fetchImpl=async (url,init)=>{posted.push({url,body:JSON.parse(init.body),headers:init.headers});return Response.json({ok:true,job:{id:'job-fixture',state:'completed',result:{exitCode:0,parsed:{verdict:'degraded'}},logs:{stdout:'fixture'}}});};
  const receipt=await executeCompanionStage({connection:gateway,caller,scriptFile:'fixture.py',outdir:'renders',fetchImpl});
  assert.equal(receipt.jobId,'job-fixture'); assert.equal(posted[0].body.surface,'queue');assert.equal(posted[0].body.script_file,'fixture.py');assert.equal(posted[0].headers['x-dsh-host-id'],caller.hostId);
  const collected=await collectCompanionJob({...gateway,jobId:receipt.jobId,caller},{caller,fetchImpl});
  assert.equal(collected.pending,false);assert.equal(collected.receipt.resultJson.verdict,'degraded');assert.equal(posted[1].body.op,'collect');
  await assert.rejects(collectCompanionJob({...gateway,jobId:receipt.jobId,caller},{caller:{...caller,agentId:'foreign'},fetchImpl}),/submitting/);
});

test('P0 Gateway GUI preserves ownership headers and explicit py/session gate', async () => {
  await executeCompanionStage({connection:gateway,caller,executionTarget:'gui_act',sessionId:'blender-fixture',scriptFile:'script.py',fetchImpl:async(url,init)=>{
    const body=JSON.parse(init.body);assert.ok(url.endsWith('/act'));assert.equal(body.py,true);assert.equal(body.sessionId,'blender-fixture');assert.equal(body.file,'script.py');return Response.json({ok:true});
  }});
  assert.equal(parseBody('{"heartbeat":true}\n{"ok":true,"fixture":1}\n').fixture,1);
});

test('P0 read timeout remains active while streaming response body', async () => {
  await assert.rejects(requestCompanion(gateway.baseUrl,'/job',{op:'wait'},{timeoutMs:10,fetchImpl:async(_url,init)=>({ok:true,text:()=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('body-aborted'))))})}),/body-aborted/);
});

test('P1 imported PNGs have immutable fingerprints, slots and duplicate-safe versions', async t => {
  const dir=await tempProject(t);await initOrUpdateProject(dir);
  const first=await image(dir),second=await image(dir);
  assert.equal(first.asset.id,second.asset.id);assert.equal(second.projectState.assets.items.length,1);
  assert.match(first.asset.filePath,/^assets\/image\/[a-f0-9]{64}\.png$/);
  assert.equal(second.projectState.views.head_front.assetId,first.asset.id);
  assert.deepEqual((await getAssetContent(dir,first.asset.id)).bytes,png());
  await fs.writeFile(path.join(dir,first.asset.filePath),Buffer.from('tampered'));
  await assert.rejects(getAssetContent(dir,first.asset.id),/changed on disk/);
});

test('P1 realpath protects asset reads against project symlink escape', async t => {
  const dir=await tempProject(t),outside=await tempProject(t);await initOrUpdateProject(dir);
  const imported=await image(dir);await fs.writeFile(path.join(outside,'foreign.png'),png());
  await fs.rm(path.join(dir,imported.asset.filePath));
  try{await fs.symlink(path.join(outside,'foreign.png'),path.join(dir,imported.asset.filePath));}catch(e){if(['EPERM','EACCES'].includes(e.code)){t.skip('Windows symlink privilege unavailable');return;}throw e;}
  await assert.rejects(getAssetContent(dir,imported.asset.id),/inside the project/);
});

test('P1 PNG import refuses invalid bytes and stale project revisions', async t => {
  const dir=await tempProject(t);const init=await initOrUpdateProject(dir);
  await image(dir);
  await assert.rejects(importStudioAsset({projectDir:dir,slotId:'head_back',dataBase64:png().toString('base64'),expectedRevision:init.state.stateRevision}),/concurrently/);
  await assert.rejects(importStudioAsset({projectDir:dir,slotId:'head_front',dataBase64:Buffer.from('bad').toString('base64')}),/PNG/);
});

test('P1 all eleven slots required; image replacement invalidates review and downstream stages', async t => {
  const dir=await tempProject(t);await initOrUpdateProject(dir,{characterPrompt:'Fixture: text-only avatar'});await approve(dir);
  await assert.rejects(transitionStageCheckpoint(dir,{action:'request_review'}),/尚未登记/);
  for(const slot of REQUIRED_VIEW_SLOTS)await image(dir,slot.id);
  await approve(dir); assert.equal((await loadProjectState(dir)).state.activeStageId,'3_tripo');
  // Selecting a historical image is an explicit review-changing action.
  const state=(await loadProjectState(dir)).state;
  const plan = (await planTripoFreeQuotaRun({projectDir:dir})).studioWebPlaybook;
  assert.equal(plan.viewsApproved,true);
  assert.equal(plan.stages[0].inputFiles[0],path.join(dir,state.views.head_front.filePath));
  assert.equal(plan.stages[1].inputFiles.length,4);
  await selectStudioAsset({projectDir:dir,assetId:state.views.head_front.assetId});
  const pending = (await planTripoFreeQuotaRun({projectDir:dir})).studioWebPlaybook;
  assert.equal(pending.viewsApproved,false);assert.deepEqual(pending.stages[0].inputFiles,[]);
  assert.equal((await loadProjectState(dir)).state.activeStageId,'2_views');
  assert.equal((await loadProjectState(dir)).state.stages['3_tripo'].status,'pending');
});

test('P1 evidence detects on-disk mutation between request and approve', async t => {
  const dir=await tempProject(t);await initOrUpdateProject(dir,{characterPrompt:'Fixture: text-only avatar'});await approve(dir);
  for(const slot of REQUIRED_VIEW_SLOTS)await image(dir,slot.id);
  await transitionStageCheckpoint(dir,{action:'request_review'});
  const s=(await loadProjectState(dir)).state;await fs.writeFile(path.join(dir,s.views.head_front.filePath),'changed');
  await assert.rejects(transitionStageCheckpoint(dir,{action:'approve',actor:'user'}),/changed on disk/);
});

test('P1 source-image bytes are part of concept approval evidence', async t => {
  const dir=await tempProject(t);await initOrUpdateProject(dir);
  await assert.rejects(transitionStageCheckpoint(dir,{action:'request_review'}),/空白概念/);
  await fs.writeFile(path.join(dir,'reference.png'),png());await initOrUpdateProject(dir,{sourceImage:'reference.png'});
  await transitionStageCheckpoint(dir,{action:'request_review'});await fs.appendFile(path.join(dir,'reference.png'),'changed');
  await assert.rejects(transitionStageCheckpoint(dir,{action:'approve',actor:'user'}),/evidence changed/);
});

test('P1 candidates are not automatically selected and external resources cannot be previewed', async t => {
  const dir=await tempProject(t);await initOrUpdateProject(dir);
  assert.throws(()=>inspectGlb(glb({images:[{uri:'http://attacker/texture.png'}]})),/内嵌/);
  assert.equal(inspectGlb(glb()).renderable,false);assert.equal(inspectGlb(triangleGlb()).renderable,true);
  const a=await importStudioAsset({projectDir:dir,kind:'glb',part:'head',dataBase64:triangleGlb().toString('base64')});
  assert.equal(a.projectState.assets.selected.head,undefined);
  await selectStudioAsset({projectDir:dir,assetId:a.asset.id});
  assert.equal((await loadProjectState(dir)).state.assets.selected.head,a.asset.id);
  await assert.rejects(collectReviewEvidence(dir,(await loadProjectState(dir)).state,'3_tripo'),/body/);
  await assert.rejects(collectReviewEvidence(dir,(await loadProjectState(dir)).state,'4_assembly'),/P0\/P1/);
});

test('P1 offline generated views scan reports partial completion and registers actual bytes', async t => {
  const dir=await tempProject(t);await initOrUpdateProject(dir);await fs.writeFile(path.join(dir,'views/head/head_front.png'),png());
  const scan=await scanGeneratedViews({projectDir:dir});assert.equal(scan.imported.length,1);assert.equal(scan.missing.length,10);assert.equal(scan.verdict,'degraded');
});

test('P1 project registry reopens real projects without cross-project global state', async t => {
  const dir=await tempProject(t),a=path.join(dir,'a'),b=path.join(dir,'b');await initOrUpdateProject(a);await initOrUpdateProject(b);
  const registry=createProjectRegistry(path.join(dir,'recent.json'));await Promise.all([registry.remember(a),registry.remember(b)]);await registry.remember(a);
  assert.equal((await registry.list()).length,2);assert.equal((await registry.list())[0].projectDir,a);
});

test('desktop HTTP session token, exact allowed origin and asset-ID access', async t => {
  const dir=await tempProject(t);await initOrUpdateProject(dir);const a=await image(dir);
  const server=await startStudioHttpServer({port:0,config:{registryFile:path.join(dir,'recent.json'),allowedOrigins:['http://127.0.0.1:55555']}});t.after(()=>server.close());
  const token=(await(await fetch(server.baseUrl+'/studio/session')).json()).sessionToken;
  assert.equal((await fetch(server.baseUrl+'/studio/session',{headers:{Origin:'http://127.0.0.1:55556'}})).status,403);
  assert.equal((await fetch(server.baseUrl+'/studio/assets/import',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  const assetUrl=server.baseUrl+'/studio/assets/content?projectDir='+encodeURIComponent(dir)+'&id='+a.asset.id;
  assert.equal((await fetch(assetUrl)).status,403);
  const res=await fetch(assetUrl+'&access='+token);assert.equal(res.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await res.arrayBuffer()),png());
});

test('P0 queue integration prevents duplicate submits and requires fingerprinted artifacts on collect', async t => {
  const dir=await tempProject(t);await readyAssetProject(dir);const blend=path.join(dir,'queued.blend');
  const fetchImpl=async(url,init)=>{
    if(url.endsWith('/health'))return Response.json(gateway.health);
    if(url.endsWith('/doctor'))return Response.json({ok:true,kind:'ok'});
    const body=JSON.parse(init.body);
    return Response.json({ok:true,job:{id:'integration-job',state:body.op==='submit'?'queued':'completed',result:{exitCode:0,parsed:{verdict:'pass',savedBlend:blend,vrmAddonModule:'fixture'}},logs:{}}});
  };
  const result=await runBlenderAvatarStage({projectDir:dir,blenderPluginUrl:gateway.baseUrl,executeViaPlugin:true,caller,params:{outputBlendPath:blend},fetchImpl});
  assert.equal(result.verdict,'degraded');assert.equal((await loadProjectState(dir)).state.blenderState.activeBlendFile,null);
  await assert.rejects(runBlenderAvatarStage({projectDir:dir,executeViaPlugin:true,caller,fetchImpl}),/未收集/);
  await assert.rejects(collectBlenderAvatarJob({projectDir:dir,caller,fetchImpl}),/ENOENT/);
  await fs.writeFile(blend,'BLENDER-v500fixture');const collected=await collectBlenderAvatarJob({projectDir:dir,caller,fetchImpl});assert.equal(collected.artifacts.length,1);assert.equal((await loadProjectState(dir)).state.blenderState.pendingJob,null);
});

test('P1 model execution refuses unapproved inputs even when companion reports success', async t => {
  const dir=await tempProject(t);await initOrUpdateProject(dir);let posts=0;
  const out=await runBlenderAvatarStage({projectDir:dir,executeViaPlugin:true,blenderPluginUrl:gateway.baseUrl,caller,fetchImpl:async(url,init)=>{if(init.method==='POST')posts++;return Response.json(url.endsWith('health')?gateway.health:{ok:true,kind:'ok'});}});
  assert.equal(out.verdict,'fail');assert.equal(posts,0);assert.match(out.error,/上游/);
});

test('P1 legacy 0.1 approval migrates without deleting user files or trusting unsupported gates', async t => {
  const dir=await tempProject(t);await initOrUpdateProject(dir);const s=(await loadProjectState(dir)).state;delete s.assets;s.stages['1_concept'].status='completed';s.activeStageId='2_views';
  await fs.writeFile(path.join(dir,'project.charastudio.json'),JSON.stringify(s));const loaded=await loadProjectState(dir);
  assert.equal(loaded.state.activeStageId,'1_concept');assert.equal(loaded.state.stages['1_concept'].status,'in_progress');assert.ok(loaded.state.assets);
  assert.equal(JSON.parse(await fs.readFile(path.join(dir,'project.charastudio.json'))).assets,undefined,'read-only load does not overwrite legacy disk state');
});

test('Electron desktop exact dsh-app origin is supported without accepting opaque or foreign origins', async t => {
  const dir=await tempProject(t);const srv=await startStudioHttpServer({port:0,config:{registryFile:path.join(dir,'recent.json'),allowedOrigins:['dsh-app://app','http://127.0.0.1:55555']}});t.after(()=>srv.close());
  const r=await fetch(srv.baseUrl+'/health',{headers:{Origin:'dsh-app://app'}});assert.equal(r.status,200);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'dsh-app://app');
  for(const origin of ['null','dsh-app://evil','file://','https://evil.test'])assert.equal((await fetch(srv.baseUrl+'/health',{headers:{Origin:origin}})).status,403);
  const preflight=await fetch(srv.baseUrl+'/studio/assets/import',{method:'OPTIONS',headers:{Origin:'dsh-app://app','Access-Control-Request-Headers':'X-Charakuru-Session,Content-Type'}});assert.equal(preflight.status,204);
});

test('real 3.0.6 headless envelope is unwrapped before structured stage validation', async()=>{
  const connection={...gateway,protocol:'legacy-3.0'};
  const receipt=await executeCompanionStage({connection,scriptFile:'fixture.py',fetchImpl:async()=>Response.json({ok:true,result:{ok:true,kind:'headless',exitCode:0,resultJson:{verdict:'pass',requestId:'real-envelope-fixture'}}})});
  assert.equal(receipt.exitCode,0);assert.equal(receipt.resultJson.requestId,'real-envelope-fixture');
});
