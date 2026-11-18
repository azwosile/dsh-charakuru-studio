import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {tempProject,png,triangleGlb,readyAssetProject,glb} from './fixtures.mjs';
import {loadProjectState,initOrUpdateProject} from '../lib/project/state.js';
import {importStudioAsset,clearStudioImage,selectStudioAsset,scanGeneratedViews,getAssetContent} from '../lib/project/assets.js';
import {setEditorView} from '../lib/project/editor.js';
import {importProjectMaterial,useProjectMaterial} from '../lib/project/materials.js';
import {selectFoundation,setWorkflowMode} from '../lib/project/workflow.js';
import {newTripoStudioTicket,transitionTripoStudioTicket,readTripoStudioTicket,collectTripoStudioDownload} from '../lib/tripo/studio-handoff.js';
import {startStudioHttpServer} from '../lib/host/server.js';
import {buildQwenComfyRecipe} from '../lib/providers/comfy-qwen.js';
import {imagePreflight} from '../lib/providers/capabilities.js';

const inspect=async projectDir=>(await loadProjectState(projectDir)).state;
const rev=async dir=>(await inspect(dir)).stateRevision;
const storeImage=(projectDir,slotId,bytes=png())=>importStudioAsset({projectDir,slotId,dataBase64:bytes.toString('base64')});
const adopt=async (projectDir,assetId)=>selectStudioAsset({projectDir,assetId,expectedRevision:await rev(projectDir)});
const clear=async(projectDir,slotId,expectedAssetId)=>clearStudioImage({projectDir,slotId,expectedAssetId,expectedRevision:await rev(projectDir)});
const receipt=async(projectDir,part,creditCap,referenceMaterialId)=>newTripoStudioTicket({projectDir,part,creditCap,referenceMaterialId,expectedRevision:await rev(projectDir)});
async function material(projectDir,role,filename,bytes) {
  const sourcePath=path.join(projectDir,filename);await fs.writeFile(sourcePath,bytes);
  return (await importProjectMaterial({projectDir,stageId:role==='design_guide'?'1_concept':'4_assembly',role,sourcePath,expectedRevision:await rev(projectDir)})).material;
}
async function phase(projectDir,ticketId,action,quotedCredits,confirmed=true) {
  return transitionTripoStudioTicket({projectDir,ticketId,action,quotedCredits,expectedRevision:await rev(projectDir),confirmed});
}

test('0.6.1 PNG deselection retains bytes, rejects stale clicks and disables implicit re-adoption',async t=>{
  const dir=await tempProject(t);await readyAssetProject(dir);
  const orig=(await storeImage(dir,'source')).asset;
  const before=await inspect(dir);
  await assert.rejects(clearStudioImage({projectDir:dir,slotId:'source',expectedAssetId:orig.id,expectedRevision:before.stateRevision-1}),/changed/);
  await assert.rejects(()=>clear(dir,'source',before.views.head_front.assetId),/Selected image changed/);
  const origCleared=(await clear(dir,'source',orig.id)).state;
  assert.equal(origCleared.assets.selected.source,undefined);
  assert.deepEqual(origCleared.characterSpec.sourceImages,[]);
  assert.ok(Object.values(origCleared.views).every(v=>v.status==='stale'));
  assert.equal(origCleared.activeStageId,'1_concept');
  assert.deepEqual((await getAssetContent(dir,orig.id)).bytes,png());
  const next=(await storeImage(dir,'source',png(2,1))).asset;
  assert.ok(!(await inspect(dir)).characterSpec.sourceImages.length);
  await adopt(dir,next.id); assert.deepEqual((await inspect(dir)).characterSpec.sourceImages,[next.filePath]);
  const slotId='head_front',active=(await inspect(dir)).views[slotId].assetId;
  await clear(dir,slotId,active);
  const replacement=(await storeImage(dir,slotId,png(3,1))).asset;
  await fs.writeFile(path.join(dir,'views','head','head_front.png'),png(3,1));
  assert.equal((await scanGeneratedViews({projectDir:dir})).imported.find(x=>x.slotId===slotId).selected,false);
  assert.equal((await inspect(dir)).views[slotId].status,'missing');
  await adopt(dir,replacement.id);assert.equal((await inspect(dir)).views[slotId].assetId,replacement.id);
  await adopt(dir,active);assert.equal((await inspect(dir)).views[slotId].status,'ready');
  const guide=await material(dir,'design_guide','guide.png',png());
  const {assetId:overlay}=await useProjectMaterial({projectDir:dir,materialId:guide.id,expectedRevision:await rev(dir)});
  await setEditorView({projectDir:dir,overlayAssetId:overlay,expectedRevision:await rev(dir)});
  const old=await rev(dir);assert.ok(overlay);
  await clear(dir,'overlay',overlay);
  assert.equal((await inspect(dir)).editor.view.overlayAssetId,null);
  await assert.rejects(setEditorView({projectDir:dir,overlayAssetId:overlay,expectedRevision:old}),/Project view changed/);
});

