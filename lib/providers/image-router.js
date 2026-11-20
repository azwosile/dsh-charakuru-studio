import crypto from 'node:crypto';
/* Avatar Studio image routing: bounded local and opt-in provider adapters. */
import fs from 'node:fs/promises';
import { assertImagePreflight, imagePreflight, CLOUD_CREDENTIALS } from './capabilities.js';
import { imageModelProfile, resolveImageOptions } from './image-profiles.js';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  DEFAULT_COMFYUI_URL,
  DEFAULT_QWEN_IMAGE_URL,
} from '../constants.js';
import { IMAGE_MODEL_CATALOG, compileTurnaroundPromptPack } from '../catalog/aa-image-hub.js';
import { ensureProjectLayout, loadProjectState, updateProjectState } from '../project/state.js';
import { exclusiveProjectOperation, writeArtifactAtomic } from '../project/operations.js';
import { scopedFile, verifyAsset, sha256 } from '../project/reviews.js';
import { buildQwenComfyRecipe, loadQwenRecipe, renderQwenRecipe, uploadQwenReference } from './comfy-qwen.js';
import { readImagesApi, readLimitedResponse, readProviderJson, requestGemini, requestNovelAi, requestOpenAi, requestSeedream } from './cloud-images.js';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function validatePng(bytes) {
  const buf = Buffer.from(bytes);
  if (buf.length < 57 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('Image endpoint did not return a valid PNG');
  let offset = 8;
  let header;
  let ended = false;
  const data = [];
  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const end = offset + length + 12;
    if (end > buf.length) throw new Error('Truncated PNG chunk');
    const type = buf.toString('ascii', offset + 4, offset + 8);
    if (crc32(buf.subarray(offset + 4, end - 4)) !== buf.readUInt32BE(end - 4)) throw new Error('PNG checksum mismatch');
    if (!header && type !== 'IHDR') throw new Error('PNG must start with IHDR');
    if (type === 'IHDR') {
      if (header || length !== 13) throw new Error('Invalid PNG IHDR');
      header = buf.subarray(offset + 8, end - 4);
    }
    if (type === 'IDAT') data.push(buf.subarray(offset + 8, end - 4));
    if (type === 'IEND') {
      if (length !== 0 || end !== buf.length) throw new Error('Invalid PNG IEND');
      ended = true;
      break;
    }
    offset = end;
  }
  if (!ended || !data.length) throw new Error('Incomplete PNG image');
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const depth = header[8];
  const color = header[9];
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }[color];
  if (!width || !height || width > 16384 || height > 16384 || !depths?.includes(depth) || header[10] !== 0 || header[11] !== 0 || header[12] > 1) throw new Error('Unsupported PNG header');
  const passes = header[12] === 1 ? [[0,0,8,8], [4,0,8,8], [0,4,4,8], [2,0,4,4], [0,2,2,4], [1,0,2,2], [0,1,1,2]] : [[0,0,1,1]];
  const rows = passes.map(([x,y,dx,dy]) => [Math.max(0, Math.ceil((width-x)/dx)), Math.max(0, Math.ceil((height-y)/dy))]).filter(([w,h]) => w && h).map(([w,h]) => [Math.ceil(w * channels * depth / 8) + 1, h]);
  const expected = rows.reduce((n, [stride, h]) => n + stride * h, 0);
  if (expected > 128 * 1024 * 1024) throw new Error('PNG image exceeds decoded size limit');
  const raw = zlib.inflateSync(Buffer.concat(data), { maxOutputLength: expected });
  if (raw.length !== expected) throw new Error('Invalid PNG scanline length');
  let rowOffset = 0;
  for (const [stride, h] of rows) for (let row = 0; row < h; row++, rowOffset += stride) if (raw[rowOffset] > 4) throw new Error('Invalid PNG row filter');
  return buf;
}

async function withNetworkTimeout(fetchImpl, timeoutMs, operation) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Image generation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    const boundedFetch = (url, options = {}) => {
      controller.signal.throwIfAborted();
      return fetchImpl(url, { ...options, signal: controller.signal, redirect: 'error' });
    };
    return await Promise.race([operation(boundedFetch, controller.signal), deadline]);
  } finally { clearTimeout(timer); }
}

