/************************************************
 * server/scene-guess-data.js — the cached() helper behind settings /
 * islands / pool / projects / champions, and invalidate()'s events.
 *
 * Deterministic: the clock is injected (`now`), and every load is a
 * promise the test resolves or rejects by hand. No Mongo — the one
 * end-to-end check stubs Project.find.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const Project = require('../models/Project');
const SceneData = require('../server/scene-guess-data');
const { cached } = SceneData;

const TTL = 1000;
// The loader runs on a microtask (Promise.resolve().then(loadFn)).
const flush = () => new Promise(r => setImmediate(r));

// A cache whose loads wait for the test: h.pending[i].resolve(v) / .reject(e).
function harness(initial = 'init') {
  const h = { t: 5000, loads: 0, pending: [] };
  h.cache = cached('test', () => {
    h.loads++;
    return new Promise((resolve, reject) => h.pending.push({ resolve, reject }));
  }, initial, { ttlMs: TTL, now: () => h.t });
  return h;
}

function quietErrors(t) {
  const errs = [];
  const orig = console.error;
  console.error = (...a) => errs.push(a);
  t.after(() => { console.error = orig; });
  return errs;
}

test('cached: before the first load peek returns the initial value and starts one load', async () => {
  const h = harness('init');
  assert.equal(h.cache.peek(), 'init');
  assert.equal(h.cache.peek(), 'init');
  await flush();
  assert.equal(h.loads, 1);
  await flush();
  h.pending[0].resolve('v1');
  assert.equal(await h.cache.get(), 'v1');
  await flush();
  assert.equal(h.loads, 1);
});

test('cached: single-flight — concurrent get()/peek() callers share one load', async () => {
  const h = harness();
  const ps = [h.cache.get(), h.cache.get(), h.cache.get()];
  h.cache.peek();
  await flush();
  assert.equal(h.loads, 1);
  await flush();
  h.pending[0].resolve('v1');
  assert.deepEqual(await Promise.all(ps), ['v1', 'v1', 'v1']);
  // Fresh until the TTL passes, then exactly one more load.
  h.t += TTL;
  assert.equal(await h.cache.get(), 'v1');
  await flush();
  assert.equal(h.loads, 1);
  h.t += 1;
  const again = [h.cache.get(), h.cache.get()];
  await flush();
  assert.equal(h.loads, 2);
  await flush();
  h.pending[1].resolve('v2');
  assert.deepEqual(await Promise.all(again), ['v2', 'v2']);
});

test('cached: invalidate during a load → that load is not stored, and the next read loads again', async () => {
  const h = harness('init');
  const p1 = h.cache.get();
  h.cache.invalidate();
  await flush();
  h.pending[0].resolve('stale');
  assert.equal(await p1, 'init');           // the stale result is dropped
  assert.equal(h.cache.peek(), 'init');     // ...and `at` was not set: peek is still stale → loads
  await flush();
  assert.equal(h.loads, 2);
  await flush();
  h.pending[1].resolve('fresh');
  assert.equal(await h.cache.get(), 'fresh');
  await flush();
  assert.equal(h.loads, 2);                 // now fresh: no further load
});

test('cached: get() after a mid-load invalidate starts a new load instead of joining the stale one', async () => {
  const h = harness('init');
  const p1 = h.cache.get();
  h.cache.invalidate();
  const p2 = h.cache.get();
  await flush();
  assert.equal(h.loads, 2);
  // The new load wins even if the stale one finishes last.
  await flush();
  h.pending[1].resolve('fresh');
  assert.equal(await p2, 'fresh');
  await flush();
  h.pending[0].resolve('stale');
  assert.equal(await p1, 'fresh');          // stale load returns the current value
  assert.equal(await h.cache.get(), 'fresh');
  await flush();
  assert.equal(h.loads, 2);
});

test('cached: a failed load keeps the old value, logs, and the next call retries', async (t) => {
  const errs = quietErrors(t);
  const h = harness();
  const p0 = h.cache.get();
  await flush();
  h.pending[0].resolve('v1');
  assert.equal(await p0, 'v1');

  h.t += TTL + 1;
  const p1 = h.cache.get();
  await flush();
  h.pending[1].reject(new Error('db down'));
  assert.equal(await p1, 'v1');             // never rejects
  assert.equal(errs.length, 1);
  assert.match(errs[0][0], /sceneGuess: test read failed/);
  assert.equal(errs[0][1], 'db down');

  // The failure did not refresh `at`: the very next call loads again.
  const p2 = h.cache.get();
  await flush();
  assert.equal(h.loads, 3);
  await flush();
  h.pending[2].resolve('v2');
  assert.equal(await p2, 'v2');
});

test('cached: a synchronous throw in the loader is handled like a rejection', async (t) => {
  const errs = quietErrors(t);
  let n = 0;
  const c = cached('sync', () => { n++; throw new Error('boom'); }, 'keep', { ttlMs: TTL, now: () => 1 });
  assert.equal(await c.get(), 'keep');
  assert.equal(await c.get(), 'keep');
  assert.equal(n, 2);
  assert.equal(errs.length, 2);
});

test('cached: peek returns the old value while a refresh is in flight', async () => {
  const h = harness();
  const p0 = h.cache.get();
  await flush();
  h.pending[0].resolve('v1');
  await p0;
  h.t += TTL + 1;
  assert.equal(h.cache.peek(), 'v1');       // stale → background refresh, old value now
  await flush();
  assert.equal(h.loads, 2);
  assert.equal(h.cache.peek(), 'v1');       // still in flight: no second load
  await flush();
  assert.equal(h.loads, 2);
  const waiting = h.cache.get();            // get() joins the same load
  await flush();
  assert.equal(h.loads, 2);
  await flush();
  h.pending[1].resolve('v2');
  assert.equal(await waiting, 'v2');
  assert.equal(h.cache.peek(), 'v2');
  await flush();
  assert.equal(h.loads, 2);
});

test('invalidate(kind, id): emits the event with the id and drops that cache', async (t) => {
  const orig = Project.find;
  t.after(() => { Project.find = orig; });
  let finds = 0;
  Project.find = () => {
    finds++;
    const docs = [{ id: 'iron-man', title: 'Iron Man ' + finds, runtime: 126, episodes: null }];
    return { select: () => ({ lean: async () => docs }) };
  };
  assert.equal((await SceneData.projects.get()).get('iron-man').title, 'Iron Man 1');
  await SceneData.projects.get();
  assert.equal(finds, 1);

  const seen = [];
  const onProjects = (id) => seen.push(['projects', id]);
  const onBoard = (id) => seen.push(['board', id]);
  SceneData.events.on('projects', onProjects);
  SceneData.events.on('board', onBoard);
  t.after(() => { SceneData.events.off('projects', onProjects); SceneData.events.off('board', onBoard); });

  SceneData.invalidate('projects', 'iron-man');
  assert.deepEqual(seen, [['projects', 'iron-man']]);
  assert.equal((await SceneData.projects.get()).get('iron-man').title, 'Iron Man 2');
  assert.equal(finds, 2);
  assert.equal(SceneData.projectSync('iron-man').title, 'Iron Man 2');

  SceneData.invalidate('board', null);
  assert.deepEqual(seen, [['projects', 'iron-man'], ['board', null]]);
});
