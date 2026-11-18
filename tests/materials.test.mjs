import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { glb, png, tempProject, triangleGlb } from './fixtures.mjs';
import { PIPELINE_STAGES } from '../lib/constants.js';
import { MATERIAL_ROLES } from '../lib/project/material-roles.js';
import { importProjectMaterial, useProjectMaterial, resolveProjectMaterial, materialContent } from '../lib/project/materials.js';
import { initOrUpdateProject, loadProjectState, transitionStageCheckpoint } from '../lib/project/state.js';
import { startStudioHttpServer } from '../lib/host/server.js';
import { runEditorOperation, rollbackEditor } from '../lib/project/editor.js';
import { buildStudioTools } from '../lib/tools/register-all.js';
import { getAssetContent } from '../lib/project/assets.js';

const rev = async dir => (await loadProjectState(dir)).state.stateRevision;
const blend = Buffer.from('BLENDER-v500procedural-fixture-header-only');
const motionFixture = () => glb({extensions:{VRMC_vrm_animation:{specVersion:'1.0',humanoid:{humanBones:{hips:{node:0}}}}},nodes:[{name:'hips'}],animations:[{channels:[{}]}]});
async function register(dir, stageId, role, fileName, bytes, target = {}) {
  return importProjectMaterial({projectDir:dir,stageId,role,fileName,stream:Readable.from([bytes.subarray(0,3),bytes.subarray(3)]),declaredLength:bytes.length,expectedRevision:await rev(dir),...target});
}
const adopt = async (dir,m) => useProjectMaterial({projectDir:dir,materialId:m.id,expectedRevision:await rev(dir)});

test('all six workflow stages register role-specific external assets without altering approvals or export state',async t=>{
  const dir=await tempProject(t);await initOrUpdateProject(dir,{characterPrompt:'Blue procedural prototype'});
  await transitionStageCheckpoint(dir,{action:'request_review'});await transitionStageCheckpoint(dir,{action:'approve',actor:'user'});
  const before=(await loadProjectState(dir)).state;
  const assets=[
    ['1_concept','original','角色原稿.png',png()],
    ['2_views','turnaround','face-right.png',png(),{slotId:'head_right'}],
    ['3_tripo','part_candidate','wardrobe.glb',triangleGlb(),{part:'body'}],
    ['4_assembly','assembly_scene','assembly.blend',blend],
    ['5_rig_spring','rig_motion','walk.vrma',motionFixture()],
    ['6_expressions_vrm','delivery_scene','release.blend',blend],
  ];
  assert.deepEqual(new Set(MATERIAL_ROLES.map(r=>r.stageId)),new Set(PIPELINE_STAGES.map(x=>x.id)));
  for(const [stageId,role,name,bytes,target] of assets){
    const out=await register(dir,stageId,role,name,bytes,target);assert.equal(out.used,false);assert.equal(out.material.fileName,name);assert.equal(out.material.bytes,bytes.length);
    assert.deepEqual(await fs.readFile(path.join(dir,out.material.filePath)),bytes);
  }
  const after=(await loadProjectState(dir)).state;
  assert.deepEqual(after.stages,before.stages);assert.equal(after.activeStageId,before.activeStageId);
  assert.deepEqual(after.assets,before.assets);assert.deepEqual(after.vrmMetadata,before.vrmMetadata);
  assert.equal(after.editor,undefined);assert.equal(after.materials.items.length,6);
  assert.equal(after.materials.items[3].filePath,after.materials.items[5].filePath,'same bytes share immutable storage, not roles');
  const repeat=await register(dir,...assets[0]);assert.equal(repeat.duplicate,true);assert.equal(repeat.material.id,after.materials.items[0].id);
  const tool=buildStudioTools().find(x=>x.name==='charakuru_project');const list=await tool.execute({action:'list_materials',stageId:'4_assembly',projectDir:dir});assert.equal(list.total,1);assert.equal(list.materials[0].role,'assembly_scene');
});

