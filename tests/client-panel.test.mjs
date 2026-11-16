/**
 * dsh-charakuru-studio — web client panel contract.
 *
 * The bundle runs in the DSH web renderer, which supplies React and the Cordis
 * services; nothing here is importable from Node. So this suite loads
 * `lib/client.js` in a VM, hands it a fake React with a real hook runtime and a
 * fake context that records slot registrations, then renders the page tree and
 * drives it — enough to pin the entry-point contract (sidebar row + main page,
 * never a modal) and the panel behaviour that the Host cannot test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CLIENT_FILE = path.join(ROOT, 'lib/client.js');

const NS = 'charakuru-studio-ui';
const PANEL_ID = 'charakuru-studio';
const HEADER_SEAT = 'conversation.session.header.utilities';

/** Minimal React element factory: `{ type, props, children }`. */
function createElement(type, props, ...children) {
  const flat = [];
  const push = (value) => {
    if (Array.isArray(value)) value.forEach(push);
    else flat.push(value);
  };
  children.forEach(push);
  return { type, props: props || {}, children: flat };
}

/**
 * Hook runtime: cells are allocated by call order, effects are collected during
 * render and flushed after it, so a render here behaves like a mount.
 */
function createHookRuntime() {
  const cells = [];
  const effects = [];
  let cursor = 0;
  const React = {
    createElement,
    Fragment: 'Fragment',
    useSyncExternalStore(subscribe, getSnapshot) {
      assert.equal(typeof subscribe, 'function');
      cursor += 1;
      return getSnapshot();
    },
    useId() {
      const cell = cursor;
      cursor += 1;
      if (!cells[cell]) cells[cell] = `ck${cell}`;
      return cells[cell];
    },
    useEffect(effect) {
      const cell = cursor;
      cursor += 1;
      if (!cells[cell]) {
        cells[cell] = true;
        effects.push(effect);
      }
    },
    useState(initial) {
      const cell = cursor;
      cursor += 1;
      if (!cells[cell]) cells[cell] = { value: typeof initial === 'function' ? initial() : initial };
      const slot = cells[cell];
      return [slot.value, (next) => { slot.value = typeof next === 'function' ? next(slot.value) : next; }];
    },
    useRef(initial) {
      const cell = cursor;
      cursor += 1;
      if (!cells[cell]) cells[cell] = { current: initial };
      return cells[cell];
    },
    useMemo(factory) {
      cursor += 1;
      return factory();
    },
    useCallback(fn) {
      cursor += 1;
      return fn;
    },
  };
  return {
    React,
    render(Component, props) {
      cursor = 0;
      const tree = Component(props || {});
      const pending = effects.splice(0, effects.length);
      pending.forEach((effect) => effect());
      return tree;
    },
  };
}

/** Flatten a rendered tree into host nodes (strings become `#text`). */
function flatten(node, out = []) {
  if (node === null || node === undefined || node === false || node === true) return out;
  if (Array.isArray(node)) {
    node.forEach((child) => flatten(child, out));
    return out;
  }
  if (typeof node === 'string' || typeof node === 'number') {
    out.push({ type: '#text', text: String(node), props: {}, children: [] });
    return out;
  }
  out.push(node);
  node.children.forEach((child) => flatten(child, out));
  return out;
}

const hostNodes = (tree) => flatten(tree).filter((node) => node.type !== '#text');
const textOf = (tree) => flatten(tree).filter((node) => node.type === '#text').map((node) => node.text).join(' ');
const byClass = (tree, className) => hostNodes(tree).filter((node) => String(node.props.className || '').split(' ').includes(className));
const byRole = (tree, role) => hostNodes(tree).filter((node) => node.props.role === role);

