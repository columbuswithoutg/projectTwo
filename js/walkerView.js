/************************************************
 * WALKER VIEW ADAPTER
 *
 * Walkers were originally written assuming the geographic map renderer
 * (camera, world coordinates, location clusters, road geometry). This
 * adapter lets the same walker code run on the watch-order flowchart
 * view by routing every view-specific call through a swappable backend.
 *
 * The map view sets MapWalkerAdapter; the flow view sets FlowWalkerAdapter.
 * Each implementation must expose every method below — even if it returns
 * a no-op (e.g., flow view has no fight-zoom camera).
 ************************************************/
const WalkerView = (() => {
  let active = null;

  function set(adapter) { active = adapter; }
  function get() { return active; }
  function has() { return !!active; }

  return { set, get, has };
})();

// ─── Map Adapter ───────────────────────────────────────────────────────
// Wraps the existing geographic map renderer. Behavior is exactly what
// walkers.js used to do directly against `renderer` and the global
// layout helpers — just routed through methods.
const MapWalkerAdapter = {
  container: () => renderer.mapContainer,
  nodeElement: (id) => renderer.nodeElements?.get(id),
  nodePosition: (id) => getNodePosition(id),
  clusterOf: (id) => {
    const pos = getNodePosition(id);
    return pos ? pos.clusterId : null;
  },
  clusterRect: (clusterId) => getClusterRects().get(clusterId),
  allClusterRects: () => getClusterRects(),
  roadGeometry: () => getRoadGeometry(),
  layoutVersion: () => getLayoutVersion(),

  // Camera / fight-zoom — real on the map.
  wrapper: () => renderer.wrapper,
  worldZoom: () => renderer.worldZoom,
  panX: () => renderer.panX,
  panY: () => renderer.panY,
  isCameraLocked: () => renderer.cameraLocked,
  setCameraLocked: (v) => { renderer.cameraLocked = v; },
  setCamera: (...args) => renderer._setCamera(...args),
  cancelTween: () => renderer._cancelTween?.(),

  // Centre the viewport on a single point — used by dialogue framing.
  // Map: pan camera (gentle min-zoom of 0.9 like the original behaviour).
  centerOn(x, y) {
    if (!renderer.wrapper) return;
    renderer._setCamera(Math.max(renderer.worldZoom || 1, 0.9), x, y, true);
  },

  // Fight zoom — frame the rect at ~80% of viewport via a CSS transform
  // on #map-container. Composes with the outer world zoom/pan.
  _releaseTimer: null,
  zoomToCluster(rect, fallbackPos) {
    const wrapper = renderer.wrapper;
    if (!wrapper) return;
    if (typeof renderer._cancelTween === 'function') renderer._cancelTween();
    // Cancel any pending release-cleanup from a previous fight — otherwise
    // its 520ms timer would fire mid-fight and clear our fresh transform.
    if (this._releaseTimer) {
      clearTimeout(this._releaseTimer);
      this._releaseTimer = null;
    }
    const wRect = wrapper.getBoundingClientRect();
    const worldZ = renderer.worldZoom || 1;
    const targetW = rect ? rect.width : (typeof CONFIG !== 'undefined' ? CONFIG.NODE_WIDTH : 100);
    const targetH = rect ? rect.height : (typeof CONFIG !== 'undefined' ? CONFIG.NODE_HEIGHT : 100);
    const centerX = rect ? rect.cx : (fallbackPos?.x || 0);
    const centerY = rect ? rect.cy : (fallbackPos?.y || 0);
    const rawScale = Math.min(
      (wRect.width * 0.8) / (targetW * worldZ),
      (wRect.height * 0.8) / (targetH * worldZ)
    );
    const innerScale = Math.max(0.3, Math.min(3, rawScale));
    const effectiveScale = worldZ * innerScale;
    const tx = (wRect.width / 2 - renderer.panX) / effectiveScale - centerX;
    const ty = (wRect.height / 2 - renderer.panY) / effectiveScale - centerY;
    const container = renderer.mapContainer;
    if (!container) return;
    container.style.transformOrigin = '0 0';
    container.style.transition = 'transform 0.5s ease';
    container.style.transform = `scale(${innerScale}) translate(${tx}px, ${ty}px)`;
    renderer.cameraLocked = true;
  },
  releaseZoom() {
    const container = renderer.mapContainer;
    if (!container) {
      renderer.cameraLocked = false;
      return;
    }
    container.style.transition = 'transform 0.5s ease';
    container.style.transform = '';
    if (this._releaseTimer) clearTimeout(this._releaseTimer);
    this._releaseTimer = setTimeout(() => {
      this._releaseTimer = null;
      if (container) {
        container.style.transformOrigin = '';
        container.style.transition = '';
      }
    }, 520);
    renderer.cameraLocked = false;
  },

  // Identity — used by walkers to gate map-only features (fight zoom, etc.)
  isMap: true,
};