function parseResolution(resStr, fallback = [1024, 1024]) {
  const m = /^(\d+)x(\d+)$/i.exec(String(resStr || '').trim());
  if (!m) return fallback;
  return [Number(m[1]), Number(m[2])];
}

function stripSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

/**
 * Pure Node.js ZIP first-entry extractor (supports Store method=0 and Deflate method=8).
 * NovelAI `/ai/generate-image` returns a binary ZIP archive containing `image_0.png`.
 */
export function extractFirstFileFromZip(zipBuffer) {
  const buf = Buffer.from(zipBuffer), limit = 128 * 1024 * 1024;
  if (buf.subarray(0, 8).equals(PNG_SIGNATURE)) return validatePng(buf);
  if (buf.length < 30 || buf.readUInt32LE(0) !== 0x04034b50) throw new Error('Invalid ZIP or PNG payload from image endpoint');
  const flags = buf.readUInt16LE(6), method = buf.readUInt16LE(8);
  if (flags & 1) throw new Error('Encrypted image ZIP is unsupported');
  if (![0, 8].includes(method)) throw new Error(`Unsupported ZIP compression method: ${method}`);
  let crc = buf.readUInt32LE(14), compressed = buf.readUInt32LE(18), size = buf.readUInt32LE(22);
  const nameLength = buf.readUInt16LE(26), dataOffset = 30 + nameLength + buf.readUInt16LE(28);
  if (dataOffset > buf.length || !nameLength) throw new Error('Invalid ZIP entry header');
  if (flags & 8) {
    let end = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
      if (buf.readUInt32LE(i) === 0x06054b50 && i + 22 + buf.readUInt16LE(i + 20) === buf.length) { end = i; break; }
    }
    if (end < 0 || buf.readUInt16LE(end + 4) || buf.readUInt16LE(end + 6) || !buf.readUInt16LE(end + 10)) throw new Error('Missing or unsupported ZIP central directory');
    const cd = buf.readUInt32LE(end + 16);
    if (cd + 46 > end || buf.readUInt32LE(cd) !== 0x02014b50 || buf.readUInt32LE(cd + 42) !== 0 || buf.readUInt16LE(cd + 10) !== method || buf.readUInt16LE(cd + 28) !== nameLength || !buf.subarray(cd + 46, cd + 46 + nameLength).equals(buf.subarray(30, 30 + nameLength))) throw new Error('ZIP directory and local entry disagree');
    crc = buf.readUInt32LE(cd + 16); compressed = buf.readUInt32LE(cd + 20); size = buf.readUInt32LE(cd + 24);
  }
  if (!compressed || !size || size > limit || compressed > limit || dataOffset + compressed > buf.length) throw new Error('Invalid ZIP entry size');
  const payload = buf.subarray(dataOffset, dataOffset + compressed);
  const decoded = method === 0 ? Buffer.from(payload) : zlib.inflateRawSync(payload, { maxOutputLength: size });
  if (decoded.length !== size || crc32(decoded) !== crc) throw new Error('ZIP length or checksum mismatch');
  return decoded;
}

/**
 * Build a genuine ComfyUI API workflow JSON for CircleStone Labs × Comfy Org `Anima`.
 */
