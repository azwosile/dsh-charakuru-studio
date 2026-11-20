import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tempProject, png, triangleGlb } from './fixtures.mjs';
import { PLUGIN_VERSION } from '../lib/constants.js';
import { initOrUpdateProject, loadProjectState, updateProjectState } from '../lib/project/state.js';
import { importStudioAsset } from '../lib/project/assets.js';
import { importProjectMaterial } from '../lib/project/materials.js';
import { runEditorOperation } from '../lib/project/editor.js';
import { createRenderRequest, runRender } from '../lib/project/render.js';
import { reviewReadiness } from '../lib/project/reviews.js';
import { queryModelCatalog } from '../lib/catalog/aa-image-hub.js';
import { renderQwenRecipe, buildQwenComfyRecipe, inspectQwenRecipe } from '../lib/providers/comfy-qwen.js';
import { createAccountBudget } from '../lib/providers/account-budget.js';
import { submitTripoOpenApiTask } from '../lib/tripo/openapi-client.js';
import { collectCompanionJob } from '../lib/blender/transport.js';
import {
  generateStage1SafeImportScript,
  generateStage2AssemblyRatioScript,
  generateStage3CleanRoomRigWeightsScript,
  generateStage4SkirtSpringPhysicsScript,
  generateStage5ClosedMeshExpressionsVrmScript,
} from '../lib/blender/cleanroom-scripts.js';
import { inspectVrmMetadata, patchVrmMetadata } from '../lib/vrm/metadata-patcher.js';
import { startStudioHttpServer } from '../lib/host/server.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BLEND_BYTES = Buffer.from('BLENDER-v500phase5-fixture');
const BASE_COMPANION = 'http://127.0.0.1:9877';
const CJK_RE = /[\u4e00-\u9fff]/;

function buildSyntheticVrm1({ meta = {}, binPayload = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), includeBin = true, extraChunks = [] } = {}) {
  const gltf = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }],
    scene: 0,
    nodes: [{}],
    extensionsUsed: ['VRMC_vrm'],
    extensions: {
      VRMC_vrm: {
        specVersion: '1.0',
        meta: {
          name: 'FixtureV0100',
          version: '1.0.0',
          authors: ['OriginalAuthor'],
          licenseUrl: 'https://vrm.dev/licenses/1.0/',
          avatarPermission: 'onlyAuthor',
          commercialUsage: 'personalNonProfit',
          creditNotation: 'required',
          allowRedistribution: false,
          modification: 'prohibited',
          ...meta,
        },
      },
    },
  };
  if (includeBin) {
    gltf.buffers = [{ byteLength: binPayload.length }];
    gltf.bufferViews = [{ buffer: 0, byteOffset: 0, byteLength: binPayload.length }];
    gltf.accessors = [{ bufferView: 0, componentType: 5126, count: 1, type: 'VEC3' }];
    gltf.meshes = [{ primitives: [{ attributes: { POSITION: 0 } }] }];
    gltf.nodes = [{ mesh: 0 }];
  }
  let jsonBuf = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  if (jsonPad > 0) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);

  const chunks = [{ type: 0x4e4f534a, payload: jsonBuf }];
  let paddedBin = null;
  if (includeBin) {
    const binPad = (4 - (binPayload.length % 4)) % 4;
    paddedBin = binPad > 0 ? Buffer.concat([binPayload, Buffer.alloc(binPad, 0x00)]) : Buffer.from(binPayload);
    chunks.push({ type: 0x004e4942, payload: paddedBin });
  }
  for (const extra of extraChunks) {
    chunks.push(extra);
  }

  const totalLen = 12 + chunks.reduce((sum, ch) => sum + 8 + ch.payload.length, 0);
  const out = Buffer.alloc(totalLen);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(totalLen, 8);
  let off = 12;
  for (const ch of chunks) {
    out.writeUInt32LE(ch.payload.length, off);
    out.writeUInt32LE(ch.type, off + 4);
    ch.payload.copy(out, off + 8);
    off += 8 + ch.payload.length;
  }
  return { bytes: out, binChunkPayload: paddedBin };
}

