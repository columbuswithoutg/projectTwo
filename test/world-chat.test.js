/************************************************
 * Unit tests for js/world-chat-logic.js — /world chat channels
 * (world / project / whisper), the shared cooldown and island zones.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../js/world-chat-logic.js');

const GRID = [
  { id: 'ironman1', gridX: 0, gridY: 1 },
  { id: 'ironman2', gridX: 0, gridY: 2 },
  { id: 'hulk', gridX: -2, gridY: 3 }
];
const S = L.C.GRID_SCALE;

test('projectAt: inside an island apron returns its id', () => {
  assert.equal(L.projectAt(0, S, GRID), 'ironman1');
  assert.equal(L.projectAt(-2 * S, 3 * S, GRID), 'hulk');
  assert.equal(L.projectAt(7.5, S - 7.5, GRID), 'ironman1');
});

test('projectAt: apron edge counts, the road gap between islands does not', () => {
  assert.equal(L.projectAt(8, S, GRID), 'ironman1');
  assert.equal(L.projectAt(8.01, S, GRID), null);
  assert.equal(L.projectAt(0, 1.5 * S, GRID), null);     // halfway between two islands
  assert.equal(L.projectAt(0, 2 * S - 8, GRID), 'ironman2');
});

test('projectAt: bad input is null, never a throw', () => {
  assert.equal(L.projectAt(NaN, 0, GRID), null);
  assert.equal(L.projectAt(0, S, null), null);
  assert.equal(L.projectAt(0, S, [{ id: 'x' }]), null);
});

// The server can only tell which island a player is on by redoing the
// client's layout math, so the constants must match the /world engine's.
// When SCALE went 18 → 24 there and not here, a player inside one island
// was put in another island's Project chat. The grid now lives in
// PG3DPhysics.WORLD_GRID; check both that this module matches it AND that
// js/playground3d.js really builds its WORLD table from it (a literal there
// would let the two drift apart again).
test('zone constants match the /world engine layout', () => {
  const G = require('../js/playground3d-physics.js').WORLD_GRID;
  assert.equal(L.C.GRID_SCALE, G.SCALE);
  assert.equal(L.C.ZONE_HALF, (G.PLATFORM_W + G.APRON_MARGIN) / 2);
  const src = fs.readFileSync(path.join(__dirname, '../js/playground3d.js'), 'utf8');
  const world = src.slice(src.indexOf('const WORLD = {'), src.indexOf('};', src.indexOf('const WORLD = {')));
  for (const key of ['SCALE', 'PLATFORM_W', 'APRON_MARGIN']) {
    assert.match(world, new RegExp(`\\b${key}:\\s*PG3DPhysics\\.WORLD_GRID\\.${key}\\b`), `WORLD.${key} must read PG3DPhysics.WORLD_GRID`);
  }
});

test('hasCooldown: only World chat is rate limited', () => {
  assert.equal(L.hasCooldown('world'), true);
  assert.equal(L.hasCooldown('project'), false);
  assert.equal(L.hasCooldown('whisper'), false);
});

test('cooldownLeft: 10s World cooldown', () => {
  assert.equal(L.C.COOLDOWN_MS, 10000);
  assert.equal(L.cooldownLeft(0, 5000), 0);
  assert.equal(L.cooldownLeft(1000, 1000), 10000);
  assert.equal(L.cooldownLeft(1000, 4000), 7000);
  assert.equal(L.cooldownLeft(1000, 11000), 0);
  assert.equal(L.cooldownLeft(1000, 99999), 0);
});

test('normalizeMessage: trims, caps at 200, defaults unknown channels to world', () => {
  assert.deepEqual(L.normalizeMessage({ text: '  hi  ' }), { ok: true, channel: 'world', text: 'hi', to: null });
  assert.equal(L.normalizeMessage({ channel: 'admin', text: 'x' }).channel, 'world');
  assert.equal(L.normalizeMessage({ channel: 'project', text: 'x' }).channel, 'project');
  assert.equal(L.normalizeMessage({ text: 'a'.repeat(500) }).text.length, 200);
  assert.deepEqual(L.normalizeMessage({ text: '   ' }), { ok: false, error: 'empty' });
  assert.deepEqual(L.normalizeMessage(null), { ok: false, error: 'empty' });
});

test('normalizeMessage: whisper needs a target', () => {
  assert.deepEqual(L.normalizeMessage({ channel: 'whisper', text: 'psst' }), { ok: false, error: 'no-target' });
  assert.deepEqual(L.normalizeMessage({ channel: 'whisper', text: 'psst', to: ' Tony ' }),
    { ok: true, channel: 'whisper', text: 'psst', to: 'Tony' });
});

test('normalizeMessage: object text / target never throws (a {toString:1} payload once crashed the server)', () => {
  assert.deepEqual(L.normalizeMessage({ text: { toString: 1 } }), { ok: false, error: 'empty' });
  assert.deepEqual(L.normalizeMessage({ text: { toString: () => 'hi' } }), { ok: false, error: 'empty' });
  assert.deepEqual(L.normalizeMessage({ channel: 'whisper', text: 'hi', to: { toString: 1 } }), { ok: false, error: 'no-target' });
  assert.deepEqual(L.normalizeMessage({ channel: { toString: 1 }, text: 'hi' }).channel, 'world');
});

test('parseWhisperCommand: /w, /whisper, /msg', () => {
  assert.deepEqual(L.parseWhisperCommand('/w Tony hello there'), { to: 'Tony', text: 'hello there' });
  assert.deepEqual(L.parseWhisperCommand('/WHISPER bob hi'), { to: 'bob', text: 'hi' });
  assert.deepEqual(L.parseWhisperCommand('/msg bob hi'), { to: 'bob', text: 'hi' });
  assert.equal(L.parseWhisperCommand('/w Tony'), null);
  assert.equal(L.parseWhisperCommand('hello /w bob hi'), null);
});

test('sameName is case-insensitive; errorText covers every rejection', () => {
  assert.ok(L.sameName('Tony', 'tony'));
  assert.ok(!L.sameName('Tony', 'Tonya'));
  assert.match(L.errorText('cooldown', { retryInMs: 6200 }), /7s/);
  assert.match(L.errorText('not-found', { to: 'bob' }), /bob/);
  for (const e of ['no-project', 'self', 'no-target', 'empty', 'not-sent', 'weird']) assert.ok(L.errorText(e).length > 0);
});

// ── islandPeers: who shares my island (voice mesh / project scope) ──

function playersMap() {
  return new Map([
    ['s1', { projectId: 'ironman1' }],
    ['s2', { projectId: 'ironman1' }],
    ['s3', { projectId: 'hulk' }],
    ['s4', { projectId: null }],
    ['s5', { projectId: 'ironman1' }]
  ]);
}

test('islandPeers: others on the same island, never self, never other islands or roads', () => {
  assert.deepEqual(L.islandPeers('s1', playersMap()).sort(), ['s2', 's5']);
  assert.deepEqual(L.islandPeers('s3', playersMap()), []);
});

test('islandPeers: off-island or unknown self is empty', () => {
  assert.deepEqual(L.islandPeers('s4', playersMap()), []);
  assert.deepEqual(L.islandPeers('nope', playersMap()), []);
  assert.deepEqual(L.islandPeers('s1', null), []);
});

test('islandPeers: members filter applies to others but not to self', () => {
  const members = new Set(['s2']);            // s1 already removed from the voice set
  assert.deepEqual(L.islandPeers('s1', playersMap(), members), ['s2']);
});

// A source check like the one above: the server's join refusals and the
// watched-list zone re-check are plumbing (no pure logic to call), and a
// renamed event on one side silently brings back the empty-world bug.
test('join refusals: server event names match the client maps; watched load re-derives the zone', () => {
  const server = fs.readFileSync(path.join(__dirname, '../routes/world-socket.js'), 'utf8');
  const client = fs.readFileSync(path.join(__dirname, '../js/home-socket.js'), 'utf8');
  for (const ev of ['world:join-refused', 'home:join-refused']) {
    assert.ok(server.includes(`'${ev}'`), `server emits ${ev}`);
    assert.ok(client.includes(`joinRefused: '${ev}'`), `client maps ${ev}`);
  }
  assert.ok(/d\.onWatched\(\)/.test(server), 'refreshWatched runs the onWatched hook');
  assert.ok(/socket\.data\.onWatched = /.test(server), 'each connection installs the hook');
  assert.ok(/applyZone\(p, nowPos\)/.test(server), 'world:pos shares the same zone helper');
});

// ── road zones: roadAt / buildRoads / zonePeers / dwell / voice cap ──

// The server's road rectangles must be the ones the client walks on, so the
// two roadView inputs this module mirrors must match the engine's WORLD
// table, and the engine must still lay roads out the way roadRects does.
test('road constants match the /world engine (ROAD_W, DOORWAY_WIDTH, rect shape)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../js/playground3d.js'), 'utf8');
  const start = src.indexOf('const WORLD = {');
  const world = src.slice(start, src.indexOf('};', start));
  const num = (key) => Number((new RegExp(`\\b${key}:\\s*([0-9.]+)`).exec(world) || [])[1]);
  assert.equal(L.C.ROAD_W, num('ROAD_W'));
  assert.equal(L.C.DOORWAY_WIDTH, num('DOORWAY_WIDTH'));
  const build = src.slice(src.indexOf('function _buildWorldRoad('), src.indexOf('function _isInWalkable('));
  assert.match(build, /RoadRouter\.toView\(road, PG3DScene\.roadView\(WORLD\)\)\.points/);
  assert.match(build, /const angle = Math\.atan2\(dx, dz\)/);
  assert.match(build, /const full = len \+ WORLD\.ROAD_W/);
  assert.match(build, /halfW,\s*\r?\n\s*halfL: full \/ 2/);
});

function roadView() {
  const G = require('../js/playground3d-physics.js').WORLD_GRID;
  return require('../js/playground3d-scene.js').roadView({
    SCALE: G.SCALE, PLATFORM_W: G.PLATFORM_W, APRON_MARGIN: G.APRON_MARGIN,
    ROAD_W: L.C.ROAD_W, DOORWAY_WIDTH: L.C.DOORWAY_WIDTH
  });
}

test('buildRoads: a straight road between two islands, walkable down its middle', () => {
  const RR = require('../js/road-router.js');
  const grid = [
    { id: 'a', gridX: 0, gridY: 0, prerequisites: [] },
    { id: 'b', gridX: 0, gridY: 2, prerequisites: ['a'] }
  ];
  const g = L.buildRoads(grid, RR, roadView());
  assert.equal(g.byKey.size, 1);
  const [key, ends] = [...g.byKey.entries()][0];
  assert.deepEqual(ends, { fromId: 'a', toId: 'b' });
  assert.ok(g.rects.length >= 1 && g.rects.every(r => r.key === key));
  // Halfway between the islands is open ground for projectAt but on the road…
  assert.equal(L.projectAt(0, S, grid), null);
  const z = g.rects.reduce((best, r) => (Math.abs(r.cz - S) < Math.abs(best.cz - S) ? r : best));
  assert.equal(L.roadAt(z.cx, S, g.rects), key);
  // …and well off to the side is not.
  assert.equal(L.roadAt(z.cx + 6, S, g.rects), null);
  assert.equal(L.buildRoads(grid, null, roadView()).rects.length, 0);
});

// Two hand-made roads: 'ns' runs north–south along x = 0, 'ew' east–west
// along z = 0; they cross at the origin.
const NS = L.roadRects('ns', [{ x: 0, y: -20 }, { x: 0, y: 20 }]);
const EW = L.roadRects('ew', [{ x: -20, y: 0 }, { x: 20, y: 0 }]);
const CROSS = [...NS, ...EW];

test('roadAt: on a straight road, the half-width edge counts, beyond does not', () => {
  const h = L.C.ROAD_W / 2;
  assert.equal(L.roadAt(0, 10, NS), 'ns');
  assert.equal(L.roadAt(h, 10, NS), 'ns');
  assert.equal(L.roadAt(h + 0.01, 10, NS), null);
  assert.equal(L.roadAt(0, 20 + h, NS), 'ns');          // ROAD_W/2 past the end, like the engine
  assert.equal(L.roadAt(0, 20 + h + 0.01, NS), null);
  assert.equal(L.roadAt(NaN, 0, NS), null);
  assert.equal(L.roadAt(0, 0, null), null);
});

test('roadAt: at a crossing the nearest centre line wins', () => {
  assert.equal(L.roadAt(0.2, 1.0, CROSS), 'ns');        // nearer x = 0
  assert.equal(L.roadAt(1.0, 0.2, CROSS), 'ew');        // nearer z = 0
  assert.equal(L.roadAt(0.5, 0.5, CROSS), 'ew');        // dead tie → lowest key
});

test('roadAt: hysteresis keeps the previous road while still inside it', () => {
  assert.equal(L.roadAt(1.0, 0.2, CROSS, 'ns'), 'ns');  // still inside ns: stay
  assert.equal(L.roadAt(3.0, 0.2, CROSS, 'ns'), 'ew');  // left ns: switch
  assert.equal(L.roadAt(1.0, 0.2, CROSS, 'gone'), 'ew');
});

test('roadLabel: "Road: A → B" from titles, ids as the fallback', () => {
  const titles = { ironman1: 'Iron Man', ironman2: 'Iron Man 2' };
  assert.equal(L.roadLabel({ fromId: 'ironman1', toId: 'ironman2' }, id => titles[id]), 'Road: Iron Man → Iron Man 2');
  assert.equal(L.roadLabel({ fromId: 'x', toId: 'y' }), 'Road: x → y');
  assert.equal(L.roadLabel(null), '');
});

test('zoneKey / zonePeers: islands and road segments are zones; open ground is not', () => {
  assert.equal(L.zoneKey({ projectId: 'hulk', roadKey: 'a__b' }), 'p:hulk');
  assert.equal(L.zoneKey({ projectId: null, roadKey: 'a__b' }), 'r:a__b');
  assert.equal(L.zoneKey({ projectId: null, roadKey: null }), null);
  const players = new Map([
    ['r1', { projectId: null, roadKey: 'a__b' }],
    ['r2', { projectId: null, roadKey: 'a__b' }],
    ['r3', { projectId: null, roadKey: 'b__c' }],   // a different road
    ['i1', { projectId: 'a', roadKey: null }],
    ['g1', { projectId: null, roadKey: null }],     // open ground
    ['g2', { projectId: null, roadKey: null }]
  ]);
  assert.deepEqual(L.zonePeers('r1', players), ['r2']);
  assert.deepEqual(L.zonePeers('r3', players), []);
  assert.deepEqual(L.zonePeers('i1', players), []);
  assert.deepEqual(L.zonePeers('g1', players), []);
  assert.deepEqual(L.zonePeers('r1', players, new Set(['r3'])), []);
  assert.equal(L.islandPeers, L.zonePeers);
});

test('dwellStep: a new zone lands only after ZONE_DWELL_MS without a break', () => {
  const D = L.C.ZONE_DWELL_MS;
  let st = { zone: 'r:a__b' };
  st = L.dwellStep(st, 'p:a', 1000);
  assert.equal(st.changed, false); assert.equal(st.zone, 'r:a__b'); assert.equal(st.waitMs, D);
  st = L.dwellStep(st, 'p:a', 1000 + D - 1);
  assert.equal(st.changed, false); assert.equal(st.waitMs, 1);
  st = L.dwellStep(st, 'p:a', 1000 + D);
  assert.equal(st.changed, true); assert.equal(st.zone, 'p:a');
  // A doorway blip (back to the old zone before the dwell) changes nothing
  // and clears the pending change.
  st = L.dwellStep(st, 'r:a__b', 5000);
  st = L.dwellStep(st, 'p:a', 5400);
  assert.equal(st.changed, false); assert.equal(st.zone, 'p:a'); assert.equal(st.pending, undefined);
  st = L.dwellStep(st, 'r:a__b', 6000);
  st = L.dwellStep(st, 'r:b__c', 6000 + D);             // a different candidate restarts the clock
  assert.equal(st.changed, false); assert.equal(st.since, 6000 + D);
  assert.equal(L.dwellStep({ zone: null }, 'p:a', 0, 0).changed, true);
  assert.equal(L.dwellStep(undefined, null, 0).changed, false);
});

test('selectVoiceLinks: nearest first, nobody over the cap, links symmetric', () => {
  const entries = [];
  for (let i = 0; i < 12; i++) entries.push({ id: 'v' + String(i).padStart(2, '0'), zone: 'r:a__b', x: i * 2, z: 0 });
  const out = L.selectVoiceLinks(entries, 8);
  for (const [id, set] of out) {
    assert.ok(set.size <= 8, `${id} has ${set.size}`);
    for (const o of set) assert.ok(out.get(o).has(id), 'symmetric');
  }
  // The middle player's peers are all within 4 slots either side.
  const mid = [...out.get('v05')].sort();
  assert.ok(mid.length > 0 && mid.every(id => Math.abs(Number(id.slice(1)) - 5) <= 4), mid.join(','));
  // Below the cap it is the full zone mesh.
  const small = L.selectVoiceLinks(entries.slice(0, 4), 8);
  assert.deepEqual([...small.get('v00')].sort(), ['v01', 'v02', 'v03']);
  assert.equal(L.C.VOICE_CAP, 8);
});

test('selectVoiceLinks: different zones (or no zone) never link', () => {
  const out = L.selectVoiceLinks([
    { id: 'a', zone: 'r:a__b', x: 0, z: 0 },
    { id: 'b', zone: 'r:b__c', x: 1, z: 0 },   // a different road, right next to a
    { id: 'c', zone: 'r:a__b', x: 30, z: 0 },
    { id: 'd', zone: null, x: 0, z: 1 }
  ]);
  assert.deepEqual([...out.get('a')], ['c']);
  assert.equal(out.get('b').size, 0);
  assert.equal(out.get('d').size, 0);
});

test('selectVoiceLinks: an existing link survives a near-tie (no flapping)', () => {
  // x has room for one peer; y is a hair nearer than the linked z.
  const entries = [
    { id: 'x', zone: 'p:a', x: 0, z: 0 },
    { id: 'y', zone: 'p:a', x: 5, z: 0 },
    { id: 'z', zone: 'p:a', x: -5.1, z: 0 }
  ];
  assert.deepEqual([...L.selectVoiceLinks(entries, 1).get('x')], ['y']);
  const current = new Map([['x', new Set(['z'])], ['z', new Set(['x'])]]);
  assert.deepEqual([...L.selectVoiceLinks(entries, 1, current).get('x')], ['z']);
});

test('server: road zones feed world:zone, Project chat and the capped voice mesh', () => {
  const server = fs.readFileSync(path.join(__dirname, '../routes/world-socket.js'), 'utf8');
  assert.match(server, /select\('id title gridX gridY prerequisites'\)/);
  assert.match(server, /socket\.emit\('world:zone', \{ projectId: island, roadKey: road, label: zoneLabel\(island, road\) \}\)/);
  assert.match(server, /ChatLogic\.dwellStep\(/);
  assert.match(server, /ChatLogic\.selectVoiceLinks\(entries, ChatLogic\.C\.VOICE_CAP, voiceLinks\)/);
  assert.match(server, /const zone = ChatLogic\.zoneKey\(p\);\s*\n\s*if \(!zone\) return reply\(\{ ok: false, error: 'no-project' \}\)/);
  assert.match(server, /watched\.has\(road\.fromId\) && watched\.has\(road\.toId\)/);
});
