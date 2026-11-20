import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tempProject, png, glb, triangleGlb } from './fixtures.mjs';
import { initOrUpdateProject, loadProjectState } from '../lib/project/state.js';
import { setWorkflowMode, selectFoundation } from '../lib/project/workflow.js';
import { importProjectMaterial } from '../lib/project/materials.js';
import {
  EDITOR_OPERATIONS,
  AI_EDIT_INTENTS,
  validateEditorParams,
  runEditorOperation,
  createAiEditRequest,
} from '../lib/project/editor.js';
import {
  RENDER_SIZES,
  validateRenderRecipe,
  createRenderRequest,
  runRender,
} from '../lib/project/render.js';
import { validateImageParameters, validateImageModelConfig } from '../lib/providers/image-profiles.js';
import { buildAnimaComfyWorkflow } from '../lib/providers/image-router.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BLEND_BYTES = Buffer.from('BLENDER-v500phase3-fixture');
const FBX_BINARY = Buffer.concat([
  Buffer.from('Kaydara FBX Binary  '),
  Buffer.from([0x00, 0x1a, 0x00, 0xe8, 0x1c, 0x00, 0x00]),
]);
const BASE_COMPANION = 'http://127.0.0.1:9877';

const currentState = async dir => (await loadProjectState(dir)).state;
const currentRev = async dir => (await currentState(dir)).stateRevision;

function dracoGlb() {
  const bin = Buffer.alloc(16, 1);
  const base = glb({
    extensionsUsed: ['KHR_draco_mesh_compression'],
    extensionsRequired: ['KHR_draco_mesh_compression'],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, length: bin.length, byteLength: bin.length }],
    accessors: [{ componentType: 5126, count: 3, type: 'VEC3' }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0 },
        extensions: { KHR_draco_mesh_compression: { bufferView: 0, attributes: { POSITION: 0 } } },
      }],
    }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  });
  const chunk = Buffer.alloc(8);
  chunk.writeUInt32LE(bin.length, 0);
  chunk.writeUInt32LE(0x004e4942, 4);
  const full = Buffer.concat([base, chunk, bin]);
  full.writeUInt32LE(full.length, 8);
  return full;
}

function mockCompanion({ gateway = false, compressedNormalized = false, auditExtra = {} } = {}) {
  const commands = [];
  const transportPayloads = [];
  let queuedResult = null;
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname === '/health') {
      return Response.json(
        gateway
          ? { ok: true, gateway: { hostId: 'unit-host-080' } }
          : { ok: true, stats: {}, lease: {}, provenance: {} }
      );
    }
    if (u.pathname === '/doctor') return Response.json({ kind: 'ok' });
    const body = JSON.parse(init.body);
    transportPayloads.push({ pathname: u.pathname, body });

    const executeScript = async scriptFile => {
      const scriptText = await fs.readFile(scriptFile, 'utf8');
      const command = JSON.parse(JSON.parse(scriptText.split('\n')[0].slice('COMMAND = '.length)));
      commands.push(command);

      if (command.operation) {
        await fs.writeFile(command.outputs.blend, BLEND_BYTES);
        await fs.writeFile(command.outputs.preview, triangleGlb());
        if (command.outputs.normalizedGlb) {
          await fs.writeFile(
            command.outputs.normalizedGlb,
            compressedNormalized ? dracoGlb() : triangleGlb()
          );
        }
        await fs.writeFile(
          command.outputs.report,
          JSON.stringify({
            requestId: command.requestId,
            objects: [
              {
                name: 'Body',
                type: 'MESH',
                vertices: 240,
                dimensions: [0.55, 0.28, 1.56],
                shapeKeys: [{ name: 'Chest', value: 0, sliderMin: -2.0, sliderMax: 2.0 }],
              },
              {
                name: 'Coat',
                type: 'MESH',
                vertices: 180,
                dimensions: [0.58, 0.31, 0.72],
                shapeKeys: [],
              },
              {
                name: 'Badge',
                type: 'MESH',
                vertices: 24,
                dimensions: [0.05, 0.02, 0.05],
                shapeKeys: [],
              },
              {
                name: 'Rig',
                type: 'ARMATURE',
                bones: ['Hips', 'Spine', 'Chest', 'Neck', 'Head'],
              },
            ],
            gates: { weights: true, textures: true },
            materialInput: command.material
              ? { id: command.material.id, sha256: command.material.sha256 }
              : null,
            ...auditExtra,
          })
        );
        return { verdict: 'pass', requestId: command.requestId, outputs: command.outputs };
      }

      const [w, h] = command.pixels;
      await fs.writeFile(path.join(command.output, 'render.png'), png(w, h));
      await fs.writeFile(
        path.join(command.output, 'report.json'),
        JSON.stringify({
          requestId: command.requestId,
          revisionId: command.revisionId,
          blendHash: command.blendHash,
          recipe: command.recipe,
          blenderVersion: '4.2.5 LTS',
          engine: command.recipe.engine === 'cycles' ? 'CYCLES' : 'BLENDER_EEVEE_NEXT',
          viewTransform: command.recipe.viewTransform || (command.recipe.toon ? 'Standard' : 'AgX'),
          look: command.recipe.look || (command.recipe.toon ? 'Medium High Contrast' : 'None'),
          lensType: command.recipe.lensType || 'persp',
          meshes: 3,
          toonMaterials: command.recipe.toon ? 2 : 0,
          outlineMeshes: command.recipe.toonOptions?.outline ? 2 : 0,
          faceSdfMaterials: command.faceSdfPath ? 1 : 0,
          preservedMtoon: 1,
          auxiliaryPasses: command.recipe.passes || [],
          notes: [],
        })
      );
      return { verdict: 'pass', requestId: command.requestId };
    };

    if (u.pathname === '/headless') {
      return Response.json({ ok: true, result: { exitCode: 0, resultJson: await executeScript(body.scriptFile) } });
    }
    if (u.pathname === '/job') {
      if (body.op === 'submit') {
        queuedResult = await executeScript(body.script_file);
        return Response.json({ job: { id: 'job-080-1' } });
      }
      if (body.op === 'collect') {
        return Response.json({ job: { state: 'completed', result: { exitCode: 0, parsed: queuedResult } } });
      }
    }
    throw new Error(`Unexpected companion route: ${u.pathname}`);
  };
  return { fetchImpl, commands, transportPayloads };
}

