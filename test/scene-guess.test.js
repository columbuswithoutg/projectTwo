/************************************************
 * Unit tests for js/scene-guess-logic.js — time parsing, the movie /
 * series guessing line, scoring, still draws and the game reducers
 * (lobby → ready → rounds → reveal → results), plus what onlookers may see.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/scene-guess-logic.js');

const MOVIE = { id: 'ironman1', runtime: 126 };
const SERIES = { id: 'wandavision', episodes: [29, 35, 33] };
const T0 = 1_000_000;

// Deterministic rng for draws (mulberry32).
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stills(tl, n) {
  // Answers spread along the line, one every (total / n) seconds.
  return Array.from({ length: n }, (_, i) => ({ id: 's' + i, url: 'https://res.cloudinary.com/x/s' + i + '.jpg', answer: Math.floor((i + 0.5) * tl.total / n) }));
}

// ── time ──

test('parseTime accepts h:mm:ss, m:ss and plain seconds; refuses junk', () => {
  assert.equal(S.parseTime('1:02:13'), 3733);
  assert.equal(S.parseTime('62:13'), 3733);
  assert.equal(S.parseTime('0:05'), 5);
  assert.equal(S.parseTime(' 3733 '), 3733);
  assert.equal(S.parseTime(42), 42);
  for (const bad of ['', '1:2', '1:60', '1:02:60', 'abc', '-5', '1:02:13:00', null, undefined, -1, NaN]) {
    assert.equal(S.parseTime(bad), null, String(bad));
  }
});

test('formatTime round-trips with parseTime', () => {
  assert.equal(S.formatTime(3733), '1:02:13');
  assert.equal(S.formatTime(754), '12:34');
  assert.equal(S.formatTime(5), '0:05');
  for (const t of [0, 59, 60, 3599, 3600, 7560]) assert.equal(S.parseTime(S.formatTime(t)), t);
});

// ── the line ──

test('a movie line is its runtime in seconds, one unlabelled segment', () => {
  const tl = S.timeline(MOVIE);
  assert.equal(tl.kind, 'movie');
  assert.equal(tl.total, 126 * 60);
  assert.deepEqual(tl.segments, [{ start: 0, len: 7560, label: '' }]);
  assert.equal(S.timeline({ runtime: 0 }), null);
  assert.equal(S.timeline(null), null);
});

test('a series line lays episodes end to end, labelled E1…En', () => {
  const tl = S.timeline(SERIES);
  assert.equal(tl.kind, 'series');
  assert.equal(tl.total, (29 + 35 + 33) * 60);
  assert.deepEqual(tl.segments.map(s => [s.start, s.len, s.label]), [[0, 1740, 'E1'], [1740, 2100, 'E2'], [3840, 1980, 'E3']]);
  assert.equal(S.timeline({ episodes: [30, 0] }), null);
});

test('toGlobal / fromGlobal round-trip and clamp to the episode', () => {
  const tl = S.timeline(SERIES);
  assert.equal(S.toGlobal(tl, 1, 600), 1740 + 600);
  assert.deepEqual(S.fromGlobal(tl, 2340), { episode: 1, t: 600 });
  assert.deepEqual(S.fromGlobal(tl, 1740), { episode: 1, t: 0 });       // a boundary belongs to the next episode
  assert.deepEqual(S.fromGlobal(tl, tl.total), { episode: 2, t: 1980 }); // the very end stays in the last one
  assert.equal(S.toGlobal(tl, 0, 9999), 1740);                          // past the end clamps
  assert.equal(S.toGlobal(tl, 5, 10), null);
  const m = S.timeline(MOVIE);
  assert.equal(S.toGlobal(m, null, 3733), 3733);
  assert.deepEqual(S.fromGlobal(m, 3733), { episode: null, t: 3733 });
});

test('formatGuess reads "E3 · 12:34" on a series, "1:02:13" on a movie', () => {
  assert.equal(S.formatGuess(S.timeline(SERIES), 3840 + 754), 'E3 · 12:34');
  assert.equal(S.formatGuess(S.timeline(MOVIE), 3733), '1:02:13');
});

test('nudge clamps to the line; stepEpisode keeps the moment across episodes', () => {
  const tl = S.timeline(SERIES);
  assert.equal(S.nudge(tl, 5, -10), 0);
  assert.equal(S.nudge(tl, tl.total - 5, 60), tl.total);
  assert.equal(S.stepEpisode(tl, 600, 1), 1740 + 600);      // E1 10:00 → E2 10:00
  assert.equal(S.stepEpisode(tl, 1740 + 2000, 1), 3840 + 1980);   // E2 33:20 → E3 clamps to its 33:00
  assert.equal(S.stepEpisode(tl, 600, -1), 600);             // already the first
  const m = S.timeline(MOVIE);
  assert.equal(S.stepEpisode(m, 1234, 1), 1234);
});

test('ticks: every 15 min on a movie, episode starts on a series', () => {
  assert.deepEqual(S.ticks(S.timeline(MOVIE)).map(t => t.at), [0, 900, 1800, 2700, 3600, 4500, 5400, 6300, 7200]);
  assert.deepEqual(S.ticks(S.timeline(SERIES)).map(t => t.label), ['E1', 'E2', 'E3']);
});

test('validStill: episode rules, the 59 s rounding slack, and the end', () => {
  const m = S.timeline(MOVIE), s = S.timeline(SERIES);
  assert.ok(S.validStill(m, { timeSec: 3733, episode: null }).ok);
  assert.ok(S.validStill(m, { timeSec: 7560 + 59, episode: null }).ok);
  assert.equal(S.validStill(m, { timeSec: 7560 + 60, episode: null }).ok, false);
  assert.equal(S.validStill(m, { timeSec: 10, episode: 0 }).ok, false);
  assert.equal(S.validStill(m, { timeSec: -1, episode: null }).ok, false);
  assert.equal(S.validStill(m, { timeSec: 1.5, episode: null }).ok, false);
  assert.ok(S.validStill(s, { timeSec: 600, episode: 2 }).ok);
  assert.equal(S.validStill(s, { timeSec: 600, episode: 3 }).ok, false);
  assert.equal(S.validStill(s, { timeSec: 600, episode: null }).ok, false);
  assert.equal(S.validStill(s, { timeSec: 1740 + 60, episode: 0 }).ok, false);
  assert.equal(S.validStill(null, { timeSec: 1, episode: null }).ok, false);
});

// ── scoring ──

test('score: full marks within 10 s, then a smooth monotonic fall-off', () => {
  assert.equal(S.score(0), 1000);
  assert.equal(S.score(-10), 1000);
  assert.equal(S.score(10), 1000);
  assert.equal(S.score(60), 920);
  assert.equal(S.score(300), 617);
  assert.equal(S.score(600), 374);
  assert.equal(S.score(1800), 51);
  assert.equal(S.score(NaN), 0);
  let prev = Infinity;
  for (let e = 0; e <= 7200; e += 7) {
    const p = S.score(e);
    assert.ok(p <= prev && p >= 0, `e=${e}`);
    prev = p;
  }
});

test('pickStills: n distinct, deterministic with a seed, refuses a small pool', () => {
  const pool = Array.from({ length: 30 }, (_, i) => i);
  const a = S.pickStills(pool, 10, seeded(7));
  const b = S.pickStills(pool, 10, seeded(7));
  assert.equal(a.length, 10);
  assert.equal(new Set(a).size, 10);
  assert.deepEqual(a, b);
  assert.equal(pool.length, 30);
  assert.equal(S.pickStills(pool.slice(0, 9), 10), null);
});

test('roundMsFrom clamps the admin setting to 15–60 s', () => {
  assert.equal(S.roundMsFrom(30), 30000);
  assert.equal(S.roundMsFrom(5), 15000);
  assert.equal(S.roundMsFrom(500), 60000);
  assert.equal(S.roundMsFrom('x'), S.C.ROUND_MS);
});

// ── the game ──

function lobby(tl = S.timeline(MOVIE)) {
  return S.createLobby({ projectId: 'ironman1', userId: 'u1', username: 'alex', now: T0, roundMs: 30000, timeline: tl });
}

test('lobby: host is in, others join, idempotent, capped at 6', () => {
  let st = lobby();
  assert.equal(st.phase, 'lobby');
  assert.equal(st.deadline, T0 + S.C.LOBBY_MS);
  let r = S.join(st, 'u2', 'sam');
  assert.ok(r.ok);
  st = r.state;
  assert.equal(S.join(st, 'u2', 'sam').state, st);           // already in → same state
  for (let i = 3; i <= 6; i++) st = S.join(st, 'u' + i, 'p' + i).state;
  assert.equal(S.playerCount(st), 6);
  assert.deepEqual(S.join(st, 'u7', 'late'), { ok: false, error: 'full' });
});

test('leave: the host role passes on in join order; empty → over', () => {
  let st = S.join(lobby(), 'u2', 'sam').state;
  st = S.leave(st, 'u1');
  assert.equal(st.host, 'u2');
  assert.equal(st.phase, 'lobby');
  st = S.leave(st, 'u2');
  assert.equal(st.phase, 'over');
  assert.equal(S.leave(st, 'nobody'), st);
});

test('nobody joins once the lobby has closed', () => {
  const tl = S.timeline(MOVIE);
  const st = S.begin(lobby(tl), stills(tl, 10), T0 + 1000);
  assert.equal(st.phase, 'ready');
  assert.deepEqual(S.join(st, 'u9', 'x'), { ok: false, error: 'started' });
});

function playing(n = 2) {
  const tl = S.timeline(MOVIE);
  let st = lobby(tl);
  for (let i = 2; i <= n; i++) st = S.join(st, 'u' + i, 'p' + i).state;
  st = S.begin(st, stills(tl, 10), T0);
  return S.startRound(st, T0 + S.C.READY_MS);
}

test('a round: guesses lock once, points held back until the reveal', () => {
  let st = playing(2);
  const t = st.roundStartedAt;
  assert.equal(st.phase, 'round');
  assert.equal(st.round, 0);
  const answer = st.stills[0].answer;
  let r = S.guess(st, 'u1', 0, answer + 60, t + 4000);
  assert.ok(r.ok);
  st = r.state;
  assert.equal(st.players.u1.guesses[0].points, 920);
  assert.equal(st.players.u1.guesses[0].lockMs, 4000);
  assert.equal(st.players.u1.total, 0);                      // not yet
  assert.deepEqual(S.guess(st, 'u1', 0, answer, t + 5000), { ok: false, error: 'already' });
  assert.equal(S.allLocked(st), false);
  st = S.guess(st, 'u2', 0, answer, t + 9000).state;
  assert.equal(S.allLocked(st), true);
  st = S.reveal(st, t + 9000);
  assert.equal(st.phase, 'reveal');
  assert.equal(st.players.u1.total, 920);
  assert.equal(st.players.u2.total, 1000);
});

test('guess guards: wrong round, outsider, bad value, the late grace', () => {
  const st = playing(1);
  const t = st.roundStartedAt;
  assert.equal(S.guess(st, 'u1', 1, 10, t).error, 'wrong-round');
  assert.equal(S.guess(st, 'zz', 0, 10, t).error, 'not-playing');
  assert.equal(S.guess(st, 'u1', 0, -1, t).error, 'bad-guess');
  assert.equal(S.guess(st, 'u1', 0, st.timeline.total + 1, t).error, 'bad-guess');
  assert.equal(S.guess(st, 'u1', 0, '10', t).error, 'bad-guess');
  assert.ok(S.guess(st, 'u1', 0, 10, st.deadline + S.C.LATE_GRACE_MS).ok);
  assert.equal(S.guess(st, 'u1', 0, 10, st.deadline + S.C.LATE_GRACE_MS + 1).error, 'too-late');
  assert.equal(S.guess(S.reveal(st, t + 1), 'u1', 0, 10, t + 2).error, 'not-round');
});

test('no guess by the buzzer scores 0 and counts the whole round for the tie-break', () => {
  let st = playing(2);
  st = S.guess(st, 'u1', 0, st.stills[0].answer, st.roundStartedAt + 1000).state;
  st = S.reveal(st, st.deadline);
  assert.equal(st.players.u2.total, 0);
  assert.equal(st.players.u2.lockMs, 30000);
  assert.equal(st.players.u2.guesses[0].at, null);
});

test('ten rounds then results; ranking by total, then faster lock-ins', () => {
  let st = playing(3);
  for (let r = 0; r < S.C.ROUNDS; r++) {
    const t = st.roundStartedAt, ans = st.stills[r].answer;
    st = S.guess(st, 'u1', r, ans, t + 5000).state;      // perfect, slower
    st = S.guess(st, 'u2', r, ans, t + 2000).state;      // perfect, faster
    const off = ans + 600 <= st.timeline.total ? ans + 600 : ans - 600;
    st = S.guess(st, 'u3', r, off, t + 1000).state;       // 10 min off
    st = S.next(S.reveal(st, t + 5000), t + 5000 + S.C.REVEAL_MS);
  }
  assert.equal(st.phase, 'results');
  const rank = S.ranking(st);
  assert.deepEqual(rank.map(r => r.username), ['p2', 'alex', 'p3']);
  assert.equal(rank[0].total, 10000);
  assert.equal(rank[2].total, 3740);
});

test('newRecord: strictly greater wins, a tie keeps the old record, zero never counts', () => {
  const rank = [{ userId: 'u1', username: 'alex', total: 8420, lockMs: 1 }];
  assert.equal(S.newRecord(null, rank), rank[0]);
  assert.equal(S.newRecord({ score: 8000 }, rank), rank[0]);
  assert.equal(S.newRecord({ score: 8420 }, rank), null);
  assert.equal(S.newRecord({ score: 9000 }, rank), null);
  assert.equal(S.newRecord(null, [{ userId: 'u1', username: 'a', total: 0, lockMs: 0 }]), null);
  assert.equal(S.newRecord(null, []), null);
});

test('reducers never mutate their input', () => {
  const tl = S.timeline(MOVIE);
  // Snapshot every input, run the reducer, and check the input is unchanged
  // (frozen objects alone wouldn't catch it: neither file is strict mode).
  const same = (st, fn) => { const before = JSON.stringify(st); const out = fn(st); assert.equal(JSON.stringify(st), before); return out; };
  const base = lobby(tl);
  const joined = same(base, s => S.join(s, 'u2', 'sam').state);
  same(joined, s => S.leave(s, 'u1'));
  const ready = same(joined, s => S.begin(s, stills(tl, 10), T0));
  const round = same(ready, s => S.startRound(s, T0 + 3000));
  const g = same(round, s => S.guess(s, 'u1', 0, 100, T0 + 4000).state);
  const rev = same(g, s => S.reveal(s, T0 + 5000));
  same(rev, s => S.next(s, T0 + 9000));
  same(rev, s => S.publicState(s));
  same(rev, s => S.ranking(s));
  assert.notEqual(g, round);
});

test('publicState never carries answers or userIds before the reveal', () => {
  let st = playing(2);
  const answers = st.stills.map(s => s.answer);
  let pub = S.publicState(st);
  const json = JSON.stringify(pub);
  assert.ok(!json.includes('"answer"'));
  assert.ok(!json.includes('"u1"') && !json.includes('"u2"'));
  assert.equal(pub.history.length, 0);
  assert.deepEqual(pub.players.map(p => p.username), ['alex', 'p2']);
  assert.equal(pub.stills.length, 10);
  assert.equal(pub.host, 'alex');

  st = S.guess(st, 'u1', 0, answers[0] + 60, st.roundStartedAt + 1000).state;
  pub = S.publicState(st);
  assert.deepEqual(pub.players.map(p => p.locked), [true, false]);
  assert.deepEqual(pub.players.map(p => p.total), [0, 0]);        // no mid-round leak

  st = S.reveal(st, st.deadline);
  pub = S.publicState(st);
  assert.equal(pub.history.length, 1);
  assert.equal(pub.history[0].answer, answers[0]);
  assert.equal(pub.history[0].label, S.formatGuess(st.timeline, answers[0]));
  assert.deepEqual(pub.history[0].guesses.map(g => g.points), [920, 0]);

  st = S.startRound(st, st.deadline);
  pub = S.publicState(st);
  assert.equal(pub.history.length, 1);                              // round 2's answer stays hidden
  assert.ok(!JSON.stringify(pub).includes(String(answers[1]) + ','));
});

test('a lobby shows no stills yet; results carry the ranking and record', () => {
  assert.deepEqual(S.publicState(lobby()).stills, []);
  let st = playing(1);
  for (let r = 0; r < S.C.ROUNDS; r++) st = S.next(S.reveal(st, st.deadline), st.deadline + 5000);
  st = Object.assign({}, st, { record: { username: 'alex', score: 0, previous: null } });
  const pub = S.publicState(st);
  assert.equal(pub.phase, 'results');
  assert.deepEqual(pub.ranking, [{ username: 'alex', total: 0 }]);
  assert.deepEqual(pub.record, { username: 'alex', score: 0, previous: null });
  assert.equal(pub.history.length, 10);
});

test('bestRound: the round with the most points, first on ties, 0 when empty', () => {
  assert.equal(S.bestRound([{ points: 100 }, { points: 900 }, null, { points: 900 }]), 1);
  assert.equal(S.bestRound([null, null]), 0);
  assert.equal(S.bestRound([]), 0);
  assert.equal(S.bestRound(undefined), 0);
});
