import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { REQUIRED_VIEW_SLOTS } from '../constants.js';
import { validatePng } from '../providers/image-router.js';
import { validateGlb } from '../tripo/free-quota-scheduler.js';
import { loadProjectState, updateProjectState, ensureProjectLayout } from './state.js';
import { invalidateFrom, scopedFile, verifyAsset, sha256 } from './reviews.js';

const SOURCE_SLOT = 'source';

export function inspectGlb(bytes) {
  const json = validateGlb(bytes);
  // A distributable preview must not fetch arbitrary file:/http: resources from untrusted GLB metadata.
  for (const item of [...(json.buffers || []), ...(json.images || [])]) {
    if (item.uri != null) throw new Error('GLB 预览仅接受内嵌 BIN / bufferView 资源；请重新导出自包含 GLB。');
  }
  const primitives = (json.meshes || []).flatMap(m => m.primitives || []);
  let binary = null;
  for (let offset = 12; offset < bytes.length;) {
    const size = bytes.readUInt32LE(offset);
    if (bytes.readUInt32LE(offset + 4) === 0x004e4942) binary = bytes.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size;
  }
  const positions = primitives.filter(p => {
    const a = json.accessors?.[p.attributes?.POSITION], view = json.bufferViews?.[a?.bufferView];
    if (!binary || p.extensions || a?.sparse || view?.extensions || !a || !view || view.buffer !== 0 || a.type !== 'VEC3' || a.componentType !== 5126 || a.count < 3 || (p.mode !== undefined && p.mode !== 4)) return false;
    const start = (view.byteOffset || 0) + (a.byteOffset || 0), stride = view.byteStride || 12;
    if (start < 0 || stride < 12 || !Number.isInteger(a.count) || a.count > 450000 || start + (a.count-1)*stride + 12 > binary.length) throw new Error('GLB POSITION accessor exceeds binary bounds');
    for (let i = 0; i < a.count; i++) for (let n = 0; n < 3; n++) if (!Number.isFinite(binary.readFloatLE(start + i*stride + n*4))) throw new Error('GLB contains non-finite positions');
    return true;
  });
  return { meshCount: json.meshes?.length || 0, primitiveCount: primitives.length, renderable: positions.length === primitives.length && positions.length > 0 && Boolean(json.scenes?.[json.scene || 0]?.nodes?.length),
    materials: json.materials?.length || 0, validation: 'glb2_embedded_mesh_not_topology_certification' };
}
async function inputBytes({ sourcePath, dataBase64 }, projectDir, limit) {
  let bytes;
  if (dataBase64 !== undefined) {
    if (typeof dataBase64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(dataBase64) || dataBase64.length % 4) throw new Error('Invalid base64 upload');
    if (dataBase64.length > Math.ceil(limit / 3) * 4) throw new Error('Upload exceeds size limit');
    bytes = Buffer.from(dataBase64, 'base64');
  } else {
    if (!sourcePath || typeof sourcePath !== 'string') throw new Error('Choose a file or enter its local path');
    const file = path.resolve(projectDir, sourcePath), stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > limit) throw new Error('Source file exceeds size limit');
    bytes = await fs.readFile(file);
  }
  if (!bytes.length || bytes.length > limit) throw new Error('Empty asset or size limit exceeded');
  return bytes;
}
async function immutableFile(root, kind, bytes) {
  const hash = sha256(bytes), relative = `assets/${kind}/${hash}.${kind === 'image' ? 'png' : 'glb'}`;
  const folder = path.dirname(path.join(root, relative));
  await fs.mkdir(folder, { recursive: true });
  // Reject an existing assets/ symlink outside the opened project.
  const realRoot = await fs.realpath(root), realFolder = await fs.realpath(folder), rel = path.relative(realRoot, realFolder);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Asset directory escapes project');
  const target = path.join(folder, path.basename(relative));
  try { await fs.writeFile(target, bytes, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; if (sha256(await fs.readFile(target)) !== hash) throw new Error('Existing immutable asset has changed'); }
  return { sha256: hash, filePath: relative, bytes: bytes.length };
}
function assertRevision(state, expectedRevision) {
  if (expectedRevision !== undefined && expectedRevision !== (state.stateRevision || 0)) throw new Error('Project changed concurrently; reload before selecting/importing');
}
function activateImage(state, asset, explicitSelection = false) {
  if (state.assets.clearedImages) delete state.assets.clearedImages[asset.slotId];
  if (asset.slotId === SOURCE_SLOT) {
    if (state.assets.selected.source === asset.id && state.characterSpec.sourceImages?.[0] === asset.filePath) return;
    state.assets.selected.source = asset.id;
    state.characterSpec.sourceImages = [asset.filePath];
    for (const view of Object.values(state.views)) if (view.assetId) view.status = 'stale';
    invalidateFrom(state, '1_concept', '已采用新的原画，请重新审阅；原画不占用 11 个视图槽。');
    return;
  }
  const view = state.views[asset.slotId];
  if (!view) throw new Error('Unknown image slot');
  if (view.assetId === asset.id && !explicitSelection) return;
  state.views[asset.slotId] = { ...view, assetId: asset.id, status: 'ready', filePath: asset.filePath,
    sha256: asset.sha256, updatedAt: new Date().toISOString() };
  invalidateFrom(state, '2_views', `视图 ${asset.slotId} 已更换，需重新审阅。`);
}
export async function importStudioAsset({ projectDir, kind = 'image', slotId, part = 'head', sourcePath, dataBase64, label, expectedRevision, activateView, requireRenderable=false } = {}) {
  if (!['image', 'glb'].includes(kind)) throw new Error('Invalid asset kind');
  if (kind === 'image' && slotId !== SOURCE_SLOT && !REQUIRED_VIEW_SLOTS.some(s => s.id === slotId)) throw new Error('Unknown image slot');
  if (kind === 'glb' && !['head', 'body', 'accessory'].includes(part)) throw new Error('Unknown GLB part');
  const loaded = await loadProjectState(projectDir);
  if (!loaded.exists) throw new Error('Initialize project before importing assets');
  assertRevision(loaded.state, expectedRevision);
  const bytes = await inputBytes({ sourcePath, dataBase64 }, loaded.projectDir, kind === 'image' ? 20 * 1024 * 1024 : 128 * 1024 * 1024);
  let info;
  if (kind === 'image') { validatePng(bytes); info = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }; }
  else {info=inspectGlb(bytes);if(requireRenderable&&!info.renderable)throw new Error('Export an embedded, uncompressed GLB with a previewable mesh');}
  const root = await ensureProjectLayout(projectDir), stored = await immutableFile(root, kind, bytes);
  let asset;
  const saved = await updateProjectState(root, state => {
    assertRevision(state, expectedRevision);
    state.assets ||= { items: [], selected: {} };
    asset = state.assets.items.find(a => a.kind === kind && a.sha256 === stored.sha256 && (kind === 'image' ? a.slotId === slotId : a.part === part));
    if (!asset) {
      asset = { id: 'asset_' + crypto.randomUUID(), kind, ...(kind === 'image' ? { slotId } : { part }), ...stored, ...info, label: String(label || (sourcePath ? path.basename(sourcePath) : slotId || part)).slice(0,180), createdAt: new Date().toISOString() };
      state.assets.items.push(asset);
    }
    if (kind === 'image' && (activateView === true || (activateView !== false && !state.assets.clearedImages?.[slotId] && (slotId === SOURCE_SLOT || !state.views[slotId].assetId)))) activateImage(state, asset);
    state.auditLog.push({ at: new Date().toISOString(), event: 'asset.import', detail: asset.id });
  });
  return { asset, projectState: saved.state, validation: kind === 'image' ? 'png_bytes_only' : info.validation };
}
function activateCandidate(state, asset) {
  if (!asset.renderable) throw new Error('GLB contains no previewable mesh');
  if (state.assets.selected[asset.part] === asset.id) return;
  state.assets.selected[asset.part] = asset.id;
  state.tripoQuota.selectedCandidates[`${asset.part}Glb`] = asset.filePath;
  invalidateFrom(state, '3_tripo', `已采用 ${asset.part} 的新候选。`);
}