function createHarness() {
  const registrations = [];
  const injections = [];
  const services = new Map();
  const disposers = [];
  const dicts = new Map();
  const localeListeners = new Set();
  const snapshot = { active: 'en', revision: 0 };
  const locale = {
    register(namespace, value) {
      dicts.set(namespace, value);
      return () => dicts.delete(namespace);
    },
    bind(namespace) {
      return (key) => {
        const table = (dicts.get(namespace) || {})[snapshot.active] || {};
        return table[key] === undefined ? key : table[key];
      };
    },
    getSnapshot() {
      return { ...snapshot };
    },
    subscribe(listener) {
      localeListeners.add(listener);
      return () => localeListeners.delete(listener);
    },
  };
  const ctx = {
    locale,
    slots: {
      inject(key, callback) {
        injections.push({ key, callback });
        return () => {};
      },
      register(options, component) {
        registrations.push({ options, component });
        return () => {};
      },
    },
    effect(fn) {
      const disposer = fn();
      if (typeof disposer === 'function') disposers.push(disposer);
      return disposer;
    },
    get(name) {
      return services.get(name);
    },
  };
  return {
    ctx,
    registrations,
    injections,
    services,
    dispose() {
      while (disposers.length) disposers.pop()();
    },
    setLanguage(active) {
      snapshot.active = active;
      snapshot.revision += 1;
      localeListeners.forEach((listener) => listener());
    },
  };
}

let cachedSource = null;

async function loadClient() {
  if (cachedSource === null) cachedSource = await fs.readFile(CLIENT_FILE, 'utf8');
  let spec = null;
  const fetchCalls = [];
  const sandbox = {
    window: { __ModuleLoader__: { load(value) { spec = value; } } },
    console,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    navigator: { clipboard: { writeText: async () => {} } },
    fetch: async (url, init) => {
      fetchCalls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ ok: true, verdict: 'pass' }) };
    },
  };
  vm.runInNewContext(cachedSource, sandbox, { filename: 'lib/client.js' });
  const runtime = createHookRuntime();
  const requires = [];
  const moduleExports = spec.factory((id) => {
    requires.push(id);
    if (id === 'react') return runtime.React;
    throw new Error(`unexpected require: ${id}`);
  });
  return { spec, moduleExports, runtime, sandbox, fetchCalls, requires };
}

/** Apply the plugin against a fake context and materialize its slot entries. */
async function mount({ config = {}, services = {} } = {}) {
  const loaded = await loadClient();
  const harness = createHarness();
  for (const [name, value] of Object.entries(services)) harness.services.set(name, value);
  loaded.moduleExports.apply(harness.ctx, config);
  harness.injections.forEach((injection) => injection.callback());
  const entry = (name) => harness.registrations.find((item) => item.options.name === name);
  const sidebar = entry('sidebar.panellist');
  const main = entry('main');
  const face = main && typeof main.options.inject === 'function' ? main.options.inject() : {};
  return { ...loaded, harness, sidebar, main, face, entry };
}

test('the entry point is a sidebar row plus a main page, not a header modal', async () => {
  const mounted = await mount();
  const source = cachedSource;

  assert.equal(mounted.spec.id, 'dsh-charakuru-studio');
  assert.deepEqual(mounted.requires, ['react'], 'the bundle may only require host-provided react');
  // Cross-realm values: spread the arrays before comparing.
  assert.deepEqual([...mounted.moduleExports.inject.required], ['slots', 'locale']);
  assert.deepEqual([...mounted.moduleExports.inject.optional], ['layout', 'sessions', 'conversation']);

  // It waits for the shell to declare seats instead of touching the tree directly.
  assert.deepEqual(mounted.harness.injections.map((item) => item.key), ['sidebar.panellist', 'main']);
  assert.equal(mounted.harness.registrations.length, 2);

  assert.equal(mounted.sidebar.options.id, PANEL_ID);
  assert.equal(mounted.sidebar.options.order, 20);
  assert.equal(mounted.sidebar.options.locale, NS);
  assert.equal(typeof mounted.sidebar.options.label, 'function');
  assert.equal(mounted.sidebar.options.label(), 'Charakuru Studio');

  assert.equal(mounted.main.options.key, PANEL_ID);
  assert.equal(mounted.main.options.locale, NS);
  assert.equal(typeof mounted.main.component, 'function');
  assert.equal(mounted.face.studio !== undefined, true, 'main page receives its store through the inject face');

  // Nothing may register on the old conversation header seat, and no modal may remain.
  assert.equal(mounted.harness.registrations.some((item) => item.options.name === HEADER_SEAT), false);
  assert.doesNotMatch(source, /conversation\.session\.header\.utilities/);
  assert.doesNotMatch(source, /<dialog|showModal|createPortal/);
});

