import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { PIPELINE_STAGES, REQUIRED_VIEW_SLOTS } from '../constants.js';

export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export function invalidateFrom(state, stageId, reason) {
  const start = PIPELINE_STAGES.find(s => s.id === stageId);
  if (!start) throw new Error('Unknown invalidation stage');
  for (const def of PIPELINE_STAGES.filter(s => s.index >= start.index)) {
    const stage = state.stages[def.id];
    Object.assign(stage, { status: 'pending', checkpointState: 'locked', approvedAt: null, approvedEvidence: null, reviewEvidence: null, invalidatedReason: reason });
  }
  const first = PIPELINE_STAGES.find(s => state.stages[s.id].status !== 'completed');
  state.activeStageId = first.id;
  state.stages[first.id].status = 'in_progress';
  if (start.index <= 4) {
    state.blenderState.activeBlendFile = null;
    state.blenderState.vrmAddonVerified = false;
    state.vrmMetadata.exportedExpressiveVrmPath = null;
    state.vrmMetadata.exportedVrmPath = null;
  }
  state.auditLog.push({ at: new Date().toISOString(), event: 'review.invalidated', stageId, detail: reason });
}
export async function scopedFile(projectDir, file) {
  const root = await fs.realpath(projectDir), target = await fs.realpath(path.resolve(root, file));
  const rel = path.relative(root, target);
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new Error('Asset must remain inside the project root');
  const stat = await fs.stat(target);
  if (!stat.isFile() || stat.size > 128 * 1024 * 1024) throw new Error('Asset is not a file or exceeds 128 MiB');
  return target;
}
export async function verifyAsset(projectDir, item) {
  if (!item || !/^[a-f0-9]{64}$/.test(item.sha256 || '')) throw new Error('Asset has no registered fingerprint');
  const file = await scopedFile(projectDir, item.filePath);
  const bytes = await fs.readFile(file);
  if (sha256(bytes) !== item.sha256) throw new Error('Asset changed on disk; reimport before review');
  return { file, bytes };
}
export async function collectReviewEvidence(projectDir, state, stageId) {
  const items = state.assets?.items || [];
  const evidence = { stageId, entries: [] };
  if (stageId === '1_concept') {
    if (!state.characterSpec.characterPrompt?.trim() && !state.characterSpec.sourceImages?.length) throw new Error('请先登记原画或写明角色设定；空白概念不能送审。');
    evidence.entries.push({ spec: state.characterSpec });
    for (const source of state.characterSpec.sourceImages || []) {
      const file = path.resolve(projectDir, source), stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > 20 * 1024 * 1024) throw new Error('原画不是文件或超过20 MiB');
      const bytes = await fs.readFile(file);
      if (!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('原画必须为 PNG');
      evidence.entries.push({ source, sha256: sha256(bytes) });
    }
  } else if (stageId === '2_views') {
    for (const slot of REQUIRED_VIEW_SLOTS) {
      const view = state.views[slot.id], item = items.find(a => a.id === view?.assetId && a.kind === 'image' && a.slotId === slot.id);
      if (view?.status !== 'ready' || !item) throw new Error(`视图尚未登记：${slot.id}。请导入或扫描实际 PNG。`);
      await verifyAsset(projectDir, item);
      evidence.entries.push({ slot: slot.id, id: item.id, sha256: item.sha256 });
    }
  } else if (stageId === '3_tripo') {
    for (const part of ['head', 'body']) {
      const id = state.assets?.selected?.[part], item = items.find(a => a.id === id && a.kind === 'glb' && a.part === part);
      if (!item || !item.renderable) throw new Error(`请选择实际可预览的 ${part} GLB 候选；归档不等于选定。`);
      await verifyAsset(projectDir, item);
      evidence.entries.push({ part, id, sha256: item.sha256 });
    }
  } else {
    // P0/P1 does not certify the P2+ modeling stages. Fail closed rather than approve a draft.
    throw new Error('P0/P1 仅提供原画、视图与候选门禁；后续阶段需独立的真实建模验收，当前不可标为交付完成。');
  }
  return { ...evidence, fingerprint: sha256(JSON.stringify(evidence)) };
}
export async function reviewReadiness(projectDir, state) {
  if (!state) return null;
  try { await verifyPreviousReviews(projectDir, state, state.activeStageId); const evidence = await collectReviewEvidence(projectDir, state, state.activeStageId); return { ready: true, fingerprint: evidence.fingerprint }; }
  catch (error) { return { ready: false, reason: error.message }; }
}

export async function verifyPreviousReviews(projectDir, state, stageId) {
  const target = PIPELINE_STAGES.find(s => s.id === stageId);
  for (const def of PIPELINE_STAGES.filter(s => s.index < target.index)) {
    if (state.stages[def.id].status !== 'completed') throw new Error(`上游 ${def.id} 尚未完成审批`);
    const approved = state.stages[def.id].approvedEvidence;
    if (!approved || approved.fingerprint !== (await collectReviewEvidence(projectDir, state, def.id)).fingerprint) throw new Error(`上游 ${def.id} 的资产或设定已变化，请重新提交审批`);
  }
}