// Called only after a project material's actual bytes were verified. Reuse the
// existing asset gates and the immutable file, without uploading or copying it again.
export function linkMaterialAsset(state, material, intent) {
  const kind = intent === 'candidate' ? 'glb' : 'image';
  const slotId = intent === 'original' ? SOURCE_SLOT : intent === 'overlay' ? 'overlay' : material.target;
  const part = material.target;
  if (intent === 'candidate' && !['head', 'body', 'accessory'].includes(part)) throw new Error('Invalid candidate part');
  if (intent === 'view' && !REQUIRED_VIEW_SLOTS.some(slot => slot.id === slotId)) throw new Error('Invalid view slot');
  let asset = state.assets.items.find(a => a.materialId === material.id);
  if (!asset) {
    const info = kind === 'image' ? { width: material.width, height: material.height } : {
      renderable: material.renderable, meshCount: material.meshCount, primitiveCount: material.primitiveCount,
      materials: material.materials, validation: material.validation,
    };
    asset = { id: 'asset_' + crypto.randomUUID(), materialId: material.id, kind, ...(kind === 'glb' ? { part } : { slotId }),
      sha256: material.sha256, filePath: material.filePath, bytes: material.bytes, label: material.fileName,
      createdAt: new Date().toISOString(), ...info };
    state.assets.items.push(asset);
  }
  if (kind === 'glb') activateCandidate(state, asset);
  else if (intent !== 'overlay') activateImage(state, asset, true);
  return asset;
}