test('the sidebar row renders a size-aware icon that follows the row state', async () => {
  const mounted = await mount();
  const Icon = mounted.sidebar.component;

  const small = Icon({ size: 16, active: false });
  assert.equal(small.type, 'svg');
  assert.equal(small.props.width, 16);
  assert.equal(small.props.height, 16);
  assert.equal(small.props['aria-hidden'], 'true');
  assert.equal(small.props.focusable, 'false');
  assert.equal(small.props.stroke, 'currentColor');
  assert.equal(small.props.strokeWidth, 1.6);
  assert.deepEqual(small.children.map((child) => child.type), ['rect', 'circle', 'path']);

  const active = Icon({ size: 18, active: true });
  assert.equal(active.props.width, 18);
  assert.equal(active.props.strokeWidth, 1.9);

  const fallback = Icon({});
  assert.equal(fallback.props.width, 18, 'a row without size still gets a sane icon');
});

test('the page renders a workbench shell with a tab rail and no dialog chrome', async () => {
  const mounted = await mount();
  const Panel = mounted.main.component;
  const tree = mounted.runtime.render(Panel, mounted.face);

  assert.equal(tree.type, 'div');
  assert.equal(tree.props['data-studio-panel'], PANEL_ID);
  assert.deepEqual(String(tree.props.className).split(' '), ['ck-page']);

  const style = hostNodes(tree).find((node) => node.type === 'style');
  assert.ok(style, 'the panel ships its own stylesheet');
  assert.match(textOf(style), /\.ck-page/);
  assert.match(textOf(style), /--dsw-alias-brand-primary/);

  const headings = hostNodes(tree).filter((node) => node.type === 'h1');
  assert.equal(headings.length, 1);
  assert.equal(textOf(headings[0]).trim(), 'Character → VRM studio');

  // 5 tabs, exactly one selected, all pointing at the same panel region.
  const tabs = byRole(tree, 'tab');
  assert.deepEqual(tabs.map((tab) => tab.props['aria-selected']), [true, false, false, false, false]);
  assert.deepEqual(tabs.map((tab) => tab.props.tabIndex), [0, -1, -1, -1, -1]);
  assert.equal(textOf(tabs[0]).includes('Project & reviews'), true);
  const rail = byRole(tree, 'tablist')[0];
  assert.equal(rail.props['aria-orientation'], 'vertical');
  const panelRegion = byRole(tree, 'tabpanel')[0];
  assert.equal(panelRegion.props.id, tabs[0].props['aria-controls']);

  // No modal affordances survive the move.
  assert.equal(hostNodes(tree).some((node) => node.type === 'dialog'), false);
  assert.equal(hostNodes(tree).filter((node) => node.type === 'button').length > 5, true);

  // First visit: connection settings are open, the project body is a loading state.
  const details = hostNodes(tree).filter((node) => node.type === 'details');
  assert.equal(details.length, 2, 'connection settings and the latest-result drawer');
  assert.equal(details[0].props.open, true);
  assert.equal(textOf(byClass(tree, 'ck-empty')[0]).includes('Loading project state'), true);
});