// ─── Flow Adapter ──────────────────────────────────────────────────────
// Adapts the watch-order flowchart renderer. Geographic concepts have
// flow-equivalents:
//   - "container" = .flow-walkers (a sibling of .flow-nodes)
//   - "cluster" = MCU phase (so walkers wander inside their phase)
//   - "road" = prerequisite edge
//   - "camera" = no-op (flow uses native browser scroll)
const FlowWalkerAdapter = {
  container: () => document.querySelector('.flow-walkers'),
  nodeElement: (id) => {
    const cell = orderRenderer.nodeElements.get(id);
    return cell ? cell.querySelector('.node') : null;
  },
  nodePosition: (id) => {
    const p = state.byId?.get(id);
    if (!p) return null;
    const pos = orderRenderer._cellPos(p);
    return { x: pos.x, y: pos.y, clusterId: `phase-${p.phaseNum || 1}` };
  },
  // On the flow view each project IS its own cluster — walkers stand at a
  // single node (the cluster) and walk along prerequisite edges to other
  // nodes. Phase-grouped clusters didn't model walker locomotion well.
  clusterOf: (id) => id,
  clusterRect: (clusterId) => buildFlowClusterRects().get(clusterId),
  allClusterRects: () => buildFlowClusterRects(),
  // Walkers traverse straight roads between nodes. The visible arrows in
  // orderRenderer.renderArrows use the same straight-line geometry so
  // walkers visibly travel along the roads rather than appearing to float
  // in empty canvas space.
  roadGeometry: () => buildFlowRoadGeometry(),
  layoutVersion: () => getLayoutVersion(),

  // No persistent camera on the flow view — flow uses native scroll. The
  // wrapper/zoom/pan accessors return safe defaults so legacy fight code
  // doesn't NaN out, but the actual fight zoom is implemented via
  // zoomToCluster below.
  wrapper: () => null,
  worldZoom: () => 1,
  panX: () => 0,
  panY: () => 0,
  isCameraLocked: () => false,
  setCameraLocked: () => {},
  setCamera: () => {},
  cancelTween: () => {},

  // Centre the flow viewport on (x, y) via smooth scroll. Fight zoom is
  // off (no transform applied) so the scroll happens in regular canvas
  // coordinates. Used by dialogue framing.
  centerOn(x, y) {
    const wrapper = document.querySelector('.flow-wrapper');
    if (!wrapper) return;
    if (wrapper.classList.contains('fight-zoom')) return; // mid-fight, don't fight the zoom transform
    // x/y arrive in unscaled canvas units; scroll offsets are scaled pixels.
    const z = (typeof orderRenderer !== 'undefined' && orderRenderer.zoom) || 1;
    wrapper.scrollTo({
      left: Math.max(0, x * z - wrapper.clientWidth / 2),
      top: Math.max(0, y * z - wrapper.clientHeight / 2),
      behavior: 'smooth',
    });
  },

  // Fight zoom on the flow view = scroll-and-scale the .flow-zoom layer (the
  // same layer the user's own zoom drives, so the two can't both be applied at
  // once). We escape the wrapper's native scroll for the duration of the fight
  // (.fight-zoom class disables overflow), apply a CSS transform that
  // centers the cluster at viewport center, then restore on release.
  _savedScroll: null,
  _releaseTimer: null,
  zoomToCluster(rect, fallbackPos) {
    const wrapper = document.querySelector('.flow-wrapper');
    const canvas = document.querySelector('.flow-zoom') || document.querySelector('.flow-canvas');
    if (!wrapper || !canvas) return;
    // Cancel any pending release cleanup from a previous fight — otherwise
    // its setTimeout fires mid-fight, removes .fight-zoom, and unlocks the
    // wrapper's scroll right when the user shouldn't be able to scroll.
    if (this._releaseTimer) {
      clearTimeout(this._releaseTimer);
      this._releaseTimer = null;
    }
    // Only save scroll if we don't already have one stashed (back-to-back
    // fights without a release shouldn't overwrite the user's true position).
    if (!this._savedScroll) {
      this._savedScroll = { left: wrapper.scrollLeft, top: wrapper.scrollTop };
    }
    const wRect = wrapper.getBoundingClientRect();
    // Frame the FULL fight visual, not just the cluster AABB. The AABB is
    // smaller than the visible node (insetted for rounded corners), and
    // HP bars hang ABOVE the walker (which itself can sit at the AABB top)
    // while the project label sits BELOW the node. On mobile, framing only
    // the AABB at 80% pushed HP bars and the node frame past the wrapper
    // top edge — looked clipped. Inflate the target to include this extra
    // visual extent before computing scale.
    const NODE_W = (typeof ORDER_CELL !== 'undefined' ? ORDER_CELL.nodeWidth : 110);
    const NODE_H = (typeof ORDER_CELL !== 'undefined' ? ORDER_CELL.nodeHeight : 150);
    const FIGHT_PAD_X = 30;   // small horizontal margin
    const FIGHT_PAD_Y = 80;   // ~25px HP bar above + ~30px label below + breathing
    const targetW = Math.max(rect ? rect.width : 0, NODE_W) + FIGHT_PAD_X;
    const targetH = Math.max(rect ? rect.height : 0, NODE_H) + FIGHT_PAD_Y;
    const centerX = rect ? rect.cx : (fallbackPos?.x || 0);
    const centerY = rect ? rect.cy : (fallbackPos?.y || 0);
    // Use a slightly tighter frame on narrow viewports — mobile headers
    // eat more relative vertical real estate, and the HP bar sits closer
    // to the wrapper top edge.
    const isNarrow = wRect.width < 640;
    const frameFactor = isNarrow ? 0.72 : 0.8;
    const rawScale = Math.min(
      (wRect.width * frameFactor) / targetW,
      (wRect.height * frameFactor) / targetH
    );
    const scale = Math.max(0.5, Math.min(4, rawScale));
    // The transform is applied to .flow-canvas with transform-origin 0 0
    // and the wrapper's scroll is locked at 0 — pan composes via translate.
    wrapper.scrollLeft = 0;
    wrapper.scrollTop = 0;
    const tx = wRect.width / 2 - centerX * scale;
    const ty = wRect.height / 2 - centerY * scale;
    canvas.style.transformOrigin = '0 0';
    canvas.style.transition = 'transform 0.5s ease';
    canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    wrapper.classList.add('fight-zoom');
  },
  releaseZoom() {
    const wrapper = document.querySelector('.flow-wrapper');
    const canvas = document.querySelector('.flow-zoom') || document.querySelector('.flow-canvas');
    if (!canvas) return;
    // Animate back to the USER's zoom, not to 1 — clearing the transform here
    // would silently throw away whatever level they'd set before the fight.
    const userZoom = (typeof orderRenderer !== 'undefined' && orderRenderer.zoom) || 1;
    canvas.style.transition = 'transform 0.5s ease';
    canvas.style.transform = userZoom === 1 ? 'scale(1)' : `scale(${userZoom})`;
    const saved = this._savedScroll;
    this._savedScroll = null;
    if (this._releaseTimer) clearTimeout(this._releaseTimer);
    this._releaseTimer = setTimeout(() => {
      this._releaseTimer = null;
      if (wrapper) {
        wrapper.classList.remove('fight-zoom');
        if (saved) {
          wrapper.scrollLeft = saved.left;
          wrapper.scrollTop = saved.top;
        }
      }
      if (canvas) {
        canvas.style.transition = '';
        // Hand the transform back to the renderer now that .fight-zoom is off
        // (it deliberately no-ops while the fight camera owns the layer).
        if (typeof orderRenderer !== 'undefined' && orderRenderer._applyZoom) {
          orderRenderer._applyZoom();
        } else {
          canvas.style.transform = '';
        }
      }
    }, 520);
  },

  isMap: false,
};

