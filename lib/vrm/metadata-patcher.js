import crypto from 'node:crypto';

const GLB_MAGIC = 0x46546c67; // 'glTF'
const GLB_VERSION = 2;
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

const ALLOWED_ENUMS = Object.freeze({
  avatarPermission: ['onlyAuthor', 'onlySeparatelyLicensedPerson', 'everyone'],
  commercialUsage: ['personalNonProfit', 'personalProfit', 'corporation'],
  creditNotation: ['required', 'unnecessary'],
  modification: ['prohibited', 'allowModification', 'allowModificationRedistribution'],
});

const BOOLEAN_FIELDS = new Set([
  'allowExcessivelyViolentUsage',
  'allowExcessivelySexualUsage',
  'allowPoliticalOrReligiousUsage',
  'allowAntisocialOrHateUsage',
  'allowRedistribution',
]);

const STRING_LIMITS = Object.freeze({
  name: { min: 1, max: 256, trim: true },
  version: { min: 1, max: 128, trim: true },
  copyrightInformation: { min: 0, max: 512, trim: false },
  contactInformation: { min: 0, max: 512, trim: false },
  thirdPartyLicenses: { min: 0, max: 4096, trim: false },
  licenseUrl: { min: 0, max: 1024, trim: true, url: true },
  otherLicenseUrl: { min: 0, max: 1024, trim: true, url: true },
});

const ALLOWED_UPDATE_KEYS = new Set([
  'title',
  'name',
  'version',
  'authors',
  'copyrightInformation',
  'contactInformation',
  'references',
  'thirdPartyLicenses',
  'licenseUrl',
  'avatarPermission',
  'allowExcessivelyViolentUsage',
  'allowExcessivelySexualUsage',
  'commercialUsage',
  'allowPoliticalOrReligiousUsage',
  'allowAntisocialOrHateUsage',
  'creditNotation',
  'allowRedistribution',
  'modification',
  'otherLicenseUrl',
]);

function validateHttpUrl(value, field) {
  if (!value) return '';
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid URL for ${field}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${field} must use http or https`);
  }
  return value;
}

function validateStringField(value, field, spec) {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) {
    throw new Error(`${field} contains invalid control characters`);
  }
  const normalized = spec.trim ? value.trim() : value;
  if (normalized.length < spec.min || normalized.length > spec.max) {
    throw new Error(`${field} length must be between ${spec.min} and ${spec.max}`);
  }
  if (spec.url) validateHttpUrl(normalized, field);
  return normalized;
}

function validateStringArray(value, field, { minItems, maxItems, maxItemLength, requireNonEmptyItem }) {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array of strings`);
  if (value.length < minItems || value.length > maxItems) {
    throw new Error(`${field} count must be between ${minItems} and ${maxItems}`);
  }
  return value.map((item, idx) => {
    if (typeof item !== 'string') throw new Error(`${field}[${idx}] must be a string`);
    if (/[\x00-\x1f]/.test(item)) throw new Error(`${field}[${idx}] contains invalid control characters`);
    const clean = item.trim();
    if (requireNonEmptyItem && clean.length === 0) {
      throw new Error(`${field}[${idx}] must not be empty`);
    }
    if (clean.length > maxItemLength) {
      throw new Error(`${field}[${idx}] exceeds maximum length ${maxItemLength}`);
    }
    return clean;
  });
}

function parseVrmGlb(rawBytes) {
  const buf = Buffer.isBuffer(rawBytes) ? rawBytes : Buffer.from(rawBytes);
  if (buf.length < 20) throw new Error('Invalid GLB 2.0: buffer too short');
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error('Invalid GLB 2.0 magic');
  if (buf.readUInt32LE(4) !== GLB_VERSION) throw new Error('Invalid GLB version; expected 2');
  const totalByteLength = buf.readUInt32LE(8);
  if (totalByteLength !== buf.length) {
    throw new Error(`GLB total length mismatch: header=${totalByteLength}, actual=${buf.length}`);
  }

  let offset = 12;
  let chunkIndex = 0;
  let jsonBytes = null;
  let binBytes = null;
  const extraChunks = [];

  while (offset < buf.length) {
    if (offset + 8 > buf.length) throw new Error('Truncated GLB chunk header');
    const chunkLen = buf.readUInt32LE(offset);
    const chunkType = buf.readUInt32LE(offset + 4);
    if (chunkLen % 4 !== 0 || offset + 8 + chunkLen > buf.length) {
      throw new Error('Invalid GLB chunk length or alignment');
    }
    const payload = buf.subarray(offset + 8, offset + 8 + chunkLen);
    if (chunkIndex === 0 && chunkType !== CHUNK_JSON) {
      throw new Error('GLB first chunk must be JSON');
    }
    if (chunkType === CHUNK_JSON) {
      if (jsonBytes !== null) throw new Error('Duplicate GLB JSON chunk');
      jsonBytes = payload;
    } else if (chunkType === CHUNK_BIN) {
      if (binBytes !== null) throw new Error('Duplicate GLB BIN chunk');
      binBytes = Buffer.from(payload);
    } else {
      extraChunks.push({ type: chunkType, payload: Buffer.from(payload) });
    }
    offset += 8 + chunkLen;
    chunkIndex += 1;
  }

  if (!jsonBytes) throw new Error('Missing GLB JSON chunk');
  let gltf;
  try {
    gltf = JSON.parse(jsonBytes.toString('utf8').replace(/[\x20\x00]+$/, ''));
  } catch (error) {
    throw new Error(`Invalid GLB JSON chunk: ${error.message}`);
  }
  if (gltf?.asset?.version !== '2.0') {
    throw new Error('GLB asset.version must be "2.0"');
  }
  const vrm = gltf?.extensions?.VRMC_vrm;
  if (!vrm || typeof vrm !== 'object' || vrm.specVersion !== '1.0') {
    throw new Error('Missing or unsupported VRMC_vrm extension (specVersion === "1.0" required)');
  }
  if (vrm.meta !== undefined && (!vrm.meta || typeof vrm.meta !== 'object' || Array.isArray(vrm.meta))) {
    throw new Error('Invalid VRMC_vrm.meta object');
  }
  const meta = vrm.meta || {};

  return {
    gltf,
    vrm,
    meta,
    jsonByteLength: jsonBytes.length,
    binByteLength: binBytes ? binBytes.length : 0,
    binBytes,
    extraChunks,
    totalByteLength,
  };
}

