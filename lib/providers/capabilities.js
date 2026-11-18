import { IMAGE_MODEL_CATALOG } from '../catalog/aa-image-hub.js';

// Adapter capability, not a claim about the underlying model or account entitlement.
export function imagePreflight({ modelId = 'qwen-image-2.1-local', apiModelOverride = '', hasReference = false, referenceCount = hasReference ? 1 : 0, mode = 'execute', animaVariant = 'base', modelFiles = {} } = {}) {
  const model = IMAGE_MODEL_CATALOG.find(m => m.id === modelId);
  if (!model) return { allowed: false, reasons: ['未知模型，请刷新模型目录。'], modelId };
  const driver = model.driver, live = mode === 'execute', reasons = [];
  if (referenceCount > 1) reasons.push('当前适配器只接收一张参考图；请显式选择主参考，不能静默忽略其余图片。');
  const cloud = !['qwen_local', 'comfyui_anima'].includes(driver);
  const referenceEdit = driver === 'gemini' || driver === 'novelai' && apiModelOverride.includes('4-5');
  if (live && cloud && !apiModelOverride.trim()) reasons.push('云端执行需要供应商实际 API 模型 ID；榜单名称不是 API ID。');
  if (live && hasReference && !referenceEdit) {
    reasons.push(driver === 'qwen_local' ? 'Qwen 在线兼容接口仅文生图；请导出 Diffusers 参考编辑脚本，运行后扫描登记图片。' : driver === 'comfyui_anima' ? 'Anima 内置工作流仅文生图，未接入参考条件；请导入自定义工作流生成的图片。' : driver === 'novelai' ? '本适配器 Precise Reference 仅支持 NovelAI V4.5，不能对 V5 静默丢弃参考图。' : '此兼容接口未实现参考编辑；请改用 Gemini、NovelAI V4.5 或离线 Qwen。');
  }
  if (driver === 'comfyui_anima' && animaVariant === 'aesthetic' && !modelFiles.unet) reasons.push('Anima Aesthetic 需要指定匹配的 UNet 文件名。');
  return { allowed: reasons.length === 0, reasons, modelId, driver, mode, hasReference, cloud, referenceEdit, offlineReferenceEdit: driver === 'qwen_local', verification: 'contract_tested_not_live_certified', licenseNotice: model.licenseNotice || '' };
}
export function assertImagePreflight(options) {
  const result = imagePreflight(options);
  if (!result.allowed) throw new Error(`IMAGE_PREFLIGHT_BLOCKED: ${result.reasons.join(' ')}`);
  return result;
}
