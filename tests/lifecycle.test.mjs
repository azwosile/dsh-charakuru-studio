import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, inject } from '../lib/index.js';
import { createCredentialManager } from '../lib/host/credentials.js';
import { registerBundledStudioSkill } from '../lib/host/skill.js';

// Exercise resource ownership without a UI renderer or profile mutation.
test('Host lifecycle registers seven tools and a readable skill, then disposes everything', async () => {
  const registered = new Map(); let effectCleanup, factory, providerDisposed = false;
  const ctx = {
    effect(fn) { effectCleanup = fn(); },
    tools: { register(def) { assert.ok(def.output.schema); assert.equal(typeof def.output.render, 'function'); registered.set(def.name, def); return () => registered.delete(def.name); } },
    skills: { registerProvider(fn) { factory = fn; return () => { providerDisposed = true; }; } },
  };
  apply(ctx, { autoStart: false });
  assert.equal(registered.size, 7);
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

test('Host lifecycle handles strict Cordis 4 Proxy without webServer inject and cleans up cleanly', async () => {
  assert.equal(Array.isArray(inject), true);
  assert.deepEqual(inject, ['tools', 'skills', 'credentials']);

  const ALLOWED_PROPS = new Set(['effect', 'get', 'tools', 'skills', 'credentials']);

  async function runCase(webServerService) {
    const registered = new Map();
    let effectCleanup;
    let providerDisposed = false;
    const services = {
      tools: { register(def) { registered.set(def.name, def); return () => registered.delete(def.name); } },
      skills: { registerProvider() { return () => { providerDisposed = true; }; } },
      credentials: undefined,
      webServer: webServerService,
    };
    const rawCtx = {
      effect(fn) { effectCleanup = fn(); },
      get(name) { return services[name]; },
      tools: services.tools,
      skills: services.skills,
      credentials: services.credentials,
    };
    const proxyCtx = new Proxy(rawCtx, {
      get(target, prop, receiver) {
        if (!ALLOWED_PROPS.has(prop)) {
          throw new Error('cannot get property "' + String(prop) + '" without inject');
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    assert.throws(() => proxyCtx.webServer, /cannot get property "webServer" without inject/);

    const startupErrors = [];
    const origError = console.error;
    console.error = (...args) => { startupErrors.push(args.map(String).join(' ')); };
    const config = { autoStart: true, port: 0 };
    try {
      assert.doesNotThrow(() => apply(proxyCtx, config));
      const deadline = Date.now() + 500;
      while (config.port === 0 && startupErrors.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    } finally {
      console.error = origError;
      if (typeof effectCleanup === 'function') effectCleanup();
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    assert.deepEqual(startupErrors, []);
    assert.ok(config.port > 0);
    assert.equal(registered.size, 0);
    assert.equal(providerDisposed, true);
  }

  await runCase({ getOrigin: () => 'http://127.0.0.1:51886' });
  await runCase(undefined);
});

test('Safe Cordis service lookup in credentials and skill providers tolerates throwing Proxy getters', async () => {
  const makeStrictGetOnlyProxy = (services) => new Proxy({ get: (name) => services[name] }, {
    get(target, prop, receiver) {
      if (prop !== 'get') {
        throw new Error('cannot get property "' + String(prop) + '" without inject');
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  let skillDisposed = false;
  const presentProxy = makeStrictGetOnlyProxy({
    skills: { registerProvider() { return () => { skillDisposed = true; }; } },
    credentials: { describeRecord: async () => ({ configured: false, writable: false }) },
  });
  const disposeSkill = registerBundledStudioSkill(presentProxy);
  disposeSkill();
  assert.equal(skillDisposed, true);
  const creds = await createCredentialManager(presentProxy).describeAll();
  assert.ok(Array.isArray(creds) && creds.length > 0);

  const absentProxy = makeStrictGetOnlyProxy({});
  assert.doesNotThrow(() => registerBundledStudioSkill(absentProxy)());
  await assert.rejects(createCredentialManager(absentProxy).setSecret('novelai', 'test'), /unavailable/);
});
