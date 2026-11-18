/**
 * dsh-charakuru-studio — Clean-Room Project State & Human-in-the-Loop Checkpoint Engine.
 * Persists atomic state in `<projectDir>/project.charastudio.json` with zero proprietary dependencies.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { invalidateFrom, collectReviewEvidence, verifyPreviousReviews } from './reviews.js';
import {
  PIPELINE_STAGES,
  PROJECT_FILENAME,
  LEGACY_CHARAKIT_FILENAME,
  REQUIRED_VIEW_SLOTS,
  TRIPO_FREE_TIER_DEFAULTS,
} from '../constants.js';

export const PROJECT_SUBDIRS = Object.freeze([
  'refs',
  'assets/image',
  'assets/glb',
  'views/head',
  'views/body',
  'views/balance',
  'views/workflows',
  'tripo/head',
  'tripo/body',
  'tripo/archive',
  'blender/scripts',
  'blender/checkpoints',
  'blender/renders',
  'exports',
]);

function currentYearMonth() {
  return new Date().toISOString().slice(0, 7);
}

export function createInitialProjectState({
  projectName = 'MyVrmAvatar',
  characterPrompt = '',
  sourceImage = '',
  headBodyRatio = 6.3,
  neckScaleFactor = 0.86,
  preferredImageModel = 'qwen-image-2.1-local',
  tripoStrategy = 'studio_free_saver',
  monthlyCreditAllowance = TRIPO_FREE_TIER_DEFAULTS.monthlyCreditAllowance,
} = {}) {
  if (!Number.isFinite(monthlyCreditAllowance) || monthlyCreditAllowance < 0) throw new Error('Monthly allowance must be finite and non-negative');
  if (!Number.isFinite(headBodyRatio) || headBodyRatio <= 0 || !Number.isFinite(neckScaleFactor) || neckScaleFactor <= 0) throw new Error('Head/body ratio and scale must be positive finite numbers');
  const now = new Date().toISOString();
  const stages = {};
  for (const st of PIPELINE_STAGES) {
    stages[st.id] = {
      id: st.id,
      index: st.index,
      titleZh: st.titleZh,
      titleEn: st.titleEn,
      status: st.index === 1 ? 'in_progress' : 'pending',
      checkpointRequired: st.checkpointRequired,
      checkpointState: st.checkpointRequired ? 'locked' : 'not_required',
      approvedAt: null,
      notes: '',
    };
  }

  const views = {};
  for (const slot of REQUIRED_VIEW_SLOTS) {
    views[slot.id] = {
      slotId: slot.id,
      group: slot.group,
      angle: slot.angle,
      labelZh: slot.labelZh,
      status: 'missing',
      filePath: null,
      modelUsed: null,
      updatedAt: null,
    };
  }

  return {
    schemaVersion: '1.0.0',
    assets: { items: [], selected: {} },
    engine: 'dsh-charakuru-studio',
    licenseMode: 'clean-room-mit',
    projectId: `chr_${crypto.randomBytes(6).toString('hex')}`,
    projectName: String(projectName || 'MyVrmAvatar'),
    createdAt: now,
    updatedAt: now,
    activeStageId: '1_concept',
    characterSpec: {
      characterPrompt: String(characterPrompt || ''),
      sourceImages: sourceImage ? [String(sourceImage)] : [],
      targetHeadBodyRatio: Number(headBodyRatio) || 6.3,
      neckScaleFactor: Number(neckScaleFactor) || 0.86,
      preferredImageModel: String(preferredImageModel || 'qwen-image-2.1-local'),
      hasSkirt: true,
      hasLongHair: true,
      closedMeshExpressions: true,
    },
    tripoQuota: {
      plan: 'studio_free',
      strategy: tripoStrategy,
      billingMonth: currentYearMonth(),
      monthlyAllowance: monthlyCreditAllowance,
      creditsUsed: 0,
      freeRetriesUsed: 0,
      maxConcurrency: 1,
      historyRetentionHours: 24,
      tasks: [],
      selectedCandidates: {
        headGlb: null,
        bodyGlb: null,
      },
    },
    views,
    blenderState: {
      lastBackendUrl: 'http://127.0.0.1:9877',
      vrmAddonVerified: false,
      activeBlendFile: null,
      generatedScripts: [],
      lastQcReport: null,
    },
    vrmMetadata: {
      title: String(projectName || 'MyVrmAvatar'),
      version: '1.0.0',
      authors: [],
      avatarPermission: 'onlyAuthor',
      commercialUsage: 'personalNonProfit',
      creditNotation: 'required',
      allowRedistribution: false,
      exportedVrmPath: null,
      exportedExpressiveVrmPath: null,
    },
    stages,
    auditLog: [
      {
        at: now,
        event: 'project.initialized',
        detail: `Initialized Clean-Room VRM Studio project "${projectName}" (${tripoStrategy}, ${monthlyCreditAllowance} monthly free credits).`,
      },
    ],
  };
}

export async function ensureProjectLayout(projectDir) {
  const absRoot = path.resolve(projectDir);
  await fs.mkdir(absRoot, { recursive: true });
  for (const rel of PROJECT_SUBDIRS) {
    await fs.mkdir(path.join(absRoot, rel), { recursive: true });
  }
  return absRoot;
}

export function resolveProjectFilePath(projectDir) {
  return path.join(path.resolve(projectDir), PROJECT_FILENAME);
}

const projectLocks = new Map();
export async function withProjectLock(projectDir, work) {
  const resolved = path.resolve(projectDir);
  const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  const previous = projectLocks.get(key) || Promise.resolve();
  const next = previous.then(work, work);
  const tail = next.catch(() => {});
  projectLocks.set(key, tail);
  try { return await next; }
  finally { if (projectLocks.get(key) === tail) projectLocks.delete(key); }
}

function validateProjectState(state) {
  if (!state || state.engine !== 'dsh-charakuru-studio' || state.schemaVersion !== '1.0.0') throw new Error('Unsupported project state schema');
  if (!state.characterSpec || !state.blenderState || !state.vrmMetadata || !state.views || !Array.isArray(state.auditLog)) throw new Error('Incomplete project state');
  if (!state.stages || PIPELINE_STAGES.some((definition) => !state.stages[definition.id])) throw new Error('Incomplete pipeline stages');
  if (!state.stages[state.activeStageId]) throw new Error('Unknown active stage');
  const quota = state.tripoQuota;
  if (!quota || !Array.isArray(quota.tasks) || !quota.selectedCandidates || !Number.isFinite(quota.monthlyAllowance) || quota.monthlyAllowance < 0 || !Number.isFinite(quota.creditsUsed) || quota.creditsUsed < 0) throw new Error('Invalid project quota ledger');
  return state;
}

async function writeStateAtomic(projectDir, state) {
  validateProjectState(state);
  const absRoot = await ensureProjectLayout(projectDir);
  const targetFile = path.join(absRoot, PROJECT_FILENAME);
  const tempFile = `${targetFile}.tmp-${crypto.randomUUID()}`;
  const next = { ...state, stateRevision: (state.stateRevision || 0) + 1, updatedAt: new Date().toISOString() };
  try {
    await fs.writeFile(tempFile, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(tempFile, targetFile);
  } finally { await fs.rm(tempFile, { force: true }); }
  return { projectDir: absRoot, stateFile: targetFile, state: next };
}

export async function saveProjectState(projectDir, state) {
  return withProjectLock(projectDir, async () => {
    const loaded = await loadProjectState(projectDir);
    if (loaded.exists && (loaded.state.stateRevision || 0) !== (state.stateRevision || 0)) throw new Error('Project changed concurrently; reload before saving');
    return writeStateAtomic(projectDir, state);
  });
}

export async function updateProjectState(projectDir, mutate) {
  return withProjectLock(projectDir, async () => {
    const loaded = await loadProjectState(projectDir);
    if (!loaded.exists) throw new Error(`Project not initialized at ${projectDir}`);
    const state = structuredClone(loaded.state);
    await mutate(state);
    return writeStateAtomic(projectDir, state);
  });
}

export async function loadProjectState(projectDir) {
  const absRoot = path.resolve(projectDir);
  const targetFile = path.join(absRoot, PROJECT_FILENAME);
  try {
    const raw = await fs.readFile(targetFile, 'utf8');
    const parsed = validateProjectState(JSON.parse(raw));
    if (!parsed.assets) {
      parsed.assets = { items: [], selected: {} };
      if (Object.values(parsed.stages).some(s => s.status === 'completed' || s.status === 'awaiting_review')) invalidateFrom(parsed, '1_concept', '0.1 工程审批没有资产证据，已保留文件并要求重新审批。');
    }
    return { exists: true, projectDir: absRoot, stateFile: targetFile, state: parsed };
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err;
  }

  // Non-destructive metadata import if user points at an existing `.charakit` folder
  const legacyFile = path.join(absRoot, LEGACY_CHARAKIT_FILENAME);
  try {
    const legacyRaw = await fs.readFile(legacyFile, 'utf8');
    const legacyJson = JSON.parse(legacyRaw);
    const imported = createInitialProjectState({
      projectName: legacyJson?.name || legacyJson?.title || path.basename(absRoot),
      characterPrompt: legacyJson?.description || '',
    });
    imported.auditLog.push({
      at: new Date().toISOString(),
      event: 'legacy.metadata.detected',
      detail: 'Detected legacy project.charakit in directory; initialized non-destructive Clean-Room sidecar project.charastudio.json without modifying original file.',
    });
    return {
      exists: false,
      legacyDetected: true,
      projectDir: absRoot,
      stateFile: targetFile,
      state: imported,
    };
  } catch {
    return {
      exists: false,
      legacyDetected: false,
      projectDir: absRoot,
      stateFile: targetFile,
      state: null,
    };
  }
}

export async function initOrUpdateProject(projectDir, options = {}) {
  return withProjectLock(projectDir, async () => {
  for (const key of ['headBodyRatio', 'neckScaleFactor']) if (options[key] !== undefined && (!Number.isFinite(options[key]) || options[key] <= 0)) throw new Error(`${key} must be positive and finite`);
  if (options.monthlyCreditAllowance !== undefined && (!Number.isFinite(options.monthlyCreditAllowance) || options.monthlyCreditAllowance < 0)) throw new Error('Invalid monthly allowance');
  const loaded = await loadProjectState(projectDir);
  if (!loaded.exists || !loaded.state) {
    const fresh = createInitialProjectState({
      projectName: options.projectName || path.basename(path.resolve(projectDir)),
      ...options,
    });
    return writeStateAtomic(projectDir, fresh);
  }

  const state = structuredClone(loaded.state);
  const priorSpec = JSON.stringify(state.characterSpec);
  if (options.projectName) state.projectName = String(options.projectName);
  if (options.characterPrompt !== undefined) state.characterSpec.characterPrompt = String(options.characterPrompt);
  if (options.sourceImage !== undefined) {
    const nextSource = options.sourceImage ? String(options.sourceImage) : '';
    const selected = state.assets?.items?.find(asset => asset.id === state.assets.selected?.source);
    if (selected && selected.filePath !== nextSource) delete state.assets.selected.source;
    state.characterSpec.sourceImages = nextSource ? [nextSource] : [];
  }
  if (typeof options.headBodyRatio === 'number' && Number.isFinite(options.headBodyRatio)) {
    state.characterSpec.targetHeadBodyRatio = options.headBodyRatio;
  }
  if (typeof options.neckScaleFactor === 'number' && Number.isFinite(options.neckScaleFactor)) {
    state.characterSpec.neckScaleFactor = options.neckScaleFactor;
  }
  if (options.preferredImageModel) {
    state.characterSpec.preferredImageModel = String(options.preferredImageModel);
  }
  if (options.monthlyCreditAllowance !== undefined) state.tripoQuota.monthlyAllowance = options.monthlyCreditAllowance;
  if (options.tripoStrategy) {
    state.tripoQuota.strategy = String(options.tripoStrategy);
  }
  if (JSON.stringify(state.characterSpec) !== priorSpec) {
    invalidateFrom(state, '1_concept', '角色设定或原画已变更，须重新确认。');
    for (const view of Object.values(state.views)) view.status = 'stale';
  }
  return writeStateAtomic(projectDir, state);
  });
}

/**
 * Request or approve a stage checkpoint in the 6-stage human-in-the-loop pipeline.
 */
