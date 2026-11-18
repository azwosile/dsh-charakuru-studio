import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadProjectState } from './state.js';
export function createProjectRegistry(file = path.join(os.homedir(), '.dsh', 'charakuru-studio', 'recent-projects.json')) {
  let tail = Promise.resolve();
  async function list() {
    try { const j = JSON.parse(await fs.readFile(file, 'utf8')); return Array.isArray(j.projects) ? j.projects.slice(0,20) : []; }
    catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  }
  function remember(projectDir) {
    const next = tail.then(async () => {
      const loaded = await loadProjectState(projectDir);
      if (!loaded.exists) throw new Error('工程不存在，请先创建或选择已有工程目录');
      const all = await list(), normalized = path.resolve(projectDir);
      const projects = [{ projectDir: normalized, projectId: loaded.state.projectId, projectName: loaded.state.projectName, openedAt: new Date().toISOString() }, ...all.filter(p => path.resolve(p.projectDir) !== normalized)].slice(0,20);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp-' + crypto.randomUUID();
      try { await fs.writeFile(tmp, JSON.stringify({ version: 1, projects }, null, 2), { flag: 'wx' }); await fs.rename(tmp,file); }
      finally { await fs.rm(tmp, { force: true }); }
      return loaded;
    });
    tail = next.catch(() => {}); return next;
  }
  return { list, remember };
}
