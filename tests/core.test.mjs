import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tempProject, glb } from './fixtures.mjs';
import { initOrUpdateProject, loadProjectState, updateProjectState, saveProjectState, transitionStageCheckpoint, summarizeProjectProgress } from '../lib/project/state.js';
import { exclusiveProjectOperation } from '../lib/project/operations.js';
import { planTripoFreeQuotaRun, archiveTripoGlbAsset, validateGlb } from '../lib/tripo/free-quota-scheduler.js';
import { okEnvelope, losslessSanitize } from '../lib/contracts/lossless.js';
import { createCredentialManager } from '../lib/host/credentials.js';
import { buildStudioTools } from '../lib/tools/register-all.js';

test('state: sequential human checkpoints, revision conflict and parallel mutations', async t => {
  const dir = await tempProject(t);
  await initOrUpdateProject(dir, { monthlyCreditAllowance: 0, characterPrompt: 'test' });
  let loaded = await loadProjectState(dir);
  assert.equal(summarizeProjectProgress(loaded.state).remainingFreeCredits, 0);
  await assert.rejects(transitionStageCheckpoint(dir, { action: 'approve', actor: 'user' }), /awaiting_review/);
  await assert.rejects(transitionStageCheckpoint(dir, { stageId: '3_tripo', action: 'activate' }), /active stage/);
  await transitionStageCheckpoint(dir, { action: 'request_review' });
  await assert.rejects(transitionStageCheckpoint(dir, { action: 'approve', actor: 'agent' }), /user review/);
  await transitionStageCheckpoint(dir, { action: 'reject', actor: 'user' });
  await transitionStageCheckpoint(dir, { action: 'request_review' });
  await transitionStageCheckpoint(dir, { action: 'approve', actor: 'user' });
  assert.equal((await loadProjectState(dir)).state.activeStageId, '2_views');
  await assert.rejects(saveProjectState(dir, loaded.state), /changed concurrently/);
  await Promise.all(Array.from({ length: 20 }, () => updateProjectState(dir, s => { s.testCounter = (s.testCounter || 0) + 1; })));
  assert.equal((await loadProjectState(dir)).state.testCounter, 20);
  await initOrUpdateProject(dir, { sourceImage: 'ref.png', characterPrompt: '' });
  await initOrUpdateProject(dir, { sourceImage: '' });
  loaded = await loadProjectState(dir);
  assert.deepEqual(loaded.state.characterSpec.sourceImages, []);
  assert.equal(loaded.state.characterSpec.characterPrompt, '');
  await assert.rejects(initOrUpdateProject(dir, { neckScaleFactor: -1 }), /positive/);
  await fs.writeFile(loaded.stateFile, '{broken');
  await assert.rejects(loadProjectState(dir), SyntaxError);
});

test('long output operation rejects overlap but releases lock after failure', async t => {
  const dir = await tempProject(t);
  let release;
  const first = exclusiveProjectOperation(dir, () => new Promise(r => { release = r; }));
  await assert.rejects(exclusiveProjectOperation(dir, () => null), /Another output operation/);
  release(); await first;
  await assert.rejects(exclusiveProjectOperation(dir, () => { throw new Error('expected'); }), /expected/);
  assert.equal(await exclusiveProjectOperation(dir, () => 42), 42);
});

test('Tripo: real GLB validation, concurrent dedupe, billing conflict and month rollover', async t => {
  const dir = await tempProject(t);
  await initOrUpdateProject(dir, { monthlyCreditAllowance: 200 });
  await fs.writeFile(path.join(dir, 'input.glb'), glb());
  const args = { projectDir: dir, sourceGlbPath: 'input.glb', remoteTaskId: 'remote-1', creditsSpent: 25 };
  const out = await Promise.all([archiveTripoGlbAsset(args), archiveTripoGlbAsset(args)]);
  assert.deepEqual(out.map(x => x.duplicate).sort(), [false, true]);
  assert.equal((await loadProjectState(dir)).state.tripoQuota.creditsUsed, 25);
  assert.equal(out[0].sha256.length, 64);
  for (const part of ['clothing', 'hair']) {
    const partRes = await archiveTripoGlbAsset({ projectDir: dir, sourceGlbPath: 'input.glb', part, remoteTaskId: `remote-${part}`, creditsSpent: 0 });
    assert.equal(partRes.part, part);
  }
  await assert.rejects(archiveTripoGlbAsset({ ...args, creditsSpent: 30 }), /conflicting/);
  assert.throws(() => validateGlb(Buffer.from('glTF')), /header/);
  const broken = glb(); broken.writeUInt32LE(9999, 8);
  assert.throws(() => validateGlb(broken), /length/);
  await updateProjectState(dir, s => { s.tripoQuota.billingMonth = '2000-01'; });
  assert.equal(summarizeProjectProgress((await loadProjectState(dir)).state).remainingFreeCredits, 200);
  await archiveTripoGlbAsset(args);
  assert.equal((await loadProjectState(dir)).state.tripoQuota.creditsUsed, 0);
  const api = await planTripoFreeQuotaRun({ projectDir: dir, strategyId: 'openapi_v3_hybrid' });
  assert.equal(api.quotaSummary.separateApiBalance, true);
  assert.equal(api.verdict, 'degraded');
  await initOrUpdateProject(dir, { monthlyCreditAllowance: 0 });
  const plan = await planTripoFreeQuotaRun({ projectDir: dir });
  assert.equal(plan.quotaSummary.fitsInRemainingQuota, false);
});

test('credentials: missing object is unconfigured, writes use Host store, status omits secret', async () => {
  const records = new Map();
  const svc = { describeRecord: async k => ({ configured: records.has(k), writable: true }), readRecord: async k => records.get(k), modifyRecord: async (k, fn) => records.set(k, await fn(records.get(k))), deleteRecord: async k => records.delete(k) };
  const manager = createCredentialManager({ get: () => svc });
  assert.equal((await manager.describeAll()).find(x => x.id === 'novelai').source === 'host_credentials', false);
  await manager.setSecret('novelai', 'fixture-key-123');
  assert.equal(await manager.resolveSecret('novelai'), 'fixture-key-123');
  assert.doesNotMatch(JSON.stringify(await manager.describeAll()), /fixture-key/);
  await manager.clearSecret('novelai');
  assert.equal(records.size, 0);
  await assert.rejects(createCredentialManager({}).setSecret('novelai', 'test'), /unavailable/);
});

test('Tool schema forbids Agent review approval and secrets; degraded stays nonpass', async () => {
  const tools = buildStudioTools();
  assert.equal(tools.length, 7);
  const project = tools.find(t => t.name === 'charakuru_project');
  await assert.rejects(project.execute({ action: 'checkpoint', checkpointAction: 'approve' }), /checkpointAction/);
  const credentials = tools.find(t => t.name === 'charakuru_credentials');
  assert.equal('secret' in credentials.parameters.properties, false);
  for (const providerId of ['openai', 'ark']) {
    const filtered = await credentials.execute({ action: 'status', providerId });
    assert.equal(filtered.credentials.length, 1);
    assert.equal(filtered.credentials[0].id, providerId);
  }
  const blender = tools.find(t => t.name === 'charakuru_blender_avatar');
  assert.ok(blender.parameters.properties.inputBlendPath);
  assert.equal(okEnvelope({ verdict: 'degraded', ok: true }).ok, false);
  const cycle = []; cycle.push(cycle);
  assert.doesNotThrow(() => JSON.stringify(losslessSanitize(cycle)));
});
