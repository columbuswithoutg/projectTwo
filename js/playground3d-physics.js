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

  // (The daily seeded stone-placement helpers — hashString/mulberry32/
  // pickStoneSpots — were removed with the batch-5 shift to a shared,
  // server-authoritative Infinity Stone contest. Stone positions are now
  // fixed ring slots computed in playground3d.js; ownership lives on the
  // server. See routes/world-socket.js.)

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

  // ── Spawn islands ──
  // Group the currently-unlocked projects into connected "islands" so the
  // /world spawn picker can offer one card per island. Two nodes are
  // connected when one is a prerequisite of the other and BOTH are unlocked
  // (the same rule that builds roads/doorways in the engine). Edges are
  // treated as undirected; components are found with union-find.
  //
  //   projects:   the global project list (each {id, prerequisites, title, image, phase}).
  //   isUnlocked: predicate mirroring _isProjectUnlocked (watched OR no prereqs).
  //
  // Returns [{ anchor, nodes }] — `nodes` are the island's unlocked members in
  // `projects` array order (release order); `anchor` is the first of them (the
  // natural root, e.g. Iron Man / Guardians / Doctor Strange). Islands are
  // ordered by their anchor's position in `projects`.
  function spawnIslands(projects, isUnlocked) {
    const unlocked = [];
    const index = new Map();               // id → position in `unlocked`
    for (const p of projects) {
      if (!isUnlocked(p)) continue;
      index.set(p.id, unlocked.length);
      unlocked.push(p);
    }

    // Union-find over the unlocked set.
    const parent = unlocked.map((_, i) => i);
    function find(a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
    function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }

    for (let i = 0; i < unlocked.length; i++) {
      const prereqs = Array.isArray(unlocked[i].prerequisites) ? unlocked[i].prerequisites : [];
      for (const preId of prereqs) {
        if (index.has(preId)) union(i, index.get(preId));   // both unlocked → connected
      }
    }

    // Bucket by root, preserving array order within and across islands.
    const byRoot = new Map();
    for (let i = 0; i < unlocked.length; i++) {
      const r = find(i);
      if (!byRoot.has(r)) byRoot.set(r, []);
      const p = unlocked[i];
      byRoot.get(r).push({ id: p.id, title: p.title, image: p.image, phase: p.phase });
    }

    const islands = [];
    for (const nodes of byRoot.values()) islands.push({ anchor: nodes[0], nodes });
    return islands;
  }

  return {
    isWalkable, stepVertical, shouldRespawn, airtime, airCarry, pickPunchTarget,
    spawnIslands
  };
});