test('adoption uses existing source/view and candidate gates; overlays do not replace the source',async t=>{
  const dir=await tempProject(t);await initOrUpdateProject(dir);
  const original=(await register(dir,'1_concept','original','original.png',png())).material;
  const body=(await register(dir,'2_views','turnaround','body.png',png(),{slotId:'body_front'})).material;
  const candidate=(await register(dir,'3_tripo','part_candidate','body.glb',triangleGlb(),{part:'body'})).material;
  const overlay=(await register(dir,'4_assembly','alignment_guide','proportion.png',png())).material;
  const src=await adopt(dir,original);assert.equal(src.usage,'original');assert.deepEqual(await getAssetContent(dir,src.assetId).then(x=>x.bytes),png());
  const adoptedView=await adopt(dir,body); const chosen=await adopt(dir,candidate); const extra=await adopt(dir,overlay);
  const {state}=await loadProjectState(dir);
  assert.equal(state.assets.selected.source,src.assetId);assert.equal(state.assets.selected.body,chosen.assetId);
  assert.equal(state.tripoQuota.creditsUsed,0);assert.equal(state.views.body_front.assetId,adoptedView.assetId);assert.equal(state.views.body_front.status,'ready');
  assert.equal(state.assets.items.find(x=>x.id===extra.assetId).slotId,'overlay');
  assert.equal(state.activeStageId,'1_concept');
  assert.equal(state.records,undefined);assert.ok(Object.values(state.stages).every(s=>s.status!=='completed'));
});

test('wrong magic, type, role, stale revisions and incomplete or too-large streams are not registered',async t=>{
  const dir=await tempProject(t);await initOrUpdateProject(dir);
  const baseline=await rev(dir);
  await assert.rejects(register(dir,'2_views','turnaround','invalid.png',Buffer.from('bad'),{slotId:'head_front'}),/PNG/);
  await assert.rejects(register(dir,'4_assembly','assembly_scene','mesh.glb',triangleGlb()),/extension/);
  await assert.rejects(register(dir,'1_concept','assembly_scene','weird.blend',blend),/role/);
  await assert.rejects(register(dir,'4_assembly','assembly_scene','Fake.blend',png()),/uncompressed/);
  await assert.rejects(register(dir,'6_expressions_vrm','review_avatar','not-vrm.vrm',triangleGlb()),/VRM 1.0/);
  await assert.rejects(register(dir,'5_rig_spring','rig_motion','empty.vrma',glb()),/VRMC_vrm_animation/);
  const rogue=glb({images:[{uri:'https://example.invalid/image.png'}],extensions:{VRMC_vrm:{specVersion:'1.0'}}});
  await assert.rejects(register(dir,'6_expressions_vrm','review_avatar','rogue.vrm',rogue),/External model/);
  await assert.rejects(register(dir,'3_tripo','part_candidate','invalid.glb',triangleGlb(),{part:'side'}),/Choose head/);
  const options={projectDir:dir,stageId:'1_concept',role:'original',fileName:'original.png',expectedRevision:baseline,stream:Readable.from([png()])};
  await assert.rejects(importProjectMaterial({...options,declaredLength:20*1024**2+1}),e=>e.statusCode===413);
  await assert.rejects(importProjectMaterial({...options,declaredLength:png().length+1}),/incomplete/);
  await assert.rejects(importProjectMaterial({...options,stream:Readable.from([png()]),expectedRevision:baseline-1}),e=>e.statusCode===409);
  await assert.rejects(importProjectMaterial({...options,stream:undefined,sourcePath:'https://example.invalid/file.png'}),/local file/);
  assert.deepEqual(await fs.readdir(path.join(dir,'materials')),[]);
  assert.equal((await loadProjectState(dir)).state.materials.items.length,0);
});