export function buildAnimaComfyWorkflow({
  positivePrompt,
  negativePrompt,
  width = 896,
  height = 1344,
  seed = 42,
  variant = 'base',
  filenamePrefix = 'charakuru_anima',
  modelFiles = {},
  parameters = {},
} = {}) {
  if (!['base', 'aesthetic', 'turbo'].includes(variant)) throw new Error(`Unknown Anima variant: ${variant}`);
  if (![width, height].every((n) => Number.isInteger(n) && n >= 16 && n <= 16384 && n % 16 === 0)) throw new Error('Anima dimensions must be multiples of 16 between 16 and 16384');
  const isTurbo = variant === 'turbo';
  const unetName = modelFiles.unet || `anima-${variant}-v1.0.safetensors`;
  // Basic local ComfyUI primitives, using the matching Anima variant weights.
  const workflow = {
    1: {
      class_type: 'UNETLoader',
      inputs: {
        unet_name: unetName,
        weight_dtype: 'default',
      },
    },
    2: {
      class_type: 'CLIPLoader',
      inputs: {
        clip_name: modelFiles.clip || 'qwen_3_06b_base.safetensors',
        type: 'stable_diffusion',
      },
    },
    3: {
      class_type: 'VAELoader',
      inputs: {
        vae_name: modelFiles.vae || 'qwen_image_vae.safetensors',
      },
    },
    4: {
      class_type: 'EmptyLatentImage',
      inputs: {
        width,
        height,
        batch_size: 1,
      },
    },
    5: {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: positivePrompt,
        clip: ['2', 0],
      },
    },
    6: {
      class_type: 'CLIPTextEncode',
      inputs: {
        text: negativePrompt,
        clip: ['2', 0],
      },
    },
    7: {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: parameters.steps ?? (isTurbo ? 8 : 30),
        cfg: parameters.cfg ?? (isTurbo ? 1.0 : 4.5),
        sampler_name: isTurbo ? 'euler' : 'er_sde',
        scheduler: 'simple',
        denoise: 1.0,
        model: ['1', 0],
        positive: ['5', 0],
        negative: ['6', 0],
        latent_image: ['4', 0],
      },
    },
    8: {
      class_type: 'VAEDecode',
      inputs: {
        samples: ['7', 0],
        vae: ['3', 0],
      },
    },
    9: {
      class_type: 'SaveImage',
      inputs: {
        filename_prefix: filenamePrefix,
        images: ['8', 0],
      },
    },
  };
  return workflow;
}

/**
 * Build a standalone local Diffusers batch runner for `Qwen/Qwen-Image-2.1` (`QwenImage21Pipeline`)
 * so users with a local GPU can also run batch 8+3 generation directly without starting an HTTP server.
 */
export function buildQwenLocalDiffusersScript({ projectDir, views, referenceImage = null, turbo = false }) {
  const modelRepo = turbo ? 'Qwen/Qwen-Image-2.1-Turbo' : 'Qwen/Qwen-Image-2.1';
  const steps = turbo ? 8 : 40;
  const serializedViews = JSON.stringify(
    views.map((v) => ({
      slotId: v.slotId,
      group: v.group,
      resolution: v.resolution,
      positivePrompt: v.positivePrompt,
      negativePrompt: v.negativePrompt,
      outPath: path.join(projectDir, 'views', v.group, `${v.slotId}.png`),
    })),
    null,
    2,
  );

  return `#!/usr/bin/env python3
# Auto-generated by dsh-charakuru-studio — Local Qwen-Image-2.1 8+3 Turnaround Batch Runner
import os
import json
import torch
from pathlib import Path
from PIL import Image
from diffusers import QwenImage21Pipeline

MODEL_ID = ${JSON.stringify(modelRepo)}
REF_IMAGE = json.loads(${JSON.stringify(JSON.stringify(referenceImage))})
STEPS = ${steps}
VIEWS = json.loads(${JSON.stringify(serializedViews)})

def main():
    if not torch.cuda.is_available():
        raise RuntimeError('This exported example needs a compatible CUDA setup. Use ComfyUI or adapt it for your hardware.')
    pipe = QwenImage21Pipeline.from_pretrained(MODEL_ID, torch_dtype=torch.bfloat16)
    pipe.enable_model_cpu_offload()
    if REF_IMAGE and not os.path.isfile(REF_IMAGE):
        raise FileNotFoundError(REF_IMAGE)
    ref_img = Image.open(REF_IMAGE).convert("RGBA") if REF_IMAGE else None

    for idx, item in enumerate(VIEWS):
        w, h = [int(x) for x in item["resolution"].split("x")]
        os.makedirs(os.path.dirname(item["outPath"]), exist_ok=True)
        kwargs = dict(
            prompt=item["positivePrompt"],
            negative_prompt=item.get("negativePrompt") or None,
            width=w,
            height=h,
            num_inference_steps=STEPS,
            generator=torch.Generator("cuda").manual_seed(42 + idx),
        )
        if ref_img is not None:
            kwargs["image"] = ref_img
        img = pipe(**kwargs).images[0]
        out = Path(item["outPath"])
        with out.open("wb") as stream:
            img.save(stream, format="PNG")
        print("SAVED", item["slotId"], out)

if __name__ == "__main__":
    main()
`;
}

