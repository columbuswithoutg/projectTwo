/************************************************
 * LAYOUT — world-map cluster packing + road geometry
 *
 * Computes node positions (cluster packing) and road curves (straight or
 * cubic bezier) from the authored LOCATIONS registry. Both the renderer
 * and the walker physics consume the same cached geometry — this is what
 * keeps walkers visually on the drawn roads.
 ************************************************/
const LayoutSystem = (() => {
  const ROAD_HALF_W = 13;
  const CLUSTER_EDGE_PAD = 8; // road endpoints sit this far outside the cluster AABB

  /* ────────── location packing (pin row along bottom) ────────── */

  // Lay movies out as a single horizontal row of tiny 30×45 pins along the
  // bottom edge of the location's fixed rectangle, in release order.
  // The pin row is centered horizontally, with SHELF_PAD vertical breathing
  // room from the rectangle's bottom edge.
  function packLocation(members, loc) {
    const N = members.length;
    if (N === 0) return [];
    const PIN_W = CONFIG_WORLD.pinWidth;
    const PIN_H = CONFIG_WORLD.pinHeight;
    const PIN_GAP = CONFIG_WORLD.pinGap;
    const SHELF_PAD = CONFIG_WORLD.pinShelfPad;
    const totalRowW = N * PIN_W + (N - 1) * PIN_GAP;
    const bottomY = loc.worldY + loc.height / 2;
    const rowY = bottomY - SHELF_PAD - PIN_H / 2;
    const rowStartX = loc.worldX - totalRowW / 2 + PIN_W / 2;
    return members.map((p, i) => ({
      id: p.id,
      x: rowStartX + i * (PIN_W + PIN_GAP),
      y: rowY,
      clusterId: loc.id,
      clusterIndex: i,
      isCosmic: isCosmicLocation(loc),
      isPin: true,
    }));
  }

  function computeLayout(projectList, visibilityFn) {
    const visible = projectList.filter(visibilityFn);
    const byLocation = new Map();
    visible.forEach(p => {
      const locId = p.location;
      if (!LOCATION_BY_ID.has(locId)) {
        console.warn(`[layout] project ${p.id} has unmapped location "${locId}"`);
        return;
      }
      if (!byLocation.has(locId)) byLocation.set(locId, []);
      byLocation.get(locId).push(p);
    });

    const out = new Map();
    byLocation.forEach((members, locId) => {
      const loc = LOCATION_BY_ID.get(locId);
      members.sort((a, b) => (a.release || "").localeCompare(b.release || ""));
      packLocation(members, loc).forEach(entry => out.set(entry.id, entry));
    });
    return out;
  }

  // The rect is the location's AUTHORED width × height — independent of pin
  // positions. Walker physics bounces within these outer edges; road clipping
  // exits through these edges. Pins sit anywhere inside (currently along the
  // bottom via packLocation).
  function computeClusterRects(layout) {
    const rects = new Map();
    // Group pins by cluster so each rect knows its memberIds/positions.
    const membersByCluster = new Map();
    layout.forEach((pos, nodeId) => {
      if (!membersByCluster.has(pos.clusterId)) membersByCluster.set(pos.clusterId, []);
      membersByCluster.get(pos.clusterId).push({ id: nodeId, x: pos.x, y: pos.y });
    });
    membersByCluster.forEach((members, locId) => {
      const loc = LOCATION_BY_ID.get(locId);
      if (!loc) return;
      const halfW = loc.width / 2;
      const halfH = loc.height / 2;
      rects.set(locId, {
        id: locId,
        minX: loc.worldX - halfW,
        maxX: loc.worldX + halfW,
        minY: loc.worldY - halfH,
        maxY: loc.worldY + halfH,
        cx: loc.worldX,
        cy: loc.worldY,
        width: loc.width,
        height: loc.height,
        memberIds: members.map(m => m.id),
        memberPositions: members,
      });
    });
    return rects;
  }

  /* ────────── bezier math (shared) ────────── */

  // Find where a ray from (cx, cy) in direction (ux, uy) exits the AABB.
  // Used to clip inter-cluster roads to the cluster boundary so the road
  // emerges from the cluster's outer edge instead of a specific node.
  function rayExitAABB(cx, cy, ux, uy, rect) {
    const tx = ux > 0 ? (rect.maxX - cx) / ux : ux < 0 ? (rect.minX - cx) / ux : Infinity;
    const ty = uy > 0 ? (rect.maxY - cy) / uy : uy < 0 ? (rect.minY - cy) / uy : Infinity;
    const t = Math.max(0, Math.min(tx, ty));
    return { x: cx + ux * t, y: cy + uy * t };
  }

  // Stable bend sign — derived from the cluster-pair key so parallel edges
  // between the same cluster pair always curve the same way, and neighbouring
  // pairs hash to different parities so they fan apart visually.
  function stableBendSign(fromKey, toKey) {
    const key = [fromKey, toKey].sort().join('|');
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h & 1) === 0 ? 1 : -1;
  }

  function bezierControls(p0x, p0y, p3x, p3y, bend) {
    const dx = p3x - p0x, dy = p3y - p0y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = -dy / dist, ny = dx / dist;
    return {
      p0: [p0x, p0y],
      p1: [p0x + 0.33 * dx + bend * nx, p0y + 0.33 * dy + bend * ny],
      p2: [p0x + 0.66 * dx + bend * nx, p0y + 0.66 * dy + bend * ny],
      p3: [p3x, p3y],
    };
  }

  function bezierPointAt(ctrl, t) {
    const mt = 1 - t;
    return [
      mt*mt*mt*ctrl.p0[0] + 3*mt*mt*t*ctrl.p1[0] + 3*mt*t*t*ctrl.p2[0] + t*t*t*ctrl.p3[0],
      mt*mt*mt*ctrl.p0[1] + 3*mt*mt*t*ctrl.p1[1] + 3*mt*t*t*ctrl.p2[1] + t*t*t*ctrl.p3[1],
    ];
  }

  // Clearance margin: how far a road must stay from any non-endpoint cluster's
  // AABB edge. Bumped from 20 to 36 because long cosmos-spanning bezier arcs
  // were clipping other clusters on the narrow side.
  const ROAD_CLEARANCE = 36;

  // 12-sample AABB test. Returns true if any interior sample lies inside
  // a non-excluded cluster's inflated AABB.
  function bezierIntersectsClusters(ctrl, clusterRects, excludeSet) {
    const samples = 12;
    for (let i = 1; i < samples - 1; i++) {
      const [x, y] = bezierPointAt(ctrl, i / (samples - 1));
      for (const [cid, r] of clusterRects) {
        if (excludeSet.has(cid)) continue;
        if (x >= r.minX - ROAD_CLEARANCE && x <= r.maxX + ROAD_CLEARANCE &&
            y >= r.minY - ROAD_CLEARANCE && y <= r.maxY + ROAD_CLEARANCE) return true;
      }
    }
    return false;
  }

  // Like the check above, but scores how many samples fall inside a non-
  // excluded cluster. Used as a fallback: if no candidate passes the binary
  // test, pick the one that intrudes the least instead of keeping whichever
  // we tried last.
  function bezierIntersectionCount(ctrl, clusterRects, excludeSet) {
    const samples = 12;
    let count = 0;
    for (let i = 1; i < samples - 1; i++) {
      const [x, y] = bezierPointAt(ctrl, i / (samples - 1));
      for (const [cid, r] of clusterRects) {
        if (excludeSet.has(cid)) continue;
        if (x >= r.minX - ROAD_CLEARANCE && x <= r.maxX + ROAD_CLEARANCE &&
            y >= r.minY - ROAD_CLEARANCE && y <= r.maxY + ROAD_CLEARANCE) {
          count++;
          break;
        }
      }
    }
    return count;
  }

  // True if (px, py) lies inside the inflated AABB of any non-excluded cluster.
  function pointInsideAnyCluster(px, py, clusterRects, excludeSet) {
    for (const [cid, r] of clusterRects) {
      if (excludeSet.has(cid)) continue;
      if (px >= r.minX - ROAD_CLEARANCE && px <= r.maxX + ROAD_CLEARANCE &&
          py >= r.minY - ROAD_CLEARANCE && py <= r.maxY + ROAD_CLEARANCE) return true;
    }
    return false;
  }

  // Push an endpoint along (ux, uy) in 12-px steps up to 8 tries until it
  // exits every non-endpoint cluster's inflated AABB. Returns the possibly-
  // nudged (x, y); caller decides whether to drop the road if still stuck.
  function nudgeEndpointOut(x, y, ux, uy, clusterRects, excludeSet) {
    let nx = x, ny = y;
    for (let i = 0; i < 8; i++) {
      if (!pointInsideAnyCluster(nx, ny, clusterRects, excludeSet)) return { x: nx, y: ny, ok: true };
      nx += ux * 12;
      ny += uy * 12;
    }
    return { x: nx, y: ny, ok: !pointInsideAnyCluster(nx, ny, clusterRects, excludeSet) };
  }

  // De Casteljau sampling with tangent + normal + cumulative arc length.
  function sampleBezier(p0, p1, p2, p3) {
    const chord = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
    const cnet =
      Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) +
      Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) +
      Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
    const roughLen = (chord + cnet) / 2;
    const count = Math.max(16, Math.ceil(roughLen / 40));
    const out = [];
    let cumLen = 0;
    let prevX = p0[0], prevY = p0[1];
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const mt = 1 - t;
      const x = mt*mt*mt*p0[0] + 3*mt*mt*t*p1[0] + 3*mt*t*t*p2[0] + t*t*t*p3[0];
      const y = mt*mt*mt*p0[1] + 3*mt*mt*t*p1[1] + 3*mt*t*t*p2[1] + t*t*t*p3[1];
      const tx = 3*mt*mt*(p1[0]-p0[0]) + 6*mt*t*(p2[0]-p1[0]) + 3*t*t*(p3[0]-p2[0]);
      const ty = 3*mt*mt*(p1[1]-p0[1]) + 6*mt*t*(p2[1]-p1[1]) + 3*t*t*(p3[1]-p2[1]);
      const tmag = Math.hypot(tx, ty) || 1;
      if (i > 0) cumLen += Math.hypot(x - prevX, y - prevY);
      out.push({
        t, x, y,
        tx: tx / tmag, ty: ty / tmag,
        nx: -ty / tmag, ny: tx / tmag,
        cumLen,
      });
      prevX = x; prevY = y;
    }
    return out;
  }

  function sampleAt(samples, s) {
    if (s <= 0) return samples[0];
    const last = samples[samples.length - 1];
    if (s >= last.cumLen) return last;
    let lo = 0, hi = samples.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].cumLen < s) lo = mid; else hi = mid;
    }
    const a = samples[lo], b = samples[hi];
    const span = (b.cumLen - a.cumLen) || 1;
    const k = (s - a.cumLen) / span;
    return {
      t: a.t + (b.t - a.t) * k,
      x: a.x + (b.x - a.x) * k,
      y: a.y + (b.y - a.y) * k,
      tx: a.tx + (b.tx - a.tx) * k,
      ty: a.ty + (b.ty - a.ty) * k,
      nx: a.nx + (b.nx - a.nx) * k,
      ny: a.ny + (b.ny - a.ny) * k,
      cumLen: s,
    };
  }

  /* ────────── road geometry (shared between renderer and physics) ────────── */

  // Build inter-cluster road geometry. One road per (fromCluster, toCluster)
  // pair — multiple prerequisites between the same pair of clusters collapse
  // into a single road that attaches to the cluster AABB edges (so the cluster
  // reads as a single block). Intra-cluster edges have no visible road;
  // walkers wander freely inside the cluster AABB.
  function buildRoadGeometry(projectList, layout, clusterRects) {
    // Dedupe: keep the first prereq relation encountered per cluster pair.
    const pairs = new Map();
    projectList.forEach(p => {
      if (!layout.has(p.id)) return;
      (p.unlocks || []).forEach(cid => {
        if (!layout.has(cid)) return;
        const from = layout.get(p.id);
        const to = layout.get(cid);
        if (from.clusterId === to.clusterId) return; // no visible road inside a cluster
        const key = `${from.clusterId}|${to.clusterId}`;
        if (pairs.has(key)) return;
        pairs.set(key, {
          fromId: p.id, toId: cid,
          fromClusterId: from.clusterId, toClusterId: to.clusterId,
          fromIsCosmic: from.isCosmic, toIsCosmic: to.isCosmic,
        });
      });
    });

    const out = new Map();
    pairs.forEach((pair, key) => {
      const fromRect = clusterRects.get(pair.fromClusterId);
      const toRect = clusterRects.get(pair.toClusterId);
      if (!fromRect || !toRect) return;

      // Ray from one cluster center toward the other — clip at each cluster's
      // AABB edge so the road emerges from the cluster's boundary, not its center.
      const dx = toRect.cx - fromRect.cx;
      const dy = toRect.cy - fromRect.cy;
      const dist = Math.hypot(dx, dy) || 1;
      const ux = dx / dist, uy = dy / dist;
      const aExit = rayExitAABB(fromRect.cx, fromRect.cy, ux, uy, fromRect);
      const bExit = rayExitAABB(toRect.cx, toRect.cy, -ux, -uy, toRect);
      let x1 = aExit.x + ux * CLUSTER_EDGE_PAD;
      let y1 = aExit.y + uy * CLUSTER_EDGE_PAD;
      let x2 = bExit.x - ux * CLUSTER_EDGE_PAD;
      let y2 = bExit.y - uy * CLUSTER_EDGE_PAD;

      const exclude = new Set([pair.fromClusterId, pair.toClusterId]);

      // Endpoint nudge: if the ray-exit point from one cluster lands inside
      // a third cluster's AABB (common when clusters are packed tight, e.g.
      // Xandar→Sovereign grazing Knowhere), push the endpoint further along
      // the road direction until it clears. If it can't clear after 8 steps
      // the road would pass through another location no matter what we do
      // — drop it entirely.
      const fromNudge = nudgeEndpointOut(x1, y1, ux, uy, clusterRects, exclude);
      const toNudge = nudgeEndpointOut(x2, y2, -ux, -uy, clusterRects, exclude);
      if (!fromNudge.ok || !toNudge.ok) return;
      x1 = fromNudge.x; y1 = fromNudge.y;
      x2 = toNudge.x;   y2 = toNudge.y;

      const segLen = Math.hypot(x2 - x1, y2 - y1);
      if (segLen < 1) return; // clusters abutting — skip degenerate road

      const crossCosmos = pair.fromIsCosmic !== pair.toIsCosmic;
      const baseSign = stableBendSign(pair.fromClusterId, pair.toClusterId);
      const baseMagnitude = Math.min(segLen * 0.22, 220) * (crossCosmos ? 1.5 : 1);
      let bend = baseMagnitude * baseSign;
      let ctrl = bezierControls(x1, y1, x2, y2, bend);

      // Try 8 bend candidates ordered cheapest-visual-change first: both
      // signs at 1.0×, then both at 1.8×, 2.7×, 3.8×. If none clears cleanly
      // keep the LEAST-intersecting curve (by sample count) rather than
      // whichever was tried last.
      if (bezierIntersectsClusters(ctrl, clusterRects, exclude)) {
        const magnitudes = [1.0, 1.8, 2.7, 3.8];
        const candidates = [];
        for (const mag of magnitudes) {
          candidates.push(baseSign * baseMagnitude * mag);
          candidates.push(-baseSign * baseMagnitude * mag);
        }
        let bestCtrl = ctrl;
        let bestCount = bezierIntersectionCount(ctrl, clusterRects, exclude);
        let bestBend = bend;
        let cleared = false;
        for (const b of candidates) {
          const tryCtrl = bezierControls(x1, y1, x2, y2, b);
          if (!bezierIntersectsClusters(tryCtrl, clusterRects, exclude)) {
            ctrl = tryCtrl;
            bend = b;
            cleared = true;
            break;
          }
          const c = bezierIntersectionCount(tryCtrl, clusterRects, exclude);
          if (c < bestCount) { bestCount = c; bestCtrl = tryCtrl; bestBend = b; }
        }
        if (!cleared) { ctrl = bestCtrl; bend = bestBend; }
      }

      const samples = sampleBezier(ctrl.p0, ctrl.p1, ctrl.p2, ctrl.p3);
      const length = samples[samples.length - 1].cumLen;
      out.set(key, {
        key,
        type: 'bezier',
        fromId: pair.fromId, toId: pair.toId,
        fromClusterId: pair.fromClusterId, toClusterId: pair.toClusterId,
        fromIsCosmic: pair.fromIsCosmic, toIsCosmic: pair.toIsCosmic,
        p0: ctrl.p0, p1: ctrl.p1, p2: ctrl.p2, p3: ctrl.p3,
        samples,
        length,
        halfW: ROAD_HALF_W,
        pathD: `M ${ctrl.p0[0]} ${ctrl.p0[1]} C ${ctrl.p1[0]} ${ctrl.p1[1]}, ${ctrl.p2[0]} ${ctrl.p2[1]}, ${ctrl.p3[0]} ${ctrl.p3[1]}`,
      });
    });
    return out;
  }

  return {
    computeLayout,
    computeClusterRects,
    buildRoadGeometry,
    sampleAt,
  };
})();
