import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadProjectState, updateProjectState, initOrUpdateProject } from './state.js';
import { scopedFile } from './reviews.js';
import { redactSecrets } from '../contracts/lossless.js';
import { exclusiveProjectOperation } from './operations.js';
import { probeBlenderPluginLink, extractStageResult } from '../blender/bridge.js';
import { executeCompanionStage, collectCompanionJob, cancelCompanionJob } from '../blender/transport.js';
import { validateGlb } from '../tripo/free-quota-scheduler.js';
import { resolveProjectMaterial } from './materials.js';
import { revisionFromSelectedBody } from './workflow.js';

export const EDITOR_OPERATIONS = [
  'import_blend','import_checkpoint','import_material_scene','append_material_mesh','normalize_material_mesh','apply_material_texture',
  'fit_foundation','append_foundation_head','fit_garment','audit_penetration','rigid_attach',
  'smart_mesh_retexture','apply_mtoon','expression_lab','physics_oscillation_audit',
  'audit','head_scale','transform','materials','transfer_weights','normalize_weights','configure_vrm','spring_setup','pose_check','export_vrm',
];
const IMPORT_OPERATIONS = ['import_blend', 'import_checkpoint', 'import_material_scene'];
const MATERIAL_INTENTS = Object.freeze({
  import_material_scene: 'scene',
  append_material_mesh: 'mesh',
  normalize_material_mesh: ['mesh', 'candidate'],
  apply_material_texture: 'texture',
  append_foundation_head: 'foundation_head',
});
const CAMERA_VIEWS = ['front', 'back', 'left', 'right', 'perspective'];
export const AI_EDIT_INTENTS = Object.freeze({
  general:[
    'audit','head_scale','transform','materials','transfer_weights','normalize_weights',
    'configure_vrm','spring_setup','pose_check','export_vrm','fit_foundation','append_foundation_head',
    'append_material_mesh','apply_material_texture','normalize_material_mesh','fit_garment','audit_penetration','rigid_attach',
    'smart_mesh_retexture','apply_mtoon','expression_lab','physics_oscillation_audit',
  ],
  foundation_fit:['fit_foundation','head_scale'],
  foundation_head:['append_foundation_head','audit'],
  placement:['transform','head_scale','append_material_mesh','apply_material_texture','normalize_material_mesh','fit_garment','audit_penetration','rigid_attach','smart_mesh_retexture','apply_mtoon','audit'],
  rigging:['transform','transfer_weights','normalize_weights','configure_vrm','spring_setup','pose_check','physics_oscillation_audit','audit_penetration','rigid_attach','audit'],
  delivery:['configure_vrm','export_vrm','materials','apply_mtoon','expression_lab','physics_oscillation_audit','smart_mesh_retexture','audit','audit_penetration'],
  expressions:['expression_lab','audit','export_vrm'],
});
const foundationIntent = name => ['foundation_fit','foundation_head'].includes(name);
const id = () => crypto.randomUUID();
export const EDITOR_CHANNELS = ['auto', 'plugin', 'computer_use'];
const schema = () => ({ version:1, activeRevisionId:null, revisions:[], pendingJob:null, requests:[], channelPreference:'auto', guiCheckout:null, view:{camera:'front',overlayAssetId:null,overlayOpacity:0.35} });
function revision(state, revisionId) { const found=state.editor?.revisions.find(r=>r.id===revisionId);if(!found)throw new Error('Editor revision not found');return found; }
function checkBase(state, expectedRevisionId, { allowGuiCheckout = false } = {}) {
  if(expectedRevisionId!==undefined && expectedRevisionId!==(state.editor?.activeRevisionId||null))throw new Error('Editor base revision changed; reload before editing');
  if(state.editor?.pendingJob)throw new Error('Editor job is pending; collect or cancel it before submitting another operation');
  if(!allowGuiCheckout && state.editor?.guiCheckout?.status==='checked_out')throw new Error('An editor GUI working copy is already checked out; check in or abort it first');
}
const isPlainObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmptyStr = (v, max = 160) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const numbers = (x, n, min, max) => Array.isArray(x) && x.length === n && x.every(v => Number.isFinite(v) && v >= min && v <= max);
const names = (v, max) => Array.isArray(v) && v.length > 0 && v.length <= max && new Set(v).size === v.length && v.every(n => typeof n === 'string' && n.trim() && n.length <= 160);
const optionalNames = (v, max) => Array.isArray(v) && v.length <= max && new Set(v).size === v.length && v.every(n => nonEmptyStr(n, 160));
const ALLOWED_POSES = new Set(['rest', 'head_turn', 'arm_raise', 'elbow_bend', 'high_kick', 'squat']);
const SPRING_MODES = ['append', 'replace', 'strict'];
const MATERIAL_ID_RE = /^material_[a-f0-9-]{36}$/;
const RETEXTURE_GROUPS = ['hair', 'head', 'upper_body', 'lower_body', 'accessories'];
const RETEXTURE_VIEW_SLOTS = ['front', 'right', 'left', 'back'];
const RETEXTURE_TEXTURE_SIZES = new Set([1024, 2048, 4096]);
const MTOON_OUTLINE_MODES = ['none', 'worldCoordinates', 'screenCoordinates'];
const EXPRESSION_LAB_PRESETS = [
  'happy', 'angry', 'sad', 'relaxed', 'surprised',
  'blink', 'blinkLeft', 'blinkRight',
  'aa', 'ih', 'ou', 'ee', 'oh', 'neutral',
];
const RETEXTURE_KEYS = ['groups', 'textureSize', 'smartUvAngleDeg', 'uvMargin', 'delight', 'viewImageMaterialIds', 'separatePhysicsGroup'];
const MTOON_KEYS = [
  'shadeColor', 'shadingShift', 'shadingToony', 'matcapMaterialId', 'matcapFactor',
  'rimColor', 'rimFresnelPower', 'rimLift', 'outlineWidthMode', 'outlineWidthFactor', 'outlineColor',
];
const EXPRESSION_LAB_KEYS = ['headMesh', 'presets', 'excludeHairByBbox', 'hairVertexGroups', 'intensity', 'bindVrm1', 'overwriteExisting'];
const PHYSICS_AUDIT_KEYS = ['frames', 'amplitudeDeg', 'compareSpringOff'];

function validateOptionFields(obj, label, rules) {
  if (!isPlainObj(obj)) throw new Error(`${label} must be an object`);
  for (const key of Object.keys(obj)) {
    if (!Object.hasOwn(rules, key)) throw new Error(`Unknown ${label}.${key} parameter`);
    const rule = rules[key], val = obj[key];
    if (val === undefined) continue;
    if (rule.type === 'bool' && typeof val !== 'boolean') throw new Error(`${label}.${key} must be a boolean`);
    else if (rule.type === 'num' && (!Number.isFinite(val) || val < rule.min || val > rule.max)) throw new Error(`${label}.${key} must be between ${rule.min} and ${rule.max}`);
    else if (rule.type === 'gt_num' && (!Number.isFinite(val) || val <= rule.min || val > rule.max)) throw new Error(`${label}.${key} must be > ${rule.min} and <= ${rule.max}`);
    else if (rule.type === 'int' && (!Number.isInteger(val) || val < rule.min || val > rule.max)) throw new Error(`${label}.${key} must be an integer between ${rule.min} and ${rule.max}`);
    else if (rule.type === 'str' && !nonEmptyStr(val, rule.max || 160)) throw new Error(`${label}.${key} must be a non-empty string`);
    else if (rule.type === 'enum' && !rule.values.includes(val)) throw new Error(`Invalid ${label}.${key}`);
    else if (rule.type === 'names' && !optionalNames(val, rule.max || 32)) throw new Error(`${label}.${key} must be unique non-empty names`);
    else if (rule.type === 'regex' && (typeof val !== 'string' || !rule.pattern.test(val))) throw new Error(`Invalid ${label}.${key}`);
  }
}

function validateBoolOrOption(value, label, rules) {
  if (typeof value === 'boolean') return;
  if (!isPlainObj(value)) throw new Error(`${label} must be a boolean or bounded option object`);
  validateOptionFields(value, label, rules);
}

const GARMENT_OPTION_RULES = Object.freeze({
  landmarkFit: { enabled: { type: 'bool' }, uniform: { type: 'bool' }, scaleUniform: { type: 'bool' }, uniformScale: { type: 'bool' }, alignX: { type: 'bool' }, alignY: { type: 'bool' }, alignZ: { type: 'bool' }, preserveAspect: { type: 'bool' }, padding: { type: 'num', min: 0, max: 0.2 }, margin: { type: 'num', min: -0.1, max: 0.2 }, minScale: { type: 'num', min: 0.1, max: 1 }, maxScale: { type: 'num', min: 1, max: 5 }, mode: { type: 'enum', values: ['auto', 'bbox', 'landmarks'] } },
  hollowShell: { enabled: { type: 'bool' }, angleDeg: { type: 'num', min: 0, max: 180 }, angleLimitDeg: { type: 'num', min: 0, max: 180 }, normalThreshold: { type: 'num', min: -1, max: 1 }, interiorDotThreshold: { type: 'num', min: -1, max: 1 }, minThickness: { type: 'num', min: 0, max: 0.2 }, capOnly: { type: 'bool' }, removeBottom: { type: 'bool' }, removeTop: { type: 'bool' }, deleteInnerFaces: { type: 'bool' } },
  delightAlbedo: { enabled: { type: 'bool' }, strength: { type: 'num', min: 0, max: 1 }, shadowThreshold: { type: 'num', min: 0, max: 1 }, aoThreshold: { type: 'num', min: 0, max: 1 }, lift: { type: 'num', min: 0, max: 1 }, clampMin: { type: 'num', min: 0, max: 1 }, clampMax: { type: 'num', min: 0, max: 1 }, gamma: { type: 'num', min: 0.2, max: 3 } },
  correctiveSmooth: { enabled: { type: 'bool' }, factor: { type: 'num', min: 0, max: 1 }, iterations: { type: 'int', min: 0, max: 50 }, smoothType: { type: 'enum', values: ['SIMPLE', 'LENGTH_WEIGHTED'] }, restSource: { type: 'enum', values: ['ORCO', 'BIND'] }, usePinBoundary: { type: 'bool' } },
  weightSmooth: { enabled: { type: 'bool' }, sourceMesh: { type: 'str' }, maxTransferDistance: { type: 'gt_num', min: 0, max: 1 }, iterations: { type: 'int', min: 0, max: 20 }, factor: { type: 'num', min: 0, max: 1 }, rigidIslands: { type: 'bool' } },
  resolvePenetration: { enabled: { type: 'bool' }, margin: { type: 'num', min: 0, max: 0.03 }, maxPush: { type: 'num', min: 0.001, max: 0.08 }, iterations: { type: 'int', min: 1, max: 10 } },
});