test('material copy drops source paths, refuses cross-project IDs, and detects changed bytes before use, preview or editor',async t=>{
  const dir=await tempProject(t), second=await tempProject(t);await initOrUpdateProject(dir);await initOrUpdateProject(second);
  const source=path.join(second,'私有角色.blend');await fs.writeFile(source,blend);
  const {material}=await importProjectMaterial({projectDir:dir,stageId:'4_assembly',role:'assembly_scene',sourcePath:source,expectedRevision:await rev(dir)});
  assert.equal(material.fileName,'私有角色.blend');assert.doesNotMatch(JSON.stringify(material),new RegExp('charastudio-test'));
  assert.deepEqual(await fs.readFile(source),blend);
  await assert.rejects(resolveProjectMaterial(second,material.id),/not found/);
  await assert.rejects(resolveProjectMaterial(dir,material.id,'texture'),/operation/);
  await assert.rejects(materialContent(dir,material.id),/not served/);
  await fs.appendFile(path.join(dir,material.filePath),'changed');
  await assert.rejects(adopt(dir,material),/fingerprint/);let calls=0;
  await assert.rejects(runEditorOperation({projectDir:dir,operation:'import_material_scene',params:{materialId:material.id},fetchImpl:async()=>{calls++;}}),/fingerprint/);assert.equal(calls,0);
});