test('v0.8.0 Anima enforces multiples of 16 across image-profiles and buildAnimaComfyWorkflow', () => {
  assert.deepEqual(validateImageParameters('comfyui_anima', { width: 512, height: 768, steps: 12 }), {
    width: 512,
    height: 768,
    steps: 12,
  });
  assert.deepEqual(
    validateImageModelConfig('comfyui-anima-local', { parameters: { width: 512, height: 768 } }),
    { parameters: { width: 512, height: 768 } }
  );

  for (const bad of [
    { width: 520, height: 768 },
    { width: 512, height: 520 },
    { width: 999, height: 512 },
    { width: 512, height: 999 },
  ]) {
    assert.throws(() => validateImageParameters('comfyui_anima', bad), /Unsupported or out-of-range/);
    assert.throws(
      () => validateImageModelConfig('comfyui-anima-local', { parameters: bad }),
      /Unsupported or out-of-range/
    );
  }

  const okWorkflow = buildAnimaComfyWorkflow({
    positivePrompt: '1girl, clean turnaround',
    negativePrompt: 'lowres',
    width: 512,
    height: 768,
  });
  assert.equal(okWorkflow[4].inputs.width, 512);
  assert.equal(okWorkflow[4].inputs.height, 768);

  for (const [width, height] of [[520, 768], [512, 520], [999, 768], [512, 999]]) {
    assert.throws(
      () => buildAnimaComfyWorkflow({ positivePrompt: '1girl', negativePrompt: 'bad', width, height }),
      /multiples of 16/
    );
  }
});

test('v0.8.0 AI_EDIT_INTENTS and EDITOR_OPERATIONS include all 21 Route 2 operations', () => {
  assert.ok(EDITOR_OPERATIONS.length >= 21, `Expected at least 21 EDITOR_OPERATIONS, got ${EDITOR_OPERATIONS.length}`);
  for (const op of ['normalize_material_mesh', 'fit_garment', 'audit_penetration', 'rigid_attach']) {
    assert.ok(EDITOR_OPERATIONS.includes(op), `EDITOR_OPERATIONS missing ${op}`);
  }
  assert.deepEqual(AI_EDIT_INTENTS.foundation_fit, ['fit_foundation', 'head_scale']);
  assert.deepEqual(AI_EDIT_INTENTS.foundation_head, ['append_foundation_head', 'audit']);
  for (const op of [
    'transform', 'head_scale', 'append_material_mesh', 'apply_material_texture',
    'normalize_material_mesh', 'fit_garment', 'audit_penetration', 'rigid_attach', 'audit',
  ]) {
    assert.ok(AI_EDIT_INTENTS.placement.includes(op), `placement missing ${op}`);
  }
  for (const op of [
    'transform', 'transfer_weights', 'normalize_weights', 'configure_vrm',
    'spring_setup', 'pose_check', 'audit_penetration', 'rigid_attach', 'audit',
  ]) {
    assert.ok(AI_EDIT_INTENTS.rigging.includes(op), `rigging missing ${op}`);
  }
  for (const op of ['configure_vrm', 'export_vrm', 'materials', 'audit', 'audit_penetration']) {
    assert.ok(AI_EDIT_INTENTS.delivery.includes(op), `delivery missing ${op}`);
  }
  for (const op of [
    'append_material_mesh', 'apply_material_texture', 'normalize_material_mesh',
    'fit_garment', 'audit_penetration', 'rigid_attach', 'fit_foundation', 'append_foundation_head',
  ]) {
    assert.ok(AI_EDIT_INTENTS.general.includes(op), `general missing ${op}`);
  }
});

