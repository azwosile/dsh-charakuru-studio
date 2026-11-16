import fs from 'node:fs/promises';
async function patch(file, before, after) {
  const text = await fs.readFile(file, 'utf8');
  if (!text.includes(before)) throw new Error(`Patch missing: ${file}: ${before.slice(0,80)}`);
  await fs.writeFile(file, text.replace(before, after));
}
await patch('lib/providers/image-router.js', 'export async function runTurnaroundGeneration({', `export function runTurnaroundGeneration(options = {}) {
  return exclusiveProjectOperation(options.projectDir, () => generateViews(options));
}
async function generateViews({`);
await patch('lib/providers/image-router.js', 'referenceImage: refPath,', 'referenceImage: refPath ? path.resolve(absRoot, refPath) : null,');
await patch('lib/providers/image-router.js', 'await fs.writeFile(outFile, pngBytes);', 'await writeArtifactAtomic(outFile, pngBytes);');
await patch('lib/providers/image-router.js', 'Store token via charakuru_credentials or NOVELAI_API_KEY.', 'Use the workbench credential form or NOVELAI_API_KEY.');
await patch('lib/providers/image-router.js', 'Store via charakuru_credentials or GEMINI_API_KEY.', 'Use the workbench credential form or GEMINI_API_KEY.');
await patch('lib/blender/bridge.js', 'export async function runBlenderAvatarStage({', `export function runBlenderAvatarStage(options = {}) {
  return exclusiveProjectOperation(options.projectDir, () => runStage(options));
}
async function runStage({`);
await patch('lib/client.js', "prompt: data.projectState ? data.projectState.characterSpec.characterPrompt : old.prompt, allowance:", "model: data.projectState ? data.projectState.characterSpec.preferredImageModel : old.model, prompt: data.projectState ? data.projectState.characterSpec.characterPrompt : old.prompt, allowance:");
await patch('lib/client.js', "var state = boot && boot.projectState, summary = boot && boot.projectSummary;", "var matchesProject = boot && (!f.projectDir || f.projectDir === boot.activeProjectDir);\n        var state = matchesProject && boot.projectExists ? boot.projectState : null, summary = state && boot.projectSummary;");
await patch('lib/client.js', "actions = props.inputActions, span = actions.captureInsertion();", "actions = props.inputActions; if (!actions || typeof actions.captureInsertion !== 'function' || typeof actions.insertText !== 'function') throw new Error(t('draftChanged')); var span = actions.captureInsertion();");
await patch('lib/project/state.js', "if (options.characterPrompt) state.characterSpec.characterPrompt = String(options.characterPrompt);", "if (options.characterPrompt !== undefined) state.characterSpec.characterPrompt = String(options.characterPrompt);");
console.log('Final source patches applied');
