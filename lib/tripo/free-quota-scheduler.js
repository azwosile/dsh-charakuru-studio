import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureProjectLayout, loadProjectState, updateProjectState } from '../project/state.js';
import { verifyPreviousReviews } from '../project/reviews.js';

// Planning assumptions, not a live quote or a guarantee of account entitlements.
export const TRIPO_STRATEGIES = Object.freeze({
  studio_free_saver: { id: 'studio_free_saver', titleZh: 'Studio 单候选预算方案', titleEn: 'Studio single-candidate budget', concurrency: 1, totalEstimatedCredits: 95, channel: 'studio_web', estimateOnly: true,
    steps: [{ step: 'head', labelZh: '头部生成预算', estimatedCredits: 25 }, { step: 'body', labelZh: '身体生成预算', estimatedCredits: 25 }, { step: 'refine', labelZh: '精修预留预算', estimatedCredits: 45 }] },
  studio_free_2x2: { id: 'studio_free_2x2', titleZh: 'Studio 头体各两候选预算方案', titleEn: 'Studio two candidates per part', concurrency: 1, totalEstimatedCredits: 145, channel: 'studio_web', estimateOnly: true,
    steps: [{ step: 'head', labelZh: '两头部候选预算', estimatedCredits: 50 }, { step: 'body', labelZh: '两身体候选预算', estimatedCredits: 50 }, { step: 'refine', labelZh: '精修预留预算', estimatedCredits: 45 }] },
  openapi_v3_hybrid: { id: 'openapi_v3_hybrid', titleZh: 'OpenAPI 独立余额规划', titleEn: 'OpenAPI separate balance planning', concurrency: 1, totalEstimatedCredits: null, channel: 'openapi', estimateOnly: true, steps: [] },
});
let serialTail = Promise.resolve();
// Serializes work performed inside fn; remote tasks must be awaited inside fn too.
export function runSerialTripoTask(fn) {
  const next = serialTail.then(fn, fn);
  serialTail = next.catch(() => {});
  return next;
}
function monthWindow(quota) {
  const ym = new Date().toISOString().slice(0, 7);
  if (quota.billingMonth !== ym) Object.assign(quota, { billingMonth: ym, creditsUsed: 0, freeRetriesUsed: 0 });
  return quota;
}
export function validateGlb(raw) {
  const b = Buffer.from(raw);
  if (b.length < 20 || b.readUInt32LE(0) !== 0x46546c67 || b.readUInt32LE(4) !== 2 || b.readUInt32LE(8) !== b.length) throw new Error('Invalid GLB 2.0 header or declared length');
  let off = 12, json = null, chunkIndex = 0, hasBin = false;
  while (off < b.length) {
    if (off + 8 > b.length) throw new Error('Truncated GLB chunk header');
    const len = b.readUInt32LE(off), type = b.readUInt32LE(off + 4);
    if (len % 4 || off + 8 + len > b.length) throw new Error('Invalid GLB chunk length');
    if (chunkIndex === 0 && type !== 0x4e4f534a) throw new Error('GLB first chunk must be JSON');
    if (type === 0x4e4f534a) {
      if (json) throw new Error('Duplicate GLB JSON chunk');
      json = JSON.parse(b.toString('utf8', off + 8, off + 8 + len).trim());
    } else if (type === 0x004e4942) {
      if (hasBin) throw new Error('Duplicate GLB BIN chunk');
      hasBin = true;
    }
    off += 8 + len; chunkIndex++;
  }
  if (json?.asset?.version !== '2.0') throw new Error('GLB asset.version must be 2.0');
  return json; // Container check; semantic mesh validation remains a companion gltf_validate operation.
}
export async function planTripoFreeQuotaRun({ projectDir, strategyId = 'studio_free_saver', estimatedCredits } = {}) {
  const strategy = TRIPO_STRATEGIES[strategyId];
  if (!strategy) throw new Error(`Unknown Tripo strategy: ${strategyId}`);
  const loaded = await loadProjectState(projectDir);
  if (!loaded.exists) throw new Error('Initialize project before planning Tripo tasks');
  const quota = monthWindow(structuredClone(loaded.state.tripoQuota));
  const cost = estimatedCredits ?? strategy.totalEstimatedCredits;
  if (cost !== null && (!Number.isFinite(cost) || cost < 0)) throw new Error('Estimated credits must be non-negative');
  const remaining = Math.max(0, quota.monthlyAllowance - quota.creditsUsed);
  const separate = strategy.channel === 'openapi';
  const fits = separate || cost === null ? null : remaining >= cost;
  let viewsApproved = false, blockedReason = '';
  if (!separate) {
    try { await verifyPreviousReviews(loaded.projectDir, loaded.state, '3_tripo'); viewsApproved = true; }
    catch (error) { blockedReason = error.message; }
  }
  return {
    verdict: fits === true ? 'pass' : 'degraded', projectDir: loaded.projectDir, strategy: { ...strategy, totalEstimatedCredits: cost },
    automation: 'manual_studio_playbook', estimateOnly: true,
    assumptions: ['Account allowance, prices, retry eligibility and retention must be checked in Studio before submission.', 'Studio credits and OpenAPI balances are separate.', 'This planner does not click Generate or enforce concurrency in external browser sessions.'],
    quotaSummary: { billingMonth: quota.billingMonth, monthlyAllowance: quota.monthlyAllowance, creditsUsed: quota.creditsUsed, remainingCredits: remaining, freeRetriesUsed: quota.freeRetriesUsed, maxConcurrency: 1, fitsInRemainingQuota: fits, separateApiBalance: separate, verdict: fits === true ? 'pass' : 'degraded' },
    expiringUnarchivedTasks: quota.tasks.filter(t => !t.localArchivePath && t.expiresAt).map(t => ({ taskId: t.taskId, part: t.part, hoursLeft: (Date.parse(t.expiresAt) - Date.now()) / 3600000 })),
    studioWebPlaybook: separate ? null : { targetUrl: 'https://studio.tripo3d.ai', viewsApproved, blockedReason, stages: ['head', 'body'].map((part, index) => ({ order: index + 1, part,
      inputFiles: viewsApproved ? ['front', 'right', 'left', 'back'].map(angle => {
        const slot = loaded.state.views[`${part}_${angle}`];
        const asset = loaded.state.assets.items.find(entry => entry.id === slot.assetId);
        return path.resolve(loaded.projectDir, asset.filePath);
      }) : [],
      uiStepsZh: ['在当前登录的 Studio 核对套餐、每步价格、可用重试与导出选项。', '上传已审阅的四视图；等待当前任务完成后再提交下一任务。', '下载 GLB，登记真实消耗和远端任务 ID，立即本地归档。'],
      uiStepsEn: ['Check plan, actual prices, retry eligibility and export options in the signed-in Studio.', 'Upload reviewed views and wait for completion before submitting the next task.', 'Download GLB and archive locally with actual cost and remote task ID.'],
    })) },
  };
}
async function atomicBytes(file, bytes) {
  const tmp = `${file}.tmp-${crypto.randomUUID()}`;
  try { await fs.writeFile(tmp, bytes, { flag: 'wx' }); await fs.rename(tmp, file); }
  finally { await fs.rm(tmp, { force: true }); }
}
export async function archiveTripoGlbAsset({ projectDir, part = 'head', sourceGlbPath, creditsSpent = 0, usedFreeRetry = false, selectAsActive = false, remoteTaskId = '' } = {}) {
  if (!['head', 'body', 'clothing', 'hair', 'accessory'].includes(part)) throw new Error('Invalid Tripo part');
  if (!sourceGlbPath || typeof sourceGlbPath !== 'string') throw new Error('sourceGlbPath is required');
  if (!Number.isFinite(creditsSpent) || creditsSpent < 0) throw new Error('creditsSpent must be finite and non-negative');
  const loaded = await loadProjectState(projectDir);
  if (!loaded.exists) throw new Error('Initialize project before archiving');
  const root = await ensureProjectLayout(projectDir);
  const source = path.resolve(root, sourceGlbPath), stat = await fs.stat(source);
  if (!stat.isFile() || stat.size > 128 * 1024 * 1024) throw new Error('GLB exceeds 128 MiB');
  const bytes = await fs.readFile(source);
  const { inspectGlb, importStudioAsset } = await import('../project/assets.js');
  inspectGlb(bytes);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const archivePath = path.join(root, 'tripo', 'archive', `${part}_${sha256}.glb`);
  if (selectAsActive) throw new Error('请在资产库明确选择候选；归档不再自动选定');
  const activePartPath = null;
  let duplicate = false;
  const saved = await updateProjectState(root, async state => {
    const quota = monthWindow(state.tripoQuota);
    // Remote task is billing identity; absent an ID use content identity for conservative deduplication.
    const taskId = remoteTaskId || `local_${part}_${sha256}`;
    const prior = quota.tasks.find(t => t.taskId === taskId);
    if (prior && (prior.sha256 !== sha256 || prior.part !== part || prior.creditsSpent !== creditsSpent || prior.usedFreeRetry !== Boolean(usedFreeRetry))) throw new Error('Existing task has conflicting content or credit record');
    duplicate = Boolean(prior);
    await atomicBytes(archivePath, bytes);
    const readback = await fs.readFile(archivePath);
    if (crypto.createHash('sha256').update(readback).digest('hex') !== sha256) throw new Error('Archive hash verification failed');
    if (activePartPath) await atomicBytes(activePartPath, bytes);
    if (!prior) {
      quota.creditsUsed += creditsSpent;
      quota.freeRetriesUsed += usedFreeRetry ? 1 : 0;
      quota.tasks.push({ taskId, part, sha256, creditsSpent, usedFreeRetry: Boolean(usedFreeRetry), billingMonth: quota.billingMonth, createdAt: new Date().toISOString(), localArchivePath: archivePath, bytes: bytes.length, status: 'archived_local' });
    }
    if (activePartPath) quota.selectedCandidates[`${part}Glb`] = activePartPath;
    state.auditLog.push({ at: new Date().toISOString(), event: 'tripo.glb.archived', detail: `${part} sha256:${sha256} duplicate:${duplicate}` });
  });
  const registered = await importStudioAsset({ projectDir: root, kind: 'glb', part, sourcePath: archivePath });
  return { assetId: registered.asset.id, part, selectionRequired: true, verdict: 'pass', archived: true, duplicate, archivePath, activePartPath, sha256, bytes: bytes.length, validation: 'glb2_container_only', remainingFreeCredits: Math.max(0, saved.state.tripoQuota.monthlyAllowance - saved.state.tripoQuota.creditsUsed) };
}