test('v0.8.0 fit_foundation supports negative/multi-mesh shapeValues, regionScaling, syncMeshes, applyScale + mock execution', async t => {
  assert.doesNotThrow(() =>
    validateEditorParams('fit_foundation', {
      bodyObject: 'Body',
      scale: [1, 1, 1.06],
      applyScale: true,
      syncMeshes: ['Body', 'Yumeka_Body'],
      shapeValues: [
        { key: 'Chest', value: -0.5, mesh: 'Body' },
        { key: 'Chest', value: -0.5, mesh: 'Yumeka_Body' },
        { key: 'Waist', value: 2.5 },
      ],
      regionScaling: {
        preserveHead: true,
        legScale: 1.08,
        torsoScale: 0.96,
        shoulderWidthScale: 0.92,
        waistScale: 0.9,
        hipScale: 1.05,
        armScale: 0.98,
        neckBone: 'Neck',
        headBone: 'Head',
        hipsBone: 'Hips',
        chestBone: 'Chest',
      },
    })
  );

  assert.throws(
    () => validateEditorParams('fit_foundation', { bodyObject: 'Body', shapeValues: [{ key: 'Chest', value: -10.1 }] }),
    /shape keys/
  );
  assert.throws(
    () => validateEditorParams('fit_foundation', {
      bodyObject: 'Body',
      shapeValues: [{ key: 'Chest', value: -0.5, mesh: 'Body' }, { key: 'Chest', value: 0.2, mesh: 'Body' }],
    }),
    /shape keys/
  );
  assert.throws(
    () => validateEditorParams('fit_foundation', { bodyObject: 'Body', regionScaling: { legScale: 2.2 } }),
    /regionScaling\.legScale/
  );
  assert.throws(
    () => validateEditorParams('fit_foundation', { bodyObject: 'Body', regionScaling: { bogus: 1.0 } }),
    /Unknown regionScaling\.bogus/
  );
  assert.throws(
    () => validateEditorParams('fit_foundation', { bodyObject: 'Body', applyScale: 'true' }),
    /applyScale must be a boolean/
  );

  const dir = await tempProject(t);
  await initOrUpdateProject(dir);
  await setWorkflowMode({ projectDir: dir, mode: 'base_mesh', expectedRevision: await currentRev(dir) });
  const bodyPath = path.join(dir, 'foundation_body.blend');
  await fs.writeFile(bodyPath, BLEND_BYTES);
  const bodyMat = (await importProjectMaterial({
    projectDir: dir, stageId: '4_assembly', role: 'foundation_body', sourcePath: bodyPath, expectedRevision: await currentRev(dir),
  })).material;
  await selectFoundation({ projectDir: dir, part: 'body', materialId: bodyMat.id, expectedRevision: await currentRev(dir) });

  const mock = mockCompanion();
  const base = await runEditorOperation({
    projectDir: dir,
    operation: 'import_material_scene',
    params: { materialId: bodyMat.id },
    blenderPluginUrl: BASE_COMPANION,
    fetchImpl: mock.fetchImpl,
  });

  const fitParams = {
    bodyObject: 'Body',
    armature: 'Rig',
    scale: [1, 1, 1.04],
    applyScale: true,
    syncMeshes: ['Body', 'Yumeka_Body'],
    shapeValues: [{ key: 'Chest', value: -0.75, mesh: 'Body' }],
    regionScaling: { preserveHead: true, legScale: 1.06, shoulderWidthScale: 0.94 },
  };
  const fitted = await runEditorOperation({
    projectDir: dir,
    operation: 'fit_foundation',
    params: fitParams,
    expectedRevisionId: base.revisionId,
    blenderPluginUrl: BASE_COMPANION,
    fetchImpl: mock.fetchImpl,
  });
  assert.equal(fitted.verdict, 'pass');
  assert.deepEqual(mock.commands.at(-1).params, fitParams);
});

test('v0.8.0 append_foundation_head validates snapNeckRim/preserveFacialBones and inspect-foundation.py exposes extended schema', async () => {
  const matId = 'material_11111111-1111-1111-1111-111111111111';
  assert.doesNotThrow(() =>
    validateEditorParams('append_foundation_head', {
      materialId: matId,
      objects: ['Face', 'Eyes'],
      headBone: 'Head',
      replaceHeadObjects: ['OldFace'],
      snapNeckRim: true,
      preserveFacialBones: true,
      neckTargetMesh: 'Body',
      neckBone: 'Neck',
      snapTolerance: 0.015,
    })
  );
  assert.throws(
    () => validateEditorParams('append_foundation_head', { materialId: matId, objects: ['Face'], headBone: 'Head', snapTolerance: 0.2 }),
    /snapTolerance/
  );
  assert.throws(
    () => validateEditorParams('append_foundation_head', { materialId: matId, objects: ['Face'], headBone: 'Head', snapNeckRim: 'yes' }),
    /snapNeckRim/
  );
  assert.throws(
    () => validateEditorParams('append_foundation_head', { materialId: matId, objects: ['Face'], headBone: 'Head', preserveFacialBones: 1 }),
    /preserveFacialBones/
  );

  const inspectPy = await fs.readFile(path.join(ROOT, 'lib/blender/inspect-foundation.py'), 'utf8');
  for (const field of ['bboxMin', 'bboxMax', 'vertexGroups', 'shapeKeyNames', 'armatures', 'bonePositions', 'facialBones', 'missingImages', 'neckRimEstimate']) {
    assert.ok(inspectPy.includes(field), `inspect-foundation.py missing ${field}`);
  }
});

