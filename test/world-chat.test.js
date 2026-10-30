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
const vm = require('node:vm');
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

// ── road zones: roadAt / buildRoads / zoneKey / dwell / voice cap ──

// The server's road rectangles must be the ones the client walks on (TOOL2-04:
// this used to be a regex over the engine's source). The engine's own WORLD
// table and _buildWorldRoad are lifted from js/playground3d.js and RUN with a
// stub THREE over every bundled road; what they lay out (walkable rects and
// road meshes) must equal what buildRoads gives the server, value for value.
const ENGINE = fs.readFileSync(path.join(__dirname, '../js/playground3d.js'), 'utf8');
function liftEngine(re, what) {
  const m = ENGINE.match(re);
  assert.ok(m, what + ' not found in js/playground3d.js');
  return m[0];
}
function engineRoads(projects) {
  const RR = require('../js/road-router.js');
  globalThis.RoadRouter = RR;   // PG3DScene.roadRoutes reads it as a global (as in the browser)
  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry; this.material = material;
      this.position = { set: (x, y, z) => { Object.assign(this.position, { x, y, z }); } };
      this.rotation = { y: 0 };
    }
  }
  const THREE = {
    Mesh,
    MeshLambertMaterial: class { constructor(o) { this.opts = o; } },
    BoxGeometry: class { constructor(w, h, d) { this.parameters = { width: w, height: h, depth: d }; } }
  };
  const ctx = {
    window: { THREE }, Math, Map,
    PG3DPhysics: require('../js/playground3d-physics.js'),
    PG3DScene: require('../js/playground3d-scene.js'),
    WorldChatLogic: L,
    RoadRouter: RR,
    projects
  };
  vm.runInNewContext(
    'let _walkableRoads = []; const _worldRoads = new Map(); const _worldNodes = new Map();\n' +
    'const _scene = { add() {} };\n' +
    liftEngine(/\n  const WORLD = \{[\s\S]*?\n  \};\n/, 'WORLD') +
    liftEngine(/\n  function _buildWorldRoad\([\s\S]*?\n  \}\n/, '_buildWorldRoad') +
    '\nfor (const p of projects) _worldNodes.set(p.id, {});' +
    '\nthis.WORLD = WORLD; this.build = _buildWorldRoad; this.walkable = () => _walkableRoads; this.meshes = _worldRoads;',
    ctx);
  return ctx;
}
function bundledProjects() {
  const ctx = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../projects.js'), 'utf8') + '\nthis.P = projects;', ctx);
  return ctx.P;
}

test('road constants match the /world engine WORLD table (ROAD_W, DOORWAY_WIDTH)', () => {
  const { WORLD } = engineRoads([]);
  assert.equal(L.C.ROAD_W, WORLD.ROAD_W);
  assert.equal(L.C.DOORWAY_WIDTH, WORLD.DOORWAY_WIDTH);
});

test('the engine\'s _buildWorldRoad lays out exactly the server\'s road rectangles, for every bundled road', () => {
  const RR = require('../js/road-router.js');
  const projects = bundledProjects();
  const server = L.buildRoads(projects, RR, roadView());
  assert.ok(server.byKey.size > 10, 'bundled roads found: ' + server.byKey.size);
  const eng = engineRoads(projects);
  let checked = 0;
  for (const [key, ends] of server.byKey) {
    const before = eng.walkable().length;
    eng.build(ends.fromId, ends.toId);
    const got = eng.walkable().slice(before);
    const want = server.rects.filter(r => r.key === key);
    assert.ok(want.length >= 1, key);
    assert.equal(got.length, want.length, key + ': one rectangle per leg');
    const meshes = eng.meshes.get(ends.fromId < ends.toId ? `${ends.fromId}→${ends.toId}` : `${ends.toId}→${ends.fromId}`);
    assert.equal(meshes.length, want.length, key + ': one mesh per leg');
    got.forEach((r, i) => {
      const w = want[i];
      assert.deepEqual(
        { a: r.a, b: r.b, cx: r.cx, cz: r.cz, cosA: r.cosA, sinA: r.sinA, halfW: r.halfW, halfL: r.halfL },
        { a: ends.fromId, b: ends.toId, cx: w.cx, cz: w.cz, cosA: w.cosA, sinA: w.sinA, halfW: w.halfW, halfL: w.halfL },
        key + ' leg ' + i);
      const m = meshes[i];
      assert.deepEqual([m.position.x, m.position.z], [w.cx, w.cz], key + ' mesh ' + i + ' centre');
      assert.equal(m.geometry.parameters.width, eng.WORLD.ROAD_W);
      assert.equal(m.geometry.parameters.depth, 2 * w.halfL, key + ' mesh ' + i + ' length');
      assert.equal(Math.cos(m.rotation.y), w.cosA);
      assert.equal(Math.sin(m.rotation.y), w.sinA);
      checked++;
    });
  }
  assert.equal(eng.walkable().length, server.rects.length, 'no extra engine rectangles');
  assert.ok(checked >= server.byKey.size);
});

