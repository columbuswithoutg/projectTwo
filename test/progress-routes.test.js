/************************************************
 * routes/progress.js — the watch timer's race guards (SRV-13), with Mongo
 * stubbed. (GET / POST /walkers: test/progress-walkers-route.test.js.)
 *
 * The real router runs on a throwaway express app behind a stand-in JWT
 * middleware (as in test/quote-routes.test.js). User is ONE in-memory
 * document behind a findOneAndUpdate that really evaluates the conditional
 * filters the routes rely on — $elemMatch on the exact session, $ne on the
 * project id, and the $expr caps ($size / $filter / $ifNull / $lt / $and) —
 * and applies the update in the same step, the way Mongo does it
 * atomically. `holdReads(n)` makes the first n findById reads wait for each
 * other, so two requests both see the same "before" state and then race
 * their writes: the second must lose on the filter, never double-apply.
 * Covers: start twice (in sequence and racing), the running-timer cap
 * (racing), the locked project, complete without start, complete before
 * the runtime, complete twice (in sequence and racing; one watch counted,
 * one post), a series episode step racing, a stale complete, cancel.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const ME = 'u1';
let currentUser = ME;
const authPath = require.resolve('../middleware/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: (req, res, next) => { req.user = { id: currentUser }; next(); } };

const watchRules = require('../server/watchRules');
const PROJECTS = new Map([
  ['ironman1', { id: 'ironman1', title: 'Iron Man', phase: 1, runtime: 126 }],
  ['hulk', { id: 'hulk', title: 'The Incredible Hulk', phase: 1, runtime: 112 }],
  ['thor1', { id: 'thor1', title: 'Thor', phase: 1, runtime: 115 }],
  ['wandavision', { id: 'wandavision', title: 'WandaVision', phase: 1, episodes: [30, 30, 30] }],
  ['avengers1', { id: 'avengers1', title: 'The Avengers', phase: 1, runtime: 143, prerequisites: ['ironman1', 'thor1'] }]
]);
watchRules.getProject = async (id) => PROJECTS.get(id) || null;

const feed = require('../server/feed');
let posts = [];
feed.createWatchPost = async (userId, projectId, o) => { posts.push({ userId, projectId, ...o }); return { _id: 'post' + posts.length }; };

const User = require('../models/user');

// ── one user document + a tiny Mongo ──

let doc = null;                 // the stored user (null = deleted)
const clone = (v) => structuredClone(v);
const same = (a, b) => (a instanceof Date || b instanceof Date)
  ? (a != null && b != null && new Date(a).getTime() === new Date(b).getTime())
  : (a === null ? b == null : String(a) === String(b));

function elemMatches(el, crit) {
  return Object.entries(crit).every(([k, v]) => (v === null ? el[k] == null : same(el[k], v)));
}
// $expr: just the operators the routes use.
function expr(e, vars) {
  if (typeof e === 'string' && e.startsWith('$$')) {
    const [name, ...path] = e.slice(2).split('.');
    return path.reduce((o, p) => (o == null ? undefined : o[p]), vars[name]);
  }
  if (typeof e === 'string' && e.startsWith('$')) return doc[e.slice(1)];
  if (!e || typeof e !== 'object' || Array.isArray(e)) return e;
  const [op, arg] = Object.entries(e)[0];
  switch (op) {
    case '$and': return arg.every(x => expr(x, vars));
    case '$lt': return expr(arg[0], vars) < expr(arg[1], vars);
    case '$ne': return expr(arg[0], vars) !== expr(arg[1], vars);
    case '$size': return expr(arg, vars).length;
    case '$ifNull': { const v = expr(arg[0], vars); return v == null ? expr(arg[1], vars) : v; }
    case '$filter': return expr(arg.input, vars).filter(item => expr(arg.cond, { ...vars, [arg.as]: item }));
    default: throw new Error('expr op not stubbed: ' + op);
  }
}
// → { ok, pos } (pos: the index the positional $ refers to).
function evalFilter(f) {
  if (!doc || !same(doc._id, f._id)) return { ok: false };
  let pos = null;
  for (const [k, v] of Object.entries(f)) {
    if (k === '_id') continue;
    if (k === '$expr') { if (!expr(v, {})) return { ok: false }; continue; }
    if (k === 'watchSessions' && v.$elemMatch) {
      const i = (doc.watchSessions || []).findIndex(s => elemMatches(s, v.$elemMatch));
      if (i < 0) return { ok: false };
      pos = i;
      continue;
    }
    const [arr, field] = k.split('.');
    const list = doc[arr] || [];
    if (v && typeof v === 'object' && '$ne' in v) { if (list.some(x => same(x[field], v.$ne))) return { ok: false }; continue; }
    const i = list.findIndex(x => same(x[field], v));
    if (i < 0) return { ok: false };
    pos = i;
  }
  return { ok: true, pos };
}
function applyUpdate(u, pos, arrayFilters) {
  const target = (path, fn) => {
    const [arr, sel, field] = path.split('.');
    if (sel === '$') return fn(doc[arr][pos], field);
    if (sel === '$[w]') {
      const af = arrayFilters[0];
      for (const el of doc[arr]) {
        if (same(el.projectId, af['w.projectId']) && (el.count || 0) < af['w.count'].$lt) fn(el, field);
      }
      return;
    }
    return fn(doc, arr);
  };
  for (const [p, v] of Object.entries(u.$set || {})) target(p, (o, k) => { o[k] = clone(v); });
  for (const [p, v] of Object.entries(u.$inc || {})) target(p, (o, k) => { o[k] = (o[k] || 0) + v; });
  for (const [p, v] of Object.entries(u.$pull || {})) {
    doc[p] = (doc[p] || []).filter(x => !Object.entries(v).every(([k, want]) => same(x[k], want)));
  }
  for (const [p, v] of Object.entries(u.$push || {})) {
    target(p, (o, k) => {
      o[k] = o[k] || [];
      if (v && v.$each) { o[k].push(...clone(v.$each)); if (v.$slice) o[k] = o[k].slice(v.$slice); } else o[k].push(clone(v));
    });
  }
}

const lean = (fn) => ({ select() { return this; }, lean: async () => fn() });
let held = null;               // { n, waiting: [] } while holdReads is on
let reads = 0;
function holdReads(n) { held = { n, waiting: [] }; }
User.findById = (id) => lean(async () => {
  reads++;
  if (held) {
    const h = held;
    await new Promise(resolve => {
      h.waiting.push(resolve);
      if (h.waiting.length >= h.n) { held = null; h.waiting.forEach(r => r()); }
    });
  }
  return doc && same(doc._id, id) ? clone(doc) : null;
});
let writes = [];
User.findOneAndUpdate = (f, u, opts = {}) => lean(async () => {
  const r = evalFilter(f);
  writes.push({ ok: r.ok, filter: f });
  if (!r.ok) return null;
  applyUpdate(u, r.pos, opts.arrayFilters || []);
  return clone(doc);
});
User.findByIdAndUpdate = (id, u) => lean(async () => {
  if (!doc || !same(doc._id, id)) return null;
  applyUpdate(u, null, []);
  return clone(doc);
});
User.updateOne = async (f, u) => {
  if (!doc || !same(doc._id, f._id)) return { matchedCount: 0 };
  applyUpdate(u, null, []);
  return { matchedCount: 1 };
};

const app = express();
app.use(express.json());
app.use('/api/progress', require('../routes/progress'));

let server;
test.before(() => new Promise((resolve) => { server = app.listen(0, resolve); }));
test.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));

const hoursAgo = (h) => new Date(Date.now() - h * 3600e3);
test.beforeEach(() => {
  currentUser = ME;
  held = null; reads = 0; writes = []; posts = [];
  doc = { _id: ME, watchedProjects: [], watchSessions: [] };
});

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ port: server.address().port, method: 'POST', path: '/api/progress' + path, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ port: server.address().port, path: '/api/progress' + path }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
    }).on('error', reject);
  });
}
const sessionsOf = (id) => doc.watchSessions.filter(s => s.projectId === id);
const quiet = async (fn) => { const o = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = o; } };

// ── /start ──

test('start: a new timer; starting it again is a no-op that returns the same running session', async () => {
  let r = await post('/start', { projectId: 'ironman1' });
  assert.equal(r.status, 200);
  assert.equal(sessionsOf('ironman1').length, 1);
  const first = sessionsOf('ironman1')[0];
  assert.equal(first.episode, 0);
  assert.equal(first.rewatch, false);
  assert.ok(first.startedAt instanceof Date);
  assert.equal(typeof r.body.serverNow, 'number');
  const writesBefore = writes.length;
  r = await post('/start', { projectId: 'ironman1' });
  assert.equal(r.status, 200);
  assert.equal(writes.length, writesBefore, 'already running → no write at all');
  assert.equal(sessionsOf('ironman1').length, 1);
  assert.equal(new Date(r.body.watchSessions[0].startedAt).getTime(), first.startedAt.getTime(), 'the timer is not restarted');
});

test('start twice at once (two tabs): one session, both answered 200 with it', async () => {
  holdReads(2);
  const [a, b] = await Promise.all([post('/start', { projectId: 'ironman1' }), post('/start', { projectId: 'ironman1' })]);
  assert.deepEqual([a.status, b.status], [200, 200]);
  assert.equal(sessionsOf('ironman1').length, 1, 'the $ne guard stopped the second push');
  assert.deepEqual(writes.map(w => w.ok), [true, false]);
  for (const r of [a, b]) assert.equal(r.body.watchSessions.filter(s => s.projectId === 'ironman1').length, 1);
});

test('the running-timer cap holds when two starts race for the last slot', async () => {
  assert.equal((await post('/start', { projectId: 'ironman1' })).status, 200);
  holdReads(2);
  const [a, b] = await Promise.all([post('/start', { projectId: 'hulk' }), post('/start', { projectId: 'thor1' })]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409], 'only one of the two gets the second slot');
  assert.equal(doc.watchSessions.filter(s => s.startedAt).length, 2);
  const lost = a.status === 409 ? a : b;
  assert.match(lost.body.error, /2 timers running/);
  assert.equal(lost.body.watchSessions.length, 2, 'the loser gets the current state to reconcile');
});

test('start: a locked project is 403 and nothing is written; bad / unknown ids', async () => {
  let r = await post('/start', { projectId: 'avengers1' });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /^Watch (Iron Man|ironman1) first$/);
  assert.equal(writes.length, 0);
  assert.equal((await post('/start', { projectId: { $ne: 1 } })).status, 400);
  assert.equal((await post('/start', { projectId: '' })).status, 400);
  assert.equal((await post('/start', { projectId: 'nope' })).status, 404);
  doc = null;
  assert.equal((await post('/start', { projectId: 'ironman1' })).status, 404);
});

test('start: a rewatch of a finished title is allowed even when locked, and flagged', async () => {
  doc.watchedProjects.push({ projectId: 'avengers1', count: 1 });
  const r = await post('/start', { projectId: 'avengers1' });
  assert.equal(r.status, 200);
  assert.equal(sessionsOf('avengers1')[0].rewatch, true);
});

test('start the next episode: the $elemMatch guard lets two racing tabs start it once', async () => {
  doc.watchSessions.push({ projectId: 'wandavision', episode: 1, startedAt: null, rewatch: false });
  holdReads(2);
  const [a, b] = await Promise.all([post('/start', { projectId: 'wandavision' }), post('/start', { projectId: 'wandavision' })]);
  assert.deepEqual([a.status, b.status], [200, 200], 'the loser re-reads and sees it running');
  assert.deepEqual(writes.map(w => w.ok), [true, false]);
  assert.equal(sessionsOf('wandavision').length, 1);
  assert.equal(sessionsOf('wandavision')[0].episode, 1);
  assert.ok(sessionsOf('wandavision')[0].startedAt instanceof Date);
});

// ── /complete ──

test('complete without start is 409 "Press Start watching first"; between episodes it names the next one', async () => {
  let r = await post('/complete', { projectId: 'ironman1', skipPost: true });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'Press Start watching first');
  doc.watchSessions.push({ projectId: 'wandavision', episode: 1, startedAt: null });
  r = await post('/complete', { projectId: 'wandavision', skipPost: true });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'Start episode 2 first');
  assert.equal(writes.length, 0);
  assert.equal(doc.watchedProjects.length, 0);
});

test('complete before the runtime has passed is 409 with the time left', async () => {
  await post('/start', { projectId: 'ironman1' });
  const r = await post('/complete', { projectId: 'ironman1', skipPost: true });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'Not finished yet');
  assert.ok(r.body.remainingMs > 60 * 60e3);
  assert.equal(doc.watchedProjects.length, 0);
});

test('complete a movie, then complete again: counted once, the second is 409', async () => {
  doc.watchSessions.push({ projectId: 'ironman1', episode: 0, startedAt: hoursAgo(3), rewatch: false });
  let r = await post('/complete', { projectId: 'ironman1' });
  assert.equal(r.status, 200);
  assert.equal(r.body.finished, true);
  assert.deepEqual(doc.watchedProjects.map(w => [w.projectId, w.count]), [['ironman1', 1]]);
  assert.equal(sessionsOf('ironman1').length, 0, 'the session is gone');
  assert.equal(posts.length, 1);
  assert.deepEqual(r.body.post, { id: 'post1' });
  r = await post('/complete', { projectId: 'ironman1' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'Press Start watching first');
  assert.equal(doc.watchedProjects[0].count, 1);
  assert.equal(posts.length, 1);
});

test('complete twice at once (double-click): one watch counted, one post, the other 409 "Already completed"', async () => {
  doc.watchSessions.push({ projectId: 'ironman1', episode: 0, startedAt: hoursAgo(3), rewatch: false });
  holdReads(2);
  const [a, b] = await Promise.all([post('/complete', { projectId: 'ironman1' }), post('/complete', { projectId: 'ironman1' })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const lost = a.status === 409 ? a : b;
  assert.equal(lost.body.error, 'Already completed');
  assert.deepEqual(doc.watchedProjects.map(w => [w.projectId, w.count]), [['ironman1', 1]]);
  assert.equal(posts.length, 1);
  assert.equal(doc.watchSessions.length, 0);
});

test('a racing double-complete of a rewatch counts one more watch, not two', async () => {
  doc.watchedProjects.push({ projectId: 'ironman1', count: 2, memories: [] });
  doc.watchSessions.push({ projectId: 'ironman1', episode: 0, startedAt: hoursAgo(3), rewatch: true });
  holdReads(2);
  const [a, b] = await Promise.all([
    post('/complete', { projectId: 'ironman1', skipPost: true }),
    post('/complete', { projectId: 'ironman1', skipPost: true })
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(doc.watchedProjects[0].count, 3);
  assert.equal(doc.watchedProjects.length, 1, 'the fallback push never adds a duplicate entry');
});

test('complete a series episode twice at once: it advances one episode, the other is 409 "Already marked"', async () => {
  doc.watchSessions.push({ projectId: 'wandavision', episode: 0, startedAt: hoursAgo(1), rewatch: false });
  holdReads(2);
  const [a, b] = await Promise.all([post('/complete', { projectId: 'wandavision' }), post('/complete', { projectId: 'wandavision' })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const won = a.status === 200 ? a : b, lost = a.status === 409 ? a : b;
  assert.equal(won.body.finished, false);
  assert.equal(lost.body.error, 'Already marked');
  assert.equal(lost.body.finished, false);
  assert.deepEqual(sessionsOf('wandavision').map(s => [s.episode, s.startedAt]), [[1, null]], 'episode 2 is next, not 3');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].episode, 1);
});

test('a stale complete for an older start of the same title does not finish the new one', async () => {
  // Tab 1 read the session; meanwhile it was cancelled and restarted (a new
  // startedAt). The exact-session $elemMatch makes tab 1's write miss.
  doc.watchSessions.push({ projectId: 'thor1', episode: 0, startedAt: hoursAgo(3), rewatch: false });
  const origFind = User.findById;
  User.findById = (id) => lean(async () => {
    const snap = await origFind(id).lean();
    // The session the route read is replaced by a fresh start before its write.
    doc.watchSessions = doc.watchSessions.map(s => (s.projectId === 'thor1' ? { ...s, startedAt: new Date() } : s));
    return snap;
  });
  try {
    const stale = await post('/complete', { projectId: 'thor1', skipPost: true });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error, 'Already completed');
    assert.equal(doc.watchedProjects.some(w => w.projectId === 'thor1'), false);
    assert.equal(sessionsOf('thor1').length, 1, 'the new timer keeps running');
  } finally {
    User.findById = origFind;
  }
});

test('complete: a bad post payload is refused before anything is read', async () => {
  doc.watchSessions.push({ projectId: 'ironman1', episode: 0, startedAt: hoursAgo(3) });
  const r = await post('/complete', { projectId: 'ironman1', caption: 42 });
  assert.equal(r.status, 400);
  assert.equal(reads, 0);
  assert.equal(doc.watchedProjects.length, 0);
});

test('cancel removes the session; a deleted user is 404', async () => {
  doc.watchSessions.push({ projectId: 'ironman1', episode: 0, startedAt: hoursAgo(1) });
  let r = await post('/cancel', { projectId: 'ironman1' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.watchSessions, []);
  doc = null;
  r = await post('/cancel', { projectId: 'ironman1' });
  assert.equal(r.status, 404);
});

