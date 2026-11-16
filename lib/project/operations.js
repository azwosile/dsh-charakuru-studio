import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const running = new Set();
// Covers long-running output work without holding the state mutation lock.
export async function exclusiveProjectOperation(projectDir, operation) {
  const absolute = path.resolve(projectDir);
  const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  if (running.has(key)) throw new Error('Another output operation is running for this project');
  running.add(key);
  try { return await operation(); } finally { running.delete(key); }
}
export async function writeArtifactAtomic(file, bytes) {
  const temp = `${file}.tmp-${crypto.randomUUID()}`;
  try { await fs.writeFile(temp, bytes, { flag: 'wx' }); await fs.rename(temp, file); }
  finally { await fs.rm(temp, { force: true }); }
}
