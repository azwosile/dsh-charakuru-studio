import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const QWEN_NODES = new Set([
  'LoadImage', 'TextEncodeQwenImage21', 'QwenImage21Cache', 'UNETLoader', 'CLIPLoader', 'VAELoader',
  'ModelSamplingAuraFlow', 'CFGNorm', 'KSampler', 'VAEDecode', 'VAEDecodeTiled', 'SaveImage',
]);
const NODE_ID = /^[0-9]+(?::[0-9]+)*$/;
const safeName = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,179}$/;
const asNode = (id, input) => Array.isArray(input) && input[0] === id;
const record = value => value && typeof value === 'object' && !Array.isArray(value);

function dependencies(value, found = []) {
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && NODE_ID.test(value[0]) && Number.isInteger(value[1])) {
    found.push(value[0]);
  } else if (value && typeof value === 'object') {
    for (const child of Object.values(value)) dependencies(child, found);
  }
  return found;
}

export function inspectQwenRecipe(workflow) {
  const entries = record(workflow) ? Object.entries(workflow) : [];
  if (!entries.length || entries.length > 80 || entries.some(([id, node]) => !NODE_ID.test(id) || !record(node?.inputs) || !QWEN_NODES.has(node.class_type))) {
    throw new Error('需要 ComfyUI 的 API 格式 Qwen-Image 2.1 工作流；只允许预定的本地核心节点，不接受编辑器图、自定义节点或联网节点。');
  }
  const exactly = type => {
    const match = entries.filter(([, n]) => n.class_type === type);
    if (match.length !== 1) throw new Error(`模板须恰好有一个 ${type} 节点。`);
    return match[0];
  };
  const [loadId, load] = exactly('LoadImage');
  const [encodeId, encode] = exactly('TextEncodeQwenImage21');
  const [saveId, save] = exactly('SaveImage');
  const [sampleId, sample] = exactly('KSampler');
  if (load.inputs.image !== '__DSH_REFERENCE__' || encode.inputs.prompt !== '__DSH_PROMPT__' || save.inputs.filename_prefix !== '__DSH_OUTPUT__') {
    throw new Error('模板缺少 __DSH_REFERENCE__、__DSH_PROMPT__ 或 __DSH_OUTPUT__ 输入占位。');
  }
  const inputRefs = Object.entries(encode.inputs).filter(([k]) => k === 'images' || k.startsWith('images.')).flatMap(([,v])=>dependencies(v));
  if (inputRefs.length !== 1 || inputRefs[0] !== loadId || !encode.inputs.vae ||
      !asNode(encodeId, sample.inputs.positive) || sample.inputs.positive[1] !== 0 ||
      !asNode(encodeId, sample.inputs.negative) || sample.inputs.negative[1] !== 1 ||
      !asNode(encodeId, sample.inputs.latent_image) || sample.inputs.latent_image[1] !== 2) {
    throw new Error('将唯一 Load Image 接到 Qwen 的图像输入，并用 Qwen 编码器的正向、负向和参考 latent 驱动 KSampler。');
  }
  const done = new Set(), active = new Set();
  const visit = id => {
    if (active.has(id) || !Object.hasOwn(workflow,id)) throw new Error('ComfyUI 模板中存在环或无效连接。');
    if (done.has(id)) return;
    active.add(id);
    for (const dep of dependencies(workflow[id].inputs)) visit(dep);
    active.delete(id); done.add(id);
  };
  visit(saveId);
  if (!done.has(sampleId) || !done.has(loadId) || !done.has(encodeId) || done.size !== entries.length) {
    throw new Error('仅保留从参考图经采样、解码连至唯一 Save Image 的工作流；移除预览及未连接节点。');
  }
  return { loadId, encodeId, saveId };
}

export async function loadQwenRecipe(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !/\.json$/i.test(filePath)) {
    throw new Error('请在 DSH 宿主设置 comfyuiQwenWorkflowPath 为本机 API JSON 模板的绝对路径。');
  }
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size < 2 || stat.size > 256 * 1024) throw new Error('ComfyUI API JSON 模板必须为 256 KiB 内的文件。');
  const raw = await fs.readFile(filePath);
  if (raw.length > 256 * 1024) throw new Error('ComfyUI API JSON 模板超过大小限制。');
  const workflow = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, ''));
  return { workflow, ...inspectQwenRecipe(workflow), sha256: crypto.createHash('sha256').update(raw).digest('hex') };
}

// Use a fixed loopback origin from Host config and a neutral filename. The PNG is
// not written to any third-party service by this adapter.
export async function uploadQwenReference({ comfyuiUrl, bytes, fetchImpl, referenceId = crypto.randomUUID() }) {
  const body = new FormData();
  body.append('image', new Blob([bytes], { type: 'image/png' }), `dsh-reference-${referenceId}.png`);
  body.append('type', 'input');
  body.append('overwrite', 'false');
  const res = await fetchImpl(`${comfyuiUrl}/upload/image`, { method: 'POST', body });
  if (!res.ok) throw new Error(`ComfyUI /upload/image HTTP ${res.status}`);
  const uploaded = await res.json();
  if (!safeName.test(uploaded?.name || '') || uploaded.subfolder || uploaded.type !== 'input') throw new Error('ComfyUI did not return a valid root input image');
  return uploaded.name;
}

export function renderQwenRecipe(recipe, view, uploadedName) {
  if (!safeName.test(uploadedName)) throw new Error('Unsafe ComfyUI input filename');
  const graph = structuredClone(recipe.workflow);
  graph[recipe.loadId].inputs.image = uploadedName;
  const encode = graph[recipe.encodeId].inputs;
  encode.prompt = view.positivePrompt;
  if (encode.negative_prompt === '__DSH_NEGATIVE__') encode.negative_prompt = view.negativePrompt;
  graph[recipe.saveId].inputs.filename_prefix = `dsh_${view.slotId}_${crypto.randomUUID().slice(0, 8)}`;
  return graph;
}

// Minimal local reference-edit graph. The operator may choose different
// compatible weight files and validate the result in their own ComfyUI.
export function buildQwenComfyRecipe() {
  return {
    1: { class_type: 'LoadImage', inputs: { image: '__DSH_REFERENCE__' } },
    2: { class_type: 'UNETLoader', inputs: { unet_name: 'qwen_image_2.1_int8_convrot.safetensors', weight_dtype: 'default' } },
    3: { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_8b_int8_convrot.safetensors', type: 'qwen_image', device: 'default' } },
    4: { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' } },
    5: { class_type: 'TextEncodeQwenImage21', inputs: { clip: ['3', 0], vae: ['4', 0], 'images.image_1': ['1', 0], prompt: '__DSH_PROMPT__', negative_prompt: '__DSH_NEGATIVE__', resolution: 1024 } },
    6: { class_type: 'KSampler', inputs: { model: ['2', 0], positive: ['5', 0], negative: ['5', 1], latent_image: ['5', 2], seed: 42, steps: 25, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 } },
    7: { class_type: 'VAEDecode', inputs: { samples: ['6', 0], vae: ['4', 0] } },
    8: { class_type: 'SaveImage', inputs: { images: ['7', 0], filename_prefix: '__DSH_OUTPUT__' } },
  };
}