test('tabs switch, keep state across remounts and follow the active language', async () => {
  const mounted = await mount();
  const Panel = mounted.main.component;
  const studio = mounted.face.studio;

  let tree = mounted.runtime.render(Panel, mounted.face);

  // Before bootstrap lands only the pipeline tab has something to show: the
  // project form needs nothing but the API base.
  assert.equal(hostNodes(tree).some((node) => String(node.props.id || '').endsWith('-f-prompt')), true, 'project form is usable immediately');

  const modelsTab = byRole(tree, 'tab').find((tab) => textOf(tab).includes('Models & views'));
  assert.ok(modelsTab);
  modelsTab.props.onClick();

  studio.set({
    boot: {
      ok: true,
      stages: [
        { id: '1_concept', index: 1, titleEn: 'Concept', titleZh: '概念', summaryEn: 'reference', summaryZh: '参考' },
      ],
      aaCatalog: { models: [{ id: 'qwen-image-2.1-local', name: 'Qwen Image 2.1', deployment: 'local', aaT2iElo: 1200 }] },
      credentials: [{ id: 'novelai', configured: true, source: 'store' }],
      projectExists: false,
    },
    loaded: true,
  });

  tree = mounted.runtime.render(Panel, mounted.face);
  assert.deepEqual(byRole(tree, 'tab').map((tab) => tab.props['aria-selected']), [false, true, false, false, false]);
  assert.equal(hostNodes(tree).some((node) => String(node.props.id || '').endsWith('-f-model')), true, 'model picker is on screen');
  assert.equal(studio.getSnapshot().tab, 'models');

  // A fresh mount reuses the same store: the workbench does not reset on navigation.
  tree = mounted.runtime.render(Panel, mounted.face);
  assert.deepEqual(byRole(tree, 'tab').map((tab) => tab.props['aria-selected']), [false, true, false, false, false]);

  // Language switch: labels resolve through the locale service on both surfaces.
  mounted.harness.setLanguage('zh');
  tree = mounted.runtime.render(Panel, mounted.face);
  assert.equal(textOf(hostNodes(tree).find((node) => node.type === 'h1')).trim(), '角色立绘 → VRM 工作台');
  assert.equal(mounted.sidebar.options.label(), 'Charakuru 工作台');
  assert.equal(textOf(hostNodes(tree)[0]).includes('工作台'), true);

  // Keyboard navigation walks the rail and wraps. Each key press needs a fresh
  // tree: the handler closes over the tab that was active when it was rendered.
  const press = (name) => {
    const current = byRole(mounted.runtime.render(Panel, mounted.face), 'tablist')[0];
    current.props.onKeyDown({ key: name, preventDefault() {} });
    return studio.getSnapshot().tab;
  };
  assert.equal(press('End'), 'credentials');
  assert.equal(press('ArrowDown'), 'pipeline');
  assert.equal(press('ArrowUp'), 'credentials');
  assert.equal(press('Home'), 'pipeline');
  assert.equal(press('ArrowLeft'), 'credentials');
});

test('inserting instructions appends to the draft of the session the main view retains', async () => {
  const drafts = [];
  const panels = [];
  const mounted = await mount({
    services: {
      sessions: {
        list: {
          getSnapshot: () => ({
            byId: {
              'session-bg': { retainedBy: {} },
              'session-main': { retainedBy: { mainView: 1 } },
            },
          }),
        },
        binding(id) {
          return id === 'session-main' ? { sessionId: id } : undefined;
        },
      },
      conversation: {
        input: {
          requestDraftInitialization(binding, options) {
            drafts.push({ binding, options });
            return 'applied';
          },
        },
      },
      layout: {
        selectPanel(id) { panels.push(id); },
      },
    },
  });
  const studio = mounted.face.studio;

  assert.equal(studio.currentSessionId(), 'session-main');
  assert.equal(studio.insertInstructions('brief for the active stage'), 'ok');
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].binding.sessionId, 'session-main');
  assert.equal(drafts[0].options.prompt, 'brief for the active stage');
  assert.equal(drafts[0].options.whenDraftExists, 'append');
  assert.deepEqual(panels, [null], 'the workbench hands the user back to the transcript');
});

test('inserting degrades honestly when the shell cannot take the draft', async () => {
  const noServices = await mount();
  assert.equal(noServices.face.studio.insertInstructions('x'), 'unsupported');

  const noSession = await mount({
    services: {
      sessions: { list: { getSnapshot: () => ({ byId: { 'session-bg': { retainedBy: {} } } }) }, binding: () => ({ sessionId: 'session-bg' }) },
      conversation: { input: { requestDraftInitialization: () => 'applied' } },
      layout: { selectPanel() {} },
    },
  });
  assert.equal(noSession.face.studio.currentSessionId(), undefined);
  assert.equal(noSession.face.studio.insertInstructions('x'), 'no-session');

  const panels = [];
  const blocked = await mount({
    services: {
      sessions: { list: { getSnapshot: () => ({ byId: { s: { retainedBy: { mainView: 2 } } } }) }, binding: (id) => ({ sessionId: id }) },
      conversation: { input: { requestDraftInitialization: () => 'blocked' } },
      layout: { selectPanel: (id) => panels.push(id) },
    },
  });
  assert.equal(blocked.face.studio.insertInstructions('x'), 'blocked');
  assert.deepEqual(panels, [], 'a blocked draft must not navigate away');
});

