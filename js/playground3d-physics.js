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

  // ── Shared tuning ──
  // playground3d.js builds its PHYSICS / JUMP / FALL / WORLD tables from
  // these, and test/physics.test.js imports them. They used to be literals in
  // the engine that the tests copied by hand — so when 1cdaeae moved islands
  // from SCALE 18 to 24 the tests kept passing against a layout (2u gaps)
  // that no longer existed.
  const MOVE = Object.freeze({
    SPEED: 4.0,                   // world units per second at full stick
    // Exponential turn rate (1/s) for turnToward. 13.4 reproduces the old
    // linear `min(1, 12 * dt)` lerp at 60 fps (1 - e^(-13.4/60) ≈ 0.20 of
    // the remaining angle per frame) — but now a 30 fps phone and a 144 Hz
    // monitor turn at the same speed, which the linear lerp didn't.
    TURN_RATE: 13.4,
    PLAYER_RADIUS: 0.45,          // half-extent of the player's collision square
    BACKPEDAL_MUL: 0.6            // speed multiplier while stepping backwards
  });

  // Arcade hop: apex ≈ 1.28u, ≈ 0.68 s in the air.
  const JUMP = Object.freeze({ GRAVITY: 22, INITIAL_V: 7.5 });

  // Fall / respawn. AIR_SPEED_MUL is in-air feel only: a running jump carries
  // SPEED × 1.25 × 0.68 s ≈ 3.4u, which matters for hopping onto props and
  // over road corners. It no longer crosses anything between islands — at
  // SCALE 24 neighbouring aprons are 8u apart (test/physics.test.js asserts
  // that gap is NOT clearable); islands connect by roads only.
  const FALL = Object.freeze({
    AIR_SPEED_MUL: 1.25,
    RESPAWN_DEPTH: -8,            // give up and respawn below this y
    RESPAWN_DELAY_MS: 1000,
    BROADCAST_Y_FLOOR: -2         // mirror the server's y clamp in getLocalState
  });

  // /world island grid. Neighbouring island centres are SCALE apart; each is
  // a PLATFORM_W square room inside a walkable apron APRON_MARGIN wider, so
  // the open ground between two neighbours' aprons is
  // SCALE - (PLATFORM_W + APRON_MARGIN) = 8u — room for 2–3 road lanes.
  const WORLD_GRID = Object.freeze({ SCALE: 24, PLATFORM_W: 12, APRON_MARGIN: 4 });

  // Point-in-walkable test — the engine's _isInWalkable calls this.
  // nodes: iterable of {x, z} platform centers, each an axis-aligned square
  //        of half-extent `halfA` (platform + apron). An iterable (the
  //        engine passes its node Map's values()) so no array is built.
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

  // ── Standable props ──
  // Collision boxes may carry a `top` (a crate, table, chair, bookshelf, bed):
  // from the side they block like a wall, but a player whose feet are at or
  // near the top stands on them. A box without `top` blocks at any height.
  const STEP = 0.25;   // a lip this small is stepped up, not bumped into

  // Highest standable surface under the player square [x±r, z±r], else 0.
  function groundAt(x, z, r, boxes) {
    let g = 0;
    for (const b of boxes || []) {
      if (b.top == null) continue;
      if (x + r <= b.minX || x - r >= b.maxX || z + r <= b.minZ || z - r >= b.maxZ) continue;
      if (b.top > g) g = b.top;
    }
    return g;
  }

  // Does this box stop horizontal movement for feet at `feetY`?
  function blocksAt(box, feetY, step) {
    if (box.top == null) return true;
    return feetY < box.top - (step == null ? STEP : step);
  }

  // One frame of vertical jump/fall integration.
  // ceilingCap: max feet-Y before the head hits a roof, or null outdoors.
  // floorY: the surface under the player (0 = the ground; a prop's top when
  // standing on one). The cap never clamps below the floor — a low lintel
  // must not push a player standing on a crate down into it.
  // Returns { y, velY, landed, bonked }. `landed` means y crossed <= floorY
  // this frame — the CALLER decides whether that's a landing (walkable
  // ground) or the start of a fall (keep integrating below it).
  function stepVertical(y, velY, dt, gravity, ceilingCap, floorY) {
    const floor = floorY || 0;
    let bonked = false;
    velY -= gravity * dt;
    y += velY * dt;
    if (ceilingCap != null) {
      const cap = Math.max(ceilingCap, floor);
      if (y > cap) {
        y = cap;
        if (velY > 0) { velY = 0; bonked = true; }
      }
    }
    return { y, velY, landed: y <= floor, bonked };
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

  // Does the segment (x0,z0)→(x1,z1) pass through a full-height wall? Boxes
  // with a `top` are standable props (low enough to reach over), and `skip`
  // is the prop being reached for — neither counts. Slab test on XZ.
  function wallBetween(x0, z0, x1, z1, boxes, skip) {
    const dx = x1 - x0, dz = z1 - z0;
    for (const b of boxes || []) {
      if (!b || b === skip || b.top != null) continue;
      let t0 = 0, t1 = 1;
      let ok = true;
      for (const [o, d, lo, hi] of [[x0, dx, b.minX, b.maxX], [z0, dz, b.minZ, b.maxZ]]) {
        if (Math.abs(d) < 1e-9) { if (o <= lo || o >= hi) { ok = false; break; } continue; }
        let a = (lo - o) / d, c = (hi - o) / d;
        if (a > c) { const s = a; a = c; c = s; }
        t0 = Math.max(t0, a); t1 = Math.min(t1, c);
        if (t0 >= t1) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  }

  // ── Angles ──
  // Every yaw / camera azimuth goes through these. They are modulo-based on
  // purpose: the old `while (d > π) d -= 2π` loops never terminate once 2π is
  // below the float spacing of the input (yaw = 1e300 froze every client in
  // /world — the server relayed it verbatim).
  const TAU = Math.PI * 2;

  // Any number → the equivalent angle in (-π, π]. Non-finite → 0.
  function wrapAngle(a) {
    if (typeof a !== 'number' || !Number.isFinite(a)) return 0;
    let r = a % TAU;                    // (-2π, 2π)
    if (r > Math.PI) r -= TAU;
    else if (r <= -Math.PI) r += TAU;
    return r;
  }

  // Move `a` toward `b` by fraction t along the shorter arc; result wrapped.
  function lerpAngle(a, b, t) {
    const from = wrapAngle(a);
    if (typeof b !== 'number' || !Number.isFinite(b)) return from;
    return wrapAngle(from + wrapAngle(b - from) * t);
  }

  // Frame-rate independent turn toward `target` at `rate` (1/s). Exponential
  // approach, so it never overshoots and a 30 fps phone turns like 144 Hz.
  function turnToward(yaw, target, dt, rate) {
    const k = 1 - Math.exp(-Math.max(0, rate || 0) * Math.max(0, dt || 0));
    return lerpAngle(yaw, target, k);
  }

  // ── Horizontal movement ──
  // One axis step of the local player against collision boxes, other actors
  // and (in /world) the walkable region. The engine calls it twice a frame —
  // X then Z — so resolving only the moving axis is what makes the player
  // slide along a wall instead of sticking to it.
  //   out:        scratch {x, z} the result is written into (and returned) —
  //               no allocation, this runs twice per frame
  //   x0, z0:     where the step starts; feetY: feet height (a prop with a
  //               `top` stops blocking once the feet are near it — blocksAt)
  //   dx, dz:     the step (one of them 0 in practice)
  //   r:          player half-extent; the footprint is the square ±r
  //   boxes:      [{minX, maxX, minZ, maxZ, top?}]
  //   actors:     [{x, z, r}] circles (remote players, NPCs) — the first
  //               `actorCount` entries are used, so the caller can pool them
  //   isWalkable: (x, z) → bool, or null for no region check (/home, or
  //               airborne: a jump may leave the region, the landing judges)
  function moveWithCollision(out, x0, z0, feetY, dx, dz, r, boxes, actors, actorCount, isWalkable) {
    let x = x0 + dx;
    let z = z0 + dz;
    for (let i = 0; i < boxes.length; i++) {
      const w = boxes[i];
      if (!blocksAt(w, feetY)) continue;
      // Already inside this box before the step (a keeper placed a prop onto
      // us, a peer's house rebuilt around us): let us walk out of it. Pushing
      // to the contact edge here snapped the player to the box's FAR side —
      // straight through a house wall. Same rule as the actor circles below.
      if (x0 + r > w.minX && x0 - r < w.maxX && z0 + r > w.minZ && z0 - r < w.maxZ) continue;
      if (x + r <= w.minX || x - r >= w.maxX || z + r <= w.minZ || z - r >= w.maxZ) continue;
      // Resolve along the axis we're moving on.
      if (dx !== 0 && dz === 0) {
        x = dx > 0 ? w.minX - r - 0.001 : w.maxX + r + 0.001;
      } else if (dz !== 0 && dx === 0) {
        z = dz > 0 ? w.minZ - r - 0.001 : w.maxZ + r + 0.001;
      } else {
        // Combined-axis fallback (the engine moves per axis): push out along
        // the smaller penetration.
        const penX = dx > 0 ? (w.minX - r - x) : (w.maxX + r - x);
        const penZ = dz > 0 ? (w.minZ - r - z) : (w.maxZ + r - z);
        if (Math.abs(penX) < Math.abs(penZ)) x += penX; else z += penZ;
      }
    }
    // Solid bump against other actors, per axis like the boxes so the player
    // slides round people. Before the walkability check, so a bump can't
    // shove anyone off a road or platform.
    for (let i = 0; i < actorCount; i++) {
      const a = actors[i];
      const sep = r + a.r;
      const sep2 = sep * sep;
      const ddx = x - a.x, ddz = z - a.z;
      if (ddx * ddx + ddz * ddz >= sep2) continue;          // no overlap
      // Already inside them before this step (a peer arrived on our spot, or
      // walked into us): walk out freely — resolving to the contact edge
      // would teleport us to their far side, or pin us in place.
      const sdx = x0 - a.x, sdz = z0 - a.z;
      if (sdx * sdx + sdz * sdz < sep2) continue;
      if (dx !== 0 && dz === 0) {
        const reach = Math.sqrt(Math.max(0, sep2 - ddz * ddz));
        x = dx > 0 ? a.x - reach - 0.001 : a.x + reach + 0.001;
      } else if (dz !== 0 && dx === 0) {
        const reach = Math.sqrt(Math.max(0, sep2 - ddx * ddx));
        z = dz > 0 ? a.z - reach - 0.001 : a.z + reach + 0.001;
      }
    }
    // Stepping off the walkable region is refused for the axis that caused
    // it — with per-axis input that's a natural slide along the edge.
    if (isWalkable && !isWalkable(x, z)) {
      if (dx !== 0 && dz === 0) x = x0;
      else if (dz !== 0 && dx === 0) z = z0;
      else { x = x0; z = z0; }
    }
    out.x = x;
    out.z = z;
    return out;
  }

  // ── Ceiling cap ──
  // Max feet-Y at (x, z) before the head hits a roof, or null when under open
  // sky (unrestricted jump). The doorway lintel underside (H - LINTEL_DROP) is
  // the lowest indoor ceiling, so capping to it also clears the flat roof.
  // The footprint is grown by `margin` so the doorway threshold (right on the
  // platform edge) counts as indoors too.
  //   nodes: iterable of {x, z, ceiling, wallHeight}; only roofed ones count.
  const LINTEL_DROP = 0.45;
  function ceilingCap(x, z, nodes, halfP, margin, headTop, defaultWallH) {
    let cap = null;
    const reach = halfP + margin;
    for (const n of nodes) {
      if (!n.ceiling) continue;
      if (Math.abs(x - n.x) > reach || Math.abs(z - n.z) > reach) continue;
      const H = n.wallHeight || defaultWallH;
      const c = Math.max(0, (H - LINTEL_DROP) - headTop);   // head stays below the lintel
      cap = (cap == null) ? c : Math.min(cap, c);
    }
    return cap;
  }

  // ── Spawn spreading ──
  // Everyone entering an island or home shares its anchor, so landing exactly
  // on it stacks players inside each other. Pick a random free spot on a ring
  // round the anchor instead — eight points on the inner ring, the outer only
  // when the inner is all taken. isFree(x, z) → bool is the caller's test
  // (walkable, not in a box, clear of peers); rand() → [0, 1) (Math.random in
  // the engine, a fixed sequence in tests). Spawn-time only, so allocation is
  // fine. → {x, z}; the anchor itself when nowhere is free.
  const SPAWN_RINGS = [1.3, 2.3];
  function spreadSpawn(x, z, isFree, rand) {
    const spots = [];
    const a0 = rand() * TAU;
    for (const r of SPAWN_RINGS) {
      for (let i = 0; i < 8; i++) {
        const a = a0 + i * Math.PI / 4;
        const cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r;
        if (isFree(cx, cz)) spots.push({ x: cx, z: cz });
      }
      if (spots.length) break;           // prefer the inner ring
    }
    if (spots.length) return spots[Math.floor(rand() * spots.length)];
    return { x, z };
  }

  // ── Knockdown timing + server punch validation ──
  // Shared by the engine's PUNCH block and routes/world-socket.js. A victim is
  // immune from a fresh knockdown until IMMUNE_MS after the last one (down +
  // get-up + a second to walk away) — without it two players could chain-stun
  // someone forever (the 1 s punch cooldown is shorter than the 3.3 s down).
  const KNOCKDOWN = { DOWN_MS: 1800, GETUP_MS: 1500, IMMUNE_MS: 4300 };

  // attacker / victim: { x, y, z, downAt } (server-side records; downAt = when
  // their last accepted knockdown landed, 0/undefined = never).
  // opts: { now, range, slack, ySlack } — slack absorbs position latency.
  // → 'ok' | 'range' | 'immune' | 'attacker-down'
  function punchCheck(opts) {
    const o = opts || {};
    const a = o.attacker || {}, v = o.victim || {};
    const now = o.now;
    const range = o.range == null ? 1.4 : o.range;
    const slack = o.slack == null ? 1.6 : o.slack;
    const ySlack = o.ySlack == null ? 1.0 : o.ySlack;
    if (a.downAt && now - a.downAt < KNOCKDOWN.DOWN_MS + KNOCKDOWN.GETUP_MS) return 'attacker-down';
    if (v.downAt && now - v.downAt < KNOCKDOWN.IMMUNE_MS) return 'immune';
    const dx = (v.x || 0) - (a.x || 0), dz = (v.z || 0) - (a.z || 0);
    const reach = range + slack;
    if (!(dx * dx + dz * dz <= reach * reach)) return 'range';
    if (Math.abs((v.y || 0) - (a.y || 0)) > 1.5 + ySlack) return 'range';
    return 'ok';
  }

  // ── Infinity Stone ring ──
  // Free stones sit on a fixed ring around the START island (Iron Man 1) for
  // every player; the server checks grabs against the same slots.
  const STONE_RING = { R: 4, COUNT: 6, PICKUP_R: 0.9 };
  function stoneSlot(cx, cz, i) {
    const ang = (i / STONE_RING.COUNT) * TAU;
    return { x: cx + Math.cos(ang) * STONE_RING.R, z: cz + Math.sin(ang) * STONE_RING.R };
  }

  // ── Seats ──
  // Is the seat at (x, z) already taken by one of `seated` ([{x, z}] of other
  // players currently sitting or lying)? radius: how close counts as "on it".
  function seatOccupied(x, z, seated, radius) {
    const r2 = (radius == null ? 0.6 : radius) ** 2;
    for (const s of seated || []) {
      if (!s) continue;
      const dx = s.x - x, dz = s.z - z;
      if (dx * dx + dz * dz <= r2) return true;
    }
    return false;
  }

  // ── Shadow camera follow ──
  // Snap a shadow centre to whole shadow-map texels along the light camera's
  // own right/up axes, so a following sun doesn't make shadow edges crawl as
  // the player walks. dir: unit vector from the target toward the light.
  // texel: world units per shadow-map texel (2 * radius / mapSize).
  function snapShadowCenter(px, py, pz, dir, texel) {
    const zx = dir.x, zy = dir.y, zz = dir.z;
    // x = normalize(up × z), up = +Y (same basis Matrix4.lookAt builds).
    let xx = zz, xz = -zx;
    let xl = Math.hypot(xx, xz);
    if (xl < 1e-6) { xx = 1; xz = 0; xl = 1; }   // sun straight overhead
    xx /= xl; xz /= xl;
    const xy = 0;
    // y = z × x
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    if (!(texel > 0)) return { x: px, y: py, z: pz };
    const u = px * xx + py * xy + pz * xz;
    const v = px * yx + py * yy + pz * yz;
    const du = Math.round(u / texel) * texel - u;
    const dv = Math.round(v / texel) * texel - v;
    return { x: px + du * xx + dv * yx, y: py + du * xy + dv * yy, z: pz + du * xz + dv * yz };
  }

  return {
    MOVE, JUMP, FALL, WORLD_GRID,
    isWalkable, STEP, groundAt, blocksAt, stepVertical, shouldRespawn, airtime, pickPunchTarget,
    actorRadius, spawnIslands, PUNCH_COOLDOWN_MS, punchCooldown, hash01, npcPatrol, npcPathPoint,
    pinchZoom, fovForAspect, wallBetween,
    wrapAngle, lerpAngle, turnToward, moveWithCollision, LINTEL_DROP, ceilingCap, SPAWN_RINGS, spreadSpawn, KNOCKDOWN, punchCheck, STONE_RING, stoneSlot, seatOccupied, snapShadowCenter
  };
});
