import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

export async function buildClientSource(rootUrl = new URL('../', import.meta.url)) {
  const bundled = await build({
    entryPoints: [fileURLToPath(new URL('src/viewport-entry.js', rootUrl))],
    bundle: true, write: false, format: 'iife', globalName: 'StudioThree',
    minify: true, legalComments: 'inline', target: 'es2022',
  });
  const text = async rel => (await fs.readFile(new URL(rel, rootUrl), 'utf8')).replace(/\r\n/g, '\n');
  const { version } = JSON.parse(await text('package.json'));
  if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw new Error('Invalid package version');
  const materials = await text('src/client-materials.js');
  const workbench = await text('src/client-workbench.js');
  const render = await text('src/client-render.js');
  const images = await text('src/client-images.js');
  const tripo = await text('src/client-tripo.js');
  const workbenchCss = await text('src/client-workbench.css');
  const preview = await text('lib/client-preview.js');
  let shell = (await text('src/client-shell.js'))
    .replace('__STUDIO_PACKAGE_VERSION__', version)
    .replace(/CLIENT_VERSION\s*=\s*'[^']*'/, () => `CLIENT_VERSION = '${version}'`);
  shell = shell.replace("    var React = require('react');", () => bundled.outputFiles[0].text + "\n    var React = require('react');");
  shell = shell.replace(/\/\* PREVIEW_START \*\/[\s\S]*?\/\* PREVIEW_END \*\//, () => '/* PREVIEW_START */\n' + preview + '\n    /* PREVIEW_END */');
  shell = shell.replace(/\/\* MATERIALS_START \*\/[\s\S]*?\/\* MATERIALS_END \*\//, () => '/* MATERIALS_START */\n' + materials + '\n    /* MATERIALS_END */');
  shell = shell.replace('/* WORKBENCH_START */', () => [workbench, render, images, tripo].join('\n'));
  shell = shell.replace('/* WORKBENCH_CSS */', () => JSON.stringify(workbenchCss) + ' +');
  if (!shell.includes(`CLIENT_VERSION = '${version}'`)) throw new Error('Failed to inject CLIENT_VERSION into client bundle');
  return shell;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = new URL('../', import.meta.url);
  const shell = await buildClientSource(root);
  await fs.writeFile(new URL('lib/client.js', root), shell);
  console.log('Built offline Three.js / VRM viewport into the lazy DSH client factory');
}
