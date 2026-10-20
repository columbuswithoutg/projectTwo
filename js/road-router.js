/************************************************
 * ROAD ROUTER — rook-style roads between projects on the gridX/gridY board
 *
 *   route(projects, opts)   every prerequisite road, routed once: only
 *                           horizontal / vertical runs through the gaps
 *                           between projects, never through another
 *                           project's cell, and roads that share a gap get
 *                           their own side-by-side lane (they can cross at a
 *                           right angle — a crossroads — but never overlap)
 *   toView(road, view)      one routed road → points in a view's units
 *                           (chart px, admin board px, /world units)
 *   portsView(r, id, view)  where a project's roads leave it: side + offset
 *                           along that side (the /world doorways)
 *   pathD(points, radius)   SVG path with rounded corners
 *   samplePolyline(points)  arc-length samples for walkers (LayoutSystem shape)
 *
 * Grid model: a half-cell lattice. Lattice (X, Y) = (2·gridX, 2·gridY), so a
 * project sits on an even/even vertex; odd coordinates are the gaps between
 * projects. A project's vertex is blocked to every road except its own, so a
 * road leaves through one of the four side midpoints and travels the gaps.
 *
 * Routing, in three steps:
 *   1. Each road is an A* search (length + bends + crossings + lane
 *      pressure); shortest roads go first so neighbours get the direct line.
 *   2. Rip-up and reroute: every road is searched again against ALL the
 *      others — the first pass only knew the roads routed before it — and
 *      moves only when that is strictly cheaper, for up to PASSES passes.
 *      This is what stops the early roads forcing crossings on the late
 *      ones (the long roads into a hub nest instead of braiding).
 *   3. Lanes per lattice line: runs on the same line that overlap get
 *      different lanes, ORDERED by where the two roads part — walk their
 *      shared stretch to the point they diverge; the road that turns off to
 *      the left takes the left lane (likewise where they join). "Left"
 *      follows the road round its corners, so one order serves the whole
 *      shared stretch and roads peel off a hub's doorstep without crossing
 *      each other. Lanes are centred on the gap.
 *
 * Required roads are routed and laned before recommended trails, so a view
 * that only shows required roads (/world) gets the same roads as one that
 * shows both (the watch-order chart, the admin board).
 *
 * Shared by: js/orderRenderer.js + js/walkerView.js (chart + walkers),
 *            js/views/admin/cms-projects-board.js, js/playground3d*.js.
 * Unit tests: test/road-router.test.js.
 *
 * UMD-ish: attaches to window.RoadRouter in the browser, exports via
 * module.exports under Node (same pattern as project-logic.js).
 ************************************************/
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.RoadRouter = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const MAX_LANES = 3;       // lanes a gap holds before the admin board warns
  const COST = {
    STEP: 1,                 // one half-cell
    BEND: 3,                 // per turn — keeps roads to a few clean corners
    CROSS: 10,               // crossing another road at a right angle
    LANE: 0.5,               // per road already on this stretch
    OVER: 40,                // stretch already at MAX_LANES
    TRAIL_ON_ROAD: 2         // a recommended trail sharing a required road's stretch
  };
  const MARGIN = 2;          // lattice ring around the board roads may use
  const PASSES = 3;          // rip-up and reroute passes after the first routing
  // Directions: 0 E (+X), 1 S (+Y), 2 W (−X), 3 N (−Y). Side names match
  // /world, where +gridY is +z (south).
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  const SIDE = ['E', 'S', 'W', 'N'];

  const gx = (p) => (Number.isFinite(p && p.gridX) ? p.gridX : 0);
  const gy = (p) => (Number.isFinite(p && p.gridY) ? p.gridY : 0);
  const ids = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

  // ── Binary heap (min on f, then insertion order — deterministic) ──
  function Heap() { this.a = []; }
  Heap.prototype.push = function (n) {
    const a = this.a; a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (less(a[i], a[p])) { const t = a[i]; a[i] = a[p]; a[p] = t; i = p; } else break;
    }
  };
  Heap.prototype.pop = function () {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && less(a[l], a[m])) m = l;
        if (r < a.length && less(a[r], a[m])) m = r;
        if (m === i) break;
        const t = a[i]; a[i] = a[m]; a[m] = t; i = m;
      }
    }
    return top;
  };
  function less(x, y) { return x.f < y.f || (x.f === y.f && x.n < y.n); }

  // ── Board ──
  function buildBoard(projects) {
    const cells = new Map();       // "X,Y" lattice → project id
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of projects || []) {
      if (!p || typeof p.id !== 'string') continue;
      const X = 2 * gx(p), Y = 2 * gy(p);
      const k = X + ',' + Y;
      if (!cells.has(k)) cells.set(k, p.id);
      minX = Math.min(minX, X); maxX = Math.max(maxX, X);
      minY = Math.min(minY, Y); maxY = Math.max(maxY, Y);
    }
    if (!cells.size) { minX = maxX = minY = maxY = 0; }
    const x0 = minX - MARGIN, y0 = minY - MARGIN;
    const w = maxX - minX + 2 * MARGIN + 1, h = maxY - minY + 2 * MARGIN + 1;
    const blocked = new Uint8Array(w * h);
    cells.forEach((_, k) => {
      const [X, Y] = k.split(',').map(Number);
      blocked[(Y - y0) * w + (X - x0)] = 1;
    });
    return { x0, y0, w, h, blocked, cells };
  }

  // Edge list: required first, then recommended trails that aren't also
  // required. Sorted shortest-first, ties by key.
  function collectEdges(projects, withTrails) {
    const pos = new Map();
    for (const p of projects || []) if (p && typeof p.id === 'string' && !pos.has(p.id)) pos.set(p.id, { X: 2 * gx(p), Y: 2 * gy(p) });
    const req = [], rec = [], seen = new Set();
    const add = (list, fromId, toId, required) => {
      const a = pos.get(fromId), b = pos.get(toId);
      if (!a || !b || (a.X === b.X && a.Y === b.Y)) return;
      const key = fromId + '__' + toId;
      if (seen.has(key)) return;
      seen.add(key);
      list.push({ key, fromId, toId, required, a, b, dist: Math.abs(a.X - b.X) + Math.abs(a.Y - b.Y) });
    };
    for (const p of projects || []) {
      if (!p || typeof p.id !== 'string') continue;
      for (const pre of ids(p.prerequisites)) add(req, pre, p.id, true);
    }
    if (withTrails) {
      for (const p of projects || []) {
        if (!p || typeof p.id !== 'string') continue;
        for (const pre of ids(p.recommendedPrerequisites)) add(rec, pre, p.id, false);
      }
    }
    const order = (x, y) => x.dist - y.dist || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0);
    return req.sort(order).concat(rec.sort(order));
  }

  // ── A* over (vertex, heading) ──
  // use.seg[i*2 + o]   roads on the unit segment leaving vertex i in +X (o=0) / +Y (o=1)
  // use.req[...]       same, required roads only (trails avoid them)
  // use.vtx[i*2 + o]   roads with a horizontal (o=0) / vertical (o=1) segment at vertex i
  function stepCost(use, edge, v, nv, d, nd, goal) {
    const o = nd & 1;                                         // 0 horizontal, 1 vertical
    const segI = Math.min(v, nv) * 2 + o;
    const onSeg = use.seg[segI];
    let c = COST.STEP + onSeg * COST.LANE;
    if (edge.required) { if (onSeg >= MAX_LANES) c += COST.OVER; }
    else if (use.req[segI]) c += COST.TRAIL_ON_ROAD;
    if (d >= 0 && nd !== d) c += COST.BEND;
    if (nv !== goal && use.vtx[nv * 2 + (1 - o)]) c += COST.CROSS;
    return c;
  }

  function search(board, use, edge) {
    const { x0, y0, w, h, blocked } = board;
    const N = w * h;
    const sx = edge.a.X - x0, sy = edge.a.Y - y0, tx = edge.b.X - x0, ty = edge.b.Y - y0;
    const start = sy * w + sx, goal = ty * w + tx;
    if (!board.g) { board.g = new Float64Array(N * 5); board.prev = new Int32Array(N * 5); }
    const g = board.g.fill(Infinity);                   // state = v*5 + (dir+1)
    const prev = board.prev.fill(-1);
    const heap = new Heap();
    let counter = 0;
    const hfn = (v) => Math.abs((v % w) - tx) + Math.abs(((v / w) | 0) - ty);
    g[start * 5] = 0;
    heap.push({ s: start * 5, f: hfn(start), n: counter++ });
    while (heap.a.length) {
      const cur = heap.pop();
      const v = (cur.s / 5) | 0, d = (cur.s % 5) - 1;
      const gc = g[cur.s];
      if (cur.f - hfn(v) > gc + 1e-9) continue;   // stale entry
      if (v === goal) return { verts: unwind(prev, cur.s, w, x0, y0), cost: gc };
      const vx = v % w, vy = (v / w) | 0;
      for (let nd = 0; nd < 4; nd++) {
        if (d >= 0 && nd === ((d + 2) & 3)) continue;           // no U-turns
        const nx = vx + DX[nd], ny = vy + DY[nd];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nv = ny * w + nx;
        if (blocked[nv] && nv !== goal) continue;                // other projects
        const ns = nv * 5 + nd + 1;
        const ng = gc + stepCost(use, edge, v, nv, d, nd, goal);
        if (ng < g[ns] - 1e-9) {
          g[ns] = ng; prev[ns] = cur.s;
          heap.push({ s: ns, f: ng + hfn(nv), n: counter++ });
        }
      }
    }
    return null;
  }

  // Cost of an existing path against the current usage (its own use removed).
  function pathCost(board, use, edge, verts) {
    const { x0, y0, w } = board;
    const idx = (p) => (p.Y - y0) * w + (p.X - x0);
    const goal = idx(verts[verts.length - 1]);
    let c = 0, d = -1;
    for (let i = 1; i < verts.length; i++) {
      const a = verts[i - 1], b = verts[i];
      const nd = b.X > a.X ? 0 : b.Y > a.Y ? 1 : b.X < a.X ? 2 : 3;
      c += stepCost(use, edge, idx(a), idx(b), d, nd, goal);
      d = nd;
    }
    return c;
  }

  function unwind(prev, s, w, x0, y0) {
    const out = [];
    for (let c = s; c !== -1; c = prev[c]) {
      const v = (c / 5) | 0;
      out.push({ X: (v % w) + x0, Y: ((v / w) | 0) + y0 });
    }
    return out.reverse();
  }

  function markUse(board, use, verts, required, sign) {
    const { x0, y0, w } = board;
    const k = sign === -1 ? -1 : 1;
    for (let i = 1; i < verts.length; i++) {
      const a = verts[i - 1], b = verts[i];
      const o = a.Y === b.Y ? 0 : 1;
      const va = (a.Y - y0) * w + (a.X - x0), vb = (b.Y - y0) * w + (b.X - x0);
      const segI = Math.min(va, vb) * 2 + o;
      use.seg[segI] += k;
      if (required) use.req[segI] += k;
      use.vtx[va * 2 + o] += k; use.vtx[vb * 2 + o] += k;
    }
  }

  // Lattice vertices → straight runs. A run: { o: 'h'|'v', line, from, to, dir }
  // (from/to along the line, in travel order).
  function toRuns(verts) {
    const runs = [];
    for (let i = 1; i < verts.length; i++) {
      const a = verts[i - 1], b = verts[i];
      const dir = b.X > a.X ? 0 : b.Y > a.Y ? 1 : b.X < a.X ? 2 : 3;
      const last = runs[runs.length - 1];
      if (last && last.dir === dir) { last.to = (dir & 1) ? b.Y : b.X; continue; }
      runs.push((dir & 1)
        ? { o: 'v', line: a.X, from: a.Y, to: b.Y, dir, off: 0, room: 0 }
        : { o: 'h', line: a.Y, from: a.X, to: b.X, dir, off: 0, room: 0 });
    }
    return runs;
  }

  // ── Lane order ──
  // Two roads that share a stretch must sit in separate lanes; WHICH lane
  // decides whether they cross when they part. Walk the shared stretch to
  // where the two roads diverge: the road that leaves to the left belongs
  // in the left lane (likewise where they join). "Left" follows the road
  // round its corners, so one order serves the whole shared stretch. When
  // the two ends disagree a crossing is unavoidable and no order is set.
  const vkey = (p) => p.X + ',' + p.Y;
  const skey = (a, b) => (a.X < b.X || (a.X === b.X && a.Y < b.Y)) ? vkey(a) + '|' + vkey(b) : vkey(b) + '|' + vkey(a);
  // -1 left of `fwd`, +1 right, 0 straight on / back.
  function sideOf(fwd, dir) {
    const d = dir.X * fwd.Y - dir.Y * fwd.X;     // dot(dir, left), left = (fwd.Y, -fwd.X)
    return d > 0 ? -1 : d < 0 ? 1 : 0;
  }
  const sub = (p, q) => ({ X: p.X - q.X, Y: p.Y - q.Y });

  // Adds order constraints (it.lt / it.gt) between items (one per run) on
  // the same line, from every stretch two required roads share.
  function orderConstraints(roads, vertsByKey, itemAt) {
    const segRunOf = new Map();     // key -> Int32Array: segment i -> run index
    const bySeg = new Map();        // segment -> [{ r, i }]
    for (const r of roads) {
      const verts = vertsByKey.get(r.key);
      const sr = new Int32Array(verts.length - 1);
      let i = 0;
      r.runs.forEach((run, ri) => { for (let n = Math.abs(run.to - run.from); n > 0; n--) sr[i++] = ri; });
      segRunOf.set(r.key, sr);
      for (let k = 0; k < verts.length - 1; k++) {
        const sk = skey(verts[k], verts[k + 1]);
        if (!bySeg.has(sk)) bySeg.set(sk, []);
        bySeg.get(sk).push({ r, i: k });
      }
    }
    // Shared segments per pair.
    const pairs = new Map();
    bySeg.forEach((list) => {
      for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
        const [P, Q] = list[x].r.key < list[y].r.key ? [list[x], list[y]] : [list[y], list[x]];
        const pk = P.r.key + '~' + Q.r.key;
        if (!pairs.has(pk)) pairs.set(pk, { P: P.r, Q: Q.r, segs: [] });
        pairs.get(pk).segs.push({ iP: P.i, iQ: Q.i });
      }
    });
    const constrain = (pItem, qItem, pSmaller) => {
      const [u, v] = pSmaller ? [pItem, qItem] : [qItem, pItem];
      if (u === v) return;
      u.lt.add(v); v.gt.add(u);
    };
    pairs.forEach(({ P, Q, segs }) => {
      const vP = vertsByKey.get(P.key), vQ = vertsByKey.get(Q.key);
      segs.sort((x, y) => x.iP - y.iP);
      // Maximal runs of consecutive shared segments (one shared stretch each).
      let g = 0;
      while (g < segs.length) {
        let e = g;
        while (e + 1 < segs.length && segs[e + 1].iP === segs[e].iP + 1 && Math.abs(segs[e + 1].iQ - segs[e].iQ) === 1
          && (e === g || segs[e + 1].iQ - segs[e].iQ === segs[e].iQ - segs[e - 1].iQ)) e++;
        const iP0 = segs[g].iP, iP1 = segs[e].iP;
        const same = e > g ? segs[e].iQ > segs[g].iQ : (vkey(vQ[segs[g].iQ]) === vkey(vP[iP0]));
        const A = vP[iP0], B = vP[iP1 + 1];
        // Off-stretch neighbours at each end (null when the road ends there).
        const pPrev = iP0 > 0 ? vP[iP0 - 1] : null, pNext = iP1 + 2 < vP.length ? vP[iP1 + 2] : null;
        const qA = same ? segs[g].iQ - 1 : segs[g].iQ + 2;
        const qB = same ? segs[e].iQ + 2 : segs[e].iQ - 1;
        const qPrev = qA >= 0 && qA < vQ.length ? vQ[qA] : null, qNext = qB >= 0 && qB < vQ.length ? vQ[qB] : null;
        let atA = 0, atB = 0;     // -1: P left of Q, +1: P right of Q, 0: unknown
        if (pPrev && qPrev) {
          const fwd = sub(vP[iP0 + 1], A);
          atA = Math.sign(sideOf(fwd, sub(pPrev, A)) - sideOf(fwd, sub(qPrev, A)));
        }
        if (pNext && qNext) {
          const fwd = sub(B, vP[iP1]);
          atB = Math.sign(sideOf(fwd, sub(pNext, B)) - sideOf(fwd, sub(qNext, B)));
        }
        const pLeft = (atA && atB && atA !== atB) ? 0 : (atA || atB);
        if (pLeft) {
          const srP = segRunOf.get(P.key), srQ = segRunOf.get(Q.key);
          for (let k = g; k <= e; k++) {
            const i = segs[k].iP;
            const fwd = sub(vP[i + 1], vP[i]);
            const pItem = itemAt(P.key, srP[i]), qItem = itemAt(Q.key, srQ[segs[k].iQ]);
            // Lane offsets grow +Y on a horizontal line, +X on a vertical one.
            const leftIsSmaller = pItem.run.o === 'h' ? fwd.X > 0 : fwd.Y < 0;
            constrain(pItem, qItem, (pLeft < 0) === leftIsSmaller);
          }
        }
        g = e + 1;
      }
    });
  }

  // ── Lanes ──
  // Runs on one lattice line that overlap need different lanes, ordered by
  // the constraints above (greedy, in topological order; a rare cycle is cut).
  // Runs that only touch end to end at a gap vertex (both turn there) need
  // separate lanes only when they turn opposite ways (the one turning to
  // -offset takes the lower lane); turning the same way they can share.
  // Runs that meet at a project's centre never conflict: both are clipped to
  // the project's box. Lanes are centred per touching group. Trails come
  // after: the nearest free offset to the centre, >= 1 lane from anything
  // already on that stretch.
  function assignLanes(roads, cells, vertsByKey) {
    const lines = new Map();
    const items = new Map();
    for (const r of roads) r.runs.forEach((run, ri) => {
      const k = run.o + run.line;
      if (!lines.has(k)) lines.set(k, []);
      const it = { run, ri, road: r, req: r.required, a: Math.min(run.from, run.to), b: Math.max(run.from, run.to), key: r.key, lane: null, lt: new Set(), gt: new Set() };
      lines.get(k).push(it);
      items.set(r.key + '#' + ri, it);
    });
    const itemAt = (key, ri) => items.get(key + '#' + ri);
    orderConstraints(roads.filter((r) => r.required), vertsByKey, itemAt);

    const byStart = (x, y) => x.a - y.a || x.b - y.b || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0);
    const over = [];
    lines.forEach((lineItems, lineKey) => {
      const o = lineKey[0], line = +lineKey.slice(1);
      const isProject = (t) => cells.has(o === 'h' ? t + ',' + line : line + ',' + t);
      const overlap = (x, y) => Math.min(x.b, y.b) > Math.max(x.a, y.a);
      const touch = (x, y) => {
        const lo = Math.max(x.a, y.a), hi = Math.min(x.b, y.b);
        return hi > lo || (hi === lo && !isProject(lo));
      };
      // Which way a run's road turns off this line at t (-1 / +1 along the
      // offset axis), for a run that ends at t.
      const turnAt = (it, t) => {
        const runs = it.road.runs;
        const next = it.run.to === t ? runs[it.ri + 1] : runs[it.ri - 1];
        if (!next) return 0;
        const dir = it.run.to === t ? next.dir : (next.dir + 2) & 3;
        return (dir === 1 || dir === 0) ? 1 : -1;     // S / E -> +offset
      };
      const req = lineItems.filter((i) => i.req).sort(byStart);
      // Touch-only pairs: constrain opposite turns, let same turns share.
      for (let x = 0; x < req.length; x++) for (let y = x + 1; y < req.length; y++) {
        const p = req[x], q = req[y];
        if (overlap(p, q) || !touch(p, q)) continue;
        const t = p.b === q.a ? p.b : q.b === p.a ? q.b : null;
        if (t == null) continue;
        const tp = turnAt(p, t), tq = turnAt(q, t);
        if (tp && tq && tp !== tq) { const [u, v] = tp < 0 ? [p, q] : [q, p]; u.lt.add(v); v.gt.add(u); }
      }
      // Constraints only count between items on this line; cut cycles (DFS, byStart order).
      const onLine = new Set(req);
      const state = new Map();
      const visit = (it) => {
        state.set(it, 1);
        for (const v of Array.from(it.lt).sort(byStart)) {
          if (!onLine.has(v)) continue;
          const st = state.get(v);
          if (st === 1) { it.lt.delete(v); v.gt.delete(it); continue; }
          if (!st) visit(v);
        }
        state.set(it, 2);
      };
      for (const it of req) if (!state.get(it)) visit(it);
      // Topological order, byStart among the ready items.
      const indeg = new Map(req.map((it) => [it, Array.from(it.gt).filter((u) => onLine.has(u)).length]));
      const ready = req.filter((it) => indeg.get(it) === 0).sort(byStart);
      const order = [];
      while (ready.length) {
        const it = ready.shift();
        order.push(it);
        for (const v of Array.from(it.lt).sort(byStart)) {
          if (!onLine.has(v)) continue;
          indeg.set(v, indeg.get(v) - 1);
          if (indeg.get(v) === 0) { ready.push(v); ready.sort(byStart); }
        }
      }
      // Greedy lanes in that order.
      const placed = [];
      for (const it of order) {
        let lane = 0;
        for (const u of it.gt) if (onLine.has(u) && u.lane != null) lane = Math.max(lane, u.lane + 1);
        for (;;) {
          const clash = placed.some((q) => q.lane === lane && overlap(q, it));
          if (!clash) break;
          lane++;
        }
        it.lane = lane;
        placed.push(it);
      }
      // Touching groups (sweep by start): centre each, flag crowded gaps.
      let group = [], groupEnd = -Infinity;
      const flush = () => {
        if (!group.length) return;
        const n = Math.max(...group.map((i) => i.lane)) + 1;
        for (const it of group) { it.run.off = it.lane - (n - 1) / 2; it.run.room = (n - 1) / 2; }
        if (n > MAX_LANES) {
          let worst = 0, wFrom = 0, wTo = 0;
          for (let t = Math.min(...group.map((i) => i.a)); t < Math.max(...group.map((i) => i.b)); t++) {
            if (isProject(t) || isProject(t + 1)) continue;
            const c = group.filter((i) => i.a <= t && i.b >= t + 1).length;
            if (c > worst) { worst = c; wFrom = t; wTo = t + 1; } else if (c === worst && t === wTo) wTo = t + 1;
          }
          if (worst > MAX_LANES) over.push({ o, line, from: wFrom, to: wTo, lanes: worst, roads: group.map((i) => i.key) });
        }
        group = [];
      };
      for (const it of req) {
        if (it.a > groupEnd || (it.a === groupEnd && isProject(it.a))) { flush(); groupEnd = -Infinity; }
        group.push(it); groupEnd = Math.max(groupEnd, it.b);
      }
      flush();
      // Trails.
      const placedAll = req.slice();
      for (const it of lineItems.filter((i) => !i.req).sort(byStart)) {
        const near = placedAll.filter((o) => touch(o, it)).map((o) => o.run.off);
        let off = 0;
        for (let k = 0; k < 64; k++) {
          const c = (k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5);
          if (near.every((u) => Math.abs(u - c) >= 1 - 1e-9)) { off = c; break; }
        }
        it.run.off = off;
        placedAll.push(it);
      }
      for (const it of lineItems) {
        if (it.req) continue;
        const near = placedAll.filter((o) => touch(o, it)).map((o) => Math.abs(o.run.off));
        it.run.room = Math.max(Math.abs(it.run.off), ...near);
      }
      for (const it of req) {
        const near = placedAll.filter((o) => touch(o, it)).map((o) => Math.abs(o.run.off));
        it.run.roomAll = Math.max(it.run.room, ...near);
      }
      for (const it of lineItems) if (!it.req) it.run.roomAll = it.run.room;
    });
    return over;
  }

  // ── Public: route ──
  const _cache = new Map();
  function signature(projects, withTrails) {
    let s = withTrails ? 'T|' : 'R|';
    for (const p of projects || []) {
      if (!p || typeof p.id !== 'string') continue;
      s += p.id + ':' + gx(p) + ',' + gy(p) + ':' + ids(p.prerequisites).join(',');
      if (withTrails) s += ';' + ids(p.recommendedPrerequisites).join(',');
      s += '|';
    }
    return s;
  }

  // projects: [{ id, gridX, gridY, prerequisites, recommendedPrerequisites }]
  // opts.trails (default true): also route recommended trails.
  // → { roads: [{ key, fromId, toId, required, runs, fromSide, toSide }],
  //     byKey: Map, overCapacity: [...] }
  function route(projects, opts) {
    const withTrails = !(opts && opts.trails === false);
    const sig = signature(projects, withTrails);
    if (_cache.has(sig)) return _cache.get(sig);
    const board = buildBoard(projects);
    const N = board.w * board.h;
    const use = { seg: new Uint16Array(N * 2), req: new Uint16Array(N * 2), vtx: new Uint16Array(N * 2) };
    const edges = collectEdges(projects, withTrails);
    const paths = new Map();
    // Required roads first: sequentially, then rip-up and reroute, where
    // every road is re-searched against ALL the others (the first pass only
    // knew the roads routed before it) and moves only when strictly cheaper.
    // Trails follow the same way, so they never move a required road.
    const routeGroup = (list) => {
      for (const e of list) {
        const found = search(board, use, e);
        if (!found || found.verts.length < 2) continue;
        markUse(board, use, found.verts, e.required, 1);
        paths.set(e.key, found.verts);
      }
      for (let pass = 0; pass < PASSES; pass++) {
        let moved = 0;
        for (const e of list) {
          const cur = paths.get(e.key);
          if (!cur) continue;
          markUse(board, use, cur, e.required, -1);
          const was = pathCost(board, use, e, cur);
          // Already as cheap as any road between these two could be.
          const floor = e.dist * COST.STEP + (e.a.X !== e.b.X && e.a.Y !== e.b.Y ? COST.BEND : 0);
          if (was <= floor + 1e-9) { markUse(board, use, cur, e.required, 1); continue; }
          const found = search(board, use, e);
          if (found && found.verts.length >= 2 && found.cost < was - 1e-6) { paths.set(e.key, found.verts); markUse(board, use, found.verts, e.required, 1); moved++; }
          else markUse(board, use, cur, e.required, 1);
        }
        if (!moved) break;
      }
    };
    routeGroup(edges.filter((e) => e.required));
    routeGroup(edges.filter((e) => !e.required));
    const roads = [];
    for (const e of edges) {
      const verts = paths.get(e.key);
      if (!verts) continue;
      const runs = toRuns(verts);
      roads.push({
        key: e.key, fromId: e.fromId, toId: e.toId, required: e.required, runs,
        fromSide: SIDE[runs[0].dir], toSide: SIDE[(runs[runs.length - 1].dir + 2) & 3]
      });
    }
    const overCapacity = assignLanes(roads, board.cells, paths);
    const result = { roads, byKey: new Map(roads.map((r) => [r.key, r])), overCapacity };
    if (_cache.size > 8) _cache.delete(_cache.keys().next().value);
    _cache.set(sig, result);
    return result;
  }

  // ── Public: views ──
  // view: {
  //   pitchX, pitchY        view units per grid cell
  //   originX, originY      view position of grid (0, 0)'s centre
  //   gapShiftX, gapShiftY  nudge gap lines (e.g. below the chart's labels)
  //   laneSpacing           centre-to-centre distance between lanes
  //   laneRoom              max lane offset from a line's centre (or per
  //                         line kind: gapRoomX/Y, cellRoomX/Y — see laneScale)
  //   nodeHalfW, nodeHalfH  clip road ends to the project's box (0 = centre)
  //   trails                true when the view also draws trails (squeeze by roomAll)
  // }
  function lx(L, v) { return v.originX + (L / 2) * v.pitchX + ((L & 1) ? (v.gapShiftX || 0) : 0); }
  function ly(L, v) { return v.originY + (L / 2) * v.pitchY + ((L & 1) ? (v.gapShiftY || 0) : 0); }
  // How far lanes may spread from a line's centre: gapRoomX/Y on a gap line,
  // cellRoomX/Y on a project's own column / row (its doorstep, about half its
  // side). X = vertical runs (offset in x), Y = horizontal runs (offset in y).
  // Each falls back to laneRoom.
  function laneScale(run, v) {
    const room = v.trails ? (run.roomAll != null ? run.roomAll : run.room) : run.room;
    if (!(room > 0)) return v.laneSpacing;
    const onCell = !(run.line & 1);
    const pick = (x) => (x != null ? x : v.laneRoom);
    const max = run.o === 'h' ? pick(onCell ? v.cellRoomY : v.gapRoomY) : pick(onCell ? v.cellRoomX : v.gapRoomX);
    return Math.min(v.laneSpacing, max / room);
  }
  function runOffset(run, v) { return run.off * laneScale(run, v); }

  // A lattice vertex (2·gridX, 2·gridY; odd = a gap) in view units.
  function latticeToView(X, Y, v) { return { x: lx(X, v), y: ly(Y, v) }; }

  // → { points: [{x, y}], fromSide, toSide }
  function toView(road, v) {
    const runs = road.runs;
    const pts = [];
    const first = runs[0];
    const o0 = runOffset(first, v);
    // Start: the parent's centre, shifted onto the first run's lane.
    if (first.o === 'h') pts.push({ x: lx(first.from, v), y: ly(first.line, v) + o0 });
    else pts.push({ x: lx(first.line, v) + o0, y: ly(first.from, v) });
    for (let i = 1; i < runs.length; i++) {
      const a = runs[i - 1], b = runs[i];
      const oa = runOffset(a, v), ob = runOffset(b, v);
      if (a.o === 'h') pts.push({ x: lx(b.line, v) + ob, y: ly(a.line, v) + oa });
      else pts.push({ x: lx(a.line, v) + oa, y: ly(b.line, v) + ob });
    }
    const last = runs[runs.length - 1];
    const on = runOffset(last, v);
    if (last.o === 'h') pts.push({ x: lx(last.to, v), y: ly(last.line, v) + on });
    else pts.push({ x: lx(last.line, v) + on, y: ly(last.to, v) });
    // Clip the ends to the project boxes.
    const clip = (p, run, sign) => {
      const d = run.dir;
      const half = (d & 1) ? (v.nodeHalfH || 0) : (v.nodeHalfW || 0);
      p.x += DX[d] * half * sign; p.y += DY[d] * half * sign;
    };
    clip(pts[0], first, 1);
    clip(pts[pts.length - 1], last, -1);
    return { points: pts, fromSide: road.fromSide, toSide: road.toSide };
  }

  // Where each of a project's roads meets its sides:
  // → [{ side: 'N'|'S'|'E'|'W', along, key, otherId }] — along = offset from the
  // project's centre along that side, in view units (+x for N/S, +y for E/W).
  function portsView(result, projectId, v, opts) {
    const out = [];
    const reqOnly = !!(opts && opts.requiredOnly);
    for (const r of result.roads) {
      if (reqOnly && !r.required) continue;
      if (r.fromId === projectId) out.push({ side: r.fromSide, along: runOffset(r.runs[0], v), key: r.key, otherId: r.toId });
      if (r.toId === projectId) out.push({ side: r.toSide, along: runOffset(r.runs[r.runs.length - 1], v), key: r.key, otherId: r.fromId });
    }
    return out;
  }

  // ── Drawing helpers ──
  // Drop zero-length legs and collinear middles.
  function clean(points) {
    const out = [];
    for (const p of points) {
      const q = out[out.length - 1];
      if (q && Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6) continue;
      out.push({ x: p.x, y: p.y });
    }
    for (let i = out.length - 2; i >= 1; i--) {
      const a = out[i - 1], b = out[i], c = out[i + 1];
      if (Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) < 1e-6) out.splice(i, 1);
    }
    return out;
  }

  // Corner radius at point i: never more than half of either leg.
  function cornerR(pts, i, radius) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    return Math.min(radius, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(c.x - b.x, c.y - b.y) / 2);
  }

  const fmt = (n) => Math.round(n * 100) / 100;

  // SVG path through the points with rounded corners.
  function pathD(points, radius) {
    const pts = clean(points);
    if (pts.length < 2) return '';
    let d = `M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      const r = cornerR(pts, i, radius || 0);
      const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
      const p1 = { x: b.x - (b.x - a.x) / l1 * r, y: b.y - (b.y - a.y) / l1 * r };
      const p2 = { x: b.x + (c.x - b.x) / l2 * r, y: b.y + (c.y - b.y) / l2 * r };
      d += ` L ${fmt(p1.x)} ${fmt(p1.y)} Q ${fmt(b.x)} ${fmt(b.y)} ${fmt(p2.x)} ${fmt(p2.y)}`;
    }
    const z = pts[pts.length - 1];
    return d + ` L ${fmt(z.x)} ${fmt(z.y)}`;
  }

  // Arc-length samples along the same rounded path, in the shape walkers
  // and LayoutSystem.sampleAt expect: { t, x, y, tx, ty, nx, ny, cumLen }.
  function samplePolyline(points, radius) {
    const pts = clean(points);
    const raw = [];
    if (pts.length < 2) return { samples: [], length: 0 };
    raw.push({ x: pts[0].x, y: pts[0].y });
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      const r = cornerR(pts, i, radius || 0);
      const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
      const p1 = { x: b.x - (b.x - a.x) / l1 * r, y: b.y - (b.y - a.y) / l1 * r };
      const p2 = { x: b.x + (c.x - b.x) / l2 * r, y: b.y + (c.y - b.y) / l2 * r };
      // Quadratic corner, 6 steps.
      for (let k = 0; k <= 6; k++) {
        const t = k / 6, u = 1 - t;
        raw.push({ x: u * u * p1.x + 2 * u * t * b.x + t * t * p2.x, y: u * u * p1.y + 2 * u * t * b.y + t * t * p2.y });
      }
    }
    raw.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y });
    const dedup = raw.filter((p, i) => i === 0 || Math.hypot(p.x - raw[i - 1].x, p.y - raw[i - 1].y) > 1e-6);
    let cum = 0;
    const samples = dedup.map((p, i) => {
      if (i > 0) cum += Math.hypot(p.x - dedup[i - 1].x, p.y - dedup[i - 1].y);
      return { x: p.x, y: p.y, cumLen: cum };
    });
    const length = cum;
    for (let i = 0; i < samples.length; i++) {
      const a = samples[Math.max(0, i - 1)], b = samples[Math.min(samples.length - 1, i + 1)];
      const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
      const s = samples[i];
      s.tx = dx / l; s.ty = dy / l; s.nx = -s.ty; s.ny = s.tx;
      s.t = length ? s.cumLen / length : 0;
    }
    return { samples, length };
  }

  return {
    MAX_LANES, COST, SIDE,
    route, toView, portsView, latticeToView, pathD, samplePolyline,
    _internal: { buildBoard, collectEdges, toRuns }
  };
});
