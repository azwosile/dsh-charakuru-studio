import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';

// Exercise resource ownership without a UI renderer or profile mutation.
test('Host lifecycle registers six tools and a readable skill, then disposes everything', async () => {
  const registered = new Map(); let effectCleanup, factory, providerDisposed = false;
  const ctx = {
    effect(fn) { effectCleanup = fn(); },
    tools: { register(def) { assert.ok(def.output.schema); assert.equal(typeof def.output.render, 'function'); registered.set(def.name, def); return () => registered.delete(def.name); } },
    skills: { registerProvider(fn) { factory = fn; return () => { providerDisposed = true; }; } },
  };
  apply(ctx, { autoStart: false });
  assert.equal(registered.size, 6);
  const provider = factory({});
  const candidates = await provider.list({});
  assert.equal(candidates.length, 1);
  const definition = await provider.get(candidates[0], {});
  assert.equal(definition.name, 'charakuru-vrm-studio');
  assert.ok(definition.content.includes('degraded'));
  assert.equal(definition.resourceBase.kind, 'directory');
  assert.equal(await provider.get({ name: 'other', locator: 'other' }, {}), undefined);
  const catalog = await registered.get('charakuru_aa_models').execute({});
  assert.ok(catalog.models.length >= 3);
  effectCleanup();
  assert.equal(registered.size, 0);
  assert.equal(providerDisposed, true);
});
