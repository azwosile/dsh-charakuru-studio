import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { tempProject, png, glb, triangleGlb, readyAssetProject } from './fixtures.mjs';
import { initOrUpdateProject, loadProjectState } from '../lib/project/state.js';
import { importProjectMaterial } from '../lib/project/materials.js';
import { setWorkflowMode, selectFoundation } from '../lib/project/workflow.js';
import {
  runEditorOperation,
  rollbackEditor,
  setEditorChannelPreference,
  checkoutEditorGui,
  checkinEditorGui,
  abortEditorGui,
  inspectAiEdit,
  createAiEditRequest,
} from '../lib/project/editor.js';
import { createRenderRequest, listRenderRequests } from '../lib/project/render.js';
import { probeBlenderPluginLink } from '../lib/blender/bridge.js';
import {
  queryTripoOpenApiBalance,
  submitTripoOpenApiTask,
  pollTripoOpenApiTask,
} from '../lib/tripo/openapi-client.js';
import {
  newTripoStudioTicket,
  transitionTripoStudioTicket,
  readTripoStudioTicket,
} from '../lib/tripo/studio-handoff.js';
import { createAccountBudget } from '../lib/providers/account-budget.js';
import { startStudioHttpServer } from '../lib/host/server.js';
import { buildStudioTools } from '../lib/tools/register-all.js';

const BLEND_BYTES = Buffer.from('BLENDER-v500dual-channel-fixture');
const FBX_BINARY = Buffer.concat([Buffer.from('Kaydara FBX Binary  '), Buffer.from([0x00, 0x1a, 0x00, 0xe8, 0x1c, 0x00, 0x00])]);

const current = async dir => (await loadProjectState(dir)).state;
const rev = async dir => (await current(dir)).stateRevision;

function mockBlenderCompanion({ sceneItems = [{ name: 'Head', type: 'MESH' }, { name: 'Hair_Front', type: 'MESH' }], sceneItemsFail = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ pathname: u.pathname, search: u.search, method: init.method || 'GET' });
    if (u.port === '39877') throw new Error('gateway unavailable in fixture');
    if (u.pathname === '/health') return Response.json({ ok: true, stats: {}, lease: {}, provenance: {} });
    if (u.pathname === '/doctor') return Response.json({ ok: true, kind: 'ok' });
    if (u.pathname === '/host/scene-items') {
      if (sceneItemsFail) return new Response('not implemented', { status: 404 });
      return Response.json({ ok: true, items: sceneItems });
    }
    const body = JSON.parse(init.body);
    const script = await fs.readFile(body.scriptFile, 'utf8');
    const command = JSON.parse(JSON.parse(script.split('\n')[0].slice('COMMAND = '.length)));
    const inputBytes = await fs.readFile(command.inputBlend);
    await fs.writeFile(command.outputs.blend, Buffer.concat([inputBytes, Buffer.from(`|op=${command.operation}`)]));
    await fs.writeFile(command.outputs.preview, triangleGlb());
    await fs.writeFile(
      command.outputs.report,
      JSON.stringify({
        requestId: command.requestId,
        objects: [
          { name: 'Body', type: 'MESH', vertices: 320, dimensions: [0.5, 0.25, 1.55], shapeKeys: [{ name: 'Smile', value: 0 }] },
          { name: 'Armature', type: 'ARMATURE', bones: ['hips', 'spine', 'head'] },
        ],
        gates: { weights: true, textures: true },
      })
    );
    if (command.operation === 'export_vrm' && command.outputs.vrm) {
      await fs.writeFile(
        command.outputs.vrm,
        glb({ extensionsUsed: ['VRMC_vrm'], extensions: { VRMC_vrm: { specVersion: '1.0' } } })
      );
    }
    return Response.json({
      ok: true,
      exitCode: 0,
      resultJson: { verdict: 'pass', requestId: command.requestId, outputs: command.outputs },
    });
  };
  return { fetchImpl, calls };
}

