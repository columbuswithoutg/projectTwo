/************************************************
 * js/home-socket.js handshake auth (audit 2026-10-31, RT3-02):
 *   - io() gets the FUNCTION form of `auth`, so every (re)connect reads the
 *     token in storage at that moment (a password change / rename in
 *     another tab rotates it and the server drops this socket).
 *   - a session refusal from the handshake ('Session expired, please log in
 *     again', 'Invalid token', 'No token') shows the session message and
 *     goes through Auth.endSession (the app's 401 path), not "Can't reach";
 *     when storage already holds a newer token, one quiet retry instead.
 *
 * Browser script (const Multiplayer = (() => …)()), run in a vm context
 * with a fake io / Auth / DOM.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MP_SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'home-socket.js'), 'utf8');

function harness({ world = true } = {}) {
  const handlers = {};
  const socket = {
    id: 'sock1', connected: false, connects: 0,
    on(ev, fn) { handlers[ev] = fn; },
    off(ev) { delete handlers[ev]; },
    emit() {},
    connect() { this.connects++; },
    disconnect() { this.connected = false; },
    fire(ev, ...args) { if (handlers[ev]) handlers[ev](...args); }
  };
  const store = { token: 'tok-1' };
  const toasts = [];
  const ended = [];
  let ioOpts = null;
  const noop = () => {};
  const ctx = {
    console: { log() {}, warn() {} },
    io: (opts) => { ioOpts = opts; return socket; },
    Auth: {
      getToken: () => store.token,
      getUsername: () => 'me',
      endSession: () => { ended.push(store.token); return new Promise(() => {}); }
    },
    Playground3D: new Proxy({}, { get: () => noop }),
    WorldChatLogic: require('../js/world-chat-logic.js'),
    toast: (msg, type) => toasts.push([msg, type]),
    localStorage: { getItem: () => null, setItem() {} },
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => []
    },
    Date,
    setTimeout: () => 0, clearTimeout: noop, setInterval: () => 0, clearInterval: noop
  };
  vm.createContext(ctx);
  const MP = vm.runInContext(MP_SRC + '\n;Multiplayer', ctx);
  const handle = MP.start({ events: world ? MP.WORLD_EVENTS : MP.HOME_EVENTS, joinPayload: { ownerUsername: 'o' }, character: {} });
  // What socket.io does on each (re)connect: call auth(cb) and send the result.
  const handshake = () => { let sent; ioOpts.auth((a) => { sent = a; }); return sent; };
  return { handle, socket, store, toasts, ended, ioOpts: () => ioOpts, handshake };
}

test('auth is a function that reads the CURRENT token at each handshake', () => {
  const h = harness();
  assert.equal(typeof h.ioOpts().auth, 'function', 'function form, not a token captured at start()');
  assert.deepEqual({ ...h.handshake() }, { token: 'tok-1' });
  h.store.token = 'tok-2';   // password change in another tab
  assert.deepEqual({ ...h.handshake() }, { token: 'tok-2' });
});

for (const msg of ['Session expired, please log in again', 'Invalid token', 'No token']) {
  test(`connect_error '${msg}' with no newer token: session message + Auth.endSession`, () => {
    const h = harness();
    h.handshake();
    h.socket.fire('connect_error', new Error(msg));
    assert.equal(h.toasts.length, 1);
    assert.equal(h.toasts[0][0], 'Session expired — please log in again.');
    assert.ok(!h.toasts[0][0].startsWith('Can'), "not \"Can't reach the world server\"");
    assert.equal(h.ended.length, 1, 'the 401 path ran');
    assert.equal(h.socket.connects, 0, 'no retry with the same dead token');
  });
}

test('session refusal while storage already holds a newer token: one quiet retry, then the 401 path', () => {
  const h = harness();
  h.handshake();               // sent tok-1
  h.store.token = 'tok-2';     // another tab rotated it mid-handshake
  h.socket.fire('connect_error', new Error('Session expired, please log in again'));
  assert.equal(h.socket.connects, 1, 'retried once');
  assert.equal(h.toasts.length, 0, 'quiet');
  assert.equal(h.ended.length, 0);
  // The retry's handshake carries tok-2; if that is refused too, give up.
  assert.deepEqual({ ...h.handshake() }, { token: 'tok-2' });
  h.socket.fire('connect_error', new Error('Session expired, please log in again'));
  assert.equal(h.socket.connects, 1, 'no second retry');
  assert.equal(h.toasts[0][0], 'Session expired — please log in again.');
  assert.equal(h.ended.length, 1);
});

test('a network error still reads "Can’t reach the world server." and never ends the session', () => {
  const h = harness();
  h.handshake();
  h.socket.fire('connect_error', new Error('xhr poll error'));
  assert.equal(h.toasts[0][0], 'Can’t reach the world server.');
  assert.equal(h.ended.length, 0);
});

test("'Account suspended' keeps its own message and does not log out", () => {
  const h = harness({ world: false });
  h.handshake();
  h.socket.fire('connect_error', new Error('Account suspended'));
  assert.equal(h.toasts[0][0], 'Your account has been suspended.');
  assert.equal(h.ended.length, 0);
});

test('server drop then reconnect: the manual reconnect handshake sends the new token', () => {
  const h = harness();
  h.handshake();
  h.socket.fire('connect');
  h.store.token = 'tok-2';
  h.socket.fire('disconnect', 'io server disconnect');
  assert.equal(h.socket.connects, 1);
  assert.deepEqual({ ...h.handshake() }, { token: 'tok-2' });
});