function localEndpoint(value, { compatible = false } = {}) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || (!compatible && url.pathname !== '/')) {
    throw new Error('Local model driver must use a loopback HTTP endpoint');
  }
  return stripSlash(url.href);
}
function gatewayEndpoint(value) {
  const url = new URL(value);
  const loopbackHttp = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !loopbackHttp) || url.username || url.password || url.search || url.hash) {
    throw new Error('Gateway requires a trusted HTTPS or loopback HTTP base URL without credentials or a query');
  }
  return stripSlash(url.href);
}
function configurationFor(driver, endpoints = {}) {
  return driver === 'qwen_local' ? `${localEndpoint(endpoints.qwenImageUrl || DEFAULT_QWEN_IMAGE_URL, { compatible: true }).replace(/\/v1$/, '')}/v1` :
    ['comfyui_anima', 'comfyui_qwen'].includes(driver) ? localEndpoint(endpoints.comfyuiUrl || DEFAULT_COMFYUI_URL) :
    driver === 'openai_compat' ? gatewayEndpoint(endpoints.openaiCompatBaseUrl) : '';
}

// A read-only check of options, the local recipe file and credential presence.
// No remote quote, upload, reservation or model execution is attempted here.
export async function checkImageSetup(options={}) {
  const {projectDir,modelId='qwen-image-2.1-local',mode='execute',slots,endpoints,comfyuiQwenWorkflowPath,allowCloudExecution=false,credentials=[]}=options;
  const loaded=await loadProjectState(projectDir),refs=loaded.state?.characterSpec?.sourceImages||[];
  const driver=IMAGE_MODEL_CATALOG.find(m=>m.id===modelId)?.driver;
  let settings;
  try {settings=resolveImageOptions(loaded.state,modelId,options);}
  catch(error){return {allowed:false,modelId,driver,mode,reasons:[error.message],scope:'configuration_only_no_network'};}
  const result=imagePreflight({...settings,modelId,hasReference:!!refs.length,referenceCount:refs.length,imageMode:options.imageMode,
    mode,slots,cloudEnabled:allowCloudExecution,comfyuiWorkflowConfigured:!!comfyuiQwenWorkflowPath,gatewayConfigured:!!endpoints?.openaiCompatBaseUrl,
    credentialConfigured:credentials.some(c=>c.id===CLOUD_CREDENTIALS[driver]&&c.configured)});
  if(!loaded.exists&&mode==='execute')result.reasons.push('请先建立工程。');
  if(result.reasons.length===0&&mode==='execute'){
    try {
      configurationFor(driver,endpoints);
      if(driver==='comfyui_qwen')await loadQwenRecipe(comfyuiQwenWorkflowPath);
      if(result.usingReference)await readReference(loaded.projectDir,loaded.state,refs[0]);
      compileTurnaroundPromptPack({...settings,modelId,slots,characterPrompt:options.characterPrompt||loaded.state.characterSpec.characterPrompt||undefined,useProjectReference:result.usingReference});
    } catch(error){result.reasons.push(error.code?'无法读取本机配置或工程图片。':error.message);}
  }
  return {...result,allowed:result.reasons.length===0,scope:'configuration_only_no_network'};
}

