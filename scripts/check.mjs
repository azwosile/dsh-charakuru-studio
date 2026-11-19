import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as stages from '../lib/blender/cleanroom-scripts.js';
import { PLUGIN_VERSION } from '../lib/constants.js';
import { buildQwenLocalDiffusersScript } from '../lib/providers/image-router.js';
import { compileTurnaroundPromptPack } from '../lib/catalog/aa-image-hub.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function walk(dir) { const out = []; for (const item of await fs.readdir(dir, { withFileTypes: true })) { const p = path.join(dir, item.name); if (item.isDirectory()) out.push(...await walk(p)); else out.push(p); } return out; }
function run(exe, args) { const res = spawnSync(exe, args, { cwd: root, stdio: 'inherit', timeout: 30000 }); if (res.error) throw res.error; if (res.status !== 0) throw new Error(`Check exited ${res.status}: ${exe}`); }
const files = (await Promise.all(['lib', 'src', 'scripts', 'tests'].map(dir => walk(path.join(root, dir))))).flat().filter(p => p.endsWith('.js') || p.endsWith('.mjs'));
for (const p of files) run(process.execPath, ['--check', p]);
const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
if (manifest.version !== PLUGIN_VERSION) throw new Error(`Version mismatch: package.json=${manifest.version}, PLUGIN_VERSION=${PLUGIN_VERSION}`);
for (const rel of ['src/client-shell.js', 'lib/client.js']) {
  const src = await fs.readFile(path.join(root, rel), 'utf8');
  if (!src.includes(`CLIENT_VERSION = '${manifest.version}'`)) throw new Error(`Client version mismatch in ${rel}: expected CLIENT_VERSION = '${manifest.version}'`);
}
for (const p of [manifest.main, manifest.types, manifest.icon, manifest.dsh.bundle.patch, './lib/client.js']) await fs.access(path.resolve(root, p));
for (const locale of ['en', 'zh']) {
  const raw = await fs.readFile(path.join(root, 'locale', locale + '.json'), 'utf8');
  if (locale === 'en' && /[\u4e00-\u9fff]/.test(raw)) throw new Error('locale/en.json must not contain CJK characters');
  const meta = JSON.parse(raw).meta;
  if (!meta.title || !meta.description || !meta.detail) throw new Error(`Missing metadata in locale/${locale}.json`);
  await fs.access(path.join(root, meta.detail));
}
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'charastudio-syntax-'));
try {
  const options = { inputBlendPath: 'C:\\项目\\input.blend', existingBlendPath: 'C:\\项目\\input.blend', headGlbPath: 'C:\\项目\\head.glb', bodyGlbPath: 'C:\\项目\\body.glb', outputBlendPath: 'C:\\项目\\output.blend', outputVrmPath: 'C:\\项目\\avatar.vrm', vrmMeta: { title: `quote'"\\\n中文`, authors: ['fixture'], allowRedistribution: false } };
  await fs.copyFile(path.join(root,'lib/blender/studio-pipeline.py'),path.join(temp,'studio_pipeline.py'));
  await fs.copyFile(path.join(root,'lib/blender/render-studio.py'),path.join(temp,'render_studio.py'));
  await fs.copyFile(path.join(root,'lib/blender/inspect-foundation.py'),path.join(temp,'inspect_foundation.py'));
  for (const [name, generator] of Object.entries(stages)) await fs.writeFile(path.join(temp, name + '.py'), generator(options));
  for (const referenceImage of [null, 'C:\\项目\\ref.png']) await fs.writeFile(path.join(temp, referenceImage ? 'qwen_ref.py' : 'qwen.py'), buildQwenLocalDiffusersScript({ projectDir: temp, views: compileTurnaroundPromptPack({ characterPrompt: `quote'"\\\n中文` }).views, referenceImage }));
  const python = process.env.DSH_CHECK_PYTHON || process.env.DSH_PYTHON_EXECUTABLE || 'python';
  run(python, ['-c', 'import ast,pathlib,sys; files=list(pathlib.Path(sys.argv[1]).glob("*.py")); [ast.parse(p.read_text(encoding="utf-8"), filename=str(p)) for p in files]; print("Python AST:",len(files),"generated scripts passed")', temp]);
} finally { await fs.rm(temp, { recursive: true, force: true }); }
console.log(`JavaScript syntax: ${files.length} files passed; package resource paths passed`);
