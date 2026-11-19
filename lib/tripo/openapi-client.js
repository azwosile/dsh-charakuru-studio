import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_TRIPO_API_URL } from '../constants.js';
import { ensureProjectLayout, loadProjectState, updateProjectState } from '../project/state.js';
import { scopedFile, sha256, verifyAsset } from '../project/reviews.js';
import { importStudioAsset } from '../project/assets.js';
import { importProjectMaterial, validateFbx } from '../project/materials.js';
import { createAccountBudget } from '../providers/account-budget.js';

const VIEWS = ['front', 'right', 'left', 'back'];
const POST_PROCESS_ACTIONS = new Set([
  'mesh_segment', 'segment',
  'mesh_decimate', 'decimate',
  'models_texture', 'texture',
  'mesh_complete', 'complete',
  'models_convert', 'convert',
]);

export const TRIPO_OPENAPI_ENDPOINTS = Object.freeze({
  image_to_model: '/generation/image-to-model',
  multiview_to_model: '/generation/multiview-to-model',
  text_to_model: '/generation/text-to-model',
  mesh_segment: '/mesh/segment',
  segment: '/mesh/segment',
  mesh_decimate: '/mesh/decimate',
  decimate: '/mesh/decimate',
  models_texture: '/models/texture',
  texture: '/models/texture',
  mesh_complete: '/mesh/complete',
  complete: '/mesh/complete',
  models_convert: '/models/convert',
  convert: '/models/convert',
});

function cleanBaseUrl(baseUrl) {
  return String(baseUrl || DEFAULT_TRIPO_API_URL).trim().replace(/\/+$/, '');
}

function requireApiKey(apiKey) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('TRIPO_API_KEY_REQUIRED: configure a Tripo OpenAPI v3 key first');
  }
  return apiKey.trim();
}

function validateExplicitMultiviewOptions(options, referenceMaterialIds) {
  const opts = options && typeof options === 'object' ? options : {};
  if (opts.views !== undefined) {
    if (Array.isArray(opts.views)) {
      const entries = opts.views.filter(Boolean);
      const hasFront = entries.some(v =>
        typeof v === 'string'
          ? v.toLowerCase() === 'front'
          : ['front'].includes(String(v?.view || v?.angle || v?.slot || '').toLowerCase())
      );
      if (entries.length < 2 || !hasFront) {
        throw new Error('multiview_to_model requires at least 2 input views including front');
      }
    } else if (opts.views && typeof opts.views === 'object') {
      const entries = Object.entries(opts.views).filter(([, val]) => Boolean(val));
      const hasFront = entries.some(([key]) => key.toLowerCase() === 'front');
      if (entries.length < 2 || !hasFront) {
        throw new Error('multiview_to_model requires at least 2 input views including front');
      }
    } else {
      throw new Error('multiview_to_model requires at least 2 input views including front');
    }
  }
  if (Array.isArray(opts.viewAngles)) {
    const angles = opts.viewAngles.map(a => String(a || '').toLowerCase()).filter(Boolean);
    if (angles.length < 2 || !angles.includes('front')) {
      throw new Error('multiview_to_model requires at least 2 input views including front');
    }
  }
  if (Array.isArray(referenceMaterialIds) && referenceMaterialIds.length > 0 && referenceMaterialIds.filter(Boolean).length < 2) {
    throw new Error('multiview_to_model requires at least 2 input views including front');
  }
}

export function validateTripoOpenApiParameters({ action = 'image_to_model', referenceMaterialIds = [], options = {} } = {}) {
  if (!Object.hasOwn(TRIPO_OPENAPI_ENDPOINTS, action)) {
    throw new Error(`Unsupported Tripo OpenAPI v3 action: ${action}`);
  }
  const opts = options && typeof options === 'object' ? options : {};
  if (opts.export_orientation && (opts.postProcess || opts.texture || opts.rig || opts.convert || POST_PROCESS_ACTIONS.has(action))) {
    throw new Error('Do not set export_orientation when post-processing is planned');
  }
  if (opts.generate_parts === true && (opts.texture || opts.pbr || opts.quad || opts.smart_low_poly)) {
    throw new Error('generate_parts=true is mutually exclusive with texture/pbr/quad/smart_low_poly');
  }
  if (action === 'multiview_to_model') {
    validateExplicitMultiviewOptions(opts, referenceMaterialIds);
  }
}

