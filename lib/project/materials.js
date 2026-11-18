import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { REQUIRED_VIEW_SLOTS } from '../constants.js';
import { validatePng } from '../providers/image-router.js';
import { validateGlb } from '../tripo/free-quota-scheduler.js';
import { linkMaterialAsset, inspectGlb } from './assets.js';
import { getMaterialRole } from './material-roles.js';
import { scopedFile, sha256 } from './reviews.js';
import { loadProjectState, updateProjectState } from './state.js';
import { exclusiveProjectOperation } from './operations.js';

const MAX_FILES = 240;
const MAX_PROJECT_BYTES = 2 * 1024 ** 3;
const MATERIAL_ID = /^material_[a-f0-9-]{36}$/;
const registry = () => ({ items: [], selected: {} });
const TOO_LARGE = () => Object.assign(new Error('文件超过此工序的大小限制 / Material exceeds its size limit'), { statusCode: 413 });

function requireRevision(state, expected) {
  if (!Number.isSafeInteger(expected) || expected !== state.stateRevision) {
    throw Object.assign(new Error('工程版本已变化，请刷新后再导入或采用 / Reload the project before importing or using material'), { statusCode: 409 });
  }
}

function targetKey(role, slotId, part) {
  if (role.intent === 'view' && !REQUIRED_VIEW_SLOTS.some(slot => slot.id === slotId)) throw new Error('请选择有效的视图槽位 / Choose a view slot');
  if (role.intent === 'candidate' && !['head', 'body', 'accessory'].includes(part)) throw new Error('请选择头部、身体或配饰 / Choose head, body or accessory');
  return role.intent === 'view' ? slotId : role.intent === 'candidate' ? part : '';
}

function safeName(value) {
  if (typeof value !== 'string' || value.length < 2 || value.length > 240 || /[\\/:\x00-\x1f]/.test(value) || value !== value.trim()) {
    throw new Error('Invalid file name');
  }
  return value;
}

function localSource(value) {
  if (typeof value !== 'string' || value.length > 4096 || !path.isAbsolute(value) || /^[/\\]{2}/.test(value) || /[\x00-\x1f]/.test(value) || value.slice(process.platform === 'win32' ? 2 : 0).includes(':')) {
    throw new Error('请选择本机文件或输入本机磁盘绝对路径（不支持 URL、设备及网络共享路径） / Choose a local file');
  }
  if (process.platform === 'win32' && !/^[a-z]:[\\/]/i.test(value)) throw new Error('Choose an absolute path on a local Windows drive');
  return value;
}

async function storageFolder(root) {
  const folder = path.join(root, 'materials');
  await fs.mkdir(folder, { recursive: true });
  const relative = path.relative(await fs.realpath(root), await fs.realpath(folder));
  if (relative !== 'materials') throw new Error('Material storage must not be redirected outside its project folder');
  return folder;
}