test('v0.8.0 normalize_material_mesh (.fbx & Draco GLB), fit_garment, audit_penetration, rigid_attach validation + mock execution', async t => {
  const dir = await tempProject(t);
  await initOrUpdateProject(dir);
  await setWorkflowMode({ projectDir: dir, mode: 'base_mesh', expectedRevision: await currentRev(dir) });

  const bodyPath = path.join(dir, 'base.blend');
  const fbxPath = path.join(dir, 'coat.fbx');
  const dracoPath = path.join(dir, 'hat_draco.glb');
  const pngPath = path.join(dir, 'tex.png');
  await fs.writeFile(bodyPath, BLEND_BYTES);
  await fs.writeFile(fbxPath, FBX_BINARY);
  await fs.writeFile(dracoPath, dracoGlb());
  await fs.writeFile(pngPath, png(4, 4));

  const bodyMat = (await importProjectMaterial({
    projectDir: dir, stageId: '4_assembly', role: 'foundation_body', sourcePath: bodyPath, expectedRevision: await currentRev(dir),
  })).material;
  const fbxMat = (await importProjectMaterial({
    projectDir: dir, stageId: '4_assembly', role: 'tripo_clothing', sourcePath: fbxPath, expectedRevision: await currentRev(dir),
  })).material;
  const dracoMat = (await importProjectMaterial({
    projectDir: dir, stageId: '3_tripo', role: 'part_candidate', part: 'accessory', sourcePath: dracoPath, expectedRevision: await currentRev(dir),
  })).material;
  const pngMat = (await importProjectMaterial({
    projectDir: dir, stageId: '4_assembly', role: 'base_color', sourcePath: pngPath, expectedRevision: await currentRev(dir),
  })).material;

  // Standalone Draco GLB normalization works before a base blend revision exists
  const mock = mockCompanion();
  const normDraco = await runEditorOperation({
    projectDir: dir,
    operation: 'normalize_material_mesh',
    params: { materialId: dracoMat.id, normalize: true, autoScaleUnits: true, rotateZDeg: 90, targetHeight: 0.4, groundToFloor: false },
    blenderPluginUrl: BASE_COMPANION,
    fetchImpl: mock.fetchImpl,
  });
  assert.equal(normDraco.verdict, 'pass');
  assert.ok(normDraco.editor.revisions.at(-1).artifacts.normalizedGlb?.filePath.endsWith('normalized.glb'));

  // Rejects compressed normalized.glb output from companion
  await assert.rejects(
    runEditorOperation({
      projectDir: dir,
      operation: 'normalize_material_mesh',
      params: { materialId: dracoMat.id },
      expectedRevisionId: normDraco.revisionId,
      blenderPluginUrl: BASE_COMPANION,
      fetchImpl: mockCompanion({ compressedNormalized: true }).fetchImpl,
    }),
    /Normalized GLB must be uncompressed/
  );

  // Rejects wrong material intent or unbounded normalize params
  await assert.rejects(
    runEditorOperation({
      projectDir: dir,
      operation: 'normalize_material_mesh',
      params: { materialId: pngMat.id },
      expectedRevisionId: normDraco.revisionId,
      blenderPluginUrl: BASE_COMPANION,
      fetchImpl: mock.fetchImpl,
    }),
    /Material cannot be used/
  );
  assert.throws(() => validateEditorParams('normalize_material_mesh', { materialId: fbxMat.id, rotateZDeg: 720 }), /rotateZDeg/);
  assert.throws(() => validateEditorParams('normalize_material_mesh', { materialId: fbxMat.id, targetHeight: 0.01 }), /targetHeight/);

  // Adopt foundation body and run Route 2 sequence: FBX normalize -> fit_garment -> audit_penetration -> rigid_attach
  await selectFoundation({ projectDir: dir, part: 'body', materialId: bodyMat.id, expectedRevision: await currentRev(dir) });
  const baseRev = await runEditorOperation({
    projectDir: dir,
    operation: 'import_material_scene',
    params: { materialId: bodyMat.id },
    expectedRevisionId: normDraco.revisionId,
    blenderPluginUrl: BASE_COMPANION,
    fetchImpl: mock.fetchImpl,
  });

  const normFbx = await runEditorOperation({
    projectDir: dir,
    operation: 'normalize_material_mesh',
    params: { materialId: fbxMat.id, normalize: true, autoScaleUnits: true, groundToFloor: true },
    expectedRevisionId: baseRev.revisionId,
    blenderPluginUrl: BASE_COMPANION,
    fetchImpl: mock.fetchImpl,
  });
  assert.equal(normFbx.editor.revisions.at(-1).materialInput.role, 'tripo_clothing');

  // fit_garment validation & execution
  const garmentParams = {
    objects: ['Coat'],
    bodyObject: 'Body',
    partCategory: 'clothing',
    landmarkFit: { enabled: true, uniform: true, mode: 'landmarks' },
    hollowShell: { enabled: true, angleDeg: 60, removeBottom: true },
    delightAlbedo: { enabled: true, strength: 0.45 },
    fitStrategy: 'surface_deform',
    fitOffset: 0.004,
    correctiveSmooth: { enabled: true, factor: 0.5, iterations: 4, smoothType: 'SIMPLE' },
    applyModifiers: true,
    weightSmooth: { enabled: true, sourceMesh: 'Body', maxTransferDistance: 0.25, iterations: 3, rigidIslands: true },
    resolvePenetration: { enabled: true, margin: 0.002, maxPush: 0.02, iterations: 3 },
  };
  assert.doesNotThrow(() => validateEditorParams('fit_garment', garmentParams));
  assert.throws(() => validateEditorParams('fit_garment', { objects: ['Coat'], bodyObject: 'Body', partCategory: 'wings' }), /partCategory/);
  assert.throws(() => validateEditorParams('fit_garment', { objects: ['Coat'], bodyObject: 'Body', fitStrategy: 'warp' }), /fitStrategy/);
  assert.throws(() => validateEditorParams('fit_garment', { objects: ['Coat'], bodyObject: 'Body', fitOffset: 0.2 }), /fitOffset/);
  assert.throws(() => validateEditorParams('fit_garment', { objects: [], bodyObject: 'Body' }), /requires non-empty objects/);
  assert.throws(() => validateEditorParams('fit_garment', { objects: ['Coat'], bodyObject: 'Body', hollowShell: { bogus: true } }), /Unknown hollowShell\.bogus/);

  const aiPlace = await createAiEditRequest({
    projectDir: dir,
    prompt: 'Fit Coat to Body',
    objects: ['Coat'],
    intent: 'placement',
    expectedRevisionId: normFbx.revisionId,
  });
  const fitted = await runEditorOperation({
    projectDir: dir,
    operation: 'fit_garment',
    params: garmentParams,
    editRequestId: aiPlace.request.id,
    expectedRevisionId: normFbx.revisionId,
    blenderPluginUrl: BASE_COMPANION,
    fetchImpl: mock.fetchImpl,
  });
  assert.equal(fitted.verdict, 'pass');

  // audit_penetration validation & execution
  const penParams = {
    bodyObject: 'Body',
    objects: ['Coat'],
    poses: ['rest', 'arm_raise', 'high_kick'],
    margin: 0.002,
    fixPenetration: true,
    maxPush: 0.025,
    ignoreModifiers: ['Outline', 'SOLIDIFY'],
  };
  assert.doesNotThrow(() => validateEditorParams('audit_penetration', penParams));
  assert.throws(() => validateEditorParams('audit_penetration', { bodyObject: 'Body', objects: ['Coat'], poses: ['backflip'] }), /Poses/);
  assert.throws(() => validateEditorParams('audit_penetration', { bodyObject: 'Body', objects: ['Coat'], margin: 0.1 }), /margin/);
  assert.throws(() => validateEditorParams('audit_penetration', { bodyObject: 'Body', objects: ['Coat'], maxPush: 0.2 }), /maxPush/);

  const audited = await runEditorOperation({
    projectDir: dir,
    operation: 'audit_penetration',
    params: penParams,
    expectedRevisionId: fitted.revisionId,
    blenderPluginUrl: BASE_COMPANION,
    fetchImpl: mock.fetchImpl,
  });
  assert.equal(audited.verdict, 'pass');

  // rigid_attach validation & execution
  const rigidParams = {
    objects: ['Badge'],
    bone: 'Chest',
    attachMode: 'bone_parent',
    armature: 'Rig',
    translation: [0, -0.05, 0.02],
    rotation: [0, 0, 15],
    scale: [1, 1, 1],
  };
  assert.doesNotThrow(() => validateEditorParams('rigid_attach', rigidParams));
  assert.doesNotThrow(() => validateEditorParams('rigid_attach', { objects: ['Badge'], bone: 'Head', attachMode: 'vertex_weight' }));
  assert.throws(() => validateEditorParams('rigid_attach', { objects: ['Badge'], bone: '' }), /requires non-empty objects and bone/);
  assert.throws(() => validateEditorParams('rigid_attach', { objects: ['Badge'], bone: 'Chest', attachMode: 'glue' }), /attachMode/);
  assert.throws(() => validateEditorParams('rigid_attach', { objects: ['Badge'], bone: 'Chest', translation: [25, 0, 0] }), /translation/);
  assert.throws(() => validateEditorParams('rigid_attach', { objects: ['Badge'], bone: 'Chest', scale: [0.01, 1, 1] }), /scale/);

  const attached = await runEditorOperation({
    projectDir: dir,
    operation: 'rigid_attach',
    params: rigidParams,
    expectedRevisionId: audited.revisionId,
    blenderPluginUrl: BASE_COMPANION,
    fetchImpl: mock.fetchImpl,
  });
  assert.equal(attached.verdict, 'pass');
});