export async function queryTripoOpenApiBalance({ apiKey, baseUrl = DEFAULT_TRIPO_API_URL, fetchImpl = fetch } = {}) {
  const key = requireApiKey(apiKey);
  const url = `${cleanBaseUrl(baseUrl)}/account/balance`;
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || (typeof data?.code === 'number' && data.code !== 0)) {
    throw Object.assign(new Error(data?.message || `Tripo OpenAPI balance query failed (HTTP ${response.status})`), {
      statusCode: response.status || 502,
      code: data?.code,
    });
  }
  return {
    channel: 'openapi_v3',
    separateFromStudioWeb: true,
    balance: data.data ?? data,
    fetchedAt: new Date().toISOString(),
  };
}

export async function queryTripoOpenApiUsage({ apiKey, baseUrl = DEFAULT_TRIPO_API_URL, fetchImpl = fetch } = {}) {
  const key = requireApiKey(apiKey);
  const url = `${cleanBaseUrl(baseUrl)}/account/usage`;
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || (typeof data?.code === 'number' && data.code !== 0)) {
    throw Object.assign(new Error(data?.message || `Tripo OpenAPI usage query failed (HTTP ${response.status})`), {
      statusCode: response.status || 502,
      code: data?.code,
    });
  }
  return {
    channel: 'openapi_v3',
    separateFromStudioWeb: true,
    usage: data.data ?? data,
    fetchedAt: new Date().toISOString(),
  };
}

async function resolveProjectPngInputs({ projectDir, state, action, part, referenceMaterialIds, options }) {
  const opts = options && typeof options === 'object' ? options : {};
  const needsImages = action === 'image_to_model' || action === 'multiview_to_model';
  const refIds = Array.isArray(referenceMaterialIds) ? referenceMaterialIds.filter(Boolean) : [];
  const mode = state.workflow?.mode || 'illustration';
  const resolved = [];

  if (refIds.length > 0) {
    if (refIds.length > 4) throw new Error('Tripo OpenAPI accepts at most 4 view PNG inputs');
    if (new Set(refIds).size !== refIds.length) throw new Error('Each input reference material ID must be distinct');
    for (let i = 0; i < refIds.length; i++) {
      const id = refIds[i];
      const mat = state.materials?.items?.find(m =>
        m.id === id &&
        m.extension === '.png' &&
        (mode !== 'base_mesh' || m.role === `tripo_${part}_reference`)
      );
      if (!mat) throw new Error(`Authorized reference PNG material not found: ${id}`);
      const verified = await verifyAsset(projectDir, mat);
      const angle = Array.isArray(opts.viewAngles) && opts.viewAngles[i]
        ? String(opts.viewAngles[i]).toLowerCase()
        : VIEWS[i] || `view_${i}`;
      resolved.push({
        id: mat.id,
        angle,
        fileName: mat.fileName || `${part}_${angle}.png`,
        sha256: mat.sha256,
        bytes: verified.bytes,
      });
    }
  } else if (needsImages) {
    if (mode === 'base_mesh') {
      throw new Error('Register isolated part reference PNG materials before calling Tripo OpenAPI');
    }
    const readyViews = [];
    for (const angle of VIEWS) {
      const slotId = `${part}_${angle}`;
      const view = state.views?.[slotId];
      const asset = state.assets?.items?.find(a => a.id === view?.assetId && a.kind === 'image' && a.slotId === slotId);
      if (view?.status === 'ready' && asset) {
        const verified = await verifyAsset(projectDir, asset);
        readyViews.push({
          id: asset.id,
          angle,
          fileName: `${slotId}.png`,
          sha256: asset.sha256,
          bytes: verified.bytes,
        });
      }
    }
    if (action === 'multiview_to_model') {
      const hasFront = readyViews.some(v => v.angle === 'front');
      if (readyViews.length < 2 || !hasFront) {
        throw new Error('multiview_to_model requires at least 2 input views including front');
      }
      resolved.push(...readyViews);
    } else if (readyViews.length > 0) {
      const front = readyViews.find(v => v.angle === 'front') || readyViews[0];
      resolved.push(front);
    } else if (state.assets?.selected?.source) {
      const src = state.assets.items.find(a => a.id === state.assets.selected.source && a.kind === 'image');
      if (src) {
        const verified = await verifyAsset(projectDir, src);
        resolved.push({
          id: src.id,
          angle: 'front',
          fileName: 'source.png',
          sha256: src.sha256,
          bytes: verified.bytes,
        });
      }
    }
  }

  if (action === 'multiview_to_model') {
    const hasFront = resolved.some(v => v.angle === 'front');
    if (resolved.length < 2 || !hasFront) {
      throw new Error('multiview_to_model requires at least 2 input views including front');
    }
  } else if (action === 'image_to_model' && resolved.length === 0 && !opts.file_token) {
    throw new Error(`Missing authorized PNG input for ${part}: register views, source illustration, or referenceMaterialIds first`);
  }

  return resolved;
}