// Per-node clusters for the flow view. AABB matches the visible node
// bounds exactly so the walker bounce wall and the visible poster wall
// coincide. With walker radius 12 and pad = walker_r in bounceInsideNode,
// walker visual edge sits exactly at the node edge — and the math also
// keeps walkers inside the node's 8px rounded corners (diagonal-out point
// at corner positions lands at ~6.4px from corner center, inside the 8px
// arc). Earlier "bleeding past corner" reports were walkers in road
// transit between nodes, not AABB-bounded walkers.
function buildFlowClusterRects() {
  const rects = new Map();
  if (!orderRenderer || !orderRenderer.nodeElements) return rects;
  const halfW = ORDER_CELL.nodeWidth / 2;
  const halfH = ORDER_CELL.nodeHeight / 2;
  projects.forEach(p => {
    if (!orderRenderer._isShown(p)) return;
    const pos = orderRenderer._cellPos(p);
    rects.set(p.id, {
      id: p.id,
      minX: pos.x - halfW,
      maxX: pos.x + halfW,
      minY: pos.y - halfH,
      maxY: pos.y + halfH,
      cx: pos.x,
      cy: pos.y,
      width: halfW * 2,
      height: halfH * 2,
      memberIds: [p.id],
      memberPositions: [{ id: p.id, x: pos.x, y: pos.y }],
    });
  });
  return rects;
}