test('Tripo Studio gates approved PNG disclosure and quote separately; local GLB registration is not adoption or billing',async t=>{
  const dir=await tempProject(t);await initOrUpdateProject(dir);
  await assert.rejects(()=>receipt(dir,'head',10),/尚未完成/);
  await readyAssetProject(dir);
  const selected=(await inspect(dir)).assets.selected.head;
  const draft=await receipt(dir,'head',12),ticketId=draft.ticket.id;
  assert.match(draft.studioUrl,/^https:\/\/studio\.tripo3d\.ai\/$/);
  assert.deepEqual(draft.ticket.inputs.map(x=>x.slotId),['head_front','head_right','head_left','head_back']);
  await assert.rejects(()=>receipt(dir,'body',10),/current Tripo Studio ticket/);
  const handoff=await readTripoStudioTicket({projectDir:dir,ticketId,forHandoff:true});
  assert.match(handoff.instruction,/studio_status/);assert.equal(handoff.submission,'user_only');assert.deepEqual(handoff.inputFiles,[]);
  await assert.rejects(()=>phase(dir,ticketId,'confirm_quote',3),/cannot make this transition/);
  await assert.rejects(()=>phase(dir,ticketId,'authorize_upload',undefined,false),/explicit user confirmation/);
  await assert.rejects(collectTripoStudioDownload({projectDir:dir,ticketId,fileName:'download.glb'}),/Confirm the Studio quote/);
  await phase(dir,ticketId,'authorize_upload');
  assert.equal((await readTripoStudioTicket({projectDir:dir,ticketId})).inputFiles.length,4);
  await assert.rejects(()=>phase(dir,ticketId,'confirm_quote',13),/within/);
  await phase(dir,ticketId,'confirm_quote',12);
  await assert.rejects(()=>phase(dir,ticketId,'confirm_quote',12),/do not resubmit/);
  const status=await readTripoStudioTicket({projectDir:dir,ticketId});
  await assert.rejects(collectTripoStudioDownload({projectDir:dir,ticketId,fileName:'../escape.glb'}),/file name/);
  await fs.writeFile(path.join(status.inbox,'bad.glb'),glb());
  await assert.rejects(collectTripoStudioDownload({projectDir:dir,ticketId,fileName:'bad.glb'}),/previewable/);
  await fs.writeFile(path.join(status.inbox,'候选.glb'),triangleGlb());
  const one=await collectTripoStudioDownload({projectDir:dir,ticketId,fileName:'候选.glb'});
  const again=await collectTripoStudioDownload({projectDir:dir,ticketId,fileName:'候选.glb'});
  assert.equal(one.candidate.id,again.candidate.id);
  assert.equal((await readTripoStudioTicket({projectDir:dir,ticketId})).ticket.downloads.length,1);
  assert.equal(one.billedCreditsRecorded,false);
  assert.equal((await inspect(dir)).assets.selected.head,selected);
  await phase(dir,ticketId,'close');
  assert.equal((await inspect(dir)).tripoQuota.creditsUsed,0);
  const body=await receipt(dir,'body',5);
  await clear(dir,'body_front',(await inspect(dir)).views.body_front.assetId);
  await assert.rejects(()=>phase(dir,body.ticket.id,'authorize_upload'),/上游|inputs/);
  const stale=await readTripoStudioTicket({projectDir:dir,ticketId:body.ticket.id});
  assert.deepEqual(stale.inputFiles,[]);assert.ok(stale.blockedReason);
});