async function ensureBudgetLedger(budget, accountId, state, opts) {
  const ledger = budget || createAccountBudget();
  try {
    await ledger.status(accountId);
  } catch (err) {
    if (/Configure account ledger first/i.test(err?.message || '')) {
      const limit = Number.isFinite(Number(opts.budgetLimit))
        ? Number(opts.budgetLimit)
        : Number(state?.tripoQuota?.monthlyAllowance ?? 1000);
      await ledger.configure({
        accountId,
        channel: 'tripo_api',
        period: new Date().toISOString().slice(0, 7),
        limit,
        unit: 'credits',
      });
    } else {
      throw err;
    }
  }
  return ledger;
}

function cleanApiOptions(opts) {
  const copy = { ...opts };
  for (const internalKey of ['quotedCost', 'quoteExpiresAt', 'budgetLimit', 'postProcess', 'views', 'viewAngles']) {
    delete copy[internalKey];
  }
  return copy;
}

async function atomicWriteBytes(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${crypto.randomUUID()}`;
  try {
    await fs.writeFile(tmp, bytes, { flag: 'wx' });
    await fs.rename(tmp, file);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

export async function submitTripoOpenApiTask({
  projectDir,
  action = 'image_to_model',
  part = 'head',
  referenceMaterialIds = [],
  options = {},
  requestId,
  expectedRevision,
  allowCloudExecution = false,
  cloudConfirmed = false,
  apiKey,
  baseUrl = DEFAULT_TRIPO_API_URL,
  budget,
  accountId = 'default-tripo-api',
  fetchImpl = fetch,
} = {}) {
  const opts = options && typeof options === 'object' ? options : {};

  // 1. Parameter trap protections (Section 6.1.3)
  validateTripoOpenApiParameters({ action, referenceMaterialIds, options: opts });

  // 2. Cloud execution & confirmation gates (Section 6.1.4)
  if (allowCloudExecution !== true) {
    throw new Error('CLOUD_EXECUTION_DISABLED: enable allowCloudExecution before calling Tripo OpenAPI v3');
  }
  if (cloudConfirmed !== true) {
    throw new Error('CLOUD_CONFIRMATION_REQUIRED: explicit user confirmation is required before calling Tripo OpenAPI v3');
  }
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) {
    throw new Error('Valid requestId (8-100 alphanumeric/dash/underscore characters) is required');
  }
  if (!Number.isSafeInteger(expectedRevision)) {
    throw new Error('expectedRevision must be a safe integer');
  }
  const key = requireApiKey(apiKey);
  if (!['head', 'body', 'clothing', 'hair', 'accessory'].includes(part)) {
    throw new Error(`Invalid Tripo part: ${part}`);
  }

  // 3. Load and verify project state revision
  const loaded = await loadProjectState(projectDir);
  if (!loaded.exists) {
    throw new Error('Initialize project before submitting Tripo OpenAPI tasks');
  }
  if (loaded.state.stateRevision !== expectedRevision) {
    throw Object.assign(new Error('Project revision changed; reload before submitting Tripo OpenAPI task'), { statusCode: 409 });
  }

  // 4. Resolve authorized local PNG inputs before reserving budget
  const resolvedInputs = await resolveProjectPngInputs({
    projectDir: loaded.projectDir,
    state: loaded.state,
    action,
    part,
    referenceMaterialIds,
    options: opts,
  });

  const quotedCost = Number(opts.quotedCost ?? 25);
  if (!Number.isFinite(quotedCost) || quotedCost < 0) {
    throw new Error('quotedCost must be a finite non-negative number');
  }
  const quoteExpiresAt = opts.quoteExpiresAt || new Date(Date.now() + 300000).toISOString();
  const apiOptions = cleanApiOptions(opts);
  const fingerprint = sha256(JSON.stringify({
    action,
    part,
    inputs: resolvedInputs.map(v => ({ angle: v.angle, sha256: v.sha256 })),
    options: apiOptions,
  }));

  // 5. Idempotency check against existing project OpenAPI task receipts (never auto-retry!)
  const existingTask = (loaded.state.tripoQuota?.openapiTasks || []).find(t => t.requestId === requestId);
  if (existingTask) {
    if (existingTask.fingerprint && existingTask.fingerprint !== fingerprint) {
      throw new Error('Idempotency identity conflicts with a different request');
    }
    if (existingTask.status === 'uncertain') {
      throw Object.assign(
        new Error('Tripo OpenAPI request is in uncertain billing state; reconcile before retrying and never auto-retry with a new ID'),
        { status: 'uncertain', requestId }
      );
    }
    if (['submitted', 'queued', 'running'].includes(existingTask.status)) {
      return { verdict: 'degraded', pending: true, duplicate: true, channel: 'openapi_v3', taskId: existingTask.taskId, requestId };
    }
    if (existingTask.status === 'success') {
      return { verdict: 'pass', pending: false, duplicate: true, channel: 'openapi_v3', taskId: existingTask.taskId, requestId, candidateId: existingTask.candidateId || null };
    }
  }

  // 6. Reserve budget in cross-project account ledger
  const ledger = await ensureBudgetLedger(budget, accountId, loaded.state, opts);
  const reservation = await ledger.reserve({
    accountId,
    requestId,
    fingerprint,
    quotedCost,
    quoteExpiresAt,
    projectId: loaded.state.projectId,
  });
  if (reservation.duplicate) {
    if (reservation.entry?.state === 'uncertain') {
      throw Object.assign(
        new Error('Tripo OpenAPI request is in uncertain billing state; reconcile before retrying and never auto-retry with a new ID'),
        { status: 'uncertain', requestId }
      );
    }
    if (reservation.entry?.state === 'submitted' && reservation.entry?.providerTaskId) {
      return { verdict: 'degraded', pending: true, duplicate: true, channel: 'openapi_v3', taskId: reservation.entry.providerTaskId, requestId };
    }
  }

  const base = cleanBaseUrl(baseUrl);
  const endpoint = TRIPO_OPENAPI_ENDPOINTS[action];

  async function markCancelledNotCharged() {
    await ledger.transition({ accountId, requestId, action: 'cancel', confirmedNotCharged: true });
  }

  async function markUncertain(errorMessage) {
    try {
      await ledger.transition({ accountId, requestId, action: 'submit' });
    } catch { /* already submitted */ }
    await ledger.transition({ accountId, requestId, action: 'uncertain' });
    const now = new Date().toISOString();
    const record = {
      taskId: null,
      requestId,
      action,
      part,
      status: 'uncertain',
      progress: 0,
      quotedCost,
      fingerprint,
      channel: 'openapi_v3',
      error: String(errorMessage || 'Uncertain network/timeout failure'),
      createdAt: now,
      updatedAt: now,
    };
    await updateProjectState(loaded.projectDir, next => {
      next.tripoQuota ||= {};
      next.tripoQuota.openapiTasks ||= [];
      const idx = next.tripoQuota.openapiTasks.findIndex(t => t.requestId === requestId);
      if (idx >= 0) next.tripoQuota.openapiTasks[idx] = record;
      else next.tripoQuota.openapiTasks.push(record);
      next.auditLog.push({ at: now, event: 'tripo.openapi.uncertain', detail: `${action} / ${part} / ${requestId}` });
    });
  }

  // 7. Upload PNG inputs via POST /v3/files
  const uploadedTokens = [];
  for (const input of resolvedInputs) {
    const form = new FormData();
    form.append('file', new Blob([input.bytes], { type: 'image/png' }), input.fileName);
    let uploadRes;
    try {
      uploadRes = await fetchImpl(`${base}/files`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      });
    } catch (networkErr) {
      await markUncertain(networkErr.message);
      throw Object.assign(new Error(`Tripo OpenAPI dispatch uncertain: ${networkErr.message}`), {
        status: 'uncertain',
        requestId,
        cause: networkErr,
      });
    }
    const uploadJson = await uploadRes.json().catch(() => ({}));
    if ([400, 401, 403, 404, 422].includes(uploadRes.status) || (typeof uploadJson?.code === 'number' && uploadJson.code !== 0)) {
      await markCancelledNotCharged();
      throw Object.assign(new Error(uploadJson?.message || `Tripo file upload rejected (HTTP ${uploadRes.status})`), {
        statusCode: uploadRes.status || 400,
        code: uploadJson?.code,
      });
    }
    if (!uploadRes.ok) {
      await markUncertain(uploadJson?.message || `Tripo file upload failed (HTTP ${uploadRes.status})`);
      throw Object.assign(new Error(uploadJson?.message || `Tripo file upload failed (HTTP ${uploadRes.status})`), {
        status: 'uncertain',
        statusCode: uploadRes.status,
        requestId,
      });
    }
    const token = uploadJson?.data?.file_token || uploadJson?.data?.image_token || uploadJson?.file_token || uploadJson?.image_token;
    if (!token) {
      await markCancelledNotCharged();
      throw new Error('Tripo file upload response did not include a file_token');
    }
    uploadedTokens.push({ angle: input.angle, file_token: token });
  }

  // 8. Dispatch task creation endpoint
  const payload = { ...apiOptions };
  if (action === 'image_to_model') {
    payload.model ||= 'v3.1-20260211';
    if (uploadedTokens[0]) {
      payload.file = { type: 'png', file_token: uploadedTokens[0].file_token };
      payload.file_token = uploadedTokens[0].file_token;
    }
  } else if (action === 'multiview_to_model') {
    payload.model ||= 'v3.1-20260211';
    payload.files = uploadedTokens.map(t => ({ type: 'png', file_token: t.file_token, view: t.angle }));
  } else if (uploadedTokens[0]) {
    payload.ref_image = { type: 'png', file_token: uploadedTokens[0].file_token };
  }

  let taskRes;
  try {
    taskRes = await fetchImpl(`${base}${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Request-Id': requestId,
      },
      body: JSON.stringify(payload),
    });
  } catch (networkErr) {
    await markUncertain(networkErr.message);
    throw Object.assign(new Error(`Tripo OpenAPI task dispatch uncertain: ${networkErr.message}`), {
      status: 'uncertain',
      requestId,
      cause: networkErr,
    });
  }

  const taskJson = await taskRes.json().catch(() => ({}));
  if ([400, 401, 403, 404, 422].includes(taskRes.status) || (typeof taskJson?.code === 'number' && taskJson.code !== 0)) {
    await markCancelledNotCharged();
    throw Object.assign(new Error(taskJson?.message || `Tripo OpenAPI task rejected (HTTP ${taskRes.status})`), {
      statusCode: taskRes.status || 400,
      code: taskJson?.code,
    });
  }
  if (!taskRes.ok) {
    await markUncertain(taskJson?.message || `Tripo OpenAPI task failed with uncertain state (HTTP ${taskRes.status})`);
    throw Object.assign(new Error(taskJson?.message || `Tripo OpenAPI task failed (HTTP ${taskRes.status})`), {
      status: 'uncertain',
      statusCode: taskRes.status,
      requestId,
    });
  }

  const taskId = taskJson?.data?.task_id || taskJson?.task_id || taskJson?.data?.taskId || taskJson?.taskId;
  if (!taskId || typeof taskId !== 'string') {
    await markUncertain('Tripo OpenAPI response omitted task_id');
    throw Object.assign(new Error('Tripo OpenAPI response omitted task_id; billing state uncertain'), {
      status: 'uncertain',
      requestId,
    });
  }

  // 9. Transition budget to submitted and persist task record
  await ledger.transition({ accountId, requestId, action: 'submit', providerTaskId: taskId });
  const now = new Date().toISOString();
  const taskRecord = {
    taskId,
    requestId,
    action,
    part,
    status: 'submitted',
    progress: 0,
    quotedCost,
    fingerprint,
    channel: 'openapi_v3',
    createdAt: now,
    updatedAt: now,
  };
  await updateProjectState(loaded.projectDir, next => {
    next.tripoQuota ||= {};
    next.tripoQuota.openapiTasks ||= [];
    const idx = next.tripoQuota.openapiTasks.findIndex(t => t.requestId === requestId);
    if (idx >= 0) next.tripoQuota.openapiTasks[idx] = taskRecord;
    else next.tripoQuota.openapiTasks.push(taskRecord);
    next.auditLog.push({ at: now, event: 'tripo.openapi.submitted', detail: `${action} / ${part} / ${taskId}` });
  });

  return { verdict: 'degraded', pending: true, channel: 'openapi_v3', taskId, requestId };
}

