import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
export async function tempProject(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'charastudio-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
export function crc32(b) { let c = 0xffffffff; for (const x of b) { c ^= x; for (let j = 0; j < 8; j++) c = c >>> 1 ^ (0xedb88320 & -(c & 1)); } return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, b.length - 4)), b.length - 4); return b;
}
export function png(width=1,height=1) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw=Buffer.alloc((1+width*4)*height);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) raw.set([250,50,100,255], y*(width*4+1)+1+x*4);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export function zip(data, method = 8, descriptor = false) {
  const name = Buffer.from('image_0.png'), packed = method === 8 ? zlib.deflateRawSync(data) : data;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(descriptor ? 8 : 0, 6); local.writeUInt16LE(method, 8); local.writeUInt16LE(name.length, 26);
  if (!descriptor) { local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); }
  const dd = Buffer.alloc(descriptor ? 16 : 0); if (descriptor) { dd.writeUInt32LE(0x08074b50); dd.writeUInt32LE(crc32(data), 4); dd.writeUInt32LE(packed.length, 8); dd.writeUInt32LE(data.length, 12); }
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(descriptor ? 8 : 0, 8); cd.writeUInt16LE(method, 10); cd.writeUInt32LE(crc32(data), 16); cd.writeUInt32LE(packed.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(cd.length + name.length, 12); end.writeUInt32LE(local.length + name.length + packed.length + dd.length, 16);
  return Buffer.concat([local,name,packed,dd,cd,name,end]);
}
export function glb(extra = {}) {
  let json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, ...extra })); json = Buffer.concat([json, Buffer.alloc((4-json.length%4)%4, 32)]);
  const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2,4); header.writeUInt32LE(20+json.length,8); header.writeUInt32LE(json.length,12); header.writeUInt32LE(0x4e4f534a,16); return Buffer.concat([header,json]);
}
export function triangleGlb() {
  const data = Buffer.alloc(36); [-1,-1,0,1,-1,0,0,1,0].forEach((v,i) => data.writeFloatLE(v,i*4));
  const base = glb({ buffers:[{byteLength:36}], bufferViews:[{buffer:0,byteOffset:0,byteLength:36}], accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[-1,-1,0],max:[1,1,0]}], meshes:[{primitives:[{attributes:{POSITION:0}}]}], nodes:[{mesh:0}], scenes:[{nodes:[0]}], scene:0 });
  const chunk = Buffer.alloc(8); chunk.writeUInt32LE(data.length); chunk.writeUInt32LE(0x004e4942,4);
  const all = Buffer.concat([base,chunk,data]); all.writeUInt32LE(all.length,8); return all;
}

export async function readyAssetProject(dir) {
  const { initOrUpdateProject, transitionStageCheckpoint } = await import('../lib/project/state.js');
  const { importStudioAsset, selectStudioAsset } = await import('../lib/project/assets.js');
  const { REQUIRED_VIEW_SLOTS } = await import('../lib/constants.js');
  await initOrUpdateProject(dir, { characterPrompt: 'Procedural avatar fixture for checkpoint tests' });
  async function approve() { await transitionStageCheckpoint(dir,{action:'request_review'});await transitionStageCheckpoint(dir,{action:'approve',actor:'user'}); }
  await approve();
  for (const slot of REQUIRED_VIEW_SLOTS) await importStudioAsset({projectDir:dir,slotId:slot.id,dataBase64:png().toString('base64')});
  await approve();
  for (const part of ['head','body']) { const a=await importStudioAsset({projectDir:dir,kind:'glb',part,dataBase64:triangleGlb().toString('base64')});await selectStudioAsset({projectDir:dir,assetId:a.asset.id}); }
  await approve();
}
