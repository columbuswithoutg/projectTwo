/************************************************
 * Unit tests for js/voice-chat.js — the bounded rebuild after an ICE
 * 'failed' (NET-03): retry after 1 s, then 10 s, then give up on that peer
 * with reason 'gave-up'; counts reset when the peer leaves / rejoins or a
 * connection succeeds; the non-initiating side never rebuilds on its own.
 *
 * voice-chat.js is a browser script (const VoiceManager = (() => …)()), so
 * it runs in a vm context with just enough fake WebRTC / DOM / timers.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'voice-chat.js'), 'utf8');

function harness(socketId) {
  const timers = [];   // pending setTimeout callbacks, fired by hand
  const pcs = [];
  class FakePC {
    constructor() { this.connectionState = 'new'; this.signalingState = 'stable'; pcs.push(this); }
    addTrack() {}
    close() { this.connectionState = 'closed'; }
    async createOffer() { return { type: 'offer', sdp: 'x' }; }
    async setLocalDescription() {}
    getStats() { return Promise.resolve(new Map()); }
    fail() { this.connectionState = 'failed'; this.onconnectionstatechange(); }
    connect() { this.connectionState = 'connected'; this.onconnectionstatechange(); }
  }
  const handlers = {};
  const emitted = [];
  const socket = {
    id: socketId,
    on(ev, fn) { handlers[ev] = fn; },
    off(ev) { delete handlers[ev]; },
    emit(ev, data) { emitted.push([ev, data]); }
  };
  const el = () => ({ style: {}, appendChild() {}, parentNode: null });
  const ctx = {
    console: { log() {}, warn() {} },
    RTCPeerConnection: FakePC,
    navigator: { mediaDevices: { getUserMedia: () => Promise.reject(Object.assign(new Error('x'), { name: 'NotFoundError' })) } },
    document: { createElement: el, body: el(), addEventListener() {}, removeEventListener() {} },
    window: { AudioContext: class { constructor() { this.state = 'running'; } close() {} } },
    fetch: () => Promise.reject(new Error('offline')),
    setTimeout: (fn, ms) => { const t = { fn, ms, done: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.done = true; },
    setInterval: () => 0,
    clearInterval: () => {}
  };
  vm.createContext(ctx);
  const VM = vm.runInContext(SRC + '\n;VoiceManager', ctx);
  const states = [];
  const handle = VM.start({
    socket, scope: 'world',
    getLocalState: () => null, getRemotePlayers: () => [],
    onPeerStateChange: (id, st) => states.push([id, st])
  });
  const retryTimers = () => timers.filter(t => !t.done && (t.ms === 1000 || t.ms === 10000));
  const fireRetries = () => retryTimers().forEach(t => { t.done = true; t.fn(); });
  return { VM, handle, handlers, pcs, states, timers, retryTimers, fireRetries };
}

test('failRetryDelay: 1 s, then 10 s, then give up', () => {
  const { VM } = harness('a');
  assert.equal(VM._failRetryDelay(1), 1000);
  assert.equal(VM._failRetryDelay(2), 10000);
  assert.equal(VM._failRetryDelay(3), null);
  assert.equal(VM._failRetryDelay(50), null);
  assert.equal(VM._failRetryDelay(0), null);
});

test('initiator: two delayed rebuilds, then gives up with reason gave-up', () => {
  const h = harness('a');                       // 'a' < 'b' → we initiate
  h.handlers['voice:peers']({ scope: 'world', peers: ['b'] });
  assert.equal(h.pcs.length, 1);

  h.pcs[0].fail();
  assert.equal(h.pcs.length, 1, 'no immediate rebuild');
  assert.deepEqual(h.retryTimers().map(t => t.ms), [1000]);
  h.fireRetries();
  assert.equal(h.pcs.length, 2);

  h.pcs[1].fail();
  assert.deepEqual(h.retryTimers().map(t => t.ms), [10000]);
  h.fireRetries();
  assert.equal(h.pcs.length, 3);

  h.pcs[2].fail();
  assert.equal(h.retryTimers().length, 0, 'no further retry scheduled');
  assert.equal(h.pcs.length, 3);
  const last = h.states[h.states.length - 1];
  assert.equal(last[0], 'b');
  assert.equal(last[1].reason, 'gave-up');
  assert.equal(h.states.filter(s => s[1].reason === 'gave-up').length, 1);
});

test('a successful connection resets the count', () => {
  const h = harness('a');
  h.handlers['voice:peers']({ scope: 'world', peers: ['b'] });
  h.pcs[0].fail(); h.fireRetries();
  h.pcs[1].connect();
  h.pcs[1].fail();
  assert.deepEqual(h.retryTimers().map(t => t.ms), [1000], 'back to the first delay');
});

test('peer leaving cancels a pending rebuild; coming back gets fresh retries', () => {
  const h = harness('a');
  h.handlers['voice:peers']({ scope: 'world', peers: ['b'] });
  h.pcs[0].fail(); h.fireRetries();
  h.pcs[1].fail();                               // 10 s rebuild pending
  h.handlers['voice:peer-left']({ id: 'b' });
  assert.equal(h.retryTimers().length, 0);
  h.handlers['voice:peer-joined']({ id: 'b' });
  assert.equal(h.pcs.length, 3);
  h.pcs[2].fail();
  assert.deepEqual(h.retryTimers().map(t => t.ms), [1000]);
});

test('non-initiator never rebuilds on its own and gives up after the same count', () => {
  const h = harness('z');                       // 'z' > 'b' → peer initiates
  h.handlers['voice:peers']({ scope: 'world', peers: ['b'] });
  for (let i = 0; i < 3; i++) {
    const before = h.pcs.length;
    h.pcs[before - 1].fail();
    assert.equal(h.retryTimers().length, 0, 'no rebuild timer on the answering side');
    assert.equal(h.pcs.length, before, 'no new PC without an offer');
    // The initiator's rebuilt offer arrives: handleSignal creates a fresh
    // entry synchronously (the fake PC can't finish the answer — that's fine).
    if (i < 2) h.handlers['voice:signal']({ from: 'b', kind: 'offer', data: { type: 'offer', sdp: 'x' } });
  }
  const reasons = h.states.map(s => s[1].reason).filter(Boolean);
  assert.deepEqual(reasons, ['failed', 'failed', 'gave-up']);
  h.handle.stop();
});