test('base-mesh Tripo browser job can only bind a dedicated part PNG and imports a quarantined material candidate',async t=>{
  const dir=await tempProject(t);await initOrUpdateProject(dir);
  await setWorkflowMode({projectDir:dir,mode:'base_mesh',expectedRevision:await rev(dir)});
  const body=await material(dir,'foundation_body','body.blend',Buffer.from('BLENDER-v500fixture-data'));
  await selectFoundation({projectDir:dir,part:'body',materialId:body.id,expectedRevision:await rev(dir)});
  await assert.rejects(()=>receipt(dir,'clothing',0,body.id),/isolated part PNG/);
  const reference=await material(dir,'tripo_clothing_reference','shirt.png',png());
  await assert.rejects(()=>receipt(dir,'head',0,reference.id),/isolated clothing/);
  await assert.rejects(()=>receipt(dir,'hair',0,reference.id),/isolated part PNG/);
  const ticketId=(await receipt(dir,'clothing',0,reference.id)).ticket.id;
  await phase(dir,ticketId,'authorize_upload');await phase(dir,ticketId,'confirm_quote',0);
  const status=await readTripoStudioTicket({projectDir:dir,ticketId});
  assert.equal(status.inputFiles.length,1);assert.match(status.inputFiles[0].file,/\.png$/);
  const sourceGlbPath=path.join(dir,'download.glb');await fs.writeFile(sourceGlbPath,triangleGlb());
  await assert.rejects(collectTripoStudioDownload({projectDir:dir,ticketId,sourceGlbPath}),/absolute path/);
  const imported=await collectTripoStudioDownload({projectDir:dir,ticketId,actor:'user',sourceGlbPath,expectedRevision:await rev(dir)});
  assert.equal(imported.candidate.kind,'material');
  const after=await inspect(dir);
  assert.equal(after.materials.items.find(m=>m.id===imported.candidate.id).role,'tripo_clothing');
  assert.deepEqual(after.materials.selected,{});assert.equal(after.editor,undefined);assert.equal(after.tripoQuota.creditsUsed,0);
});

// Exercise real HTTP serialization and local network sockets, with a deterministic fixture rather than GPU generation.
async function comfyFixture(t) {
  const seen=[];
  const server=http.createServer(async(req,res)=>{
    const buffers=[];for await(const chunk of req)buffers.push(chunk);
    const body=Buffer.concat(buffers),url=new URL(req.url,'http://localhost');
    seen.push({route:url.pathname,type:req.headers['content-type'],body});
    const json=x=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(x));};
    if(url.pathname==='/upload/image')return json({name:'fixture-source.png',subfolder:'',type:'input'});
    if(url.pathname==='/prompt')return json({prompt_id:String(seen.length)});
    if(url.pathname.startsWith('/history/')) {
      const id=url.pathname.split('/').at(-1),name={filename:'fixture.png',type:'output',subfolder:''};
      return json({[id]:{outputs:{8:{images:[name]},9:{images:[name]}}}});
    }
    if(url.pathname==='/view'){res.setHeader('content-type','image/png');return res.end(png(2,2));}
    res.statusCode=404;res.end();
  });
  await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
  t.after(()=>new Promise(r=>server.close(r)));
  return {url:'http://127.0.0.1:'+server.address().port,seen};
}
async function studioPost(t,dir,config={}) {
  const server=await startStudioHttpServer({port:0,config:{registryFile:path.join(dir,'recents.json'),blenderPluginUrl:'http://127.0.0.1:1',...config}});
  t.after(()=>server.close());
  const session=await (await fetch(server.baseUrl+'/studio/session')).json();
  return async function post(route,fields={}){
    const response=await fetch(server.baseUrl+route,{method:'POST',headers:{'Content-Type':'application/json','X-Charakuru-Session':session.sessionToken,Origin:'dsh-app://app'},body:JSON.stringify({projectDir:dir,...fields})});
    return {code:response.status,data:await response.json()};
  };
}

