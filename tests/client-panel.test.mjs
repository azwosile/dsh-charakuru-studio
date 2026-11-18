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
const nested = (mounted, tree, name) => { const n=hostNodes(tree).find(n=>n.type?.name===name); assert.ok(n, name); return mounted.runtime.render(n.type,n.props); };
const btn=(tree,label)=>hostNodes(tree).find(n=>n.type==='button'&&textOf(n)===label);

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

async function loadClient(storage = new Map()) {
  if (cachedSource === null) cachedSource = await fs.readFile(CLIENT_FILE, 'utf8');
  let spec = null;
  const fetchCalls = [];
  const sandbox = {
    window: { __ModuleLoader__: { load(value) { spec = value; } } },
    localStorage: {getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    console,
    URL, URLSearchParams,
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
async function mount({ config = {}, services = {}, storage } = {}) {
  const loaded = await loadClient(storage);
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
  assert.deepEqual([...mounted.moduleExports.inject], ['slots', 'locale']);
  // Regression guard: the web client realm silently rejects the object form of `inject`
  // ({required, optional}) — the entry then never activates and no sidebar row appears.
  assert.equal(Array.isArray(mounted.moduleExports.inject), true, 'inject must stay the array form');
  assert.doesNotMatch(source, /inject:\s*\{\s*required/, 'the object form of inject never activates in the client realm');

  // It waits for the shell to declare seats instead of touching the tree directly.
  assert.deepEqual(mounted.harness.injections.map((item) => item.key), ['sidebar.panellist', 'main']);
  assert.equal(mounted.harness.registrations.length, 2);

  assert.equal(mounted.sidebar.options.id, PANEL_ID);
  assert.equal(mounted.sidebar.options.order, 20);
  assert.equal(mounted.sidebar.options.locale, NS);
  assert.equal(typeof mounted.sidebar.options.label, 'function');
  assert.equal(mounted.sidebar.options.label(), 'Avatar Studio');

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

  // 9 tabs, exactly one selected, all pointing at the same panel region.
  const tabs = byRole(tree, 'tab');
  assert.deepEqual(tabs.map((tab) => tab.props['aria-selected']), [true, false, false, false, false, false, false, false, false]);
  assert.deepEqual(tabs.map((tab) => tab.props.tabIndex), [0, -1, -1, -1, -1, -1, -1, -1, -1]);
  assert.equal(textOf(tabs[0]).includes('Workbench'), true);
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
  assert.equal(hostNodes(nested(mounted,tree,'WorkbenchWorkspace')).some((node) => String(node.props.id || '').endsWith('-f-prompt')), true, 'project form is usable immediately');

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
  assert.deepEqual(byRole(tree, 'tab').map((tab) => tab.props['aria-selected']), [false, false, false, false, false, true, false, false, false]);
  assert.equal(hostNodes(tree).some((node) => String(node.props.id || '').endsWith('-f-model')), true, 'model picker is on screen');
  assert.equal(studio.getSnapshot().tab, 'models');

  // A fresh mount reuses the same store: the workbench does not reset on navigation.
  tree = mounted.runtime.render(Panel, mounted.face);
  assert.deepEqual(byRole(tree, 'tab').map((tab) => tab.props['aria-selected']), [false, false, false, false, false, true, false, false, false]);

  // Language switch: labels resolve through the locale service on both surfaces.
  mounted.harness.setLanguage('zh');
  tree = mounted.runtime.render(Panel, mounted.face);
  assert.equal(textOf(hostNodes(tree).find((node) => node.type === 'h1')).trim(), '角色立绘 → VRM 工作台');
  assert.equal(mounted.sidebar.options.label(), 'Avatar Studio 工作台');
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
  const pills = byClass(nested(mounted,tree,'WorkbenchWorkspace'),'ck-desk-phases')[0].children;
  assert.deepEqual(pills.map((pill) => pill.props['data-status']), ['in_progress', 'pending']);
  assert.equal(pills[1].props['data-done'],false);
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
test('active project identity persists across a fresh client instance', async()=>{
  const storage=new Map([['avatar-studio-active-project','D:/Fixture project']]);
  const first=await mount({storage});const tree=first.runtime.render(first.main.component,first.face);
  const input=hostNodes(tree).find(n=>n.type==='input'&&n.props.value==='D:/Fixture project');assert.ok(input);
  input.props.onChange({target:{value:'D:/Second project'}});assert.equal(storage.get('avatar-studio-active-project'),'D:/Second project');
  const second=await mount({storage});const again=second.runtime.render(second.main.component,second.face);
  assert.ok(hostNodes(again).some(n=>n.type==='input'&&n.props.value==='D:/Second project'));
});

test('native workbench has stage navigation on both DSH renderer contracts without loading upstream', async () => {
  const { PIPELINE_STAGES, REQUIRED_VIEW_SLOTS } = await import('../lib/constants.js');
  for (const origin of ['http://127.0.0.1:51886/', 'dsh-app://app/']) {
    const mounted = await mount();
    mounted.sandbox.window.location = new URL(origin);
    const studio = mounted.face.studio;
    const render = () => mounted.runtime.render(mounted.main.component, mounted.face);
    const stages = Object.fromEntries(PIPELINE_STAGES.map(s=>[s.id,{status:s.id==='2_views'?'in_progress':'pending'}]));
    studio.set({loaded:true,boot:{stages:PIPELINE_STAGES,requiredViewSlots:REQUIRED_VIEW_SLOTS,projectExists:true,activeProjectDir:'fixture',
      projectState:{activeStageId:'2_views',projectName:'Native',stages,views:{},assets:{items:[],selected:{}}},projectSummary:{completedStages:1,readyViews:0,remainingFreeCredits:0,percent:16}}});
    const tree = render();
    assert.equal(byRole(tree,'tab').length,9);
    assert.equal(hostNodes(tree).some(node=>node.type==='iframe'),false);
    const workspace=nested(mounted,tree,'WorkbenchWorkspace');
    assert.equal(byClass(workspace,'ck-desk-phases')[0].children.length,6);
    const here=hostNodes(workspace).find(node=>node.props['aria-current']==='step');
    assert.match(textOf(here), /Part views/);
    btn(workspace,'Qwen / Anima / NovelAI and AA').props.onClick();
    assert.equal(studio.getSnapshot().tab,'models');
    assert.equal(studio.getSnapshot().boot.projectState.activeStageId,'2_views');
    assert.equal(hostNodes(render()).some(node=>node.type==='iframe'),false);
    const gallery=byRole(render(),'tab').find(node=>textOf(node).includes('Asset library'));
    gallery.props.onClick();
    const tiles=hostNodes(render()).filter(node=>node.type==='button' && textOf(node)==='Prepare this view');
    assert.equal(tiles.length,5,'two selected-angle part views and three balance references');
    tiles[1].props.onClick();
    assert.equal(studio.getSnapshot().tab,'models');
    assert.equal(studio.getSnapshot().form.imageScope,'body_front');
    mounted.harness.dispose();
  }
});

test('AI handoff registers once, prepares a draft, and does not send or require an open session', async () => {
  const drafts = [];
  const mounted = await mount({ services: {
    sessions: { list: { getSnapshot: () => ({ byId: { current: { retainedBy: { mainView: 1 } } } }) }, binding: (id) => ({ sessionId: id }) },
    conversation: { input: { requestDraftInitialization: (binding, payload) => { drafts.push([binding,payload]); } } },
    layout: { selectPanel() {} },
  } });
  const calls = [];
  mounted.sandbox.fetch = async (url, init) => {
    calls.push([url, init.method]);
    return { ok:true, status:200, json:async () => ({ ok:true, instruction:'request-ID into DSH' }) };
  };
  const studio = mounted.face.studio;
  const result = await studio.handoffAiEdit('/studio/editor/ai-request', { prompt:'Move cube', expectedRevisionId:'base-1' }, true);
  assert.equal(result.draftOutcome, 'ok');
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0][1].prompt, 'request-ID into DSH');
  assert.deepEqual(calls.map(([url,method]) => [new URL(url).pathname,method]), [['/studio/editor/ai-request','POST'],['/studio/bootstrap','GET']]);
  mounted.harness.services.delete('sessions');
  const retry = await studio.handoffAiEdit('/studio/editor/ai-handoff', {requestId:'one'}, false);
  assert.equal(retry.draftOutcome, 'unsupported');
  assert.match(studio.getSnapshot().notice, /Request saved/);
  assert.equal(drafts.length, 1);
  mounted.harness.dispose();
});

test('every stage exposes its own material entry; desktop native path and web raw upload have explicit fallback', async () => {
  const { PIPELINE_STAGES, REQUIRED_VIEW_SLOTS } = await import('../lib/constants.js');
  const { MATERIAL_ROLES } = await import('../lib/project/material-roles.js');
  for (const desktop of [true,false]) {
    const mounted=await mount();const studio=mounted.face.studio, calls=[];
    const file={name:'外部素材.png',size:128,path:'do-not-use-this-removed-property'};
    const dir=desktop?'D:/Studio/角色':'/tmp/roles-fixture';let pathForCalls=0;
    mounted.sandbox.window.location=new URL(desktop?'dsh-app://app/':'http://127.0.0.1:51886/');
    mounted.sandbox.window.__DSH_HOST_PATHS__={pathFor(input){assert.equal(input,file);pathForCalls++;return 'D:/外部/外部素材.png';}};
    mounted.sandbox.window.__DSH_DIRECTORY_PICKER__={pick:async()=>dir};
    const boot={version:'0.6.0',activeProjectDir:dir,projectExists:true,stages:PIPELINE_STAGES,requiredViewSlots:REQUIRED_VIEW_SLOTS,materialRoles:MATERIAL_ROLES,sessionToken:'fixture-session',
      projectState:{stateRevision:1,activeStageId:'1_concept',stages:{},assets:{items:[],selected:{}},materials:{items:[],selected:{}}},projectSummary:{}};
    studio.set({boot,loaded:true});studio.put('projectDir',dir);
    mounted.sandbox.fetch=async(url,init)=>{calls.push({url,init});return Response.json(new URL(url).pathname==='/studio/bootstrap'?boot:{ok:true});};
    const panel=()=>mounted.runtime.render(mounted.main.component,mounted.face);
    let tree=panel();assert.equal(byClass(tree,'ck-page')[0].props['data-shell'],desktop?'desktop':'web');
    const workspace=()=>nested(mounted,panel(),'WorkbenchWorkspace');
    assert.equal(byClass(workspace(),'ck-desk-phases')[0].children.length,6);
    const folder=hostNodes(tree).find(n=>n.type==='button' && textOf(n)==='Choose project folder');
    assert.equal(!!folder,desktop);
    if(folder){folder.props.onClick();await new Promise(setImmediate);assert.equal(new URL(calls.pop().url).searchParams.get('projectDir'),dir);}
    for (let i=0;i<6;i++) {
      studio.set({tab:'pipeline'});byClass(workspace(),'ck-desk-phases')[0].children[i].props.onClick();
      btn(workspace(),'Register stage inputs').props.onClick();assert.equal(studio.getSnapshot().form.materialStage,PIPELINE_STAGES[i].id);
    }
    studio.set({tab:'pipeline'});byClass(workspace(),'ck-desk-phases')[0].children[0].props.onClick();btn(workspace(),'Register stage inputs').props.onClick();
    const materialNode=hostNodes(panel()).find(node=>typeof node.type==='function'&&node.type.name==='MaterialWorkspace');
    tree=mounted.runtime.render(materialNode.type,materialNode.props);
    assert.equal(byClass(tree,'ck-material-steps')[0].children.length,6);
    const picker=hostNodes(tree).find(n=>n.type==='input'&&n.props.type==='file');assert.equal(picker.props.accept,'.png');
    picker.props.onChange({target:{files:[file],value:'picked'}});await new Promise(setImmediate);
    const sent=calls.find(row=>row.init.method==='POST');assert.ok(sent);
    if(desktop){
      assert.equal(new URL(sent.url).pathname,'/studio/materials/import');assert.equal(pathForCalls,1);
      const payload=JSON.parse(sent.init.body);assert.equal(payload.sourcePath,'D:/外部/外部素材.png');assert.equal(payload.stageId,'1_concept');assert.equal(payload.expectedRevision,1);
    }else{
      const url=new URL(sent.url);assert.equal(url.pathname,'/studio/materials/upload');assert.equal(url.searchParams.get('fileName'),file.name);
      assert.equal(sent.init.body,file);assert.equal(sent.init.headers['Content-Type'],'application/octet-stream');assert.equal(pathForCalls,0);
    }
    assert.equal(sent.init.redirect,'error');assert.equal(sent.init.headers['X-Charakuru-Session'],'fixture-session');
    assert.doesNotMatch(sent.url+JSON.stringify(sent.init.headers),/do-not-use/);
    mounted.harness.dispose();
  }
});

test('the 0.6.0 renderer cannot keep an old Host connection or carry its token to a different port', async () => {
  const storage=new Map();const mounted=await mount({storage});const studio=mounted.face.studio;
  mounted.sandbox.fetch=async url=>Response.json({version:new URL(url).port==='9886'?'0.3.2':'0.6.0',activeProjectDir:'/test',sessionToken:'fixture'});
  const wrong=await studio.act(()=>studio.refresh(true));
  assert.equal(wrong,undefined);assert.equal(studio.getSnapshot().boot,null);
  assert.match(studio.getSnapshot().error,/Host version.*0\.3\.2.*0\.6\.0/);assert.equal(storage.has('avatar-studio-loopback'),false);
  studio.put('base','http://127.0.0.1:52886');
  const correct=await studio.act(()=>studio.refresh(true));assert.equal(correct.sessionToken,'fixture');
  assert.equal(studio.getSnapshot().result.sessionToken,undefined);
  assert.equal(storage.get('avatar-studio-loopback'),'http://127.0.0.1:52886');
  studio.put('base','http://127.0.0.1:52887');assert.equal(studio.getSnapshot().boot,null);
  mounted.harness.dispose();
});
