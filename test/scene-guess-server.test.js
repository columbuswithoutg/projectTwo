/************************************************
 * Integration tests for server/scene-guess.js — whole Scene Guess games
 * driven through the socket handlers with a fake clock, a fake Socket.IO,
 * stubbed data / models (no Mongo): lobby → ready → 10 rounds → results,
 * score saving + the record, reconnect grace, leaving, the off switches,
 * punch/snap immunity and the champion's arrival fanfare. Also checks no
 * still's answer is ever sent before its reveal.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const L = require('../js/scene-guess-logic.js');
const { create } = require('../server/scene-guess.js');

const PID = 'ironman1';
// Ten stills in line order: round r's answer is 600·(r+1) seconds.
const STILLS = Array.from({ length: 10 }, (_, i) => ({ id: 's' + i, url: '/stills/s' + i + '.jpg', answer: 600 * (i + 1) }));

function harness() {
  let clock = 1_000_000;
  const timers = [];
  let seq = 0;
  const flush = () => new Promise(r => setImmediate(r));

  const sent = [];                 // io.to(target).emit(...)
  const io = { to(target) { return { emit(event, payload) { sent.push({ to: target, event, payload: JSON.parse(JSON.stringify(payload)) }); } }; } };

  const env = { enabled: true, live: new Set([PID, 'hulk']) };
  const champs = new Map();
  const invalidations = [];
  const events = new EventEmitter();
  const data = {
    enabledSync: () => env.enabled,
    roundSecSync: () => 30,
    isLiveSync: (pid) => env.live.has(pid),
    projectSync: (pid) => ({ id: pid, runtime: 126 }),
    drawStills: async () => STILLS.map(s => ({ ...s })),
    champions: { get: async () => champs, peek: () => champs },
    invalidate: (kind, pid) => invalidations.push([kind, pid]),
    publicRecord: (c) => (c ? { username: c.username, score: c.score } : null),
    settings: { get: async () => ({ enabled: env.enabled, roundSec: 30 }) },
    liveIslands: async () => [...env.live],
    events,
    prime() {}
  };

  // In-memory SceneScore with just the update shapes persist() uses.
  const scores = new Map();
  const key = (f) => `${f.userId}|${f.projectId}`;
  const SceneScore = {
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
  const deleted = new Set();
  const User = { exists: async ({ _id }) => !deleted.has(String(_id)) };

  const mgr = create({
    Logic: L, data, models: { SceneScore, User },
    now: () => clock,
    setTimeout: (fn, ms) => { const t = { at: clock + ms, fn, id: ++seq, off: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.off = true; },
    rng: () => 0,
    log: () => {}
  });

  const players = new Map();
  mgr.attach(io, { players, rateOk: () => true, touchStay: () => {}, zoneOf: (s, p) => p.projectId });

  function join(sid, userId, username, projectId = PID) {
    const handlers = {};
    const socket = {
      id: sid,
      data: { userId },
      emitted: [],
      on(ev, fn) { handlers[ev] = fn; },
      emit(event, payload) { this.emitted.push({ event, payload: JSON.parse(JSON.stringify(payload)) }); },
      call(ev, raw) { return new Promise(resolve => handlers[ev](raw, resolve)); }
    };
    players.set(sid, { socketId: sid, userId, username, projectId });
    mgr.register(socket);
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

  // The newest sg-state any target received for the island.
  function lastState() {
    for (let i = sent.length - 1; i >= 0; i--) if (sent[i].event === 'world:sg-state') return sent[i].payload;
    return null;
  }

  return { mgr, io, sent, env, champs, scores, deleted, invalidations, players, join, advance, lastState, flush, now: () => clock };
}

// Every 'answer' key must sit inside history[] — and during a round the
// history only covers the rounds already revealed.
function assertNoEarlyAnswers(sent) {
  for (const { event, payload } of sent) {
    if (event !== 'world:sg-state' || !payload.history) continue;
    const walk = (o, path) => {
      if (!o || typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o)) {
        if (k === 'answer') assert.equal(path[0], 'history', `answer outside history at ${path.join('.')}`);
        walk(v, path.concat(k));
      }
    };
    walk(payload, []);
    if (payload.phase === 'round') assert.equal(payload.history.length, payload.round, 'round in progress stays hidden');
  }
}

async function playRound(h, guessers) {
  const st = h.lastState();
  assert.equal(st.phase, 'round');
  for (const [socket, offset] of guessers) {
    const r = await socket.call('world:sg-guess', { round: st.round, at: STILLS[st.round].answer + offset });
    assert.ok(r.ok, JSON.stringify(r));
  }
}

test('a full two-player game: lobby → 10 rounds → results, scores saved, record + fanfare', async () => {
  const h = harness();
  const a = h.join('sa', 'u1', 'alex');
  const b = h.join('sb', 'u2', 'sam');
  h.join('sc', 'u3', 'watcher');                       // on the island, not playing

  assert.deepEqual(await a.call('world:sg-start', { projectId: PID }), { ok: true });
  assert.deepEqual(await b.call('world:sg-join', { projectId: PID }), { ok: true });
  assert.equal(h.lastState().phase, 'lobby');
  assert.deepEqual(h.lastState().players.map(p => p.username), ['alex', 'sam']);
  assert.ok(h.sent.some(s => s.event === 'world:sg-live' && s.payload.live && s.payload.host === 'alex'));
  // The onlooker gets every state too.
  assert.ok(h.sent.some(s => s.event === 'world:sg-state' && Array.isArray(s.to) && s.to.includes('sc')));

  await h.advance(L.C.LOBBY_MS);
  assert.equal(h.lastState().phase, 'ready');
  assert.equal(h.lastState().stills.length, 10);
  await h.advance(L.C.READY_MS);

  for (let r = 0; r < L.C.ROUNDS; r++) {
    await playRound(h, [[a, 0], [b, 60]]);              // alex perfect, sam a minute off
    assert.equal(h.lastState().phase, 'reveal', 'everyone locked → early reveal');
    await h.advance(L.C.REVEAL_MS);
  }
  const res = h.lastState();
  assert.equal(res.phase, 'results');
  assert.deepEqual(res.ranking, [{ username: 'alex', total: 10000 }, { username: 'sam', total: 9200 }]);
  assert.deepEqual(res.record, { username: 'alex', score: 10000, previous: null, previousHolder: null });
  assert.ok(h.sent.some(s => s.event === 'world:sg-fanfare' && s.payload.username === 'alex'));

  const sa = h.scores.get(`u1|${PID}`), sb = h.scores.get(`u2|${PID}`);
  assert.equal(sa.best, 10000);
  assert.equal(sa.plays, 1);
  assert.equal(sb.best, 9200);
  assert.ok(sa.achievedAt < sb.achievedAt, 'staggered by rank');
  assert.equal(sa.pick, 's0', 'default pick = the best round (first on ties)');
  assert.deepEqual(sa.bestStills, STILLS.map(s => s.id));
  assert.ok(h.invalidations.some(([k]) => k === 'board'));

  await h.advance(L.C.RESULTS_MS);
  assert.equal(h.lastState().phase, 'idle');
  assert.ok(h.sent.some(s => s.event === 'world:sg-live' && s.payload.live === false));
  assert.equal(h.mgr.isPlaying('sa'), false);
  assertNoEarlyAnswers(h.sent);
});

test('a second game that only ties the record does not take it; plays still count', async () => {
  const h = harness();
  h.champs.set(PID, { userId: 'u9', username: 'old', score: 10000 });
  const a = h.join('sa', 'u1', 'alex');
  await a.call('world:sg-start', { projectId: PID });
  await h.advance(L.C.LOBBY_MS + L.C.READY_MS);
  for (let r = 0; r < L.C.ROUNDS; r++) {
    await playRound(h, [[a, 0]]);
    await h.advance(L.C.REVEAL_MS);
  }
  assert.equal(h.lastState().record, null);
  assert.ok(!h.sent.some(s => s.event === 'world:sg-fanfare'));
  assert.equal(h.scores.get(`u1|${PID}`).best, 10000);
});

test('one game per island: Play during a lobby joins it; busy elsewhere and off-island are refused', async () => {
  const h = harness();
  const a = h.join('sa', 'u1', 'alex');
  const b = h.join('sb', 'u2', 'sam');
  const c = h.join('sc', 'u3', 'cleo', 'hulk');
  await a.call('world:sg-start', { projectId: PID });
  assert.deepEqual(await b.call('world:sg-start', { projectId: PID }), { ok: true });
  assert.deepEqual(h.lastState().players.map(p => p.username), ['alex', 'sam']);
  assert.deepEqual(await c.call('world:sg-start', { projectId: PID }), { ok: false, error: 'not-here' });
  assert.deepEqual(await c.call('world:sg-start', { projectId: 'hulk' }), { ok: true });
  h.players.get('sa').projectId = 'hulk';               // alex walks over…
  assert.deepEqual(await a.call('world:sg-join', { projectId: 'hulk' }), { ok: false, error: 'busy' });
  await h.advance(L.C.LOBBY_MS);
  const late = h.join('sd', 'u4', 'dee');
  assert.deepEqual(await late.call('world:sg-join', { projectId: PID }), { ok: false, error: 'started' });
});

test('a dropped player keeps their seat for the grace, then is dropped; away players never hold up a round', async () => {
  const h = harness();
  const a = h.join('sa', 'u1', 'alex');
  const b = h.join('sb', 'u2', 'sam');
  await a.call('world:sg-start', { projectId: PID });
  await b.call('world:sg-join', { projectId: PID });
  await h.advance(L.C.LOBBY_MS + L.C.READY_MS);

  h.players.delete('sb');
  h.mgr.socketGone('sb');                               // sam's connection drops
  assert.deepEqual(h.lastState().away, ['sam']);
  await playRound(h, [[a, 0]]);
  assert.equal(h.lastState().phase, 'reveal', 'alex alone locked → no waiting for sam');

  const b2 = h.join('sb2', 'u2', 'sam');                // back on a new socket
  h.mgr.resume(b2);
  assert.ok(b2.emitted.some(e => e.event === 'world:sg-state' && e.payload.phase === 'reveal'));
  assert.deepEqual(h.lastState().away, []);
  assert.equal(h.mgr.isPlaying('sb2'), true);

  h.players.delete('sb2');
  h.mgr.socketGone('sb2');
  await h.advance(L.C.RECONNECT_GRACE_MS);
  assert.deepEqual(h.lastState().players.map(p => p.username), ['alex']);
  assert.equal(h.mgr.isPlaying('sb2'), false);
});

test('a newer tab retires the old one: the old HUD is told, the seat moves over', async () => {
  const h = harness();
  const a = h.join('sa', 'u1', 'alex');
  await a.call('world:sg-start', { projectId: PID });
  const sentBefore = h.sent.length;
  h.mgr.retire('sa');
  assert.ok(h.sent.slice(sentBefore).some(s => s.to === 'sa' && s.payload.phase === 'idle' && s.payload.reason === 'moved'));
  const a2 = h.join('sa2', 'u1', 'alex');
  h.mgr.resume(a2);
  assert.equal(h.mgr.isPlaying('sa2'), true);
  assert.equal(h.mgr.isPlaying('sa'), false);
});

test('leaving: host passes on; the last player out frees the island', async () => {
  const h = harness();
  const a = h.join('sa', 'u1', 'alex');
  const b = h.join('sb', 'u2', 'sam');
  await a.call('world:sg-start', { projectId: PID });
  await b.call('world:sg-join', { projectId: PID });
  await a.call('world:sg-leave', {});
  assert.equal(h.lastState().host, 'sam');
  await b.call('world:sg-leave', {});
  assert.equal(h.lastState().phase, 'idle');
  assert.equal(h.lastState().reason, 'empty');
  assert.deepEqual(await a.call('world:sg-start', { projectId: PID }), { ok: true }, 'free again');
});

test('the host can start early; only the host', async () => {
  const h = harness();
  const a = h.join('sa', 'u1', 'alex');
  const b = h.join('sb', 'u2', 'sam');
  await a.call('world:sg-start', { projectId: PID });
  await b.call('world:sg-join', { projectId: PID });
  assert.deepEqual(await b.call('world:sg-go', {}), { ok: false, error: 'not-host' });
  assert.deepEqual(await a.call('world:sg-go', {}), { ok: true });
  await h.flush();
  assert.equal(h.lastState().phase, 'ready');
});

test('off switches: global off refuses everything; an island switched off ends its running game', async () => {
  const h = harness();
  const a = h.join('sa', 'u1', 'alex');
  h.env.enabled = false;
  assert.deepEqual(await a.call('world:sg-start', { projectId: PID }), { ok: false, error: 'off' });
  h.env.enabled = true;
  h.env.live.delete('hulk');
  h.players.get('sa').projectId = 'hulk';
  assert.deepEqual(await a.call('world:sg-start', { projectId: 'hulk' }), { ok: false, error: 'not-live' });
  h.players.get('sa').projectId = PID;
  await a.call('world:sg-start', { projectId: PID });
  h.env.live.delete(PID);                               // admin switches the island off mid-lobby
  await h.advance(L.C.LOBBY_MS);
  assert.equal(h.lastState().phase, 'idle');
  assert.equal(h.lastState().reason, 'disabled');
  assert.equal(h.mgr.isPlaying('sa'), false);
});

test('isPlaying covers every phase (punch / snap immunity), and ends with the game', async () => {
  const h = harness();
  const a = h.join('sa', 'u1', 'alex');
  assert.equal(h.mgr.isPlaying('sa'), false);
  await a.call('world:sg-start', { projectId: PID });
  assert.equal(h.mgr.isPlaying('sa'), true);
  await h.advance(L.C.LOBBY_MS + L.C.READY_MS);
  assert.equal(h.mgr.isPlaying('sa'), true);
  await a.call('world:sg-leave', {});
  assert.equal(h.mgr.isPlaying('sa'), false);
});

test("the champion's arrival fanfare fires on entering their island, once per cooldown", async () => {
  const h = harness();
  h.champs.set(PID, { userId: 'u1', username: 'alex', score: 8000 });
  const a = h.join('sa', 'u1', 'alex');
  const p = h.players.get('sa');
  const arrivals = () => h.sent.filter(s => s.event === 'world:sg-arrived').length;
  h.mgr.onZone(a, p, null, PID);
  assert.equal(arrivals(), 1);
  assert.deepEqual(h.sent.find(s => s.event === 'world:sg-arrived').payload, { projectId: PID, username: 'alex', id: 'sa' });
  h.mgr.onZone(a, p, PID, null);
  h.mgr.onZone(a, p, null, PID);
  assert.equal(arrivals(), 1, 'cooldown');
  await h.advance(L.C.ARRIVE_COOLDOWN_MS);
  h.mgr.onZone(a, p, null, PID);
  assert.equal(arrivals(), 2);
  const b = h.join('sb', 'u2', 'sam');
  h.mgr.onZone(b, h.players.get('sb'), null, PID);
  assert.equal(arrivals(), 2, 'not the champion');
});

test('stepping off the island in a game starts the zone grace; coming back clears it', async () => {
  const h = harness();
  const a = h.join('sa', 'u1', 'alex');
  const b = h.join('sb', 'u2', 'sam');
  await a.call('world:sg-start', { projectId: PID });
  await b.call('world:sg-join', { projectId: PID });
  const pb = h.players.get('sb');
  pb.projectId = null;
  h.mgr.onZone(b, pb, PID, null);
  assert.deepEqual(h.lastState().away, ['sam']);
  pb.projectId = PID;
  h.mgr.onZone(b, pb, null, PID);
  assert.deepEqual(h.lastState().away, []);
  pb.projectId = null;
  h.mgr.onZone(b, pb, PID, null);
  await h.advance(L.C.ZONE_GRACE_MS);
  assert.deepEqual(h.lastState().players.map(p => p.username), ['alex']);
});

test('a player deleted mid-game is not saved; bad payloads are refused', async () => {
  const h = harness();
  const a = h.join('sa', 'u1', 'alex');
  const b = h.join('sb', 'u2', 'sam');
  await a.call('world:sg-start', { projectId: PID });
  await b.call('world:sg-join', { projectId: PID });
  assert.deepEqual(await a.call('world:sg-start', { projectId: { $ne: 1 } }), { ok: false, error: 'bad' });
  await h.advance(L.C.LOBBY_MS + L.C.READY_MS);
  assert.deepEqual(await a.call('world:sg-guess', { round: '0', at: 5 }), { ok: false, error: 'bad' });
  assert.deepEqual(await a.call('world:sg-guess', { round: 0, at: 1e9 }), { ok: false, error: 'bad-guess' });
  h.deleted.add('u2');
  for (let r = 0; r < L.C.ROUNDS; r++) {
    await playRound(h, [[a, 0], [b, 0]]);
    await h.advance(L.C.REVEAL_MS);
  }
  assert.ok(h.scores.get(`u1|${PID}`));
  assert.equal(h.scores.get(`u2|${PID}`), undefined);
});