const REGION_SCALING_RULES = Object.freeze({
  preserveHead: { type: 'bool' },
  legScale: { type: 'num', min: 0.5, max: 1.8 },
  torsoScale: { type: 'num', min: 0.5, max: 1.8 },
  shoulderWidthScale: { type: 'num', min: 0.5, max: 1.8 },
  waistScale: { type: 'num', min: 0.5, max: 1.8 },
  hipScale: { type: 'num', min: 0.5, max: 1.8 },
  armScale: { type: 'num', min: 0.5, max: 1.8 },
  neckBone: { type: 'str' },
  headBone: { type: 'str' },
  hipsBone: { type: 'str' },
  chestBone: { type: 'str' },
});

const SKIRT_RULES = Object.freeze({
  mesh: { type: 'str' },
  waistZ: { type: 'num', min: -5, max: 5 },
  hemZ: { type: 'num', min: -5, max: 5 },
  segments: { type: 'int', min: 4, max: 24 },
  rings: { type: 'int', min: 2, max: 6 },
  rootBone: { type: 'str' },
  includeVertexGroup: { type: 'str' },
  excludeVertexGroups: { type: 'names', max: 32 },
  minRadius: { type: 'num', min: 0, max: 5 },
  maxRadius: { type: 'gt_num', min: 0, max: 5 },
  frontStiffnessMultiplier: { type: 'num', min: 1, max: 5 },
  prefix: { type: 'regex', pattern: /^[A-Za-z0-9_]{1,32}$/ },
  mode: { type: 'enum', values: SPRING_MODES },
});

async function resolveMaterialForOperation(projectDir, materialId, operation) {
  const intentSpec = Object.hasOwn(MATERIAL_INTENTS, operation) ? MATERIAL_INTENTS[operation] : null;
  if (!intentSpec) return null;
  if (Array.isArray(intentSpec)) {
    const resolved = await resolveProjectMaterial(projectDir, materialId);
    if (!intentSpec.includes(resolved.role.intent)) {
      throw new Error('所选素材不能用于此编辑操作 / Material cannot be used for this operation');
    }
    return resolved;
  }
  return resolveProjectMaterial(projectDir, materialId, intentSpec);
}

