/************************************************
 * server/island-game.js resume() (RT3-01): a player who reloads mid-game
 * comes back on a new socket whose zone isn't known yet. Off the game's
 * island they get the zone grace (and lose the seat when it runs out); a
 * world:zone onto the island clears it. Quote Guess through the registry
 * with a fake clock, fake Socket.IO and stubbed data / models.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const Q = require('../js/quote-guess-logic.js');
const QuoteGuess = require('../server/quote-guess.js');
const { createRegistry } = require('../server/island-games.js');

const PID = 'avengers1';

const BANK = Array.from({ length: 24 }, (_, i) => {
  const sp = 'Person ' + 'ABCDEF'[i % 6], rp = 'Person ' + 'ABCDEF'[(i + 1) % 6];
  return {
    id: 'line' + i,
    speaker: { name: sp, key: Q.norm(sp), characterId: null },
    text: 'Quote number ' + i, textKey: Q.norm('Quote number ' + i),
    reply: i % 2 ? null : { speaker: { name: rp, key: Q.norm(rp), characterId: null }, text: 'Reply number ' + i },
    note: 'scene ' + i, episode: null, decoys: { speakers: [], replies: [] },
    credit: null
  };
});

function harness() {
  let clock = 1_000_000;
  const timers = [];
  let seq = 0;
  const flush = () => new Promise(r => setImmediate(r));
  const sent = [];
  const io = { to(target) { return { emit(event, payload) { sent.push({ to: target, event, payload: JSON.parse(JSON.stringify(payload)) }); } }; } };
  let r = 7;
  const env = { enabled: true, live: new Set([PID, 'thor1']) };
  const data = {
    enabledSync: () => env.enabled,
    isLiveSync: (pid) => env.live.has(pid),
    champions: { get: async () => new Map(), peek: () => new Map() },
    invalidate() {},
    publicRecord: (c) => c,
    settings: { get: async () => ({ enabled: env.enabled }) },
    liveIslands: async () => [...env.live],
    events: new EventEmitter(),
    prime() {},
    roundSecSync: () => 20,
    drawLines: async (pid, rng) => Q.buildRounds(BANK, rng)
  };
  const scores = { async updateOne() { return { matchedCount: 1 }; }, findOne() { return { select() { return { lean: async () => null }; } }; } };
  const quote = QuoteGuess.create({
    Logic: Q, data, models: { QuoteScore: scores, User: { exists: async () => true } },
    now: () => clock,
    setTimeout: (fn, ms) => { const t = { at: clock + ms, fn, id: ++seq, off: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.off = true; },
    rng: () => { r = (r * 16807) % 2147483647; return r / 2147483647; },
    log: () => {}
  });
  const reg = createRegistry([quote]);
  const players = new Map();
  reg.attach(io, { players, rateOk: () => true, touchStay: () => {}, zoneOf: (s, p) => p.projectId });

  function join(sid, userId, username, projectId = PID) {
    const handlers = {};
    const socket = {
      id: sid, data: { userId }, emitted: [],
      on(ev, fn) { handlers[ev] = fn; },
      emit(event, payload) { this.emitted.push({ event, payload }); },
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
  function lastState() {
    for (let i = sent.length - 1; i >= 0; i--) if (sent[i].event === 'world:qg-state') return sent[i].payload;
    return null;
  }
  return { reg, players, join, advance, lastState };
}

// alex + sam in round 0; sam's tab reloads and the new socket joins with no zone yet.
async function reloadMidGame() {
  const h = harness();
  const a = h.join('sa', 'u1', 'alex');
  const b = h.join('sb', 'u2', 'sam');
  await a.call('world:qg-start', { projectId: PID });
  await b.call('world:qg-join', { projectId: PID });
  await h.advance(Q.C.LOBBY_MS + Q.C.READY_MS);
  assert.equal(h.lastState().phase, 'round');
  h.reg.retire('sb');
  const b2 = h.join('sb2', 'u2', 'sam', null);   // a fresh player record: projectId null
  h.reg.resume(b2);
  return { h, a, b2 };
}

test('reload mid-game onto another island: the zone grace runs, then the seat is gone', async () => {
  const { h, a, b2 } = await reloadMidGame();
  assert.ok(b2.emitted.some(e => e.event === 'world:qg-state' && e.payload.phase === 'round'), 'the new tab still sees its game');
  assert.deepEqual(h.lastState().away, ['sam'], 'off the island after resume → away');
  // It spawns on another island.
  const p = h.players.get('sb2');
  p.projectId = 'thor1';
  h.reg.onZone(b2, p, null, 'thor1');
  assert.deepEqual(h.lastState().away, ['sam']);
  // An away player never holds up the round: alex's answer reveals at once.
  assert.deepEqual(await a.call('world:qg-answer', { round: 0, choice: 'a' }), { ok: true });
  assert.equal(h.lastState().phase, 'reveal');
  await h.advance(Q.C.ZONE_GRACE_MS);
  assert.equal(h.reg.isPlaying('sb2'), false, 'grace over → no longer seated (no punch immunity)');
  assert.equal(h.reg.userBusy('u2', 'scene'), false, 'free to join another game');
  assert.deepEqual(h.lastState().away, []);
  assert.ok(!h.lastState().players.some(x => x.username === 'sam'));
  assert.deepEqual(await b2.call('world:qg-answer', { round: 1, choice: 'a' }), { ok: false, error: 'not-playing' });
});

test('reload mid-game, then zoning onto the game island keeps the seat', async () => {
  const { h, b2 } = await reloadMidGame();
  assert.deepEqual(h.lastState().away, ['sam']);
  await h.advance(1000);   // the zone dwell before world:zone lands
  const p = h.players.get('sb2');
  p.projectId = PID;
  h.reg.onZone(b2, p, null, PID);
  assert.deepEqual(h.lastState().away, [], 'back on the island → present');
  await h.advance(Q.C.ZONE_GRACE_MS * 2);
  assert.equal(h.reg.isPlaying('sb2'), true);
  assert.ok(h.lastState().players.some(x => x.username === 'sam'));
});

test('resume on a socket already on the game island takes the seat at once', async () => {
  const h = harness();
  const a = h.join('sa', 'u1', 'alex');
  const b = h.join('sb', 'u2', 'sam');
  await a.call('world:qg-start', { projectId: PID });
  await b.call('world:qg-join', { projectId: PID });
  await h.advance(Q.C.LOBBY_MS + Q.C.READY_MS);
  h.reg.socketGone('sb');
  const b2 = h.join('sb2', 'u2', 'sam', PID);
  h.reg.resume(b2);
  assert.deepEqual(h.lastState().away, []);
  await h.advance(Q.C.ZONE_GRACE_MS * 2);
  assert.equal(h.reg.isPlaying('sb2'), true);
});
