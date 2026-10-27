/************************************************
 * Unit tests for the socket clients' guards (audit 2026-10-27):
 *   - js/home-socket.js: the capped join-refused retry (joinRetryDelay +
 *     one "Reconnecting…" toast per sequence, a final "Couldn't join"),
 *     one reconnect after an 'io server disconnect' (never after a kick),
 *     and a /world chat ack or timeout after stop() staying quiet (NET-06,
 *     NET-10, verifier note).
 *   - js/scene-guess.js: emit() resolving 'stopped' once the HUD stops,
 *     with no toast and no live guard timer (NET-10), and every error the
 *     server can reply with having its own message (NET-05).
 *
 * Both are browser scripts (const X = (() => …)()), so they run in a vm
 * context with just enough fake socket / DOM / timers.
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
const MP_SRC = read('js/home-socket.js');
const SG_SRC = read('js/scene-guess.js');

function fakeTimers() {
  const timers = [];
  return {
    timers,
    pending: () => timers.filter(t => !t.done),
    fire(t) { t.done = true; t.fn(); },
    api: {
      setTimeout: (fn, ms) => { const t = { fn, ms, done: false }; timers.push(t); return t; },
      clearTimeout: (t) => { if (t) t.done = true; },
      setInterval: () => 0,
      clearInterval: () => {}
    }
  };
}

function fakeSocket() {
  const handlers = {};
  const emitted = [];
  return {
    id: 'sock1', connected: true, connects: 0, handlers, emitted,
    on(ev, fn) { handlers[ev] = fn; },
    off(ev) { delete handlers[ev]; },
    emit(ev, data, ack) { emitted.push([ev, data, ack]); },
    connect() { this.connects++; },
    disconnect() { this.connected = false; },
    fire(ev, ...args) { if (handlers[ev]) handlers[ev](...args); }
  };
}

// ── js/home-socket.js ──

function mpHarness({ world = false } = {}) {
  const t = fakeTimers();
  const socket = fakeSocket();
  const toasts = [];
  const noop = () => {};
  const keydown = [];
  const input = {
    value: '', placeholder: '',
    addEventListener(ev, fn) { if (ev === 'keydown') keydown.push(fn); },
    removeEventListener() {}, focus() {}, blur() {}
  };
  const ctx = {
    console: { log() {}, warn() {} },
    io: () => socket,
    Auth: { getToken: () => 't', getUsername: () => 'me' },
    Playground3D: new Proxy({}, { get: () => noop }),
    WorldChatLogic: require('../js/world-chat-logic.js'),
    toast: (msg, type) => toasts.push([msg, type]),
    localStorage: { getItem: () => null, setItem() {} },
    document: {
      getElementById: (id) => (id === 'world-chat-input' ? input : null),
      querySelector: () => null,
      querySelectorAll: () => []
    },
    Date,
    ...t.api
  };
  vm.createContext(ctx);
  const MP = vm.runInContext(MP_SRC + '\n;Multiplayer', ctx);
  const handle = MP.start({ events: world ? MP.WORLD_EVENTS : MP.HOME_EVENTS, joinPayload: { ownerUsername: 'o' }, character: {} });
  return { MP, handle, socket, toasts, t, input, keydown, ev: world ? MP.WORLD_EVENTS : MP.HOME_EVENTS };
}

test('joinRetryDelay: 2, 4, 8, 16, 30 s, then give up', () => {
  const { MP } = mpHarness();
  const seq = [];
  for (let i = 0; i < 7; i++) seq.push(MP.joinRetryDelay(i, NaN));
  assert.deepEqual(seq, [2000, 4000, 8000, 16000, 30000, null, null]);
  assert.equal(MP.JOIN_RETRY_MAX, 5);
});

test("joinRetryDelay: never under the server's retryInMs, never over 30 s", () => {
  const { MP } = mpHarness();
  assert.equal(MP.joinRetryDelay(0, 5000), 5000);
  assert.equal(MP.joinRetryDelay(0, 500), 2000);
  assert.equal(MP.joinRetryDelay(1, 120000), 30000);
  assert.equal(MP.joinRetryDelay(-1, 0), null);
  assert.equal(MP.joinRetryDelay(1.5, 0), null);
});

test("home join-refused 'error': 5 retries, one Reconnecting toast, then a final toast and no timer", () => {
  const h = mpHarness();
  h.socket.fire('connect');
  const joins = () => h.socket.emitted.filter(e => e[0] === 'home:join').length;
  assert.equal(joins(), 1);
  for (let i = 0; i < 5; i++) {
    h.socket.fire('home:join-refused', { reason: 'error' });
    // A second refusal while one retry is pending neither stacks a timer nor toasts.
    h.socket.fire('home:join-refused', { reason: 'error' });
    const pend = h.t.pending();
    assert.equal(pend.length, 1, 'exactly one retry pending');
    h.t.fire(pend[0]);
  }
  assert.equal(joins(), 6);
  h.socket.fire('home:join-refused', { reason: 'error' });
  assert.equal(h.t.pending().length, 0, 'gave up: nothing scheduled');
  h.socket.fire('home:join-refused', { reason: 'error' });
  const msgs = h.toasts.map(x => x[0]);
  assert.equal(msgs.filter(m => m.startsWith('Reconnecting')).length, 1);
  assert.equal(msgs.filter(m => m.startsWith('Couldn’t join')).length, 1);
});

test('home join-refused: a successful join (snapshot) resets the sequence', () => {
  const h = mpHarness();
  h.socket.fire('connect');
  for (let i = 0; i < 4; i++) { h.socket.fire('home:join-refused', { reason: 'slow-down', retryInMs: 1000 }); h.t.fire(h.t.pending()[0]); }
  h.socket.fire('home:snapshot', { players: [] });
  h.socket.fire('home:join-refused', { reason: 'slow-down', retryInMs: 1000 });
  const pend = h.t.pending();
  assert.equal(pend.length, 1);
  assert.equal(pend[0].ms, 2000, 'back to the first step');
  assert.equal(h.toasts.filter(x => x[0].startsWith('Reconnecting')).length, 2);
});

test("'io server disconnect' (ban / reset) reconnects once so the handshake can explain", () => {
  const h = mpHarness();
  h.socket.fire('connect');
  h.socket.fire('disconnect', 'io server disconnect');
  assert.equal(h.socket.connects, 1);
  // Dropped again right away: no loop.
  h.socket.fire('disconnect', 'io server disconnect');
  assert.equal(h.socket.connects, 1);
  // Ordinary drops are left to socket.io's own reconnection.
  h.socket.fire('disconnect', 'transport close');
  assert.equal(h.socket.connects, 1);
});

test("'io server disconnect' after a kick, or after stop(), does not reconnect", () => {
  const a = mpHarness();
  a.socket.fire('connect');
  a.socket.fire('home:kicked', { reason: 'elsewhere' });
  a.socket.fire('disconnect', 'io server disconnect');
  assert.equal(a.socket.connects, 0);

  const b = mpHarness();
  b.socket.fire('connect');
  b.handle.stop();
  b.toasts.length = 0;
  b.socket.fire('disconnect', 'io server disconnect');
  assert.equal(b.socket.connects, 0);
  assert.equal(b.toasts.length, 0);
});

test('/world chat: an ack timeout after stop() stays quiet', () => {
  const h = mpHarness({ world: true });
  h.socket.fire('connect');
  h.input.value = 'hello';
  h.keydown[0]({ key: 'Enter', preventDefault() {} });
  const sent = h.socket.emitted.find(e => e[0] === 'world:chat');
  assert.ok(sent, 'chat emitted');
  h.handle.stop();
  h.toasts.length = 0;
  const guard = h.t.pending().find(t => t.ms === 6000);
  assert.ok(guard, 'guard timer pending');
  h.t.fire(guard);
  sent[2]({ ok: false, error: 'cooldown' });
  assert.deepEqual(h.toasts, []);
});

// ── js/scene-guess.js ──

function sgHarness() {
  const t = fakeTimers();
  const socket = fakeSocket();
  const toasts = [];
  const ctx = {
    console: { log() {}, warn() {} },
    window: {},
    API: '/api',
    Auth: { getToken: () => 't' },
    fetch: () => Promise.reject(new Error('offline')),
    toast: (msg, type) => toasts.push([msg, type]),
    document: { querySelector: () => null, querySelectorAll: () => [], createElement: () => ({}) },
    Date, Promise,
    ...t.api
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const SG = vm.runInContext(SG_SRC + '\n;SceneGuess', ctx);
  SG.start({ socket, engine: null, username: 'me' });
  return { SG, socket, toasts, t };
}

test("Scene Guess emit: stop() resolves a pending request as 'stopped' and clears its timer", async () => {
  const h = sgHarness();
  const p = h.SG._debug.emit('world:sg-start', { projectId: 'x' });
  const sent = h.socket.emitted.find(e => e[0] === 'world:sg-start');
  assert.ok(sent);
  assert.equal(h.t.pending().filter(t => t.ms === 8000).length, 1);
  h.SG.stop();
  assert.deepEqual({ ...(await p) }, { ok: false, error: 'stopped' });   // vm realm → plain copy
  assert.equal(h.t.pending().filter(t => t.ms === 8000).length, 0, 'guard timer cleared');
  sent[2]({ ok: false, error: 'busy' });          // a late ack changes nothing
  assert.deepEqual(h.toasts, []);
  // …and a request after stop() never reaches the socket.
  assert.deepEqual({ ...(await h.SG._debug.emit('world:sg-join', {})) }, { ok: false, error: 'stopped' });
});

test('Scene Guess emit: an ack before stop() still resolves normally', async () => {
  const h = sgHarness();
  const p = h.SG._debug.emit('world:sg-join', { projectId: 'x' });
  h.socket.emitted.find(e => e[0] === 'world:sg-join')[2]({ ok: true });
  assert.deepEqual(await p, { ok: true });
  assert.equal(h.t.pending().filter(t => t.ms === 8000).length, 0);
  h.SG.stop();
});

test('Scene Guess: every error the server can reply with has its own message', () => {
  const server = read('server/scene-guess.js') + read('js/scene-guess-logic.js');
  const codes = new Set();
  // Short kebab-case codes only (the logic's CMS validation messages are prose).
  for (const m of server.matchAll(/error: '([a-z][a-z-]*)'/g)) codes.add(m[1]);
  for (const c of ['offline', 'timeout']) codes.add(c);   // the client's own
  const block = SG_SRC.slice(SG_SRC.indexOf('const ERRORS = {'), SG_SRC.indexOf('};', SG_SRC.indexOf('const ERRORS = {')));
  const missing = [...codes].filter(c => !block.includes(`'${c}':`));
  assert.ok(codes.size >= 15, 'found the server codes');
  assert.deepEqual(missing, []);
  assert.ok(SG_SRC.includes("st.reason === 'restart'"), "the 'restart' end reason is handled");
});