test('the store owns the request lifecycle and never leaks a pending state', async () => {
  const mounted = await mount();
  const studio = mounted.face.studio;
  const seen = [];
  studio.subscribe(() => seen.push({ ...studio.getSnapshot() }));

  const data = await studio.action('/studio/project/init', { characterPrompt: 'x' });
  assert.equal(data.ok, true);
  assert.equal(studio.getSnapshot().pending, false);
  assert.equal(studio.getSnapshot().busy, false);
  assert.equal(studio.getSnapshot().error, '');
  assert.equal(studio.getSnapshot().notice, 'Operation completed');
  assert.equal(studio.getSnapshot().result.ok, true);
  assert.equal(seen.some((snapshot) => snapshot.busy === true), true, 'busy is observable while the call runs');

  const call = mounted.fetchCalls.at(-1);
  assert.equal(call.url, 'http://127.0.0.1:9886/studio/project/init');
  assert.equal(call.init.method, 'POST');
  assert.equal(JSON.parse(call.init.body).characterPrompt, 'x');

  // A failing request lands in `error`, clears the busy flags and keeps the tab.
  mounted.sandbox.fetch = async () => ({ ok: false, status: 400, json: async () => ({ error: 'bad request' }) });
  const failed = await studio.action('/studio/project/init', {});
  assert.equal(failed, undefined);
  assert.equal(studio.getSnapshot().error, 'bad request');
  assert.equal(studio.getSnapshot().pending, false);
  assert.equal(studio.getSnapshot().tab, 'pipeline');
});

test('the loopback guard rejects anything that is not the local Studio host', async () => {
  const mounted = await mount();
  const studio = mounted.face.studio;

  studio.put('base', 'http://127.0.0.1:9886/');
  await assert.doesNotReject(() => studio.request('/studio/bootstrap'));

  for (const bad of [
    'https://127.0.0.1:9886',
    'http://example.com:9886',
    'http://127.0.0.1:9886/api',
    'http://user:pass@127.0.0.1:9886',
    'http://127.0.0.1:9886/?x=1',
    'http://127.0.0.1:9886/#hash',
  ]) {
    studio.put('base', bad);
    await assert.rejects(() => studio.request('/studio/bootstrap'), /Expected http:\/\/localhost:PORT/, `accepted ${bad}`);
  }
});

test('a project with unrecorded stages renders pending rows instead of crashing', async () => {
  const mounted = await mount();
  const studio = mounted.face.studio;
  const Panel = mounted.main.component;

  // The bootstrap payload reports every pipeline stage, but a fresh project has
  // no record yet for the ones the user has not reached.
  studio.set({
    loaded: true,
    boot: {
      ok: true,
      projectExists: true,
      activeProjectDir: 'D:/CharacterStudio/Demo',
      stages: [
        { id: '1', index: 1, titleEn: 'Concept intake', titleZh: '原画解析', summaryEn: '', summaryZh: '' },
        { id: '2', index: 2, titleEn: 'Turnaround', titleZh: '多视角', summaryEn: '', summaryZh: '' },
      ],
      projectState: { activeStageId: '1', stages: { 1: { status: 'in_progress' } } },
      projectSummary: { percent: 16, completedStages: 0, readyViews: 0, remainingFreeCredits: 200 },
    },
  });

  const tree = mounted.runtime.render(Panel, mounted.face);
  const pills = hostNodes(tree).filter((node) => node.props && node.props['data-status']);
  assert.deepEqual(pills.map((pill) => pill.props['data-status']), ['in_progress', 'pending']);
  assert.match(textOf(pills[1]), /Pending/);
});

test('disposal stops in-flight requests and unregisters the seats', async () => {
  const mounted = await mount();
  const studio = mounted.face.studio;
  const controllerSeen = [];
  let aborted = false;

  mounted.sandbox.fetch = (url, init) => new Promise((resolve, reject) => {
    controllerSeen.push(init.signal);
    init.signal.addEventListener('abort', () => {
      aborted = true;
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });

  const pending = studio.request('/studio/bootstrap');
  assert.equal(controllerSeen.length, 1);
  mounted.harness.dispose();
  assert.equal(aborted, true, 'unloading the plugin cancels the in-flight call');
  // The locale dictionary is already gone at teardown, so the message may fall
  // back to its key — what matters is that the call settles instead of hanging.
  await assert.rejects(() => pending, /timeout|did not answer in time/);
  assert.equal(studio.getSnapshot().pending, false);
});