// Roads = prerequisite edges, routed rook-style by RoadRouter exactly as
// orderRenderer.renderArrows draws them (same view, same corner radius).
// Walker physics expects a Map<edgeKey, road> of sampled roads: points with
// cumulative length, tangent (tx, ty) and normal (nx, ny) — the shape
// LayoutSystem.sampleAt walks. Ends sit on the node boxes, where openings
// are detected.
function buildFlowRoadGeometry() {
  const roads = new Map();
  if (!orderRenderer || !orderRenderer.nodeElements || typeof RoadRouter === 'undefined') return roads;
  const routes = RoadRouter.route(projects);
  const view = orderRenderer._roadView();

  routes.roads.forEach(r => {
    if (!r.required) return;   // dashed trails aren't walkable roads
    const parent = state.byId?.get(r.fromId);
    const child = state.byId?.get(r.toId);
    if (!parent || !child) return;
    if (!orderRenderer._isShown(parent) || !orderRenderer._isShown(child)) return;
    const pts = RoadRouter.toView(r, view).points;
    const { samples, length } = RoadRouter.samplePolyline(pts, ORDER_CELL.roadRadius);
    if (samples.length < 2 || length <= 0) return;
    const first = samples[0], last = samples[samples.length - 1];
    roads.set(r.key, {
      key: r.key,
      type: 'path',
      fromId: r.fromId, toId: r.toId,
      fromClusterId: r.fromId, toClusterId: r.toId,
      fromIsCosmic: false, toIsCosmic: false,
      x1: first.x, y1: first.y, x2: last.x, y2: last.y,
      ux: first.tx, uy: first.ty,
      px: first.nx, py: first.ny,
      samples,
      length,
      halfW: 12,   // road corridor half-width — walker_r=12 fits inside
      pathD: RoadRouter.pathD(pts, ORDER_CELL.roadRadius),
    });
  });
  return roads;
}
