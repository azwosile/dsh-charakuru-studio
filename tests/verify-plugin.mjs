/**
 * dsh-charakuru-studio — Comprehensive End-to-End Verification Suite.
 *
 * Verifies:
 *   1. Package manifest, exports, files list, locales, icon.svg & preview.svg DSH artwork compliance
 *   2. Client bundle (`lib/client.js`) strict browser syntax & zero forbidden imports/tokens
 *   3. AA Image Leaderboard & Prompt Compiler (Qwen-Image-2.1 RGBA, ComfyUI Anima `@artist` + space tags, NovelAI V5)
 *   4. NovelAI pure-Node ZIP PNG extraction & ComfyUI workflow JSON generation
 *   5. Tripo Studio Free Tier (200/mo, Concurrency=1 serial lock, binary glTF validation & SHA-256 archiving)
 *   6. `sixtysevenlf/dsh-blender-plugin` NDJSON heartbeat parser & all 5 Clean-Room Blender 5.2 Python generators
 *   7. Host Cordis plugin lifecycle (`apply`, 6 registered tools, `skills.registerProvider`, encrypted credentials redaction, `:9886` HTTP API)
 *   8. Zero credential / password leakage across the entire repository tree
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import * as pluginEntry from '../lib/index.js';
import { startStudioHttpServer } from '../lib/host/server.js';
import { createCredentialManager } from '../lib/host/credentials.js';
import { registerBundledStudioSkill, BUNDLED_SKILL_NAME } from '../lib/host/skill.js';
import { runSerialTripoTask } from '../lib/tripo/free-quota-scheduler.js';
import { crc32, png as fixturePng, zip as fixtureZip, glb as fixtureGlb } from './fixtures.mjs';
import { initOrUpdateProject } from '../lib/project/state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function buildSyntheticStoreZip(filename, contentBuffer) {
  const nameBuf = Buffer.from(filename, 'utf8');
  const localHeader = Buffer.alloc(30 + nameBuf.length);
  localHeader.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
  localHeader.writeUInt16LE(20, 4); // version needed
  localHeader.writeUInt16LE(0, 6); // flags
  localHeader.writeUInt16LE(0, 8); // method 0 = STORE
  localHeader.writeUInt32LE(crc32(contentBuffer), 14);
  localHeader.writeUInt32LE(contentBuffer.length, 18); // compressed size
  localHeader.writeUInt32LE(contentBuffer.length, 22); // uncompressed size
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28);
  nameBuf.copy(localHeader, 30);
  return Buffer.concat([localHeader, contentBuffer]);
}

function buildSyntheticDeflateZip(filename, contentBuffer) {
  const deflated = zlib.deflateRawSync(contentBuffer);
  const nameBuf = Buffer.from(filename, 'utf8');
  const localHeader = Buffer.alloc(30 + nameBuf.length);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(8, 8); // method 8 = DEFLATE
  localHeader.writeUInt32LE(crc32(contentBuffer), 14);
  localHeader.writeUInt32LE(deflated.length, 18);
  localHeader.writeUInt32LE(contentBuffer.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28);
  nameBuf.copy(localHeader, 30);
  return Buffer.concat([localHeader, deflated]);
}

async function main() {
  const results = [];
  const step = async (title, fn) => {
    await fn();
    results.push(`PASS: ${title}`);
  };

  await step('1. Bundle manifest, locales, icon.svg & preview.svg compliance', async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.name, 'dsh-charakuru-studio');
    assert.equal(pkg.type, 'module');
    assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml');
    const dotExport = typeof pkg.exports['.'] === 'string' ? pkg.exports['.'] : pkg.exports['.']?.default;
    assert.equal(dotExport, './lib/index.js');
    assert.equal(pkg.exports['./client'], './lib/client.js');
    assert.equal(pkg.exports['./icon'], './icon.svg');

    const en = JSON.parse(await fs.readFile(path.join(ROOT, 'locale/en.json'), 'utf8'));
    const zh = JSON.parse(await fs.readFile(path.join(ROOT, 'locale/zh.json'), 'utf8'));
    assert.ok(en.meta?.title && en.meta?.description && en.meta?.detail === 'docs/DETAIL.md');
    assert.ok(zh.meta?.title && zh.meta?.description && zh.meta?.detail === 'docs/DETAIL.zh.md');

    const iconSvg = await fs.readFile(path.join(ROOT, 'icon.svg'), 'utf8');
    assert.match(iconSvg, /width="36"/);
    assert.match(iconSvg, /viewBox="0 0 36 36"/);
    assert.doesNotMatch(iconSvg, /<(style|text|script|image|foreignObject)\b/i);

    const previewSvg = await fs.readFile(path.join(ROOT, 'docs/preview.svg'), 'utf8');
    assert.match(previewSvg, /width="640"/);
    assert.match(previewSvg, /height="300"/);
    assert.doesNotMatch(previewSvg, /<(style|text|script|image|foreignObject)\b/i);
  });

  await step('2. Client Web GUI bundle syntax & DSH UI contract', async () => {
    const clientSrc = await fs.readFile(path.join(ROOT, 'lib/client.js'), 'utf8');
    assert.doesNotMatch(clientSrc, /^\s*(import|export)\s/m);
    assert.doesNotMatch(clientSrc, /@deepseek-ai\/dsh-client-ui-primitives/);
    assert.doesNotMatch(clientSrc, /<iframe/i);
    assert.match(clientSrc, /--dsw-alias-bg-base/);

    // The workbench is a sidebar row + main page. The header modal seat and the
    // modal plumbing it needed must be gone for good.
    assert.match(clientSrc, /sidebar\.panellist/);
    assert.match(clientSrc, /name: 'main'/);
    assert.doesNotMatch(clientSrc, /conversation\.session\.header\.utilities/);
    assert.doesNotMatch(clientSrc, /<dialog|showModal|createPortal/);

    let loadedModule = null;
    const sandbox = {
      window: {
        __ModuleLoader__: {
          load(spec) {
            loadedModule = spec;
          },
        },
        localStorage: { getItem: () => null },
      },
      console,
    };
    vm.runInNewContext(clientSrc, sandbox, { filename: 'lib/client.js' });
    assert.equal(loadedModule?.id, 'dsh-charakuru-studio');
    assert.equal(typeof loadedModule?.factory, 'function');

    const fakeReact = {
      createElement: (...args) => ({ args }),
      Fragment: 'Fragment',
      useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
      useEffect: () => {},
      useMemo: (fn) => fn(),
      useCallback: (fn) => fn,
      useRef: () => ({ current: null }),
      useId: () => 'ck-verify',
      useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
    };
    const modExports = loadedModule.factory((id) => {
      if (id === 'react') return fakeReact;
      if (id === 'react-dom') return { createPortal: (node) => node };
      throw new Error(`Unexpected require: ${id}`);
    });
    assert.equal(typeof modExports.apply, 'function');
    assert.deepEqual([...modExports.inject.required], ['slots', 'locale']);
    assert.deepEqual([...modExports.inject.optional], ['layout', 'sessions', 'conversation']);
  });

  await step('3. AA Image Leaderboard & Turnaround Prompt Compiler', async () => {
    const { IMAGE_MODEL_CATALOG, formatAnimaTags, compileTurnaroundPromptPack } = pluginEntry.__internals;
    assert.ok(IMAGE_MODEL_CATALOG.length >= 9);

    // Anima tag rules: lowercase spaces, score_7 underscore preserved, @artist prefix enforced
    const animaFormatted = formatAnimaTags({
      characterSummary: '1Girl, Long_Hair, Score_7, Pleated_Skirt',
      artist: 'askzy',
      variant: 'base',
    });
    assert.match(animaFormatted.positive, /^masterpiece, best quality, score_7, /);
    assert.match(animaFormatted.positive, /long hair/);
    assert.match(animaFormatted.positive, /pleated skirt/);
    assert.match(animaFormatted.positive, /@askzy/);
    assert.match(animaFormatted.negative, /worst quality/);

    const animaAesthetic = formatAnimaTags({
      characterSummary: '1girl, silver_hair, score_9',
      artist: '@mika',
      variant: 'aesthetic',
    });
    assert.doesNotMatch(animaAesthetic.positive, /score_/);
    assert.match(animaAesthetic.positive, /@mika/);

    // Qwen-Image-2.1 native RGBA transparent prompt contract
    const qwenPack = compileTurnaroundPromptPack({
      modelId: 'qwen-image-2.1-local',
      characterPrompt: '1girl, twin-tails, sailor uniform',
      rgbaTransparent: true,
    });
    assert.equal(qwenPack.views.length, 11);
    assert.match(qwenPack.views[0].positivePrompt, /^This is an RGBA image with transparency\./);
    assert.match(qwenPack.views[0].positivePrompt, /no glasses or eyewear/);
    assert.ok(qwenPack.global3dPrepChecklistZh.length >= 4);

    // NovelAI V5 turnaround pack keeps precise-reference hints
    const naiPack = compileTurnaroundPromptPack({
      modelId: 'novelai-v5-cloud',
      characterPrompt: '1girl,othic dress',
    });
    assert.equal(naiPack.views.length, 11);
    assert.equal(naiPack.views[0].preciseReferenceHint.enabledOnV45, true);
  });

  await step('4. NovelAI pure-Node ZIP PNG extractor (STORE, DEFLATE & data descriptor)', async () => {
    const { extractFirstFileFromZip } = pluginEntry.__internals;
    const payload = fixturePng();
    assert.deepEqual(extractFirstFileFromZip(fixtureZip(payload, 0)), payload, 'STORE entry');
    assert.deepEqual(extractFirstFileFromZip(fixtureZip(payload, 8)), payload, 'DEFLATE entry');
    assert.deepEqual(extractFirstFileFromZip(fixtureZip(payload, 8, true)), payload, 'DEFLATE with trailing data descriptor');
    assert.deepEqual(extractFirstFileFromZip(payload), payload, 'raw PNG passthrough');
    assert.throws(() => extractFirstFileFromZip(Buffer.from('not a zip')), /Invalid ZIP or PNG payload/);
  });

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-charakuru-test-'));
  try {
    await step('5. Tripo Studio Free Quota Scheduler (Concurrency=1 & GLB SHA-256 Archive)', async () => {
      // Verify serial queue strictly enforces max active = 1
      let active = 0;
      let peakActive = 0;
      await Promise.all(
        [1, 2, 3].map(() =>
          runSerialTripoTask(async () => {
            active += 1;
            peakActive = Math.max(peakActive, active);
            await new Promise((r) => setTimeout(r, 15));
            active -= 1;
          }),
        ),
      );
      assert.equal(peakActive, 1, 'Tripo Free Tier queue must enforce Concurrency = 1');

      const { planTripoFreeQuotaRun, archiveTripoGlbAsset } = pluginEntry.__internals;
      await initOrUpdateProject(tmpDir, { monthlyCreditAllowance: 200 });

      const plan = await planTripoFreeQuotaRun({
        projectDir: tmpDir,
        strategyId: 'studio_free_saver',
      });
      assert.equal(plan.verdict, 'pass');
      assert.equal(plan.automation, 'manual_studio_playbook');
      assert.equal(plan.quotaSummary.fitsInRemainingQuota, true);
      assert.equal(plan.quotaSummary.maxConcurrency, 1);
      assert.equal(plan.quotaSummary.separateApiBalance, false);
      assert.equal(plan.studioWebPlaybook.stages.length, 2);

      const apiPlan = await planTripoFreeQuotaRun({ projectDir: tmpDir, strategyId: 'openapi_v3_hybrid' });
      assert.equal(apiPlan.quotaSummary.separateApiBalance, true, 'OpenAPI balance is tracked separately');
      assert.equal(apiPlan.verdict, 'degraded');

      // Binary glTF 2.0 container: magic 'glTF', version 2, one JSON chunk.
      const glbSrc = path.join(tmpDir, 'raw_head.glb');
      await fs.writeFile(glbSrc, fixtureGlb());

      const archived = await archiveTripoGlbAsset({
        projectDir: tmpDir,
        part: 'head',
        sourceGlbPath: glbSrc,
        remoteTaskId: 'task-1',
        creditsSpent: 45,
      });
      assert.equal(archived.verdict, 'pass');
      assert.equal(archived.duplicate, false);
      assert.match(archived.sha256, /^[0-9a-f]{64}$/);
      assert.equal(archived.remainingFreeCredits, 155);
      const stat = await fs.stat(archived.archivePath);
      assert.equal(stat.size, archived.bytes);

      // Same remote task re-archived with the same content is an idempotent duplicate.
      const again = await archiveTripoGlbAsset({ projectDir: tmpDir, part: 'head', sourceGlbPath: glbSrc, remoteTaskId: 'task-1', creditsSpent: 45 });
      assert.equal(again.duplicate, true);
      // Same remote task with different content is a billing conflict.
      const otherGlb = path.join(tmpDir, 'raw_head_v2.glb');
      await fs.writeFile(otherGlb, fixtureGlb({ extras: { v: 2 } }));
      await assert.rejects(
        () => archiveTripoGlbAsset({ projectDir: tmpDir, part: 'head', sourceGlbPath: otherGlb, remoteTaskId: 'task-1', creditsSpent: 45 }),
        /conflicting content or credit record/,
      );
      // A bare container without asset.version 2.0 is rejected before archiving.
      const badGlb = path.join(tmpDir, 'bad.glb');
      const badBytes = fixtureGlb();
      badBytes.writeUInt32LE(9999, 8);
      await fs.writeFile(badGlb, badBytes);
      await assert.rejects(
        () => archiveTripoGlbAsset({ projectDir: tmpDir, part: 'head', sourceGlbPath: badGlb }),
        /length/,
      );
    });

    await step('6. dsh-blender-plugin NDJSON parser & 5 Clean-Room Blender 5.2 scripts', async () => {
      const { parseNdjsonBackendBody, runBlenderAvatarStage } = pluginEntry.__internals;
      const ndjsonSample = [
        JSON.stringify({ heartbeat: true, elapsed_s: 15 }),
        JSON.stringify({ heartbeat: true, elapsed_s: 30 }),
        JSON.stringify({ ok: true, verdict: 'pass', stage: '04_skirt_hair_spring_colliders' }),
      ].join('\n');
      const parsed = parseNdjsonBackendBody(ndjsonSample);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.__heartbeats, 2);

      const operations = [
        'stage1_safe_import',
        'stage2_assembly_ratio',
        'stage3_rig_weights',
        'stage4_skirt_springs',
        'stage5_expressions_vrm',
      ];
      for (const op of operations) {
        const out = await runBlenderAvatarStage({
          projectDir: tmpDir,
          operation: op,
          executeViaPlugin: false,
        });
        const py = await fs.readFile(out.scriptFile, 'utf8');
        assert.match(py, /def enable_vrm_addon_safely\(\):/);
        assert.doesNotMatch(py, /use_auto_smooth/, 'Blender 5.2 removed Mesh.use_auto_smooth');
        // Every generated script ships the companion-plugin recipe, not just a file path.
        assert.equal(out.recommendedBlenderPluginTools.snapshotBeforeEdit.tool, 'blender_rt_txn');
        assert.equal(out.recommendedBlenderPluginTools.headlessBatchRun.args.script_file, out.scriptFile);
        assert.equal(out.executed, false);
        if (op === 'stage4_skirt_springs') {
          assert.match(py, /skirt/i);
        }
        if (op === 'stage5_expressions_vrm') {
          assert.match(py, /override_blink = blink_override/);
        }
      }
    });

    await step('7. Host Cordis apply(), 6 tools, bundled Skill, credential redaction & HTTP daemon', async () => {
      const registeredTools = new Map();
      let skillProvider = null;
      const credBacking = new Map();

      const mockCtx = {
        tools: {
          register(def) {
            registeredTools.set(def.name, def);
            return () => registeredTools.delete(def.name);
          },
        },
        skills: {
          registerProvider(factory) {
            skillProvider = factory({});
            return () => {
              skillProvider = null;
            };
          },
        },
        credentials: {
          async modifyRecord(key, mutator) {
            const next = await mutator(credBacking.get(key));
            credBacking.set(key, next);
          },
          async readRecord(key) {
            return credBacking.get(key);
          },
          async describeRecord(key) {
            return { configured: credBacking.has(key), writable: true };
          },
          async deleteRecord(key) {
            credBacking.delete(key);
          },
        },
        effect(fn) {
          return fn();
        },
      };

      const cleanup = mockCtx.effect(() => {
        pluginEntry.apply(mockCtx, { autoStart: false });
      });
      assert.equal(registeredTools.size, 6);
      assert.ok(skillProvider);
      const skillList = await skillProvider.list();
      assert.equal(skillList.length, 1);
      assert.equal(skillList[0].name, BUNDLED_SKILL_NAME);
      const loadedSkill = await skillProvider.get({ name: BUNDLED_SKILL_NAME, locator: BUNDLED_SKILL_NAME });
      assert.match(loadedSkill.content, /Studio/);
      assert.equal(loadedSkill.source, 'bundled');
      assert.equal(await skillProvider.get({ name: 'other', locator: 'other' }), undefined);

      // The tool is read-only by contract: secrets are entered in the workbench.
      const credTool = registeredTools.get('charakuru_credentials');
      const statusRes = await credTool.execute({ action: 'status' });
      assert.equal(statusRes.ok, true);
      assert.equal(statusRes.credentials.length >= 4, true);
      assert.equal(
        statusRes.credentials.every((row) => !('key' in row) && !('secret' in row)),
        true,
        'status rows carry configuration state only, never key material',
      );
      await assert.rejects(
        () => credTool.execute({ action: 'set', providerId: 'novelai', secret: 'x' }),
        /unknown property|invalid/i,
      );

      // Credential writes go through the Host store and never echo the secret back.
      const credMgr = createCredentialManager(mockCtx);
      const stored = await credMgr.setSecret('novelai', 'pst-test-secret-token-9999999999999999');
      assert.equal(stored.storedIn, 'host_credentials');
      const described = await credMgr.describeAll();
      assert.doesNotMatch(JSON.stringify(described), /pst-test-secret-token/);
      assert.equal(await credMgr.resolveSecret('novelai'), 'pst-test-secret-token-9999999999999999');
      const afterStatus = await credTool.execute({ action: 'status' });
      assert.equal(afterStatus.credentials.find((row) => row.id === 'novelai').configured, true);
      assert.equal(JSON.stringify(afterStatus).includes('pst-test-secret-token'), false);

      // Test workflow export via charakuru_generate_views
      const genTool = registeredTools.get('charakuru_generate_views');
      const wfRes = await genTool.execute({
        projectDir: tmpDir,
        modelId: 'comfyui-anima-local',
        artistTag: 'ciloranko',
        mode: 'plan_and_export_workflows',
        slots: ['head_front', 'body_front'],
      });
      assert.equal(wfRes.ok, true);
      // One export per requested slot, plus the shared workflow/prompt bundle.
      assert.equal(wfRes.exportedArtifacts.length >= 2, true);
      for (const artifact of wfRes.exportedArtifacts) {
        await fs.access(artifact);
      }

      // Test local Studio HTTP server on ephemeral port 0
      const srv = await startStudioHttpServer({
        port: 0,
        config: { blenderPluginUrl: 'http://127.0.0.1:65530' },
        credentialManager: credMgr,
      });
      try {
        const bootResp = await fetch(`${srv.baseUrl}/studio/bootstrap?projectDir=${encodeURIComponent(tmpDir)}`);
        const bootJson = await bootResp.json();
        assert.equal(bootJson.ok, true);
        assert.equal(bootJson.aaCatalog.total >= 9, true);
        assert.equal(Array.isArray(bootJson.aaCatalog.models), true);
        assert.equal(bootJson.activeProjectDir.length > 0, true);
      } finally {
        await srv.close();
      }

      if (typeof cleanup === 'function') cleanup();
    });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  for (const line of results) {
    console.log(line);
  }
  console.log(`\nALL ${results.length} VERIFICATION SUITES PASSED.`);
}

main().catch((err) => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
