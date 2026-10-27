// Build smoke test: run the real build into a temp dir, then EXECUTE the
// minified chunks the way the browser does — core, then world, then admin,
// each a classic script in ONE shared global scope (a single vm context) —
// and check that every global the build promises (scripts/build.mjs
// EXPECT_GLOBALS / EXPECT_ATTACHED / VAR_GLOBALS) really exists afterwards.
// The build's own checks read the unminified source; only running the
// output proves esbuild kept the names and that no chunk throws on load
// (a SyntaxError, a ReferenceError at IIFE time, or "Identifier has already
// been declared" from a name two chunks both declare).
//
// The browser is faked with the least that lets the chunks' top-level code
// run: a forgiving DOM (every element / query returns a stub that accepts any
// call), storage, timers that never fire, a fetch that never settles (so no
// boot-time request resolves into half-stubbed code), and observers / io /
// matchMedia no-ops. Nothing here asserts UI behaviour — only "loads clean".
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');

// One build (into the OS temp dir, never dist/) shared by both tests.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'build-smoke-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));
let built = null;
function buildOnce() {
  built = built || import(pathToFileURL(path.join(ROOT, 'scripts', 'build.mjs')).href)
    .then(async (mod) => ({ mod, res: await mod.build({ outDir: TMP, silent: true }) }));
  return built;
}

// A DOM node that swallows anything: unknown properties read as no-op
// functions that return another stub, so `el.classList.add(...)`,
// `el.querySelector('x').addEventListener(...)` etc. all just work.
function stubNode(tag = 'div') {
  const store = {
    tagName: String(tag).toUpperCase(), nodeName: String(tag).toUpperCase(), nodeType: 1,
    style: new Proxy({}, { get: (t, k) => (k in t ? t[k] : ''), set: (t, k, v) => { t[k] = v; return true; } }),
    dataset: {}, children: [], childNodes: [], attributes: [],
    innerHTML: '', textContent: '', value: '', id: '', className: '',
    offsetWidth: 0, offsetHeight: 0, clientWidth: 0, clientHeight: 0, scrollTop: 0, scrollLeft: 0,
    width: 0, height: 0,
    firstChild: null, lastChild: null, parentNode: null, parentElement: null,
    nextSibling: null, previousSibling: null,
    isConnected: false,
    getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    getAttribute: () => null, hasAttribute: () => false,
    querySelector: () => null, querySelectorAll: () => [], getElementsByTagName: () => [],
    closest: () => null, contains: () => false, matches: () => false,
    getContext: () => null,
    [Symbol.iterator]: function* () {}
  };
  const proxy = new Proxy(store, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'symbol') return undefined;
      if (k === 'then') return undefined;                  // not a thenable
      if (k === 'classList') return (t.classList = stubList());
      return (t[k] = () => proxy);
    },
    set(t, k, v) { t[k] = v; return true; }
  });
  return proxy;
}
function stubList() {
  return { add() {}, remove() {}, toggle() { return false; }, contains: () => false, replace() {} };
}
function stubStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
    setItem: (k, v) => { m.set(String(k), String(v)); },
    removeItem: (k) => { m.delete(String(k)); },
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; }
  };
}

function makeContext() {
  const noop = () => {};
  const listeners = { addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true };
  const body = stubNode('body');
  const head = stubNode('head');
  const html = stubNode('html');
  const document = Object.assign(stubNode('#document'), {
    nodeType: 9, readyState: 'loading', visibilityState: 'visible', hidden: false,
    body, head, documentElement: html, cookie: '', title: '', referrer: '',
    createElement: (t) => stubNode(t), createElementNS: (_ns, t) => stubNode(t),
    createTextNode: () => stubNode('#text'), createDocumentFragment: () => stubNode('#fragment'),
    // Lookups hand back a stub (not null) so boot code that grabs its mount
    // points by id carries on instead of throwing after the test has ended.
    getElementById: () => stubNode('div'), querySelector: () => stubNode('div'), querySelectorAll: () => [],
    getElementsByTagName: () => [], getElementsByClassName: () => [],
    ...listeners
  });
  class Evt { constructor(type, init = {}) { this.type = type; Object.assign(this, init); } preventDefault() {} stopPropagation() {} }
  class CustomEvt extends Evt { constructor(type, init = {}) { super(type, init); this.detail = init.detail; } }
  class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
  const never = () => new Promise(() => {});
  const ctx = {
    console: { log: noop, info: noop, warn: noop, error: noop, debug: noop },
    document,
    navigator: { userAgent: 'node-smoke', language: 'en', languages: ['en'], onLine: true, maxTouchPoints: 0,
      hardwareConcurrency: 4, serviceWorker: undefined, mediaDevices: undefined, clipboard: undefined, vibrate: noop },
    location: { href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:', host: 'localhost',
      hostname: 'localhost', port: '', pathname: '/', search: '', hash: '', assign: noop, replace: noop, reload: noop },
    history: { state: null, length: 1, pushState: noop, replaceState: noop, back: noop, forward: noop, go: noop },
    localStorage: stubStorage(), sessionStorage: stubStorage(),
    screen: { width: 1280, height: 800, orientation: { type: 'landscape-primary', angle: 0, addEventListener: noop } },
    innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, scrollX: 0, scrollY: 0,
    matchMedia: () => ({ matches: false, media: '', addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }),
    getComputedStyle: () => new Proxy({}, { get: (_t, k) => (k === 'getPropertyValue' ? () => '' : '') }),
    requestAnimationFrame: () => 0, cancelAnimationFrame: noop,
    requestIdleCallback: () => 0, cancelIdleCallback: noop,
    // Timers never fire: we only care about what runs synchronously at load.
    setTimeout: () => 0, clearTimeout: noop, setInterval: () => 0, clearInterval: noop, queueMicrotask: noop,
    fetch: never,
    Event: Evt, CustomEvent: CustomEvt, KeyboardEvent: Evt, MouseEvent: Evt, PointerEvent: Evt,
    ResizeObserver: Observer, IntersectionObserver: Observer, MutationObserver: Observer,
    BroadcastChannel: class { constructor() { this.onmessage = null; } postMessage() {} close() {} addEventListener() {} removeEventListener() {} },
    Image: class { constructor() { return stubNode('img'); } },
    Audio: class { constructor() { return stubNode('audio'); } },
    HTMLElement: class {}, Element: class {}, Node: class {}, HTMLCanvasElement: class {},
    DOMParser: class { parseFromString() { return document; } },
    FormData: class { append() {} },
    Blob: globalThis.Blob, URL: globalThis.URL, URLSearchParams: globalThis.URLSearchParams,
    TextEncoder: globalThis.TextEncoder, TextDecoder: globalThis.TextDecoder,
    AbortController: globalThis.AbortController, structuredClone: globalThis.structuredClone,
    atob: globalThis.atob, btoa: globalThis.btoa, crypto: globalThis.crypto,
    performance: { now: () => 0, mark: noop, measure: noop, getEntriesByName: () => [] },
    io: () => new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : () => {}) }),
    ...listeners
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  return vm.createContext(ctx);
}