export async function transitionStageCheckpoint(projectDir, {
  stageId,
  action = 'request_review', // 'request_review' | 'approve' | 'reject' | 'activate'
  notes = '',
  actor = 'agent',
  expectedRevision,
} = {}) {
  return updateProjectState(projectDir, async (state) => {
  if (expectedRevision !== undefined && expectedRevision !== (state.stateRevision || 0)) throw new Error('Project changed concurrently; reload before reviewing');
  const targetId = stageId || state.activeStageId;
  const stage = state.stages[targetId];
  if (!stage) {
    throw new Error(`Unknown stage "${targetId}". Valid stages: ${PIPELINE_STAGES.map((s) => s.id).join(', ')}`);
  }

  if (targetId !== state.activeStageId) throw new Error('Only the active stage can transition');
  if (stage.status === 'completed') throw new Error('Stage already completed');
  const prior = PIPELINE_STAGES.filter((item) => item.index < stage.index);
  if (prior.some((item) => state.stages[item.id].status !== 'completed')) throw new Error('Previous checkpoints are incomplete');
  if (action === 'approve' && (actor !== 'user' || stage.status !== 'awaiting_review')) throw new Error('Approval requires user review of an awaiting_review stage');
  if (action === 'reject' && (actor !== 'user' || stage.status !== 'awaiting_review')) throw new Error('Only an awaiting_review stage can be rejected');
  const now = new Date().toISOString();
  if (action === 'activate') {
    state.activeStageId = targetId;
    stage.status = 'in_progress';
  } else if (action === 'request_review') {
    await verifyPreviousReviews(projectDir, state, targetId);
    stage.reviewEvidence = await collectReviewEvidence(projectDir, state, targetId);
    state.activeStageId = targetId;
    stage.status = 'awaiting_review';
    stage.checkpointState = 'pending_user';
    if (notes) stage.notes = String(notes);
  } else if (action === 'approve') {
    await verifyPreviousReviews(projectDir, state, targetId);
    const current = await collectReviewEvidence(projectDir, state, targetId);
    if (!stage.reviewEvidence || current.fingerprint !== stage.reviewEvidence.fingerprint) throw new Error('Review evidence changed; request a fresh review');
    stage.approvedEvidence = current;
    stage.status = 'completed';
    stage.checkpointState = 'approved';
    stage.approvedAt = now;
    if (notes) stage.notes = String(notes);
    const currentIdx = PIPELINE_STAGES.findIndex((s) => s.id === targetId);
    const nextDef = currentIdx >= 0 ? PIPELINE_STAGES[currentIdx + 1] : null;
    if (nextDef && state.stages[nextDef.id]) {
      state.activeStageId = nextDef.id;
      if (state.stages[nextDef.id].status === 'pending') {
        state.stages[nextDef.id].status = 'in_progress';
      }
    }
  } else if (action === 'reject') {
    stage.status = 'in_progress';
    stage.checkpointState = 'changes_requested';
    if (notes) stage.notes = String(notes);
  } else {
    throw new Error(`Unsupported checkpoint action "${action}"`);
  }

  state.auditLog.push({
    at: now,
    event: `stage.${action}`,
    stageId: targetId,
    detail: notes || `${action} on ${targetId}`,
  });
  if (state.auditLog.length > 120) {
    state.auditLog = state.auditLog.slice(-120);
  }

  });
}

