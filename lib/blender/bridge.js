import { verifyPreviousReviews } from '../project/reviews.js';
import { detectCompanion, executeCompanionStage, collectCompanionJob, requestCompanion } from './transport.js';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DEFAULT_BLENDER_PLUGIN_PORT } from '../constants.js';
import { ensureProjectLayout, loadProjectState, updateProjectState } from '../project/state.js';
import { validateGlb } from '../tripo/free-quota-scheduler.js';
import { exclusiveProjectOperation } from '../project/operations.js';
import { generateStage1SafeImportScript, generateStage2AssemblyRatioScript, generateStage3CleanRoomRigWeightsScript, generateStage4SkirtSpringPhysicsScript, generateStage5ClosedMeshExpressionsVrmScript } from './cleanroom-scripts.js';

function localBase(raw) {
  const u = new URL(raw);
  if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('Blender companion URL must be a loopback HTTP origin');
  return u.origin;
}
export function resolveBlenderPluginBaseUrl(explicitUrl = '') {
  if (String(explicitUrl).trim()) return localBase(String(explicitUrl).trim());
  const validPort = p => Number.isInteger(p) && p > 0 && p <= 65535;
  const envPort = Number(process.env.DSH_BLENDER_HTTP_PORT);
  if (validPort(envPort)) return `http://127.0.0.1:${envPort}`;
  for (const file of [process.env.DSH_BLENDER_CONFIG, path.join(process.cwd(), 'dsh-blender.config.json'), path.join(os.homedir(), '.dsh', 'dsh-blender.config.json')].filter(Boolean)) {
    try { const p = Number(JSON.parse(fsSync.readFileSync(file, 'utf8')).httpPort); if (validPort(p)) return `http://127.0.0.1:${p}`; }
    catch { /* optional config */ }
  }
  return `http://127.0.0.1:${DEFAULT_BLENDER_PLUGIN_PORT}`;
}
export function parseNdjsonBackendBody(rawText) {
  const text = String(rawText ?? '');
  try { const obj = JSON.parse(text); if (obj && !Array.isArray(obj) && typeof obj === 'object' && obj.heartbeat !== true) return obj; } catch { /* stream */ }
  let last = null, heartbeats = 0;
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  for (const line of lines) {
    try { const o = JSON.parse(line); if (o && !Array.isArray(o) && typeof o === 'object') { if (o.heartbeat === true) heartbeats++; else last = o; } } catch { /* diagnostic line */ }
  }
  return last ? { ...last, __heartbeats: heartbeats, __streamLines: lines.length } : { ok: false, parseError: 'no_json_line' };
}
export async function probeBlenderPluginLink({ blenderPluginUrl = '', sceneQuery = '', fetchImpl = fetch } = {}) {
  const origins = blenderPluginUrl ? [resolveBlenderPluginBaseUrl(blenderPluginUrl)] : [...new Set([resolveBlenderPluginBaseUrl(), 'http://127.0.0.1:39877'])];
  const attempts = [], connections = [];
  for (const baseUrl of origins) {
    try { connections.push(await detectCompanion(baseUrl, { fetchImpl })); }
    catch (error) { attempts.push({ baseUrl, reason: error.message }); }
  }
  if (connections.length === 1) {
    const conn = connections[0];
    const q = typeof sceneQuery === 'string' ? sceneQuery.trim() : '';
    if (q) {
      try {
        const res = await requestCompanion(conn.baseUrl, '/host/scene-items?q=' + encodeURIComponent(q), null, { fetchImpl, timeoutMs: 3000 });
        const rawItems = Array.isArray(res?.items) ? res.items : Array.isArray(res?.sceneItems) ? res.sceneItems : Array.isArray(res?.objects) ? res.objects : Array.isArray(res?.result?.items) ? res.result.items : [];
        const qLower = q.toLowerCase();
        const sceneItems = rawItems.filter(item => {
          const name = typeof item === 'string' ? item : String(item?.name || item?.id || item?.label || '');
          return !name || name.toLowerCase().includes(qLower);
        });
        return { ...conn, attempts, sceneQuery: q, sceneItems };
      } catch (error) {
        return { ...conn, attempts, sceneQuery: q, sceneItems: [], sceneItemsError: error.message };
      }
    }
    return { ...conn, attempts };
  }
  if (connections.length > 1) return { linked: false, verdict: 'fail', protocol: 'conflict', connections, remedyZh: '检测到多个伴随桥接，请显式指定本桌面 profile 使用的地址。' };
  return { linked: false, verdict: 'degraded', protocol: 'unavailable', attempts, remedyZh: '请在实际使用的 DSH 桌面 profile 启用伴随插件，并核对自定义地址。未启动或升级任何程序。' };
}
export async function extractStageResult(receipt) {
  if (receipt?.result && typeof receipt.result === 'object') {
    if(typeof receipt.result.verdict==='string')return receipt.result;
    if(receipt.result.resultJson||receipt.result.resultPath||receipt.result.result?.verdict)return extractStageResult(receipt.result);
  }
  if (receipt?.resultJson && typeof receipt.resultJson === 'object') return receipt.resultJson;
  if (receipt?.resultPath || receipt?.outJson) {
    const file = receipt.resultPath || receipt.outJson;
    const stat = await fs.stat(file);
    if (stat.size > 2 * 1024 * 1024) throw new Error('Companion result JSON exceeds 2 MiB');
    return JSON.parse(await fs.readFile(file, 'utf8'));
  }
  const stdout = String(receipt?.stdout || receipt?.stdoutTail || '');
  for (const line of stdout.split('\n').reverse()) if (line.startsWith('HEADLESS ')) return JSON.parse(line.slice(9));
  return null;
}
async function fingerprint(file, kind) {
  const bytes = await fs.readFile(file);
  if (kind === 'blend') {
    // Blender may save compressed blend files. Gzip and Zstandard headers are accepted as containers only.
    const plain = bytes.subarray(0, 7).toString() === 'BLENDER';
    const compressed = bytes[0] === 0x1f && bytes[1] === 0x8b || bytes.length >= 4 && bytes.readUInt32LE(0) === 0xfd2fb528;
    if (bytes.length < 12 || !(plain || compressed)) throw new Error('Output is not a recognized blend container');
  } else {
    const json = validateGlb(bytes);
    if (!json.extensions?.VRMC_vrm || !json.extensionsUsed?.includes('VRMC_vrm')) throw new Error('Export lacks the VRMC_vrm extension');
  }
  return { path: file, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), validation: kind === 'blend' ? 'blend_container_only' : 'glb2_vrm1_extension_only' };
}
export function runBlenderAvatarStage(options = {}) {
  return exclusiveProjectOperation(options.projectDir, () => runStage(options));
}
async function runStage({ projectDir, operation = 'stage1_safe_import', executeViaPlugin = false, executionTarget = 'headless', blenderPluginUrl = '', params = {}, fetchImpl = fetch, caller = null, sessionId = '', signal } = {}) {
  if (!['headless', 'gui_act'].includes(executionTarget)) throw new Error('Invalid Blender execution target');
  const root = await ensureProjectLayout(projectDir), loaded = await loadProjectState(root);
  if (!loaded.exists) throw new Error('Initialize project before Blender work');
  const state = loaded.state, ck = path.join(root, 'blender', 'checkpoints');
  if (executeViaPlugin && state.blenderState.pendingJob) throw new Error('已有未收集作业，请先 collect_job，不要重复执行。');
  const resolvePath = p => p ? path.resolve(root, p) : '';
  const stageDefs = {
    stage1_safe_import: [1, generateStage1SafeImportScript, '01_imported.blend'],
    stage2_assembly_ratio: [2, generateStage2AssemblyRatioScript, '02_assembled_ratio.blend'],
    stage3_rig_weights: [3, generateStage3CleanRoomRigWeightsScript, '03_rigged_cleanroom.blend'],
    stage4_skirt_springs: [4, generateStage4SkirtSpringPhysicsScript, '04_spring_draft.blend'],
    stage5_expressions_vrm: [5, generateStage5ClosedMeshExpressionsVrmScript, '05_expressive_draft.blend'],
  };
  const def = stageDefs[operation];
  if (!def) throw new Error(`Unsupported Blender operation: ${operation}`);
  const [index, generator, filename] = def;
  const outputBlend = resolvePath(params.outputBlendPath || path.join(ck, filename));
  const outputVrm = resolvePath(params.outputVrmPath || path.join(root, 'exports', 'avatar_expressive.vrm'));
  const inputBlend = resolvePath(params.inputBlendPath || params.existingBlendPath || state.blenderState.activeBlendFile || (index > 1 ? path.join(ck, Object.values(stageDefs)[index - 2][2]) : ''));
  if (inputBlend && inputBlend === outputBlend) throw new Error('Input and output blend paths must differ to preserve the checkpoint');
  const scriptCode = generator({
    ...params, outputBlendPath: outputBlend, outputVrmPath: outputVrm, inputBlendPath: inputBlend, existingBlendPath: inputBlend,
    headGlbPath: resolvePath(params.headGlbPath || state.tripoQuota.selectedCandidates.headGlb),
    bodyGlbPath: resolvePath(params.bodyGlbPath || state.tripoQuota.selectedCandidates.bodyGlb),
    neckScaleFactor: params.neckScaleFactor ?? state.characterSpec.neckScaleFactor ?? 0.86,
    vrmMeta: params.vrmMeta || state.vrmMetadata,
  });
  // Unique names allow separate projects/stages to be inspected without later overwrites of the submitted script.
  const scriptFile = path.join(root, 'blender', 'scripts', `${index}_${operation}_${crypto.randomUUID()}.py`);
  await fs.writeFile(scriptFile, scriptCode, 'utf8');
  const connection = executeViaPlugin ? await probeBlenderPluginLink({ blenderPluginUrl, fetchImpl }) : null;
  const recommendedBlenderPluginTools = {
    catalog: { tool: 'blender_rt_plan', args: { op: 'catalog' } },
    snapshotBeforeEdit: { tool: 'blender_rt_txn', args: { op: 'snapshot', label: `before_${operation}` } },
    headlessBatchRun: { tool: 'blender_rt_headless', args: { script_file: scriptFile, outdir: path.join(root, 'blender', 'renders'), hard_exit: true, use_user_config: true, engine: 'eevee' } },
    guiInteractiveRun: { tool: 'blender_rt_do', args: { file: scriptFile, see: true } },
    inspect: { tool: 'blender_rt_plan', args: { op: 'audit_scene', args: { self_intersect: true, summary_only: true }, session: 'auto' } },
    visual: { tool: 'blender_rt_see', args: { from: '2,-3,1.8', look_at: '0,0,0.9' } },
  };
  if (connection?.protocol === 'gateway-3.1') Object.assign(recommendedBlenderPluginTools, {
    catalog: { tool: 'blender_op', args: { op: 'catalog' } },
    headlessBatchRun: { tool: 'blender_run', args: { action: 'submit', kind: 'headless', script_file: scriptFile } },
    guiInteractiveRun: { tool: 'blender_py', args: { file: scriptFile, see: true } },
    visual: { tool: 'blender_see', args: { viewpoint: 'viewport' } },
    snapshotBeforeEdit: { tool: 'blender_session', args: { action: 'txn' } },
    inspect: { tool: 'blender_op', args: { op: 'audit_scene', args: { self_intersect: true, summary_only: true } } },
  });
  let executionReceipt = null, stageResult = null, verdict = 'degraded', artifacts = [], error = null;
  if (executeViaPlugin) {
    try {
      await verifyPreviousReviews(root, state, '4_assembly');
      for (const part of ['head', 'body']) if (params[`${part}GlbPath`] && resolvePath(params[`${part}GlbPath`]) !== resolvePath(state.tripoQuota.selectedCandidates[`${part}Glb`])) throw new Error('执行输入必须是已审批的候选；请先在资产库采用并审批');
      if (!connection?.linked) throw new Error('COMPANION_UNAVAILABLE: ' + JSON.stringify(connection?.attempts));
      executionReceipt = await executeCompanionStage({ connection, scriptFile, outdir: path.join(root, 'blender', 'renders'), executionTarget, caller, sessionId, fetchImpl, signal });
      if (executionReceipt.kind === 'promoted' || executionReceipt.jobId) {
        error = '作业已提交，需使用 collect_job 收集并核验实际产物；勿重复提交。';
      } else {
        stageResult = await extractStageResult(executionReceipt);
        if (executionReceipt.ok === false || executionReceipt.traceback || executionReceipt.exitCode != null && executionReceipt.exitCode !== 0 || !stageResult || !['pass', 'degraded', 'fail'].includes(stageResult.verdict)) throw new Error(stageResult?.error || 'Companion execution failed or has no structured stage verdict');
        if (stageResult.verdict === 'fail') throw new Error(stageResult.error || stageResult.vrmExportError || 'Blender stage failed');
        if (!stageResult.vrmAddonModule || resolvePath(stageResult.savedBlend) !== outputBlend) throw new Error('Stage did not report the expected blend and VRM Add-on');
        artifacts.push(await fingerprint(outputBlend, 'blend'));
        if (index === 5) {
          if (!stageResult.vrmExported || resolvePath(stageResult.outputVrmPath) !== outputVrm) throw new Error('Stage did not report the expected VRM export');
          artifacts.push(await fingerprint(outputVrm, 'vrm'));
        }
        verdict = index === 1 ? stageResult.verdict : 'degraded';
      }
    } catch (err) { verdict = 'fail'; error = err.message; }
  }
  await updateProjectState(root, next => {
    next.blenderState.generatedScripts.push(scriptFile);
    if (executionReceipt?.jobId) next.blenderState.pendingJob = { jobId: executionReceipt.jobId, protocol: connection.protocol, baseUrl: connection.baseUrl, caller, inputEvidence: state.stages['3_tripo'].approvedEvidence.fingerprint, operation, index, outputBlend, outputVrm, scriptFile, submittedAt: new Date().toISOString() };

    next.blenderState.lastRun = { operation, verdict, at: new Date().toISOString(), artifacts, error, jobId: executionReceipt?.jobId || null, runId: executionReceipt?.runId || null };
    if (artifacts.length && verdict !== 'fail') {
      next.blenderState.activeBlendFile = outputBlend;
      next.blenderState.vrmAddonVerified = true;
      if (index === 5) next.vrmMetadata.exportedExpressiveVrmPath = outputVrm;
    }
    next.auditLog.push({ at: new Date().toISOString(), event: `blender.${operation}`, detail: `${executeViaPlugin ? 'Executed' : 'Generated'} ${verdict}: ${scriptFile}` });
  });
  return { ok: verdict === 'pass', verdict, operation, connection, scriptFile, outputBlend, executed: Boolean(executeViaPlugin), executionTarget: executeViaPlugin ? executionTarget : null, stageResult, executionReceipt, artifacts, error, recommendedBlenderPluginTools,
    honestLimits: ['Generated scripts and container fingerprints do not certify rig quality, physics, topology, appearance or VRM viewer compatibility.', 'Draft stages require companion audit/assembly/animation gates and human review.'] };
}
export function collectBlenderAvatarJob({ projectDir, caller = null, fetchImpl = fetch, signal } = {}) {
  return exclusiveProjectOperation(projectDir, async () => {
    const loaded = await loadProjectState(projectDir), pending = loaded.state?.blenderState?.pendingJob;
    if (!pending) throw new Error('此工程没有待收集的 Blender 作业');
    await verifyPreviousReviews(projectDir, loaded.state, '4_assembly');
    if (pending.inputEvidence !== loaded.state.stages['3_tripo'].approvedEvidence.fingerprint) throw new Error('Input candidates changed since submission; old job cannot update project checkpoint');
    const collected = await collectCompanionJob(pending, { caller, fetchImpl, signal });
    if (collected.pending) return { verdict: 'degraded', pending: true, jobId: pending.jobId };
    if(collected.failed){await updateProjectState(projectDir,state=>{state.blenderState.lastRun={operation:pending.operation,verdict:'fail',jobId:pending.jobId,error:collected.receipt.error,at:new Date().toISOString()};state.blenderState.pendingJob=null;});return {verdict:'fail',error:collected.receipt.error};}
    try {
      const stage = await extractStageResult(collected.receipt);
      if (collected.receipt.exitCode != null && collected.receipt.exitCode !== 0 || !stage || !['pass', 'degraded'].includes(stage.verdict) || !stage.vrmAddonModule || path.resolve(stage.savedBlend || '') !== pending.outputBlend) throw new Error('作业产物回执不匹配，未更新工程检查点');
      const artifacts = [await fingerprint(pending.outputBlend, 'blend')];
      if (pending.index === 5) {
        if (!stage.vrmExported || path.resolve(stage.outputVrmPath || '') !== pending.outputVrm) throw new Error('Missing expected VRM export');
        artifacts.push(await fingerprint(pending.outputVrm, 'vrm'));
      }
      const verdict = pending.index === 1 ? stage.verdict : 'degraded';
      await updateProjectState(projectDir, state => {
        if (state.blenderState.pendingJob?.jobId !== pending.jobId) throw new Error('Pending job changed');
        state.blenderState.activeBlendFile = pending.outputBlend;
        state.blenderState.vrmAddonVerified = true;
        state.blenderState.lastRun = { operation: pending.operation, verdict, artifacts, jobId: pending.jobId, at: new Date().toISOString() };
        state.blenderState.pendingJob = null;
        if (pending.index === 5) state.vrmMetadata.exportedExpressiveVrmPath = pending.outputVrm;
      });
      return { verdict, artifacts, jobId: pending.jobId, stageResult: stage };
    } catch (error) {
      await updateProjectState(projectDir, state => {
        if (state.blenderState?.pendingJob?.jobId === pending.jobId) {
          state.blenderState.pendingJob = null;
          state.blenderState.lastRun = { operation: pending.operation, verdict: 'fail', jobId: pending.jobId, error: error.message, at: new Date().toISOString() };
        }
      }).catch(() => {});
      throw error;
    }
  });
}
