import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tempProject, png, zip } from './fixtures.mjs';
import { runTurnaroundGeneration, checkImageSetup } from '../lib/providers/image-router.js';
import { buildQwenComfyRecipe, inspectQwenRecipe } from '../lib/providers/comfy-qwen.js';
import { imagePreflight } from '../lib/providers/capabilities.js';
import { initOrUpdateProject, loadProjectState } from '../lib/project/state.js';
import { importStudioAsset, scanGeneratedViews, selectStudioAsset } from '../lib/project/assets.js';

const upload = (projectDir, slotId='source') => importStudioAsset({projectDir,slotId,dataBase64:png().toString('base64')});
const pngResponse = () => Response.json({data:[{b64_json:png().toString('base64')}]});
const slots = ['head_back'];

async function prepared(t, withRef = false) {
  const projectDir = await tempProject(t);
  await initOrUpdateProject(projectDir, { characterPrompt: 'original blue-haired avatar' });
  if (withRef) await upload(projectDir);
  return { projectDir, slots, mode:'execute' };
}

test('native Qwen recipe blocks remote/custom nodes and disconnected reference before upload', () => {
  const graph = buildQwenComfyRecipe();
  assert.deepEqual(inspectQwenRecipe(graph),{loadId:'1',encodeId:'5',saveId:'8',sampleId:'6'});
  const ggufAdv = structuredClone(graph);
  ggufAdv[2] = { class_type: 'UnetLoaderGGUF', inputs: { unet_name: 'qwen-image-edit-Q4_K_M.gguf' } };
  ggufAdv[6] = { class_type: 'KSamplerAdvanced', inputs: { ...graph[6].inputs } };
  assert.deepEqual(inspectQwenRecipe(ggufAdv), { loadId: '1', encodeId: '5', saveId: '8', sampleId: '6' });
  const unsafe = structuredClone(graph); unsafe[9]={class_type:'NonLocalNode',inputs:{}};
  assert.throws(()=>inspectQwenRecipe(unsafe),/核心节点/);
  delete graph[5].inputs['images.image_1'];
  assert.throws(()=>inspectQwenRecipe(graph),/Load Image/);
});

