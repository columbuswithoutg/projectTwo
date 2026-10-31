/************************************************
 * routes/world-socket.js handler wiring, run for real (RT-19 / RT2-04):
 * join → zone, the 1 s zone dwell and what a committed change does (stay
 * banked, IslandGames.onZone once, world:zone), the voice mesh deltas
 * (peer-left before peer-joined, the announcer's voice:peers), a second tab
 * taking over the seat, and disconnect (zone timer cleared, stay banked once).
 *
 * Harness: a fresh compiled copy of the real module per test (its private
 * maps exposed, as in test/admin-project-delete.test.js), a fake `io` that
 * records every emit together with who it reached, fake sockets whose
 * handlers are called directly, stubbed models (no Mongo), a stub
 * server/island-games.js that records calls, and node:test mock timers for
 * the clock (Date, setTimeout, setInterval). Any `[ws] … failed` logged by
 * guard() fails the test: guard() would otherwise hide a throw.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const L = require('../js/world-chat-logic.js');
const RR = require('../js/road-router.js');
const { WORLD_GRID } = require('../js/playground3d-physics.js');

// ── stubs ──
// Island games: record what the socket layer tells them.
const games = [];
const gamesPath = require.resolve('../server/island-games');
const gamesStub = { createRegistry: () => ({}), isPlaying: () => false, endAll: () => 0 };
for (const k of ['attach', 'register', 'retire', 'resume', 'socketGone']) gamesStub[k] = (a) => { games.push([k, a && a.id ? a.id : a]); };
gamesStub.onZone = (socket, p, prev, next) => { games.push(['onZone', socket.id, prev, next]); };
require.cache[gamesPath] = { id: gamesPath, filename: gamesPath, loaded: true, exports: gamesStub };

// Two islands, a road between them (b needs a).
const GRID = [
  { id: 'a', title: 'Alpha', gridX: 0, gridY: 0, prerequisites: [] },
  { id: 'b', title: 'Beta', gridX: 0, gridY: 2, prerequisites: ['a'] }
];
const chain = (v) => ({ select: () => chain(v), lean: async () => v });
require('../models/Project').find = () => chain(GRID);
require('../models/user').findById = () => chain({ watchedProjects: [{ projectId: 'a' }, { projectId: 'b' }] });
require('../models/AdminConfig').findOne = () => chain(null);
const bulkWrites = [];
require('../models/ProjectStay').bulkWrite = async (ops) => { bulkWrites.push(ops); return {}; };

// Where the road runs: the same rectangles the server builds.
const VIEW = require('../js/playground3d-scene.js').roadView({
  SCALE: WORLD_GRID.SCALE, PLATFORM_W: WORLD_GRID.PLATFORM_W, APRON_MARGIN: WORLD_GRID.APRON_MARGIN,
  ROAD_W: L.C.ROAD_W, DOORWAY_WIDTH: L.C.DOORWAY_WIDTH
});
const ROADS = L.buildRoads(GRID, RR, VIEW);
const ROAD_KEY = [...ROADS.byKey.keys()][0];
const MID_Z = WORLD_GRID.SCALE;                     // halfway between the islands
const ROAD_X = ROADS.rects.reduce((best, r) => (Math.abs(r.cz - MID_Z) < Math.abs(best.cz - MID_Z) ? r : best)).cx;
const ON_A = { x: 0, z: 0 };
const ON_ROAD = { x: ROAD_X, z: MID_Z };
const DWELL = L.C.ZONE_DWELL_MS;

// ── the module under test ──
function freshWorldSocket() {
  const file = path.join(__dirname, '../routes/world-socket.js');
  const m = new Module(file, module);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(fs.readFileSync(file, 'utf8') +
    '\nmodule.exports._t = { worldPlayers, pendingCredits, voiceWorld, voiceLinks };', file);
  return m.exports;
}

// A fake socket.io server. Every emit is logged with the socket ids it
// reached at that moment (`to` = room or socket id, minus `except`).
function makeIo() {
  const log = [];
  const rooms = new Map();
  const sockets = new Map();
  const members = (room, except) => {
    const ids = rooms.has(room) ? [...rooms.get(room)] : sockets.has(room) ? [room] : [];
    return ids.filter(id => !except.includes(id));
  };
  const emitter = (room, except) => ({
    except: (sid) => emitter(room, [...except, sid]),
    emit: (event, payload) => { log.push({ to: room, event, payload, reached: members(room, except) }); }
  });
  const io = {
    log, rooms, sockets: { sockets },
    use(fn) { this.mw = fn; },
    on(ev, fn) { if (ev === 'connection') this.onConnection = fn; },
    to: (room) => emitter(room, []),
    in: (room) => ({ socketsLeave: (r) => { for (const sid of members(room, [])) if (rooms.has(r)) rooms.get(r).delete(sid); } })
  };
  let n = 0;
  io.connect = (userId) => {
    const s = {
      id: 's' + String(++n).padStart(2, '0'),
      data: { userId, username: 'user_' + userId },
      connected: true,
      handshake: { headers: {}, address: '127.0.0.1', auth: {} },
      handlers: new Map(),
      on(ev, fn) { this.handlers.set(ev, fn); },
      emit(event, payload) { log.push({ to: s.id, event, payload, reached: [s.id] }); },
      join(room) { if (!rooms.has(room)) rooms.set(room, new Set()); rooms.get(room).add(s.id); },
      leave(room) { if (rooms.has(room)) rooms.get(room).delete(s.id); },
      to: (room) => emitter(room, [s.id]),
      fire(ev, ...args) { const h = this.handlers.get(ev); assert.ok(h, 'no handler for ' + ev); return h(...args); },
      drop() {
        s.connected = false;
        sockets.delete(s.id);
        for (const set of rooms.values()) set.delete(s.id);
        s.fire('disconnect');
      }
    };
    sockets.set(s.id, s);
    io.onConnection(s);
    return s;
  };
  // What reached socket `sid` from log index `from` on, as "event payload-json".
  io.inbox = (sid, from = 0) => log.slice(from).filter(e => e.reached.includes(sid));
  return io;
}

const settle = () => new Promise(r => setImmediate(r));

// Per test: mock clock, fresh module, fake io, and guard() errors → failure.
async function world(t) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1_000_000 });
  const errors = [];
  const orig = console.error;
  console.error = (...a) => { errors.push(a); };
  t.after(() => {
    console.error = orig;
    // Node 22 prints an ExperimentalWarning for MockTimers through console.error
    // on the first enable(); that is not a guard() log (Node 24 no longer warns).
    const logged = errors.map(a => String(a[0])).filter(m => !/ExperimentalWarning/.test(m));
    assert.deepEqual(logged, [], 'nothing logged by guard()');
  });
  games.length = 0;
  bulkWrites.length = 0;
  const WS = freshWorldSocket();
  const io = makeIo();
  WS(io);
  await settle();   // the primed project grid + stones flag reads land
  const tick = async (ms) => { t.mock.timers.tick(ms); await settle(); };
  // Join at `pos` and let the watched-list read land.
  const join = async (userId, pos) => {
    const s = io.connect(userId);
    s.fire('world:join', { x: pos.x, z: pos.z, yaw: 0 });
    await settle();
    return s;
  };
  // A position packet (the per-socket 40 ms floor is ticked past first).
  const move = async (s, pos) => { await tick(50); s.fire('world:pos', { x: pos.x, y: 0, z: pos.z, yaw: 0 }); };
  return { WS, io, T: WS._t, tick, join, move, now: () => Date.now() };
}

const zoneEvents = (io, sid, from) => io.inbox(sid, from).filter(e => e.event === 'world:zone').map(e => e.payload);
const onZoneCalls = () => games.filter(c => c[0] === 'onZone');

test('join: the island under the joiner becomes their zone after the 1 s dwell', async (t) => {
  const { io, T, tick, join } = await world(t);
  const s = await join('u1', ON_A);
  const p = T.worldPlayers.get(s.id);
  assert.equal(p.projectId, null, 'not yet: the dwell is still running');
  assert.deepEqual(zoneEvents(io, s.id), []);
  assert.ok(s.data.zoneTimer, 'a dwell re-check is scheduled (the player may never move again)');
  await tick(DWELL + 10);
  assert.equal(p.projectId, 'a');
  assert.equal(p.roadKey, null);
  assert.deepEqual(zoneEvents(io, s.id), [{ projectId: 'a', roadKey: null, label: 'Alpha' }]);
  assert.deepEqual(onZoneCalls(), [['onZone', s.id, null, 'a']]);
  assert.equal(p.stay && p.stay.projectId, 'a', 'stay accounting starts');
  assert.equal(s.data.zoneTimer, null);
});

test('zone change: banks the island stay and calls IslandGames.onZone exactly once, after the dwell', async (t) => {
  const { io, T, tick, join, move, now } = await world(t);
  const s = await join('u1', ON_A);
  await tick(DWELL + 10);
  const p = T.worldPlayers.get(s.id);
  const enteredAt = p.stay.creditedUpTo;
  games.length = 0;
  const mark = io.log.length;

  await tick(5000);                    // five seconds on the island
  await move(s, ON_ROAD);
  await move(s, ON_ROAD);              // still walking: the dwell keeps its start
  assert.deepEqual(onZoneCalls(), [], 'nothing before the dwell ends');
  assert.deepEqual(zoneEvents(io, s.id, mark), []);
  assert.equal(T.pendingCredits.size, 0, 'nothing banked yet');
  assert.equal(p.projectId, 'a');

  await tick(DWELL);                   // the re-check timer commits it
  const committedAt = now();
  assert.deepEqual(zoneEvents(io, s.id, mark), [{ projectId: null, roadKey: ROAD_KEY, label: 'Road: Alpha → Beta' }]);
  assert.deepEqual(onZoneCalls(), [['onZone', s.id, 'a', null]]);
  assert.equal(p.roadKey, ROAD_KEY);
  assert.equal(p.stay, null);
  assert.deepEqual([...T.pendingCredits], [['u1|a', committedAt - enteredAt]], 'the whole island stay, banked once');

  // More packets on the same road change nothing.
  await move(s, ON_ROAD);
  await tick(DWELL + 10);
  assert.equal(onZoneCalls().length, 1);
  assert.equal(zoneEvents(io, s.id, mark).length, 1);
  assert.deepEqual([...T.pendingCredits], [['u1|a', committedAt - enteredAt]]);
});

test('zone dwell: a doorway blip (road and straight back) never commits', async (t) => {
  const { io, T, tick, join, move } = await world(t);
  const s = await join('u1', ON_A);
  await tick(DWELL + 10);
  games.length = 0;
  const mark = io.log.length;
  await move(s, ON_ROAD);
  await tick(DWELL / 2);
  await move(s, ON_A);                 // back before the dwell: pending cleared
  await tick(DWELL * 2);
  assert.deepEqual(onZoneCalls(), []);
  assert.deepEqual(zoneEvents(io, s.id, mark), []);
  assert.equal(T.worldPlayers.get(s.id).projectId, 'a');
  assert.equal(T.pendingCredits.size, 0);
});

test('voice: the announcer gets voice:peers (no peer-joined), its new peer gets peer-joined', async (t) => {
  const { io, T, tick, join } = await world(t);
  const a = await join('u1', ON_A);
  const b = await join('u2', { x: 2, z: 0 });
  await tick(DWELL + 10);
  let mark = io.log.length;
  a.fire('voice:announce', { scope: 'world' });
  assert.deepEqual(io.inbox(a.id, mark).map(e => [e.event, e.payload]), [['voice:peers', { scope: 'world', peers: [] }]]);
  mark = io.log.length;
  b.fire('voice:announce', { scope: 'world' });
  const voice = io.log.slice(mark).filter(e => e.event.startsWith('voice:'));
  assert.deepEqual(voice.map(e => [e.event, e.reached, e.payload]), [
    ['voice:peer-joined', [a.id], { id: b.id }],
    ['voice:peers', [b.id], { scope: 'world', peers: [a.id] }]
  ]);
  assert.deepEqual([...T.voiceLinks.get(a.id)], [b.id]);
  // A repeated announce (a retry) re-sends voice:peers and tells nobody else.
  mark = io.log.length;
  b.fire('voice:announce', { scope: 'world' });
  assert.deepEqual(io.log.slice(mark).map(e => [e.event, e.reached]), [['voice:peers', [b.id]]]);
});

test('voice: on a zone change every peer-left goes out before any peer-joined', async (t) => {
  const { io, T, tick, join, move } = await world(t);
  const a = await join('u1', ON_A);
  const b = await join('u2', { x: 2, z: 0 });
  const c = await join('u3', ON_ROAD);
  await tick(DWELL + 10);
  for (const s of [a, b, c]) s.fire('voice:announce', { scope: 'world' });
  assert.deepEqual([...T.voiceLinks.get(a.id)], [b.id]);
  assert.equal(T.voiceLinks.has(c.id), false, 'c is alone on the road');
  const mark = io.log.length;
  await move(b, { x: ROAD_X, z: MID_Z + 2 });   // b walks onto c's road
  await tick(DWELL + 10);
  const voice = io.log.slice(mark).filter(e => e.event.startsWith('voice:'));
  assert.deepEqual(voice.map(e => [e.event, e.reached[0], e.payload.id]), [
    ['voice:peer-left', a.id, b.id], ['voice:peer-left', b.id, a.id],
    ['voice:peer-joined', b.id, c.id], ['voice:peer-joined', c.id, b.id]
  ]);
  assert.equal(T.voiceLinks.has(a.id), false);
  assert.deepEqual([...T.voiceLinks.get(b.id)], [c.id]);
});

test('second tab: takes over the seat; the old socket\'s late disconnect does nothing', async (t) => {
  const { io, T, tick, join, move, now } = await world(t);
  const old = await join('u1', ON_A);
  const peer = await join('u2', { x: 2, z: 0 });
  await tick(DWELL + 10);
  const enteredAt = T.worldPlayers.get(old.id).stay.creditedUpTo;
  old.fire('voice:announce', { scope: 'world' });
  peer.fire('voice:announce', { scope: 'world' });
  await tick(3000);
  await move(old, ON_ROAD);            // the old tab is mid-dwell when it is retired
  await tick(300);
  assert.ok(old.data.zoneTimer, 'dwell pending on the old tab');
  games.length = 0;
  const mark = io.log.length;

  const tab = io.connect('u1');
  tab.fire('world:join', { x: 0, z: 0, yaw: 0 });
  const takenAt = now();
  await settle();
  assert.equal(T.worldPlayers.has(old.id), false);
  assert.ok(T.worldPlayers.has(tab.id));
  assert.equal(io.rooms.get('world').has(old.id), false, 'the old socket left the room');
  const after = io.log.slice(mark);
  assert.ok(after.some(e => e.event === 'world:kicked' && e.to === old.id), 'old tab told why');
  assert.ok(after.some(e => e.event === 'world:left' && e.payload.id === old.id && e.reached.includes(peer.id)));
  assert.deepEqual(after.filter(e => e.event === 'voice:peer-left').map(e => [e.reached[0], e.payload.id]),
    [[old.id, peer.id], [peer.id, old.id]], 'its voice link dropped both ways');
  assert.equal(T.voiceWorld.has(old.id), false);
  assert.deepEqual(games.filter(c => c[0] === 'retire' || c[0] === 'resume'), [['retire', old.id], ['resume', tab.id]]);
  // The old stay (still island a: the road was never committed) is banked once.
  const banked = takenAt - enteredAt;
  assert.deepEqual([...T.pendingCredits], [['u1|a', banked]]);

  // Later: the old tab's dwell timer fires and then it disconnects. Neither
  // touches the new seat, re-banks, or tells the room anything.
  const mark2 = io.log.length;
  games.length = 0;
  await tick(DWELL + 10);
  old.drop();
  await tick(10);
  const late = io.log.slice(mark2);
  assert.deepEqual(late.filter(e => e.event !== 'world:zone' || e.to !== tab.id).map(e => e.event), [], 'nothing about the old socket');
  assert.deepEqual(games.filter(c => c[0] === 'onZone' && c[1] === old.id), []);
  assert.deepEqual([...T.pendingCredits], [['u1|a', banked]], 'not banked a second time');
  assert.ok(T.worldPlayers.has(tab.id), 'the new tab keeps its seat');
});

test('disconnect: clears a pending zone timer and banks the stay exactly once', async (t) => {
  const { WS, io, T, tick, join, move, now } = await world(t);
  const s = await join('u1', ON_A);
  const other = await join('u2', { x: 3, z: 0 });
  await tick(DWELL + 10);
  const enteredAt = T.worldPlayers.get(s.id).stay.creditedUpTo;
  await tick(4000);
  await move(s, ON_ROAD);              // walking off: a dwell timer is pending
  assert.ok(s.data.zoneTimer, 'dwell pending');
  games.length = 0;
  await tick(300);
  const mark = io.log.length;
  s.drop();
  const goneAt = now();
  assert.equal(s.data.zoneTimer, null, 'zone timer cleared');
  assert.equal(T.worldPlayers.has(s.id), false);
  assert.deepEqual(io.log.slice(mark).map(e => [e.event, e.payload.id, e.reached]), [['world:left', s.id, [other.id]]]);
  assert.deepEqual([...T.pendingCredits], [['u1|a', goneAt - enteredAt]]);
  await tick(DWELL * 3);               // the cleared timer never fires
  assert.deepEqual(onZoneCalls(), []);
  assert.deepEqual(games.map(c => c[0]), ['socketGone']);
  // The flush writes that one credit (plus the other player's live stay).
  await WS.flushStays();
  const ops = bulkWrites.flat().map(o => [o.updateOne.filter.userId, o.updateOne.filter.projectId, o.updateOne.update.$inc.ms]);
  assert.deepEqual(ops.filter(o => o[0] === 'u1'), [['u1', 'a', goneAt - enteredAt]]);
});
