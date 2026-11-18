import os from 'node:os';
import path from 'node:path';

// Respect the official Desktop/Host data root (including an isolated DSH_HOME).
// Keep the historical location when the operator hasn't set a separate root.
export function studioHome(...segments) {
  const configured = process.env.DSH_HOME?.trim();
  return path.resolve(configured || path.join(os.homedir(), '.dsh'), 'charakuru-studio', ...segments);
}
