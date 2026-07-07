/************************************************
 * PLAYGROUND3D PHYSICS — pure, dependency-free helpers
 *
 * The math the 3D engine's jump / fall / walkability logic runs on,
 * extracted so it can be unit-tested with `node --test` (the engine
 * itself needs THREE + a DOM). playground3d.js calls these from _tick;
 * test/physics.test.js exercises them directly.
 *
 * UMD-ish: attaches to window.PG3DPhysics in the browser, exports via
 * module.exports under Node.
 ************************************************/
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PG3DPhysics = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // Point-in-walkable test — same math as the engine's _isInWalkable.
  // nodes: [{x, z}] platform centers, each an axis-aligned square of
  //        half-extent `halfA` (platform + apron).
  // roads: [{cx, cz, cosA, sinA, halfW, halfL}] rotated rectangles.
  function isWalkable(x, z, nodes, halfA, roads) {
    for (const n of nodes) {
      if (Math.abs(x - n.x) <= halfA && Math.abs(z - n.z) <= halfA) return true;
    }
    for (const r of roads) {
      const dx = x - r.cx;
      const dz = z - r.cz;
      const lx = dx * r.cosA - dz * r.sinA;
      const lz = dx * r.sinA + dz * r.cosA;
      if (Math.abs(lx) <= r.halfW && Math.abs(lz) <= r.halfL) return true;
    }
    return false;
  }

  // One frame of vertical jump/fall integration.
  // ceilingCap: max feet-Y before the head hits a roof, or null outdoors.
  // Returns { y, velY, landed, bonked }. `landed` means y crossed <= 0 this
  // frame — the CALLER decides whether that's a landing (walkable ground)
  // or the start of a fall (keep integrating below 0).
  function stepVertical(y, velY, dt, gravity, ceilingCap) {
    let bonked = false;
    velY -= gravity * dt;
    y += velY * dt;
    if (ceilingCap != null && y > ceilingCap) {
      y = ceilingCap;
      if (velY > 0) { velY = 0; bonked = true; }
    }
    return { y, velY, landed: y <= 0, bonked };
  }

  // Whether a fall in progress should give up and respawn this frame.
  // opts: { RESPAWN_DELAY_MS, RESPAWN_DEPTH }
  function shouldRespawn(now, fallStart, y, opts) {
    return (now - fallStart) >= opts.RESPAWN_DELAY_MS || y <= opts.RESPAWN_DEPTH;
  }

  // Total airtime of a jump from flat ground (symmetric arc).
  function airtime(initialV, gravity) {
    return (2 * initialV) / gravity;
  }

  // Horizontal distance covered over a full jump arc at max stick.
  function airCarry(speed, airSpeedMul, initialV, gravity) {
    return speed * airSpeedMul * airtime(initialV, gravity);
  }

  // ── Daily Infinity Stone placement ──

  // Deterministic 32-bit string hash (FNV-1a-ish) for date/id seeds.
  function hashString(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  // mulberry32 — tiny seeded PRNG, returns () => [0,1).
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const STONES = [
    { id: 'space',   color: 0x3a85f0 },
    { id: 'mind',    color: 0xf5d020 },
    { id: 'reality', color: 0xed1d24 },
    { id: 'power',   color: 0x9b59b6 },
    { id: 'time',    color: 0x39b54a },
    { id: 'soul',    color: 0xff8020 }
  ];

  // Pick today's stone spots. Deterministic for a given (seed, node set):
  // every player with the same unlocked islands sees the same spots.
  //   nodes: [{x, z}] platform centers · halfA: platform+apron half-extent
  //   roads: rotated rects (see isWalkable) · seed: hashString(dateStr + ids)
  // Returns [{ id, color, x, z, y }] — y is 0 (ground, walk over) or
  // elevated (~1.1, must JUMP to touch: pickup tests 3D distance).
  function pickStoneSpots({ nodes, roads, halfA, seed, count }) {
    if (!nodes.length) return [];
    const n = count != null ? count
      : (nodes.length < 3 ? Math.min(STONES.length, nodes.length * 2) : STONES.length);
    const rand = mulberry32(seed);
    const spots = [];
    const MIN_SEP = 4;                 // stones never bunch up
    let guard = 0;
    while (spots.length < n && guard++ < 400) {
      const node = nodes[Math.floor(rand() * nodes.length)];
      // Random point on the node's walkable square (biased off-center so
      // stones sit on aprons/edges rather than in doorway traffic).
      const x = node.x + (rand() * 2 - 1) * (halfA - 0.8);
      const z = node.z + (rand() * 2 - 1) * (halfA - 0.8);
      if (!isWalkable(x, z, nodes, halfA, roads)) continue;
      if (spots.some(s => Math.hypot(s.x - x, s.z - z) < MIN_SEP)) continue;
      const stone = STONES[spots.length];
      // Roughly a third float at jump height — you have to leap for them.
      const elevated = rand() < 0.34;
      spots.push({ id: stone.id, color: stone.color, x, z, y: elevated ? 1.1 : 0 });
    }
    return spots;
  }

  // ── Punch target selection ──
  // actors: [{ id, x, z, y }] (y optional, defaults 0). Returns the id of
  // the nearest actor within radial `range` of (px,pz) and within 1.5u
  // vertically of py, or null. Radial (no facing check) — forgiving arcade
  // feel; the punch animation sells the direction.
  function pickPunchTarget(px, pz, py, actors, range) {
    let best = null;
    let bestD2 = range * range;
    for (const a of actors) {
      if (Math.abs((a.y || 0) - py) > 1.5) continue;
      const dx = a.x - px;
      const dz = a.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 <= bestD2) { best = a.id; bestD2 = d2; }
    }
    return best;
  }

  return {
    isWalkable, stepVertical, shouldRespawn, airtime, airCarry,
    hashString, mulberry32, STONES, pickStoneSpots, pickPunchTarget
  };
});
