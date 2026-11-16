import fs from 'node:fs/promises';
async function patch(file, pairs) { let s = await fs.readFile(file, 'utf8'); for (const [a,b] of pairs) { if (!s.includes(a)) throw new Error(`Missing target in ${file}: ${a.slice(0,70)}`); s = s.replace(a,b); } await fs.writeFile(file,s); }
await patch('lib/project/state.js', [
  ['const key = path.resolve(projectDir).toLowerCase();', "const resolved = path.resolve(projectDir);\n  const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;"],
  ["  const loaded = await loadProjectState(projectDir);\n  if (!loaded.exists || !loaded.state) {", "  for (const key of ['headBodyRatio', 'neckScaleFactor']) if (options[key] !== undefined && (!Number.isFinite(options[key]) || options[key] <= 0)) throw new Error(`${key} must be positive and finite`);\n  if (options.monthlyCreditAllowance !== undefined && (!Number.isFinite(options.monthlyCreditAllowance) || options.monthlyCreditAllowance < 0)) throw new Error('Invalid monthly allowance');\n  const loaded = await loadProjectState(projectDir);\n  if (!loaded.exists || !loaded.state) {"],
  ['  if (options.tripoStrategy) {', "  if (options.monthlyCreditAllowance !== undefined) state.tripoQuota.monthlyAllowance = options.monthlyCreditAllowance;\n  if (options.tripoStrategy) {"],
  ['Number(state.tripoQuota?.monthlyAllowance || 200)', 'Number(state.tripoQuota?.monthlyAllowance ?? 200)'],
  ['monthlyAllowance: state.tripoQuota?.monthlyAllowance || 200,', 'monthlyAllowance: state.tripoQuota?.monthlyAllowance ?? 200,'],
  ["if (action === 'reject' && stage.status !== 'awaiting_review')", "if (action === 'reject' && (actor !== 'user' || stage.status !== 'awaiting_review'))"],
]);
await patch('lib/catalog/aa-image-hub.js', [
  ['1) Live AA-Image-T2I', '1) Snapshot AA-Image-T2I'],
  ["updatedAt: '2026-11',", "updatedAt: '2026-11-16',\n  snapshot: true,\n  apiIdsVerified: false,\n  note: 'Leaderboard names are not API model identifiers. Cloud execution requires an explicit model ID from your provider.',"],
  ["    hfRepo: 'Qwen/Qwen-Image-2.1',", "    hfRepo: 'Qwen/Qwen-Image-2.1',\n    licenseNotice: 'Qwen Research License; model weights are separate from this MIT plugin.',"],
  ["    hfRepo: 'circlestone-labs/Anima',", "    hfRepo: 'circlestone-labs/Anima',\n    licenseNotice: 'Anima weights have separate noncommercial terms; consult model license and output terms.',"],
  ["    .filter(Boolean)\n    .map((tag)", "    .filter(Boolean)\n    .filter(tag => variant !== 'aesthetic' || !/^score[_ ]/.test(tag))\n    .map((tag)"],
  ["  const model = IMAGE_MODEL_CATALOG.find((m) => m.id === modelId) || IMAGE_MODEL_CATALOG[0];\n  const selectedSlots", "  const model = IMAGE_MODEL_CATALOG.find((m) => m.id === modelId);\n  if (!model) throw new Error(`Unknown image model: ${modelId}`);\n  if (!['base', 'aesthetic', 'turbo'].includes(animaVariant)) throw new Error('Invalid Anima variant');\n  if (!Array.isArray(slots) || !slots.length || slots.some(id => !REQUIRED_VIEW_SLOTS.some(s => s.id === id))) throw new Error('slots must contain valid view IDs');\n  const selectedSlots"],
]);
await patch('lib/providers/image-router.js', [
  ["type: 'qwen_image',", "type: 'stable_diffusion',"],
  ["class_type: 'EmptySD3LatentImage',", "class_type: 'EmptyLatentImage',"],
  ["clip_name: 'qwen_3_06b_base.safetensors',", "clip_name: modelFiles.clip || 'qwen_3_06b_base.safetensors',"],
  ["vae_name: 'qwen_image_vae.safetensors',", "vae_name: modelFiles.vae || 'qwen_image_vae.safetensors',"],
  ["steps: isTurbo ? 10 : 36,", "steps: isTurbo ? 8 : 30,"],
  ["sampler_name: isTurbo ? 'euler' : 'er_sde',", "sampler_name: 'euler',"],
  ["scheduler: 'normal',", "scheduler: 'simple',"],
  ["  };\n}\n\n/**\n * Build a standalone", "  };\n  if (isTurbo) {\n    workflow[10] = { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: modelFiles.lora || 'anima-turbo-lora-v0.2.safetensors', strength_model: 1 } };\n    workflow[7].inputs.model = ['10', 0];\n  }\n  return workflow;\n}\n\n/**\n * Build a standalone"],
  ['REF_IMAGE = ${JSON.stringify(referenceImage)}', "REF_IMAGE = json.loads(${JSON.stringify(JSON.stringify(referenceImage))})"],
  ["VIEWS = json.loads(r'''${serializedViews}''')", 'VIEWS = json.loads(${JSON.stringify(serializedViews)})'],
  ['    ref_img = Image.open(REF_IMAGE).convert("RGBA") if (REF_IMAGE and os.path.exists(REF_IMAGE)) else None', '    if REF_IMAGE and not os.path.isfile(REF_IMAGE):\n        raise FileNotFoundError(REF_IMAGE)\n    ref_img = Image.open(REF_IMAGE).convert("RGBA") if REF_IMAGE else None'],
  ["  while (Date.now() < deadline) {", "  while (Date.now() < deadline) {"],
  ["    if (!record || !record.outputs) continue;", "    if (record?.status?.status_str === 'error') throw new Error('ComfyUI execution failed; inspect its history');\n    if (!record || !record.outputs) continue;"],
  ["  rgbaTransparent = true,\n  fetchImpl = fetch,\n}) {\n  const endpoint", "  rgbaTransparent = true,\n  referenceImageBuffer = null,\n  fetchImpl = fetch,\n}) {\n  if (referenceImageBuffer) throw new Error('Reference editing is not configured for this OpenAI-compatible adapter; use Qwen offline runner or Gemini');\n  const endpoint"],
  ['?key=${encodeURIComponent(apiKey)}', ''],
  ["headers: { 'Content-Type': 'application/json' },\n    body: JSON.stringify({\n      contents:", "headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },\n    body: JSON.stringify({\n      contents:"],
  ["  secrets = {},\n  fetchImpl = fetch,", "  secrets = {},\n  modelFiles = {},\n  timeoutMs = 180000,\n  fetchImpl = fetch,"],
  ["  const absRoot = await ensureProjectLayout(projectDir);", "  if (!['plan_and_export_workflows', 'execute'].includes(mode)) throw new Error('Invalid generation mode');\n  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 1800000) throw new Error('Invalid image request timeout');\n  const absRoot = await ensureProjectLayout(projectDir);"],
  ["  const state = loaded.state || null;", "  if (!loaded.exists) throw new Error('Initialize project before generating views');\n  const state = loaded.state;"],
  ["  const modelEntry = IMAGE_MODEL_CATALOG.find((m) => m.id === modelId) || IMAGE_MODEL_CATALOG[0];", "  const modelEntry = IMAGE_MODEL_CATALOG.find((m) => m.id === modelId);\n  if (mode === 'execute' && !['qwen_local', 'comfyui_anima'].includes(modelEntry.driver) && !apiModelOverride.trim()) throw new Error('Cloud execution requires explicit apiModelOverride from the provider; leaderboard names are not API IDs');"],
  ["        variant: animaVariant,\n        filenamePrefix:", "        variant: animaVariant,\n        modelFiles,\n        filenamePrefix:"],
  ["          variant: animaVariant,\n          filenamePrefix:", "          variant: animaVariant,\n          modelFiles,\n          filenamePrefix:"],
  ["    try {\n      refBuffer = await fs.readFile(refPath);\n    } catch {\n      refBuffer = null;\n    }", "    refBuffer = await fs.readFile(path.resolve(absRoot, refPath));\n    validatePng(refBuffer);\n    if (modelEntry.driver === 'comfyui_anima') throw new Error('Anima workflow is text-to-image only; reference conditioning requires a custom workflow');\n    if (modelEntry.driver === 'novelai' && !apiModelOverride.includes('4-5')) throw new Error('Precise Reference is configured for NovelAI V4.5 only');"],
  ["    try {\n      let pngBytes;", "    try {\n      let pngBytes = await withNetworkTimeout(fetchImpl, timeoutMs, async (boundedFetch) => {\n      let pngBytes;"],
  ["apiKey: secrets.openai_compat || '',", "apiKey: '',"],
  ["baseUrl: `${stripSlash(endpoints.qwenImageUrl || DEFAULT_QWEN_IMAGE_URL)}/v1`,", "baseUrl: `${stripSlash(endpoints.qwenImageUrl || DEFAULT_QWEN_IMAGE_URL).replace(/\\/v1$/, '')}/v1`,"],
  ["      await fs.writeFile(outFile, pngBytes);", "      return pngBytes;\n      });\n      pngBytes = validatePng(pngBytes);\n      await fs.writeFile(outFile, pngBytes);"],
  ["      if (state && state.views?.[view.slotId]) {", "      if (false && state && state.views?.[view.slotId]) {"],
]);
// Scope network injection to the execute branches, not helper declarations.
let r = await fs.readFile('lib/providers/image-router.js','utf8');
const begin = r.indexOf('let pngBytes = await withNetworkTimeout');
const end = r.indexOf('      return pngBytes;', begin);
r = r.slice(0,begin) + r.slice(begin,end).replace(/\n          fetchImpl,/g,'\n          fetchImpl: boundedFetch,').replace(/\n          rgbaTransparent,/g, '\n          rgbaTransparent,\n          referenceImageBuffer: refBuffer,') + r.slice(end);
const stateStart = r.indexOf('  if (state) {\n    state.auditLog.push');
const stateEnd = r.indexOf("  return {\n    mode: 'execute',", stateStart);
r = r.slice(0,stateStart) + `  await updateProjectState(absRoot, next => {
    for (const result of results) if (result.ok) next.views[result.slotId] = { ...next.views[result.slotId], status: 'ready', filePath: result.filePath, modelUsed: modelId, updatedAt: new Date().toISOString() };
    next.auditLog.push({ at: new Date().toISOString(), event: 'views.generated', detail: results.filter(r => r.ok).length + '/' + results.length + ' via ' + modelId });
  });
  const successCount = results.filter(r => r.ok).length;
` + r.slice(stateEnd);
r = r.replace("    mode: 'execute',\n    projectDir:", "    ok: successCount === results.length,\n    verdict: successCount === results.length ? 'pass' : successCount ? 'degraded' : 'fail',\n    mode: 'execute',\n    projectDir:");
r = r.replace("if (false && state && state.views?.[view.slotId]) {", "if (false && state && state.views?.[view.slotId]) {");
// Drop obsolete stale-state branch entirely.
const stale = r.indexOf('      if (false && state');
const staleEnd = r.indexOf('    } catch (err)',stale);
r = r.slice(0,stale) + r.slice(staleEnd);
await fs.writeFile('lib/providers/image-router.js',r);
// Manifest advertises only the runtime version that will be verified here.
const pkg = JSON.parse(await fs.readFile('package.json','utf8'));
pkg.scripts = { test: 'node --test tests/*.test.mjs', selftest: 'node --test tests/*.test.mjs', check: 'node scripts/check.mjs' };
pkg.engines.dsh = '0.2.2-rc.3';
delete pkg.dsh.compatibility;
await fs.writeFile('package.json', JSON.stringify(pkg,null,2)+'\n');
console.log('Patched state, catalog, providers and package manifest');
