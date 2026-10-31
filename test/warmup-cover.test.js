/************************************************
 * /world "Almost ready…" cover (js/playground3d.js _whenWarm / _compileWarm).
 * The shader warm-up used three r160's renderer.compileAsync, whose timer
 * poll throws an uncaught TypeError (reading 'isReady') when a material it
 * waits on is disposed mid-poll (the island rebuild ~200 ms into a mount), so
 * the promise never settled and every mount held the cover for the full
 * WARMUP_MS. The functions are lifted from the engine source and run against
 * a fake clock and a fake renderer.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'js/playground3d.js'), 'utf8');
const lift = (re, what) => {
  const m = ENGINE.match(re);
  assert.ok(m, what + ' not found in js/playground3d.js');
  return m[0];
};
const SRC = [
  lift(/\n  function _whenWarm\([\s\S]*?\n  \}\n/, '_whenWarm'),
  lift(/\n  function _compileWarm\([\s\S]*?\n  \}\n/, '_compileWarm')
].join('');
const WARMUP_MS = Number(lift(/const WARMUP_MS = (\d+);/, 'WARMUP_MS').match(/\d+/)[0]);

// A fake clock: setTimeout queues, advance(ms) runs what falls due in order.
function makeClock() {
  let now = 0, seq = 0;
  const q = new Map();
  return {
    get now() { return now; },
    setTimeout(fn, ms) { const id = ++seq; q.set(id, { at: now + (ms || 0), fn }); return id; },
    clearTimeout(id) { q.delete(id); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        await flush();
        let next = null;
        for (const [id, t] of q) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
        if (!next) break;
        q.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = end;
      await flush();
    }
  };
}
const flush = () => new Promise((r) => setImmediate(r));

function load(clock) {
  const ctx = { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, Promise };
  vm.runInNewContext(SRC + '\nthis.whenWarm = _whenWarm; this.compileWarm = _compileWarm;', ctx);
  return ctx;
}

// Starts the gate and records when done()/onFail() ran on the fake clock.
function gate(start, opts = {}) {
  const clock = makeClock();
  const { whenWarm } = load(clock);
  const rec = { doneAt: [], failed: [] };
  let live = true;
  whenWarm(start, WARMUP_MS, () => live && !opts.stale, () => rec.doneAt.push(clock.now), (e) => rec.failed.push(e));
  return { clock, rec, kill() { live = false; } };
}

test('the warm-up no longer goes through three r160 compileAsync', () => {
  const body = lift(/\n  function _startWhenWarm\([\s\S]*?\n  \}\n/, '_startWhenWarm');
  assert.doesNotMatch(body, /compileAsync/);
  assert.match(body, /_whenWarm\(/);
  assert.match(body, /WARMUP_MS/, 'WARMUP_MS stays the safety net');
  assert.match(body, /gen === _mountGen/, 'the mount generation still guards it');
});

test('compile resolves → the cover drops straight away', async () => {
  const { clock, rec } = gate(() => Promise.resolve());
  await clock.advance(0);
  assert.deepEqual(rec.doneAt, [0]);
  await clock.advance(WARMUP_MS * 2);
  assert.deepEqual(rec.doneAt, [0], 'done runs once; the timer is cleared');
});

test('compile rejects → the cover drops promptly, not after WARMUP_MS', async () => {
  const err = new TypeError("Cannot read properties of undefined (reading 'isReady')");
  const { clock, rec } = gate(() => Promise.reject(err));
  await clock.advance(0);
  assert.deepEqual(rec.doneAt, [0]);
  assert.deepEqual(rec.failed, [err], 'the failure is reported once');
});

test('compile throws synchronously → the cover still drops promptly', async () => {
  const { clock, rec } = gate(() => { throw new Error('no context'); });
  await clock.advance(0);
  assert.deepEqual(rec.doneAt, [0]);
  assert.equal(rec.failed.length, 1);
});

test('no renderer to compile with (start returns null) → drops at once', async () => {
  const { clock, rec } = gate(() => null);
  await clock.advance(0);
  assert.deepEqual(rec.doneAt, [0]);
});

test('compile hangs → the cover drops at WARMUP_MS', async () => {
  const { clock, rec } = gate(() => new Promise(() => {}));
  await clock.advance(WARMUP_MS - 1);
  assert.deepEqual(rec.doneAt, []);
  await clock.advance(1);
  assert.deepEqual(rec.doneAt, [WARMUP_MS]);
});

test('a stale mount generation is ignored (late resolve, or the timer)', async () => {
  let resolve;
  const late = gate(() => new Promise((r) => { resolve = r; }));
  await late.clock.advance(100);
  late.kill();                       // left /world; a newer mount owns the cover
  resolve();
  await late.clock.advance(WARMUP_MS * 2);
  assert.deepEqual(late.rec.doneAt, []);

  const hung = gate(() => new Promise(() => {}), { stale: true });
  await hung.clock.advance(WARMUP_MS * 2);
  assert.deepEqual(hung.rec.doneAt, []);
});

// A renderer whose compile() returns the scene's materials and whose
// properties mirror WebGLProperties: dispose() drops the entry, get() then
// hands back a fresh {} with no currentProgram (what made r160 throw).
function fakeRenderer(readyAfter) {
  const props = new WeakMap();
  const mats = readyAfter.map((n, i) => {
    let polls = 0;
    const m = { id: i, dispose() { props.delete(m); } };
    props.set(m, { currentProgram: { isReady: () => ++polls > n } });
    return m;
  });
  const renderer = {
    compile: () => new Set(mats),
    properties: { get(m) { if (!props.has(m)) props.set(m, {}); return props.get(m); } }
  };
  return { renderer, mats };
}

test('_compileWarm resolves once every program reports ready', async () => {
  const clock = makeClock();
  const { compileWarm } = load(clock);
  const { renderer } = fakeRenderer([0, 2, 5]);
  let settled = null;
  compileWarm(renderer, {}, {}, () => true).then(() => { settled = clock.now; });
  await clock.advance(40);
  assert.equal(settled, null, 'still waiting on the slow program');
  await clock.advance(20);
  assert.equal(settled, 50, 'ready on the 6th poll, 10 ms apart');
});

test('_compileWarm: a material disposed mid-poll counts as done, nothing throws', async () => {
  const clock = makeClock();
  const { compileWarm } = load(clock);
  const { renderer, mats } = fakeRenderer([0, 1000, 1000]);
  let state = 'pending';
  compileWarm(renderer, {}, {}, () => true).then(() => { state = 'resolved'; }, () => { state = 'rejected'; });
  await clock.advance(25);
  assert.equal(state, 'pending');
  mats[1].dispose();                 // the island rebuild tears these down
  mats[2].dispose();
  await clock.advance(10);
  assert.equal(state, 'resolved');
});

test('_compileWarm stops polling once the mount is gone', async () => {
  const clock = makeClock();
  const { compileWarm } = load(clock);
  const { renderer } = fakeRenderer([1e9]);
  let live = true, polls = 0, state = 'pending';
  const get = renderer.properties.get;
  renderer.properties.get = (m) => { polls++; return get(m); };
  compileWarm(renderer, {}, {}, () => live).then(() => { state = 'resolved'; });
  await clock.advance(30);
  live = false;
  await clock.advance(10);
  const at = polls;
  await clock.advance(1000);
  assert.equal(state, 'resolved');
  assert.equal(polls, at, 'no polls after the mount went away');
});

test('_compileWarm rejects (instead of throwing from a timer) when a check fails', async () => {
  const clock = makeClock();
  const { compileWarm } = load(clock);
  const { renderer } = fakeRenderer([3]);
  let n = 0;
  const get = renderer.properties.get;
  renderer.properties.get = (m) => { if (++n === 2) throw new Error('lost context'); return get(m); };
  let err = null;
  compileWarm(renderer, {}, {}, () => true).catch((e) => { err = e; });
  await clock.advance(50);
  assert.match(String(err), /lost context/);
});

test('_compileWarm: a renderer without a materials set resolves at once', async () => {
  const clock = makeClock();
  const { compileWarm } = load(clock);
  let ok = false;
  await compileWarm({ compile: () => undefined, properties: {} }, {}, {}, () => true).then(() => { ok = true; });
  assert.ok(ok);
});