function extractModelUrl(taskData) {
  const out = taskData?.output || taskData?.result || {};
  for (const key of ['model', 'pbr_model', 'base_model', 'model_url']) {
    const val = out[key];
    if (typeof val === 'string' && val.trim()) return val.trim();
    if (val && typeof val.url === 'string' && val.url.trim()) return val.url.trim();
  }
  return null;
}

function detectDownloadedExtension(bytes, modelUrl) {
  if (bytes.length >= 21 && bytes.subarray(0, 20).toString('ascii') === 'Kaydara FBX Binary  ' && bytes[20] === 0x00) {
    return '.fbx';
  }
  const head = bytes.subarray(0, Math.min(bytes.length, 256)).toString('utf8');
  if (/^;\s*FBX\s+\d+\.\d+\.\d+/im.test(head)) return '.fbx';
  try {
    const pathname = new URL(modelUrl).pathname.toLowerCase();
    if (pathname.endsWith('.fbx')) return '.fbx';
  } catch { /* ignore */ }
  return '.glb';
}

export async function pollTripoOpenApiTask({
  projectDir,
  taskId,
  requestId,
  apiKey,
  baseUrl = DEFAULT_TRIPO_API_URL,
  budget,
  accountId = 'default-tripo-api',
  fetchImpl = fetch,
} = {}) {
  if (typeof taskId !== 'string' || !taskId.trim()) {
    throw new Error('taskId is required to poll Tripo OpenAPI v3');
  }
  const key = requireApiKey(apiKey);
  const cleanTaskId = taskId.trim();
  const base = cleanBaseUrl(baseUrl);

  const loaded = projectDir ? await loadProjectState(projectDir) : { exists: false, state: null, projectDir: null };
  const savedTask = (loaded.state?.tripoQuota?.openapiTasks || []).find(
    t => t.taskId === cleanTaskId || (requestId && t.requestId === requestId)
  );
  const effectiveRequestId = requestId || savedTask?.requestId || null;
  const part = savedTask?.part || 'head';
  const quotedCost = Number(savedTask?.quotedCost ?? 25);

  const res = await fetchImpl(`${base}/tasks/${encodeURIComponent(cleanTaskId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  const raw = await res.json().catch(() => ({}));
  if (!res.ok || (typeof raw?.code === 'number' && raw.code !== 0)) {
    throw Object.assign(new Error(raw?.message || `Tripo OpenAPI task poll failed (HTTP ${res.status})`), {
      statusCode: res.status || 502,
      code: raw?.code,
    });
  }

  const taskData = raw?.data ?? raw;
  const status = String(taskData?.status || '').toLowerCase();
  const progress = Number.isFinite(Number(taskData?.progress))
    ? Math.max(0, Math.min(100, Number(taskData.progress)))
    : 0;

  if (status === 'queued' || status === 'running') {
    if (loaded.exists) {
      await updateProjectState(loaded.projectDir, next => {
        next.tripoQuota ||= {};
        next.tripoQuota.openapiTasks ||= [];
        const target = next.tripoQuota.openapiTasks.find(t => t.taskId === cleanTaskId || (effectiveRequestId && t.requestId === effectiveRequestId));
        if (target) {
          target.status = status;
          target.progress = progress;
          target.updatedAt = new Date().toISOString();
        }
      });
    }
    return { verdict: 'degraded', pending: true, channel: 'openapi_v3', taskId: cleanTaskId, status, progress };
  }

  if (['failed', 'cancelled', 'banned', 'expired'].includes(status)) {
    if (effectiveRequestId) {
      const ledger = budget || createAccountBudget();
      try {
        await ledger.transition({ accountId, requestId: effectiveRequestId, action: 'cancel', confirmedNotCharged: true });
      } catch (err) {
        if (!/Configure account ledger first|Unknown account operation/i.test(err?.message || '')) throw err;
      }
    }
    const errMsg = taskData?.error_message || taskData?.message || `Tripo OpenAPI task ${status}`;
    if (loaded.exists) {
      await updateProjectState(loaded.projectDir, next => {
        next.tripoQuota ||= {};
        next.tripoQuota.openapiTasks ||= [];
        const target = next.tripoQuota.openapiTasks.find(t => t.taskId === cleanTaskId || (effectiveRequestId && t.requestId === effectiveRequestId));
        if (target) {
          target.status = status;
          target.progress = progress;
          target.error = errMsg;
          target.updatedAt = new Date().toISOString();
        }
        next.auditLog.push({ at: new Date().toISOString(), event: `tripo.openapi.${status}`, detail: `${cleanTaskId}: ${errMsg}` });
      });
    }
    return { verdict: 'fail', pending: false, channel: 'openapi_v3', taskId: cleanTaskId, status, progress, error: errMsg };
  }

  if (status !== 'success') {
    return { verdict: 'degraded', pending: true, channel: 'openapi_v3', taskId: cleanTaskId, status: status || 'unknown', progress };
  }

  // 5-minute URL rule: download immediately without sending Authorization header to signed URL
  const modelUrl = extractModelUrl(taskData);
  if (!modelUrl) {
    throw new Error('Tripo OpenAPI task succeeded without a downloadable model URL in output');
  }
  const downloadRes = await fetchImpl(modelUrl, { method: 'GET' });
  if (!downloadRes.ok) {
    throw Object.assign(new Error(`Failed to download Tripo OpenAPI model output (HTTP ${downloadRes.status})`), {
      statusCode: downloadRes.status || 502,
    });
  }
  const bytes = Buffer.from(await downloadRes.arrayBuffer());
  if (!bytes.length || bytes.length > 128 * 1024 * 1024) {
    throw new Error('Downloaded Tripo OpenAPI model is empty or exceeds 128 MiB');
  }
  const ext = detectDownloadedExtension(bytes, modelUrl);
  if (ext === '.fbx') validateFbx(bytes);

  if (!loaded.exists) {
    throw new Error('Initialize project before archiving Tripo OpenAPI output');
  }

  const root = await ensureProjectLayout(loaded.projectDir);
  const digest = sha256(bytes);
  const archivePath = path.join(root, 'tripo', 'archive', `${part}_${digest}${ext}`);
  await atomicWriteBytes(archivePath, bytes);
  await scopedFile(root, path.relative(root, archivePath));

  const currentLoaded = await loadProjectState(root);
  const mode = currentLoaded.state.workflow?.mode || 'illustration';
  let imported;
  let candidate;
  if (mode === 'illustration' && ext === '.glb') {
    imported = await importStudioAsset({
      projectDir: root,
      kind: 'glb',
      part: ['head', 'body', 'clothing', 'hair', 'accessory'].includes(part) ? part : 'head',
      sourcePath: archivePath,
      label: `Tripo OpenAPI · ${part} (${cleanTaskId})`,
    });
    candidate = {
      id: imported.asset.id,
      kind: 'asset',
      part,
      fileName: path.basename(archivePath),
      filePath: imported.asset.filePath,
      sha256: imported.asset.sha256,
      bytes: imported.asset.bytes,
      channel: 'openapi_v3',
      remoteTaskId: cleanTaskId,
    };
  } else if (mode === 'illustration' && ext === '.fbx') {
    imported = await importProjectMaterial({
      projectDir: root,
      stageId: '3_tripo',
      role: 'part_candidate',
      part: ['head', 'body', 'clothing', 'hair', 'accessory'].includes(part) ? part : 'head',
      sourcePath: archivePath,
      expectedRevision: currentLoaded.state.stateRevision,
    });
    candidate = {
      id: imported.material.id,
      kind: 'material',
      part,
      role: 'part_candidate',
      fileName: imported.material.fileName,
      filePath: imported.material.filePath,
      sha256: imported.material.sha256,
      bytes: imported.material.bytes,
      channel: 'openapi_v3',
      remoteTaskId: cleanTaskId,
    };
  } else {
    const rolePart = ['clothing', 'hair', 'accessory'].includes(part) ? part : 'accessory';
    imported = await importProjectMaterial({
      projectDir: root,
      stageId: '4_assembly',
      role: `tripo_${rolePart}`,
      sourcePath: archivePath,
      expectedRevision: currentLoaded.state.stateRevision,
    });
    candidate = {
      id: imported.material.id,
      kind: 'material',
      part: rolePart,
      role: `tripo_${rolePart}`,
      fileName: imported.material.fileName,
      filePath: imported.material.filePath,
      sha256: imported.material.sha256,
      bytes: imported.material.bytes,
      channel: 'openapi_v3',
      remoteTaskId: cleanTaskId,
    };
  }

  const actualCost = Number.isFinite(Number(taskData?.credits_consumed))
    ? Number(taskData.credits_consumed)
    : quotedCost;

  const now = new Date().toISOString();
  await updateProjectState(root, next => {
    next.tripoQuota ||= {};
    next.tripoQuota.openapiTasks ||= [];
    if (candidate.kind === 'asset') {
      const assetItem = next.assets?.items?.find(a => a.id === candidate.id);
      if (assetItem) {
        assetItem.channel = 'openapi_v3';
        assetItem.remoteTaskId = cleanTaskId;
      }
    } else {
      const matItem = next.materials?.items?.find(m => m.id === candidate.id);
      if (matItem) {
        matItem.channel = 'openapi_v3';
        matItem.remoteTaskId = cleanTaskId;
      }
    }
    const existing = next.tripoQuota.openapiTasks.find(
      t => t.taskId === cleanTaskId || (effectiveRequestId && t.requestId === effectiveRequestId)
    );
    const updatedRecord = {
      ...(existing || {}),
      taskId: cleanTaskId,
      requestId: effectiveRequestId,
      action: existing?.action || taskData?.type || 'image_to_model',
      part,
      status: 'success',
      progress: 100,
      quotedCost,
      actualCost,
      candidateId: candidate.id,
      sha256: candidate.sha256,
      archivePath,
      channel: 'openapi_v3',
      remoteTaskId: cleanTaskId,
      completedAt: now,
      updatedAt: now,
    };
    if (existing) Object.assign(existing, updatedRecord);
    else next.tripoQuota.openapiTasks.push(updatedRecord);
    next.auditLog.push({ at: now, event: 'tripo.openapi.collected', detail: `${cleanTaskId} / ${part} / ${candidate.id}` });
  });

  if (effectiveRequestId) {
    const ledger = budget || createAccountBudget();
    try {
      await ledger.transition({ accountId, requestId: effectiveRequestId, action: 'settle', actualCost, providerTaskId: cleanTaskId });
    } catch (err) {
      if (/Cannot settle an unsubmitted request/i.test(err?.message || '')) {
        await ledger.transition({ accountId, requestId: effectiveRequestId, action: 'submit', providerTaskId: cleanTaskId });
        await ledger.transition({ accountId, requestId: effectiveRequestId, action: 'settle', actualCost, providerTaskId: cleanTaskId });
      } else if (!/Configure account ledger first|Unknown account operation/i.test(err?.message || '')) {
        throw err;
      }
    }
  }

  return {
    verdict: 'pass',
    pending: false,
    taskId: cleanTaskId,
    candidate,
    channel: 'openapi_v3',
    remoteTaskId: cleanTaskId,
    actualCost,
  };
}