export async function selectStudioAsset({ projectDir, assetId, expectedRevision } = {}) {
  return updateProjectState(projectDir, async state => {
    assertRevision(state, expectedRevision);
    const asset = state.assets?.items?.find(a => a.id === assetId);
    if (!asset) throw new Error('Asset not found in this project');
    await verifyAsset(projectDir, asset);
    if (asset.kind === 'image') {
      if (asset.slotId === 'overlay') throw new Error('Use this reference as an editor overlay; it is not a view slot');
      activateImage(state, asset, true);
    } else activateCandidate(state, asset);
  });
}
// Clearing a slot is not deletion. Even later auto-activation paths don't fill a deliberately empty slot.
export async function clearStudioImage({projectDir,slotId,expectedAssetId=null,expectedRevision}={}) {
  if (!Number.isSafeInteger(expectedRevision)) throw new Error('Reload before changing the selected image');
  if (!['source','overlay'].includes(slotId) && !REQUIRED_VIEW_SLOTS.some(v=>v.id===slotId)) throw new Error('Unknown image slot');
  return updateProjectState(projectDir,state=>{
    assertRevision(state,expectedRevision);
    const active=(slotId==='source'?state.assets.selected?.source:slotId==='overlay'?state.editor?.view?.overlayAssetId:state.views[slotId]?.assetId)||null;
    if (active!==expectedAssetId || active && !state.assets.items.some(a=>a.kind==='image'&&a.id===active)) throw new Error('Selected image changed; reload before clearing');
    if (!active && !(slotId==='source' && state.characterSpec.sourceImages?.length)) throw new Error('This image slot is already empty');
    if (slotId==='source') {
      delete state.assets.selected.source;
      state.characterSpec.sourceImages=[];
      for(const view of Object.values(state.views))if(view.assetId)view.status='stale';
      invalidateFrom(state,'1_concept','已取消采用原画；保留候选，相关审阅需重做。');
    } else if(slotId==='overlay') {
      state.editor.view.overlayAssetId=null;
    } else {
      Object.assign(state.views[slotId],{assetId:null,status:'missing',filePath:null,sha256:null,modelUsed:null,updatedAt:new Date().toISOString()});
      invalidateFrom(state,'2_views','已取消采用视图 '+slotId+'；登记的图片仍保留。');
    }
    const materialId=active&&state.assets.items.find(a=>a.id===active)?.materialId;
    if(materialId)for(const key of Object.keys(state.materials?.selected||{}))if(state.materials.selected[key]===materialId)delete state.materials.selected[key];
    if(slotId!=='overlay')(state.assets.clearedImages||={})[slotId]=true;
    state.auditLog.push({at:new Date().toISOString(),event:'asset.image_cleared',detail:slotId});
  });
}

export async function scanGeneratedViews({ projectDir } = {}) {
  const imported = [], missing = [], failed = [];
  for (const slot of REQUIRED_VIEW_SLOTS) {
    const sourcePath = `views/${slot.group}/${slot.id}.png`;
    try {
      await scopedFile(projectDir, sourcePath);
      const result = await importStudioAsset({ projectDir, kind: 'image', slotId: slot.id, sourcePath });
      const active = result.projectState.views[slot.id];
      imported.push({ slotId: slot.id, assetId: result.asset.id, selected: active.status === 'ready' && active.assetId === result.asset.id });
    } catch (error) { (error.code === 'ENOENT' ? missing : failed).push({ slotId: slot.id, reason: error.message }); }
  }
  return { imported, missing, failed, verdict: failed.length || missing.length ? 'degraded' : 'pass' };
}
export async function getAssetContent(projectDir, assetId) {
  const loaded = await loadProjectState(projectDir), item = loaded.state?.assets?.items?.find(a => a.id === assetId);
  if (!item) throw new Error('Unknown asset ID');
  const { bytes } = await verifyAsset(projectDir, item);
  return { bytes, mime: item.kind === 'image' ? 'image/png' : 'model/gltf-binary', sha256: item.sha256 };
}
