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

  // ── Punch cooldown ──
  // Floor between one player's punches. The server enforces the same value
  // (less a little network slack) in routes/world-socket.js, so a modified
  // client can't spam hits either.
  const PUNCH_COOLDOWN_MS = 1000;

  // lastAt: when the last punch landed (0/null = never).
  // → { ready, remainingMs, frac } where frac runs 1 (just punched) → 0 (ready).
  function punchCooldown(now, lastAt, cooldownMs) {
    const cd = cooldownMs == null ? PUNCH_COOLDOWN_MS : cooldownMs;
    if (!lastAt || cd <= 0) return { ready: true, remainingMs: 0, frac: 0 };
    const remainingMs = Math.max(0, Math.min(cd, cd - (now - lastAt)));
    return { ready: remainingMs === 0, remainingMs, frac: remainingMs / cd };
  }

  // ── Actor footprint ──
  // Collision radius for a character whose silhouette is `widthFactor` × a
  // Normal body's width (PG3DHumanoidLogic.bodyShapeFor().widthFactor). Grows
  // with the square root so a Hulk-type body doesn't clip walls/other players
  // without becoming too wide for doorways; never shrinks below the base, and
  // capped at 1.8× the base.
  function actorRadius(baseRadius, widthFactor) {
    const f = Number.isFinite(widthFactor) ? Math.max(1, widthFactor) : 1;
    return Math.min(baseRadius * Math.sqrt(f), baseRadius * 1.8);
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

  // ── Roaming NPC patrol ────────────────────────────────────────────────
  // /world's Avenger wanderers are simulated on every client independently —
  // there is no server broadcast for them. So their motion has to be a PURE
  // function of a shared clock: no randomness, no accumulated state, no
  // frame-rate dependence. Two browsers that agree on the time then draw the
  // same hero in the same spot. (They used to random-walk from a local
  // performance.now(), which is why no two users ever saw them alike.)

  // Deterministic [0, 1) from a string — FNV-1a. The seed behind every
  // per-hero patrol constant, so a rebuild or another user's browser
  // reproduces the same patrol exactly.
  function hash01(s) {
    let h = 2166136261;
    for (let i = 0; i < String(s).length; i++) {
      h ^= String(s).charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 100000) / 100000;
  }

  // Build the fixed patrol parameters for one hero from its id alone.
  // ring: Chebyshev half-extent of the square loop; speed: base units/sec.
  function npcPatrol(id, ring, speed) {
    return {
      phase0: hash01(id) * ring * 8,                 // where on the lap it starts
      dir: hash01(id + 'd') < 0.5 ? 1 : -1,          // which way round
      speed: speed * (0.85 + hash01(id + 's') * 0.3),
      moveSecs: 9 + hash01(id + 'm') * 6,            // stroll for 9-15s...
      pauseSecs: 2 + hash01(id + 'p') * 2            // ...then stand for 2-4s
    };
  }

  // Where a hero is at shared-clock time `t` (seconds), walking the perimeter
  // of an axis-aligned square of half-extent `ring` centred on (homeX, homeZ).
  // Distance only accumulates during the moving part of each cycle, so a pause
  // holds them still rather than teleporting them forward when it ends.
  // Returns { x, z, yaw, walking }; yaw matches the engine's atan2(dx, dz).
  function npcPathPoint(patrol, homeX, homeZ, ring, t) {
    const cycle = patrol.moveSecs + patrol.pauseSecs;
    const laps = Math.floor(t / cycle);
    const rem = t - laps * cycle;
    const walking = rem < patrol.moveSecs;
    const travelled = (laps * patrol.moveSecs + Math.min(rem, patrol.moveSecs)) * patrol.speed;

    const perimeter = ring * 8;
    const side = ring * 2;
    let s = (patrol.phase0 + patrol.dir * travelled) % perimeter;
    if (s < 0) s += perimeter;                        // positive modulo: dir -1 runs backwards

    const seg = Math.floor(s / side) % 4;
    const u = s - seg * side;
    let x, z, dx, dz;
    switch (seg) {
      case 0: x =  ring;     z = -ring + u; dx =  0; dz =  1; break;   // east side,  heading +Z
      case 1: x =  ring - u; z =  ring;     dx = -1; dz =  0; break;   // north side, heading -X
      case 2: x = -ring;     z =  ring - u; dx =  0; dz = -1; break;   // west side,  heading -Z
      default: x = -ring + u; z = -ring;    dx =  1; dz =  0; break;   // south side, heading +X
    }
    if (patrol.dir < 0) { dx = -dx; dz = -dz; }
    return { x: homeX + x, z: homeZ + z, yaw: Math.atan2(dx, dz), walking };
  }

  // Two-finger pinch → camera distance. Fingers spreading apart (newGap >
  // prevGap) zooms IN, like every map app; the result is clamped to the same
  // [min, max] the mouse wheel uses. Degenerate gaps leave distance unchanged.
  function pinchZoom(distance, prevGap, newGap, min, max) {
    if (!(prevGap > 0) || !(newGap > 0) || !Number.isFinite(distance)) return distance;
    return Math.max(min, Math.min(max, distance * (prevGap / newGap)));
  }

  // Vertical field of view for a viewport aspect (w/h). Three.js fov is
  // vertical, so a fixed 60° gives ~100° side-to-side in phone landscape but
  // only ~30° in portrait (tunnel vision). Landscape keeps `base`; portrait
  // opens up so the horizontal FOV holds, capped at `maxV` before fish-eye.
  function fovForAspect(aspect, base, maxV) {
    base = base === undefined ? 60 : base;
    maxV = maxV === undefined ? 80 : maxV;
    if (!Number.isFinite(aspect) || aspect <= 0 || aspect >= 1) return base;
    const halfH = Math.tan((base / 2) * Math.PI / 180);
    const v = 2 * Math.atan(halfH / aspect) * 180 / Math.PI;
    return Math.max(base, Math.min(maxV, v));
  }

  return {
    isWalkable, stepVertical, shouldRespawn, airtime, airCarry, pickPunchTarget,
    actorRadius, spawnIslands, PUNCH_COOLDOWN_MS, punchCooldown, hash01, npcPatrol, npcPathPoint,
    pinchZoom, fovForAspect
  };
});