export function inspectVrmMetadata(rawBytes) {
  const parsed = parseVrmGlb(rawBytes);
  return {
    specVersion: parsed.vrm.specVersion,
    meta: structuredClone(parsed.meta),
    jsonByteLength: parsed.jsonByteLength,
    binByteLength: parsed.binByteLength,
    totalByteLength: parsed.totalByteLength,
  };
}

export function patchVrmMetadata(rawBytes, updates = {}) {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    throw new Error('VRM metadata updates must be a plain object');
  }
  for (const key of Object.keys(updates)) {
    if (!ALLOWED_UPDATE_KEYS.has(key)) {
      throw new Error(`Unsupported VRM metadata field: ${key}`);
    }
  }

  const parsed = parseVrmGlb(rawBytes);
  const nextMeta = structuredClone(parsed.meta);

  if (updates.title !== undefined) {
    nextMeta.name = validateStringField(updates.title, 'title', STRING_LIMITS.name);
  }
  if (updates.name !== undefined) {
    nextMeta.name = validateStringField(updates.name, 'name', STRING_LIMITS.name);
  }

  for (const [field, spec] of Object.entries(STRING_LIMITS)) {
    if (field === 'name') continue;
    if (updates[field] !== undefined) {
      nextMeta[field] = validateStringField(updates[field], field, spec);
    }
  }

  if (updates.authors !== undefined) {
    nextMeta.authors = validateStringArray(updates.authors, 'authors', {
      minItems: 1,
      maxItems: 64,
      maxItemLength: 256,
      requireNonEmptyItem: true,
    });
  }

  if (updates.references !== undefined) {
    nextMeta.references = validateStringArray(updates.references, 'references', {
      minItems: 0,
      maxItems: 64,
      maxItemLength: 512,
      requireNonEmptyItem: true,
    });
  }

  for (const [field, allowed] of Object.entries(ALLOWED_ENUMS)) {
    if (updates[field] !== undefined) {
      if (typeof updates[field] !== 'string' || !allowed.includes(updates[field])) {
        throw new Error(`${field} must be one of: ${allowed.join(', ')}`);
      }
      nextMeta[field] = updates[field];
    }
  }

  for (const field of BOOLEAN_FIELDS) {
    if (updates[field] !== undefined) {
      if (typeof updates[field] !== 'boolean') {
        throw new Error(`${field} must be a boolean`);
      }
      nextMeta[field] = updates[field];
    }
  }

  parsed.vrm.meta = nextMeta;

  const jsonRaw = Buffer.from(JSON.stringify(parsed.gltf), 'utf8');
  const jsonPadLen = (4 - (jsonRaw.length % 4)) % 4;
  const jsonChunkPayload = jsonPadLen > 0
    ? Buffer.concat([jsonRaw, Buffer.alloc(jsonPadLen, 0x20)])
    : jsonRaw;

  const chunks = [{ type: CHUNK_JSON, payload: jsonChunkPayload }];
  if (parsed.binBytes !== null) {
    chunks.push({ type: CHUNK_BIN, payload: parsed.binBytes });
  }
  for (const extra of parsed.extraChunks) {
    chunks.push(extra);
  }

  const totalLength = 12 + chunks.reduce((sum, ch) => sum + 8 + ch.payload.length, 0);
  const out = Buffer.allocUnsafe(totalLength);
  out.writeUInt32LE(GLB_MAGIC, 0);
  out.writeUInt32LE(GLB_VERSION, 4);
  out.writeUInt32LE(totalLength, 8);

  let writeOffset = 12;
  for (const ch of chunks) {
    out.writeUInt32LE(ch.payload.length, writeOffset);
    out.writeUInt32LE(ch.type, writeOffset + 4);
    ch.payload.copy(out, writeOffset + 8);
    writeOffset += 8 + ch.payload.length;
  }

  const sha256 = crypto.createHash('sha256').update(out).digest('hex');
  return {
    bytes: out,
    meta: structuredClone(nextMeta),
    sha256,
  };
}