test('v0.8.0 spring_setup strict params.skirt and pose_check parameter validation', () => {
  assert.doesNotThrow(() =>
    validateEditorParams('spring_setup', {
      mode: 'append',
      frontStiffnessMultiplier: 1.5,
      windDrag: 0.25,
      colliderGroupName: 'BodyColliders',
      springNamePrefix: 'Hair_',
      skirt: {
        mesh: 'Skirt',
        waistZ: 0.95,
        hemZ: 0.55,
        segments: 8,
        rings: 4,
        rootBone: 'hips',
        includeVertexGroup: 'SkirtCloth',
        excludeVertexGroups: ['Belt', 'Buttons'],
        minRadius: 0.12,
        maxRadius: 0.45,
        frontStiffnessMultiplier: 1.6,
        prefix: 'AS_skirt_',
        mode: 'replace',
      },
    })
  );
  for (const mode of ['append', 'replace', 'strict']) {
    assert.doesNotThrow(() => validateEditorParams('spring_setup', { mode, skirt: { mesh: 'Skirt', waistZ: 1.0, hemZ: 0.5, mode } }));
  }

  assert.throws(() => validateEditorParams('spring_setup', { mode: 'overwrite' }), /append, replace or strict/);
  assert.throws(() => validateEditorParams('spring_setup', { frontStiffnessMultiplier: 7 }), /frontStiffnessMultiplier/);
  assert.throws(() => validateEditorParams('spring_setup', { windDrag: 1.5 }), /windDrag/);
  assert.throws(
    () => validateEditorParams('spring_setup', { skirt: { mesh: 'Skirt', waistZ: 0.5, hemZ: 0.9 } }),
    /waistZ must exceed hemZ/
  );
  assert.throws(
    () => validateEditorParams('spring_setup', { skirt: { mesh: 'Skirt', waistZ: 2.5, hemZ: 0.2 } }),
    /less than 2 meters/
  );
  assert.throws(
    () => validateEditorParams('spring_setup', { skirt: { mesh: 'Skirt', waistZ: 1.0, hemZ: 0.5, minRadius: 0.5, maxRadius: 0.2 } }),
    /minRadius must be smaller/
  );
  assert.throws(
    () => validateEditorParams('spring_setup', { skirt: { mesh: 'Skirt', waistZ: 1.0, hemZ: 0.5, excludeVertexGroups: ['Belt', 'Belt'] } }),
    /unique non-empty names/
  );
  assert.throws(
    () => validateEditorParams('spring_setup', { skirt: { mesh: 'Skirt', waistZ: 1.0, hemZ: 0.5, frontStiffnessMultiplier: 8 } }),
    /skirt\.frontStiffnessMultiplier/
  );
  assert.throws(
    () => validateEditorParams('spring_setup', { skirt: { mesh: 'Skirt', waistZ: 1.0, hemZ: 0.5, mode: 'invalid' } }),
    /Invalid skirt\.mode/
  );

  assert.doesNotThrow(() =>
    validateEditorParams('pose_check', {
      bodyObject: 'Body',
      poses: ['rest', 'head_turn', 'arm_raise', 'elbow_bend', 'high_kick'],
      highKickDeg: 100,
      boneMap: { head: 'J_Bip_C_Head', thigh_l: 'L_Thigh' },
      captureScreenshots: true,
    })
  );
  assert.throws(() => validateEditorParams('pose_check', { poses: ['dance'] }), /Poses/);
  assert.throws(() => validateEditorParams('pose_check', { highKickDeg: 150 }), /highKickDeg/);
  assert.throws(() => validateEditorParams('pose_check', { boneMap: { head: 123 } }), /Invalid boneMap/);
  assert.throws(() => validateEditorParams('pose_check', { captureScreenshots: 'yes' }), /captureScreenshots/);
});