test('desktop HTTP applies saved per-model parameters and edited templates to both ComfyUI modes without fallback',async t=>{
  const dir=await tempProject(t),fixture=await comfyFixture(t);await initOrUpdateProject(dir,{characterPrompt:'silver hair, red coat'});
  const work=path.join(dir,'Qwen.api.json');await fs.writeFile(work,JSON.stringify(buildQwenComfyRecipe()));
  const post=await studioPost(t,dir,{comfyuiUrl:fixture.url,comfyuiQwenWorkflowPath:work});
  const anima='comfyui-anima-local',qwen='qwen-image-2.1-comfy-edit',slotId='head_front';
  const set=async(modelId,options)=>post('/studio/image/profile',{modelId,expectedRevision:await rev(dir),...options});
  const view=(modelId,imageMode,requestId)=>({modelId,imageMode,slots:[slotId],requestId});
  const generate=async(args)=>post('/studio/views/generate',{mode:'execute',...args,expectedRevision:await rev(dir)});
  const bad=await generate(view(qwen,'image_to_image','missing-png-does-not-run'));
  assert.equal(bad.code,400);assert.match(bad.data.error.message,/不.*退回文生图/);assert.equal(fixture.seen.length,0);
  const source=(await storeImage(dir,'source')).asset;
  const args=view(anima,'text_to_image','comfy-anima-loopback');
  assert.equal((await set(anima,{action:'config',config:{animaVariant:'turbo',modelFiles:{clip:'offline.safetensors'},parameters:{width:512,height:768,seed:910,steps:12,cfg:2}}})).code,200);
  assert.equal((await set(anima,{action:'config',config:{parameters:{width:999}}})).code,400);
  const initial=(await post('/studio/prompts/template',{modelId:anima,slotId})).data;
  assert.match(initial.defaults.positive,/\{character\}/);assert.equal(initial.override,null);
  const template={positive:'my framing // {character} {reference}',negative:'no strong backlight'};
  assert.equal((await set(anima,{action:'prompt',slotId,template})).code,200);
  const preview=(await post('/studio/prompts/compile',args)).data.pack.views[0];
  assert.equal(preview.positivePrompt,'my framing // silver hair, red coat');
  assert.equal(preview.templateSource,'project_override');
  const prep=await post('/studio/views/preflight',args);assert.equal(prep.data.allowed,true);assert.equal(fixture.seen.length,0);
  const gen=await generate(args);assert.equal(gen.data.verdict,'pass');
  assert.deepEqual(fixture.seen.map(x=>x.route),['/prompt','/history/1','/view']);
  const A=JSON.parse(fixture.seen[0].body).prompt;
  assert.deepEqual([A[4].inputs.width,A[4].inputs.height,A[7].inputs.seed,A[7].inputs.steps,A[7].inputs.cfg],[512,768,910,12,2]);
  assert.equal(A[2].inputs.clip_name,'offline.safetensors');assert.equal(A[5].inputs.text,preview.positivePrompt);assert.equal(A[6].inputs.text,template.negative);
  assert.equal((await generate(args)).data.duplicate,true);assert.equal(fixture.seen.length,3);
  assert.equal((await set(qwen,{action:'config',config:{parameters:{seed:611,steps:22,cfg:1.2,denoise:.8}}})).code,200);
  assert.equal((await set(qwen,{action:'prompt',slotId,template:{positive:'same character{reference}',negative:'remove glare'}})).code,200);
  const edit=await generate(view(qwen,'image_to_image','comfy-qwen-loopback'));
  assert.equal(edit.data.verdict,'pass');assert.deepEqual(fixture.seen.slice(3).map(x=>x.route),['/upload/image','/prompt','/history/5','/view']);
  assert.match(fixture.seen[3].type,/multipart\/form-data/);assert.ok(fixture.seen[3].body.includes(png()));
  const Q=JSON.parse(fixture.seen[4].body).prompt;
  assert.equal(Q[1].inputs.image,'fixture-source.png');assert.match(Q[5].inputs.prompt,/Preserve identity/);
  assert.equal(Q[5].inputs.negative_prompt,'remove glare');assert.deepEqual([Q[6].inputs.seed,Q[6].inputs.steps,Q[6].inputs.cfg,Q[6].inputs.denoise],[611,22,1.2,.8]);
  await clear(dir,'source',source.id);
  const noInput=(await post('/studio/views/preflight',view(qwen,'image_to_image'))).data;
  assert.equal(noInput.allowed,false);assert.equal(fixture.seen.length,7);
  assert.equal((await set(anima,{action:'reset_prompt',slotId})).code,200);
  assert.equal((await post('/studio/prompts/template',{modelId:anima,slotId})).data.override,null);
  assert.equal((await inspect(dir)).imageProfiles[qwen].prompts[slotId].negative,'remove glare');
  assert.equal(imagePreflight({modelId:anima,imageMode:'text_to_image',referenceMode:'project'}).allowed,false);
  assert.equal((await post('/studio/editor/run',{operation:'fit_foundation'})).code,400);
  assert.equal((await post('/studio/render/run')).code,404);
});
