import { IMAGE_MODEL_CATALOG, getTurnaroundPromptTemplates, validatePromptTemplate } from '../catalog/aa-image-hub.js';
import { REQUIRED_VIEW_SLOTS } from '../constants.js';
import { loadProjectState, updateProjectState } from '../project/state.js';
import { CLOUD_CREDENTIALS, imageReferenceMode } from './capabilities.js';

const isRecord = v => v && typeof v === 'object' && !Array.isArray(v);
const asInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const within = (v,min,max) => Number.isFinite(v) && v >= min && v <= max;
const numberFields = {
  seed:v=>asInt(v,0,4294967280), steps:v=>asInt(v,1,100), cfg:v=>within(v,0,20),
  width:v=>asInt(v,64,2048)&&v%16===0,height:v=>asInt(v,64,2048)&&v%16===0,
  denoise:v=>within(v,.05,1),
  resolution:v=>asInt(v,256,2048)&&v%8===0,
};
const COMFY_KEYS = {comfyui_anima:['seed','steps','cfg','width','height'],comfyui_qwen:['seed','steps','cfg','denoise','resolution'],novelai:['seed']};
const FILES = ['unet','clip','vae'];
function modelFor(id) {
  const model=IMAGE_MODEL_CATALOG.find(m=>m.id===id);
  if (!model) throw new Error('Unknown image model');
  return model;
}
export function validateImageParameters(driver, parameters={}) {
  if (!isRecord(parameters)) throw new Error('Invalid image parameters');
  const allowed=COMFY_KEYS[driver]||[];
  for (const [key,value] of Object.entries(parameters)) {
    if (!allowed.includes(key)||!numberFields[key](value)) throw new Error(`Unsupported or out-of-range image parameter: ${key}`);
  }
  if (Object.hasOwn(parameters,'width')!==Object.hasOwn(parameters,'height')) throw new Error('Set both width and height, or leave both on auto');
  return {...parameters};
}
export function validateImageModelConfig(modelId,config={}) {
  const model=modelFor(modelId),{driver}=model;
  const allowed=driver==='catalog'?[]:[...(CLOUD_CREDENTIALS[driver]||driver==='qwen_local'?['apiModelOverride']:[]),
    ...(COMFY_KEYS[driver]?['parameters']:[]),...(['comfyui_anima','comfyui_qwen'].includes(driver)?['modelFiles']:[]),...(driver==='comfyui_anima'?['animaVariant','artistTag']:[]),...(model.nativeRgba?['rgbaTransparent']:[])];
  if (!isRecord(config)||Object.keys(config).some(key=>!allowed.includes(key))) throw new Error('These settings are not supported by this model');
  const out={};
  if (Object.hasOwn(config,'apiModelOverride')) {
    if (typeof config.apiModelOverride!=='string'||config.apiModelOverride.length>150||!/^[-\w./:]*$/.test(config.apiModelOverride.trim())) throw new Error('Enter an actual API model ID, not a URL');
    if (config.apiModelOverride.includes('://')) throw new Error('Enter an API model ID, not a URL');
    out.apiModelOverride=config.apiModelOverride.trim();
  }
  if (Object.hasOwn(config,'rgbaTransparent')) {
    if (typeof config.rgbaTransparent!=='boolean') throw new Error('Invalid transparency preference');
    out.rgbaTransparent=config.rgbaTransparent;
  }
  if (Object.hasOwn(config,'animaVariant')) {
    if (!['base','aesthetic','turbo'].includes(config.animaVariant)) throw new Error('Unknown Anima variant');
    out.animaVariant=config.animaVariant;
  }
  if (Object.hasOwn(config,'artistTag')) {
    if(typeof config.artistTag!=='string'||config.artistTag.length>180||/[\r\n\0]/.test(config.artistTag))throw new Error('Invalid Anima artist tag');
    out.artistTag=config.artistTag.trim();
  }
  if (Object.hasOwn(config,'modelFiles')) {
    const files=config.modelFiles;
    if (!isRecord(files)||Object.entries(files).some(([key,value])=>!FILES.includes(key)||typeof value!=='string'||value&& !/^[^/\\:\x00-\x1f]{1,160}\.(?:safetensors|gguf)$/i.test(value))) throw new Error('Use filenames in ComfyUI model folders, not local paths');
    out.modelFiles=Object.fromEntries(Object.entries(files).filter(([,value])=>value));
  }
  if (Object.hasOwn(config,'parameters')) out.parameters=validateImageParameters(driver,config.parameters);
  return out;
}
function requireSlot(slotId) {
  if (!REQUIRED_VIEW_SLOTS.some(s=>s.id===slotId)) throw new Error('Choose one of the 11 view slots');
  return slotId;
}
export function imageModelProfile(state,modelId) {
  modelFor(modelId);
  const profile=state?.imageProfiles?.[modelId]||{};
  const config=validateImageModelConfig(modelId,profile.config);
  if (profile.prompts!==undefined&&!isRecord(profile.prompts)) throw new Error('Invalid saved prompt profile');
  const prompts=Object.fromEntries(Object.entries(profile.prompts||{}).map(([slot,value])=>[requireSlot(slot),validatePromptTemplate(value)]));
  return {config,prompts};
}
export async function saveImageProfile({projectDir,modelId,action,config,slotId,template,expectedRevision}={}) {
  if (!Number.isSafeInteger(expectedRevision)) throw new Error('Reload before changing image settings');
  if (!['config','prompt','reset_prompt'].includes(action)) throw new Error('Unknown profile action');
  if(action==='config'&&modelFor(modelId).driver==='catalog')throw new Error('Catalog-only models have no execution configuration');
  const saved=await updateProjectState(projectDir,state=>{
    if (state.stateRevision!==expectedRevision) throw Object.assign(new Error('Project settings changed; reload before saving'),{statusCode:409});
    const profile=imageModelProfile(state,modelId);
    if(action==='config')profile.config=validateImageModelConfig(modelId,config);
    else if(action==='prompt')profile.prompts[requireSlot(slotId)]=validatePromptTemplate(template);
    else delete profile.prompts[requireSlot(slotId)];
    (state.imageProfiles||={})[modelId]=profile;
    state.auditLog.push({at:new Date().toISOString(),event:'image.profile.'+action,detail:modelId+(slotId?' / '+slotId:'')});
  });
  return {modelId,profile:imageModelProfile(saved.state,modelId),stateRevision:saved.state.stateRevision};
}
export async function readImageTemplates({projectDir,modelId,slotId}={}) {
  const {state}=await loadProjectState(projectDir),profile=imageModelProfile(state,modelId);
  const [slot]=getTurnaroundPromptTemplates({modelId,slots:[requireSlot(slotId)],animaVariant:profile.config.animaVariant,rgbaTransparent:profile.config.rgbaTransparent});
  return {modelId,slotId,defaults:{positive:slot.positivePrompt,negative:slot.negativePrompt},override:profile.prompts[slotId]||null,stateRevision:state?.stateRevision};
}
export function resolveImageOptions(state,modelId,options={}) {
  const {config,prompts}=imageModelProfile(state,modelId);
  const out={...config};
  for(const key of ['apiModelOverride','animaVariant','artistTag','rgbaTransparent'])if(options[key]!==undefined)out[key]=options[key];
  if (options.modelFiles!==undefined) out.modelFiles={...config.modelFiles,...Object.fromEntries(Object.entries(options.modelFiles).filter(([,v])=>v!==undefined))};
  const mergedParameters = options.parameters !== undefined
    ? (isRecord(options.parameters) ? { ...config.parameters, ...Object.fromEntries(Object.entries(options.parameters).filter(([, v]) => v !== undefined)) } : options.parameters)
    : config.parameters;
  out.parameters=validateImageParameters(modelFor(modelId).driver,mergedParameters);
  return {...out,referenceMode:imageReferenceMode(options),promptTemplates:prompts};
}
