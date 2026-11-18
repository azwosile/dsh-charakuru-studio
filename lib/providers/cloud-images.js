import { DEFAULT_NOVELAI_IMAGE_URL } from '../constants.js';
import { NOVELAI_V5 } from './capabilities.js';

export const OPENAI_IMAGES_URL = 'https://api.openai.com/v1';
export const ARK_IMAGES_URL = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const MAX_IMAGE = 20 * 1024 * 1024;

export async function readLimitedResponse(response, limit = MAX_IMAGE) {
  const len = Number(response.headers.get('content-length'));
  if (len > limit) {
    await response.body?.cancel();
    throw new Error('Provider response exceeds the maximum allowed size');
  }
  const chunks = [];
  let total = 0;
  if (response.body) for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > limit) throw new Error('Provider response exceeds the maximum allowed size');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}
export async function readProviderJson(res) {
  return JSON.parse((await readLimitedResponse(res, Math.ceil(MAX_IMAGE / 3) * 4 + 1024 * 1024)).toString('utf8'));
}
function decodeBase64(value) {
  if (typeof value !== 'string' || !value.length || value.length > Math.ceil(MAX_IMAGE / 3) * 4 || value.length % 4) {
    throw new Error('Provider did not return a bounded base64 PNG');
  }
  return Buffer.from(value, 'base64');
}
export async function readImagesApi(res, provider) {
  if (!res.ok) throw new Error(`${provider} HTTP ${res.status}`);
  return decodeBase64((await readProviderJson(res))?.data?.[0]?.b64_json);
}

export async function requestNovelAi({ apiKey, apiModel, view, seed, reference, rgbaTransparent, fetchImpl }) {
  const [width, height] = view.resolution.split('x').map(Number);
  const isV5 = NOVELAI_V5.test(apiModel);
  const medium = apiModel.endsWith('-medium');
  const parameters = {
    params_version: isV5 ? 4 : 3,
    width, height, scale: isV5 ? 7 : 5,
    sampler: 'k_euler_ancestral', steps: isV5 ? (medium ? 14 : 23) : 28, n_samples: 1, seed,
    negative_prompt: view.negativePrompt,
    v4_prompt: { caption: { base_caption: view.positivePrompt, char_captions: [] }, use_coords: false, use_order: true },
    v4_negative_prompt: { caption: { base_caption: view.negativePrompt, char_captions: [] }, legacy_uc: false },
  };
  if (isV5) {
    Object.assign(parameters, { skip_cfg_above_sigma: null, noise_schedule: 'karras', ucPresetId: 'heavy', qualityPresetId: 'standard', straight_alpha: true, tag_hint_qt: 1, tag_hint_uc_preset: 2 });
    if (rgbaTransparent) parameters.tag_hint_transparent_background = true;
  } else Object.assign(parameters, { ucPreset: 0, qualityToggle: true });
  if (reference) {
    if (isV5 || !view.preciseReferenceHint) throw new Error('NovelAI V5 cannot take a reference in this adapter');
    parameters.director_reference_images = [reference.toString('base64')];
    parameters.director_reference_descriptions = [{ caption: { base_caption: 'character&style', char_captions: [] }, legacy_uc: false }];
    parameters.director_reference_information_extracted = [1.0];
    parameters.director_reference_strength_values = [view.preciseReferenceHint.strength];
    parameters.director_reference_secondary_strength_values = [1 - view.preciseReferenceHint.fidelity];
  }
  const payload = JSON.stringify({ input: view.positivePrompt, model: apiModel, action: 'generate', parameters });
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/zip, image/png' };
  let body = payload;
  if (isV5) {
    body = new FormData();
    body.append('request', new Blob([payload], { type: 'application/json' }), 'blob');
  } else headers['Content-Type'] = 'application/json';
  const res = await fetchImpl(`${DEFAULT_NOVELAI_IMAGE_URL}/ai/generate-image`, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`NovelAI HTTP ${res.status}`);
  return readLimitedResponse(res);
}

export async function requestOpenAi({ apiKey, apiModel, view, reference, rgbaTransparent, fetchImpl }) {
  const params = { model: apiModel, prompt: view.positivePrompt, size: view.resolution, n: 1, output_format: 'png' };
  // The adapter does not forward an Arena sampling tier or a guessed gateway parameter.
  if (rgbaTransparent && /^gpt-image-2\.[56]-(sunburst|flare)(-\d{4}-\d\d-\d\d)?$/.test(apiModel)) params.background = 'transparent';
  const headers = { Authorization: `Bearer ${apiKey}` };
  let body;
  if (reference) {
    body = new FormData();
    for (const [key,value] of Object.entries(params)) body.append(key, String(value));
    body.append('image[]', new Blob([reference], { type: 'image/png' }), 'reference.png');
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(params);
  }
  return readImagesApi(await fetchImpl(`${OPENAI_IMAGES_URL}/images/${reference ? 'edits' : 'generations'}`, { method: 'POST', headers, body }), 'OpenAI Images');
}

export async function requestSeedream({ apiKey, apiModel, view, reference, fetchImpl }) {
  // Ark's 2K sizing is intentional; the compiled prompt still specifies the framing.
  const params = { model: apiModel, prompt: view.positivePrompt, size: '2K', output_format: 'png', response_format: 'b64_json', watermark: true };
  if (reference) {
    if (reference.length > 10_000_000) throw new Error('Ark reference PNG exceeds 10 MB; export a smaller PNG');
    params.image = `data:image/png;base64,${reference.toString('base64')}`;
  }
  const res = await fetchImpl(ARK_IMAGES_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify(params) });
  return readImagesApi(res, 'Volcano Ark');
}

export async function requestGemini({ apiKey, apiModel, view, reference, fetchImpl }) {
  const parts = [];
  if (reference) parts.push({ inlineData: { mimeType: 'image/png', data: reference.toString('base64') } });
  parts.push({ text: view.positivePrompt });
  const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(apiModel)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: view.group === 'head' ? '1:1' : '2:3' },
    } }),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const json = await readProviderJson(res);
  for (const candidate of json?.candidates || []) {
    for (const part of candidate?.content?.parts || []) if (part?.inlineData?.mimeType === 'image/png' && part.inlineData.data && !part.thought) return decodeBase64(part.inlineData.data);
  }
  throw new Error('Gemini response did not include a final inline PNG');
}
