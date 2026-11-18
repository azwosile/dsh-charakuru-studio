import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tempProject, png, zip } from './fixtures.mjs';
import { validatePng, extractFirstFileFromZip, buildAnimaComfyWorkflow, runTurnaroundGeneration } from '../lib/providers/image-router.js';
import { compileTurnaroundPromptPack, formatAnimaTags, queryModelCatalog } from '../lib/catalog/aa-image-hub.js';
import { initOrUpdateProject, loadProjectState } from '../lib/project/state.js';

test('image formats: valid scanlines, corrupt CRC/truncated/oversized ZIP rejected', () => {
  const image = png(); assert.deepEqual(validatePng(image), image);
  for (const method of [0,8]) for (const descriptor of [false,true]) assert.deepEqual(extractFirstFileFromZip(zip(image, method, descriptor)), image);
  const corrupt = Buffer.from(image); corrupt[45] ^= 1;
  assert.throws(() => validatePng(corrupt), /checksum/);
  assert.throws(() => validatePng(image.subarray(0, 40)), /valid PNG|Truncated/);
  const badZip = zip(image); badZip[14] ^= 1;
  assert.throws(() => extractFirstFileFromZip(badZip), /checksum/);
  const hugeZip = zip(image); hugeZip.writeUInt32LE(0x7fffffff, 22);
  assert.throws(() => extractFirstFileFromZip(hugeZip), /size/);
});

test('prompt compiler and Anima official graph contracts', () => {
  assert.ok(queryModelCatalog().total >= 14);
  assert.equal(queryModelCatalog().benchmark.updatedAt, '2026-11-18');
  assert.equal(queryModelCatalog({weights:'open_weights'}).models.find(row=>row.id==='minimax-h3-image').driver,'catalog');
  assert.equal(compileTurnaroundPromptPack().views.length, 11);
  assert.throws(() => compileTurnaroundPromptPack({ modelId: 'missing' }), /Unknown/);
  assert.throws(() => compileTurnaroundPromptPack({ slots: [] }), /slots/);
  const tags = formatAnimaTags({ characterSummary: 'Blue_Hair, score_9', artist: 'Artist_Name', variant: 'aesthetic' });
  assert.match(tags.positive, /blue hair/); assert.match(tags.positive, /@artist name/); assert.doesNotMatch(tags.positive, /score[_ ]/);
  const graph = buildAnimaComfyWorkflow({ positivePrompt: 'test', negativePrompt: '' });
  assert.equal(graph[2].inputs.type, 'stable_diffusion'); assert.equal(graph[4].class_type, 'EmptyLatentImage');
  const turbo = buildAnimaComfyWorkflow({ variant: 'turbo' });
  assert.equal(turbo[7].inputs.cfg, 1); assert.equal(turbo[1].inputs.unet_name, 'anima-turbo-v1.0.safetensors');
  assert.equal(buildAnimaComfyWorkflow({ variant: 'aesthetic' })[1].inputs.unet_name, 'anima-aesthetic-v1.0.safetensors');
});

test('router: validates bytes, preserves cloud key isolation and reports partial failure', async t => {
  const dir = await tempProject(t); await initOrUpdateProject(dir);
  let count = 0;
  const response = await runTurnaroundGeneration({ projectDir: dir, mode: 'execute', slots: ['head_front', 'head_back'], secrets: { openai_compat: 'must-not-be-sent' }, fetchImpl: async (_url, init) => {
    assert.equal(init.headers.Authorization, undefined);
    return new Response(JSON.stringify({ data: [{ b64_json: (++count === 1 ? png() : Buffer.from('invalid')).toString('base64') }] }), { headers: { 'Content-Type': 'application/json' } });
  } });
  assert.equal(response.verdict, 'degraded'); assert.equal(response.ok, false);
  const state = (await loadProjectState(dir)).state;
  assert.equal(state.views.head_front.status, 'ready'); assert.equal(state.views.head_back.status, 'missing');
  assert.match(path.basename(response.results[0].filePath), /^head_front-[a-f0-9-]{36}\.png$/);
  assert.deepEqual(await fs.readFile(response.results[0].filePath), png());
  await assert.rejects(runTurnaroundGeneration({ projectDir: dir, modelId: 'seedream-5.5', mode: 'execute', slots: ['head_front'] }), /IMAGE_PREFLIGHT_BLOCKED/);
  await initOrUpdateProject(dir, { sourceImage: 'missing.png' });
  await assert.rejects(runTurnaroundGeneration({ projectDir: dir, mode: 'execute', slots: ['head_front'] }), /IMAGE_PREFLIGHT_BLOCKED/);
});

test('router: timeout is a failed view and lock is released', async t => {
  const dir = await tempProject(t); await initOrUpdateProject(dir);
  const result = await runTurnaroundGeneration({ projectDir: dir, mode: 'execute', slots: ['body_front'], timeoutMs: 10, fetchImpl: (_u, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) });
  assert.equal(result.verdict, 'fail'); assert.match(result.results[0].error, /timed out|aborted/);
  assert.equal((await runTurnaroundGeneration({ projectDir: dir, slots: ['head_front'] })).exportedArtifacts.length, 2);
});