function mockCompanion() {
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname === '/health') return Response.json({ ok: true, stats: {}, lease: {}, provenance: {} });
    if (u.pathname === '/doctor') return Response.json({ kind: 'ok' });
    if (u.pathname !== '/headless') throw new Error(`Unexpected companion route: ${u.pathname}`);
    const body = JSON.parse(init.body);
    const scriptText = await fs.readFile(body.scriptFile, 'utf8');
    const command = JSON.parse(JSON.parse(scriptText.split('\n')[0].slice('COMMAND = '.length)));
    if (command.operation) {
      await fs.writeFile(command.outputs.blend, BLEND_BYTES);
      await fs.writeFile(command.outputs.preview, triangleGlb());
      await fs.writeFile(command.outputs.report, JSON.stringify({
        requestId: command.requestId,
        objects: [{ name: 'Body', type: 'MESH', vertices: 100 }],
        gates: { weights: true, textures: true },
        notes: [],
      }));
      return Response.json({ ok: true, result: { exitCode: 0, resultJson: { verdict: 'pass', requestId: command.requestId, outputs: command.outputs } } });
    }
    const [w, h] = command.pixels;
    await fs.writeFile(path.join(command.output, 'render.png'), png(w, h));
    await fs.writeFile(path.join(command.output, 'report.json'), JSON.stringify({
      requestId: command.requestId,
      revisionId: command.revisionId,
      blendHash: command.blendHash,
      recipe: command.recipe,
      blenderVersion: '5.0.0',
      engine: 'BLENDER_EEVEE',
      meshes: 1,
      notes: [],
    }));
    return Response.json({ ok: true, result: { exitCode: 0, resultJson: { verdict: 'pass', requestId: command.requestId } } });
  };
  return { fetchImpl };
}

test('v0.10.0 package metadata and locale files align with 0.10.0 and keep locale/en.json free of CJK', async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '0.10.0');
  assert.equal(PLUGIN_VERSION, '0.10.0');

  const enRaw = await fs.readFile(path.join(ROOT, 'locale/en.json'), 'utf8');
  const zhRaw = await fs.readFile(path.join(ROOT, 'locale/zh.json'), 'utf8');
  assert.equal(CJK_RE.test(enRaw), false, 'locale/en.json must not contain CJK');
  assert.match(JSON.parse(enRaw).meta.description, /0\.10\.0/);
  assert.match(JSON.parse(zhRaw).meta.description, /0\.10\.0/);
});

test('v0.10.0 Python AST and symtable report 0 undefined globals across all 3 .py files and 5 cleanroom stage scripts', () => {
  const opts = {
    headGlbPath: 'C:/tmp/head.glb',
    bodyGlbPath: 'C:/tmp/body.glb',
    inputBlendPath: 'C:/tmp/in.blend',
    existingBlendPath: 'C:/tmp/in.blend',
    outputBlendPath: 'C:/tmp/out.blend',
    outputVrmPath: 'C:/tmp/out.vrm',
  };
  const payload = [
    { name: 'studio-pipeline.py', path: path.join(ROOT, 'lib/blender/studio-pipeline.py') },
    { name: 'render-studio.py', path: path.join(ROOT, 'lib/blender/render-studio.py') },
    { name: 'inspect-foundation.py', path: path.join(ROOT, 'lib/blender/inspect-foundation.py') },
    { name: 'stage1_safe_import.py', src: generateStage1SafeImportScript(opts) },
    { name: 'stage2_assembly_ratio.py', src: generateStage2AssemblyRatioScript(opts) },
    { name: 'stage3_rig_weights.py', src: generateStage3CleanRoomRigWeightsScript(opts) },
    { name: 'stage4_skirt_springs.py', src: generateStage4SkirtSpringPhysicsScript(opts) },
    { name: 'stage5_expressions_vrm.py', src: generateStage5ClosedMeshExpressionsVrmScript(opts) },
  ];

  const python = process.env.DSH_CHECK_PYTHON || process.env.DSH_PYTHON_EXECUTABLE || 'python';
  const pyRes = spawnSync(
    python,
    [
      '-c',
      `
import ast, builtins, json, pathlib, symtable, sys
items = json.loads(sys.stdin.read())
known = set(dir(builtins)) | {'COMMAND', '__name__', '__file__'}
def walk_st(table, scope_vars):
    local = set(scope_vars) | {
        s.get_name() for s in table.get_symbols()
        if s.is_local() or s.is_parameter() or s.is_assigned() or s.is_imported() or s.is_declared_global()
    }
    undef = []
    for s in table.get_symbols():
        if s.is_referenced() and not (
            s.is_local() or s.is_parameter() or s.is_assigned() or s.is_imported()
            or s.is_declared_global() or s.is_free() or s.get_name() in local or s.get_name() in known
        ):
            undef.append((table.get_name(), s.get_name()))
    for child in table.get_children():
        undef.extend(walk_st(child, local))
    return undef

for item in items:
    src = pathlib.Path(item['path']).read_text(encoding='utf-8') if 'path' in item else item['src']
    ast.parse(src, filename=item['name'])
    st = symtable.symtable(src, item['name'], 'exec')
    undef = walk_st(st, set())
    assert not undef, f"{item['name']} has undefined globals: {undef}"
print("ALL_8_PY_AST_SYMTABLE_OK")
`,
    ],
    { encoding: 'utf8', input: JSON.stringify(payload), timeout: 30000 }
  );
  assert.equal(pyRes.status, 0, `Python AST/symtable failed: ${pyRes.error?.message || pyRes.stderr}`);
  assert.match(pyRes.stdout, /ALL_8_PY_AST_SYMTABLE_OK/);
});