export function summarizeProjectProgress(state) {
  if (!state) return null;
  const viewList = Object.values(state.views || {});
  const readyViews = viewList.filter((v) => v.status === 'ready').length;
  const totalViews = viewList.length || 11;
  const completedStages = Object.values(state.stages || {}).filter((s) => s.status === 'completed').length;
  const remainingCredits = Math.max(
    0,
    Number(state.tripoQuota?.monthlyAllowance ?? 200) - Number(state.tripoQuota?.billingMonth === currentYearMonth() ? state.tripoQuota?.creditsUsed || 0 : 0),
  );
  const unarchivedTasks = (state.tripoQuota?.tasks || []).filter(
    (t) => t.status === 'completed_remote' && !t.localArchivePath,
  );

  return {
    initialized: true,
    percent: Math.round(completedStages / PIPELINE_STAGES.length * 100),
    projectId: state.projectId,
    projectName: state.projectName,
    activeStageId: state.activeStageId,
    completedStages,
    totalStages: PIPELINE_STAGES.length,
    readyViews,
    totalViews,
    tripoPlan: state.tripoQuota?.plan || 'studio_free',
    tripoStrategy: state.tripoQuota?.strategy || 'studio_free_saver',
    remainingFreeCredits: remainingCredits,
    monthlyAllowance: state.tripoQuota?.monthlyAllowance ?? 200,
    unarchived24hWarningCount: unarchivedTasks.length,
    vrmAddonVerified: Boolean(state.blenderState?.vrmAddonVerified),
    exportedVrmPath: state.vrmMetadata?.exportedVrmPath || null,
    exportedExpressiveVrmPath: state.vrmMetadata?.exportedExpressiveVrmPath || null,
  };
}