test('built chunks load clean in one global scope and define every expected global', async () => {
  const { mod, res } = await buildOnce();
  const dist = res.dist;
  assert.equal(path.resolve(dist), path.resolve(TMP), 'build must honour outDir');

  const out = Object.fromEntries(res.outputs.map((o) => [o.name, o]));
  const ctx = makeContext();
  const has = (expr) => vm.runInContext(`typeof (${expr}) !== 'undefined'`, ctx);

  for (const chunk of ['core', 'world', 'admin']) {
    const file = path.join(dist, 'static', out[chunk].file);
    const code = fs.readFileSync(file, 'utf8');
    try {
      vm.runInContext(code, ctx, { filename: out[chunk].file });
    } catch (err) {
      assert.fail(`${chunk} chunk threw while loading (after ${chunk === 'core' ? 'nothing' : 'the earlier chunks'}): ` +
        `${err && err.name}: ${err && err.message}`);
    }
    const missing = [
      ...(mod.EXPECT_GLOBALS[chunk] || []).filter((g) => !has(g)),
      ...(mod.EXPECT_ATTACHED[chunk] || []).filter((g) => !has('window.' + g)).map((g) => g + ' (attached)')
    ];
    assert.deepEqual(missing, [], `${chunk}: globals missing after the minified chunk ran`);
  }
  // var-declared content arrays must be window properties (js/boot.js
  // reassigns window[key]); a let/const would exist but not be one.
  for (const g of mod.VAR_GLOBALS) {
    assert.ok(Object.prototype.hasOwnProperty.call(ctx, g), `${g} must stay a var (a window property)`);
  }
});

test('build output: chunk names do not collide, the shim stays an ES module, precache files exist', async () => {
  const { mod, res } = await buildOnce();

  // Column-0 declarations of the unminified sources: one owner per name.
  const owner = new Map();
  const clashes = [];
  for (const [chunk, files] of Object.entries(mod.CHUNKS)) {
    for (const [name, decls] of mod.topLevelNames(files)) {
      for (const d of decls) {
        if (owner.has(name)) clashes.push(`${name}: ${owner.get(name)} vs ${chunk}:${d.file}`);
        else owner.set(name, `${chunk}:${d.file}`);
      }
    }
  }
  assert.deepEqual(clashes, []);
  assert.ok(owner.has('Router') && owner.has('Playground3D') && owner.has('AdminView'), 'scanner sees declarations');

  const shim = res.outputs.find((o) => o.name === 'three-shim');
  const shimCode = fs.readFileSync(path.join(res.dist, 'static', shim.file), 'utf8');
  assert.match(shimCode, /\bimport\(/, 'shim keeps its dynamic import()s');
  assert.match(shimCode, /const THREE_VERSION = "[\d.]+"/, 'shim keeps THREE_VERSION');
  assert.match(shimCode, /export\s*\{[^}]*\bTHREE_VERSION\b/, 'shim still exports THREE_VERSION');
  assert.ok(res.manifest.world.modules.includes('/dist/' + shim.file), 'chunk manifest loads the shim as a module');

  const sw = fs.readFileSync(path.join(res.dist, 'sw.js'), 'utf8');
  const m = sw.match(/const PRECACHE = (\[[^\]]*\]);/);
  assert.ok(m, 'PRECACHE list filled into dist/sw.js');
  const precache = JSON.parse(m[1]);
  assert.deepEqual(precache, res.precache);
  const missing = precache.filter((u) => !fs.existsSync(
    u.startsWith('/dist/') ? path.join(res.dist, 'static', u.slice(6))
      : u === '/spa.html' ? path.join(res.dist, 'spa.html') : path.join(ROOT, u.slice(1))));
  assert.deepEqual(missing, [], 'every precached URL exists');
});
