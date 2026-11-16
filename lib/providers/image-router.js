/**
 * dsh-charakuru-studio — Multi-Backend Character Turnaround Image Router.
 *
 * Drivers:
 *   1. `qwen_local`     — Local Qwen-Image-2.1 (OpenAI-compat / Diffusers server OR ComfyUI OR offline script generator)
 *   2. `comfyui_anima`  — Local ComfyUI Anima v1.0 (`anima-base-v1.0.safetensors` + `qwen_3_06b_base.safetensors` + `qwen_image_vae.safetensors`)
 *   3. `novelai`        — Cloud NovelAI Diffusion V5 Full / Curated & V4.5 Precise Reference (built-in pure-Node ZIP extractor)
 *   4. `openai_compat`  — Cloud GPT Image 2.6 Sunburst / Seedream 5.5 / MiniMax H3-Image / Kling 4.0 / FLUX 3
 *   5. `gemini`         — Cloud Google Nano Banana 2.1 / Gemini 3.1 Flash Image
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  DEFAULT_COMFYUI_URL,
  DEFAULT_QWEN_IMAGE_URL,
  DEFAULT_NOVELAI_IMAGE_URL,
  DEFAULT_OPENAI_COMPAT_URL,
  REQUIRED_VIEW_SLOTS,
} from '../constants.js';
import { IMAGE_MODEL_CATALOG, compileTurnaroundPromptPack } from '../catalog/aa-image-hub.js';
import { ensureProjectLayout, loadProjectState, updateProjectState } from '../project/state.js';
import { exclusiveProjectOperation, writeArtifactAtomic } from '../project/operations.js';

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
      return fetchImpl(url, { ...options, signal: controller.signal });
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
} = {}) {
  if (!['base', 'aesthetic', 'turbo'].includes(variant)) throw new Error(`Unknown Anima variant: ${variant}`);
  if (variant === 'aesthetic' && !modelFiles.unet) throw new Error('Anima aesthetic requires an explicitly configured modelFiles.unet; no official aesthetic checkpoint is assumed');
  if (![width, height].every((n) => Number.isInteger(n) && n >= 16 && n <= 16384 && n % 8 === 0)) throw new Error('Anima dimensions must be multiples of 8 between 16 and 16384');
  const isTurbo = variant === 'turbo';
  const unetName = modelFiles.unet || 'anima-base-v1.0.safetensors';

  // Flattened from Comfy-Org/workflow_templates/templates/image_anima_base_v1.json.
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
        steps: isTurbo ? 8 : 30,
        cfg: isTurbo ? 1.0 : 4.5,
        sampler_name: 'euler',
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
  if (isTurbo) {
    workflow[10] = { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: modelFiles.lora || 'anima-turbo-lora-v0.2.safetensors', strength_model: 1 } };
    workflow[7].inputs.model = ['10', 0];
  }
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
from PIL import Image
from diffusers import QwenImage21Pipeline

MODEL_ID = ${JSON.stringify(modelRepo)}
REF_IMAGE = json.loads(${JSON.stringify(JSON.stringify(referenceImage))})
STEPS = ${steps}
VIEWS = json.loads(${JSON.stringify(serializedViews)})

def main():
    pipe = QwenImage21Pipeline.from_pretrained(MODEL_ID, torch_dtype=torch.bfloat16)
    if torch.cuda.is_available():
        pipe.enable_model_cpu_offload()
    if REF_IMAGE and not os.path.isfile(REF_IMAGE):
        raise FileNotFoundError(REF_IMAGE)
    ref_img = Image.open(REF_IMAGE).convert("RGBA") if REF_IMAGE else None

    for idx, item in enumerate(VIEWS):
        w, h = [int(x) for x in item["resolution"].split("x")]
        os.makedirs(os.path.dirname(item["outPath"]), exist_ok=True)
        kwargs = dict(
            prompt=item["positivePrompt"],
            num_inference_steps=STEPS,
            generator=torch.Generator("cuda" if torch.cuda.is_available() else "cpu").manual_seed(42 + idx),
        )
        if ref_img is not None:
            kwargs["image"] = ref_img
        else:
            kwargs["width"] = w
            kwargs["height"] = h
        img = pipe(**kwargs).images[0]
        img.save(item["outPath"])
        print("SAVED", item["slotId"], item["outPath"])

if __name__ == "__main__":
    main()
`;
}

async function executeComfyPrompt({ comfyuiUrl, workflow, timeoutMs = 180000, fetchImpl = fetch }) {
  const base = stripSlash(comfyuiUrl || DEFAULT_COMFYUI_URL);
  const submitRes = await fetchImpl(`${base}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow }),
  });
  if (!submitRes.ok) {
    throw new Error(`ComfyUI /prompt HTTP ${submitRes.status}: ${await submitRes.text()}`);
  }
  const { prompt_id: promptId } = await submitRes.json();
  if (!promptId) throw new Error('ComfyUI did not return a prompt_id');

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1200));
    const histRes = await fetchImpl(`${base}/history/${encodeURIComponent(promptId)}`);
    if (!histRes.ok) continue;
    const hist = await histRes.json();
    const record = hist[promptId];
    if (record?.status?.status_str === 'error') throw new Error('ComfyUI execution failed; inspect its history');
    if (!record || !record.outputs) continue;
    for (const nodeOut of Object.values(record.outputs)) {
      if (Array.isArray(nodeOut?.images) && nodeOut.images.length > 0) {
        const imgInfo = nodeOut.images[0];
        const q = new URLSearchParams({
          filename: imgInfo.filename,
          subfolder: imgInfo.subfolder || '',
          type: imgInfo.type || 'output',
        });
        const viewRes = await fetchImpl(`${base}/view?${q.toString()}`);
        if (!viewRes.ok) throw new Error(`ComfyUI /view HTTP ${viewRes.status}`);
        return Buffer.from(await viewRes.arrayBuffer());
      }
    }
  }
  throw new Error(`ComfyUI generation timed out after ${timeoutMs}ms (prompt_id=${promptId})`);
}

async function executeNovelAi({
  apiKey,
  modelName = 'nai-diffusion-5-full',
  view,
  seed = 42,
  referenceImageBase64 = null,
  fetchImpl = fetch,
}) {
  if (!apiKey) {
    throw new Error('NovelAI API token not configured. Use the workbench credential form or NOVELAI_API_KEY.');
  }
  const [width, height] = parseResolution(view.resolution, [832, 1216]);
  const parameters = {
    params_version: 3,
    width,
    height,
    scale: 5.0,
    sampler: 'k_euler_ancestral',
    steps: 28,
    n_samples: 1,
    ucPreset: 0,
    qualityToggle: true,
    seed,
    negative_prompt: view.negativePrompt,
    v4_prompt: {
      caption: { base_caption: view.positivePrompt, char_captions: [] },
      use_coords: false,
      use_order: true,
    },
    v4_negative_prompt: {
      caption: { base_caption: view.negativePrompt, char_captions: [] },
    },
  };

  if (referenceImageBase64 && modelName.includes('4-5') && view.preciseReferenceHint) {
    parameters.director_reference_images = [referenceImageBase64];
    parameters.director_reference_descriptions = [
      {
        caption: { base_caption: 'character&style', char_captions: [] },
        legacy_uc: false,
      },
    ];
    parameters.director_reference_information_extracted = [1.0];
    parameters.director_reference_strength_values = [view.preciseReferenceHint.strength ?? 0.52];
    parameters.director_reference_secondary_strength_values = [1.0 - (view.preciseReferenceHint.fidelity ?? 0.9)];
  }

  const res = await fetchImpl(`${DEFAULT_NOVELAI_IMAGE_URL}/ai/generate-image`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/zip, image/png',
    },
    body: JSON.stringify({
      input: view.positivePrompt,
      model: modelName,
      action: 'generate',
      parameters,
    }),
  });
  if (!res.ok) {
    throw new Error(`NovelAI HTTP ${res.status}: ${(await res.text()).slice(0, 240)}`);
  }
  const zipBytes = Buffer.from(await res.arrayBuffer());
  return extractFirstFileFromZip(zipBytes);
}

async function executeOpenAiCompat({
  baseUrl = DEFAULT_OPENAI_COMPAT_URL,
  apiKey,
  apiModel = 'seedream-5.5',
  view,
  rgbaTransparent = true,
  referenceImageBuffer = null,
  fetchImpl = fetch,
}) {
  if (referenceImageBuffer) throw new Error('Reference editing is not configured for this OpenAI-compatible adapter; use Qwen offline runner or Gemini');
  const endpoint = `${stripSlash(baseUrl)}/images/generations`;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const body = {
    model: apiModel,
    prompt: view.positivePrompt,
    size: view.resolution,
    n: 1,
    response_format: 'b64_json',
  };
  if (rgbaTransparent && apiModel.startsWith('gpt-image')) {
    body.background = 'transparent';
  }

  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`OpenAI-compat image endpoint (${endpoint}) HTTP ${res.status}: ${(await res.text()).slice(0, 240)}`);
  }
  const json = await res.json();
  const item = json?.data?.[0];
  if (item?.b64_json) return Buffer.from(item.b64_json, 'base64');
  if (item?.url) {
    const imgRes = await fetchImpl(item.url);
    if (!imgRes.ok) throw new Error(`Image download URL HTTP ${imgRes.status}`);
    return Buffer.from(await imgRes.arrayBuffer());
  }
  throw new Error('Image endpoint response contained neither data[0].b64_json nor data[0].url');
}

async function executeGemini({
  apiKey,
  apiModel = 'gemini-3.1-flash-image-preview',
  view,
  referenceImageBuffer = null,
  fetchImpl = fetch,
}) {
  if (!apiKey) {
    throw new Error('Gemini API key not configured. Use the workbench credential form or GEMINI_API_KEY.');
  }
  const parts = [];
  if (referenceImageBuffer) {
    parts.push({
      inlineData: {
        mimeType: 'image/png',
        data: referenceImageBuffer.toString('base64'),
      },
    });
  }
  parts.push({ text: view.positivePrompt });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(apiModel)}:generateContent`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    }),
  });
  if (!res.ok) {
    throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 240)}`);
  }
  const json = await res.json();
  for (const cand of json?.candidates || []) {
    for (const part of cand?.content?.parts || []) {
      if (part?.inlineData?.data) {
        return Buffer.from(part.inlineData.data, 'base64');
      }
    }
  }
  throw new Error('Gemini response did not include an inlineData image payload');
}

/**
 * Generate or dry-run compile the 8+3 character turnaround views and persist workflows/images into project state.
 */
