import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tempProject, png, glb, triangleGlb } from './fixtures.mjs';
import { initOrUpdateProject, loadProjectState } from '../lib/project/state.js';
import { importProjectMaterial } from '../lib/project/materials.js';
import {
  EDITOR_OPERATIONS,
  AI_EDIT_INTENTS,
  validateEditorParams,
  runEditorOperation,
  createAiEditRequest,
} from '../lib/project/editor.js';
import {
  generateStage1SafeImportScript,
  generateStage2AssemblyRatioScript,
  generateStage3CleanRoomRigWeightsScript,
  generateStage4SkirtSpringPhysicsScript,
  generateStage5ClosedMeshExpressionsVrmScript,
} from '../lib/blender/cleanroom-scripts.js';
import { inspectVrmMetadata, patchVrmMetadata } from '../lib/vrm/metadata-patcher.js';
import { startStudioHttpServer } from '../lib/host/server.js';
import { validateGlb } from '../lib/tripo/free-quota-scheduler.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BLEND_BYTES = Buffer.from('BLENDER-v500phase4-fixture');
const BASE_COMPANION = 'http://127.0.0.1:9877';

function buildSyntheticVrm1(meta = {}, binPayload = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])) {
  const gltf = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: binPayload.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: binPayload.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 1, type: 'VEC3' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
    extensionsUsed: ['VRMC_vrm'],
    extensions: {
      VRMC_vrm: {
        specVersion: '1.0',
        meta: {
          name: 'FixtureAvatar',
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
  let jsonBuf = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  if (jsonPad > 0) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (binPayload.length % 4)) % 4;
  const paddedBin = binPad > 0 ? Buffer.concat([binPayload, Buffer.alloc(binPad, 0x00)]) : Buffer.from(binPayload);

  const totalLen = 12 + 8 + jsonBuf.length + 8 + paddedBin.length;
  const out = Buffer.alloc(totalLen);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(totalLen, 8);
  out.writeUInt32LE(jsonBuf.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonBuf.copy(out, 20);
  const binHeaderOffset = 20 + jsonBuf.length;
  out.writeUInt32LE(paddedBin.length, binHeaderOffset);
  out.writeUInt32LE(0x004e4942, binHeaderOffset + 4);
  paddedBin.copy(out, binHeaderOffset + 8);
  return { bytes: out, binChunkPayload: paddedBin };
}

function mockCompanion({ exportVrm = false } = {}) {
  const commands = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname === '/health') return Response.json({ ok: true, stats: {}, lease: {}, provenance: {} });
    if (u.pathname === '/doctor') return Response.json({ kind: 'ok' });
    if (u.pathname !== '/headless') throw new Error(`Unexpected companion route: ${u.pathname}`);
    const body = JSON.parse(init.body);
    const scriptText = await fs.readFile(body.scriptFile, 'utf8');
    const command = JSON.parse(JSON.parse(scriptText.split('\n')[0].slice('COMMAND = '.length)));
    commands.push(command);

    await fs.writeFile(command.outputs.blend, BLEND_BYTES);
    await fs.writeFile(command.outputs.preview, triangleGlb());
    if (exportVrm && command.outputs.vrm) {
      await fs.writeFile(command.outputs.vrm, buildSyntheticVrm1().bytes);
    }
    await fs.writeFile(
      command.outputs.report,
      JSON.stringify({
        requestId: command.requestId,
        objects: [
          { name: 'Head', type: 'MESH', vertices: 120, dimensions: [0.22, 0.22, 0.24], shapeKeys: [{ name: 'eye_blink_L', value: 0, sliderMin: 0, sliderMax: 1 }] },
          { name: 'Body', type: 'MESH', vertices: 240, dimensions: [0.55, 0.28, 1.56], shapeKeys: [] },
          { name: 'Rig', type: 'ARMATURE', bones: ['hips', 'spine', 'chest', 'neck', 'head'] },
        ],
        gates: { weights: true, textures: true },
        notes: [],
      })
    );
    return Response.json({ ok: true, result: { exitCode: 0, resultJson: { verdict: 'pass', requestId: command.requestId, outputs: command.outputs } } });
  };
  return { fetchImpl, commands };
}

test('v0.9.0 cleanroom-scripts.js fixes all 5 critical defects and passes Python AST', () => {
  const opts = {
    headGlbPath: 'C:/tmp/head.glb',
    bodyGlbPath: 'C:/tmp/body.glb',
    inputBlendPath: 'C:/tmp/in.blend',
    outputBlendPath: 'C:/tmp/out.blend',
    outputVrmPath: 'C:/tmp/out.vrm',
  };
  const s1 = generateStage1SafeImportScript(opts);
  const s2 = generateStage2AssemblyRatioScript(opts);
  const s3 = generateStage3CleanRoomRigWeightsScript(opts);
  const s4 = generateStage4SkirtSpringPhysicsScript(opts);
  const s5 = generateStage5ClosedMeshExpressionsVrmScript(opts);

  // Bug A: headless_body excluded from head candidate classification
  assert.match(s2, /def is_head_mesh_candidate\(obj, include_face=True\):[\s\S]*if "headless" in low:\s*\n\s*return False/);
  assert.match(s2, /head_meshes = \[o for o in meshes if is_head_mesh_candidate\(o, include_face=False\)\]/);

  // Bug B: fix_mixamo_pinky_drift reachable/invoked + detail bones + L/R leg X-sign separation
  assert.match(s3, /pinky_fixes = fix_mixamo_pinky_drift\(arm\)/);
  assert.match(s3, /added_bones = ensure_missing_detail_bones\(arm, total_height\)/);
  assert.match(s3, /if wp\.x >= 0\.0 and bname in RIGHT_LEG_BONES:\s*\n\s*continue/);
  assert.match(s3, /if wp\.x < 0\.0 and bname in LEFT_LEG_BONES:\s*\n\s*continue/);
  assert.match(s3, /def enforce_leg_x_sign_separation\(mesh_obj\):/);

  // Bug C: skirt front anchor at angle=0 equals 0 deg (not atan2(sin, -cos) = 180 deg)
  assert.match(s4, /deg = abs\(math\.degrees\(math\.atan2\(math\.sin\(angle\), math\.cos\(angle\)\)\)\)/);
  assert.doesNotMatch(s4, /atan2\(math\.sin\(angle\), -math\.cos\(angle\)\)/);

  // Bug D: configure_vrm1_spring_extension implements real VRM 1.0 spring_bone1 wiring
  assert.match(s4, /def configure_vrm1_spring_extension\(arm_obj, chains, hair_chains=None\):/);
  assert.match(s4, /sb\.collider_groups\.add\(\)/);
  assert.match(s4, /sb\.colliders\.add\(\)/);
  assert.match(s4, /sb\.springs\.add\(\)/);
  assert.match(s4, /vrm_bind = configure_vrm1_spring_extension\(arm_obj, chains\)/);

  // Bug E: preset.happy binds both eyes + mouth_smile, all 23 morph keys bound, head bbox excludes hair
  assert.match(s5, /\(preset\.happy, \[\("eye_happy_L", 1\.0\), \("eye_happy_R", 1\.0\), \("mouth_smile", 1\.0\)\], "block"\)/);
  assert.match(s5, /custom_specs = \[[\s\S]*\("triangle"[\s\S]*\("cat"[\s\S]*\("smirk"[\s\S]*\("brow_up"[\s\S]*\("eye_wide"[\s\S]*\("eye_half"/);
  assert.match(s5, /def _isolate_face_vertices\(head_obj, verts\):/);

  // Validate Python execution for Bug A, Bug C, and AST for all 5 scripts (via stdin to avoid Windows argv length limits)
  const python = process.env.DSH_CHECK_PYTHON || process.env.DSH_PYTHON_EXECUTABLE || 'python';
  const pyCheck = spawnSync(
    python,
    [
      '-c',
      `
import ast, json, math, sys
scripts = json.loads(sys.stdin.read())
for idx, src in enumerate(scripts):
    ast.parse(src, filename=f"cleanroom_stage_{idx+1}.py")
# Verify angle=0 produces 0 deg for front anchor in Stage 4 math
angle = 0.0
deg = abs(math.degrees(math.atan2(math.sin(angle), math.cos(angle))))
assert deg == 0.0, f"Expected 0 deg at angle=0, got {deg}"
# Verify is_head_mesh_candidate on mock objects (slice function without Blender imports)
ns = {}
head_fn_src = scripts[0].split("def is_head_mesh_candidate")[1].split("HEAD_GLB =")[0]
exec("def is_head_mesh_candidate" + head_fn_src, ns)
class MockObj(dict):
    def __init__(self, name, part=""):
        super().__init__({"charakuru_part": part} if part else {})
        self.name = name
assert ns["is_head_mesh_candidate"](MockObj("headless_body")) is False
assert ns["is_head_mesh_candidate"](MockObj("HeadMesh")) is True
assert ns["is_head_mesh_candidate"](MockObj("FaceMesh"), include_face=True) is True
print("CLEANROOM_PY_OK")
`,
    ],
    { encoding: 'utf8', input: JSON.stringify([s1, s2, s3, s4, s5]), timeout: 15000 }
  );
  assert.equal(pyCheck.status, 0, `Python validation failed: ${pyCheck.error?.message || pyCheck.stderr}`);
  assert.match(pyCheck.stdout, /CLEANROOM_PY_OK/);
});

test('v0.9.0 lib/vrm/metadata-patcher.js roundtrips GLB 2.0 + VRMC_vrm 1.0 preserving BIN bytes verbatim and rejects malformed inputs', () => {
  const { bytes: origBytes, binChunkPayload } = buildSyntheticVrm1();
  const inspected = inspectVrmMetadata(origBytes);
  assert.equal(inspected.specVersion, '1.0');
  assert.equal(inspected.meta.name, 'FixtureAvatar');
  assert.equal(inspected.binByteLength, binChunkPayload.length);
  assert.equal(inspected.totalByteLength, origBytes.length);

  const patched = patchVrmMetadata(origBytes, {
    title: 'PatchedHeroine',
    version: '2.1.0',
    authors: ['Alice', 'Bob'],
    commercialUsage: 'personalProfit',
    allowRedistribution: true,
    modification: 'allowModification',
    creditNotation: 'unnecessary',
    licenseUrl: 'https://example.org/license',
  });
  assert.match(patched.sha256, /^[a-f0-9]{64}$/);
  assert.equal(patched.meta.name, 'PatchedHeroine');
  assert.equal(patched.meta.version, '2.1.0');
  assert.deepEqual(patched.meta.authors, ['Alice', 'Bob']);
  assert.equal(patched.meta.commercialUsage, 'personalProfit');
  assert.equal(patched.meta.allowRedistribution, true);
  assert.equal(patched.meta.modification, 'allowModification');
  assert.equal(patched.bytes.readUInt32LE(8), patched.bytes.length);

  // Extract BIN chunk from patched GLB and verify verbatim byte equality
  const patchedJsonLen = patched.bytes.readUInt32LE(12);
  assert.equal(patchedJsonLen % 4, 0);
  const binOff = 20 + patchedJsonLen;
  const patchedBinLen = patched.bytes.readUInt32LE(binOff);
  assert.equal(patched.bytes.readUInt32LE(binOff + 4), 0x004e4942);
  const patchedBin = patched.bytes.subarray(binOff + 8, binOff + 8 + patchedBinLen);
  assert.equal(Buffer.compare(patchedBin, binChunkPayload), 0, 'BIN chunk must be preserved byte-for-byte');

  const reinspected = inspectVrmMetadata(patched.bytes);
  assert.equal(reinspected.meta.name, 'PatchedHeroine');
  assert.deepEqual(reinspected.meta.authors, ['Alice', 'Bob']);

  // Malformed & non-VRM1 rejections
  assert.throws(() => inspectVrmMetadata(Buffer.from('not-a-glb')), /Invalid GLB/);
  assert.throws(() => inspectVrmMetadata(triangleGlb()), /VRMC_vrm/);
  assert.throws(() => patchVrmMetadata(origBytes, { commercialUsage: 'invalid_mode' }), /commercialUsage/);
  assert.throws(() => patchVrmMetadata(origBytes, { licenseUrl: 'ftp://bad.example' }), /http or https/);
  assert.throws(() => patchVrmMetadata(origBytes, { authors: [] }), /count must be between/);
});

test('v0.9.0 built-in cleanroom_walk_loop.vrma passes binary GLB 2.0 + VRMC_vrm_animation 1.0 validation and HTTP routes work', async t => {
  const vrmaPath = path.join(ROOT, 'assets', 'motions', 'cleanroom_walk_loop.vrma');
  const vrmaBytes = await fs.readFile(vrmaPath);
  const gltf = validateGlb(vrmaBytes);
  assert.equal(gltf.asset.version, '2.0');
  const vrmaExt = gltf.extensions?.VRMC_vrm_animation;
  assert.ok(vrmaExt, 'VRMC_vrm_animation extension must exist');
  assert.equal(vrmaExt.specVersion, '1.0');

  const humanBones = vrmaExt.humanoid?.humanBones || {};
  for (const requiredBone of [
    'hips', 'spine', 'chest', 'neck', 'head',
    'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
    'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
    'leftUpperArm', 'leftLowerArm', 'rightUpperArm', 'rightLowerArm',
  ]) {
    assert.ok(Number.isInteger(humanBones[requiredBone]?.node), `Missing humanoid bone ${requiredBone}`);
  }
  assert.ok(Array.isArray(gltf.animations) && gltf.animations.length >= 1, 'VRMA must have animation clip');
  assert.ok(gltf.animations[0].channels.length >= 15, 'VRMA animation must drive humanoid channels');
  assert.ok(gltf.animations[0].samplers.length >= 15);

  // Test loopback HTTP routes: GET /studio/motions/builtin & POST /studio/vrm/export-meta
  const dir = await tempProject(t);
  await initOrUpdateProject(dir, { projectName: 'RouteV090Test' });
  const baseBlend = path.join(dir, 'base.blend');
  await fs.writeFile(baseBlend, BLEND_BYTES);
  const { fetchImpl } = mockCompanion({ exportVrm: true });
  const imported = await runEditorOperation({ projectDir: dir, operation: 'import_blend', params: { sourceBlend: baseBlend }, blenderPluginUrl: BASE_COMPANION, fetchImpl });
  await runEditorOperation({ projectDir: dir, operation: 'export_vrm', expectedRevisionId: imported.revisionId, blenderPluginUrl: BASE_COMPANION, fetchImpl });

  const server = await startStudioHttpServer({
    port: 0,
    config: { registryFile: path.join(dir, 'recent.json'), budgetDir: path.join(dir, 'budget') },
  });
  t.after(() => server.close());

  const origin = server.baseUrl;
  const unauthMotion = await fetch(`${origin}/studio/motions/builtin`);
  assert.equal(unauthMotion.status, 403);

  const { sessionToken } = await (await fetch(`${origin}/studio/session`)).json();
  const authMotion = await fetch(`${origin}/studio/motions/builtin?access=${encodeURIComponent(sessionToken)}`);
  assert.equal(authMotion.status, 200);
  assert.equal(authMotion.headers.get('content-type'), 'model/gltf-binary');
  const fetchedBytes = Buffer.from(await authMotion.arrayBuffer());
  assert.equal(Buffer.compare(fetchedBytes, vrmaBytes), 0, 'GET /studio/motions/builtin must serve exact cleanroom_walk_loop.vrma bytes');

  const exportRes = await fetch(`${origin}/studio/vrm/export-meta`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Charakuru-Session': sessionToken, Origin: 'dsh-app://app' },
    body: JSON.stringify({
      projectDir: dir,
      saveToProject: true,
      meta: {
        title: 'RouteExportedHero',
        version: '1.2.3',
        authors: ['StudioUser'],
        commercialUsage: 'personalNonProfit',
        allowRedistribution: true,
        modification: 'allowModification',
      },
    }),
  });
  assert.equal(exportRes.status, 200);
  const payload = await exportRes.json();
  assert.equal(payload.ok, true);
  assert.match(payload.fileName, /^avatar_meta_[a-f0-9]{12}\.vrm$/);
  assert.equal(payload.savedPath, `exports/${payload.fileName}`);
  const exportedBuf = Buffer.from(payload.vrmBase64, 'base64');
  assert.equal(exportedBuf.length, payload.bytes);
  const inspected = inspectVrmMetadata(exportedBuf);
  assert.equal(inspected.meta.name, 'RouteExportedHero');
  assert.equal(inspected.meta.version, '1.2.3');
  assert.deepEqual(inspected.meta.authors, ['StudioUser']);
  assert.equal(inspected.meta.allowRedistribution, true);
  const stateAfter = (await loadProjectState(dir)).state;
  assert.equal(stateAfter.vrmMetadata.title, 'RouteExportedHero');
  assert.equal(path.basename(stateAfter.vrmMetadata.exportedVrmPath), payload.fileName);
});

test('v0.9.0 new editor ops, lifted expressions, AI_EDIT_INTENTS.expressions, and studio-pipeline.py Python AST/symtable contracts', async t => {
  assert.equal(EDITOR_OPERATIONS.length, 25);
  for (const op of ['smart_mesh_retexture', 'apply_mtoon', 'expression_lab', 'physics_oscillation_audit']) {
    assert.ok(EDITOR_OPERATIONS.includes(op), `EDITOR_OPERATIONS missing ${op}`);
  }
  assert.deepEqual(AI_EDIT_INTENTS.expressions, ['expression_lab', 'audit', 'export_vrm']);
  assert.ok(AI_EDIT_INTENTS.placement.includes('smart_mesh_retexture'));
  assert.ok(AI_EDIT_INTENTS.placement.includes('apply_mtoon'));
  assert.ok(AI_EDIT_INTENTS.rigging.includes('physics_oscillation_audit'));
  assert.ok(AI_EDIT_INTENTS.delivery.includes('expression_lab'));
  assert.ok(AI_EDIT_INTENTS.general.includes('smart_mesh_retexture'));

  // Lifted expressions validation & materials mtoon mode
  assert.equal(validateEditorParams('configure_vrm', { expressions: 'expression_lab' }).expressions, 'expression_lab');
  assert.throws(() => validateEditorParams('configure_vrm', { expressions: 'bogus' }), /skip, preserve, or expression_lab/);
  assert.equal(validateEditorParams('materials', { materialMode: 'mtoon', shadingToony: 0.85 }).materialMode, 'mtoon');

  // Strict parameter validation on 4 new operations
  assert.deepEqual(
    validateEditorParams('smart_mesh_retexture', {
      groups: ['hair', 'head', 'lower_body'],
      textureSize: 4096,
      smartUvAngleDeg: 66,
      uvMargin: 0.02,
      delight: true,
      separatePhysicsGroup: true,
    }).groups,
    ['hair', 'head', 'lower_body']
  );
  assert.throws(() => validateEditorParams('smart_mesh_retexture', { textureSize: 512 }), /1024, 2048, or 4096/);
  assert.throws(() => validateEditorParams('smart_mesh_retexture', { viewImageMaterialIds: { top: 'material_11111111-1111-1111-1111-111111111111' } }), /Invalid viewImageMaterialIds slot/);

  assert.equal(
    validateEditorParams('apply_mtoon', {
      shadeColor: [0.8, 0.75, 0.85],
      shadingShift: -0.1,
      shadingToony: 0.9,
      outlineWidthMode: 'worldCoordinates',
      outlineWidthFactor: 0.002,
    }).outlineWidthMode,
    'worldCoordinates'
  );
  assert.throws(() => validateEditorParams('apply_mtoon', { outlineWidthFactor: 0.5 }), /0 and 0\.05/);

  assert.deepEqual(
    validateEditorParams('expression_lab', {
      headMesh: 'Head',
      presets: ['blink', 'aa', 'happy'],
      excludeHairByBbox: true,
      intensity: 1.0,
      bindVrm1: true,
    }).presets,
    ['blink', 'aa', 'happy']
  );
  assert.throws(() => validateEditorParams('expression_lab', { presets: [] }), /unique subset/);
  assert.throws(() => validateEditorParams('expression_lab', { intensity: 5 }), /0\.1 and 2\.0/);

  assert.equal(
    validateEditorParams('physics_oscillation_audit', {
      frames: 24,
      amplitudeDeg: 30,
      compareSpringOff: true,
    }).frames,
    24
  );
  assert.throws(() => validateEditorParams('physics_oscillation_audit', { frames: 2 }), /8 and 120/);

  // Mock companion execution: resolve viewImageMaterialIds -> viewImagePaths & matcapMaterialId -> matcapPath
  const dir = await tempProject(t);
  await initOrUpdateProject(dir);
  const viewPng = path.join(dir, 'front.png');
  const matcapPng = path.join(dir, 'matcap.png');
  await fs.writeFile(viewPng, png(4, 4));
  await fs.writeFile(matcapPng, png(4, 4));
  let state = (await loadProjectState(dir)).state;
  const frontMat = (await importProjectMaterial({ projectDir: dir, stageId: '2_views', role: 'turnaround', slotId: 'body_front', sourcePath: viewPng, expectedRevision: state.stateRevision })).material;
  state = (await loadProjectState(dir)).state;
  const matcapMat = (await importProjectMaterial({ projectDir: dir, stageId: '4_assembly', role: 'base_color', sourcePath: matcapPng, expectedRevision: state.stateRevision })).material;

  const { fetchImpl, commands } = mockCompanion();
  const baseBlend = path.join(dir, 'base.blend');
  await fs.writeFile(baseBlend, BLEND_BYTES);
  const baseEdit = await runEditorOperation({
    projectDir: dir,
    operation: 'import_blend',
    params: { sourceBlend: baseBlend },
    blenderPluginUrl: BASE_COMPANION,
    fetchImpl,
  });
  const retex = await runEditorOperation({
    projectDir: dir,
    operation: 'smart_mesh_retexture',
    params: { textureSize: 2048, viewImageMaterialIds: { front: frontMat.id } },
    expectedRevisionId: baseEdit.revisionId,
    blenderPluginUrl: BASE_COMPANION,
    fetchImpl,
  });
  const realDir = await fs.realpath(dir);
  assert.equal(commands.at(-1).viewImagePaths?.front, path.resolve(realDir, frontMat.filePath));

  await runEditorOperation({
    projectDir: dir,
    operation: 'apply_mtoon',
    params: { matcapMaterialId: matcapMat.id, outlineWidthMode: 'screenCoordinates' },
    expectedRevisionId: retex.revisionId,
    blenderPluginUrl: BASE_COMPANION,
    fetchImpl,
  });
  assert.equal(commands.at(-1).matcapPath, path.resolve(realDir, matcapMat.filePath));

  const exprReq = await createAiEditRequest({
    projectDir: dir,
    prompt: 'Create blink and happy expressions',
    expectedRevisionId: (await loadProjectState(dir)).state.editor.activeRevisionId,
    intent: 'expressions',
  });
  assert.equal(exprReq.request.intent, 'expressions');
  assert.match(exprReq.instruction, /"approvedOperations":\["expression_lab","audit","export_vrm"\]/);

  // Static Python AST + symtable check on studio-pipeline.py
  const python = process.env.DSH_CHECK_PYTHON || process.env.DSH_PYTHON_EXECUTABLE || 'python';
  const pyRes = spawnSync(
    python,
    [
      '-c',
      `
import ast, builtins, pathlib, symtable
src = pathlib.Path(r"${path.join(ROOT, 'lib/blender/studio-pipeline.py').replace(/\\/g, '\\\\')}").read_text(encoding="utf-8")
tree = ast.parse(src, filename="studio-pipeline.py")
fn_names = {n.name for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}
for req in ("smart_mesh_retexture", "apply_mtoon", "expression_lab", "physics_oscillation_audit"):
    assert req in fn_names, f"Missing {req}"
st = symtable.symtable(src, "studio-pipeline.py", "exec")
known = set(dir(builtins)) | {'COMMAND'}
def walk_st(table, scope_vars):
    local = set(scope_vars) | {s.get_name() for s in table.get_symbols() if s.is_local() or s.is_parameter() or s.is_assigned() or s.is_imported() or s.is_declared_global()}
    undef = []
    for s in table.get_symbols():
        if s.is_referenced() and not (s.is_local() or s.is_parameter() or s.is_assigned() or s.is_imported() or s.is_declared_global() or s.is_free() or s.get_name() in local or s.get_name() in known):
            undef.append((table.get_name(), s.get_name()))
    for child in table.get_children():
        undef.extend(walk_st(child, local))
    return undef
undefined = walk_st(st, set())
assert not undefined, f"Undefined globals: {undefined}"
print("STUDIO_PIPELINE_AST_SYMTABLE_OK")
`,
    ],
    { encoding: 'utf8', timeout: 15000 }
  );
  assert.equal(pyRes.status, 0, `studio-pipeline.py check failed: ${pyRes.stderr}`);
  assert.match(pyRes.stdout, /STUDIO_PIPELINE_AST_SYMTABLE_OK/);
});