test('native Qwen Comfy edit registers an actual PNG, consults only its SaveImage output and retains the receipt', async t => {
  const args = await prepared(t, true);
  const plan = await runTurnaroundGeneration({...args,modelId:'qwen-image-2.1-comfy-edit',mode:'plan_and_export_workflows'});
  const comfyuiQwenWorkflowPath = plan.exportedArtifacts.find(file=>file.endsWith('.api.json'));
  assert.ok(comfyuiQwenWorkflowPath); assert.equal(plan.referencePlan,'project_reference');
  assert.equal(Object.keys((await loadProjectState(args.projectDir)).state.assets.items).length,1);
  assert.equal((await checkImageSetup({...args,modelId:'qwen-image-2.1-comfy-edit',comfyuiQwenWorkflowPath})).allowed,true);
  const requests=[];
  const updated = {...args,modelId:'qwen-image-2.1-comfy-edit',comfyuiQwenWorkflowPath,requestId:'qwen-edit-fixture-01',fetchImpl:async (url,init) => {
    const parsed=new URL(url);requests.push(parsed.pathname);
    assert.equal(parsed.origin,'http://127.0.0.1:8188');assert.equal(init.redirect,'error');
    if (parsed.pathname==='/upload/image') {
      assert.equal(init.body.get('type'),'input');
      assert.deepEqual(Buffer.from(await init.body.get('image').arrayBuffer()),png());
      return Response.json({name:'new-reference.png',type:'input',subfolder:''});
    }
    if (parsed.pathname==='/prompt') {
      const {prompt} = JSON.parse(init.body);
      assert.equal(prompt[1].inputs.image,'new-reference.png');assert.match(prompt[5].inputs.prompt,/Preserve identity/);
      assert.match(prompt[8].inputs.filename_prefix,/^dsh_head_back_/);
      return Response.json({prompt_id:'fixture-qwen'});
    }
    if (parsed.pathname==='/history/fixture-qwen') return Response.json({'fixture-qwen':{outputs:{2:{images:[{filename:'wrong.png',type:'temp'}]},8:{images:[{filename:'expected.png',type:'output',subfolder:''}]}}}});
    assert.equal(parsed.pathname,'/view');assert.equal(parsed.searchParams.get('filename'),'expected.png');
    return new Response(png(),{headers:{'Content-Type':'image/png'}});
  }};
  const receipt = await runTurnaroundGeneration(updated);
  assert.equal(receipt.verdict,'pass'); assert.equal(receipt.results[0].providerPromptId,'fixture-qwen'); assert.match(receipt.recipeSha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(requests,['/upload/image','/prompt','/history/fixture-qwen','/view']);
  assert.equal((await runTurnaroundGeneration(updated)).duplicate,true);
  assert.equal(requests.length,4);
  assert.equal((await loadProjectState(args.projectDir)).state.views.head_back.modelUsed,'qwen-image-2.1-comfy-edit');
});

test('native text-only mode is explicit, never reads the source, and registers replacements as candidates', async t => {
  const args = await prepared(t, true);
  await upload(args.projectDir,slots[0]);
  const plan=await runTurnaroundGeneration({...args,mode:'plan_and_export_workflows',modelId:'comfyui-anima-local'});
  assert.equal(plan.referencePlan,'reference_requested_not_bound');
  const original = (await loadProjectState(args.projectDir)).state;
  const selected = original.views.head_back.assetId;
  await fs.unlink(path.join(args.projectDir, original.characterSpec.sourceImages[0]));
  let count=0;
  // A PNG with the same pixels but different bytes, after an ancillary tEXt chunk.
  const image = png(); const {crc32}=await import('./fixtures.mjs'); const meta=Buffer.from('tEXtkey\0new');
  const extra=Buffer.alloc(meta.length+8); extra.writeUInt32BE(meta.length-4);meta.copy(extra,4);extra.writeUInt32BE(crc32(meta),extra.length-4);
  const newPng=Buffer.concat([image.subarray(0,-12),extra,image.subarray(-12)]);
  const canonical=path.join(args.projectDir,'views','head','head_back.png');await fs.writeFile(canonical, png());
  const fetchImpl=async (url,init)=>{count++;assert.match(url,/^http:\/\/127\.0\.0\.1:8000\/v1/);assert.doesNotMatch(init.body,/Preserve identity|reference\.png/);return Response.json({data:[{b64_json:newPng.toString('base64')}]});};
  await assert.rejects(runTurnaroundGeneration({...args,fetchImpl}),/IMAGE_PREFLIGHT_BLOCKED/);
  assert.equal(count,0);
  const receipt=await runTurnaroundGeneration({...args,referenceMode:'text_only',fetchImpl});
  assert.equal(receipt.verdict,'pass');assert.equal(receipt.results[0].selected,false);assert.equal(count,1);
  assert.notEqual(receipt.results[0].filePath,canonical);assert.deepEqual(await fs.readFile(canonical),png());
  await fs.writeFile(canonical,newPng);
  const scan=await scanGeneratedViews({projectDir:args.projectDir});
  assert.equal(scan.imported[0].assetId,receipt.results[0].assetId);assert.equal(scan.imported[0].selected,false);
  const state=(await loadProjectState(args.projectDir)).state;
  assert.equal(state.views.head_back.assetId,selected);assert.equal(state.characterSpec.sourceImages.length,1);
  await selectStudioAsset({projectDir:args.projectDir,assetId:receipt.results[0].assetId});
  assert.equal((await loadProjectState(args.projectDir)).state.views.head_back.assetId,receipt.results[0].assetId);
});

test('NovelAI V5 uses multipart request, V4.5 has a separate reference route, and no V5 reference is silently dropped', async t => {
  const args = await prepared(t,true);
  const modelId='novelai-v5-cloud', apiModelOverride='nai-diffusion-5-full';
  const opt={...args,modelId,apiModelOverride,allowCloudExecution:true,cloudConfirmed:true,requestId:'novel-fixture-001',secrets:{novelai:'fixture-not-a-key'}};
  let count=0;
  const fetchImpl=async (url,init)=>{count++;assert.equal(url,'https://image.novelai.net/ai/generate-image');
    assert.equal(init.headers['Content-Type'],undefined);assert.equal(init.headers.Authorization,'Bearer fixture-not-a-key');
    assert.deepEqual([...init.body.keys()],['request']);
    const json=JSON.parse(await init.body.get('request').text());
    assert.equal(json.parameters.params_version,4);assert.equal(json.parameters.n_samples,1);assert.equal(json.parameters.director_reference_images,undefined);
    assert.equal(json.model,apiModelOverride);return new Response(zip(png()));};
  await assert.rejects(runTurnaroundGeneration({...opt,fetchImpl}),/V5 不会静默/);assert.equal(count,0);
  const rev=(await loadProjectState(args.projectDir)).state.stateRevision;
  await assert.rejects(runTurnaroundGeneration({...opt,referenceMode:'text_only',requestId:'novel-fixture-002',expectedRevision:rev-1,fetchImpl}),/工程已变更/);
  assert.equal(count,0);
  const live=await runTurnaroundGeneration({...opt,referenceMode:'text_only',requestId:'novel-fixture-002',expectedRevision:rev,fetchImpl});
  assert.equal(live.verdict,'pass');assert.equal(count,1);
  const old=await runTurnaroundGeneration({...opt,modelId:'novelai-v45-reference',apiModelOverride:'nai-diffusion-4-5-full',requestId:'novel-fixture-003',fetchImpl:async(_url,init)=>{
    const json=JSON.parse(init.body);assert.equal(json.parameters.params_version,3);
    assert.equal(json.parameters.director_reference_images[0],png().toString('base64'));return new Response(png());}});
  assert.equal(old.verdict,'pass');
});

test('official OpenAI, Ark, and Gemini edits use distinct endpoints, separate credentials and no gateway fallback', async t => {
  const args=await prepared(t,true);
  const common={...args,allowCloudExecution:true,cloudConfirmed:true,endpoints:{openaiCompatBaseUrl:'https://invalid.example/v1'},secrets:{openai:'openai-fixture',gemini:'gemini-fixture',ark:'ark-fixture',openai_compat:'gateway-fixture'}};
  const request = (modelId,apiModelOverride,fetchImpl) => runTurnaroundGeneration({...common,modelId,apiModelOverride,requestId:`req-${modelId.replaceAll(".","-")}`,fetchImpl});
  const gpt=await request('gpt-image-2.6-sunburst','gpt-image-2.6-sunburst',async(url,init)=>{
    assert.equal(url,'https://api.openai.com/v1/images/edits'); assert.equal(init.headers.Authorization,'Bearer openai-fixture');
    assert.equal(init.body.get('output_format'),'png');assert.equal(init.body.get('response_format'),null);
    assert.deepEqual(Buffer.from(await init.body.get('image[]').arrayBuffer()),png());return pngResponse();});assert.equal(gpt.verdict,'pass');
  const ark=await request('seedream-5.5','doubao-seedream-5-5-261028',async(url,init)=>{
    assert.equal(url,'https://ark.cn-beijing.volces.com/api/v3/images/generations');assert.equal(init.headers.Authorization,'Bearer ark-fixture');
    const data=JSON.parse(init.body);assert.equal(data.image,'data:image/png;base64,'+png().toString('base64'));assert.equal(data.watermark,true);return pngResponse();});assert.equal(ark.verdict,'pass');
  const gemini=await request('nano-banana-2.1','gemini-nano-banana-2.1',async(url,init)=>{
    assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-nano-banana-2.1:generateContent');assert.equal(init.headers['x-goog-api-key'],'gemini-fixture');
    assert.equal(JSON.parse(init.body).contents[0].parts[0].inlineData.data,png().toString('base64'));
    return Response.json({candidates:[{content:{parts:[{thought:true,inlineData:{mimeType:'image/png',data:'wrong'}},{inlineData:{mimeType:'image/png',data:png().toString('base64')}}]}}]});});assert.equal(gemini.verdict,'pass');
  const loopbackCompat=await runTurnaroundGeneration({...common,referenceMode:'text_only',modelId:'openai-compatible-gateway',apiModelOverride:'local-proxy-model',requestId:'req-loopback-compat',endpoints:{openaiCompatBaseUrl:'http://127.0.0.1:8080/v1'},fetchImpl:async(url,init)=>{
    assert.equal(url,'http://127.0.0.1:8080/v1/images/generations');
    assert.equal(init.headers.Authorization,'Bearer gateway-fixture');
    return pngResponse();
  }});
  assert.equal(loopbackCompat.verdict,'pass');
});

test('catalog rows, absent cloud consent, unscoped references and URL-only results do not cause other requests', async t => {
  const args=await prepared(t);
  assert.equal(imagePreflight({...args,modelId:'fibo-2.0',apiModelOverride:'not-a-driver'}).allowed,false);
  assert.equal((await checkImageSetup({...args,modelId:'nano-banana-2.1', apiModelOverride:'gemini-nano-banana-2.1'})).allowed,false);
  let calls=0;
  const opt={...args,modelId:'nano-banana-2.1',apiModelOverride:'gemini-nano-banana-2.1',allowCloudExecution:true,requestId:'cloud-fixture-no-ok',secrets:{gemini:'fixture'},fetchImpl:async()=>{calls++;return pngResponse();}};
  await assert.rejects(runTurnaroundGeneration(opt),/CLOUD_CONFIRMATION_REQUIRED/);assert.equal(calls,0);
  const outside=await tempProject(t);const outsidePath=path.join(outside,'private.png');await fs.writeFile(outsidePath,png());
  await initOrUpdateProject(args.projectDir,{sourceImage:outsidePath});
  await assert.rejects(runTurnaroundGeneration({...opt,cloudConfirmed:true,requestId:'outside-reference-fixture'}),/先在图片库登记/);assert.equal(calls,0);
  const urlOnly=await runTurnaroundGeneration({...args,referenceMode:'text_only',fetchImpl:async()=>{calls++;return Response.json({data:[{url:'https://other.example/image.png'}]});}});
  assert.equal(urlOnly.verdict,'fail');assert.equal(calls,1);
});
