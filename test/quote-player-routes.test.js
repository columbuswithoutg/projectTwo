/************************************************
 * routes/world-quotes.js — the four Quote Guess player reads, with Mongo
 * stubbed (RT2-03):
 *   GET /quote                    what /world needs at mount
 *   GET /quote/champions?user=    profile badges + lines added
 *   GET /quote/:projectId/board   top 5 + the caller's best and rank
 *   GET /quote/:projectId/picks   the champion's featured-line options
 *
 * The real router and the real server/quote-guess-data.js caches run on a
 * throwaway express app behind a stand-in JWT middleware (as in
 * test/quote-routes.test.js). The models get small in-memory stores with
 * just the query shapes these paths use; the two aggregates (the pool
 * stats and the per-island champion) are computed from the stored rows.
 * Covers: the global switch, live vs switched-on-but-unplayable islands,
 * records without user ids, the caller's own bests, the tie rank (same best,
 * earlier achievedAt ranks first), deleted users dropped from the top 5, the
 * champion-only 403 on /picks and the hidden / inactive lines it blanks.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

let currentUser = 'u2';
const authPath = require.resolve('../middleware/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: (req, res, next) => { req.user = { id: currentUser }; next(); } };

const QuoteLine = require('../models/QuoteLine');
const QuoteScore = require('../models/QuoteScore');
const QuoteIsland = require('../models/QuoteIsland');
const AdminConfig = require('../models/AdminConfig');
const Project = require('../models/Project');
const User = require('../models/user');
const Username = require('../server/username');
const Logic = require('../js/quote-guess-logic');

// ── a tiny query engine (equality, $in, $gt, $lt, $or) ──

function get(doc, path) { return path.split('.').reduce((o, p) => (o == null ? o : o[p]), doc); }
function matches(doc, filter) {
  return Object.entries(filter || {}).every(([k, want]) => {
    if (k === '$or') return want.some(f => matches(doc, f));
    const have = get(doc, k);
    if (want && typeof want === 'object' && !(want instanceof Date)) {
      if ('$in' in want) return want.$in.map(String).includes(String(have));
      if ('$gt' in want) return have > want.$gt;
      if ('$lt' in want) return have < want.$lt;
    }
    if (want instanceof Date) return have instanceof Date && have.getTime() === want.getTime();
    return String(have) === String(want);
  });
}
// A Mongoose-like query: select / sort / limit / populate, awaited or .lean().
function query(run) {
  let sort = null, limit = Infinity, populate = null;
  const q = {
    select: () => q,
    sort: (s) => { sort = s; return q; },
    limit: (n) => { limit = n; return q; },
    populate: (field) => { populate = field; return q; },
    lean: async () => {
      let out = run();
      if (!Array.isArray(out)) return out ? { ...out } : null;
      out = out.map(d => ({ ...d }));
      if (sort) {
        const keys = Object.entries(sort);
        out.sort((a, b) => {
          for (const [k, dir] of keys) {
            const x = a[k], y = b[k];
            if (x < y) return -dir;
            if (x > y) return dir;
          }
          return 0;
        });
      }
      out = out.slice(0, limit);
      if (populate) {
        for (const d of out) {
          const u = USERS.find(x => x._id === String(d[populate]));
          d[populate] = u ? { _id: u._id, username: u.username } : null;
        }
      }
      return out;
    },
    then: (a, b) => q.lean().then(a, b)
  };
  return q;
}

const USERS = [];
const LINES = [];
const SCORES = [];
const ISLANDS = [];
const flags = { quoteGuessEnabled: true, quoteSuggestEnabled: false };

AdminConfig.findOne = () => query(() => ({ flags: { ...flags }, world: { quoteRoundSec: 25 } }));
QuoteIsland.find = (f) => query(() => ISLANDS.filter(r => matches(r, f)));
Project.find = () => query(() => [
  { id: 'avengers1', title: 'The Avengers', runtime: 143 },
  { id: 'thor1', title: 'Thor', runtime: 115 },
  { id: 'wandavision', title: 'WandaVision', episodes: [29, 35] }
]);
User.find = (f) => query(() => USERS.filter(r => matches(r, f)));
User.findOne = (f) => query(() => USERS.find(r => matches(r, f)) || null);
QuoteLine.find = (f) => query(() => LINES.filter(r => matches(r, f)));
QuoteLine.countDocuments = async (f) => LINES.filter(r => matches(r, f)).length;
// The pool: approved active lines per project, distinct speakers.
QuoteLine.aggregate = async () => {
  const by = new Map();
  for (const l of LINES) {
    if (l.status !== 'approved' || !l.active) continue;
    const g = by.get(l.projectId) || { _id: l.projectId, n: 0, a: [], b: [], replies: 0 };
    g.n++;
    if (!g.a.includes(l.speaker.key)) g.a.push(l.speaker.key);
    by.set(l.projectId, g);
  }
  return [...by.values()];
};
QuoteScore.find = (f) => query(() => SCORES.filter(r => matches(r, f)));
QuoteScore.findOne = (f) => query(() => SCORES.find(r => matches(r, f)) || null);
QuoteScore.countDocuments = async (f) => SCORES.filter(r => matches(r, f)).length;
// The champions: per project, the best score (earliest on a tie).
QuoteScore.aggregate = async () => {
  const sorted = SCORES.filter(r => r.best > 0).sort((x, y) => y.best - x.best || x.achievedAt - y.achievedAt);
  const by = new Map();
  for (const r of sorted) if (!by.has(r.projectId)) by.set(r.projectId, { _id: r.projectId, userId: r.userId, best: r.best, achievedAt: r.achievedAt, pick: r.pick });
  return [...by.values()];
};

Username.setReady(true);
const QuoteData = require('../server/quote-guess-data');

const app = express();
app.use(express.json());
app.use('/api/world', require('../routes/world-quotes'));

let server;
test.before(() => new Promise((resolve) => { server = app.listen(0, resolve); }));
test.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));

const T0 = Date.UTC(2026, 9, 1);
const at = (min) => new Date(T0 + min * 60e3);
function bank(projectId, n, speakers, extra = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const name = 'Speaker ' + (i % speakers);
    out.push({ _id: `${projectId}-l${i}`, projectId, status: 'approved', active: true, text: `${projectId} line ${i}`, speaker: { name, key: name.toLowerCase() }, ...extra });
  }
  LINES.push(...out);
  return out.map(l => l._id);
}

let AV;   // avengers1's line ids
test.beforeEach(() => {
  USERS.length = 0; LINES.length = 0; SCORES.length = 0; ISLANDS.length = 0;
  flags.quoteGuessEnabled = true; flags.quoteSuggestEnabled = false;
  currentUser = 'u2';
  USERS.push(
    { _id: 'u1', username: 'Alex', usernameLower: 'alex' },
    { _id: 'u2', username: 'sam', usernameLower: 'sam' },
    { _id: 'u3', username: 'cleo', usernameLower: 'cleo' },
    { _id: 'u4', username: 'newbie', usernameLower: 'newbie' }
  );
  // avengers1: switched on and playable → live. thor1: on, 3 lines → "coming
  // soon". wandavision: a full bank but switched off.
  ISLANDS.push(
    { projectId: 'avengers1', enabled: true, acceptSuggestions: true },
    { projectId: 'thor1', enabled: true, acceptSuggestions: false },
    { projectId: 'wandavision', enabled: false, acceptSuggestions: false }
  );
  AV = bank('avengers1', 12, 4);
  bank('thor1', 3, 2);
  bank('wandavision', 12, 5);
  SCORES.push(
    { userId: 'u1', projectId: 'avengers1', best: 9000, plays: 4, achievedAt: at(1), bestLines: AV.slice(0, 10), pick: AV[3] },
    { userId: 'u2', projectId: 'avengers1', best: 7000, plays: 2, achievedAt: at(2), bestLines: AV.slice(2, 12), pick: null },
    { userId: 'u3', projectId: 'avengers1', best: 7000, plays: 1, achievedAt: at(3), bestLines: AV.slice(0, 10), pick: null },
    { userId: 'u2', projectId: 'wandavision', best: 0, plays: 1, achievedAt: at(4) },
    { userId: 'u3', projectId: 'thor1', best: 500, plays: 1, achievedAt: at(5) }
  );
  for (const k of ['settings', 'islands', 'pool', 'board', 'projects']) QuoteData.invalidate(k);
});

function call(path) {
  return new Promise((resolve, reject) => {
    http.get({ port: server.address().port, path: '/api/world' + path }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
    }).on('error', reject);
  });
}

// ── GET /quote ──

test('GET /quote with the global switch off is just { enabled:false }', async () => {
  flags.quoteGuessEnabled = false;
  const r = await call('/quote');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { enabled: false });
});

test('GET /quote: live islands only, their records without user ids, my own bests, the "coming soon" progress', async () => {
  const r = await call('/quote');
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, true);
  assert.deepEqual(r.body.islands, ['avengers1'], 'thor1 is not playable yet, wandavision is switched off');
  // thor1 has a champion (cleo, 500) but is not live → no record for it.
  assert.deepEqual(Object.keys(r.body.records), ['avengers1']);
  assert.deepEqual(r.body.records.avengers1, {
    username: 'Alex', score: 9000, achievedAt: at(1).toISOString(),
    pick: { text: 'avengers1 line 3', speaker: 'Speaker 3' }
  });
  assert.ok(!JSON.stringify(r.body.records).includes('u1'), 'no user id in the public record');
  // sam's bests: the 0-point row is left out.
  assert.deepEqual(r.body.mine, { avengers1: 7000 });
  // Only switched-on islands that aren't live yet.
  assert.deepEqual(r.body.progress, { thor1: { lines: 3, speakers: 2 } });
  assert.deepEqual(r.body.need, { lines: Logic.C.MIN_POOL, speakers: Logic.C.MIN_SPEAKERS });
  assert.equal(r.body.roundSec, 25);
  assert.equal(r.body.suggest, false);
  assert.deepEqual(r.body.noSuggest.sort(), ['thor1', 'wandavision']);
  assert.deepEqual(r.body.live, {}, 'no game running');
});

test('GET /quote: a player with no scores gets an empty mine map', async () => {
  currentUser = 'u4';
  const r = await call('/quote');
  assert.deepEqual(r.body.mine, {});
});

// ── GET /quote/champions ──

test('GET /quote/champions: case-insensitive name → the live islands they hold, and their approved lines', async () => {
  LINES.push(
    { _id: 's1', projectId: 'avengers1', status: 'approved', active: true, text: 's1', speaker: { name: 'X', key: 'x' }, suggestedBy: 'u1' },
    { _id: 's2', projectId: 'thor1', status: 'approved', active: false, text: 's2', speaker: { name: 'X', key: 'x' }, suggestedBy: 'u1' },
    { _id: 's3', projectId: 'thor1', status: 'pending', active: true, text: 's3', speaker: { name: 'X', key: 'x' }, suggestedBy: 'u1' },
    { _id: 's4', projectId: 'thor1', status: 'approved', active: true, text: 's4', speaker: { name: 'X', key: 'x' }, suggestedBy: 'u2' }
  );
  for (const k of ['pool']) QuoteData.invalidate(k);
  const r = await call('/quote/champions?user=ALEX');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items, [{ projectId: 'avengers1', title: 'The Avengers', score: 9000 }]);
  assert.equal(r.body.linesAdded, 2, 'approved suggestions only (pending ones do not count)');
});

test('GET /quote/champions: a champion of a non-live island has no badge; unknown / empty name; switch off', async () => {
  let r = await call('/quote/champions?user=cleo');
  assert.deepEqual(r.body, { items: [], linesAdded: 0 }, 'cleo holds thor1, which is not live');
  r = await call('/quote/champions?user=nobody');
  assert.deepEqual(r.body, { items: [], linesAdded: 0 });
  r = await call('/quote/champions');
  assert.deepEqual(r.body, { items: [], linesAdded: 0 });
  r = await call('/quote/champions?user=%20%20');
  assert.deepEqual(r.body, { items: [], linesAdded: 0 });
  flags.quoteGuessEnabled = false;
  QuoteData.invalidate('settings');
  r = await call('/quote/champions?user=alex');
  assert.deepEqual(r.body, { items: [], linesAdded: 0 });
});

// ── GET /quote/:projectId/board ──

test('GET /board: top 5 by best (earlier first on a tie), my best and plays, the tie rank', async () => {
  let r = await call('/quote/avengers1/board');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.top.map(t => [t.username, t.best]), [['Alex', 9000], ['sam', 7000], ['cleo', 7000]]);
  assert.deepEqual(r.body.me, { best: 7000, plays: 2, rank: 2 });
  currentUser = 'u3';
  r = await call('/quote/avengers1/board');
  assert.deepEqual(r.body.me, { best: 7000, plays: 1, rank: 3 }, 'same best, later → ranked after');
  currentUser = 'u1';
  r = await call('/quote/avengers1/board');
  assert.equal(r.body.me.rank, 1);
});

test('GET /board: no row → me null; a 0-point row → rank null; capped at 5; deleted users left out', async () => {
  currentUser = 'u4';
  let r = await call('/quote/avengers1/board');
  assert.equal(r.body.me, null);
  currentUser = 'u2';
  r = await call('/quote/wandavision/board');
  assert.deepEqual(r.body, { top: [], me: { best: 0, plays: 1, rank: null } });

  for (let i = 0; i < 6; i++) {
    USERS.push({ _id: 'x' + i, username: 'x' + i, usernameLower: 'x' + i });
    SCORES.push({ userId: 'x' + i, projectId: 'thor1', best: 100 + i, plays: 1, achievedAt: at(10 + i) });
  }
  SCORES.push({ userId: 'gone', projectId: 'thor1', best: 99999, plays: 1, achievedAt: at(0) });
  r = await call('/quote/thor1/board');
  assert.equal(r.body.top.length, 5);
  assert.ok(!r.body.top.some(t => t.username == null), 'a row whose user is gone is not shown');
  // RT2-11: the orphan no longer takes one of the 5 slots (the route over-fetches, then trims).
  assert.deepEqual(r.body.top.map(t => t.username), ['cleo', 'x5', 'x4', 'x3', 'x2']);
});

test('GET /board: the switch off → empty', async () => {
  flags.quoteGuessEnabled = false;
  const r = await call('/quote/avengers1/board');
  assert.deepEqual(r.body, { top: [], me: null });
});

// ── GET /quote/:projectId/picks ──

test('GET /picks: only the island champion; everyone else (and islands without one) get 403', async () => {
  let r = await call('/quote/avengers1/picks');
  assert.equal(r.status, 403, 'sam has a score here but is not the champion');
  assert.equal(r.body.lines, undefined, 'no lines leak with the 403');
  currentUser = 'u3';
  r = await call('/quote/avengers1/picks');
  assert.equal(r.status, 403);
  currentUser = 'u1';
  r = await call('/quote/wandavision/picks');
  assert.equal(r.status, 403, 'no champion on that island');
});

test('GET /picks: the champion gets their record game\'s lines in order with speakers, hidden / inactive ones blanked, and the current pick', async () => {
  currentUser = 'u1';
  LINES.find(l => l._id === AV[5]).status = 'hidden';
  LINES.find(l => l._id === AV[7]).active = false;
  const r = await call('/quote/avengers1/picks');
  assert.equal(r.status, 200);
  assert.equal(r.body.lines.length, 10);
  assert.deepEqual(r.body.lines[0], { text: 'avengers1 line 0', speaker: 'Speaker 0' });
  assert.equal(r.body.lines[5], null);
  assert.equal(r.body.lines[7], null);
  assert.equal(r.body.pick, 3);
  for (const l of r.body.lines.filter(Boolean)) assert.deepEqual(Object.keys(l).sort(), ['speaker', 'text'], 'no ids, no status');
});

test('GET /picks: no pick yet → -1; a pick no longer in the game → -1', async () => {
  currentUser = 'u1';
  SCORES[0].pick = null;
  let r = await call('/quote/avengers1/picks');
  assert.equal(r.body.pick, -1);
  SCORES[0].pick = 'elsewhere';
  r = await call('/quote/avengers1/picks');
  assert.equal(r.body.pick, -1);
});