function rejectExternalGltf(gltf) {
  if ([...(gltf.buffers || []), ...(gltf.images || [])].some(resource => resource.uri != null)) {
    throw new Error('请使用嵌入缓冲区和贴图的自包含 GLB / VRM / VRMA / External model resources are not supported');
  }
  if ((gltf.extensionsRequired || []).some(id => ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'].includes(id))) {
    throw new Error('此视口未内置必需的 Draco、Meshopt 或 KTX2 解码器 / Export without required compression');
  }
}

const blendMagic = bytes => bytes.length >= 12 && bytes.subarray(0, 7).toString() === 'BLENDER';

async function inspectBlendHeader(file) {
  const handle = await fs.open(file, 'r');
  const head = Buffer.alloc(12); let bytesRead;
  try { ({ bytesRead } = await handle.read(head, 0, head.length, 0)); } finally { await handle.close(); }
  const header = head.subarray(0, bytesRead);
  if (blendMagic(header)) return 'none';
  const gzip = header[0] === 0x1f && header[1] === 0x8b;
  const zstd = header.length >= 4 && header.readUInt32LE(0) === 0xfd2fb528;
  if (!gzip && !zstd) throw new Error('不是 Blender 文件 / Expected an uncompressed or gzip/Zstandard Blender container');
  if (zstd && typeof zlib.createZstdDecompress !== 'function') {
    throw new Error('此 Host 的 Node 无法检查 Zstandard Blend；请换 Node 24 或另存为未压缩 Blend / Zstandard requires a compatible Node runtime or an uncompressed Blend');
  }
  // Only check the decoded prefix, never inflate an entire scene in the Host.
  const source = createReadStream(file, { end: 256 * 1024 - 1, highWaterMark: 4096 });
  const decode = gzip ? zlib.createGunzip({ chunkSize: 4096 }) : zlib.createZstdDecompress({ chunkSize: 4096,
    params: { [zlib.constants.ZSTD_d_windowLogMax]: 25 } });
  source.on('error', error => decode.destroy(error));
  let decoded = Buffer.alloc(0);
  try {
    for await (const part of source.pipe(decode)) {
      decoded = Buffer.concat([decoded, part.subarray(0, 12 - decoded.length)]);
      if (decoded.length === 12) break;
    }
  } catch (error) {
    throw new Error('压缩 Blend 文件头无效 / Invalid compressed Blender header', { cause: error });
  } finally { source.destroy(); decode.destroy(); }
  if (!blendMagic(decoded)) throw new Error('压缩内容不是 Blender 场景 / Compressed data is not a Blender file');
  return gzip ? 'gzip' : 'zstd';
}

async function inspectFile(file, ext) {
  if (ext === '.blend') return { validation: 'blend_header_only', encoding: await inspectBlendHeader(file) };
  const bytes = await fs.readFile(file);
  if (ext === '.png') {
    validatePng(bytes);
    return { validation: 'png_bytes_only', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  const gltf = validateGlb(bytes);
  rejectExternalGltf(gltf);
  if (ext === '.vrma') {
    const extension = gltf.extensions?.VRMC_vrm_animation;
    const bones = extension?.humanoid?.humanBones;
    if (extension?.specVersion !== '1.0' || !Number.isInteger(bones?.hips?.node) || !gltf.nodes?.[bones.hips.node] || !gltf.animations?.length) {
      throw new Error('需要包含骨骼映射和动作通道的 VRMA 1.0 / VRMC_vrm_animation 1.0 with motion is required');
    }
    return { validation: 'vrma1_extension_only', clips: gltf.animations.length };
  }
  if (ext === '.vrm') {
    const extension = gltf.extensions?.VRMC_vrm;
    if (extension?.specVersion !== '1.0' || !extension.humanoid?.humanBones || !gltf.meshes?.length) {
      throw new Error('需要自包含的 VRM 1.0 / A self-contained VRM 1.0 is required');
    }
    return { validation: 'vrm1_extension_only' };
  }
  const shape = inspectGlb(bytes);
  if (!shape.renderable) throw new Error('需要可预览的三角网格、自包含 GLB / A previewable embedded triangle mesh is required');
  return shape;
}

function selectRecord(state, materialId) {
  if (typeof materialId !== 'string' || !MATERIAL_ID.test(materialId)) throw new Error('Invalid material ID');
  const record = state?.materials?.items.find(item => item.id === materialId);
  if (!record) throw new Error('当前工程没有此素材 / Material not found in this project');
  const role = getMaterialRole(record.stageId, record.role);
  if (!/^[a-f0-9]{64}$/.test(record.sha256) || !role.extensions.includes(record.extension) || record.filePath !== `materials/${record.sha256}${record.extension}`) {
    throw new Error('Invalid material record');
  }
  return { record, role };
}

async function digestFile(filename, maxBytes) {
  const handle = await fs.open(filename, 'r');
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  try {
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw TOO_LARGE();
      hash.update(chunk);
    }
  } finally { await handle.close(); }
  return { bytes, sha256: hash.digest('hex') };
}

async function fileForRecord(projectDir, record, maxBytes) {
  const file = await scopedFile(projectDir, record.filePath);
  const actual = await digestFile(file, maxBytes);
  if (actual.bytes !== record.bytes || actual.sha256 !== record.sha256) throw new Error('素材指纹已变化；请重新导入 / Material fingerprint has changed');
  return file;
}

export async function resolveProjectMaterial(projectDir, materialId, expectedIntent) {
  const { state } = await loadProjectState(projectDir);
  const { record, role } = selectRecord(state, materialId);
  if (expectedIntent && role.intent !== expectedIntent) throw new Error('所选素材不能用于此编辑操作 / Material cannot be used for this operation');
  return { record, role, file: await fileForRecord(projectDir, record, role.maxBytes) };
}

export async function importProjectMaterial(options = {}) {
  const { projectDir, stageId, role: roleId, slotId, part, sourcePath, stream, fileName, declaredLength, expectedRevision } = options;
  const role = getMaterialRole(stageId, roleId);
  const target = targetKey(role, slotId, part);
  if (Boolean(sourcePath) === Boolean(stream)) throw new Error('Choose one local path or file');
  const source = sourcePath ? localSource(sourcePath) : null;
  const name = safeName(source ? path.basename(source) : fileName);
  const ext = path.extname(name).toLowerCase();
  if (!role.extensions.includes(ext)) throw new Error(`此用途仅接受 ${role.extensions.join(', ')} / Unsupported file extension`);
  if (declaredLength !== undefined) {
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 1) throw new Error('Invalid file size');
    if (declaredLength > role.maxBytes) throw TOO_LARGE();
  }
  const root = (await loadProjectState(projectDir)).projectDir;
  return exclusiveProjectOperation(root, async () => {
    const { state, exists } = await loadProjectState(root);
    if (!exists) throw new Error('请先初始化工程 / Initialize the project first');
    requireRevision(state, expectedRevision);
    const folder = await storageFolder(root), temporary = path.join(folder, `.incoming-${crypto.randomUUID()}`);
    let sourceHandle, outHandle, record, duplicate = false;
    try {
      if (source) {
        const realSource = localSource(await fs.realpath(source));
        if (!(await fs.stat(realSource)).isFile()) throw new Error('Source must be a regular file');
        sourceHandle = await fs.open(realSource, 'r');
        const stat = await sourceHandle.stat();
        if (!stat.isFile() || !stat.size) throw new Error('Source must be a nonempty regular file');
        if (stat.size > role.maxBytes) throw TOO_LARGE();
      }
      const input = source ? sourceHandle.createReadStream({ autoClose: false }) : stream;
      outHandle = await fs.open(temporary, 'wx', 0o600);
      const hash = crypto.createHash('sha256');
      let bytes = 0;
      for await (const chunk of input) {
        bytes += chunk.length;
        if (bytes > role.maxBytes) throw TOO_LARGE();
        hash.update(chunk);
        await outHandle.writeFile(chunk);
      }
      await outHandle.close(); outHandle = null;
      if (!bytes || declaredLength !== undefined && bytes !== declaredLength) throw new Error('File transfer was incomplete');
      const digest = hash.digest('hex');
      const info = await inspectFile(temporary, ext);
      const relativePath = `materials/${digest}${ext}`;
      const saved = await updateProjectState(root, async next => {
        requireRevision(next, expectedRevision);
        next.materials ||= registry();
        const items = next.materials.items;
        record = items.find(item => item.stageId === stageId && item.role === roleId && item.target === target && item.sha256 === digest);
        if (record) {
          duplicate = true;
          await fileForRecord(root, record, role.maxBytes);
          return;
        }
        if (items.length >= MAX_FILES) throw new Error('此工程素材条目已达上限 / Per-project material limit reached');
        if (items.reduce((sum, item) => sum + item.bytes, 0) + bytes > MAX_PROJECT_BYTES) throw new Error('此工程素材总量已达 2 GiB / Material storage limit reached');
        const dest = path.join(root, relativePath);
        try { await fs.copyFile(temporary, dest, constants.COPYFILE_EXCL); }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          await fileForRecord(root, { filePath: relativePath, sha256: digest, bytes }, role.maxBytes);
        }
        record = { id: `material_${crypto.randomUUID()}`, role: roleId, stageId, intent: role.intent, target,
          fileName: name, extension: ext, filePath: relativePath, sha256: digest, bytes, importedAt: new Date().toISOString(), ...info };
        items.push(record);
        next.auditLog.push({ at: record.importedAt, event: 'material.import', detail: `${stageId}:${roleId}:${record.id}` });
      });
      return { material: record, duplicate, used: false, stateRevision: saved.state.stateRevision };
    } finally {
      await Promise.allSettled([outHandle?.close(), sourceHandle?.close()]);
      await fs.rm(temporary, { force: true });
    }
  });
}