test('v0.8.0 render.js validates NPR/camera/4K recipes, omits defaults when unspecified, enforces PNG faceSdfMaterialId, and forwards engine', async t => {
  assert.deepEqual(RENDER_SIZES.hd1080, [1920, 1080]);
  assert.deepEqual(RENDER_SIZES.uhd4k, [3840, 2160]);

  // Omitting optional v0.8.0 fields must NOT inject default keys (backward compatibility)
  const minimal = validateRenderRecipe({ preset: 'neutral_check', camera: 'front', framing: 'full', size: 'draft' });
  assert.deepEqual(Object.keys(minimal).sort(), ['camera', 'exposure', 'fill', 'framing', 'key', 'preset', 'rim', 'size', 'toon']);

  const sdfId = 'material_22222222-2222-2222-2222-222222222222';
  const fullRecipe = {
    preset: 'wine_stage',
    camera: 'three_quarter',
    framing: 'portrait',
    size: 'hd1080',
    engine: 'cycles',
    lensType: 'ortho',
    lens: 85,
    dof: { enabled: true, fstop: 2.8, focusDistance: 2.4 },
    yawDeg: 35,
    pitchDeg: -12,
    transparent: true,
    samples: 32,
    frame: 10,
    viewTransform: 'Standard',
    look: 'Medium High Contrast',
    toon: true,
    toonOptions: {
      outline: true,
      outlineThickness: 0.002,
      outlineColor: [0.1, 0.05, 0.08],
      faceSdf: true,
      faceSdfMaterialId: sdfId,
      specularRim: true,
      metallicStep: true,
    },
    passes: ['albedo', 'normal', 'depth'],
  };
  const validated = validateRenderRecipe(fullRecipe);
  assert.equal(validated.engine, 'cycles');
  assert.equal(validated.lensType, 'ortho');
  assert.equal(validated.toonOptions.faceSdfMaterialId, sdfId);
  assert.deepEqual(validated.passes, ['albedo', 'normal', 'depth']);
  assert.equal(validateRenderRecipe({ size: 'uhd4k' }).size, 'uhd4k');

  for (const bad of [
    { engine: 'octane' },
    { lensType: 'fisheye' },
    { lens: 10 },
    { dof: { enabled: true, fstop: 0.2 } },
    { yawDeg: 200 },
    { pitchDeg: -75 },
    { samples: 2 },
    { frame: -1 },
    { viewTransform: 'ACES' },
    { look: 'Vivid' },
    { toonOptions: { outlineThickness: 0.05 } },
    { toonOptions: { faceSdfMaterialId: 'C:/face_sdf.png' } },
    { toonOptions: { script: 'import os' } },
    { passes: ['albedo', 'albedo'] },
    { passes: ['wireframe'] },
  ]) {
    assert.throws(() => validateRenderRecipe(bad), /render|toonOptions|dof|viewTransform|look|passes/i);
  }

  // Full render execution forwarding engine (both legacy /headless and gateway /job) & faceSdfPath
  const dir = await tempProject(t);
  await initOrUpdateProject(dir);
  const blendPath = path.join(dir, 'render_base.blend');
  const sdfPng = path.join(dir, 'face_sdf.png');
  const meshGlb = path.join(dir, 'not_a_png.glb');
  await fs.writeFile(blendPath, BLEND_BYTES);
  await fs.writeFile(sdfPng, png(8, 8));
  await fs.writeFile(meshGlb, triangleGlb());

  const sdfMat = (await importProjectMaterial({
    projectDir: dir, stageId: '4_assembly', role: 'base_color', sourcePath: sdfPng, expectedRevision: await currentRev(dir),
  })).material;
  const nonPngMat = (await importProjectMaterial({
    projectDir: dir, stageId: '4_assembly', role: 'assembly_mesh', sourcePath: meshGlb, expectedRevision: await currentRev(dir),
  })).material;

  const legacyMock = mockCompanion({ gateway: false });
  const edit = await runEditorOperation({
    projectDir: dir,
    operation: 'import_blend',
    params: { sourceBlend: blendPath },
    blenderPluginUrl: BASE_COMPANION,
    fetchImpl: legacyMock.fetchImpl,
  });

  // Non-PNG faceSdfMaterialId fails closed before submitting render
  const badSdfReq = await createRenderRequest({
    projectDir: dir,
    brief: 'Bad SDF extension test',
    expectedRevisionId: edit.revisionId,
  });
  await assert.rejects(
    runRender({
      projectDir: dir,
      requestId: badSdfReq.request.id,
      expectedRevisionId: edit.revisionId,
      recipe: { preset: 'wine_stage', camera: 'front', framing: 'portrait', size: 'draft', toonOptions: { faceSdf: true, faceSdfMaterialId: nonPngMat.id } },
      blenderPluginUrl: BASE_COMPANION,
      fetchImpl: legacyMock.fetchImpl,
    }),
    /PNG texture/
  );

  // Legacy /headless forwards engine='cycles' and resolves command.faceSdfPath
  const req1 = await createRenderRequest({
    projectDir: dir,
    brief: 'NPR Cycles HD1080',
    expectedRevisionId: edit.revisionId,
  });
  const res1 = await runRender({
    projectDir: dir,
    requestId: req1.request.id,
    expectedRevisionId: edit.revisionId,
    recipe: {
      ...fullRecipe,
      toonOptions: { ...fullRecipe.toonOptions, faceSdfMaterialId: sdfMat.id },
    },
    blenderPluginUrl: BASE_COMPANION,
    fetchImpl: legacyMock.fetchImpl,
  });
  assert.equal(res1.verdict, 'pass');
  assert.equal(res1.request.artifacts.png.width, 1920);
  assert.equal(res1.request.artifacts.png.height, 1080);
  assert.equal(res1.request.summary.engine, 'CYCLES');
  assert.equal(res1.request.summary.viewTransform, 'Standard');
  assert.equal(res1.request.summary.lensType, 'ortho');
  assert.equal(res1.request.summary.outlineMeshes, 2);
  assert.equal(res1.request.summary.faceSdfMaterials, 1);
  assert.equal(res1.request.summary.preservedMtoon, 1);
  assert.deepEqual(res1.request.summary.auxiliaryPasses, ['albedo', 'normal', 'depth']);
  const lastCmd = legacyMock.commands.at(-1);
  assert.ok(lastCmd.faceSdfPath?.endsWith('.png'));
  assert.equal(lastCmd.recipe.faceSdfPath, undefined);
  const headlessBody = legacyMock.transportPayloads.find(p => p.pathname === '/headless' && p.body.engine === 'cycles');
  assert.ok(headlessBody, 'engine=cycles must be forwarded to /headless');

  // Gateway /job forwards engine='cycles'
  const gwMock = mockCompanion({ gateway: true });
  const gwReq = await createRenderRequest({ projectDir: dir, brief: 'Gateway Cycles test', expectedRevisionId: edit.revisionId });
  const gwQueued = await runRender({
    projectDir: dir,
    requestId: gwReq.request.id,
    expectedRevisionId: edit.revisionId,
    recipe: { preset: 'neutral_check', camera: 'front', framing: 'full', size: 'uhd4k', engine: 'cycles' },
    caller: { hostId: 'unit-host-080', dshSessionId: 'sess-1', agentId: 'agent-1', role: 'main' },
    blenderPluginUrl: BASE_COMPANION,
    fetchImpl: gwMock.fetchImpl,
  });
  assert.equal(gwQueued.status, 'queued');
  const jobSubmit = gwMock.transportPayloads.find(p => p.pathname === '/job' && p.body.op === 'submit');
  assert.equal(jobSubmit.body.engine, 'cycles');
});