test('actual loopback Desktop CORS and binary file routes enforce session, declared type, material ID and revision',async t=>{
  const dir=await tempProject(t);await initOrUpdateProject(dir);
  const host=await startStudioHttpServer({port:0,config:{registryFile:path.join(dir,'recent.json'),allowedOrigins:['dsh-app://app','http://127.0.0.1:51886']}});t.after(()=>host.close());
  const origin='dsh-app://app';const token=(await (await fetch(host.baseUrl+'/studio/session',{headers:{Origin:origin}})).json()).sessionToken;
  const query=new URLSearchParams({projectDir:dir,stageId:'1_concept',role:'original',fileName:'本地图.png',expectedRevision:await rev(dir)});
  const url=host.baseUrl+'/studio/materials/upload?'+query;
  const pre=await fetch(url,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,x-charakuru-session'}});
  assert.equal(pre.status,204);assert.equal(pre.headers.get('Access-Control-Allow-Origin'),origin);assert.match(pre.headers.get('Access-Control-Allow-Headers'),/X-Charakuru-Session/);
  const headers={Origin:origin,'Content-Type':'application/octet-stream','X-Charakuru-Session':token};
  const post=extra=>fetch(url,{method:'POST',headers:{...headers,...extra},body:png()});
  assert.equal((await post({Origin:'https://elsewhere.invalid'})).status,403);
  assert.equal((await post({'X-Charakuru-Session':'wrong'})).status,403);assert.equal((await post({'Content-Type':'image/png'})).status,415);
  const ok=await post();assert.equal(ok.status,200);const {material}=await ok.json();assert.equal(material.fileName,'本地图.png');
  assert.equal((await post()).status,409);
  const read=host.baseUrl+'/studio/materials/content?'+new URLSearchParams({projectDir:dir,id:material.id});
  assert.equal((await fetch(read,{headers:{Origin:origin}})).status,403);
  const valid=await fetch(read+'&access='+token,{headers:{Origin:origin}});assert.equal(valid.status,200);assert.equal(valid.headers.get('Content-Type'),'image/png');assert.deepEqual(Buffer.from(await valid.arrayBuffer()),png());
});

test('Blender material operations use verified files, link the receipt and preserve the parent on failure or rollback',async t=>{
  const dir=await tempProject(t);await initOrUpdateProject(dir);
  const source=(await register(dir,'4_assembly','assembly_scene','source.blend',blend)).material;
  const mesh=(await register(dir,'4_assembly','assembly_mesh','part.glb',triangleGlb())).material;
  const texture=(await register(dir,'4_assembly','base_color','color.png',png())).material;
  let tamper=false;
  const companion=async(url,init)=>{
    if(url.endsWith('/health'))return Response.json({ok:true,stats:{},lease:{},provenance:{}});
    if(url.endsWith('/doctor'))return Response.json({ok:true,kind:'ok'});
    const file=JSON.parse(init.body).scriptFile;
    const script=await fs.readFile(file,'utf8');const command=JSON.parse(JSON.parse(script.split('\n')[0].slice('COMMAND = '.length)));
    assert.equal(command.material.path,await fs.realpath(path.resolve(dir,command.material.filePath)));
    assert.match(command.material.sha256,/^[a-f0-9]{64}$/);
    await fs.writeFile(command.outputs.blend,blend);await fs.writeFile(command.outputs.preview,triangleGlb());
    await fs.writeFile(command.outputs.report,JSON.stringify({objects:[],materialInput:{id:tamper?'bad':command.material.id,sha256:command.material.sha256}}));
    return Response.json({ok:true,exitCode:0,resultJson:{verdict:'pass',requestId:command.requestId,outputs:command.outputs}});
  };
  const run=opts=>runEditorOperation({projectDir:dir,blenderPluginUrl:'http://127.0.0.1:9877',fetchImpl:companion,...opts});
  const first=await run({operation:'import_material_scene',params:{materialId:source.id}});
  assert.equal(first.editor.revisions[0].materialInput.id,source.id);
  const args={operation:'append_material_mesh',params:{materialId:mesh.id},expectedRevisionId:first.revisionId};
  tamper=true;await assert.rejects(run(args),/audit/);assert.equal((await loadProjectState(dir)).state.editor.activeRevisionId,first.revisionId);
  tamper=false;const second=await run(args);
  await assert.rejects(run({operation:'apply_material_texture',expectedRevisionId:second.revisionId,params:{materialId:texture.id}}),/slot index/);
  const third=await run({operation:'apply_material_texture',expectedRevisionId:second.revisionId,params:{materialId:texture.id,textureSlot:0,objects:['Head']}});
  assert.equal(third.editor.revisions[2].materialInput.role,'base_color');
  await rollbackEditor({projectDir:dir,revisionId:first.revisionId,expectedRevisionId:third.revisionId});
  assert.deepEqual(await fs.readFile(path.join(dir,source.filePath)),blend);
  assert.equal((await loadProjectState(dir)).state.editor.activeRevisionId,first.revisionId);
});

test('DSH_HOME isolates the default registry and manual budget without using the desktop user profile',async t=>{
  const home=await tempProject(t), dir=await tempProject(t), before=process.env.DSH_HOME;
  const { createProjectRegistry }=await import('../lib/project/registry.js');
  const { createAccountBudget }=await import('../lib/providers/account-budget.js');
  try {
    process.env.DSH_HOME=home;
    await initOrUpdateProject(dir);
    await createProjectRegistry().remember(dir);
    await createAccountBudget().configure({accountId:'fixture',channel:'local',period:'2026-11',limit:0});
    assert.equal((await createProjectRegistry().list())[0].projectDir,path.resolve(dir));
    assert.equal((await fs.readdir(path.join(home,'charakuru-studio','accounts'))).length,1);
  } finally { if(before===undefined) delete process.env.DSH_HOME;else process.env.DSH_HOME=before; }
});

test('Blend registration validates only the bounded decoded header and keeps original compressed bytes',async t=>{
  const zlib=await import('node:zlib');const dir=await tempProject(t);await initOrUpdateProject(dir);
  const inputs=[['gzip',zlib.gzipSync(blend)]];
  if(zlib.zstdCompressSync)inputs.push(['zstd',zlib.zstdCompressSync(Buffer.concat([blend,Buffer.alloc(600000)]))]);
  for(const [codec,bytes] of inputs){
    const {material}=await register(dir,'5_rig_spring','rig_scene',codec+'.blend',bytes);
    assert.equal(material.encoding,codec);assert.equal(material.validation,'blend_header_only');
    assert.deepEqual(await fs.readFile(path.join(dir,material.filePath)),bytes);
    await assert.rejects(adopt(dir,material),/Use this material in the editor or preview/);
  }
  await assert.rejects(register(dir,'5_rig_spring','rig_scene','not-blend.blend',zlib.gzipSync(Buffer.alloc(150))),/not a Blender file/);
});