export function validateEditorParams(operation, params={}) {
  if(!EDITOR_OPERATIONS.includes(operation))throw new Error('Unknown editor operation');
  if(!params||typeof params!=='object'||Array.isArray(params))throw new Error('Expected editor parameters object');
  const allowed=[
    'sourceMesh','maxTransferDistance','materialMode','objects','scale','translation','rotation','factor',
    'armature','headBone','pivotBone','sourceBlend','vrmAddonPath','vrmAddonModule','humanBones',
    'authors','title','commercialUsage','chains','colliderBones','stiffness','dragForce','hitRadius',
    'gravityPower','skirt','expressions','materialId','textureSlot','bodyObject','shapeValues',
    'keepMeshes','replaceHeadObjects',
    'regionScaling','syncMeshes','applyScale','snapNeckRim','neckTargetMesh','neckBone',
    'preserveFacialBones','snapTolerance','normalize','rotateZDeg','autoScaleUnits','groundToFloor',
    'targetHeight','partCategory','landmarkFit','hollowShell','delightAlbedo','fitStrategy',
    'fitOffset','correctiveSmooth','applyModifiers','weightSmooth','resolvePenetration','poses',
    'margin','fixPenetration','maxPush','ignoreModifiers','bone','attachMode','mode',
    'frontStiffnessMultiplier','windDrag','colliderGroupName','springNamePrefix','boneMap',
    'highKickDeg','captureScreenshots',
    ...RETEXTURE_KEYS, ...MTOON_KEYS, ...EXPRESSION_LAB_KEYS, ...PHYSICS_AUDIT_KEYS,
  ];
  for(const key of Object.keys(params))if(!allowed.includes(key))throw new Error('Unknown editor parameter '+key);
  if(operation==='transfer_weights'&&(!params.objects?.length||typeof params.sourceMesh!=='string'||!Number.isFinite(params.maxTransferDistance)||params.maxTransferDistance<=0||params.maxTransferDistance>1))throw new Error('Weight transfer requires explicit source, targets and maximum distance up to one meter');
  if(params.objects && (!Array.isArray(params.objects)||params.objects.length>250||params.objects.some(n=>typeof n!=='string'||n.length>200)))throw new Error('Invalid object selection');
  if(operation==='head_scale'&&(!Number.isFinite(params.factor)||params.factor<0.75||params.factor>1.25))throw new Error('Head scale must be between 0.75 and 1.25');
  if(operation==='transform'&&(!params.objects?.length||!numbers(params.scale||[1,1,1],3,0.1,10)||!numbers(params.translation||[0,0,0],3,-10,10)||!numbers(params.rotation||[0,0,0],3,-360,360)))throw new Error('Transform needs explicit objects and bounded scale/translation');
  if(params.rotation!==undefined&&!numbers(params.rotation,3,-360,360))throw new Error('Rotation must be three finite degrees between -360 and 360');
  if(params.materialMode!==undefined&&!['preserve','pbr','mtoon'].includes(params.materialMode))throw new Error('Unknown material mode');
  if(params.chains&&(!Array.isArray(params.chains)||params.chains.length>128||params.chains.some(c=>!Array.isArray(c)||c.length<2||c.length>64||c.some(n=>typeof n!=='string'||n.length>200))))throw new Error('Invalid spring chains');
  if(params.colliderBones&&(!Array.isArray(params.colliderBones)||params.colliderBones.length>128||params.colliderBones.some(c=>!c||typeof c.bone!=='string'||!Number.isFinite(c.radius)||c.radius<=0||c.radius>0.5)))throw new Error('Invalid body colliders');
  for(const [key,maximum] of [['stiffness',10],['dragForce',1],['hitRadius',.5],['gravityPower',5]])if(params[key]!==undefined&&(!Number.isFinite(params[key])||params[key]<0||params[key]>maximum))throw new Error('Spring coefficient out of range');
  if(params.authors&&(!Array.isArray(params.authors)||!params.authors.length||params.authors.length>20||params.authors.some(a=>typeof a!=='string'||!a.trim()||a.length>200)))throw new Error('Explicit authors required');
  if(params.humanBones&&Object.entries(params.humanBones).some(([k,v])=>typeof v!=='string'||k.length>80||v.length>200))throw new Error('Invalid humanoid mapping');
  if (Object.hasOwn(MATERIAL_INTENTS, operation)) {
    if (typeof params.materialId !== 'string' || !/^material_[a-f0-9-]{36}$/.test(params.materialId) || params.sourceBlend !== undefined) throw new Error('Choose a registered material ID, not an arbitrary path');
  } else if (params.materialId !== undefined || params.textureSlot !== undefined) throw new Error('Material inputs are not supported for this operation');
  if (operation === 'apply_material_texture' && (!params.objects?.length || !Number.isInteger(params.textureSlot) || params.textureSlot < 0 || params.textureSlot > 127)) throw new Error('Texture application needs named mesh objects and a material slot index from 0 through 127');
  if (params.poses !== undefined && (!Array.isArray(params.poses) || !params.poses.length || params.poses.length > 6 || new Set(params.poses).size !== params.poses.length || params.poses.some(p => typeof p !== 'string' || !ALLOWED_POSES.has(p)))) {
    throw new Error('Poses must be a non-empty subset of rest, head_turn, arm_raise, elbow_bend, high_kick, squat');
  }
  if (params.boneMap !== undefined && (!isPlainObj(params.boneMap) || Object.keys(params.boneMap).length > 64 || Object.entries(params.boneMap).some(([k, v]) => !nonEmptyStr(k, 80) || !nonEmptyStr(v, 200)))) {
    throw new Error('Invalid boneMap mapping');
  }
  if (params.ignoreModifiers !== undefined && !optionalNames(params.ignoreModifiers, 16)) throw new Error('ignoreModifiers must be up to 16 unique non-empty modifier names');
  if (params.highKickDeg !== undefined && (!Number.isFinite(params.highKickDeg) || params.highKickDeg < 60 || params.highKickDeg > 130)) throw new Error('highKickDeg must be between 60 and 130');
  if (operation === 'fit_foundation') {
    if (typeof params.bodyObject!=='string' || !params.bodyObject.trim() || params.bodyObject.length>160 || !numbers(params.scale||[1,1,1],3,.75,1.3)) throw new Error('Select a body mesh and limit relative stretching to 0.75–1.30');
    if (params.keepMeshes!==undefined && (!names(params.keepMeshes,32) || !params.keepMeshes.includes(params.bodyObject))) throw new Error('Keep-list must include the selected body');
    const shapes = params.shapeValues === undefined ? [] : params.shapeValues;
    if (!Array.isArray(shapes)||shapes.length>32||new Set(shapes.map(x=>`${x?.mesh||''}:${x?.key??''}`)).size!==shapes.length||shapes.some(x=>!isPlainObj(x)||Object.keys(x).some(k=>!['key','value','mesh'].includes(k))||!nonEmptyStr(x.key,160)||(x.mesh!==undefined&&!nonEmptyStr(x.mesh,160))||!Number.isFinite(x.value)||x.value<-10||x.value>10)) throw new Error('Set only named existing shape keys from -10 to 10');
    if (params.regionScaling !== undefined) validateOptionFields(params.regionScaling, 'regionScaling', REGION_SCALING_RULES);
    if (params.syncMeshes !== undefined && !optionalNames(params.syncMeshes, 32)) throw new Error('syncMeshes must be up to 32 unique non-empty mesh names');
    if (params.applyScale !== undefined && typeof params.applyScale !== 'boolean') throw new Error('applyScale must be a boolean');
  }
  if (operation === 'append_foundation_head') {
    if (!names(params.objects,16) || typeof params.headBone!=='string' || !params.headBone.trim() || params.headBone.length>160 || !numbers(params.scale||[1,1,1],3,.5,2) || !numbers(params.translation||[0,0,0],3,-1,1) || !numbers(params.rotation||[0,0,0],3,-360,360) || (params.replaceHeadObjects!==undefined && !names(params.replaceHeadObjects,16))) throw new Error('Choose source head meshes, a target head bone, bounded fit and optional old head objects');
    if (params.snapNeckRim !== undefined && typeof params.snapNeckRim !== 'boolean') throw new Error('snapNeckRim must be a boolean');
    if (params.preserveFacialBones !== undefined && typeof params.preserveFacialBones !== 'boolean') throw new Error('preserveFacialBones must be a boolean');
    if (params.neckTargetMesh !== undefined && !nonEmptyStr(params.neckTargetMesh, 160)) throw new Error('neckTargetMesh must be a non-empty mesh name');
    if (params.neckBone !== undefined && !nonEmptyStr(params.neckBone, 160)) throw new Error('neckBone must be a non-empty bone name');
    if (params.snapTolerance !== undefined && (!Number.isFinite(params.snapTolerance) || params.snapTolerance < 0.0005 || params.snapTolerance > 0.05)) throw new Error('snapTolerance must be between 0.0005 and 0.05');
  }
  if (operation === 'normalize_material_mesh' || operation === 'append_material_mesh') {
    for (const flag of ['normalize', 'autoScaleUnits', 'groundToFloor']) {
      if (params[flag] !== undefined && typeof params[flag] !== 'boolean') throw new Error(`${flag} must be a boolean`);
    }
    if (params.rotateZDeg !== undefined && (!Number.isFinite(params.rotateZDeg) || params.rotateZDeg < -360 || params.rotateZDeg > 360)) throw new Error('rotateZDeg must be between -360 and 360');
    if (params.targetHeight !== undefined && (!Number.isFinite(params.targetHeight) || params.targetHeight < 0.05 || params.targetHeight > 10)) throw new Error('targetHeight must be between 0.05 and 10');
  }
  if (operation === 'fit_garment') {
    if (!Array.isArray(params.objects) || !params.objects.length || params.objects.some(n => !nonEmptyStr(n, 200)) || !nonEmptyStr(params.bodyObject, 160)) throw new Error('fit_garment requires non-empty objects and bodyObject');
    if (params.partCategory !== undefined && !['clothing', 'hair', 'accessory'].includes(params.partCategory)) throw new Error('partCategory must be clothing, hair or accessory');
    if (params.fitStrategy !== undefined && !['none', 'shrinkwrap', 'surface_deform', 'mesh_deform_cage'].includes(params.fitStrategy)) throw new Error('fitStrategy must be none, shrinkwrap, surface_deform or mesh_deform_cage');
    if (params.fitOffset !== undefined && (!Number.isFinite(params.fitOffset) || params.fitOffset < 0 || params.fitOffset > 0.05)) throw new Error('fitOffset must be between 0 and 0.05');
    if (params.applyModifiers !== undefined && typeof params.applyModifiers !== 'boolean') throw new Error('applyModifiers must be a boolean');
    for (const [key, rules] of Object.entries(GARMENT_OPTION_RULES)) {
      if (params[key] !== undefined) validateBoolOrOption(params[key], key, rules);
    }
  }
  if (operation === 'audit_penetration') {
    if (!nonEmptyStr(params.bodyObject, 160) || !Array.isArray(params.objects) || !params.objects.length || params.objects.some(n => !nonEmptyStr(n, 200))) throw new Error('audit_penetration requires bodyObject and non-empty objects');
    if (params.margin !== undefined && (!Number.isFinite(params.margin) || params.margin < 0 || params.margin > 0.03)) throw new Error('margin must be between 0 and 0.03');
    if (params.fixPenetration !== undefined && typeof params.fixPenetration !== 'boolean') throw new Error('fixPenetration must be a boolean');
    if (params.maxPush !== undefined && (!Number.isFinite(params.maxPush) || params.maxPush < 0.001 || params.maxPush > 0.08)) throw new Error('maxPush must be between 0.001 and 0.08');
  }
  if (operation === 'rigid_attach') {
    if (!Array.isArray(params.objects) || !params.objects.length || params.objects.some(n => !nonEmptyStr(n, 200)) || !nonEmptyStr(params.bone, 160)) throw new Error('rigid_attach requires non-empty objects and bone');
    if (params.attachMode !== undefined && !['bone_parent', 'vertex_weight'].includes(params.attachMode)) throw new Error('attachMode must be bone_parent or vertex_weight');
    if (params.translation !== undefined && !numbers(params.translation, 3, -10, 10)) throw new Error('rigid_attach translation must be three numbers between -10 and 10');
    if (params.scale !== undefined && !numbers(params.scale, 3, 0.1, 10)) throw new Error('rigid_attach scale must be three numbers between 0.1 and 10');
  }
  if (operation === 'spring_setup') {
    if (params.mode !== undefined && !SPRING_MODES.includes(params.mode)) throw new Error('spring_setup mode must be append, replace or strict');
    if (params.frontStiffnessMultiplier !== undefined && (!Number.isFinite(params.frontStiffnessMultiplier) || params.frontStiffnessMultiplier < 1 || params.frontStiffnessMultiplier > 5)) throw new Error('frontStiffnessMultiplier must be between 1 and 5');
    if (params.windDrag !== undefined && (!Number.isFinite(params.windDrag) || params.windDrag < 0 || params.windDrag > 1)) throw new Error('windDrag must be between 0 and 1');
    if (params.colliderGroupName !== undefined && !nonEmptyStr(params.colliderGroupName, 160)) throw new Error('colliderGroupName must be a non-empty string');
    if (params.springNamePrefix !== undefined && !nonEmptyStr(params.springNamePrefix, 64)) throw new Error('springNamePrefix must be a non-empty string up to 64 chars');
    if (params.skirt !== undefined) {
      const s = params.skirt;
      if (!isPlainObj(s)) throw new Error('skirt must be an object');
      if (!nonEmptyStr(s.mesh, 160)) throw new Error('skirt.mesh must be a non-empty mesh name');
      if (!Number.isFinite(s.waistZ) || !Number.isFinite(s.hemZ) || s.waistZ <= s.hemZ || (s.waistZ - s.hemZ) >= 2) throw new Error('skirt waistZ must exceed hemZ by less than 2 meters');
      validateOptionFields(s, 'skirt', SKIRT_RULES);
      if (s.minRadius !== undefined && s.maxRadius !== undefined && s.minRadius >= s.maxRadius) throw new Error('skirt.minRadius must be smaller than skirt.maxRadius');
    }
  }
  if (operation === 'pose_check') {
    if (params.bodyObject !== undefined && !nonEmptyStr(params.bodyObject, 160)) throw new Error('bodyObject must be a non-empty mesh name');
    if (params.captureScreenshots !== undefined && typeof params.captureScreenshots !== 'boolean') throw new Error('captureScreenshots must be a boolean');
  }
  const mtoonActive = operation === 'apply_mtoon' || (operation === 'materials' && params.materialMode === 'mtoon');
  if (operation !== 'smart_mesh_retexture' && RETEXTURE_KEYS.some(k => params[k] !== undefined)) {
    throw new Error('Smart mesh retexture parameters are only valid for smart_mesh_retexture');
  }
  if (!mtoonActive && MTOON_KEYS.some(k => params[k] !== undefined)) {
    throw new Error('MToon parameters require apply_mtoon or materials with materialMode="mtoon"');
  }
  if (operation !== 'expression_lab' && EXPRESSION_LAB_KEYS.some(k => params[k] !== undefined)) {
    throw new Error('Expression Lab parameters are only valid for expression_lab');
  }
  if (operation !== 'physics_oscillation_audit' && PHYSICS_AUDIT_KEYS.some(k => params[k] !== undefined)) {
    throw new Error('Physics oscillation audit parameters are only valid for physics_oscillation_audit');
  }
  if (operation === 'smart_mesh_retexture') {
    if (params.groups !== undefined && (!Array.isArray(params.groups) || !params.groups.length || params.groups.length > RETEXTURE_GROUPS.length || new Set(params.groups).size !== params.groups.length || params.groups.some(g => typeof g !== 'string' || !RETEXTURE_GROUPS.includes(g)))) {
      throw new Error('groups must be a non-empty unique subset of hair, head, upper_body, lower_body, accessories');
    }
    if (params.textureSize !== undefined && (!Number.isInteger(params.textureSize) || !RETEXTURE_TEXTURE_SIZES.has(params.textureSize))) {
      throw new Error('textureSize must be 1024, 2048, or 4096');
    }
    if (params.smartUvAngleDeg !== undefined && (!Number.isFinite(params.smartUvAngleDeg) || params.smartUvAngleDeg < 15 || params.smartUvAngleDeg > 89)) {
      throw new Error('smartUvAngleDeg must be between 15 and 89');
    }
    if (params.uvMargin !== undefined && (!Number.isFinite(params.uvMargin) || params.uvMargin < 0.001 || params.uvMargin > 0.1)) {
      throw new Error('uvMargin must be between 0.001 and 0.1');
    }
    if (params.delight !== undefined && typeof params.delight !== 'boolean') throw new Error('delight must be a boolean');
    if (params.separatePhysicsGroup !== undefined && typeof params.separatePhysicsGroup !== 'boolean') throw new Error('separatePhysicsGroup must be a boolean');
    if (params.viewImageMaterialIds !== undefined) {
      if (!isPlainObj(params.viewImageMaterialIds)) throw new Error('viewImageMaterialIds must be an object mapping front/right/left/back to registered material IDs');
      for (const [slot, matId] of Object.entries(params.viewImageMaterialIds)) {
        if (!RETEXTURE_VIEW_SLOTS.includes(slot)) throw new Error(`Invalid viewImageMaterialIds slot: ${slot}`);
        if (typeof matId !== 'string' || !MATERIAL_ID_RE.test(matId)) throw new Error(`viewImageMaterialIds.${slot} must be a registered material ID`);
      }
    }
  }
  if (mtoonActive) {
    if (operation === 'apply_mtoon' && params.materialMode !== undefined && params.materialMode !== 'mtoon') {
      throw new Error('apply_mtoon only supports materialMode mtoon');
    }
    for (const colorKey of ['shadeColor', 'matcapFactor', 'rimColor', 'outlineColor']) {
      if (params[colorKey] !== undefined && !numbers(params[colorKey], 3, 0, 1)) {
        throw new Error(`${colorKey} must be three finite numbers between 0 and 1`);
      }
    }
    if (params.shadingShift !== undefined && (!Number.isFinite(params.shadingShift) || params.shadingShift < -1 || params.shadingShift > 1)) {
      throw new Error('shadingShift must be between -1 and 1');
    }
    if (params.shadingToony !== undefined && (!Number.isFinite(params.shadingToony) || params.shadingToony < 0 || params.shadingToony > 1)) {
      throw new Error('shadingToony must be between 0 and 1');
    }
    if (params.matcapMaterialId !== undefined && (typeof params.matcapMaterialId !== 'string' || !MATERIAL_ID_RE.test(params.matcapMaterialId))) {
      throw new Error('matcapMaterialId must be a registered material ID');
    }
    if (params.rimFresnelPower !== undefined && (!Number.isFinite(params.rimFresnelPower) || params.rimFresnelPower < 0 || params.rimFresnelPower > 10)) {
      throw new Error('rimFresnelPower must be between 0 and 10');
    }
    if (params.rimLift !== undefined && (!Number.isFinite(params.rimLift) || params.rimLift < 0 || params.rimLift > 1)) {
      throw new Error('rimLift must be between 0 and 1');
    }
    if (params.outlineWidthMode !== undefined && (typeof params.outlineWidthMode !== 'string' || !MTOON_OUTLINE_MODES.includes(params.outlineWidthMode))) {
      throw new Error('outlineWidthMode must be none, worldCoordinates, or screenCoordinates');
    }
    if (params.outlineWidthFactor !== undefined && (!Number.isFinite(params.outlineWidthFactor) || params.outlineWidthFactor < 0 || params.outlineWidthFactor > 0.05)) {
      throw new Error('outlineWidthFactor must be between 0 and 0.05');
    }
  }
  if (operation === 'expression_lab') {
    if (params.headMesh !== undefined && !nonEmptyStr(params.headMesh, 160)) throw new Error('headMesh must be a non-empty mesh name up to 160 chars');
    if (params.presets !== undefined && (!Array.isArray(params.presets) || !params.presets.length || params.presets.length > EXPRESSION_LAB_PRESETS.length || new Set(params.presets).size !== params.presets.length || params.presets.some(p => typeof p !== 'string' || !EXPRESSION_LAB_PRESETS.includes(p)))) {
      throw new Error('presets must be a non-empty unique subset of supported VRM 1.0 expression presets');
    }
    if (params.excludeHairByBbox !== undefined && typeof params.excludeHairByBbox !== 'boolean') throw new Error('excludeHairByBbox must be a boolean');
    if (params.hairVertexGroups !== undefined && !optionalNames(params.hairVertexGroups, 32)) throw new Error('hairVertexGroups must be up to 32 unique non-empty names');
    if (params.intensity !== undefined && (!Number.isFinite(params.intensity) || params.intensity < 0.1 || params.intensity > 2.0)) {
      throw new Error('intensity must be between 0.1 and 2.0');
    }
    if (params.bindVrm1 !== undefined && typeof params.bindVrm1 !== 'boolean') throw new Error('bindVrm1 must be a boolean');
    if (params.overwriteExisting !== undefined && typeof params.overwriteExisting !== 'boolean') throw new Error('overwriteExisting must be a boolean');
  }
  if (operation === 'physics_oscillation_audit') {
    if (params.bodyObject !== undefined && !nonEmptyStr(params.bodyObject, 160)) throw new Error('bodyObject must be a non-empty mesh name');
    if (params.objects !== undefined && (!Array.isArray(params.objects) || params.objects.length > 250 || params.objects.some(n => !nonEmptyStr(n, 200)))) {
      throw new Error('objects must be an array of non-empty mesh names');
    }
    if (params.frames !== undefined && (!Number.isInteger(params.frames) || params.frames < 8 || params.frames > 120)) {
      throw new Error('frames must be an integer between 8 and 120');
    }
    if (params.amplitudeDeg !== undefined && (!Number.isFinite(params.amplitudeDeg) || params.amplitudeDeg < 5 || params.amplitudeDeg > 90)) {
      throw new Error('amplitudeDeg must be between 5 and 90');
    }
    if (params.compareSpringOff !== undefined && typeof params.compareSpringOff !== 'boolean') throw new Error('compareSpringOff must be a boolean');
  }
  if (params.expressions !== undefined && !['skip', 'preserve', 'expression_lab'].includes(params.expressions)) {
    throw new Error('Expressions must be skip, preserve, or expression_lab');
  }
  return structuredClone(params);
}
async function hashFile(file, limit=1024*1024*1024) {
  const stat=await fs.stat(file);if(!stat.isFile()||stat.size===0||stat.size>limit)throw new Error('Invalid artifact size');
  const handle=await fs.open(file,'r');const hash=crypto.createHash('sha256');let size=0;
  try{for await(const chunk of handle.createReadStream()){hash.update(chunk);size+=chunk.length;}}finally{await handle.close().catch(()=>{});}
  return {sha256:hash.digest('hex'),bytes:size};
}
async function verifyRecord(projectDir, record) {
  const file=await scopedFile(projectDir,record.filePath);const current=await hashFile(file);
  if(current.sha256!==record.sha256)throw new Error('Editor artifact changed on disk');return file;
}
export async function verifyEditorBlend(projectDir,state,revisionId) {
  const record=revision(state,revisionId).artifacts.blend;
  return {file:await verifyRecord(projectDir,record),sha256:record.sha256};
}
export async function editorContent(projectDir, revisionId, kind='preview') {
  const state=(await loadProjectState(projectDir)).state,r=revision(state,revisionId),record=r.artifacts[kind];
  if(!['preview','vrm','report'].includes(kind)||!record)throw new Error('Requested revision artifact unavailable');
  const file=await verifyRecord(projectDir,record);return {bytes:await fs.readFile(file),mime:kind==='report'?'application/json':'model/gltf-binary'};
}
export async function setEditorView({projectDir,camera='front',overlayAssetId=null,overlayOpacity=0.35,expectedRevision}={}) {
  if(!CAMERA_VIEWS.includes(camera)||!Number.isFinite(overlayOpacity)||overlayOpacity<0||overlayOpacity>1)throw new Error('Invalid viewport state');
  return updateProjectState(projectDir,state=>{if(expectedRevision!==undefined&&expectedRevision!==state.stateRevision)throw new Error('Project view changed; refresh before setting an overlay');state.editor||=schema();if(overlayAssetId&&!state.assets?.items.some(a=>a.id===overlayAssetId&&a.kind==='image'))throw new Error('Reference image not registered in this project');state.editor.view={camera,overlayAssetId,overlayOpacity};});
}
export async function setEditorChannelPreference({ projectDir, channelPreference = 'auto', expectedRevision } = {}) {
  if (!['auto', 'plugin', 'computer_use'].includes(channelPreference)) throw new Error('Invalid editor channel preference; use auto, plugin, or computer_use');
  const saved = await updateProjectState(projectDir, state => {
    if (expectedRevision !== undefined && expectedRevision !== state.stateRevision) throw new Error('Project state changed; refresh before changing channel preference');
    state.editor ||= schema();
    state.editor.channelPreference = channelPreference;
    state.auditLog.push({ at: new Date().toISOString(), event: 'editor.channel_preference', detail: channelPreference });
  });
  return { ...saved, channelPreference, editor: saved.state.editor };
}
function resolveLineageVrmArtifact(state, activeRev) {
  let cur = activeRev;
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.artifacts?.vrm?.filePath) return { record: cur.artifacts.vrm, revisionId: cur.id };
    cur = cur.parentId ? state.editor?.revisions?.find(r => r.id === cur.parentId) : null;
  }
  return null;
}
function resolveLineageVrmPath(projectDir, state, activeRev) {
  const hit = resolveLineageVrmArtifact(state, activeRev);
  return hit ? path.resolve(projectDir, hit.record.filePath) : null;
}
export async function resolveProjectVrmFile(projectDir, revisionId) {
  const loaded = await loadProjectState(projectDir);
  if (!loaded.exists || !loaded.state) throw new Error('Initialize project first');
  const root = loaded.projectDir;
  const state = loaded.state;
  const hasExplicitRev = typeof revisionId === 'string' && revisionId.trim().length > 0;
  let targetRev = null;
  if (hasExplicitRev) {
    targetRev = revision(state, revisionId.trim());
  } else if (state.editor?.activeRevisionId) {
    targetRev = state.editor?.revisions?.find(r => r.id === state.editor.activeRevisionId) || null;
  }
  const lineage = targetRev ? resolveLineageVrmArtifact(state, targetRev) : null;
  if (lineage) {
    const file = lineage.record.sha256
      ? await verifyRecord(root, lineage.record)
      : await scopedFile(root, lineage.record.filePath);
    const bytes = await fs.readFile(file);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    return { root, state, file, bytes, sha256, revisionId: lineage.revisionId };
  }
  if (!hasExplicitRev && state.vrmMetadata?.exportedVrmPath) {
    const file = await scopedFile(root, state.vrmMetadata.exportedVrmPath);
    const bytes = await fs.readFile(file);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    return { root, state, file, bytes, sha256, revisionId: state.editor?.activeRevisionId || null };
  }
  throw new Error('No verified VRM 1.0 file found in this project');
}
export async function rollbackEditor({projectDir,revisionId,expectedRevisionId}={}) {
  return updateProjectState(projectDir,async state=>{checkBase(state,expectedRevisionId);const target=revision(state,revisionId);await verifyRecord(projectDir,target.artifacts.blend);await verifyRecord(projectDir,target.artifacts.preview);state.editor.activeRevisionId=target.id;state.editor.lastRollback={at:new Date().toISOString(),to:target.id};if(state.vrmMetadata)state.vrmMetadata.exportedVrmPath=resolveLineageVrmPath(projectDir,state,target);state.auditLog.push({at:new Date().toISOString(),event:'editor.rollback',detail:target.id});});
}
function findAiRequest(state, requestId) {
  const request = state.editor?.requests?.find(item => item.id === requestId);
  if (!request) throw new Error('AI edit request not found in this project');
  return request;
}
function requireRequestedEdit(state, requestId, base) {
  const request = findAiRequest(state, requestId);
  if (request.status !== 'requested') throw new Error('AI edit request has already been processed');
  if (request.baseRevisionId !== base.id || request.blendHash !== base.artifacts.blend.sha256) {
    throw new Error('AI edit request base revision changed; create a new request');
  }
  if (request.foundation && (!revisionFromSelectedBody(state,base.id)||state.workflow?.mode!=='base_mesh'||request.foundation.body!==state.workflow.foundation.body||request.foundation.head!==state.workflow.foundation.head)) throw new Error('Adopted foundations changed; create a new request');
  return request;
}
function aiHandoff(projectDir, request, state = null) {
  const channelPreference = request.channelPreference || state?.editor?.channelPreference || 'auto';
  const context = { projectDir: path.resolve(projectDir), editRequestId: request.id,
    expectedRevisionId: request.baseRevisionId, intent:request.intent||'general', channelPreference, approvedOperations:AI_EDIT_INTENTS[request.intent||'general'], objects: request.objects, camera: request.camera, ...(request.foundation?{foundation:request.foundation}:{}) };
  return {
    request,
    channelPreference,
    instruction: [
      '请接手 Avatar Studio 中的这条模型修改请求。先核对所选对象与工序，使用 charakuru_blender_avatar，action=editor_operation。',
      '先调用 charakuru_blender_avatar(action=editor_inspect, projectDir, editRequestId) 获取实际网格、形态键与骨架。按范围自己决定参数；不要让用户代填数值，不猜对象名。',
      '执行时传入 projectDir、editRequestId 和 expectedRevisionId；只使用 approvedOperations 中的工序。比例、权重与取景按用户目标拟定。若是换头，等 editor_inspect 的 donor 网格清单；donorPending 时只在同会话再次 inspect 收集，不提交编辑、不猜名称。若不兼容就停下解释。',
      'fit_foundation 支持 bodyObject、armature、0.75–1.30 相对 scale、负值与多网格 shapeValues（可配 syncMeshes）、保头/保脚底分区域 regionScaling 及 applyScale；append_foundation_head 使用已采用 materialId、供体 objects、实际 headBone，可选 snapNeckRim/neckTargetMesh/neckBone/snapTolerance 与 preserveFacialBones。',
      'v0.8.0 扩展工序：normalize_material_mesh（FBX/Draco GLB 规范化并输出 normalizedGlb）、fit_garment（partCategory/landmarkFit/hollowShell/delightAlbedo/fitStrategy/weightSmooth/resolvePenetration）、audit_penetration（多姿态穿模量化检查与修复）、rigid_attach（硬件配饰刚性绑骨）、spring_setup（append/replace/strict 与完整 skirt 配置）及 pose_check（多骨骼标准自动解析与对比截图）。',
      'v0.9.0 扩展工序：smart_mesh_retexture（5 语义分组 hair/head/upper_body/lower_body/accessories 智能 UV 重投贴图，支持 viewImageMaterialIds/delight/separatePhysicsGroup）、apply_mtoon（及 materials materialMode=mtoon，配置 VRMC_materials_mtoon 与 matcapMaterialId/rim/outline）、expression_lab（Clean-Room 表情实验室：face-only 包围盒与 hairVertexGroups 隔离长发，支持 presets/intensity/bindVrm1）、physics_oscillation_audit（SpringBone 开关对比摆动与穿模量化审计）。拒绝任意 Python、配置路径与上传，不覆盖源文件。',
      '双通道协作规则（channelPreference=' + channelPreference + '）：结构化参数工序走通道 1（charakuru_blender_avatar action=editor_operation 或 dsh-blender-plugin 契约/快照/抓图）；若需笔刷权重、穿模精修或复杂节点微调，走通道 2（action=checkout_gui 签出 editor/working/<checkoutId>/scene.blend -> Blender GUI 操控并原位保存 -> action=checkin_gui 自动打包/导出 preview.glb/审计并固化为不可变修订，或 abort_gui 放弃）。',
      '若工具返回待收集作业，调用 editor_collect；仅在生成新版本后让用户回工作台预览并确认。若基础版本不匹配、要求不明确或没有对应工序，请停止并说明。',
      JSON.stringify(context),
      '用户本次修改要求：', request.prompt,
    ].join('\n'),
  };
}
export async function createAiEditRequest({ projectDir, prompt, objects = [], camera = 'front', expectedRevisionId, intent='general', channelPreference } = {}) {
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 8000) throw new Error('AI edit instruction is required, max 8000 characters');
  if (typeof expectedRevisionId !== 'string' || !expectedRevisionId) throw new Error('A base revision is required for an AI edit request');
  if (!CAMERA_VIEWS.includes(camera)) throw new Error('Invalid viewport state');
  if (!Object.hasOwn(AI_EDIT_INTENTS,intent)) throw new Error('Unknown AI edit intent');
  if (channelPreference !== undefined && !['auto', 'plugin', 'computer_use'].includes(channelPreference)) throw new Error('Invalid editor channel preference; use auto, plugin, or computer_use');
  if (!Array.isArray(objects) || objects.length > 250 || objects.some(n => typeof n !== 'string' || n.length > 200)) throw new Error('Invalid object selection');
  let request, savedState;
  await updateProjectState(projectDir, async state => {
    checkBase(state, expectedRevisionId);
    const base = revision(state, expectedRevisionId);
    if(state.editor.requests?.some(r=>r.status==='ready_for_review'&&r.resultRevisionId===base.id))throw new Error('Approve or reject the active AI revision before drafting a new edit');
    if(foundationIntent(intent)&&(state.workflow?.mode!=='base_mesh'||!revisionFromSelectedBody(state,base.id))) throw new Error('Open the adopted body as the current revision before drafting a base edit');
    if(intent==='foundation_head'&&(!state.workflow.foundation.head||state.workflow.foundation.head==='embedded')) throw new Error('Adopt a separate head first');
    const names = new Set((base.audit?.objects || []).map(o => o.name));
    if (objects.some(n => !names.has(n))) throw new Error('AI selection contains unknown objects');
    await verifyRecord(projectDir, base.artifacts.blend);
    const resolvedChannel = channelPreference || state.editor?.channelPreference || 'auto';
    if (channelPreference) state.editor.channelPreference = channelPreference;
    request = { id: id(), status: 'requested', createdAt: new Date().toISOString(), baseRevisionId: base.id,
      blendHash: base.artifacts.blend.sha256, intent, channelPreference: resolvedChannel, ...(foundationIntent(intent)?{foundation:{...state.workflow.foundation}}:{}), objects: [...new Set(objects)], camera, prompt: redactSecrets(prompt.trim()) };
    state.editor.requests = [...(state.editor.requests || []), request].slice(-100);
    savedState = state;
  });
  return aiHandoff(projectDir, request, savedState);
}
export async function prepareAiEditHandoff({ projectDir, requestId } = {}) {
  const { state } = await loadProjectState(projectDir);
  const request = findAiRequest(state || {}, requestId);
  checkBase(state, request.baseRevisionId, { allowGuiCheckout: true });
  const base = revision(state, request.baseRevisionId);
  requireRequestedEdit(state, requestId, base);
  await verifyRecord(projectDir, base.artifacts.blend);
  return aiHandoff(projectDir, request, state);
}
export async function inspectAiEdit({projectDir,requestId,blenderPluginUrl='',caller=null,fetchImpl=fetch,signal}={}) {
  return exclusiveProjectOperation(projectDir,async()=>{
    const {state,projectDir:root}=await loadProjectState(projectDir);
    if(!requestId){
      const activeId=state?.editor?.activeRevisionId;
      if(!activeId)throw new Error('No active editor revision to inspect');
      const base=revision(state,activeId);
      await verifyRecord(root,base.artifacts.blend);
      const visible=(base.audit?.objects||[]).filter(o=>!o.helper);
      return {
        request:null,
        activeRevisionId:base.id,
        channelPreference:state.editor?.channelPreference||'auto',
        guiCheckout:state.editor?.guiCheckout||null,
        allowed:EDITOR_OPERATIONS,
        inventory:visible.slice(0,250).map(o=>o.type==='ARMATURE'?{name:o.name,type:o.type,bones:o.bones?.slice(0,360)}:{name:o.name,type:o.type,vertices:o.vertices,shapeKeys:o.shapeKeys?.slice(0,80),dimensions:o.dimensions,location:o.location}),
        truncated:visible.length>250,
      };
    }
    const request=findAiRequest(state||{},requestId);
    checkBase(state,request.baseRevisionId,{allowGuiCheckout:true});
    const base=revision(state,request.baseRevisionId);
    requireRequestedEdit(state,requestId,base);
    await verifyRecord(root,base.artifacts.blend);
    const visible=(base.audit?.objects||[]).filter(o=>!o.helper);
    const response={request,activeRevisionId:base.id,channelPreference:request.channelPreference||state.editor?.channelPreference||'auto',guiCheckout:state.editor?.guiCheckout||null,allowed:AI_EDIT_INTENTS[request.intent||'general'],inventory:visible.slice(0,250).map(o=>o.type==='ARMATURE'?{name:o.name,type:o.type,bones:o.bones?.slice(0,360)}:{name:o.name,type:o.type,vertices:o.vertices,shapeKeys:o.shapeKeys?.slice(0,80),dimensions:o.dimensions,location:o.location}),truncated:visible.length>250};
    if(request.intent!=='foundation_head')return response;
    const donor=await resolveProjectMaterial(root,request.foundation.head,'foundation_head');
    const updateInspection=value=>updateProjectState(root,next=>{checkBase(next,base.id,{allowGuiCheckout:true});requireRequestedEdit(next,requestId,revision(next,base.id)).donorInspection=value;});
    let job=request.donorInspection,receipt;
    if(job?.failed)throw new Error('Donor inspection was not confirmed. Report the failure; use a new request only after reconciliation.');
    if(job?.report)return {...response,donor:{id:donor.record.id,fileName:donor.record.fileName,...job.report}};
    if(job?.jobId){
      const collected=await collectCompanionJob(job,{caller,fetchImpl,signal});
      if(collected.pending)return {...response,donorPending:true,jobId:job.jobId};
      receipt=collected.receipt;
    }else{
      const connection=await probeBlenderPluginLink({blenderPluginUrl,fetchImpl});
      if(!connection.linked)throw new Error(connection.remedyZh||'Companion unavailable for donor inventory');
      const rel='editor/inspect/'+id(),dir=path.join(root,rel),scriptFile=path.join(dir,'inspect.py');
      await fs.mkdir(dir,{recursive:true});
      if(path.relative(await fs.realpath(root),await fs.realpath(dir))!==rel.split('/').join(path.sep))throw new Error('Donor inspection directory escapes project');
      job={reportRel:rel+'/inventory.json',protocol:connection.protocol,baseUrl:connection.baseUrl,caller};
      const c={requestId,inputBlend:donor.file,donorSha256:donor.record.sha256,reportPath:path.join(root,job.reportRel)};
      const python=await fs.readFile(new URL('../blender/inspect-foundation.py',import.meta.url),'utf8');
      await fs.writeFile(scriptFile,`COMMAND = ${JSON.stringify(JSON.stringify(c))}\n`+python,{flag:'wx'});
      receipt=await executeCompanionStage({connection,scriptFile,outdir:dir,executionTarget:'headless',caller,fetchImpl,signal});
      if(receipt.jobId){await updateInspection({...job,jobId:receipt.jobId});return {...response,donorPending:true,jobId:receipt.jobId};}
    }
    try {
      const proof=await extractStageResult(receipt);
      if(receipt.ok===false||receipt.exitCode!==0||proof?.verdict!=='pass'||proof.requestId!==requestId)throw new Error(proof?.error||'Blender did not confirm the donor inventory');
      const reportFile=await scopedFile(root,job.reportRel);
      if((await fs.stat(reportFile)).size>512*1024)throw new Error('Donor inventory exceeds its size limit');
      const report=JSON.parse(await fs.readFile(reportFile,'utf8'));
      if(report.requestId!==requestId||report.donorSha256!==donor.record.sha256||!Array.isArray(report.meshes)||report.meshes.length>250||!report.meshes.length)throw new Error('Donor has no verifiable visible mesh inventory');
      await resolveProjectMaterial(root,donor.record.id,'foundation_head');
      await updateInspection({report});
      return {...response,donor:{id:donor.record.id,fileName:donor.record.fileName,...report}};
    }catch(error){await updateInspection({failed:true}).catch(()=>{});throw error;}
  });
}
export async function reviewAiEditRequest({ projectDir, requestId, revisionId, decision } = {}) {
  if (!['approve', 'reject'].includes(decision) || typeof revisionId !== 'string' || !revisionId) throw new Error('Expected an edit decision and revision ID');
  return exclusiveProjectOperation(projectDir, async () => {
    const saved = await updateProjectState(projectDir, async state => {
      checkBase(state, revisionId);
      const request = findAiRequest(state, requestId);
      if (request.status !== 'ready_for_review' || request.resultRevisionId !== revisionId) throw new Error('AI edit result is not awaiting review for this revision');
      const result = revision(state, revisionId);
      if (result.editRequestId !== request.id || result.parentId !== request.baseRevisionId) throw new Error('AI edit revision lineage does not match');
      const target = decision === 'reject' ? revision(state, request.baseRevisionId) : result;
      await verifyRecord(projectDir, target.artifacts.blend);
      await verifyRecord(projectDir, target.artifacts.preview);
      if (target.artifacts.vrm) await verifyRecord(projectDir, target.artifacts.vrm);
      request.status = decision === 'approve' ? 'approved' : 'rejected';
      request.reviewedAt = new Date().toISOString();
      state.editor.activeRevisionId = target.id;
      if (state.vrmMetadata) state.vrmMetadata.exportedVrmPath = resolveLineageVrmPath(projectDir, state, target);
      state.auditLog.push({ at: request.reviewedAt, event: 'editor.ai_review', detail: request.id + ':' + request.status });
    });
    return { request: findAiRequest(saved.state, requestId), activeRevisionId: saved.state.editor.activeRevisionId };
  });
}
async function finalize(projectDir,pending,receipt) {
  const detail=await extractStageResult(receipt).catch(()=>null);
  const hasStderrTraceback=String(receipt.stderr||receipt.stderrTail||'').includes('Traceback');
  if(receipt.ok===false||receipt.exitCode!=null&&receipt.exitCode!==0||(hasStderrTraceback&&detail?.verdict!=='pass')){throw new Error('Blender process failed; previous revision remains active: '+(detail?.error||receipt.error||receipt.traceback||String(receipt.stderr||receipt.stderrTail||'').slice(-800)));}
  if(pending.sourcePath&&(await hashFile(pending.sourcePath)).sha256!==pending.sourceHash)throw new Error('Input changed during execution; generated output was not activated');
  if (pending.materialInput) {
    const verified = await resolveMaterialForOperation(projectDir, pending.materialInput.id, pending.operation);
    if (!verified || verified.record.sha256 !== pending.materialInput.sha256) throw new Error('External material changed during execution; candidate revision was not activated');
  }
  const result=detail||await extractStageResult(receipt);
  if(!result||result.requestId!==pending.id||result.verdict!=='pass')throw new Error(result?.error||'Blender editor response does not match the submitted request');
  const artifacts={};
  for(const kind of ['blend','preview','report',...(pending.operation==='export_vrm'?['vrm']:[])]){
    const file=pending.outputs[kind];if(path.resolve(result.outputs?.[kind]||'')!==path.resolve(file))throw new Error('Unexpected editor output path');
    await scopedFile(projectDir,file);const fingerprint=await hashFile(file);
    if(kind==='preview'||kind==='vrm'){const gltf=validateGlb(await fs.readFile(file));if(kind==='vrm'&&!gltf.extensions?.VRMC_vrm)throw new Error('VRM extension missing');}
    artifacts[kind]={...fingerprint,filePath:path.relative(projectDir,file).replaceAll('\\','/')};
  }
  if (pending.outputs.normalizedGlb && result.outputs?.normalizedGlb) {
    const normFile = pending.outputs.normalizedGlb;
    if (path.resolve(result.outputs.normalizedGlb) !== path.resolve(normFile)) throw new Error('Unexpected editor normalizedGlb output path');
    const hasNormFile = await fs.stat(normFile).then(s => s.isFile()).catch(() => false);
    if (hasNormFile) {
      await scopedFile(projectDir, normFile);
      const normFingerprint = await hashFile(normFile);
      const gltf = validateGlb(await fs.readFile(normFile));
      const blockedExts = new Set(['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu']);
      const exts = [...(gltf.extensionsRequired || []), ...(gltf.extensionsUsed || [])];
      if (exts.some(ext => blockedExts.has(ext))) throw new Error('Normalized GLB must be uncompressed');
      artifacts.normalizedGlb = { ...normFingerprint, filePath: path.relative(projectDir, normFile).replaceAll('\\', '/') };
    }
  }
  const audit=JSON.parse(await fs.readFile(pending.outputs.report,'utf8'));
  if (pending.materialInput && (audit.materialInput?.id !== pending.materialInput.id || audit.materialInput.sha256 !== pending.materialInput.sha256)) throw new Error('Blender audit did not identify the submitted external material');
  const saved=await updateProjectState(projectDir,state=>{
    state.editor||=schema();if((state.editor.activeRevisionId||null)!==pending.baseRevisionId)throw new Error('Base revision changed during Blender execution; output retained but not activated');
    const record={id:pending.id,parentId:pending.baseRevisionId,operation:pending.operation,...(pending.channel?{channel:pending.channel}:{}),...(pending.checkoutId?{checkoutId:pending.checkoutId}:{}),createdAt:new Date().toISOString(),artifacts,audit,params:pending.params,sourceHash:pending.sourceHash,materialInput:pending.materialInput || null,visualReview:'required'};
    if (pending.editRequestId) {
      const request = requireRequestedEdit(state, pending.editRequestId, revision(state, pending.baseRevisionId));
      request.status = 'ready_for_review';
      request.resultRevisionId = record.id;
      request.finishedAt = record.createdAt;
      record.editRequestId = request.id;
    }
    state.editor.revisions.push(record);state.editor.activeRevisionId=record.id;state.editor.pendingJob=null;
    if (pending.checkoutId && state.editor.guiCheckout?.id === pending.checkoutId) {
      state.editor.guiCheckout = null;
    }
    if (pending.operation === 'configure_vrm' && state.vrmMetadata) {
      if (pending.params?.title) state.vrmMetadata.title = pending.params.title;
      if (Array.isArray(pending.params?.authors)) state.vrmMetadata.authors = [...pending.params.authors];
      if (pending.params?.commercialUsage) state.vrmMetadata.commercialUsage = pending.params.commercialUsage;
    }
    if (artifacts.vrm && state.vrmMetadata) {
      state.vrmMetadata.exportedVrmPath = path.resolve(projectDir, artifacts.vrm.filePath);
    } else if (state.vrmMetadata) {
      state.vrmMetadata.exportedVrmPath = resolveLineageVrmPath(projectDir, state, record) || state.vrmMetadata.exportedVrmPath;
    }
    state.auditLog.push({at:record.createdAt,event:'editor.revision',detail:record.id});
  });
  if (pending.checkoutId) {
    const lockFile = pending.lockFile || path.join(projectDir, 'editor', 'working', pending.checkoutId, 'checkout.lock.json');
    await fs.rm(lockFile, { force: true }).catch(() => {});
  }
  return {verdict:'pass',scope:'artifact_and_structural_validation_only',visualReview:'required',revisionId:pending.id,editRequestId:pending.editRequestId,...(pending.channel?{channel:pending.channel}:{}),...(pending.checkoutId?{checkoutId:pending.checkoutId}:{}),editor:saved.state.editor};
}
async function verifyBlendContainerHeader(file) {
  const handle = await fs.open(file, 'r');
  const buf = Buffer.alloc(12);
  let bytesRead = 0;
  try {
    ({ bytesRead } = await handle.read(buf, 0, 12, 0));
  } finally {
    await handle.close().catch(() => {});
  }
  const plain = buf.subarray(0, 7).toString() === 'BLENDER';
  const compressed = (buf[0] === 0x1f && buf[1] === 0x8b) || (bytesRead >= 4 && buf.readUInt32LE(0) === 0xfd2fb528);
  if (bytesRead < 12 || !(plain || compressed)) throw new Error('Working file is not a recognized blend container');
}
export async function checkoutEditorGui({ projectDir, expectedRevisionId, note = '' } = {}) {
  return exclusiveProjectOperation(projectDir, async () => {
    const loaded = await loadProjectState(projectDir);
    if (!loaded.exists || !loaded.state) throw new Error('Initialize project first');
    const root = loaded.projectDir, state = loaded.state;
    checkBase(state, expectedRevisionId);
    const base = revision(state, state.editor?.activeRevisionId);
    const baseBlend = await verifyRecord(root, base.artifacts.blend);
    const checkoutId = id();
    const workingDir = path.join(root, 'editor', 'working', checkoutId);
    await fs.mkdir(workingDir, { recursive: true });
    const realRoot = await fs.realpath(root), realWorking = await fs.realpath(workingDir), relative = path.relative(realRoot, realWorking);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Editor working directory escapes project');
    const workingBlend = path.join(workingDir, 'scene.blend');
    const workingBlendRel = `editor/working/${checkoutId}/scene.blend`;
    await fs.copyFile(baseBlend, workingBlend);
    const checkedOutAt = new Date().toISOString();
    const guiCheckout = {
      id: checkoutId,
      status: 'checked_out',
      baseRevisionId: base.id,
      baseBlendSha256: base.artifacts.blend.sha256,
      workingBlendRel,
      workingBlendPath: workingBlend,
      note: redactSecrets(String(note || '').slice(0, 1000)),
      checkedOutAt,
    };
    await fs.writeFile(path.join(workingDir, 'checkout.lock.json'), JSON.stringify(guiCheckout, null, 2), 'utf8');
    const saved = await updateProjectState(root, next => {
      next.editor ||= schema();
      checkBase(next, expectedRevisionId);
      next.editor.guiCheckout = guiCheckout;
      next.auditLog.push({ at: checkedOutAt, event: 'editor.gui_checkout', detail: checkoutId });
    });
    return {
      checkout: saved.state.editor.guiCheckout,
      workingBlendPath: workingBlend,
      instructions: 'Open workingBlendPath in Blender GUI for Computer-Use editing, save scene.blend in place, then call checkin_gui to pack textures, export preview.glb, audit, and commit an immutable revision.',
    };
  });
}
export async function checkinEditorGui({ projectDir, checkoutId, expectedRevisionId, exportVrm = false, editRequestId, blenderPluginUrl = '', caller = null, fetchImpl = fetch, signal, executionTarget = 'headless', sessionId = '' } = {}) {
  return exclusiveProjectOperation(projectDir, async () => {
    if (!['headless', 'gui_act'].includes(executionTarget)) throw new Error('Invalid Blender execution target');
    const loaded = await loadProjectState(projectDir);
    if (!loaded.exists || !loaded.state) throw new Error('Initialize project first');
    const root = loaded.projectDir, state = loaded.state;
    const checkout = state.editor?.guiCheckout;
    if (checkout?.status !== 'checked_out' || (checkoutId !== undefined && checkout.id !== checkoutId)) {
      throw new Error('No matching checked-out editor GUI working copy; verify checkoutId');
    }
    checkBase(state, expectedRevisionId ?? checkout.baseRevisionId, { allowGuiCheckout: true });
    const base = revision(state, checkout.baseRevisionId);
    if (editRequestId) requireRequestedEdit(state, editRequestId, base);
    const workingBlend = await scopedFile(root, checkout.workingBlendRel);
    await verifyBlendContainerHeader(workingBlend);
    const workingHash = (await hashFile(workingBlend)).sha256;
    const operation = exportVrm ? 'export_vrm' : 'audit';
    const params = {};
    for (const key of ['vrmAddonPath', 'vrmAddonModule']) {
      if (base.params?.[key]) params[key] = base.params[key];
    }
    const requestId = id(), folder = path.join(root, 'editor', 'revisions', requestId);
    await fs.mkdir(folder, { recursive: true });
    const realRoot = await fs.realpath(root), realFolder = await fs.realpath(folder), relative = path.relative(realRoot, realFolder);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Editor output directory escapes project');
    const outputs = {
      blend: path.join(folder, 'scene.blend'),
      preview: path.join(folder, 'preview.glb'),
      report: path.join(folder, 'audit.json'),
      vrm: path.join(folder, 'avatar.vrm'),
    };
    const lockFile = path.join(path.dirname(workingBlend), 'checkout.lock.json');
    const pending = {
      id: requestId,
      baseRevisionId: base.id,
      operation,
      params,
      sourceHash: workingHash,
      sourcePath: workingBlend,
      outputs,
      materialInput: null,
      channel: 'computer_use',
      checkoutId: checkout.id,
      lockFile,
      createdAt: new Date().toISOString(),
      ...(editRequestId ? { editRequestId } : {}),
    };
    const command = { requestId, operation, params, inputBlend: workingBlend, outputs, material: null };
    const python = await fs.readFile(new URL('../blender/studio-pipeline.py', import.meta.url), 'utf8'), scriptFile = path.join(folder, 'operation.py');
    await fs.writeFile(scriptFile, `COMMAND = ${JSON.stringify(JSON.stringify(command))}\n` + python, 'utf8');
    const connection = await probeBlenderPluginLink({ blenderPluginUrl, fetchImpl });
    if (!connection.linked) throw new Error(connection.remedyZh || 'Companion unavailable');
    const target = executionTarget === 'gui_act' && connection.guiReady ? 'gui_act' : 'headless';
    const receipt = await executeCompanionStage({ connection, scriptFile, outdir: folder, executionTarget: target, caller, sessionId, fetchImpl, signal });
    await fs.writeFile(path.join(folder, 'companion-receipt.json'), JSON.stringify(receipt, null, 2));
    if (receipt.jobId) {
      await updateProjectState(root, next => {
        next.editor ||= schema();
        next.editor.pendingJob = { ...pending, jobId: receipt.jobId, protocol: connection.protocol, baseUrl: connection.baseUrl, caller };
      });
      return { verdict: 'degraded', pending: true, jobId: receipt.jobId, checkoutId: checkout.id };
    }
    if ((await hashFile(workingBlend)).sha256 !== workingHash) throw new Error('Input changed during execution; generated output was not activated');
    return finalize(root, pending, receipt);
  });
}
export async function abortEditorGui({ projectDir, checkoutId, expectedRevisionId, reason = '' } = {}) {
  return exclusiveProjectOperation(projectDir, async () => {
    const loaded = await loadProjectState(projectDir);
    if (!loaded.exists || !loaded.state) throw new Error('Initialize project first');
    const root = loaded.projectDir, state = loaded.state;
    const checkout = state.editor?.guiCheckout;
    if (checkout?.status !== 'checked_out' || (checkoutId !== undefined && checkoutId !== '' && checkout.id !== checkoutId)) {
      throw new Error('No matching checked-out editor GUI working copy to abort');
    }
    checkBase(state, expectedRevisionId ?? checkout.baseRevisionId, { allowGuiCheckout: true });
    const activeId = checkout.id;
    const workingDir = path.join(root, 'editor', 'working', activeId);
    await fs.rm(path.join(workingDir, 'checkout.lock.json'), { force: true }).catch(() => {});
    await fs.rm(path.join(workingDir, 'scene.blend'), { force: true }).catch(() => {});
    const saved = await updateProjectState(root, next => {
      next.editor ||= schema();
      next.editor.guiCheckout = null;
      next.auditLog.push({
        at: new Date().toISOString(),
        event: 'editor.gui_abort',
        detail: `${activeId}${reason ? ':' + redactSecrets(String(reason).slice(0, 500)) : ''}`,
      });
    });
    return { aborted: true, checkoutId: activeId, activeRevisionId: saved.state.editor.activeRevisionId };
  });
}
export async function runEditorOperation({projectDir,operation='audit',params={},expectedRevisionId,editRequestId,blenderPluginUrl='',executionTarget='headless',sessionId='',caller=null,fetchImpl=fetch,signal}={}) {
  return exclusiveProjectOperation(projectDir,async()=>{
    if(!['headless','gui_act'].includes(executionTarget))throw new Error('Invalid Blender execution target');
    params=validateEditorParams(operation,params);
    if (editRequestId !== undefined && (typeof editRequestId !== 'string' || !editRequestId ||
      typeof expectedRevisionId !== 'string' || !expectedRevisionId || IMPORT_OPERATIONS.includes(operation))) {
      throw new Error('AI edit execution requires a request ID, its base revision, and an editing operation');
    }
    let loaded=await loadProjectState(projectDir);
    if(!loaded.exists){if(operation!=='import_blend')throw new Error('Initialize project first');await initOrUpdateProject(projectDir);loaded=await loadProjectState(projectDir);}
    const root=loaded.projectDir,state=loaded.state;checkBase(state,expectedRevisionId);const baseId=state.editor?.activeRevisionId||null;
    if (editRequestId) {
      const prior=revision(state,baseId),request=requireRequestedEdit(state,editRequestId,prior);
      if (!AI_EDIT_INTENTS[request.intent||'general']?.includes(operation)) throw new Error('This operation is outside the approved AI edit scope');
      if(request.objects.length && ['transform','transfer_weights','normalize_weights','fit_garment','audit_penetration','rigid_attach'].includes(operation) && (!params.objects?.length||params.objects.some(n=>!request.objects.includes(n)))) throw new Error('Target not selected in this AI request');
      if(operation==='fit_foundation' && request.objects.length && !request.objects.includes(params.bodyObject)) throw new Error('Body mesh not selected in this AI request');
      if(request.intent==='foundation_head') {
        if(params.materialId!==request.foundation.head)throw new Error('Donor differs from the AI request');
        const observed=request.donorInspection?.report?.meshes||[];
        if(!observed.length||params.objects.some(name=>!observed.some(m=>m.name===name)))throw new Error('Run editor_inspect and choose only the named donor meshes');
      }
      for(const key of ['vrmAddonPath','vrmAddonModule'])if(params[key]!==undefined && prior.params?.[key]!==undefined && params[key]!==prior.params[key])throw new Error('AI requests cannot choose a new add-on path or module');
    }
    const hasMaterialIntent = Object.hasOwn(MATERIAL_INTENTS, operation);
    if (hasMaterialIntent && baseId && expectedRevisionId !== baseId) throw new Error('Choose the current editor base revision before using an external material');
    const incoming = hasMaterialIntent ? await resolveMaterialForOperation(root, params.materialId, operation) : null;
    const materialInput = incoming ? { id: incoming.record.id, role: incoming.record.role, stageId: incoming.record.stageId,
      sha256: incoming.record.sha256, filePath: incoming.record.filePath } : null;
    if (incoming?.record.role==='foundation_body' && (state.workflow?.mode!=='base_mesh'||state.workflow.foundation.body!==params.materialId)) throw new Error('First adopt this body in the base mesh route');
    const baseAction = ['fit_foundation','append_foundation_head'].includes(operation) || /^tripo_(?:clothing|hair|accessory)$/.test(incoming?.record.role||'');
    if (baseAction && (state.workflow?.mode!=='base_mesh' || !baseId || expectedRevisionId!==baseId || !revisionFromSelectedBody(state,baseId))) throw new Error('Open the adopted body as the current editor revision first');
    if (operation==='append_foundation_head' && state.workflow.foundation.head!==params.materialId) throw new Error('Adopt the registered head first');
    let source = null;
    if (operation === 'import_material_scene') source = incoming.file;
    else if(operation==='import_blend') {if(typeof params.sourceBlend!=='string'||!params.sourceBlend.toLowerCase().endsWith('.blend'))throw new Error('Choose an existing .blend file');source=path.resolve(params.sourceBlend);}
    else if (operation === 'import_checkpoint') {
      const studio = state.blenderState;
      const artifact = studio?.lastRun?.artifacts?.find(item => item.validation === 'blend_container_only' && item.path === studio.activeBlendFile);
      if (!artifact || !/^[a-f0-9]{64}$/.test(artifact.sha256 || '')) throw new Error('No current, fingerprinted Blender checkpoint in this project');
      source = await verifyRecord(root, { filePath: artifact.path, sha256: artifact.sha256 });
    }
    else if (operation === 'normalize_material_mesh' && !baseId) {
      source = null;
    }
    else {const base=revision(state,baseId);source=await verifyRecord(root,base.artifacts.blend);for(const key of ['vrmAddonPath','vrmAddonModule'])if(params[key]===undefined&&base.params?.[key])params[key]=base.params[key];}
    let viewImagePaths;
    if (operation === 'smart_mesh_retexture' && params.viewImageMaterialIds) {
      viewImagePaths = {};
      for (const [slot, matId] of Object.entries(params.viewImageMaterialIds)) {
        const resolved = await resolveProjectMaterial(root, matId);
        if (resolved.record.extension?.toLowerCase() !== '.png') {
          throw new Error(`viewImageMaterialIds.${slot} must resolve to a registered PNG texture`);
        }
        viewImagePaths[slot] = resolved.file;
      }
    }
    let matcapPath;
    if ((operation === 'apply_mtoon' || (operation === 'materials' && params.materialMode === 'mtoon')) && params.matcapMaterialId) {
      const resolved = await resolveProjectMaterial(root, params.matcapMaterialId);
      if (resolved.record.extension?.toLowerCase() !== '.png') {
        throw new Error('matcapMaterialId must resolve to a registered PNG texture');
      }
      matcapPath = resolved.file;
    }
    const sourceHash = source ? (await hashFile(source)).sha256 : null;
    const requestId=id(),folder=path.join(root,'editor','revisions',requestId);await fs.mkdir(folder,{recursive:true});
    const realRoot=await fs.realpath(root),realFolder=await fs.realpath(folder),relative=path.relative(realRoot,realFolder);if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Editor output directory escapes project');
    const outputs={blend:path.join(folder,'scene.blend'),preview:path.join(folder,'preview.glb'),report:path.join(folder,'audit.json'),vrm:path.join(folder,'avatar.vrm'),...(operation==='normalize_material_mesh'?{normalizedGlb:path.join(folder,'normalized.glb')}:{})};
    const pending={id:requestId,baseRevisionId:baseId,operation,params,sourceHash,sourcePath:source,outputs,materialInput,createdAt:new Date().toISOString(),...(editRequestId?{editRequestId}:{})};
    const command={
      requestId,operation,params,inputBlend:source,outputs,material:incoming ? {...materialInput, path:incoming.file} : null,
      ...(viewImagePaths && Object.keys(viewImagePaths).length ? { viewImagePaths } : {}),
      ...(matcapPath ? { matcapPath } : {}),
    };
    const python=await fs.readFile(new URL('../blender/studio-pipeline.py',import.meta.url),'utf8'),scriptFile=path.join(folder,'operation.py');
    await fs.writeFile(scriptFile,`COMMAND = ${JSON.stringify(JSON.stringify(command))}\n`+python,'utf8');
    const connection=await probeBlenderPluginLink({blenderPluginUrl,fetchImpl});if(!connection.linked)throw new Error(connection.remedyZh||'Companion unavailable');
    const target=executionTarget==='gui_act'&&connection.guiReady?'gui_act':'headless';
    const receipt=await executeCompanionStage({connection,scriptFile,outdir:folder,executionTarget:target,caller,sessionId,fetchImpl,signal});
    await fs.writeFile(path.join(folder,'companion-receipt.json'),JSON.stringify(receipt,null,2));
    if(receipt.jobId){await updateProjectState(root,next=>{next.editor||=schema();next.editor.pendingJob={...pending,jobId:receipt.jobId,protocol:connection.protocol,baseUrl:connection.baseUrl,caller};});return {verdict:'degraded',pending:true,jobId:receipt.jobId};}
    if(source && (await hashFile(source)).sha256!==sourceHash)throw new Error('Input changed during execution; generated output was not activated');
    return finalize(root,pending,receipt);
  });
}
export async function collectEditorJob({projectDir,caller=null,fetchImpl=fetch,signal}={}) {
  return exclusiveProjectOperation(projectDir,async()=>{
    const state=(await loadProjectState(projectDir)).state,pending=state.editor?.pendingJob;
    if(!pending)throw new Error('No pending editor job');
    const collected=await collectCompanionJob(pending,{caller,fetchImpl,signal});
    if(collected.pending)return {verdict:'degraded',pending:true,jobId:pending.jobId};
    if(collected.failed){
      await updateProjectState(projectDir,next=>{
        if(next.editor.pendingJob?.jobId!==pending.jobId)throw new Error('Job changed');
        next.editor.lastFailedJob={id:pending.jobId,error:collected.receipt.error};
        next.editor.pendingJob=null;
      });
      return {verdict:'fail',error:collected.receipt.error};
    }
    try {
      return await finalize(path.resolve(projectDir),pending,collected.receipt);
    } catch (error) {
      await updateProjectState(projectDir,next=>{
        if(next.editor?.pendingJob?.jobId===pending.jobId){
          next.editor.pendingJob=null;
          next.editor.lastFailedJob={id:pending.jobId,error:error.message};
        }
      }).catch(()=>{});
      throw error;
    }
  });
}

export async function cancelEditorJob({projectDir,caller=null,fetchImpl=fetch,signal}={}) {
  const state=(await loadProjectState(projectDir)).state,pending=state.editor?.pendingJob;
  if(!pending)throw new Error('No pending editor job');
  const receipt=await cancelCompanionJob(pending,{caller,fetchImpl,signal});
  return {verdict:'degraded',cancelRequested:true,jobId:pending.jobId,receipt,next:'Collect terminal status before resubmitting; cancellation is not an artifact or refund confirmation'};
}
