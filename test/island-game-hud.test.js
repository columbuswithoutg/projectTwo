/************************************************
 * Unit tests for js/island-game-hud.js (the shared island-game HUD shell)
 * driven through Quote Guess (js/quote-guess.js), audit 2026-10-30:
 *   - emit(): stop() resolves a pending call as 'stopped' (no toast, no
 *     live guard timer); every error the server can reply with has text
 *   - a 'done' idle keeps the final results up (NET2-03)
 *   - a reconnect forgets a stale seat: the overlay closes, the chip stops
 *     saying "Back to your game", Play comes back; final results stay;
 *     a game the server re-sends opens again (NET2-01)
 *   - the answer buttons are built once per round and patched in place;
 *     keys keep working after a click drops focus to <body> (NET2-02)
 *
 * Both are browser scripts (const X = (() => …)()), so they run in a vm
 * context with a fake socket and a small fake DOM (enough HTML parsing and
 * selector matching for the HUD's own templates).
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const HUD_SRC = read('js/island-game-hud.js');
const QG_SRC = read('js/quote-guess.js');

// ── a small fake DOM ──

const VOID = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'source']);
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[e]));

class Text {
  constructor(t) { this.nodeType = 3; this.text = t; this.parentNode = null; }
}

class El {
  constructor(tag, doc) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.doc = doc;
    this.childNodes = [];
    this.parentNode = null;
    this.attrs = new Map();
    this.listeners = {};
    this.style = {};
    const self = this;
    const key = (k) => 'data-' + String(k).replace(/[A-Z]/g, c => '-' + c.toLowerCase());
    this.dataset = new Proxy({}, {
      get: (_, k) => (typeof k === 'string' && self.attrs.has(key(k)) ? self.attrs.get(key(k)) : undefined),
      set: (_, k, v) => { self.attrs.set(key(k), String(v)); return true; },
      deleteProperty: (_, k) => { self.attrs.delete(key(k)); return true; },
      has: (_, k) => self.attrs.has(key(k))
    });
    this.classList = {
      contains: (c) => self.className.split(/\s+/).includes(c),
      add: (...cs) => { for (const c of cs) if (!self.classList.contains(c)) self.className = (self.className + ' ' + c).trim(); },
      remove: (...cs) => { self.className = self.className.split(/\s+/).filter(x => x && !cs.includes(x)).join(' '); },
      toggle: (c, on) => { const want = on === undefined ? !self.classList.contains(c) : !!on; if (want) self.classList.add(c); else self.classList.remove(c); return want; }
    };
  }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get className() { return this.attrs.get('class') || ''; }
  set className(v) { this.attrs.set('class', String(v)); }
  get hidden() { return this.attrs.has('hidden'); }
  set hidden(v) { if (v) this.attrs.set('hidden', ''); else this.attrs.delete('hidden'); }
  get disabled() { return this.attrs.has('disabled'); }
  set disabled(v) {
    if (v) this.attrs.set('disabled', ''); else this.attrs.delete('disabled');
    // Chrome / Edge: a focused control that becomes disabled loses focus.
    if (v && this.doc.activeElement === this) this.doc.activeElement = this.doc.body;
  }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  removeAttribute(k) { this.attrs.delete(k); }
  hasAttribute(k) { return this.attrs.has(k); }
  get textContent() { return this.childNodes.map(n => (n.nodeType === 3 ? n.text : n.textContent)).join(''); }
  set textContent(v) { this._clear(); if (v !== '' && v != null) this._add(new Text(String(v))); }
  set innerHTML(html) { this._clear(); parseInto(this, String(html), this.doc); }
  _clear() { for (const n of this.childNodes) n.parentNode = null; this.childNodes = []; this._blurInside(); }
  _add(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; }
  appendChild(n) { return this._add(n); }
  insertBefore(n, ref) {
    if (n.parentNode) n.parentNode.removeChild(n);
    const i = this.childNodes.indexOf(ref);
    n.parentNode = this;
    if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n);
    return n;
  }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; return n; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); this._blurInside(); }
  _blurInside() { const a = this.doc.activeElement; if (a && a !== this.doc.body && !a.isConnected) this.doc.activeElement = this.doc.body; }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
  get isConnected() { for (let x = this; x; x = x.parentNode) if (x === this.doc.documentElement) return true; return false; }
  focus() { if (!this.disabled && this.isConnected) this.doc.activeElement = this; }
  blur() { if (this.doc.activeElement === this) this.doc.activeElement = this.doc.body; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener(t, fn) { const l = this.listeners[t] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }
  closest(sel) { for (let x = this; x && x.nodeType === 1; x = x.parentNode) if (matches(x, sel)) return x; return null; }
  matches(sel) { return matches(this, sel); }
  querySelectorAll(sel) { const out = []; walk(this, (n) => { if (n !== this && matches(n, sel)) out.push(n); }); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

function walk(node, fn) { for (const c of node.children) { fn(c); walk(c, fn); } }

function parseInto(root, html, doc) {
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9-]+)\s*>|<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[1]) {
      const tag = m[1].toUpperCase();
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName === tag) { stack.length = i; break; }
    } else if (m[2]) {
      const el = new El(m[2], doc);
      const ar = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      let a;
      while ((a = ar.exec(m[3] || ''))) el.attrs.set(a[1], decode(a[2] ?? a[3] ?? a[4] ?? ''));
      top._add(el);
      if (!m[4] && !VOID.has(m[2].toLowerCase())) stack.push(el);
    } else if (m[5] && m[5].trim()) {
      top._add(new Text(decode(m[5])));
    }
  }
}

// Selectors: comma lists, descendant combinators, and compounds of
// tag / .class / [attr] / [attr="v"].
function matchCompound(el, comp) {
  const re = /([a-zA-Z][a-zA-Z0-9-]*)|\.([a-zA-Z0-9_-]+)|\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/g;
  let m, any = false;
  while ((m = re.exec(comp))) {
    any = true;
    if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
    if (m[2] && !el.classList.contains(m[2])) return false;
    if (m[3] && (!el.attrs.has(m[3]) || (m[4] !== undefined && el.attrs.get(m[3]) !== m[4]))) return false;
  }
  return any;
}
function matches(el, sel) {
  return sel.split(',').some(part => {
    const comps = part.trim().split(/\s+/);
    if (!matchCompound(el, comps[comps.length - 1])) return false;
    let x = el.parentNode, i = comps.length - 2;
    while (i >= 0 && x && x.nodeType === 1) { if (matchCompound(x, comps[i])) i--; x = x.parentNode; }
    return i < 0;
  });
}

function fakeDocument() {
  const doc = { listeners: {}, activeElement: null };
  doc.documentElement = new El('html', doc);
  doc.body = new El('body', doc);
  doc.documentElement.appendChild(doc.body);
  doc.activeElement = doc.body;
  doc.createElement = (t) => new El(t, doc);
  doc.querySelector = (s) => doc.documentElement.querySelector(s);
  doc.querySelectorAll = (s) => doc.documentElement.querySelectorAll(s);
  doc.addEventListener = (t, fn) => { (doc.listeners[t] = doc.listeners[t] || []).push(fn); };
  doc.removeEventListener = (t, fn) => { const l = doc.listeners[t] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
  return doc;
}

// Bubble an event from `target` up to the document.
function dispatch(doc, target, type, props) {
  const ev = Object.assign({ type, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }, props);
  for (let x = target; x; x = x.parentNode) for (const fn of [...((x.listeners || {})[type] || [])]) fn(ev);
  for (const fn of [...(doc.listeners[type] || [])]) fn(ev);
  return ev;
}

// ── harness ──

function fakeSocket() {
  const handlers = {};
  const emitted = [];
  return {
    id: 'sock1', connected: true, handlers, emitted,
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    off(ev, fn) { handlers[ev] = (handlers[ev] || []).filter(f => f !== fn); },
    emit(ev, data, ack) { emitted.push([ev, data, ack]); },
    fire(ev, ...args) { for (const fn of [...(handlers[ev] || [])]) fn(...args); }
  };
}

function harness() {
  const timers = [];
  const socket = fakeSocket();
  const toasts = [];
  const doc = fakeDocument();
  const ctx = {
    console: { log() {}, warn() {} },
    API: '/api',
    Auth: { getToken: () => 't' },
    fetch: () => Promise.reject(new Error('offline')),
    toast: (msg, type) => toasts.push([msg, type]),
    document: doc,
    Date, Promise,
    setTimeout: (fn, ms) => { const t = { fn, ms, done: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.done = true; },
    setInterval: () => 0,
    clearInterval: () => {}
  };
  ctx.window = ctx;
  ctx.window.QuoteGuessLogic = require('../js/quote-guess-logic.js');
  ctx.window.matchMedia = () => ({ matches: true });   // reduced motion: no confetti
  vm.createContext(ctx);
  const QG = vm.runInContext(HUD_SRC + '\n' + QG_SRC + '\n;QuoteGuess', ctx);
  QG.start({ socket, engine: null, username: 'me' });
  const ov = () => doc.querySelector('.sg-overlay');
  const opts = () => doc.querySelectorAll('.qg-options button[data-choice]');
  return { QG, socket, toasts, timers, doc, ov, opts };
}

const OPTIONS = [{ id: 'a', label: 'Tony Stark' }, { id: 'b', label: 'Loki' }, { id: 'c', label: 'Thor' }, { id: 'd', label: 'Steve Rogers' }];
function roundState(over) {
  return Object.assign({
    projectId: 'p1', phase: 'round', host: 'me', of: 10, round: 0,
    deadline: Date.now() + 15000, roundMs: 20000, max: 8,
    players: [{ username: 'me', locked: false, total: 0 }, { username: 'bob', locked: false, total: 0 }],
    current: { round: 0, type: 'who', prompt: { text: 'I am Iron Man.' }, options: OPTIONS },
    history: []
  }, over);
}
function resultsState() {
  return roundState({
    phase: 'results', round: 9, current: null, deadline: Date.now() + 10000,
    players: [{ username: 'me', locked: false, total: 900 }, { username: 'bob', locked: false, total: 400 }],
    ranking: [{ username: 'me', total: 900 }, { username: 'bob', total: 400 }],
    record: null,
    history: [{ round: 0, answer: 'a', picks: [{ username: 'me', choice: 'a', points: 900 }, { username: 'bob', choice: 'b', points: 0 }] }]
  });
}
const tick = () => new Promise(r => setImmediate(r));

// ── emit / errors (NET2-03) ──

test("Quote Guess emit: stop() resolves a pending call as 'stopped', clears its timer, stays quiet", async () => {
  const h = harness();
  const p = h.QG._debug.emit('world:qg-start', { projectId: 'p1' });
  const sent = h.socket.emitted.find(e => e[0] === 'world:qg-start');
  assert.ok(sent);
  assert.equal(h.timers.filter(t => !t.done && t.ms === 8000).length, 1);
  h.QG.stop();
  assert.deepEqual({ ...(await p) }, { ok: false, error: 'stopped' });
  assert.equal(h.timers.filter(t => !t.done && t.ms === 8000).length, 0, 'guard timer cleared');
  sent[2]({ ok: false, error: 'busy' });          // a late ack changes nothing
  assert.deepEqual(h.toasts, []);
  assert.deepEqual({ ...(await h.QG._debug.emit('world:qg-join', {})) }, { ok: false, error: 'stopped' });
});

test('Quote Guess emit: offline and timeout resolve with their own codes', async () => {
  const h = harness();
  const t = h.QG._debug.emit('world:qg-join', { projectId: 'p1' });
  h.timers.find(x => x.ms === 8000).fn();
  assert.equal((await t).error, 'timeout');
  h.socket.connected = false;
  assert.equal((await h.QG._debug.emit('world:qg-join', {})).error, 'offline');
  h.QG.stop();
});

test('Quote Guess: every error the server can reply with has its own message', async () => {
  const server = read('server/island-game.js') + read('server/quote-guess.js') + read('js/quote-guess-logic.js');
  const codes = new Set();
  for (const m of server.matchAll(/error: '([a-z][a-z-]*)'/g)) codes.add(m[1]);
  for (const c of ['offline', 'timeout']) codes.add(c);
  assert.ok(codes.size >= 18, 'found the server codes');
  const h = harness();
  const missing = [];
  for (const code of codes) {
    h.toasts.length = 0;
    const p = h.QG.join('p1');
    const sent = h.socket.emitted.filter(e => e[0] === 'world:qg-join').pop();
    sent[2]({ ok: false, error: code });
    await p;
    const msg = h.toasts.length ? h.toasts[0][0] : '';
    if (!msg || msg === "Couldn't do that — try again.") missing.push(code);
  }
  assert.deepEqual(missing, []);
  h.QG.stop();
});

// ── results / idle (NET2-03) ──

test("a 'done' idle keeps the final results up until closed", () => {
  const h = harness();
  h.QG._debug.inject(resultsState());
  assert.equal(h.QG._debug.overlay().mode, 'play');
  assert.equal(h.ov().querySelector('.sg-results').hidden, false);
  h.QG._debug.inject({ projectId: 'p1', phase: 'idle', reason: 'done' });
  const o = h.QG._debug.overlay();
  assert.ok(o && o.final, 'overlay kept, holding the final state');
  assert.equal(h.ov().querySelectorAll('.sg-ranking li').length, 2);
  assert.ok(h.QG._debug.state('p1') === null, 'the live state is gone');
  const chip = h.QG.chip();
  assert.ok(!chip || !/Back to your game/.test(chip.text));
  h.QG.stop();
});

test('any other idle closes the overlay; a game that moved tabs says so', () => {
  const h = harness();
  h.QG._debug.inject(roundState());
  h.QG._debug.inject({ projectId: 'p1', phase: 'idle', reason: 'moved' });
  assert.ok(h.QG._debug.overlay() === null);
  assert.ok(h.toasts.some(t => /another tab/.test(t[0])));
  h.QG.stop();
});

// ── reconnect (NET2-01) ──

test('a reconnect forgets a stale seat: overlay closed, chip and Play back to normal', async () => {
  const h = harness();
  h.QG._debug.setCfg({ enabled: true, islands: ['p1'] });
  h.QG.onZone('p1');
  h.QG._debug.inject(roundState());
  assert.equal(h.QG._debug.overlay().mode, 'play');
  assert.match(h.QG.chip().text, /Back to your game/);
  h.QG.openPanel('p1');
  assert.ok(h.doc.querySelector('.sg-panel button[data-act="back"]'));

  // Offline past the grace: the game ended without us; the socket comes back.
  h.socket.fire('connect');
  assert.ok(h.QG._debug.overlay() === null, 'the frozen overlay is gone');
  assert.ok(h.QG._debug.state('p1') === null);
  assert.doesNotMatch(h.QG.chip().text, /Back to your game/);
  const play = h.doc.querySelector('.sg-panel button[data-act="play"]');
  assert.ok(play, 'the panel offers Play again');
  assert.equal(play.disabled, false);
  assert.ok(h.ov() === null);

  // A game that is still live is re-sent by resume() and opens again.
  h.QG._debug.inject(roundState());
  assert.equal(h.QG._debug.overlay().mode, 'play');
  await tick();
  h.QG.stop();
});

test('a reconnect keeps final results on screen', () => {
  const h = harness();
  h.QG._debug.inject(resultsState());
  h.QG._debug.inject({ projectId: 'p1', phase: 'idle', reason: 'done' });
  h.socket.fire('connect');
  const o = h.QG._debug.overlay();
  assert.ok(o && o.final);
  assert.ok(h.ov());
  h.QG.stop();
});

test('a reconnect does not reopen results the player already closed', () => {
  const h = harness();
  h.QG._debug.inject(resultsState());
  dispatch(h.doc, h.ov().querySelector('.sg-results-actions button[data-act="close"]'), 'click');
  assert.ok(h.QG._debug.overlay() === null);
  h.socket.fire('connect');
  h.QG._debug.inject(resultsState());          // resume() re-sends the results
  assert.ok(h.QG._debug.overlay() === null);
  h.QG.stop();
});

// ── the answer buttons (NET2-02) ──

test('answer buttons are patched in place across broadcasts, a click and the reveal', () => {
  const h = harness();
  h.QG._debug.inject(roundState());
  const first = h.opts();
  assert.equal(first.length, 4);
  assert.ok(h.doc.activeElement === first[0], 'option A focused on open');

  // Someone else locks in: same nodes.
  h.QG._debug.inject(roundState({ players: [{ username: 'me', locked: false, total: 0 }, { username: 'bob', locked: true, total: 0 }] }));
  assert.deepEqual(h.opts().map((b, i) => b === first[i]), [true, true, true, true]);

  // Click B: locked in, still the same nodes, patched.
  first[1].focus();
  dispatch(h.doc, first[1], 'click');
  const sent = h.socket.emitted.find(e => e[0] === 'world:qg-answer');
  assert.deepEqual({ ...sent[1] }, { round: 0, choice: 'b' });
  let now = h.opts();
  assert.deepEqual(now.map((b, i) => b === first[i]), [true, true, true, true]);
  assert.ok(now[1].classList.contains('is-chosen'));
  assert.equal(now[1].getAttribute('aria-pressed'), 'true');
  assert.equal(now[0].getAttribute('aria-pressed'), 'false');
  assert.ok(now.every(b => b.disabled), 'choices locked while sending');
  assert.equal(now[1].querySelector('.qg-mark').textContent, '✓');
  assert.ok(h.doc.activeElement === h.doc.body, 'the disabled button lost focus (Chrome)');
  sent[2]({ ok: true });

  // The reveal: right / wrong / who-picked marks, same nodes.
  h.QG._debug.inject(roundState({
    phase: 'reveal', deadline: Date.now() + 4000,
    history: [{ round: 0, answer: 'a', reveal: { speaker: 'Tony Stark' }, picks: [{ username: 'me', choice: 'b', points: 0, ms: 2000 }, { username: 'bob', choice: 'a', points: 800, ms: 3000 }] }]
  }));
  now = h.opts();
  assert.deepEqual(now.map((b, i) => b === first[i]), [true, true, true, true]);
  assert.ok(now[0].classList.contains('is-right'));
  assert.ok(now[1].classList.contains('is-wrong'));
  assert.ok(now[2].classList.contains('is-dim'));
  assert.equal(now[0].querySelector('.qg-mark').textContent, '★');
  assert.equal(now[1].querySelector('.qg-mark').textContent, '✗');
  assert.equal(now[0].querySelectorAll('.qg-who i').length, 1, "bob's dot on A");
  assert.ok(now[2].querySelector('.qg-who') === null);
  assert.ok(now[2].querySelector('.qg-mark') === null);

  // The next round: new buttons, fresh state, focus back on the choices.
  h.QG._debug.inject(roundState({ round: 1, current: { round: 1, type: 'who', prompt: { text: 'Puny god.' }, options: OPTIONS } }));
  now = h.opts();
  assert.equal(now[0] === first[0], false, 'rebuilt for the new round');
  assert.ok(now.every(b => !b.disabled && b.getAttribute('aria-pressed') === 'false' && !b.querySelector('.qg-mark')));
  assert.ok(h.doc.activeElement === now[0]);
  h.QG.stop();
});

test('keys keep working after a click drops focus to <body>, and ignore other targets', () => {
  const h = harness();
  h.QG._debug.inject(roundState());
  dispatch(h.doc, h.opts()[1], 'click');
  h.socket.emitted.find(e => e[0] === 'world:qg-answer')[2]({ ok: true });
  h.QG._debug.inject(roundState({ round: 1, current: { round: 1, type: 'who', prompt: { text: 'Puny god.' }, options: OPTIONS } }));
  h.doc.activeElement = h.doc.body;

  // A key aimed at something outside the overlay (another dialog) is not ours.
  const other = h.doc.createElement('div');
  h.doc.body.appendChild(other);
  dispatch(h.doc, other, 'keydown', { key: 'd' });
  assert.equal(h.socket.emitted.filter(e => e[0] === 'world:qg-answer').length, 1);

  // With focus on <body> the key still answers.
  const ev = dispatch(h.doc, h.doc.body, 'keydown', { key: '3' });
  assert.ok(ev.defaultPrevented);
  const answers = h.socket.emitted.filter(e => e[0] === 'world:qg-answer');
  assert.equal(answers.length, 2);
  assert.deepEqual({ ...answers[1][1] }, { round: 1, choice: 'c' });

  // Closing the overlay removes the document listener.
  answers[1][2]({ ok: true });
  h.QG._debug.inject({ projectId: 'p1', phase: 'idle', reason: 'error' });
  assert.ok(h.QG._debug.overlay() === null);
  assert.equal((h.doc.listeners.keydown || []).length, 0);
  h.QG.stop();
});

// ── Scene Guess's own copy of the HUD (NET2-01) ──

test('Scene Guess: a reconnect forgets a stale seat too, and a re-sent game opens again', () => {
  const socket = fakeSocket();
  const doc = fakeDocument();
  const ctx = {
    console: { log() {}, warn() {} },
    API: '/api',
    Auth: { getToken: () => 't' },
    fetch: () => Promise.reject(new Error('offline')),
    toast: () => {},
    document: doc,
    Image: class { },
    Date, Promise,
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {}
  };
  ctx.window = ctx;
  ctx.window.SceneGuessLogic = require('../js/scene-guess-logic.js');
  ctx.window.matchMedia = () => ({ matches: true });
  vm.createContext(ctx);
  const SG = vm.runInContext(read('js/scene-guess.js') + '\n;SceneGuess', ctx);
  SG.start({ socket, engine: null, username: 'me' });
  const ready = { projectId: 'p1', phase: 'ready', host: 'me', of: 10, round: 0, deadline: Date.now() + 3000, roundMs: 30000, max: 8,
    players: [{ username: 'me', locked: false, total: 0 }], stills: [], history: [] };
  socket.fire('world:sg-state', ready);
  assert.equal(SG._debug.overlay().mode, 'play');
  assert.match(SG.chip().text, /Back to your game/);
  socket.fire('connect');
  assert.ok(SG._debug.overlay() === null, 'the frozen overlay is gone');
  assert.ok(SG._debug.state('p1') === null);
  assert.ok(SG.chip() === null, 'no "Back to your game" off the island');
  socket.fire('world:sg-state', ready);   // resume(): the game is still on
  assert.equal(SG._debug.overlay().mode, 'play');
  SG.stop();
});