test('v0.8.0 Python AST & static contract checks on studio-pipeline.py, inspect-foundation.py, and render-studio.py', async () => {
  const pyFiles = [
    path.join(ROOT, 'lib/blender/studio-pipeline.py'),
    path.join(ROOT, 'lib/blender/inspect-foundation.py'),
    path.join(ROOT, 'lib/blender/render-studio.py'),
  ];
  const python = process.env.DSH_CHECK_PYTHON || process.env.DSH_PYTHON_EXECUTABLE || 'python';
  const astCheck = spawnSync(
    python,
    ['-c', 'import ast,pathlib,sys; [ast.parse(pathlib.Path(p).read_text(encoding="utf-8"), filename=p) for p in sys.argv[1:]]', ...pyFiles],
    { encoding: 'utf8', timeout: 30000 }
  );
  assert.equal(astCheck.status, 0, `Python AST failed: ${astCheck.stderr}`);

  const [pipelinePy, inspectPy, renderPy] = await Promise.all(pyFiles.map(f => fs.readFile(f, 'utf8')));

  // studio-pipeline.py Route 2 contracts
  for (const token of [
    'resolve_humanoid_bones',
    'cleanup_foundation_fit_empties',
    'Studio_FoundationFit',
    'regionScaling',
    'snapNeckRim',
    'preserveFacialBones',
    'normalize_material_mesh',
    'fit_garment',
    'audit_penetration',
    'rigid_attach',
    'group.remove',
    'import_scene.fbx',
    'import_scene.gltf',
  ]) {
    assert.ok(pipelinePy.includes(token), `studio-pipeline.py missing ${token}`);
  }
  assert.match(pipelinePy, /def pose_check[\s\S]*require\(\s*len\(matched\)\s*>\s*0/);
  assert.match(pipelinePy, /def select_export[\s\S]*Studio_FoundationFit/);

  // inspect-foundation.py schema
  for (const token of ['bboxMin', 'bboxMax', 'vertexGroups', 'shapeKeyNames', 'armatures', 'bonePositions', 'facialBones', 'missingImages', 'neckRimEstimate']) {
    assert.ok(inspectPy.includes(token), `inspect-foundation.py missing ${token}`);
  }

  // render-studio.py Blender 4.2-5.x & NPR contracts
  assert.equal(renderPy.includes('ShaderNodeMixRGB'), false, 'render-studio.py must replace deprecated ShaderNodeMixRGB with ShaderNodeMix');
  for (const token of [
    'ShaderNodeMix',
    "data_type = 'RGBA'",
    'enum_items',
    'BLENDER_EEVEE_NEXT',
    'BLENDER_EEVEE',
    'CYCLES',
    'Standard',
    'Medium High Contrast',
    'lensType',
    'AS_OutlineMask',
    'SOLIDIFY',
    'faceSdfPath',
    'outlineMeshes',
    'faceSdfMaterials',
    'preservedMtoon',
    'auxiliaryPasses',
  ]) {
    assert.ok(renderPy.includes(token), `render-studio.py missing ${token}`);
  }
});