// The formula _buildWorldRoad used inline before it called roadRects
// (TOOL2-04), kept here so the move is provably value-for-value.
function inlineRoadLegs(pts, roadW) {
  const out = [];
  const halfW = roadW / 2;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1].x, az = pts[i - 1].y, bx = pts[i].x, bz = pts[i].y;
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const angle = Math.atan2(dx, dz);
    const full = len + roadW;
    out.push({ angle, full, cx: (ax + bx) / 2, cz: (az + bz) / 2, cosA: Math.cos(angle), sinA: Math.sin(angle), halfW, halfL: full / 2 });
  }
  return out;
}

test('roadRects matches the engine\'s old inline road formula leg for leg', () => {
  const pts = [
    { x: 0, y: 8 }, { x: 0, y: 40 },          // straight south
    { x: 0, y: 40.005 },                        // a sub-0.01 stub: skipped
    { x: 13.1, y: 40.005 },                     // east
    { x: -7.3, y: 22.9 },                       // diagonal back north-west
    { x: -7.3, y: -16.25 }                      // north
  ];
  for (const w of [2.5, 3.1]) {
    const old = inlineRoadLegs(pts, w);
    const now = L.roadRects('k', pts, w);
    assert.equal(now.length, old.length);
    assert.equal(now.length, 4);
    now.forEach((r, i) => {
      const o = old[i];
      assert.deepEqual(
        { cx: r.cx, cz: r.cz, cosA: r.cosA, sinA: r.sinA, halfW: r.halfW, halfL: r.halfL, angle: r.angle, depth: 2 * r.halfL },
        { cx: o.cx, cz: o.cz, cosA: o.cosA, sinA: o.sinA, halfW: o.halfW, halfL: o.halfL, angle: o.angle, depth: o.full });
    });
  }
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

test('zoneKey: islands and road segments are zones; open ground is not', () => {
  assert.equal(L.zoneKey({ projectId: 'hulk', roadKey: 'a__b' }), 'p:hulk');
  assert.equal(L.zoneKey({ projectId: null, roadKey: 'a__b' }), 'r:a__b');
  assert.equal(L.zoneKey({ projectId: null, roadKey: null }), null);
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

// Map id → Set from [[a, b], …] pairs, both directions (selectVoiceLinks' shape).
function links(pairs) {
  const m = new Map();
  const add = (a, b) => { if (!m.has(a)) m.set(a, new Set()); m.get(a).add(b); };
  for (const [a, b] of pairs) { add(a, b); add(b, a); }
  return m;
}
const deltas = (oldL, want, ann) => L.voiceDeltas(oldL, want, ann).map(e => `${e.event.slice(6)} ${e.to}<-${e.id}`);

test('voiceDeltas: every peer-left goes out before any peer-joined, to both ends', () => {
  // a–b stays, a–c drops, b–d is new, c–d is new.
  const out = deltas(links([['a', 'b'], ['a', 'c']]), links([['a', 'b'], ['b', 'd'], ['c', 'd']]));
  assert.deepEqual(out, [
    'peer-left a<-c', 'peer-left c<-a',
    'peer-joined b<-d', 'peer-joined d<-b',
    'peer-joined c<-d', 'peer-joined d<-c'
  ]);
  const firstJoin = out.findIndex(s => s.startsWith('peer-joined'));
  assert.ok(out.slice(firstJoin).every(s => s.startsWith('peer-joined')), 'no peer-left after a peer-joined');
});

test('voiceDeltas: the announcer gets no peer-joined (its voice:peers reply covers it); its new peers do', () => {
  const out = deltas(links([['b', 'c']]), links([['a', 'b'], ['a', 'c'], ['b', 'c']]), 'a');
  assert.deepEqual(out, ['peer-joined b<-a', 'peer-joined c<-a']);
  // A dropped link of the announcer still gets peer-left both ways.
  assert.deepEqual(deltas(links([['a', 'b']]), links([]), 'a'), ['peer-left a<-b', 'peer-left b<-a']);
});

test('voiceDeltas: no change is no events; each pair is sent once; empty / missing maps are fine', () => {
  const same = links([['a', 'b'], ['b', 'c']]);
  assert.deepEqual(L.voiceDeltas(same, links([['a', 'b'], ['b', 'c']])), []);
  assert.deepEqual(deltas(new Map(), links([['x', 'y']])), ['peer-joined x<-y', 'peer-joined y<-x']);
  assert.deepEqual(deltas(links([['x', 'y']]), new Map()), ['peer-left x<-y', 'peer-left y<-x']);
  assert.deepEqual(L.voiceDeltas(null, null), []);
  // A whole selectVoiceLinks round trip: moving one player to another zone
  // drops exactly their links.
  const e = [{ id: 'a', zone: 'p:x', x: 0, z: 0 }, { id: 'b', zone: 'p:x', x: 1, z: 0 }, { id: 'c', zone: 'p:x', x: 2, z: 0 }];
  const before = L.selectVoiceLinks(e);
  const after = L.selectVoiceLinks([e[0], e[1], { ...e[2], zone: 'r:x__y' }], 8, before);
  assert.deepEqual(deltas(before, after), ['peer-left a<-c', 'peer-left c<-a', 'peer-left b<-c', 'peer-left c<-b']);
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
