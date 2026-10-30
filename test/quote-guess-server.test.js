/************************************************
 * Integration tests for server/quote-guess.js (on the shared engine,
 * server/island-game.js) and the registry (server/island-games.js) — whole
 * Quote Guess games through the socket handlers with a fake clock, fake
 * Socket.IO and stubbed data / models, next to a Scene Guess manager on the
 * same islands:
 *   lobby → 10 rounds of four choices → results, speed scoring, saving and
 *   the record; one game per island and per player ACROSS both games;
 *   isPlaying / punch immunity across both; the answer never sent before
 *   its reveal; bad answers refused.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const Q = require('../js/quote-guess-logic.js');
const S = require('../js/scene-guess-logic.js');
const QuoteGuess = require('../server/quote-guess.js');
const SceneGuess = require('../server/scene-guess.js');
const { createRegistry } = require('../server/island-games.js');

const PID = 'avengers1';

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
const BANK = Array.from({ length: 24 }, (_, i) => {
  const sp = 'Person ' + 'ABCDEF'[i % 6], rp = 'Person ' + 'ABCDEF'[(i + 1) % 6];
  return {
    id: 'line' + i,
    speaker: { name: sp, key: Q.norm(sp), characterId: null },
    text: 'Quote number ' + i, textKey: Q.norm('Quote number ' + i),
    reply: i % 2 ? null : { speaker: { name: rp, key: Q.norm(rp), characterId: null }, text: 'Reply number ' + i },
    note: 'scene ' + i, episode: null, decoys: { speakers: [], replies: [] },
    credit: i === 0 ? 'rhea' : null
  };
});

function fakeScores() {
  const scores = new Map();
  const key = (f) => `${f.userId}|${f.projectId}`;
  return {
    scores,
    async updateOne(filter, update, opts = {}) {
      let doc = scores.get(key(filter));
      if (filter.best) {
        if (!doc || !(doc.best < filter.best.$lt)) return { matchedCount: 0 };
      }
      if (!doc) {
        if (!opts.upsert) return { matchedCount: 0 };
        doc = { userId: filter.userId, projectId: filter.projectId, best: 0, plays: 0, ...(update.$setOnInsert || {}) };
        scores.set(key(filter), doc);
        for (const [f, v] of Object.entries(update.$inc || {})) doc[f] = (doc[f] || 0) + v;
        return { matchedCount: 0, upsertedCount: 1 };
      }
      Object.assign(doc, update.$set || {});
      for (const [f, v] of Object.entries(update.$inc || {})) doc[f] = (doc[f] || 0) + v;
      return { matchedCount: 1 };
    },
    findOne(filter) { return { select() { return { lean: async () => scores.get(key(filter)) || null }; } }; }
  };
}

function fakeData(env, extra) {
  const champs = new Map();
  const invalidations = [];
  return Object.assign({
    champs, invalidations,
    enabledSync: () => env.enabled,
    isLiveSync: (pid) => env.live.has(pid),
    champions: { get: async () => champs, peek: () => champs },
    invalidate: (kind, pid) => invalidations.push([kind, pid]),
    publicRecord: (c) => (c ? { username: c.username, score: c.score } : null),
    settings: { get: async () => ({ enabled: env.enabled, suggest: true }) },
    liveIslands: async () => [...env.live],
    events: new EventEmitter(),
    prime() {}
  }, extra);
}

function harness() {
  let clock = 1_000_000;
  const timers = [];
  let seq = 0;
  const flush = () => new Promise(r => setImmediate(r));
  const sent = [];
  const io = { to(target) { return { emit(event, payload) { sent.push({ to: target, event, payload: JSON.parse(JSON.stringify(payload)) }); } }; } };
  const clockDeps = {
    now: () => clock,
    setTimeout: (fn, ms) => { const t = { at: clock + ms, fn, id: ++seq, off: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.off = true; },
    rng: seeded(42),
    log: () => {}
  };
  const env = { enabled: true, live: new Set([PID, 'thor1']) };
  const User = { exists: async () => true };

  const qData = fakeData(env, { roundSecSync: () => 20, drawLines: async (pid, rng) => Q.buildRounds(BANK, rng) });
  const qScores = fakeScores();
  const quote = QuoteGuess.create(Object.assign({ Logic: Q, data: qData, models: { QuoteScore: qScores, User } }, clockDeps));

  const sData = fakeData(env, {
    roundSecSync: () => 30,
    projectSync: (pid) => ({ id: pid, runtime: 143 }),
    drawStills: async () => Array.from({ length: 10 }, (_, i) => ({ id: 's' + i, url: '/s' + i, answer: 600 * (i + 1) }))
  });
  const scene = SceneGuess.create(Object.assign({ Logic: S, data: sData, models: { SceneScore: fakeScores(), User } }, clockDeps));

  const reg = createRegistry([scene, quote]);
  const players = new Map();
  reg.attach(io, { players, rateOk: () => true, touchStay: () => {}, zoneOf: (s, p) => p.projectId });

  function join(sid, userId, username, projectId = PID) {
    const handlers = {};
    const socket = {
      id: sid, data: { userId }, emitted: [],
      on(ev, fn) { handlers[ev] = fn; },
      emit(event, payload) { this.emitted.push({ event, payload: JSON.parse(JSON.stringify(payload)) }); },
      call(ev, raw) { return new Promise(resolve => handlers[ev](raw, resolve)); }
    };
    players.set(sid, { socketId: sid, userId, username, projectId });
    reg.register(socket);
    return socket;
  }

  async function advance(ms) {
    const target = clock + ms;
    for (;;) {
      const due = timers.filter(t => !t.off && t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      due.off = true;
      clock = Math.max(clock, due.at);
      due.fn();
      await flush();
    }
    clock = target;
    await flush();
  }
  function lastState(event = 'world:qg-state') {
    for (let i = sent.length - 1; i >= 0; i--) if (sent[i].event === event) return sent[i].payload;
    return null;
  }
  // The server's own copy of the running game's rounds (answers included).
  let rounds = null;
  const origDraw = qData.drawLines;
  qData.drawLines = async (pid, rng) => { rounds = await origDraw(pid, rng); return rounds; };

  return { reg, quote, scene, sent, env, qData, qScores, join, advance, lastState, rounds: () => rounds, tick: (ms) => { clock += ms; } };
}

// No 'answer' or 'choice' key outside history[], and history only covers
// rounds already revealed.
function assertNoEarlyAnswers(sent) {
  for (const { event, payload } of sent) {
    if (event !== 'world:qg-state' || !payload.history) continue;
    const walk = (o, path) => {
      if (!o || typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o)) {
        if (k === 'answer' || k === 'choice' || k === 'lineId') assert.equal(path[0], 'history', `${k} outside history at ${path.join('.')}`);
        walk(v, path.concat(k));
      }
    };
    walk(payload, []);
    if (payload.phase === 'round') assert.equal(payload.history.length, payload.round, 'the round in progress stays hidden');
  }
}

test('a full two-player Quote Guess game: lobby → 10 rounds → results, speed points, record + fanfare', async () => {
  const h = harness();
  const a = h.join('sa', 'u1', 'alex');
  const b = h.join('sb', 'u2', 'sam');
  h.join('sc', 'u3', 'watcher');

  assert.deepEqual(await a.call('world:qg-start', { projectId: PID }), { ok: true });
  assert.deepEqual(await b.call('world:qg-join', { projectId: PID }), { ok: true });
  assert.ok(h.sent.some(s => s.event === 'world:qg-live' && s.payload.live && s.payload.host === 'alex'));
  assert.ok(h.sent.some(s => s.event === 'world:qg-state' && s.to.includes('sc')), 'the onlooker watches');
  await h.advance(Q.C.LOBBY_MS);
  assert.equal(h.lastState().phase, 'ready');
  await h.advance(Q.C.READY_MS);

  const rounds = h.rounds();
  for (let r = 0; r < Q.C.ROUNDS; r++) {
    const st = h.lastState();
    assert.equal(st.phase, 'round');
    assert.equal(st.current.round, r);
    assert.equal(st.current.prompt.text, rounds[r].prompt.text);
    const right = rounds[r].answer;
    const wrong = rounds[r].options.find(o => o.id !== right).id;
    h.tick(2000);                                        // alex locks in after 2 s (of 20)
    assert.deepEqual(await a.call('world:qg-answer', { round: r, choice: right }), { ok: true });
    assert.equal(h.lastState().phase, 'round', 'sam has not answered yet');
    h.tick(2000);
    assert.deepEqual(await b.call('world:qg-answer', { round: r, choice: r < 5 ? right : wrong }), { ok: true });
    const rv = h.lastState();
    assert.equal(rv.phase, 'reveal', 'everyone locked → early reveal');
    assert.equal(rv.history[r].answer, right);
    await h.advance(Q.C.REVEAL_MS);
  }
  const res = h.lastState();
  assert.equal(res.phase, 'results');
  // alex: 10 × (500 + 500·(1 − 2/20)) = 9500; sam: 5 × (500 + 500·(1 − 4/20)) = 4500
  assert.deepEqual(res.ranking, [{ username: 'alex', total: 9500 }, { username: 'sam', total: 4500 }]);
  assert.deepEqual(res.record, { username: 'alex', score: 9500, previous: null, previousHolder: null });
  assert.ok(h.sent.some(s => s.event === 'world:qg-fanfare' && s.payload.username === 'alex'));

  const sa = h.qScores.scores.get(`u1|${PID}`);
  assert.equal(sa.best, 9500);
  assert.deepEqual(sa.bestLines, rounds.map(r => r.lineId));
  assert.equal(sa.pick, rounds[0].lineId, 'featured line defaults to the fastest right answer (first on ties)');
  assert.ok(h.qData.invalidations.some(([k]) => k === 'board'));

  await h.advance(Q.C.RESULTS_MS);
  assert.equal(h.lastState().phase, 'idle');
  assert.equal(h.reg.isPlaying('sa'), false);
  assertNoEarlyAnswers(h.sent);
});

test('answers: one per round, a real option, the current round; a wrong one scores 0', async () => {
  const h = harness();
  const a = h.join('sa', 'u1', 'alex');
  await a.call('world:qg-start', { projectId: PID });
  await h.advance(Q.C.LOBBY_MS + Q.C.READY_MS);
  const rd = h.rounds()[0];
  for (const bad of [{ round: 0, choice: 'e' }, { round: 0 }, { round: '0', choice: 'a' }, null]) {
    assert.deepEqual(await a.call('world:qg-answer', bad), { ok: false, error: 'bad' }, JSON.stringify(bad));
  }
  assert.deepEqual(await a.call('world:qg-answer', { round: 1, choice: 'a' }), { ok: false, error: 'wrong-round' });
  const wrong = rd.options.find(o => o.id !== rd.answer).id;
  assert.deepEqual(await a.call('world:qg-answer', { round: 0, choice: wrong }), { ok: true });
  assert.equal(h.lastState().history[0].picks[0].points, 0);
  assert.equal(h.lastState().history[0].picks[0].choice, wrong);
});

test('a missed round scores 0 at the buzzer; the late grace still takes an answer', async () => {
  const h = harness();
  const a = h.join('sa', 'u1', 'alex');
  await a.call('world:qg-start', { projectId: PID });
  await h.advance(Q.C.LOBBY_MS + Q.C.READY_MS);
  h.tick(20000 + 300);                                  // past the buzzer, inside the grace
  const r0 = h.rounds()[0];
  assert.deepEqual(await a.call('world:qg-answer', { round: 0, choice: r0.answer }), { ok: true });
  assert.equal(h.lastState().history[0].picks[0].points, Q.C.MIN_POINTS);
  await h.advance(Q.C.REVEAL_MS);
  await h.advance(20000 + Q.C.LATE_GRACE_MS);           // round 1: nobody answers
  assert.equal(h.lastState().phase, 'reveal');
  assert.deepEqual(h.lastState().history[1].picks[0], { username: 'alex', choice: null, points: 0, ms: 20000 });
});

test('one game per island across both games, and one game per player', async () => {
  const h = harness();
  const a = h.join('sa', 'u1', 'alex');
  const b = h.join('sb', 'u2', 'sam');
  const c = h.join('sc', 'u3', 'cleo', 'thor1');
  assert.deepEqual(await a.call('world:qg-start', { projectId: PID }), { ok: true });
  // Scene Guess can't open a lobby where Quote Guess runs…
  assert.deepEqual(await b.call('world:sg-start', { projectId: PID }), { ok: false, error: 'island-busy' });
  // …and pressing Quote Guess's Play again just joins.
  assert.deepEqual(await b.call('world:qg-start', { projectId: PID }), { ok: true });
  // A player in a Quote Guess game can't start / join Scene Guess elsewhere.
  h.env.live.add('thor1');
  assert.deepEqual(await c.call('world:sg-start', { projectId: 'thor1' }), { ok: true });
  const aPos = h.reg; // the registry answers for both games
  assert.equal(aPos.userBusy('u1', 'scene'), true);
  assert.equal(aPos.userBusy('u3', 'quote'), true);
  assert.equal(aPos.islandBusy(PID, 'scene'), true);
  assert.equal(aPos.islandBusy('thor1', 'quote'), true);
  assert.equal(aPos.islandBusy(PID, 'quote'), false, 'its own kind never blocks itself');
  // Leaving frees the island for the other game.
  await a.call('world:qg-leave', {});
  await b.call('world:qg-leave', {});
  assert.deepEqual(await b.call('world:sg-start', { projectId: PID }), { ok: true });
  assert.deepEqual(await a.call('world:qg-start', { projectId: PID }), { ok: false, error: 'island-busy' });
});

test('isPlaying (punch / NPC / snap immunity) covers both games; endAll ends both', async () => {
  const h = harness();
  const a = h.join('sa', 'u1', 'alex');
  const c = h.join('sc', 'u3', 'cleo', 'thor1');
  assert.equal(h.reg.isPlaying('sa'), false);
  await a.call('world:qg-start', { projectId: PID });
  await c.call('world:sg-start', { projectId: 'thor1' });
  assert.equal(h.reg.isPlaying('sa'), true);
  assert.equal(h.reg.isPlaying('sc'), true);
  assert.equal(h.quote.isPlaying('sc'), false);
  assert.equal(h.reg.endAll('restart'), 2);
  assert.equal(h.reg.isPlaying('sa'), false);
  assert.equal(h.lastState().reason, 'restart');
  assert.equal(h.lastState('world:sg-state').reason, 'restart');
});

test('reconnect grace and resume through the registry; the off switch ends a game', async () => {
  const h = harness();
  const a = h.join('sa', 'u1', 'alex');
  const b = h.join('sb', 'u2', 'sam');
  await a.call('world:qg-start', { projectId: PID });
  await b.call('world:qg-join', { projectId: PID });
  await h.advance(Q.C.LOBBY_MS + Q.C.READY_MS);
  h.reg.socketGone('sb');
  assert.deepEqual(h.lastState().away, ['sam']);
  const b2 = h.join('sb2', 'u2', 'sam');
  h.reg.resume(b2);
  assert.ok(b2.emitted.some(e => e.event === 'world:qg-state' && e.payload.phase === 'round'));
  assert.equal(h.reg.isPlaying('sb2'), true);
  h.env.enabled = false;
  await h.advance(30000);
  assert.equal(h.lastState().phase, 'idle');
  assert.equal(h.lastState().reason, 'disabled');
});

test('the registry fans every hook out to every game', () => {
  const calls = [];
  const fake = (kind) => ({
    kind,
    setPeers(p) { calls.push([kind, 'peers', !!p]); },
    attach() { calls.push([kind, 'attach']); }, register() { calls.push([kind, 'register']); },
    retire() { calls.push([kind, 'retire']); }, resume() { calls.push([kind, 'resume']); },
    onZone() { calls.push([kind, 'onZone']); }, socketGone() { calls.push([kind, 'gone']); },
    endAll() { return kind === 'a' ? 1 : 2; },
    isPlaying: (sid) => kind === 'b' && sid === 'x', hasGame: () => false, userInGame: () => false
  });
  const reg = createRegistry([fake('a'), fake('b')]);
  reg.attach(); reg.register(); reg.retire(); reg.resume(); reg.onZone(); reg.socketGone();
  for (const k of ['peers', 'attach', 'register', 'retire', 'resume', 'onZone', 'gone']) {
    assert.deepEqual(calls.filter(c => c[1] === k).map(c => c[0]), ['a', 'b'], k);
  }
  assert.equal(reg.endAll(), 3);
  assert.equal(reg.isPlaying('x'), true);
  assert.equal(reg.isPlaying('y'), false);
  assert.equal(reg.get('b').kind, 'b');
});

// ── the champion's featured line (world:qg-pick → core.onPick) ──

test('qg-pick: not the champion, a bad index, and a good pick that saves the line and refreshes the board', async () => {
  const h = harness();
  const a = h.join('sa', 'u1', 'alex');
  const b = h.join('sb', 'u2', 'sam');
  const lines = BANK.slice(0, 10).map(l => l.id);
  h.qData.champs.set(PID, { userId: 'u1', username: 'alex', score: 9000, pick: null, pickId: null });
  h.qScores.scores.set(`u1|${PID}`, { userId: 'u1', projectId: PID, best: 9000, plays: 2, bestLines: lines, pick: lines[0] });
  h.qScores.scores.set(`u2|${PID}`, { userId: 'u2', projectId: PID, best: 100, plays: 1, bestLines: lines, pick: lines[1] });

  assert.deepEqual(await b.call('world:qg-pick', { projectId: PID, index: 4 }), { ok: false, error: 'not-champion' });
  assert.deepEqual(await a.call('world:qg-pick', { projectId: 'thor1', index: 4 }), { ok: false, error: 'not-champion' }, 'no champion there');
  for (const index of [-1, Q.C.ROUNDS, 1.5, '4', null]) {
    assert.deepEqual(await a.call('world:qg-pick', { projectId: PID, index }), { ok: false, error: 'bad' }, String(index));
  }
  assert.equal(h.qScores.scores.get(`u1|${PID}`).pick, lines[0]);
  assert.equal(h.qScores.scores.get(`u2|${PID}`).pick, lines[1]);
  assert.equal(h.qData.invalidations.length, 0);

  assert.deepEqual(await a.call('world:qg-pick', { projectId: PID, index: 4 }), { ok: true });
  assert.equal(h.qScores.scores.get(`u1|${PID}`).pick, lines[4]);
  assert.equal(h.qScores.scores.get(`u2|${PID}`).pick, lines[1], "the other player's row is untouched");
  assert.deepEqual(h.qData.invalidations, [['board', PID]]);

  // The pick is checked against the user's own stored game: no row → bad.
  h.qScores.scores.delete(`u1|${PID}`);
  assert.deepEqual(await a.call('world:qg-pick', { projectId: PID, index: 4 }), { ok: false, error: 'bad' });
  // A champion read that throws is answered, not thrown.
  h.qData.champions.get = async () => { throw new Error('mongo down'); };
  assert.deepEqual(await a.call('world:qg-pick', { projectId: PID, index: 4 }), { ok: false, error: 'error' });
});

// ── a slow draw (begin awaits data.drawLines) ──

test('a slow line draw: nothing breaks while it is out; resolving after everyone quit sends nothing and frees the island', async () => {
  const h = harness();
  const a = h.join('sa', 'u1', 'alex');
  let release;
  let draws = 0;
  h.qData.drawLines = (pid, rng) => { draws++; return new Promise(r => { release = () => r(Q.buildRounds(BANK, rng)); }); };
  await a.call('world:qg-start', { projectId: PID });
  await h.advance(Q.C.LOBBY_MS);
  assert.deepEqual(await a.call('world:qg-go', { projectId: PID }), { ok: true });
  await h.advance(30000);
  assert.equal(draws, 1, 'Go during a draw does not start a second one');
  assert.equal(h.lastState().phase, 'lobby');
  assert.deepEqual(await a.call('world:qg-leave', {}), { ok: true });
  assert.equal(h.lastState().reason, 'empty');
  const before = h.sent.length;
  release();
  await h.advance(0); await h.advance(0);
  assert.equal(h.sent.length, before, 'the late draw broadcasts nothing');
  assert.equal(h.quote.hasGame(PID), false);
  assert.equal(h.reg.islandBusy(PID, 'scene'), false, 'Scene Guess can use the island');

  // And a slow draw the players wait out ends in "get ready" with those lines.
  assert.deepEqual(await a.call('world:qg-start', { projectId: PID }), { ok: true });
  await h.advance(Q.C.LOBBY_MS);
  assert.equal(h.lastState().phase, 'lobby');
  release();
  await h.advance(0); await h.advance(0);
  assert.equal(h.lastState().phase, 'ready');
  await h.advance(Q.C.READY_MS);
  assert.equal(h.lastState().phase, 'round');
});

test('a draw that comes back empty (the bank went unplayable) ends the lobby with "no-lines"', async () => {
  const h = harness();
  const a = h.join('sa', 'u1', 'alex');
  h.qData.drawLines = async () => null;
  await a.call('world:qg-start', { projectId: PID });
  await h.advance(Q.C.LOBBY_MS);
  assert.equal(h.lastState().phase, 'idle');
  assert.equal(h.lastState().reason, 'no-lines');
  assert.equal(h.quote.hasGame(PID), false);
});

// ── a slow score save (RT2-10: finish() shows the results before persist) ──

test('a score save slower than RESULTS_MS: the results show at once, the game ends "done" on time, the record fanfare still fires', async () => {
  const h = harness();
  const a = h.join('sa', 'u1', 'alex');
  h.join('sw', 'u3', 'watcher');
  let release;
  const gate = new Promise(r => { release = r; });
  const orig = h.qScores.updateOne;
  h.qScores.updateOne = async (...args) => { await gate; return orig.apply(h.qScores, args); };
  await a.call('world:qg-start', { projectId: PID });
  await h.advance(Q.C.LOBBY_MS + Q.C.READY_MS);
  const rounds = h.rounds();
  for (let r = 0; r < Q.C.ROUNDS; r++) {
    assert.deepEqual(await a.call('world:qg-answer', { round: r, choice: rounds[r].answer }), { ok: true });
    await h.advance(Q.C.REVEAL_MS);
  }
  assert.equal(h.lastState().phase, 'results', 'the results do not wait for the save');
  assert.equal(h.lastState().record, null);
  await h.advance(Q.C.RESULTS_MS);
  assert.equal(h.lastState().phase, 'idle');
  assert.equal(h.lastState().reason, 'done');
  const before = h.sent.length;
  release();
  for (let i = 0; i < 5; i++) await h.advance(0);
  assert.equal(h.qScores.scores.get(`u1|${PID}`).best, 10000);
  // After the 'done' idle only the fanfare follows, never a state.
  const late = h.sent.slice(before);
  assert.deepEqual(late.map(s => s.event), ['world:qg-fanfare']);
  assert.equal(late[0].payload.username, 'alex');
  assert.ok(late[0].to.includes('sa') && late[0].to.includes('sw'));
});