export function runTurnaroundGeneration(options = {}) {
  return exclusiveProjectOperation(options.projectDir, () => generateViews(options));
}
async function generateViews({
  projectDir,
  modelId = 'qwen-image-2.1-local',
  apiModelOverride = '',
  characterPrompt = '',
  artistTag = '',
  animaVariant = 'base',
  rgbaTransparent = true,
  slots,
  mode = 'plan_and_export_workflows', // 'plan_and_export_workflows' | 'execute'
  endpoints = {},
  secrets = {},
  modelFiles = {},
  timeoutMs = 180000,
  fetchImpl = fetch,
} = {}) {
  if (!['plan_and_export_workflows', 'execute'].includes(mode)) throw new Error('Invalid generation mode');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 1800000) throw new Error('Invalid image request timeout');
  const absRoot = await ensureProjectLayout(projectDir);
  const loaded = await loadProjectState(absRoot);
  if (!loaded.exists) throw new Error('Initialize project before generating views');
  const state = loaded.state;

  const effectivePrompt =
    characterPrompt ||
    state?.characterSpec?.characterPrompt ||
    'anime girl in navy academy blazer, red ribbon, pleated skirt, knee-high socks, loafers';

  const pack = compileTurnaroundPromptPack({
    modelId,
    characterPrompt: effectivePrompt,
    artistTag,
    animaVariant,
    rgbaTransparent,
    slots,
  });

  const modelEntry = IMAGE_MODEL_CATALOG.find((m) => m.id === modelId);
  if (mode === 'execute' && !['qwen_local', 'comfyui_anima'].includes(modelEntry.driver) && !apiModelOverride.trim()) throw new Error('Cloud execution requires explicit apiModelOverride from the provider; leaderboard names are not API IDs');
  const refPath = state?.characterSpec?.sourceImages?.[0] || null;

  // Always export reproducible workflow / batch script artifacts so local ComfyUI & Qwen users have 1-click files
  const exportedArtifacts = [];
  if (modelEntry.driver === 'comfyui_anima') {
    for (const v of pack.views) {
      const [w, h] = parseResolution(v.resolution, [896, 1344]);
      const wf = buildAnimaComfyWorkflow({
        positivePrompt: v.positivePrompt,
        negativePrompt: v.negativePrompt,
        width: w,
        height: h,
        variant: animaVariant,
        modelFiles,
        filenamePrefix: `charakuru_${v.slotId}`,
      });
      const wfFile = path.join(absRoot, 'views', 'workflows', `anima_${v.slotId}.comfy.json`);
      await fs.writeFile(wfFile, `${JSON.stringify(wf, null, 2)}\n`, 'utf8');
      exportedArtifacts.push(wfFile);
    }
  } else if (modelEntry.driver === 'qwen_local') {
    const pyPath = path.join(absRoot, 'views', 'workflows', 'run_qwen_image_21_views.py');
    const scriptText = buildQwenLocalDiffusersScript({
      projectDir: absRoot,
      views: pack.views,
      referenceImage: refPath ? path.resolve(absRoot, refPath) : null,
      turbo: false,
    });
    await fs.writeFile(pyPath, scriptText, 'utf8');
    exportedArtifacts.push(pyPath);
  }

  const promptManifestPath = path.join(absRoot, 'views', 'workflows', `prompts_${modelEntry.id}.json`);
  await fs.writeFile(promptManifestPath, `${JSON.stringify(pack, null, 2)}\n`, 'utf8');
  exportedArtifacts.push(promptManifestPath);

  if (mode !== 'execute') {
    return {
      mode: 'plan_and_export_workflows',
      projectDir: absRoot,
      model: pack.model,
      exportedArtifacts,
      views: pack.views,
      global3dPrepChecklistZh: pack.global3dPrepChecklistZh,
    };
  }

  let refBuffer = null;
  if (refPath) {
    refBuffer = await fs.readFile(path.resolve(absRoot, refPath));
    validatePng(refBuffer);
    if (modelEntry.driver === 'comfyui_anima') throw new Error('Anima workflow is text-to-image only; reference conditioning requires a custom workflow');
    if (modelEntry.driver === 'novelai' && !apiModelOverride.includes('4-5')) throw new Error('Precise Reference is configured for NovelAI V4.5 only');
  }

  const results = [];
  for (let i = 0; i < pack.views.length; i++) {
    const view = pack.views[i];
    const outFile = path.join(absRoot, 'views', view.group, `${view.slotId}.png`);
    try {
      let pngBytes = await withNetworkTimeout(fetchImpl, timeoutMs, async (boundedFetch) => {
      let pngBytes;
      if (modelEntry.driver === 'comfyui_anima') {
        const [w, h] = parseResolution(view.resolution, [896, 1344]);
        const wf = buildAnimaComfyWorkflow({
          positivePrompt: view.positivePrompt,
          negativePrompt: view.negativePrompt,
          width: w,
          height: h,
          seed: 1000 + i,
          variant: animaVariant,
          modelFiles,
          filenamePrefix: `charakuru_${view.slotId}`,
        });
        pngBytes = await executeComfyPrompt({
          comfyuiUrl: endpoints.comfyuiUrl || DEFAULT_COMFYUI_URL,
          workflow: wf,
          fetchImpl: boundedFetch,
        });
      } else if (modelEntry.driver === 'qwen_local') {
        pngBytes = await executeOpenAiCompat({
          baseUrl: `${stripSlash(endpoints.qwenImageUrl || DEFAULT_QWEN_IMAGE_URL).replace(/\/v1$/, '')}/v1`,
          apiKey: '',
          apiModel: apiModelOverride || 'Qwen/Qwen-Image-2.1',
          view,
          rgbaTransparent,
          referenceImageBuffer: refBuffer,
          fetchImpl: boundedFetch,
        });
      } else if (modelEntry.driver === 'novelai') {
        pngBytes = await executeNovelAi({
          apiKey: secrets.novelai,
          modelName: apiModelOverride || modelEntry.apiModelIds?.[0] || 'nai-diffusion-5-full',
          view,
          seed: 2026 + i,
          referenceImageBase64: refBuffer ? refBuffer.toString('base64') : null,
          fetchImpl: boundedFetch,
        });
      } else if (modelEntry.driver === 'gemini') {
        pngBytes = await executeGemini({
          apiKey: secrets.gemini,
          apiModel: apiModelOverride || modelEntry.apiModelIds?.[0] || 'gemini-3.1-flash-image-preview',
          view,
          referenceImageBuffer: refBuffer,
          fetchImpl: boundedFetch,
        });
      } else {
        pngBytes = await executeOpenAiCompat({
          baseUrl: endpoints.openaiCompatBaseUrl || DEFAULT_OPENAI_COMPAT_URL,
          apiKey: secrets.openai_compat,
          apiModel: apiModelOverride || modelEntry.apiModelIds?.[0] || 'seedream-5.5',
          view,
          rgbaTransparent,
          referenceImageBuffer: refBuffer,
          fetchImpl: boundedFetch,
        });
      }

      return pngBytes;
      });
      pngBytes = validatePng(pngBytes);
      await writeArtifactAtomic(outFile, pngBytes);
      results.push({ slotId: view.slotId, ok: true, filePath: outFile, bytes: pngBytes.length });
    } catch (err) {
      results.push({
        slotId: view.slotId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await updateProjectState(absRoot, next => {
    for (const result of results) if (result.ok) next.views[result.slotId] = { ...next.views[result.slotId], status: 'ready', filePath: result.filePath, modelUsed: modelId, updatedAt: new Date().toISOString() };
    next.auditLog.push({ at: new Date().toISOString(), event: 'views.generated', detail: results.filter(r => r.ok).length + '/' + results.length + ' via ' + modelId });
  });
  const successCount = results.filter(r => r.ok).length;
  return {
    ok: successCount === results.length,
    verdict: successCount === results.length ? 'pass' : successCount ? 'degraded' : 'fail',
    mode: 'execute',
    projectDir: absRoot,
    model: pack.model,
    exportedArtifacts,
    results,
  };
}