export async function previewImagePrompts(options={}) {
  const {projectDir,modelId='qwen-image-2.1-local',imageMode,slots}=options;
  const {state}=await loadProjectState(projectDir),refs=state?.characterSpec?.sourceImages||[];
  const settings=resolveImageOptions(state,modelId,options);
  if(imageMode==='image_to_image'&&refs.length!==1)throw new Error('图生图需要先采用一张原画 PNG；不会退回文生图。');
  const use=options.useProjectReference??(settings.referenceMode==='project'&&refs.length===1);
  const capability=imagePreflight({...settings,modelId,hasReference:!!refs.length,referenceCount:refs.length,mode:'plan_and_export_workflows'});
  const bound=use&&(capability.referenceEdit||capability.offlineReferenceEdit);
  return {pack:compileTurnaroundPromptPack({...settings,modelId,slots,characterPrompt:options.characterPrompt||state?.characterSpec?.characterPrompt||undefined,useProjectReference:bound}),
    referencePlan:!use?'text_only':bound?'project_reference':'reference_requested_not_bound'};
}

async function executeComfyPrompt({ base, workflow, outputNode, timeoutMs, fetchImpl, onQueued }) {
  const submit = await fetchImpl(`${base}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow }) });
  if (!submit.ok) throw new Error(`ComfyUI /prompt HTTP ${submit.status}; verify nodes and model names in the local workflow`);
  const { prompt_id: promptId } = await readProviderJson(submit);
  if (typeof promptId !== 'string' || !promptId || promptId.length > 160) throw new Error('ComfyUI did not return a prompt_id');
  onQueued?.(promptId);
  const deadline = Date.now() + timeoutMs;
  do {
    const hist = await fetchImpl(`${base}/history/${encodeURIComponent(promptId)}`);
    if (hist.ok) {
      const record = (await readProviderJson(hist))[promptId];
      if (record?.status?.status_str === 'error') throw new Error(`ComfyUI failed (prompt_id=${promptId}); inspect its local history`);
      const result = record?.outputs?.[outputNode]?.images?.[0];
      if (result) {
        const subfolder = result.subfolder ?? '';
        if (typeof result.filename !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,255}$/.test(result.filename) || typeof subfolder !== 'string' || !/^[A-Za-z0-9_/-]{0,120}$/.test(subfolder) || subfolder.includes('..') || result.type !== 'output') {
          throw new Error('ComfyUI SaveImage did not return a root output image');
        }
        const q = new URLSearchParams({ filename: result.filename, type: 'output', ...(subfolder ? { subfolder } : {}) });
        const image = await fetchImpl(`${base}/view?${q}`);
        if (!image.ok) throw new Error(`ComfyUI /view HTTP ${image.status}`);
        return readLimitedResponse(image);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 900));
  } while (Date.now() < deadline);
  throw new Error(`ComfyUI is not complete (prompt_id=${promptId}); check history before retrying`);
}

async function executeOpenAiCompat({ base, apiKey, apiModel, view, fetchImpl }) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const body = { model: apiModel, prompt: view.positivePrompt, size: view.resolution, n: 1, response_format: 'b64_json' };
  const res = await fetchImpl(`${base}/images/generations`, { method: 'POST', headers, body: JSON.stringify(body) });
  return readImagesApi(res, 'Compatible Images API');
}

async function readReference(root, state, refPath) {
  const registered = state.assets?.items?.find(item => item.id === state.assets.selected?.source && item.filePath === refPath && item.slotId === 'source');
  if (registered) return validatePng((await verifyAsset(root, registered)).bytes);
  // Existing projects may already point at a PNG kept inside the project. If it
  // lives outside, the user must explicitly register it before transmission.
  let file;
  try { file = await scopedFile(root, refPath); }
  catch { throw new Error('请先在图片库登记并采用原画 PNG；仅工程内资产可交给参考编辑。'); }
  if ((await fs.stat(file)).size > 20 * 1024 * 1024) throw new Error('原画超过 20 MiB');
  return validatePng(await fs.readFile(file));
}

async function projectOutput(root, ...segments) {
  const file = path.join(root, ...segments);
  const parent = await fs.realpath(path.dirname(file));
  const relative = path.relative(await fs.realpath(root), parent);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Image output folder escapes project');
  return file;
}

export function runTurnaroundGeneration(options = {}) {
  return exclusiveProjectOperation(options.projectDir, async () => {
    if (options.mode !== 'execute' || !options.requestId) return generateViews(options);
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(options.requestId)) throw new Error('Invalid persistent image request ID');
    const state = (await loadProjectState(options.projectDir)).state;
    const payload = { ...options, secrets: undefined, fetchImpl: undefined, requestId: undefined, signal: undefined, cloudConfirmed: undefined, expectedRevision: undefined, characterSpec: state?.characterSpec, imageProfile: imageModelProfile(state,options.modelId||'qwen-image-2.1-local') };
    const hash = sha256(JSON.stringify(payload));
    const old = state?.imageRequests?.[options.requestId];
    if (old) {
      if (old.fingerprint !== hash) throw new Error('Image request ID reused with different inputs');
      if (old.result) return { ...old.result, duplicate: true };
      if (old.status !== 'rejected') throw new Error('Image request is in-flight or billing-uncertain; reconcile before retrying, do not submit again');
    }
    const started = await updateProjectState(options.projectDir, next => {
      assertGenerationRevision(next, options.expectedRevision);
      next.imageRequests ||= {};
      if (!old && Object.keys(next.imageRequests).length >= 500) throw new Error('Archive old image request receipts first');
      next.imageRequests[options.requestId] = { fingerprint: hash, status: 'started', at: new Date().toISOString() };
    });
    let dispatched = false;
    try {
      const result = await generateViews({ ...options, expectedRevision: started.state.stateRevision, fetchImpl: (...args) => { dispatched = true; return (options.fetchImpl || fetch)(...args); } });
      await updateProjectState(options.projectDir, next => {
        Object.assign(next.imageRequests[options.requestId], { status: result.verdict === 'pass' ? 'completed' : 'needs_reconciliation', result });
      });
      return result;
    } catch (error) {
      await updateProjectState(options.projectDir, next => {
        Object.assign(next.imageRequests[options.requestId], { status: dispatched ? 'uncertain' : 'rejected', error: error.message });
      });
      throw error;
    }
  });
}

function assertGenerationRevision(state, expectedRevision) {
  if (expectedRevision !== undefined && state.stateRevision !== expectedRevision) {
    throw new Error('工程已变更。请重新载入工程，核对本次参考图和槽位，再确认执行。');
  }
}

async function generateViews(options) {
  const {projectDir,modelId='qwen-image-2.1-local',characterPrompt='',slots,mode='plan_and_export_workflows',imageMode,
    endpoints={},secrets={},comfyuiQwenWorkflowPath,timeoutMs=180000,fetchImpl=fetch,
    allowCloudExecution=false,cloudConfirmed=false,requestId,expectedRevision}=options;
  if (!['plan_and_export_workflows', 'execute'].includes(mode)) throw new Error('Invalid generation mode');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 1800000) throw new Error('Invalid image request timeout');
  const root = await ensureProjectLayout(projectDir);
  const loaded = await loadProjectState(root);
  if (!loaded.exists) throw new Error('Initialize project before generating views');
  const state = loaded.state;
  if (mode === 'execute') assertGenerationRevision(state, expectedRevision);
  const refs = state.characterSpec?.sourceImages || [];
  const savedProfile=imageModelProfile(state,modelId);
  const {apiModelOverride='',artistTag='',animaVariant='base',rgbaTransparent=true,modelFiles={},parameters,referenceMode,promptTemplates}=resolveImageOptions(state,modelId,options);
  const model = IMAGE_MODEL_CATALOG.find(m => m.id === modelId);
  const credentialId = CLOUD_CREDENTIALS[model?.driver];
  const capability = assertImagePreflight({ modelId, apiModelOverride, mode, referenceMode, imageMode, slots, hasReference: Boolean(refs.length), referenceCount: refs.length,
    animaVariant, modelFiles, cloudEnabled: allowCloudExecution, comfyuiWorkflowConfigured: Boolean(comfyuiQwenWorkflowPath),
    gatewayConfigured: Boolean(endpoints.openaiCompatBaseUrl), credentialConfigured: Boolean(credentialId && secrets[credentialId]) });
  const live = mode === 'execute', apiModel = apiModelOverride.trim();
  if (live && capability.cloud && (cloudConfirmed !== true || !requestId)) throw new Error('CLOUD_CONFIRMATION_REQUIRED: confirm this one view in Avatar Studio');
  const base = live ? configurationFor(model.driver, endpoints) : '';
  const refPath = capability.usingReference ? refs[0] : null;
  const recipe = live && model.driver === 'comfyui_qwen' ? await loadQwenRecipe(comfyuiQwenWorkflowPath) : null;
  const reference = live && refPath ? await readReference(root, state, refPath) : null;
  const canBindReference = capability.referenceEdit || !live && model.driver === 'qwen_local';
  const pack = compileTurnaroundPromptPack({ modelId,
    characterPrompt: characterPrompt || state.characterSpec?.characterPrompt || 'original character with consistent hair, outfit and palette',
    artistTag, animaVariant, rgbaTransparent, slots, promptTemplates, useProjectReference: Boolean(refPath) && canBindReference });
  const referencePlan = !refPath ? 'text_only' : canBindReference ? 'project_reference' : 'reference_requested_not_bound';
  const exportedArtifacts = [];
  const workflowFile = async (name, data) => {
    const out = await projectOutput(root, 'views', 'workflows', name);
    await writeArtifactAtomic(out, data);
    exportedArtifacts.push(out);
  };
  const animaGraph = (view, i = 0) => {
    const [width, height] = parseResolution(view.resolution, [896, 1344]);
    return buildAnimaComfyWorkflow({ positivePrompt: view.positivePrompt, negativePrompt: view.negativePrompt, width:parameters.width??width, height:parameters.height??height,
      variant: animaVariant, modelFiles, parameters, seed: (parameters.seed??1000) + i, filenamePrefix: `dsh_${view.slotId}` });
  };
  if (model.driver === 'comfyui_anima') {
    for (const [i, view] of pack.views.entries()) await workflowFile(`anima_${view.slotId}.comfy.json`, `${JSON.stringify(animaGraph(view, i), null, 2)}\n`);
  } else if (model.driver === 'qwen_local') {
    await workflowFile('run_qwen_image_21_views.py', buildQwenLocalDiffusersScript({ projectDir: root, views: pack.views, referenceImage: refPath ? path.resolve(root, refPath) : null, turbo: Boolean(options.turbo) }));
  } else if (model.driver === 'comfyui_qwen' && !live) {
    const configured=comfyuiQwenWorkflowPath?await loadQwenRecipe(comfyuiQwenWorkflowPath):null;
    const template=configured?.workflow||buildQwenComfyRecipe();
    const { resolution, ...samplerParameters } = parameters || {};
    const encodeNode = template[configured?.encodeId || '5'];
    if (resolution !== undefined && encodeNode?.inputs && Object.hasOwn(encodeNode.inputs, 'resolution')) {
      encodeNode.inputs.resolution = resolution;
    }
    Object.assign(template[configured?.sampleId||'6'].inputs, samplerParameters);
    await workflowFile('qwen_image_21_edit.template.api.json', `${JSON.stringify(template, null, 2)}\n`);
  }
  await workflowFile(`prompts_${model.id}.json`, `${JSON.stringify({ ...pack, referencePlan, liveReferenceSupportedByAdapter: capability.referenceEdit }, null, 2)}\n`);
  if (!live) return { mode, projectDir: root, model: pack.model, referencePlan, exportedArtifacts, views: pack.views, global3dPrepChecklistZh: pack.global3dPrepChecklistZh };

  const results = [];
  let uploaded;
  for (const [i, view] of pack.views.entries()) {
    let providerPromptId;
    const onQueued = id => { providerPromptId = id; };
    try {
      const out = await projectOutput(root, 'views', view.group, `${view.slotId}-${crypto.randomUUID()}.png`);
      const bytes = validatePng(await withNetworkTimeout(fetchImpl, timeoutMs, async boundedFetch => {
        const args = { apiKey: secrets[credentialId], apiModel, view, reference, rgbaTransparent, fetchImpl: boundedFetch };
        switch (model.driver) {
          case 'comfyui_qwen':
            uploaded ||= await uploadQwenReference({ comfyuiUrl: base, bytes: reference, fetchImpl: boundedFetch });
            return executeComfyPrompt({ base, workflow: renderQwenRecipe(recipe, view, uploaded, {...parameters,...(parameters.seed!==undefined?{seed:parameters.seed+i}:{})}), outputNode: recipe.saveId, timeoutMs, fetchImpl: boundedFetch, onQueued });
          case 'comfyui_anima': return executeComfyPrompt({ base, workflow: animaGraph(view, i), outputNode: '9', timeoutMs, fetchImpl: boundedFetch, onQueued });
          case 'qwen_local': return executeOpenAiCompat({ ...args, apiKey: '', base, apiModel: apiModel || 'Qwen/Qwen-Image-2.1' });
          case 'novelai': {
            const data = await requestNovelAi({ ...args, seed: (parameters?.seed ?? (2026 + (requestId ? parseInt(sha256(requestId).slice(0, 6), 16) % 1000000 : 0))) + i });
            return data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ? data : extractFirstFileFromZip(data);
          }
          case 'gemini': return requestGemini(args);
          case 'openai_gpt': return requestOpenAi(args);
          case 'ark_seedream': return requestSeedream(args);
          case 'openai_compat': return executeOpenAiCompat({ ...args, base });
          default: throw new Error('Image driver has no execution route');
        }
      }));
      await writeArtifactAtomic(out, bytes);
      const now = (await loadProjectState(root)).state;
      if (JSON.stringify(now.characterSpec) !== JSON.stringify(state.characterSpec)) throw new Error('工程设定在作业期间变更；结果仅保存为本地暂存 PNG，未采用。');
      if(JSON.stringify(imageModelProfile(now,modelId))!==JSON.stringify(savedProfile))throw new Error('生图参数或模板在作业中变更，PNG 已暂存但未采用。');
      if (reference && sha256(await readReference(root, now, refPath)) !== sha256(reference)) throw new Error('作业期间原画变化；结果仅保存为本地暂存 PNG，未采用。');
      const { importStudioAsset } = await import('../project/assets.js');
      const saved = await importStudioAsset({ projectDir: root, kind: 'image', slotId: view.slotId, sourcePath: out, label: `${view.slotId} · ${modelId}`,
        expectedRevision: now.stateRevision });
      results.push({ slotId: view.slotId, ok: true, filePath: out, bytes: bytes.length, assetId: saved.asset.id,
        selected: saved.projectState.views[view.slotId]?.status === 'ready' && saved.projectState.views[view.slotId].assetId === saved.asset.id, providerPromptId });
    } catch (error) {
      results.push({ slotId: view.slotId, ok: false, error: error instanceof Error ? error.message : String(error), providerPromptId });
      // If an edit upload fails before its first queue entry, do not enqueue or
      // upload the same private image repeatedly on later slots.
      if (model.driver === 'comfyui_qwen' && !uploaded) break;
    }
  }
  const ok = results.filter(row => row.ok).length;
  await updateProjectState(root, next => {
    for (const row of results) if (row.ok && row.selected && next.views[row.slotId].status === 'ready' && next.views[row.slotId].assetId === row.assetId) next.views[row.slotId].modelUsed = modelId;
    next.auditLog.push({ at: new Date().toISOString(), event: 'views.generated', detail: `${ok}/${pack.views.length} via ${modelId} (${referencePlan})` });
  });
  return { ok: ok === pack.views.length, verdict: ok === pack.views.length ? 'pass' : ok ? 'degraded' : 'fail', mode, projectDir: root, model: pack.model,
    referencePlan, recipeSha256: recipe?.sha256, exportedArtifacts, results };
}
