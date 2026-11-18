import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tempProject, glb, readyAssetProject } from './fixtures.mjs';
import { initOrUpdateProject, loadProjectState } from '../lib/project/state.js';
import { parseNdjsonBackendBody, extractStageResult, runBlenderAvatarStage, resolveBlenderPluginBaseUrl } from '../lib/blender/bridge.js';

function legacyFetch(fn) { return async (url, init) => {
  if (url.includes(':39877')) throw new Error('fixture unavailable');
  if (url.endsWith('/health')) return Response.json({ ok:true, stats:{}, lease:{}, provenance:{} });
  if (url.endsWith('/doctor')) return Response.json({ ok:true, kind:'ok' });
  return fn(url, init);
}; }

test('companion: NDJSON heartbeat and all actual structured result carriers', async t => {
  assert.equal(parseNdjsonBackendBody('{"heartbeat":true}\nnoise\n{"ok":true,"result":{"verdict":"degraded"}}\n').__heartbeats, 1);
  assert.equal(parseNdjsonBackendBody('noise').ok, false);
  assert.deepEqual(await extractStageResult({ resultJson: { verdict: 'fail' } }), { verdict: 'fail' });
  assert.deepEqual(await extractStageResult({ stdoutTail: 'noise\nHEADLESS {"verdict":"pass"}\n' }), { verdict: 'pass' });
  assert.equal(await extractStageResult({ ok: true }), null);
  const dir = await tempProject(t), resultPath = path.join(dir, 'result.json');
  await fs.writeFile(resultPath, '{"verdict":"degraded"}');
  assert.equal((await extractStageResult({ resultPath })).verdict, 'degraded');
  assert.throws(() => resolveBlenderPluginBaseUrl('https://example.com'), /loopback/);
});

test('companion: process success alone never marks asset or VRM verified', async t => {
  const dir = await tempProject(t); await readyAssetProject(dir);
  const out = await runBlenderAvatarStage({ projectDir: dir, executeViaPlugin: true, fetchImpl: async () => new Response('{"ok":true}') });
  assert.equal(out.verdict, 'fail');
  const state = (await loadProjectState(dir)).state;
  assert.equal(state.blenderState.vrmAddonVerified, false); assert.equal(state.blenderState.activeBlendFile, null);
  const promoted = await runBlenderAvatarStage({ projectDir: dir, executeViaPlugin: true, fetchImpl: legacyFetch(async () => new Response('{"ok":true,"kind":"promoted","jobId":"fixture-job"}')) });
  assert.equal(promoted.verdict, 'degraded'); assert.equal(promoted.artifacts.length, 0);
  assert.equal((await loadProjectState(dir)).state.blenderState.lastRun.jobId, 'fixture-job');
});

test('companion: actual artifact fingerprint required; heuristic stages remain degraded', async t => {
  const dir = await tempProject(t); await readyAssetProject(dir);
  const output = path.join(dir, 'result.blend');
  let validBytes = true;
  const fetchImpl = legacyFetch(async (_url, init) => {
    assert.equal(JSON.parse(init.body).useUserConfig, true);
    await fs.writeFile(output, validBytes ? Buffer.from('BLENDER-v500fixture') : Buffer.from('invalid'));
    return new Response(JSON.stringify({ ok: true, exitCode: 0, resultJson: { verdict: 'pass', vrmAddonModule: 'fixture_vrm', savedBlend: output } }));
  });
  const pass = await runBlenderAvatarStage({ projectDir: dir, executeViaPlugin: true, params: { outputBlendPath: output }, fetchImpl });
  assert.equal(pass.verdict, 'pass'); assert.equal(pass.artifacts[0].sha256.length, 64);
  const nextOutput = path.join(dir, 'next.blend');
  const draft = await runBlenderAvatarStage({ projectDir: dir, operation: 'stage2_assembly_ratio', executeViaPlugin: true, params: { outputBlendPath: nextOutput }, fetchImpl: legacyFetch(async () => {
    await fs.writeFile(nextOutput, Buffer.from('BLENDER-v500fixture'));
    return new Response(JSON.stringify({ result: { verdict: 'pass', vrmAddonModule: 'fixture_vrm', savedBlend: nextOutput } }));
  }) });
  assert.equal(draft.verdict, 'degraded'); assert.equal(draft.ok, false);
  validBytes = false;
  const invalid = await runBlenderAvatarStage({ projectDir: dir, executeViaPlugin: true, params: { outputBlendPath: output }, fetchImpl });
  assert.equal(invalid.verdict, 'fail');
  assert.equal((await loadProjectState(dir)).state.blenderState.activeBlendFile, nextOutput);
});

test('companion: VRM export needs GLB 2 plus VRM 1 extension and stays a draft', async t => {
  const dir = await tempProject(t); await readyAssetProject(dir);
  const blend = path.join(dir, 'out.blend'), vrm = path.join(dir, 'out.vrm');
  let hasExtension = false;
  const fetchImpl = legacyFetch(async () => {
    await fs.writeFile(blend, Buffer.from('BLENDER-v500fixture'));
    await fs.writeFile(vrm, glb(hasExtension ? { extensionsUsed: ['VRMC_vrm'], extensions: { VRMC_vrm: { specVersion: '1.0' } } } : {}));
    return new Response(JSON.stringify({ result: { verdict: 'degraded', vrmAddonModule: 'fixture_vrm', savedBlend: blend, vrmExported: true, outputVrmPath: vrm } }));
  });
  const options = { projectDir: dir, operation: 'stage5_expressions_vrm', executeViaPlugin: true, params: { outputBlendPath: blend, outputVrmPath: vrm }, fetchImpl };
  assert.equal((await runBlenderAvatarStage(options)).verdict, 'fail');
  assert.equal((await loadProjectState(dir)).state.vrmMetadata.exportedExpressiveVrmPath, null);
  hasExtension = true;
  const draft = await runBlenderAvatarStage(options);
  assert.equal(draft.verdict, 'degraded'); assert.equal(draft.artifacts.length, 2);
  assert.equal((await loadProjectState(dir)).state.vrmMetadata.exportedExpressiveVrmPath, vrm);
});
