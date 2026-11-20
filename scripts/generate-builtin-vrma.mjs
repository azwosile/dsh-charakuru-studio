#!/usr/bin/env node
/**
 * Clean-Room MIT/CC0 Procedural Looping Walk Cycle VRMA 1.0 Generator.
 * Produces assets/motions/cleanroom_walk_loop.vrma (0..1.0s seamless loop).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const DURATION_S = 1.0;
const FRAME_COUNT = 25; // 24 intervals over 0..1.0s, frame 24 === frame 0

function quatFromEulerXYZ(rx, ry, rz) {
  const cx = Math.cos(rx * 0.5);
  const sx = Math.sin(rx * 0.5);
  const cy = Math.cos(ry * 0.5);
  const sy = Math.sin(ry * 0.5);
  const cz = Math.cos(rz * 0.5);
  const sz = Math.sin(rz * 0.5);
  // Intrinsic XYZ = qx * qy * qz
  const x = sx * cy * cz + cx * sy * sz;
  const y = cx * sy * cz - sx * cy * sz;
  const z = cx * cy * sz + sx * sy * cz;
  const w = cx * cy * cz - sx * sy * sz;
  const len = Math.hypot(x, y, z, w) || 1;
  return [x / len, y / len, z / len, w / len];
}

function quatMultiply(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  const x = aw * bx + ax * bw + ay * bz - az * by;
  const y = aw * by - ax * bz + ay * bw + az * bx;
  const z = aw * bz + ax * by - ay * bx + az * bw;
  const w = aw * bw - ax * bx - ay * by - az * bz;
  const len = Math.hypot(x, y, z, w) || 1;
  return [x / len, y / len, z / len, w / len];
}

function quatFromAxisAngle(ax, ay, az, angle) {
  const half = angle * 0.5;
  const s = Math.sin(half);
  return [ax * s, ay * s, az * s, Math.cos(half)];
}

const BONE_DEFS = [
  { name: 'hips', parent: null, translation: [0, 0.9, 0] },
  { name: 'spine', parent: 'hips', translation: [0, 0.1, 0] },
  { name: 'chest', parent: 'spine', translation: [0, 0.16, 0] },
  { name: 'neck', parent: 'chest', translation: [0, 0.18, 0] },
  { name: 'head', parent: 'neck', translation: [0, 0.08, 0] },
  { name: 'leftUpperArm', parent: 'chest', translation: [0.15, 0.15, 0] },
  { name: 'leftLowerArm', parent: 'leftUpperArm', translation: [0.24, 0, 0] },
  { name: 'rightUpperArm', parent: 'chest', translation: [-0.15, 0.15, 0] },
  { name: 'rightLowerArm', parent: 'rightUpperArm', translation: [-0.24, 0, 0] },
  { name: 'leftUpperLeg', parent: 'hips', translation: [0.09, -0.05, 0] },
  { name: 'leftLowerLeg', parent: 'leftUpperLeg', translation: [0, -0.42, 0] },
  { name: 'leftFoot', parent: 'leftLowerLeg', translation: [0, -0.4, 0] },
  { name: 'rightUpperLeg', parent: 'hips', translation: [-0.09, -0.05, 0] },
  { name: 'rightLowerLeg', parent: 'rightUpperLeg', translation: [0, -0.42, 0] },
  { name: 'rightFoot', parent: 'rightLowerLeg', translation: [0, -0.4, 0] },
];

function sampleWalkFrame(tNorm) {
  const phase = 2 * Math.PI * tNorm;
  const phaseOpp = phase + Math.PI;

  const hipsTranslation = [
    0.015 * Math.sin(phase),
    0.9 - 0.024 * (1 - Math.cos(2 * phase)),
    0,
  ];

  const legSwing = (p) => -0.42 * Math.sin(p);
  const kneeBend = (p) => 0.06 + 0.72 * Math.pow(0.5 * (1 - Math.cos(p - 0.85)), 1.8);
  const anklePitch = (p) => -0.20 * Math.sin(p + 0.45);

  const armDropL = quatFromAxisAngle(0, 0, 1, -1.18);
  const armDropR = quatFromAxisAngle(0, 0, 1, 1.18);

  const rotations = {
    hips: quatFromEulerXYZ(0.03, 0.06 * Math.sin(phase), 0.03 * Math.sin(phase)),
    spine: quatFromEulerXYZ(0.04, -0.04 * Math.sin(phase), -0.02 * Math.sin(phase)),
    chest: quatFromEulerXYZ(0.02 + 0.015 * Math.cos(2 * phase), -0.06 * Math.sin(phase), 0),
    neck: quatFromEulerXYZ(-0.02, 0.03 * Math.sin(phase), 0),
    head: quatFromEulerXYZ(-0.02 * Math.cos(2 * phase), 0.03 * Math.sin(phase), 0),

    leftUpperLeg: quatFromAxisAngle(1, 0, 0, legSwing(phase)),
    leftLowerLeg: quatFromAxisAngle(1, 0, 0, kneeBend(phase)),
    leftFoot: quatFromAxisAngle(1, 0, 0, anklePitch(phase)),

    rightUpperLeg: quatFromAxisAngle(1, 0, 0, legSwing(phaseOpp)),
    rightLowerLeg: quatFromAxisAngle(1, 0, 0, kneeBend(phaseOpp)),
    rightFoot: quatFromAxisAngle(1, 0, 0, anklePitch(phaseOpp)),

    // Left arm swings opposite to left leg (in phase with right leg)
    leftUpperArm: quatMultiply(
      quatFromAxisAngle(0, 1, 0, 0.4 * Math.sin(phase)),
      armDropL,
    ),
    leftLowerArm: quatFromAxisAngle(0, 1, 0, -(0.32 + 0.14 * (1 - Math.cos(phaseOpp)))),

    // Right arm swings opposite to right leg (in phase with left leg)
    rightUpperArm: quatMultiply(
      quatFromAxisAngle(0, 1, 0, 0.4 * Math.sin(phase)),
      armDropR,
    ),
    rightLowerArm: quatFromAxisAngle(0, 1, 0, 0.32 + 0.14 * (1 - Math.cos(phase))),
  };

  return { hipsTranslation, rotations };
}

export function buildWalkLoopVrmaBuffer() {
  const nodeIndex = new Map(BONE_DEFS.map((b, idx) => [b.name, idx]));
  const childrenMap = new Map(BONE_DEFS.map((b) => [b.name, []]));
  for (const b of BONE_DEFS) {
    if (b.parent) childrenMap.get(b.parent).push(nodeIndex.get(b.name));
  }

  const nodes = BONE_DEFS.map((b) => {
    const node = {
      name: b.name,
      translation: b.translation,
    };
    const kids = childrenMap.get(b.name);
    if (kids.length) node.children = kids;
    return node;
  });

  const times = new Float32Array(FRAME_COUNT);
  const hipsTransData = new Float32Array(FRAME_COUNT * 3);
  const rotDataByBone = new Map(
    BONE_DEFS.map((b) => [b.name, new Float32Array(FRAME_COUNT * 4)]),
  );

  for (let i = 0; i < FRAME_COUNT; i += 1) {
    const tNorm = i === FRAME_COUNT - 1 ? 0 : i / (FRAME_COUNT - 1);
    times[i] = (i / (FRAME_COUNT - 1)) * DURATION_S;
    const frame = sampleWalkFrame(tNorm);
    hipsTransData.set(frame.hipsTranslation, i * 3);
    for (const b of BONE_DEFS) {
      rotDataByBone.get(b.name).set(frame.rotations[b.name], i * 4);
    }
  }

  // Pack all Float32 arrays into one binary buffer
  const chunks = [];
  const bufferViews = [];
  const accessors = [];
  let byteOffset = 0;

  function appendArray(typedArray, type, min = null, max = null) {
    const raw = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
    const bvIndex = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: raw.length,
    });
    const accIndex = accessors.length;
    const componentCount = type === 'SCALAR' ? 1 : type === 'VEC3' ? 3 : 4;
    const accessor = {
      bufferView: bvIndex,
      componentType: 5126, // FLOAT
      count: typedArray.length / componentCount,
      type,
    };
    if (min !== null) accessor.min = min;
    if (max !== null) accessor.max = max;
    accessors.push(accessor);
    chunks.push(raw);
    byteOffset += raw.length;
    return accIndex;
  }

  const timeAccessor = appendArray(times, 'SCALAR', [0], [DURATION_S]);
  const hipsTransAccessor = appendArray(hipsTransData, 'VEC3');
  const rotAccessorByBone = new Map();
  for (const b of BONE_DEFS) {
    rotAccessorByBone.set(b.name, appendArray(rotDataByBone.get(b.name), 'VEC4'));
  }

  const samplers = [];
  const channels = [];

  // Channel 0: hips translation
  samplers.push({ input: timeAccessor, output: hipsTransAccessor, interpolation: 'LINEAR' });
  channels.push({ sampler: 0, target: { node: nodeIndex.get('hips'), path: 'translation' } });

  // Channels 1..15: bone rotations
  for (const b of BONE_DEFS) {
    const samplerIdx = samplers.length;
    samplers.push({
      input: timeAccessor,
      output: rotAccessorByBone.get(b.name),
      interpolation: 'LINEAR',
    });
    channels.push({
      sampler: samplerIdx,
      target: { node: nodeIndex.get(b.name), path: 'rotation' },
    });
  }

  const humanBones = {};
  for (const b of BONE_DEFS) {
    humanBones[b.name] = { node: nodeIndex.get(b.name) };
  }

  const binRaw = Buffer.concat(chunks);
  const binPad = (4 - (binRaw.length % 4)) % 4;
  const binPayload = binPad > 0 ? Buffer.concat([binRaw, Buffer.alloc(binPad, 0x00)]) : binRaw;

  const gltf = {
    asset: {
      version: '2.0',
      generator: 'dsh-charakuru-studio cleanroom-vrma-generator (MIT)',
    },
    extensionsUsed: ['VRMC_vrm_animation'],
    scenes: [{ nodes: [0] }],
    scene: 0,
    nodes,
    buffers: [{ byteLength: binPayload.length }],
    bufferViews,
    accessors,
    animations: [
      {
        name: 'cleanroom_walk_loop',
        samplers,
        channels,
      },
    ],
    extensions: {
      VRMC_vrm_animation: {
        specVersion: '1.0',
        humanoid: { humanBones },
      },
    },
  };

  const jsonRaw = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonPad = (4 - (jsonRaw.length % 4)) % 4;
  const jsonPayload = jsonPad > 0 ? Buffer.concat([jsonRaw, Buffer.alloc(jsonPad, 0x20)]) : jsonRaw;

  const totalLength = 12 + 8 + jsonPayload.length + 8 + binPayload.length;
  const glb = Buffer.allocUnsafe(totalLength);
  glb.writeUInt32LE(GLB_MAGIC, 0);
  glb.writeUInt32LE(GLB_VERSION, 4);
  glb.writeUInt32LE(totalLength, 8);
  glb.writeUInt32LE(jsonPayload.length, 12);
  glb.writeUInt32LE(CHUNK_JSON, 16);
  jsonPayload.copy(glb, 20);
  const binHeaderOffset = 20 + jsonPayload.length;
  glb.writeUInt32LE(binPayload.length, binHeaderOffset);
  glb.writeUInt32LE(CHUNK_BIN, binHeaderOffset + 4);
  binPayload.copy(glb, binHeaderOffset + 8);
  return glb;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const outPath = path.join(repoRoot, 'assets', 'motions', 'cleanroom_walk_loop.vrma');
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const bytes = buildWalkLoopVrmaBuffer();
  await fs.writeFile(outPath, bytes);
  console.log(`Generated ${outPath} (${bytes.length} bytes)`);
}