// Adopting PNG/GLB evidence is an explicit UI action; it still does not approve a stage.
export async function useProjectMaterial({ projectDir, materialId, expectedRevision } = {}) {
  let result;
  const saved = await updateProjectState(projectDir, async state => {
    requireRevision(state, expectedRevision);
    const { record, role } = selectRecord(state, materialId);
    await fileForRecord(projectDir, record, role.maxBytes);
    if (!['original', 'view', 'candidate', 'overlay'].includes(role.intent)) {
      throw new Error('此素材须在编辑器或视口中打开 / Use this material in the editor or preview');
    }
    const asset = linkMaterialAsset(state, record, role.intent);
    state.materials.selected[[record.stageId, record.role, record.target].filter(Boolean).join(':')] = record.id;
    state.auditLog.push({ at: new Date().toISOString(), event: 'material.use', detail: record.id });
    result = { material: record, assetId: asset?.id || null, usage: role.intent };
  });
  return { ...result, stateRevision: saved.state.stateRevision };
}

export async function materialContent(projectDir, materialId) {
  const { state } = await loadProjectState(projectDir);
  const { record, role } = selectRecord(state, materialId);
  if (record.extension === '.blend') throw new Error('Blender scenes are not served to the renderer');
  const file = await scopedFile(projectDir, record.filePath);
  const stat = await fs.stat(file);
  if (stat.size !== record.bytes || stat.size > role.maxBytes) throw new Error('Material size has changed');
  const bytes = await fs.readFile(file);
  if (bytes.length !== record.bytes || sha256(bytes) !== record.sha256) throw new Error('Material fingerprint has changed');
  return { bytes, mime: record.extension === '.png' ? 'image/png' : 'model/gltf-binary' };
}
