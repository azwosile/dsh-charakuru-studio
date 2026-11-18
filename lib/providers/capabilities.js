import { REQUIRED_VIEW_SLOTS } from '../constants.js';
import { IMAGE_MODEL_CATALOG } from '../catalog/aa-image-hub.js';

export const QWEN_COMFY_ID = 'qwen-image-2.1-comfy-edit';
export const NOVELAI_V45 = /^nai-diffusion-4-5-(full|curated)$/;
export const NOVELAI_V5 = /^nai-diffusion-5-(full(-medium)?|curated)$/;
const GEMINI_IMAGE = /^gemini-(nano-banana-2\.1|3\.1-flash(-lite)?-image(-preview)?|3-pro-image(-preview)?|2\.5-flash-image)$/;
const ARK_IMAGE = /^(doubao-seedream-5-5-261028|ep-[a-z0-9-]+)$/;
const GPT_IMAGE = /^gpt-image-[a-z0-9.-]+$/;
export const CLOUD_CREDENTIALS = Object.freeze({novelai: 'novelai', gemini: 'gemini', openai_gpt: 'openai', ark_seedream: 'ark', openai_compat: 'openai_compat'});
const LOCAL_DRIVERS = new Set(['qwen_local', 'comfyui_anima', 'comfyui_qwen']);

// Adapter capability, not a claim about the underlying model or account entitlement.
export function imagePreflight({ modelId = 'qwen-image-2.1-local', apiModelOverride = '', hasReference = false,
  referenceCount = hasReference ? 1 : 0, referenceMode = 'project', mode = 'execute', animaVariant = 'base',
  modelFiles = {}, slots, comfyuiWorkflowConfigured = false, gatewayConfigured, credentialConfigured, cloudEnabled } = {}) {
  const model = IMAGE_MODEL_CATALOG.find(m => m.id === modelId);
  if (!model) return { allowed: false, reasons: ['未知模型，请刷新模型目录。'], modelId };
  const driver = model.driver, live = mode === 'execute', reasons = [];
  const catalogOnly = driver === 'catalog';
  const cloud = !catalogOnly && !LOCAL_DRIVERS.has(driver);
  const apiModel = typeof apiModelOverride === 'string' ? apiModelOverride.trim() : '';
  const usingReference = referenceMode === 'project' && hasReference;
  const referenceEdit = driver === 'comfyui_qwen' || driver === 'gemini' || driver === 'openai_gpt' || driver === 'ark_seedream' || (driver === 'novelai' && modelId === 'novelai-v45-reference' && NOVELAI_V45.test(apiModel));
  if (!['execute', 'plan_and_export_workflows'].includes(mode)) reasons.push('未知生成模式。');
  if (!['project', 'text_only'].includes(referenceMode)) reasons.push('未知参考图模式。');
  if (slots !== undefined && (!Array.isArray(slots) || !slots.length || slots.some(id => !REQUIRED_VIEW_SLOTS.some(slot => slot.id === id)))) reasons.push('选择一个或多个有效的视图槽位。');
  if (usingReference && referenceCount > 1) reasons.push('当前适配器只接收一张参考图；请显式选择主参考，不能静默忽略其余图片。');
  if (live && catalogOnly) reasons.push('此条目只提供榜单与提示词，不会发送生成请求。');
  if (live && cloud && !apiModel) reasons.push('云端执行需要供应商的实际 API 模型 ID；榜单名称不是 API ID。');
  if (live && cloud && cloudEnabled === false) reasons.push('CLOUD_EXECUTION_DISABLED：宿主未启用云端，或请求来自 Agent。付费请求仅在工作台由用户发起。');
  if (live && cloud && (slots?.length ?? REQUIRED_VIEW_SLOTS.length) !== 1) reasons.push('云端每次人工确认只执行一个槽位。');
  if (live && cloud && credentialConfigured === false) reasons.push('没有配置此适配的专用凭据。');
  if (live && driver === 'openai_compat' && gatewayConfigured === false) reasons.push('请先在宿主配置自己的 HTTPS 兼容网关。');
  if (live && driver === 'ark_seedream' && apiModel && !ARK_IMAGE.test(apiModel)) reasons.push('请填写官方 Seedream 5.5 模型 ID 或对应方舟接入点 ID。');
  if (live && driver === 'gemini' && apiModel && !GEMINI_IMAGE.test(apiModel)) reasons.push('请填写本适配支持的 Google 生图模型 ID，而不是榜单显示名。');
  if (live && driver === 'openai_gpt' && apiModel && !GPT_IMAGE.test(apiModel)) reasons.push('此适配只接受供应商已开放的 gpt-image-* 模型 ID。');
  if (live && driver === 'comfyui_qwen') {
    if (!usingReference) reasons.push('Qwen ComfyUI 编辑需要工程原画；请在图片库登记一张 PNG。');
    if (!comfyuiWorkflowConfigured) reasons.push('请在 DSH 宿主设置已验证的 comfyuiQwenWorkflowPath。');
  }
  if (live && driver === 'novelai') {
    if (apiModel && modelId === 'novelai-v5-cloud' && !NOVELAI_V5.test(apiModel)) reasons.push('此卡只接受 NovelAI V5 Full、Full Medium 或 Curated 实际 ID。');
    if (apiModel && modelId === 'novelai-v45-reference' && !NOVELAI_V45.test(apiModel)) reasons.push('此卡只接受 V4.5 Full 或 Curated 实际 ID。');
  }
  if (live && usingReference && !referenceEdit && !catalogOnly) {
    reasons.push(driver === 'qwen_local' ? 'Qwen 通用兼容端点只做文生图；参考编辑请选 Qwen ComfyUI 或导出 Diffusers 脚本。' :
      driver === 'comfyui_anima' ? 'Anima 内置工作流只做文生图；可明确选「仅文字」试样，或使用支持参考图的驱动。' :
      driver === 'novelai' ? '此适配的 Precise Reference 仅支持 NovelAI V4.5；V5 不会静默丢弃原画。' :
      '此通用兼容端点只做文生图；参考编辑请改用支持参考图的驱动。');
  }
  if (driver === 'comfyui_anima' && !['base', 'aesthetic', 'turbo'].includes(animaVariant)) reasons.push('未知的 Anima 分支。');
  if (driver === 'comfyui_anima' && modelFiles?.unet && (typeof modelFiles.unet !== 'string' || !/^[^/\\:]{1,160}\.safetensors$/i.test(modelFiles.unet))) reasons.push('Anima UNet 请输入本机 diffusion_models 下的权重文件名。');
  return { allowed: reasons.length === 0, reasons, modelId, driver, mode, hasReference, usingReference, referenceMode, cloud,
    catalogOnly, referenceEdit, offlineReferenceEdit: driver === 'qwen_local', verification: 'contract_tested_not_live_certified', licenseNotice: model.licenseNotice || '' };
}
export function assertImagePreflight(options) {
  const result = imagePreflight(options);
  if (!result.allowed) throw new Error(`IMAGE_PREFLIGHT_BLOCKED: ${result.reasons.join(' ')}`);
  return result;
}
