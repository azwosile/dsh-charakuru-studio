/**
 * dsh-charakuru-studio — Bundled Skill Provider (`charakuru-vrm-studio`).
 * Exposes `async list()` and `async get(name)` per DSH's `skills.registerProvider` contract.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BUNDLED_SKILL_NAME = 'charakuru-vrm-studio';
export const BUNDLED_SKILL_PATH = path.resolve(__dirname, '..', '..', 'skills', BUNDLED_SKILL_NAME, 'SKILL.md');

export function parseSkillMarkdown(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(String(raw || ''));
  if (!match) {
    return {
      name: BUNDLED_SKILL_NAME,
      description: 'Clean-Room 2D character illustration to expressive VRM 1.0 studio workflow.',
      body: String(raw || '').trim(),
    };
  }
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }
  return {
    name: meta.name || BUNDLED_SKILL_NAME,
    description: meta.description || '',
    body: match[2].trim(),
  };
}

export function registerBundledStudioSkill(ctx) {
  const skillsSvc = ctx?.skills || ctx?.get?.('skills');
  if (!skillsSvc || typeof skillsSvc.registerProvider !== 'function') {
    return () => {};
  }

  const provider = 'dsh-charakuru-studio';
  async function summary() {
    const raw = await fs.readFile(BUNDLED_SKILL_PATH, 'utf8');
    const parsed = parseSkillMarkdown(raw);
    return { parsed, value: {
      name: parsed.name, description: parsed.description,
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'bundled', provider, path: BUNDLED_SKILL_PATH,
      resourceBase: { kind: 'directory', path: path.dirname(BUNDLED_SKILL_PATH) },
    } };
  }
  return skillsSvc.registerProvider(() => ({
    name: provider,
    async list() {
      const { value } = await summary();
      return [{ ...value, rank: 25, locator: BUNDLED_SKILL_NAME }];
    },
    async get(candidate) {
      if (candidate.name !== BUNDLED_SKILL_NAME || candidate.locator !== BUNDLED_SKILL_NAME) return undefined;
      const { parsed, value } = await summary();
      return { ...value, content: parsed.body };
    },
  }));
}