async function startMockCompanionServer(t) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const url = new URL(req.url, 'http://127.0.0.1');
    const json = payload => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(payload));
    };
    if (url.pathname === '/health') return json({ ok: true, stats: {}, lease: {}, provenance: {} });
    if (url.pathname === '/doctor') return json({ ok: true, kind: 'ok' });
    if (url.pathname === '/host/scene-items') {
      return json({ ok: true, items: [{ name: 'Yumeka_Body', type: 'MESH' }, { name: 'Hair_Twin', type: 'MESH' }] });
    }
    if (url.pathname === '/headless' || url.pathname === '/act') {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const script = await fs.readFile(body.scriptFile, 'utf8');
      const command = JSON.parse(JSON.parse(script.split('\n')[0].slice('COMMAND = '.length)));
      const inputBytes = await fs.readFile(command.inputBlend);
      await fs.writeFile(command.outputs.blend, Buffer.concat([inputBytes, Buffer.from('|checked-in')]));
      await fs.writeFile(command.outputs.preview, triangleGlb());
      await fs.writeFile(
        command.outputs.report,
        JSON.stringify({
          requestId: command.requestId,
          objects: [{ name: 'Yumeka_Body', type: 'MESH', vertices: 240 }],
          gates: { weights: true, textures: true },
          materialInput: command.material ? { id: command.material.id, sha256: command.material.sha256 } : null,
        })
      );
      if (command.operation === 'export_vrm' && command.outputs.vrm) {
        await fs.writeFile(
          command.outputs.vrm,
          glb({ extensionsUsed: ['VRMC_vrm'], extensions: { VRMC_vrm: { specVersion: '1.0' } } })
        );
      }
      return json({ ok: true, exitCode: 0, resultJson: { verdict: 'pass', requestId: command.requestId, outputs: command.outputs } });
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

async function startStudioClient(t, dir, config = {}, credentialManager = undefined) {
  const srv = await startStudioHttpServer({
    port: 0,
    config: { registryFile: path.join(dir, 'recents.json'), budgetDir: path.join(dir, 'budget'), ...config },
    credentialManager,
  });
  t.after(() => srv.close());
  const session = await (await fetch(`${srv.baseUrl}/studio/session`)).json();
  const post = async (route, fields = {}, origin = 'http://127.0.0.1:5173') => {
    const res = await fetch(`${srv.baseUrl}${route}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Charakuru-Session': session.sessionToken,
        Origin: origin,
      },
      body: JSON.stringify({ projectDir: dir, ...fields }),
    });
    return { status: res.status, data: await res.json() };
  };
  return { srv, sessionToken: session.sessionToken, post };
}

test('v0.7.0 Blender dual-channel: checkout_gui, concurrent lock, checkin_gui, rollback, abort_gui, channel preference, scene-items probe, read-only inspect, and render list', async t => {
  const dir = await tempProject(t);
  await initOrUpdateProject(dir);
  const sourceBlend = path.join(dir, 'original.blend');
  await fs.writeFile(sourceBlend, BLEND_BYTES);

  const mock = mockBlenderCompanion();
  const base = await runEditorOperation({
    projectDir: dir,
    operation: 'import_blend',
    params: { sourceBlend },
    fetchImpl: mock.fetchImpl,
  });

  // 1. /host/scene-items probe + graceful fallback
  const probed = await probeBlenderPluginLink({
    blenderPluginUrl: 'http://127.0.0.1:9877',
    sceneQuery: 'Hair',
    fetchImpl: mock.fetchImpl,
  });
  assert.equal(probed.linked, true);
  assert.equal(probed.sceneQuery, 'Hair');
  assert.deepEqual(probed.sceneItems.map(i => i.name), ['Hair_Front']);

  const failProbe = await probeBlenderPluginLink({
    blenderPluginUrl: 'http://127.0.0.1:9877',
    sceneQuery: 'Hair',
    fetchImpl: mockBlenderCompanion({ sceneItemsFail: true }).fetchImpl,
  });
  assert.equal(failProbe.linked, true);
  assert.deepEqual(failProbe.sceneItems, []);
  assert.ok(failProbe.sceneItemsError);

  // 2. Read-only editor_inspect without requestId
  const readOnlyInspect = await inspectAiEdit({ projectDir: dir });
  assert.equal(readOnlyInspect.request, null);
  assert.equal(readOnlyInspect.activeRevisionId, base.revisionId);
  assert.equal(readOnlyInspect.channelPreference, 'auto');
  assert.equal(readOnlyInspect.guiCheckout, null);
  assert.ok(readOnlyInspect.allowed.includes('transform'));
  assert.ok(readOnlyInspect.inventory.some(o => o.name === 'Body'));

  // 3. setEditorChannelPreference + AI handoff dual-channel propagation
  await assert.rejects(() => setEditorChannelPreference({ projectDir: dir, channelPreference: 'invalid' }), /Invalid editor channel/);
  const pref = await setEditorChannelPreference({ projectDir: dir, channelPreference: 'computer_use', expectedRevision: await rev(dir) });
  assert.equal(pref.channelPreference, 'computer_use');
  const aiReq = await createAiEditRequest({
    projectDir: dir,
    prompt: 'Sculpt bangs clearance',
    expectedRevisionId: base.revisionId,
  });
  assert.equal(aiReq.channelPreference, 'computer_use');
  assert.match(aiReq.instruction, /checkout_gui/);
  assert.match(aiReq.instruction, /checkin_gui/);

  // 4. checkout_gui copies immutable revision to editor/working/<id>/scene.blend & locks concurrent edits
  const checkedOut = await checkoutEditorGui({
    projectDir: dir,
    expectedRevisionId: base.revisionId,
    note: 'Weight paint skirt hem',
  });
  assert.equal(checkedOut.checkout.status, 'checked_out');
  assert.match(checkedOut.checkout.workingBlendRel, /^editor\/working\/[a-f0-9-]+\/scene\.blend$/);
  const workingBytes = await fs.readFile(checkedOut.workingBlendPath);
  assert.ok(workingBytes.subarray(0, 7).toString() === 'BLENDER');
  const lockPath = path.join(path.dirname(checkedOut.workingBlendPath), 'checkout.lock.json');
  assert.equal(JSON.parse(await fs.readFile(lockPath, 'utf8')).id, checkedOut.checkout.id);

  // Concurrent edits and duplicate checkouts must be rejected while checked out
  await assert.rejects(
    runEditorOperation({ projectDir: dir, operation: 'audit', expectedRevisionId: base.revisionId, fetchImpl: mock.fetchImpl }),
    /already checked out/
  );
  await assert.rejects(
    checkoutEditorGui({ projectDir: dir, expectedRevisionId: base.revisionId }),
    /already checked out/
  );

  // Simulate Computer-Use editing working scene.blend in place (leaving revisions & source untouched)
  const baseRevisionRecord = (await current(dir)).editor.revisions.find(r => r.id === base.revisionId);
  const baseRevisionBytesBefore = await fs.readFile(path.join(dir, baseRevisionRecord.artifacts.blend.filePath));
  await fs.writeFile(checkedOut.workingBlendPath, Buffer.concat([workingBytes, Buffer.from('-sculpted-in-gui')]));

  // 5. checkin_gui validates, commits new immutable revision tagged computer_use, releases lock
  const checkedIn = await checkinEditorGui({
    projectDir: dir,
    checkoutId: checkedOut.checkout.id,
    expectedRevisionId: base.revisionId,
    exportVrm: true,
    fetchImpl: mock.fetchImpl,
  });
  assert.equal(checkedIn.verdict, 'pass');
  assert.equal(checkedIn.channel, 'computer_use');
  assert.equal(checkedIn.checkoutId, checkedOut.checkout.id);
  assert.notEqual(checkedIn.revisionId, base.revisionId);
  const afterCheckin = await current(dir);
  assert.equal(afterCheckin.editor.guiCheckout, null);
  assert.equal(afterCheckin.editor.activeRevisionId, checkedIn.revisionId);
  assert.ok(afterCheckin.vrmMetadata.exportedVrmPath?.endsWith('avatar.vrm'));
  assert.equal(await fs.stat(lockPath).then(() => true, () => false), false, 'checkout.lock.json is removed on checkin');
  // Original revision and source blend remain completely untouched
  assert.deepEqual(await fs.readFile(path.join(dir, baseRevisionRecord.artifacts.blend.filePath)), baseRevisionBytesBefore);
  assert.deepEqual(await fs.readFile(sourceBlend), BLEND_BYTES);

  // Rollback back to original revision succeeds
  await rollbackEditor({ projectDir: dir, revisionId: base.revisionId, expectedRevisionId: checkedIn.revisionId });
  assert.equal((await current(dir)).editor.activeRevisionId, base.revisionId);

  // 6. abort_gui releases lock & removes working blend without changing active revision
  const secondCheckout = await checkoutEditorGui({ projectDir: dir, expectedRevisionId: base.revisionId, note: 'Trial sculpt' });
  const aborted = await abortEditorGui({
    projectDir: dir,
    checkoutId: secondCheckout.checkout.id,
    expectedRevisionId: base.revisionId,
    reason: 'Discarded trial',
  });
  assert.equal(aborted.aborted, true);
  assert.equal(aborted.activeRevisionId, base.revisionId);
  assert.equal((await current(dir)).editor.guiCheckout, null);
  assert.equal(await fs.stat(secondCheckout.workingBlendPath).then(() => true, () => false), false);

  // 7. charakuru_render(action='list') & charakuru_blender_avatar read-only editor_inspect tool
  await createRenderRequest({ projectDir: dir, brief: 'First render', expectedRevisionId: base.revisionId });
  await createRenderRequest({ projectDir: dir, brief: 'Second render', expectedRevisionId: base.revisionId });
  const listed = await listRenderRequests({ projectDir: dir });
  assert.equal(listed.activeRevisionId, base.revisionId);
  assert.equal(listed.requests.length, 2);
  assert.equal(listed.requests[0].brief, 'Second render');

  const tools = buildStudioTools({ config: { blenderPluginUrl: 'http://127.0.0.1:9877' } });
  const renderTool = tools.find(tool => tool.name === 'charakuru_render');
  const renderListToolRes = await renderTool.execute({ action: 'list', projectDir: dir });
  assert.equal(renderListToolRes.ok, true);
  assert.equal(renderListToolRes.requests.length, 2);

  const blenderTool = tools.find(tool => tool.name === 'charakuru_blender_avatar');
  const inspectToolRes = await blenderTool.execute({ action: 'editor_inspect', projectDir: dir });
  assert.equal(inspectToolRes.ok, true);
  assert.equal(inspectToolRes.activeRevisionId, base.revisionId);
});

test('v0.7.0 Tripo OpenAPI v3: balance query, parameter trap guards, budget lifecycle, 5-min URL download, and uncertain failure without auto-retry', async t => {
  const dir = await tempProject(t);
  await readyAssetProject(dir);
  const budget = createAccountBudget(path.join(dir, 'budget'));
  await budget.configure({ accountId: 'tripo-api-test', channel: 'tripo_api', period: '2026-11', limit: 100, unit: 'credits' });

  // 1. queryTripoOpenApiBalance
  const balRes = await queryTripoOpenApiBalance({
    apiKey: 'tsk_fixture_secret',
    baseUrl: 'https://api.tripo3d.test/v3',
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://api.tripo3d.test/v3/account/balance');
      assert.equal(init.headers.Authorization, 'Bearer tsk_fixture_secret');
      return Response.json({ code: 0, data: { balance: 420, frozen: 0 } });
    },
  });
  assert.equal(balRes.channel, 'openapi_v3');
  assert.equal(balRes.separateFromStudioWeb, true);
  assert.equal(balRes.balance.balance, 420);

  const baseOpts = {
    projectDir: dir,
    part: 'head',
    requestId: 'tripo_req_0001',
    expectedRevision: await rev(dir),
    allowCloudExecution: true,
    cloudConfirmed: true,
    apiKey: 'tsk_fixture_secret',
    baseUrl: 'https://api.tripo3d.test/v3',
    budget,
    accountId: 'tripo-api-test',
  };

  // 2. Parameter trap guards (Section 6.1.3)
  await assert.rejects(
    submitTripoOpenApiTask({ ...baseOpts, options: { export_orientation: 'align_image', postProcess: true } }),
    /Do not set export_orientation when post-processing is planned/
  );
  await assert.rejects(
    submitTripoOpenApiTask({ ...baseOpts, options: { export_orientation: 'align_image', texture: true } }),
    /Do not set export_orientation when post-processing is planned/
  );
  await assert.rejects(
    submitTripoOpenApiTask({ ...baseOpts, options: { generate_parts: true, texture: true } }),
    /generate_parts=true is mutually exclusive/
  );
  await assert.rejects(
    submitTripoOpenApiTask({ ...baseOpts, options: { generate_parts: true, quad: true } }),
    /generate_parts=true is mutually exclusive/
  );
  await assert.rejects(
    submitTripoOpenApiTask({
      ...baseOpts,
      action: 'multiview_to_model',
      options: { viewAngles: ['left', 'right'] },
    }),
    /multiview_to_model requires at least 2 input views including front/
  );
  await assert.rejects(
    submitTripoOpenApiTask({
      ...baseOpts,
      action: 'multiview_to_model',
      options: { views: ['front'] },
    }),
    /multiview_to_model requires at least 2 input views including front/
  );

  // Cloud execution & confirmation gates
  await assert.rejects(
    submitTripoOpenApiTask({ ...baseOpts, allowCloudExecution: false }),
    /CLOUD_EXECUTION_DISABLED/
  );
  await assert.rejects(
    submitTripoOpenApiTask({ ...baseOpts, cloudConfirmed: false }),
    /CLOUD_CONFIRMATION_REQUIRED/
  );

  // 3. Full happy path: upload PNGs -> multiview_to_model -> running -> success (5-min URL download & budget settle)
  const apiCalls = [];
  let pollCount = 0;
  const mockApiFetch = async (url, init = {}) => {
    apiCalls.push({ url, method: init.method || 'GET', auth: init.headers?.Authorization || null });
    if (url.endsWith('/files')) {
      return Response.json({ code: 0, data: { file_token: `tok_${apiCalls.length}` } });
    }
    if (url.endsWith('/generation/multiview-to-model')) {
      const payload = JSON.parse(init.body);
      assert.equal(payload.files.length, 4);
      assert.equal(payload.files[0].view, 'front');
      return Response.json({ code: 0, data: { task_id: 'task_mv_001' } });
    }
    if (url.endsWith('/tasks/task_mv_001')) {
      pollCount++;
      if (pollCount === 1) {
        return Response.json({ code: 0, data: { status: 'running', progress: 55 } });
      }
      return Response.json({
        code: 0,
        data: {
          status: 'success',
          progress: 100,
          credits_consumed: 20,
          output: { pbr_model: 'https://cdn.tripo3d.test/signed/head.glb?exp=300' },
        },
      });
    }
    if (url.startsWith('https://cdn.tripo3d.test/signed/head.glb')) {
      // Signed download URL must NOT receive the Bearer API key
      assert.equal(init.headers?.Authorization, undefined);
      return new Response(triangleGlb(), { status: 200, headers: { 'Content-Type': 'model/gltf-binary' } });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const submitted = await submitTripoOpenApiTask({
    ...baseOpts,
    action: 'multiview_to_model',
    options: { quotedCost: 30 },
    fetchImpl: mockApiFetch,
  });
  assert.equal(submitted.pending, true);
  assert.equal(submitted.taskId, 'task_mv_001');
  assert.equal((await budget.status('tripo-api-test')).held, 30);

  const running = await pollTripoOpenApiTask({
    projectDir: dir,
    taskId: 'task_mv_001',
    requestId: 'tripo_req_0001',
    apiKey: 'tsk_fixture_secret',
    baseUrl: 'https://api.tripo3d.test/v3',
    budget,
    accountId: 'tripo-api-test',
    fetchImpl: mockApiFetch,
  });
  assert.equal(running.pending, true);
  assert.equal(running.status, 'running');
  assert.equal(running.progress, 55);

  const done = await pollTripoOpenApiTask({
    projectDir: dir,
    taskId: 'task_mv_001',
    requestId: 'tripo_req_0001',
    apiKey: 'tsk_fixture_secret',
    baseUrl: 'https://api.tripo3d.test/v3',
    budget,
    accountId: 'tripo-api-test',
    fetchImpl: mockApiFetch,
  });
  assert.equal(done.verdict, 'pass');
  assert.equal(done.pending, false);
  assert.equal(done.candidate.channel, 'openapi_v3');
  assert.equal(done.candidate.remoteTaskId, 'task_mv_001');
  const settledStatus = await budget.status('tripo-api-test');
  assert.equal(settledStatus.held, 0);
  assert.equal(settledStatus.spent, 20);

  // 4. HTTP 400 rejection cancels budget (confirmedNotCharged: true)
  await assert.rejects(
    submitTripoOpenApiTask({
      ...baseOpts,
      requestId: 'tripo_req_400_bad',
      expectedRevision: await rev(dir),
      options: { quotedCost: 15 },
      fetchImpl: async url => {
        if (url.endsWith('/files')) return Response.json({ code: 0, data: { file_token: 'tok_400' } });
        return new Response(JSON.stringify({ code: 1004, message: 'invalid parameter' }), { status: 400 });
      },
    }),
    /invalid parameter/
  );
  assert.equal((await budget.status('tripo-api-test')).held, 0);

  // 5. Network failure transitions budget to uncertain and blocks auto-retry
  let dispatchAttempts = 0;
  await assert.rejects(
    submitTripoOpenApiTask({
      ...baseOpts,
      requestId: 'tripo_req_uncertain',
      expectedRevision: await rev(dir),
      options: { quotedCost: 25 },
      fetchImpl: async url => {
        if (url.endsWith('/files')) return Response.json({ code: 0, data: { file_token: 'tok_net' } });
        dispatchAttempts++;
        throw new Error('socket hang up');
      },
    }),
    err => err.status === 'uncertain' && /uncertain/i.test(err.message)
  );
  assert.equal(dispatchAttempts, 1);
  assert.equal((await budget.status('tripo-api-test')).held, 25);
  assert.equal(
    (await current(dir)).tripoQuota.openapiTasks.find(task => task.requestId === 'tripo_req_uncertain').status,
    'uncertain'
  );
  // Retrying the same uncertain requestId must fail closed without dispatching again
  await assert.rejects(
    submitTripoOpenApiTask({
      ...baseOpts,
      requestId: 'tripo_req_uncertain',
      expectedRevision: await rev(dir),
      options: { quotedCost: 25 },
      fetchImpl: async () => {
        dispatchAttempts++;
        throw new Error('must not auto-retry');
      },
    }),
    /uncertain billing state/
  );
  assert.equal(dispatchAttempts, 1);
});

test('v0.7.0 multi-view base_mesh Studio ticket (1-4 PNGs), confirm_quote inbox, Web binary upload (.glb & .fbx), loopback dual-channel routes, and Web folder browser', async t => {
  const dir = await tempProject(t);
  await initOrUpdateProject(dir);
  const companionUrl = await startMockCompanionServer(t);
  const { srv, sessionToken, post } = await startStudioClient(t, dir, { blenderPluginUrl: companionUrl });

  // 1. Switch to base_mesh & register foundation_body + 3 multi-view clothing reference PNGs
  await setWorkflowMode({ projectDir: dir, mode: 'base_mesh', expectedRevision: await rev(dir) });
  const bodyPath = path.join(dir, 'foundation.blend');
  await fs.writeFile(bodyPath, BLEND_BYTES);
  const bodyMat = (await importProjectMaterial({
    projectDir: dir,
    stageId: '4_assembly',
    role: 'foundation_body',
    sourcePath: bodyPath,
    expectedRevision: await rev(dir),
  })).material;
  await selectFoundation({ projectDir: dir, part: 'body', materialId: bodyMat.id, expectedRevision: await rev(dir) });

  const refs = [];
  for (let i = 0; i < 5; i++) {
    const p = path.join(dir, `coat_${i}.png`);
    await fs.writeFile(p, png(i + 2, i + 2));
    const imported = await importProjectMaterial({
      projectDir: dir,
      stageId: '4_assembly',
      role: 'tripo_clothing_reference',
      sourcePath: p,
      expectedRevision: await rev(dir),
    });
    refs.push(imported.material.id);
  }

  // Rejects >4 reference PNGs or duplicate IDs
  await assert.rejects(
    newTripoStudioTicket({ projectDir: dir, part: 'clothing', referenceMaterialIds: refs, creditCap: 25, expectedRevision: await rev(dir) }),
    /1 to 4/
  );
  await assert.rejects(
    newTripoStudioTicket({ projectDir: dir, part: 'clothing', referenceMaterialIds: [refs[0], refs[0]], creditCap: 25, expectedRevision: await rev(dir) }),
    /distinct/
  );

  // Create multi-view ticket (3 PNGs) via loopback HTTP POST /studio/tripo/studio/new
  const created = await post('/studio/tripo/studio/new', {
    part: 'clothing',
    referenceMaterialIds: refs.slice(0, 3),
    creditCap: 30,
    expectedRevision: await rev(dir),
  });
  assert.equal(created.status, 200);
  const ticketId = created.data.ticket.id;
  assert.deepEqual(created.data.ticket.referenceMaterialIds, refs.slice(0, 3));
  assert.equal(created.data.ticket.inputs.length, 3);
  assert.deepEqual(created.data.ticket.inputs.map(x => x.slotId), ['clothing_front', 'clothing_right', 'clothing_left']);

  // authorize_upload -> confirm_quote returns inbox directly!
  await transitionTripoStudioTicket({ projectDir: dir, ticketId, action: 'authorize_upload', confirmed: true, expectedRevision: await rev(dir) });
  const confirmed = await transitionTripoStudioTicket({
    projectDir: dir,
    ticketId,
    action: 'confirm_quote',
    quotedCredits: 25,
    confirmed: true,
    expectedRevision: await rev(dir),
  });
  assert.equal(confirmed.ticket.status, 'generation_confirmed');
  assert.ok(confirmed.inbox && confirmed.inbox.includes(ticketId), 'confirm_quote must return inbox directly');

  // 2. Binary upload via POST /studio/tripo/studio/upload (.glb and .fbx)
  const uploadRaw = async (fileName, bytes, headers = {}) => {
    const q = new URLSearchParams({
      projectDir: dir,
      ticketId,
      fileName,
      expectedRevision: String(await rev(dir)),
    });
    const res = await fetch(`${srv.baseUrl}/studio/tripo/studio/upload?${q}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(bytes.length),
        'X-Charakuru-Session': sessionToken,
        Origin: 'http://localhost:5173',
        ...headers,
      },
      body: bytes,
    });
    return { status: res.status, data: await res.json() };
  };

  // Missing session token returns 403
  assert.equal((await uploadRaw('coat.glb', triangleGlb(), { 'X-Charakuru-Session': 'wrong' })).status, 403);
  // Upload valid GLB
  const uploadedGlb = await uploadRaw('coat_v1.glb', triangleGlb());
  assert.equal(uploadedGlb.status, 200);
  assert.equal(uploadedGlb.data.candidate.kind, 'material');
  assert.equal(uploadedGlb.data.candidate.fileName, 'coat_v1.glb');
  // Upload valid FBX
  const uploadedFbx = await uploadRaw('coat_quad.fbx', FBX_BINARY);
  assert.equal(uploadedFbx.status, 200);
  assert.equal(uploadedFbx.data.candidate.kind, 'material');
  assert.equal(uploadedFbx.data.candidate.fileName, 'coat_quad.fbx');

  const ticketState = await readTripoStudioTicket({ projectDir: dir, ticketId });
  assert.equal(ticketState.ticket.downloads.length, 2);

  // 3. Same-Machine Web Directory Browser & Creator (POST /studio/fs/browse & POST /studio/fs/mkdir)
  const unauthBrowse = await fetch(`${srv.baseUrl}/studio/fs/browse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ dirPath: dir }),
  });
  assert.equal(unauthBrowse.status, 403);

  const browsed = await post('/studio/fs/browse', { dirPath: dir });
  assert.equal(browsed.status, 200);
  assert.equal(browsed.data.currentDir, path.resolve(dir));
  assert.equal(browsed.data.isProject, true);
  assert.ok(Array.isArray(browsed.data.directories));

  // Rejects UNC paths
  const uncRes = await post('/studio/fs/browse', { dirPath: '\\\\evil-server\\share' });
  assert.equal(uncRes.status, 400);

  // Create new subdirectory via /studio/fs/mkdir and verify it appears in /studio/fs/browse
  const made = await post('/studio/fs/mkdir', { parentDir: dir, name: 'Sub Project (v0.7)' });
  assert.equal(made.status, 200);
  assert.equal(made.data.createdDir, path.join(path.resolve(dir), 'Sub Project (v0.7)'));
  const browsedAfter = await post('/studio/fs/browse', { dirPath: dir });
  assert.ok(browsedAfter.data.directories.some(entry => entry.name === 'Sub Project (v0.7)'));

  // Rejects path traversal / invalid folder names
  assert.equal((await post('/studio/fs/mkdir', { parentDir: dir, name: '../escape' })).status, 400);
  assert.equal((await post('/studio/fs/mkdir', { parentDir: dir, name: '..' })).status, 400);

  // 4. Loopback HTTP Blender Dual-Channel routes (/studio/editor/channel, gui-checkout, gui-checkin, gui-abort) & /studio/render/list
  const importedRev = await post('/studio/editor/run', {
    operation: 'import_material_scene',
    params: { materialId: bodyMat.id },
  });
  assert.equal(importedRev.status, 200);
  const revId = importedRev.data.revisionId;

  const setChan = await post('/studio/editor/channel', { channelPreference: 'plugin', expectedRevision: await rev(dir) });
  assert.equal(setChan.status, 200);
  assert.equal(setChan.data.channelPreference, 'plugin');

  const httpOut = await post('/studio/editor/gui-checkout', { expectedRevisionId: revId, note: 'HTTP checkout' });
  assert.equal(httpOut.status, 200);
  const httpIn = await post('/studio/editor/gui-checkin', { checkoutId: httpOut.data.checkout.id, expectedRevisionId: revId });
  assert.equal(httpIn.status, 200);
  assert.equal(httpIn.data.channel, 'computer_use');

  const httpOut2 = await post('/studio/editor/gui-checkout', { expectedRevisionId: httpIn.data.revisionId });
  assert.equal(httpOut2.status, 200);
  const httpAbort = await post('/studio/editor/gui-abort', { checkoutId: httpOut2.data.checkout.id, expectedRevisionId: httpIn.data.revisionId });
  assert.equal(httpAbort.status, 200);
  assert.equal(httpAbort.data.aborted, true);

  const httpRenderList = await post('/studio/render/list', {});
  assert.equal(httpRenderList.status, 200);
  assert.equal(httpRenderList.data.activeRevisionId, httpIn.data.revisionId);
});

test('v0.7.0 new Agent tool actions: charakuru_project workflow actions and charakuru_generate_views preflight/profile actions', async t => {
  const dir = await tempProject(t);
  await initOrUpdateProject(dir, { characterPrompt: 'cyberpunk twin-tail' });
  const tools = buildStudioTools({ config: { registryFile: path.join(dir, 'recents.json') } });
  const projTool = tools.find(tool => tool.name === 'charakuru_project');
  const genTool = tools.find(tool => tool.name === 'charakuru_generate_views');

  const modeRes = await projTool.execute({ action: 'set_workflow_mode', projectDir: dir, workflowMode: 'base_mesh', expectedRevision: await rev(dir) });
  assert.equal(modeRes.ok, true);
  assert.equal(modeRes.workflow.mode, 'base_mesh');

  const bodyFile = path.join(dir, 'body_tool.blend');
  await fs.writeFile(bodyFile, BLEND_BYTES);
  const impRes = await projTool.execute({
    action: 'import_material',
    projectDir: dir,
    stageId: '4_assembly',
    role: 'foundation_body',
    sourcePath: bodyFile,
    expectedRevision: await rev(dir),
  });
  assert.equal(impRes.ok, true);

  const selRes = await projTool.execute({
    action: 'select_foundation',
    projectDir: dir,
    part: 'body',
    materialId: impRes.material.id,
    expectedRevision: await rev(dir),
  });
  assert.equal(selRes.ok, true);

  const planRes = await projTool.execute({
    action: 'plan_tripo_parts',
    projectDir: dir,
    kinds: ['clothing', 'hair'],
    budget: 50,
    quotedCredits: 40,
  });
  assert.equal(planRes.ok, true);
  assert.equal(planRes.tasks.length, 2);

  const preflightRes = await genTool.execute({
    action: 'preflight',
    projectDir: dir,
    modelId: 'comfyui-anima-local',
    imageMode: 'text_to_image',
  });
  assert.equal(preflightRes.ok, true);
  assert.equal(preflightRes.action, 'preflight');

  const saveProf = await genTool.execute({
    action: 'save_profile',
    projectDir: dir,
    modelId: 'comfyui-anima-local',
    profileAction: 'config',
    profileConfig: { parameters: { width: 512, height: 768, steps: 12 } },
    expectedRevision: await rev(dir),
  });
  assert.equal(saveProf.ok, true);

  const getProf = await genTool.execute({
    action: 'get_profile',
    projectDir: dir,
    modelId: 'comfyui-anima-local',
    slotId: 'head_front',
  });
  assert.equal(getProf.ok, true);
  assert.equal(getProf.profile.config.parameters.width, 512);
});

test('v0.7.0 loopback HTTP /studio/tripo/openapi and charakuru_tripo_quota OpenAPI v3 balance/submit/poll', async t => {
  const dir = await tempProject(t);
  await readyAssetProject(dir);
  const mockTripo = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const url = new URL(req.url, 'http://127.0.0.1');
    const json = payload => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(payload));
    };
    if (url.pathname === '/v3/account/balance') return json({ code: 0, data: { balance: 350 } });
    if (url.pathname === '/v3/files') return json({ code: 0, data: { file_token: 'tok_http_1' } });
    if (url.pathname === '/v3/generation/image-to-model') return json({ code: 0, data: { task_id: 'task_http_01' } });
    if (url.pathname === '/v3/tasks/task_http_01') {
      return json({
        code: 0,
        data: {
          status: 'success',
          progress: 100,
          credits_consumed: 25,
          output: { model: `http://127.0.0.1:${mockTripo.address().port}/download/head.glb` },
        },
      });
    }
    if (url.pathname === '/download/head.glb') {
      res.setHeader('content-type', 'model/gltf-binary');
      return res.end(triangleGlb());
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise((resolve, reject) => {
    mockTripo.once('error', reject);
    mockTripo.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => mockTripo.close(resolve)));
  const tripoApiUrl = `http://127.0.0.1:${mockTripo.address().port}/v3`;
  const fakeCreds = {
    async describeAll() { return [{ id: 'tripo', configured: true, source: 'fixture' }]; },
    async resolveSecret(id) { return id === 'tripo' ? 'tsk_http_fixture' : ''; },
    async resolveAllSecrets() { return { tripo: 'tsk_http_fixture' }; },
  };
  const { post } = await startStudioClient(
    t,
    dir,
    { allowCloudExecution: true, tripoApiUrl, blenderPluginUrl: 'http://127.0.0.1:1' },
    fakeCreds
  );

  const bal = await post('/studio/tripo/openapi', { action: 'balance' });
  assert.equal(bal.status, 200);
  assert.equal(bal.data.balance.balance, 350);

  const sub = await post('/studio/tripo/openapi', {
    action: 'submit',
    openapiAction: 'image_to_model',
    part: 'head',
    requestId: 'tripo_http_req01',
    expectedRevision: await rev(dir),
    cloudConfirmed: true,
    options: { quotedCost: 25 },
  });
  assert.equal(sub.status, 200);
  assert.equal(sub.data.taskId, 'task_http_01');

  const polled = await post('/studio/tripo/openapi', {
    action: 'poll',
    taskId: 'task_http_01',
    requestId: 'tripo_http_req01',
  });
  assert.equal(polled.status, 200);
  assert.equal(polled.data.verdict, 'pass');
  assert.equal(polled.data.candidate.channel, 'openapi_v3');

  // Agent tool openapi_balance works read-only
  const tools = buildStudioTools({
    config: { tripoApiUrl, budgetDir: path.join(dir, 'budget') },
    credentialManager: fakeCreds,
  });
  const tripoTool = tools.find(tool => tool.name === 'charakuru_tripo_quota');
  const toolBal = await tripoTool.execute({ action: 'openapi_balance', projectDir: dir });
  assert.equal(toolBal.ok, true);
  assert.equal(toolBal.balance.balance, 350);
  // Agent tool openapi_submit blocked by default when allowCloudExecution is false
  const toolBlocked = await tripoTool.execute({
    action: 'openapi_submit',
    projectDir: dir,
    requestId: 'tripo_tool_blocked',
    expectedRevision: await rev(dir),
    cloudConfirmed: true,
  });
  assert.equal(toolBlocked.ok, false);
  assert.match(toolBlocked.error.message, /CLOUD_EXECUTION_DISABLED/);
});