test('v0.10.0 static compatibility contracts hold for studio-pipeline.py, render-studio.py, and cleanroom-scripts.js', async () => {
  const [pipelinePy, renderPy, cleanroomJs] = await Promise.all([
    fs.readFile(path.join(ROOT, 'lib/blender/studio-pipeline.py'), 'utf8'),
    fs.readFile(path.join(ROOT, 'lib/blender/render-studio.py'), 'utf8'),
    fs.readFile(path.join(ROOT, 'lib/blender/cleanroom-scripts.js'), 'utf8'),
  ]);

  // studio-pipeline.py contracts
  for (const line of pipelinePy.split('\n')) {
    if (line.includes('in arm.data.bones')) {
      assert.doesNotMatch(line, /^\s*if\s+(hips_name|head_b)\s+in\s+arm\.data\.bones\s*:/, `Unguarded bone check: ${line.trim()}`);
    }
  }
  assert.match(pipelinePy, /isinstance\(hips_name,\s*str\)\s+and\s+hips_name\s+and\s+hips_name\s+in\s+arm\.data\.bones/);
  assert.match(pipelinePy, /isinstance\(head_b,\s*str\)\s+and\s+head_b\s+and\s+head_b\s+in\s+arm\.data\.bones/);

  const smartUvSlice = pipelinePy.slice(pipelinePy.indexOf('def _smart_uv_project_object'));
  const smartUvEnd = smartUvSlice.indexOf('\ndef ', 10);
  const smartUvFn = smartUvEnd > 0 ? smartUvSlice.slice(0, smartUvEnd) : smartUvSlice;
  assert.match(smartUvFn, /hide_viewport/);
  assert.match(smartUvFn, /temp_override/);

  assert.match(pipelinePy, /def _clear_shape_keys\(/);
  assert.match(pipelinePy, /_clear_shape_keys\(cage\)/);
  assert.match(pipelinePy, /n\.type\s*==\s*'BSDF_PRINCIPLED'/);
  assert.doesNotMatch(pipelinePy, /nodes\.get\(['"]Principled BSDF['"]\)/);
  assert.match(pipelinePy, /def _set_enum_safely\(/);

  // render-studio.py contracts
  assert.match(renderPy, /ShaderNodeNewGeometry/);
  assert.match(renderPy, /Backfacing/);
  assert.match(renderPy, /ShaderNodeBsdfTransparent/);
  assert.match(renderPy, /len\(obj\.material_slots\)\s*-\s*1/);
  assert.match(renderPy, /px_height\s*>\s*0/);
  assert.match(renderPy, /ext\.vrm0/);
  assert.match(renderPy, /n\.type\s*==\s*'BSDF_PRINCIPLED'/);

  // cleanroom-scripts.js contracts
  const opts = { inputBlendPath: 'C:/tmp/in.blend', existingBlendPath: 'C:/tmp/in.blend', headGlbPath: 'C:/tmp/h.glb', bodyGlbPath: 'C:/tmp/b.glb', outputBlendPath: 'C:/tmp/out.blend', outputVrmPath: 'C:/tmp/out.vrm' };
  const stages = [
    generateStage1SafeImportScript(opts),
    generateStage2AssemblyRatioScript(opts),
    generateStage3CleanRoomRigWeightsScript(opts),
    generateStage4SkirtSpringPhysicsScript(opts),
    generateStage5ClosedMeshExpressionsVrmScript(opts),
  ];
  for (const [idx, s] of stages.entries()) {
    if (s.includes('open_mainfile(')) {
      assert.match(s, /load_ui=False,\s*use_scripts=False/, `Stage ${idx + 1} open_mainfile must pass load_ui=False, use_scripts=False`);
    }
  }
  assert.match(cleanroomJs, /os\.path\.dirname\(os\.path\.abspath\(/);
  assert.match(cleanroomJs, /def ensure_parent_dir\(/);
});

test('v0.10.0 metadata-patcher.js handles multi-byte UTF-8 alignment, no-BIN GLB, extraChunks, and strict rejections', () => {
  for (const suffix of ['', 'a', 'ab', 'abc']) {
    const title = `テスト桜🌸角色${suffix}`;
    const authors = ['作者太郎', '絵師✨'];
    const { bytes: origBytes, binChunkPayload } = buildSyntheticVrm1();
    const patched = patchVrmMetadata(origBytes, {
      title,
      version: '1.2.3-β',
      authors,
      copyrightInformation: '©2026 测试版权',
      thirdPartyLicenses: 'MIT / 许可',
    });
    const jsonLen = patched.bytes.readUInt32LE(12);
    assert.equal(jsonLen % 4, 0);
    const jsonSlice = patched.bytes.subarray(20, 20 + jsonLen);
    const parsedJson = JSON.parse(jsonSlice.toString('utf8').replace(/\x20+$/, ''));
    assert.equal(parsedJson.extensions.VRMC_vrm.meta.name, title);
    const padCount = jsonLen - Buffer.from(JSON.stringify(parsedJson), 'utf8').length;
    for (let i = jsonLen - padCount; i < jsonLen; i += 1) {
      assert.equal(jsonSlice[i], 0x20, 'JSON padding must be ASCII 0x20 space');
    }

    const binOff = 20 + jsonLen;
    const binLen = patched.bytes.readUInt32LE(binOff);
    assert.equal(patched.bytes.readUInt32LE(binOff + 4), 0x004e4942);
    assert.equal(Buffer.compare(patched.bytes.subarray(binOff + 8, binOff + 8 + binLen), binChunkPayload), 0);

    const reinspected = inspectVrmMetadata(patched.bytes);
    assert.equal(reinspected.meta.name, title);
    assert.deepEqual(reinspected.meta.authors, authors);
  }

  // GLB without BIN chunk
  const { bytes: noBinGlb } = buildSyntheticVrm1({ includeBin: false });
  const inspNoBin = inspectVrmMetadata(noBinGlb);
  assert.equal(inspNoBin.binByteLength, 0);
  const patchedNoBin = patchVrmMetadata(noBinGlb, { title: 'NoBinHero' });
  assert.equal(inspectVrmMetadata(patchedNoBin.bytes).binByteLength, 0);
  assert.equal(inspectVrmMetadata(patchedNoBin.bytes).meta.name, 'NoBinHero');

  // Preserve extraChunks verbatim
  const extraPayload = Buffer.from('CUSTOM_CHUNK_DATA_123456'); // 24 bytes (% 4 == 0)
  const extraType = 0x54534554; // 'TEST'
  const { bytes: withExtra } = buildSyntheticVrm1({ extraChunks: [{ type: extraType, payload: extraPayload }] });
  const patchedExtra = patchVrmMetadata(withExtra, { title: 'ExtraHero' });
  const jLen = patchedExtra.bytes.readUInt32LE(12);
  const bOff = 20 + jLen;
  const bLen = patchedExtra.bytes.readUInt32LE(bOff);
  const eOff = bOff + 8 + bLen;
  assert.equal(patchedExtra.bytes.readUInt32LE(eOff), extraPayload.length);
  assert.equal(patchedExtra.bytes.readUInt32LE(eOff + 4), extraType);
  assert.equal(Buffer.compare(patchedExtra.bytes.subarray(eOff + 8, eOff + 8 + extraPayload.length), extraPayload), 0);

  // Control characters, over-length strings, and specVersion !== '1.0'
  assert.throws(() => patchVrmMetadata(noBinGlb, { title: 'bad\x01title' }), /control characters/);
  assert.throws(() => patchVrmMetadata(noBinGlb, { authors: ['bad\nauthor'] }), /control characters/);
  assert.throws(() => patchVrmMetadata(noBinGlb, { title: 'x'.repeat(257) }), /between 1 and 256/);
  assert.throws(() => patchVrmMetadata(noBinGlb, { version: 'v'.repeat(129) }), /between 1 and 128/);

  // Non-1.0 VRMC_vrm specVersion rejection
  const gltf0 = { asset: { version: '2.0' }, extensions: { VRMC_vrm: { specVersion: '0.0', meta: { name: 'x' } } } };
  let j0 = Buffer.from(JSON.stringify(gltf0), 'utf8');
  j0 = Buffer.concat([j0, Buffer.alloc((4 - (j0.length % 4)) % 4, 0x20)]);
  const badSpec = Buffer.alloc(20 + j0.length);
  badSpec.writeUInt32LE(0x46546c67, 0);
  badSpec.writeUInt32LE(2, 4);
  badSpec.writeUInt32LE(badSpec.length, 8);
  badSpec.writeUInt32LE(j0.length, 12);
  badSpec.writeUInt32LE(0x4e4f534a, 16);
  j0.copy(badSpec, 20);
  assert.throws(() => inspectVrmMetadata(badSpec), /specVersion === "1\.0"/);
});

test('v0.10.0 comfy-qwen.js renderQwenRecipe routes resolution only to TextEncodeQwenImage21 and strips it from KSampler', () => {
  const workflow = buildQwenComfyRecipe();
  const recipe = { workflow, ...inspectQwenRecipe(workflow) };
  const graph = renderQwenRecipe(
    recipe,
    { slotId: 'head_front', positivePrompt: '1girl, front view', negativePrompt: 'blurry' },
    'ref_input.png',
    { resolution: 1280, seed: 77, steps: 20 }
  );

  assert.equal(graph[recipe.encodeId].inputs.resolution, 1280);
  assert.equal(Object.hasOwn(graph[recipe.sampleId].inputs, 'resolution'), false);
  assert.equal(graph[recipe.sampleId].inputs.seed, 77);
  assert.equal(graph[recipe.sampleId].inputs.steps, 20);
});

test('v0.10.0 tripo/openapi-client.js blocks reusing failed or cancelled requestId before any fetch call', async t => {
  const dir = await tempProject(t);
  await initOrUpdateProject(dir, { projectName: 'TripoTermTest' });
  const pngPath = path.join(dir, 'head.png');
  await fs.writeFile(pngPath, png(8, 8));
  const mat = (await importProjectMaterial({
    projectDir: dir,
    stageId: '2_views',
    role: 'turnaround',
    slotId: 'head_front',
    sourcePath: pngPath,
    expectedRevision: (await loadProjectState(dir)).state.stateRevision,
  })).material;

  const budget = createAccountBudget(path.join(dir, 'budget'));
  let fetchCalls = 0;
  const countingFetch = async () => {
    fetchCalls += 1;
    throw new Error('fetch must not be called for terminal requestId');
  };

  // Case 1: existingTask in project state reached terminal failed state
  await updateProjectState(dir, state => {
    state.tripoQuota ||= {};
    state.tripoQuota.openapiTasks ||= [];
    state.tripoQuota.openapiTasks.push({
      requestId: 'req-terminal-failed',
      status: 'failed',
      taskId: 'task-old-1',
    });
  });

  await assert.rejects(
    submitTripoOpenApiTask({
      projectDir: dir,
      action: 'image_to_model',
      part: 'head',
      referenceMaterialIds: [mat.id],
      requestId: 'req-terminal-failed',
      expectedRevision: (await loadProjectState(dir)).state.stateRevision,
      allowCloudExecution: true,
      cloudConfirmed: true,
      apiKey: 'test-tripo-key',
      budget,
      fetchImpl: countingFetch,
    }),
    /terminal state \(failed\)/
  );
  assert.equal(fetchCalls, 0);

  // Case 2: ledger reservation transitioned to cancelled on an earlier 400 rejection
  const cancelArgs = {
    projectDir: dir,
    action: 'image_to_model',
    part: 'head',
    referenceMaterialIds: [mat.id],
    requestId: 'req-ledger-cancelled',
    expectedRevision: (await loadProjectState(dir)).state.stateRevision,
    allowCloudExecution: true,
    cloudConfirmed: true,
    apiKey: 'test-tripo-key',
    budget,
  };
  await assert.rejects(
    submitTripoOpenApiTask({
      ...cancelArgs,
      fetchImpl: async () => Response.json({ message: 'rejected by mock upstream' }, { status: 400 }),
    }),
    /rejected by mock upstream/
  );

  await assert.rejects(
    submitTripoOpenApiTask({
      ...cancelArgs,
      fetchImpl: countingFetch,
    }),
    /already closed \(cancelled\)/
  );
  assert.equal(fetchCalls, 0);
});

test('v0.10.0 blender/transport.js collectCompanionJob allows same caller with different key order', async () => {
  const pending = {
    protocol: 'gateway-3.1',
    baseUrl: 'http://127.0.0.1:39877',
    jobId: 'job-order-1',
    caller: { hostId: 'h1', dshSessionId: 's1', agentId: 'a1', role: 'main', parentAgentId: null },
  };
  const reorderedCaller = { role: 'main', agentId: 'a1', dshSessionId: 's1', hostId: 'h1' };

  const res = await collectCompanionJob(pending, {
    caller: reorderedCaller,
    fetchImpl: async () => Response.json({
      job: { state: 'completed', result: { exitCode: 0, parsed: { verdict: 'pass' } }, logs: { stdout: 'ok' } },
    }),
  });
  assert.equal(res.pending, false);
  assert.equal(res.receipt.exitCode, 0);
  assert.deepEqual(res.receipt.resultJson, { verdict: 'pass' });

  await assert.rejects(
    collectCompanionJob(pending, {
      caller: { ...reorderedCaller, agentId: 'a2' },
      fetchImpl: async () => Response.json({}),
    }),
    /Only the submitting DSH caller/
  );
});

test('v0.10.0 catalog seedream-5.5 nameEn and reviews.js reasonEn emit zero CJK', async t => {
  const seedream = queryModelCatalog().models.find(m => m.id === 'seedream-5.5');
  assert.ok(seedream);
  assert.equal(typeof seedream.nameEn, 'string');
  assert.ok(seedream.nameEn.trim().length > 0);
  assert.equal(CJK_RE.test(seedream.nameEn), false, `seedream-5.5 nameEn leaked CJK: ${seedream.nameEn}`);

  const dir = await tempProject(t);
  await initOrUpdateProject(dir, { projectName: 'ReviewEnTest', characterPrompt: '' });
  let state = (await loadProjectState(dir)).state;
  const r1 = await reviewReadiness(dir, state);
  assert.equal(r1.ready, false);
  assert.equal(typeof r1.reasonEn, 'string');
  assert.ok(r1.reasonEn.trim().length > 0);
  assert.equal(CJK_RE.test(r1.reasonEn), false, `Stage 1 reasonEn leaked CJK: ${r1.reasonEn}`);

  await initOrUpdateProject(dir, { characterPrompt: 'A valid character prompt' });
  state = (await loadProjectState(dir)).state;
  state.activeStageId = '2_views';
  state.stages['1_concept'].status = 'completed';
  state.stages['1_concept'].approvedEvidence = { fingerprint: 'bad' };
  const r2 = await reviewReadiness(dir, state);
  assert.equal(r2.ready, false);
  assert.ok(r2.reasonEn.trim().length > 0);
  assert.equal(CJK_RE.test(r2.reasonEn), false, `Upstream mismatch reasonEn leaked CJK: ${r2.reasonEn}`);
});

test('v0.10.0 host/server.js enforces Host validation, Referrer-Policy on all 5 binary endpoints, 413 JSON limit, octet-stream charset, and mkdir reserved names', async t => {
  const dir = await tempProject(t);
  const projectDir = path.join(dir, 'proj');
  await initOrUpdateProject(projectDir, { projectName: 'SecTest' });

  const srv = await startStudioHttpServer({
    port: 0,
    config: { registryFile: path.join(dir, 'recent.json'), budgetDir: path.join(dir, 'budget') },
  });
  t.after(() => srv.close());

  const { sessionToken } = await (await fetch(`${srv.baseUrl}/studio/session`)).json();

  // 1. Invalid and malformed Host headers -> 403
  for (const badHost of [`evil.example:${srv.port}`, '127.0.0.1:bad:port']) {
    const status = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: srv.port,
        path: '/health',
        method: 'GET',
        headers: { Host: badHost },
      }, res => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 403, `Expected 403 for Host=${badHost}`);
  }

  // 2. Prepare artifacts for all 5 binary download endpoints and verify Referrer-Policy: no-referrer
  const samplePng = png(4, 4);
  const pngPath = path.join(dir, 'sample.png');
  const blendPath = path.join(dir, 'sample.blend');
  await fs.writeFile(pngPath, samplePng);
  await fs.writeFile(blendPath, BLEND_BYTES);

  const assetRes = await importStudioAsset({ projectDir, kind: 'image', slotId: 'source', sourcePath: pngPath });
  const matRes = await importProjectMaterial({
    projectDir,
    stageId: '4_assembly',
    role: 'base_color',
    sourcePath: pngPath,
    expectedRevision: (await loadProjectState(projectDir)).state.stateRevision,
  });
  const { fetchImpl } = mockCompanion();
  const edRes = await runEditorOperation({
    projectDir,
    operation: 'import_blend',
    params: { sourceBlend: blendPath },
    blenderPluginUrl: BASE_COMPANION,
    fetchImpl,
  });
  const renderReq = await createRenderRequest({
    projectDir,
    brief: 'Referrer policy test',
    expectedRevisionId: edRes.revisionId,
  });
  await runRender({
    projectDir,
    requestId: renderReq.request.id,
    expectedRevisionId: edRes.revisionId,
    recipe: { preset: 'neutral_check', camera: 'front', framing: 'full', size: 'draft' },
    blenderPluginUrl: BASE_COMPANION,
    fetchImpl,
  });

  const binaryUrls = [
    `${srv.baseUrl}/studio/motions/builtin?access=${encodeURIComponent(sessionToken)}`,
    `${srv.baseUrl}/studio/assets/content?${new URLSearchParams({ projectDir, id: assetRes.asset.id, access: sessionToken })}`,
    `${srv.baseUrl}/studio/materials/content?${new URLSearchParams({ projectDir, id: matRes.material.id, access: sessionToken })}`,
    `${srv.baseUrl}/studio/editor/content?${new URLSearchParams({ projectDir, revisionId: edRes.revisionId, kind: 'preview', access: sessionToken })}`,
    `${srv.baseUrl}/studio/render/content?${new URLSearchParams({ projectDir, requestId: renderReq.request.id, kind: 'png', access: sessionToken })}`,
  ];
  for (const endpoint of binaryUrls) {
    const res = await fetch(endpoint);
    assert.equal(res.status, 200, `Expected 200 from ${endpoint}`);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer', `Missing Referrer-Policy on ${endpoint}`);
    await res.arrayBuffer();
  }

  // 3. Oversized JSON body (> 2 MiB) -> 413
  const bigBody = JSON.stringify({ projectDir, projectName: 'A'.repeat(2 * 1024 * 1024 + 1024) });
  const bigRes = await fetch(`${srv.baseUrl}/studio/project/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Charakuru-Session': sessionToken },
    body: bigBody,
  });
  assert.equal(bigRes.status, 413);

  // 4. application/octet-stream; charset=binary accepted by /studio/materials/upload
  const revNow = (await loadProjectState(projectDir)).state.stateRevision;
  const uploadUrl = `${srv.baseUrl}/studio/materials/upload?${new URLSearchParams({
    projectDir,
    stageId: '1_concept',
    role: 'original',
    fileName: 'charset_upload.png',
    expectedRevision: String(revNow),
  })}`;
  const upRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream; charset=binary',
      'X-Charakuru-Session': sessionToken,
    },
    body: samplePng,
  });
  assert.equal(upRes.status, 200);
  assert.equal((await upRes.json()).ok, true);

  // 5. /studio/fs/mkdir rejects Windows reserved device names and trailing dots
  for (const badName of ['CON', 'con.txt', 'LPT1', 'bad.']) {
    const mkRes = await fetch(`${srv.baseUrl}/studio/fs/mkdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Charakuru-Session': sessionToken },
      body: JSON.stringify({ parentDir: dir, name: badName }),
    });
    assert.equal(mkRes.status, 400, `Expected 400 for mkdir name="${badName}"`);
  }
});
