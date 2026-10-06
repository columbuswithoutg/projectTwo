/************************************************
 * ORDER RENDERER — Watch-Order Flowchart View
 * Positions all projects on a 2D grid using their gridX/gridY values
 * and draws SVG arrows between prerequisites.
 *
 * Navigation is drag-to-move + wheel-to-zoom (js/pan-zoom.js) over a native
 * scroll container whose scrollbars are hidden, plus a zoom layer:
 *
 *   .flow-wrapper   overflow:auto — its scroll offsets are the camera
 *     .flow-canvas  the SIZER. width/height = content × zoom, no transform.
 *       .flow-zoom  the transformed layer. Natural content size, scale(zoom).
 *         .flow-arrows / .flow-nodes / .flow-walkers
 *
 * The split matters: scrollable overflow is the union of an element's own
 * (transformed) box and its contents, so scaling a single element grows the
 * scroll area when you zoom IN but refuses to shrink it when you zoom OUT.
 * Keeping an untransformed sizer next to a transformed content layer makes the
 * scroll extent exactly content × zoom in both directions.
 *
 * Everything below .flow-zoom — node positions, walker physics, road geometry —
 * stays in UNSCALED canvas units. Zoom is purely a display transform, so
 * walkerView/walkers need no zoom awareness beyond converting scroll offsets.
 ************************************************/
class OrderRenderer {
  constructor() {
    this.wrapper = null;        // .flow-wrapper (scrolling container)
    this.canvas = null;         // .flow-canvas (sizer — drives scroll extent)
    this.zoomLayer = null;      // .flow-zoom (scaled content layer)
    this.svg = null;            // .flow-arrows (SVG layer)
    this.nodesContainer = null; // .flow-nodes
    this.nodeElements = new Map();
    this.zoom = 1;
    this._unsubscribeState = null;
    this._listeners = [];
    this._didInitialCenter = false;
    this._zoomUi = null;
  }

  init() {
    this.wrapper = $(".flow-wrapper");
    this.canvas = $(".flow-canvas");
    this.svg = $(".flow-arrows");
    this.nodesContainer = $(".flow-nodes");
    this.nodeElements = new Map();
    this._didInitialCenter = false;

    this._ensureZoomLayer();
    this.zoom = this._loadZoom();

    this.setupEventDelegation();
    this.setupPanControls();
    this.setupZoomControls();
    this._buildZoomUi();

    if (this._unsubscribeState) this._unsubscribeState();
    this._unsubscribeState = state.subscribe(() => this.render());
  }

  // Slip a transformed layer between the sizer and the content, moving the
  // existing children into it. Done in JS rather than in each view's markup so
  // the watch-order route and /friend/:username both get it from the one module
  // that owns this geometry. Idempotent — a remount reuses the existing layer.
  _ensureZoomLayer() {
    if (!this.canvas) { this.zoomLayer = null; return; }
    let layer = this.canvas.querySelector(':scope > .flow-zoom');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'flow-zoom';
      while (this.canvas.firstChild) layer.appendChild(this.canvas.firstChild);
      this.canvas.appendChild(layer);
    }
    this.zoomLayer = layer;
  }

  setupEventDelegation() {
    // Click anywhere on the cell (poster OR label) — the label sits outside
    // the .node element so .closest('.node') would miss label clicks.
    const onClick = (e) => {
      const cell = e.target.closest(".flow-cell");
      if (!cell) return;
      const id = cell.dataset.id;
      const project = state.byId.get(id);
      if (!project) return;
      if (!isUnlocked(project) && !state.isWatched(project.id)) return;
      showPopup(project);
    };
    this.nodesContainer.addEventListener("click", onClick);
    this._listeners.push({ target: this.nodesContainer, event: "click", handler: onClick });
  }

  // Drag to move, wheel to zoom (js/pan-zoom.js). A drag may start anywhere —
  // on a poster too (posters cover most of the chart); a press that doesn't
  // move still clicks the poster open. The wrapper keeps overflow:auto — its
  // scroll offsets are the camera the walker-fight framing drives as well —
  // but hides its scrollbars: the chart only moves by dragging.
  setupPanControls() {
    if (!this.wrapper) return;
    if (this._panZoom) this._panZoom.destroy();
    this._panZoom = PanZoom.attach(this.wrapper, {
      min: ORDER_ZOOM.min,
      max: ORDER_ZOOM.max,
      getZoom: () => this.zoom,
      setZoom: (z, ax, ay) => this.setZoom(z, ax, ay),
      // A walker fight owns the transform and the scroll offsets.
      isLocked: () => this.wrapper.classList.contains('fight-zoom')
    });
  }

  // Compute pixel position for a project on the flowchart canvas.
  // gridX may be negative — we shift by minX so the leftmost column is 0.
  _getBounds() {
    if (this._bounds) return this._bounds;
    const xs = projects.map(p => p.gridX ?? 0);
    const ys = projects.map(p => p.gridY ?? 0);
    this._bounds = {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
    return this._bounds;
  }

  _cellPos(project) {
    const b = this._getBounds();
    const cw = ORDER_CELL.width;
    const ch = ORDER_CELL.height;
    const x = ((project.gridX ?? 0) - b.minX) * cw + cw / 2;
    const y = ((project.gridY ?? 0) - b.minY) * ch + ch / 2;
    return { x, y };
  }

  _sizeCanvas() {
    const b = this._getBounds();
    const cols = (b.maxX - b.minX) + 1;
    const rows = (b.maxY - b.minY) + 1;
    const w = cols * ORDER_CELL.width;
    const h = rows * ORDER_CELL.height;
    // The sizer carries the SCALED size (that's the scroll extent); the zoom
    // layer and everything under it stay at natural size and get scaled.
    this.canvas.style.width = `${w * this.zoom}px`;
    this.canvas.style.height = `${h * this.zoom}px`;
    if (this.zoomLayer) {
      this.zoomLayer.style.width = `${w}px`;
      this.zoomLayer.style.height = `${h}px`;
    }
    this.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    this.svg.setAttribute("width", w);
    this.svg.setAttribute("height", h);
    this._applyZoom();
  }

  /* ── Zoom ───────────────────────────────────────────────────────────── */

  _clampZoom(z) {
    if (!isFinite(z)) return 1;
    return Math.min(ORDER_ZOOM.max, Math.max(ORDER_ZOOM.min, z));
  }

  _loadZoom() {
    try {
      const v = parseFloat(localStorage.getItem(ORDER_ZOOM.storageKey));
      return isFinite(v) ? this._clampZoom(v) : 1;
    } catch (_) { return 1; }
  }

  // Debounced: a trackpad pinch or a wheel spin fires dozens of zoom steps.
  _saveZoom() {
    clearTimeout(this._saveZoomTimer);
    this._saveZoomTimer = setTimeout(() => {
      try { localStorage.setItem(ORDER_ZOOM.storageKey, String(this.zoom)); } catch (_) {}
    }, 250);
  }

  // Push the current zoom onto the transform layer. Skipped while a walker
  // fight owns the transform — releaseZoom() calls back here once it's done,
  // so the user's zoom is restored instead of being reset to 1.
  _applyZoom() {
    if (!this.zoomLayer) return;
    if (this.wrapper && this.wrapper.classList.contains('fight-zoom')) return;
    this.zoomLayer.style.transform = this.zoom === 1 ? '' : `scale(${this.zoom})`;
  }

  // Zoom to an absolute level, keeping the content point under (ax, ay) fixed
  // on screen. ax/ay are pixels from the wrapper's top-left; omit them to
  // anchor on the middle of the viewport (buttons, keyboard).
  setZoom(next, ax, ay) {
    const wrapper = this.wrapper;
    if (!wrapper || !this.zoomLayer) return;
    // A walker fight owns the transform and the scroll offsets until it
    // releases. Changing zoom now would desync the sizer from the transform
    // the fight camera is driving, and releaseZoom() would restore the wrong
    // level. Every input path checks this too; this is the backstop.
    if (wrapper.classList.contains('fight-zoom')) return;
    const z0 = this.zoom;
    const z1 = this._clampZoom(next);
    if (Math.abs(z1 - z0) < 0.0005) return;

    if (ax == null) ax = wrapper.clientWidth / 2;
    if (ay == null) ay = wrapper.clientHeight / 2;
    // Unscaled canvas coordinates of whatever is under the anchor right now.
    const cx = (wrapper.scrollLeft + ax) / z0;
    const cy = (wrapper.scrollTop + ay) / z0;

    this.zoom = z1;
    this._sizeCanvas();          // resize the sizer + re-apply the transform
    // Put that same content point back under the anchor. Clamping to >= 0 is
    // what the browser would do anyway, and keeps the numbers honest.
    wrapper.scrollLeft = Math.max(0, cx * z1 - ax);
    wrapper.scrollTop = Math.max(0, cy * z1 - ay);

    this._saveZoom();
    this._syncZoomUi();
  }

  zoomBy(factor, ax, ay) {
    this.setZoom(this.zoom * factor, ax, ay);
  }

  // Back to 1:1, re-centred on where the user left off. Zooming out far and
  // then resetting would otherwise leave them staring at a corner.
  resetZoom() {
    this.setZoom(1);
    this.centerOnLastWatched();
    this._syncZoomUi();
  }

  setupZoomControls() {
    const wrapper = this.wrapper;
    if (!wrapper) return;
    const on = (target, event, handler, opts) => {
      target.addEventListener(event, handler, opts);
      this._listeners.push({ target, event, handler, opts });
    };
    const locked = () => wrapper.classList.contains('fight-zoom');

    // Wheel (zoom at the cursor) and two-finger pinch live in js/pan-zoom.js
    // (setupPanControls). Keyboard: +/- to step, 0 to reset — never while
    // typing or behind an open dialog.
    on(window, 'keydown', (e) => {
      if (shouldIgnoreGlobalKey(e)) return;
      if (locked()) return;
      // Ctrl/⌘ +/- is the browser's own page zoom — don't steal it.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      switch (e.key) {
        case '+': case '=':
          this.zoomBy(ORDER_ZOOM.step); e.preventDefault(); break;
        case '-': case '_':
          this.zoomBy(1 / ORDER_ZOOM.step); e.preventDefault(); break;
        case '0':
          this.resetZoom(); e.preventDefault(); break;
      }
    });
  }

  // Floating − / + buttons (no percentage readout; the 0 key still resets).
  // Built here (not in the view markup) so every view that mounts the
  // flowchart gets them, and torn down in destroy().
  _buildZoomUi() {
    if (!this.wrapper || !this.wrapper.parentNode) return;
    this.wrapper.parentNode.querySelectorAll('.flow-zoom-ui').forEach(el => el.remove());

    const ui = document.createElement('div');
    ui.className = 'flow-zoom-ui';
    ui.innerHTML = `
      <button type="button" class="flow-zoom-btn" data-act="out" aria-label="Zoom out" title="Zoom out (−)">−</button>
      <button type="button" class="flow-zoom-btn" data-act="in" aria-label="Zoom in" title="Zoom in (+)">+</button>
    `;
    const onClick = (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      if (btn.dataset.act === 'in') this.zoomBy(ORDER_ZOOM.step);
      else this.zoomBy(1 / ORDER_ZOOM.step);
    };
    ui.addEventListener('click', onClick);
    this._listeners.push({ target: ui, event: 'click', handler: onClick });

    this.wrapper.parentNode.appendChild(ui);
    this._zoomUi = ui;
    this._syncZoomUi();
  }

  _syncZoomUi() {
    if (!this._zoomUi) return;
    const out = this._zoomUi.querySelector('[data-act="out"]');
    const inn = this._zoomUi.querySelector('[data-act="in"]');
    if (out) out.disabled = this.zoom <= ORDER_ZOOM.min + 0.0005;
    if (inn) inn.disabled = this.zoom >= ORDER_ZOOM.max - 0.0005;
  }

  render() {
    if (!this.nodesContainer) return;
    this._sizeCanvas();
    this.renderNodes();
    this.renderArrows();
    if (!this._didInitialCenter) {
      this._didInitialCenter = true;
      requestAnimationFrame(() => this.centerOnLastWatched());
    }
  }

  // A project is shown on the flowchart if it's been watched OR if it's
  // unlocked (prereqs met) and waiting to be watched. Locked projects stay
  // hidden — same model as the map, where unwatched-but-locked never appears.
  _isShown(project) {
    return state.isWatched(project.id) || isUnlocked(project);
  }

  renderNodes() {
    // The .flow-cell wrapper is wider than the node (cellWidth 130 vs nodeWidth
    // 110) so longer titles can wrap below the poster. Position the cell using
    // its OWN half-width so the cell center — and the node centered inside it
    // via flex — lands exactly at pos.x. Using halfW=nodeWidth/2 here would
    // shift the visible node 10px right of pos.x, causing walker AABB
    // misalignment (bounces too early on right, bleeds past left).
    const halfCellW = ORDER_CELL.cellWidth / 2;
    const halfH = ORDER_CELL.nodeHeight / 2;

    const shownIds = new Set();
    projects.forEach(p => { if (this._isShown(p)) shownIds.add(p.id); });

    // Drop cells for projects that are no longer shown (e.g., a prereq
    // got un-watched, locking this one again).
    this.nodeElements.forEach((cell, id) => {
      if (!shownIds.has(id)) {
        cell.remove();
        this.nodeElements.delete(id);
      }
    });

    projects.forEach(project => {
      if (!this._isShown(project)) return;

      let cell = this.nodeElements.get(project.id);
      if (!cell) {
        cell = document.createElement("div");
        cell.className = "flow-cell";
        cell.dataset.id = project.id;

        const node = NodeFactory.create(project);
        node.style.width = `${ORDER_CELL.nodeWidth}px`;
        node.style.height = `${ORDER_CELL.nodeHeight}px`;
        cell.appendChild(node);

        const label = document.createElement("div");
        label.className = "flow-label";
        label.textContent = project.title || project.id;
        cell.appendChild(label);

        const pos = this._cellPos(project);
        cell.style.left = `${pos.x - halfCellW}px`;
        cell.style.top = `${pos.y - halfH}px`;

        this.nodesContainer.appendChild(cell);
        this.nodeElements.set(project.id, cell);
      } else {
        const node = cell.querySelector(".node");
        if (node) NodeFactory.updateState(node, project);
      }
    });
  }

  renderArrows() {
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    this._ensureArrowhead();

    // Straight roads between AABB perimeters — geometry MUST match the walker
    // road geometry in walkerView.buildFlowRoadGeometry so walkers visibly
    // travel along the rendered roads (no floating-in-empty-space effect).
    const halfW = ORDER_CELL.nodeWidth / 2;
    const halfH = ORDER_CELL.nodeHeight / 2;

    projects.forEach(child => {
      // Skip arrows for hidden (locked) child nodes — no point pointing at
      // a card that isn't on screen.
      if (!this._isShown(child)) return;

      (child.prerequisites || []).forEach(parentId => {
        const parent = state.byId?.get(parentId);
        if (!parent) return;
        if (!this._isShown(parent)) return;

        const cFrom = this._cellPos(parent);
        const cTo = this._cellPos(child);
        const dx = cTo.x - cFrom.x;
        const dy = cTo.y - cFrom.y;
        const len = Math.hypot(dx, dy);
        if (len === 0) return;
        const ux = dx / len;
        const uy = dy / len;
        // Clip endpoints to the AABB perimeter — same as walker roads.
        const exit = this._aabbExitDist(halfW, halfH, ux, uy);
        const fromX = cFrom.x + ux * exit;
        const fromY = cFrom.y + uy * exit;
        const toX = cTo.x - ux * exit;
        const toY = cTo.y - uy * exit;

        const d = `M ${fromX} ${fromY} L ${toX} ${toY}`;
        this._buildFlowRoad(d).forEach(el => this.svg.appendChild(el));
      });

      // Recommended (optional) prerequisites: a faint dashed trail, not a
      // road — they never lock anything, so they shouldn't read as a path
      // you're forced down.
      (child.recommendedPrerequisites || []).forEach(parentId => {
        const parent = state.byId?.get(parentId);
        if (!parent || !this._isShown(parent)) return;
        const cFrom = this._cellPos(parent);
        const cTo = this._cellPos(child);
        const dx = cTo.x - cFrom.x;
        const dy = cTo.y - cFrom.y;
        const len = Math.hypot(dx, dy);
        if (len === 0) return;
        const ux = dx / len;
        const uy = dy / len;
        const exit = this._aabbExitDist(halfW, halfH, ux, uy);
        const trail = document.createElementNS("http://www.w3.org/2000/svg", "path");
        trail.setAttribute("d", `M ${cFrom.x + ux * exit} ${cFrom.y + uy * exit} L ${cTo.x - ux * exit} ${cTo.y - uy * exit}`);
        trail.setAttribute("class", "flow-road-recommended");
        trail.setAttribute("stroke", "rgba(201, 162, 39, 0.45)");
        trail.setAttribute("stroke-width", "3");
        trail.setAttribute("stroke-dasharray", "8 10");
        trail.setAttribute("stroke-linecap", "round");
        trail.setAttribute("fill", "none");
        this.svg.appendChild(trail);
      });
    });
  }

  _aabbExitDist(halfW, halfH, ux, uy) {
    const tx = Math.abs(ux) > 1e-6 ? halfW / Math.abs(ux) : Infinity;
    const ty = Math.abs(uy) > 1e-6 ? halfH / Math.abs(uy) : Infinity;
    return Math.min(tx, ty);
  }

  _buildFlowRoad(d) {
    const ns = "http://www.w3.org/2000/svg";
    const elements = [];

    // Classes let each theme restyle the road in CSS (a CSS stroke beats
    // these presentation attributes, which stay as the fallback look).
    const roadBase = document.createElementNS(ns, "path");
    roadBase.setAttribute("class", "flow-road-base");
    roadBase.setAttribute("d", d);
    roadBase.setAttribute("stroke", "rgba(201, 162, 39, 0.12)");
    roadBase.setAttribute("stroke-width", "16");
    roadBase.setAttribute("stroke-linecap", "round");
    roadBase.setAttribute("fill", "none");
    elements.push(roadBase);

    const laneOuter = document.createElementNS(ns, "path");
    laneOuter.setAttribute("class", "flow-road-edge");
    laneOuter.setAttribute("d", d);
    laneOuter.setAttribute("stroke", "rgba(201, 162, 39, 0.28)");
    laneOuter.setAttribute("stroke-width", "18");
    laneOuter.setAttribute("stroke-linecap", "round");
    laneOuter.setAttribute("fill", "none");
    laneOuter.setAttribute("opacity", "0.5");
    elements.push(laneOuter);

    const laneInner = document.createElementNS(ns, "path");
    laneInner.setAttribute("class", "flow-road-lane");
    laneInner.setAttribute("d", d);
    laneInner.setAttribute("stroke", "rgba(10, 12, 20, 0.55)");
    laneInner.setAttribute("stroke-width", "14");
    laneInner.setAttribute("stroke-linecap", "round");
    laneInner.setAttribute("fill", "none");
    elements.push(laneInner);

    const dash = document.createElementNS(ns, "path");
    dash.setAttribute("class", "flow-road-dash");
    dash.setAttribute("d", d);
    dash.setAttribute("stroke", "rgba(255, 255, 255, 0.22)");
    dash.setAttribute("stroke-width", "1.5");
    dash.setAttribute("stroke-dasharray", "8 12");
    dash.setAttribute("fill", "none");
    elements.push(dash);

    const arrow = document.createElementNS(ns, "path");
    arrow.setAttribute("d", d);
    arrow.setAttribute("stroke", "none");
    arrow.setAttribute("fill", "none");
    arrow.setAttribute("marker-end", "url(#flow-arrowhead)");
    elements.push(arrow);

    return elements;
  }

  _ensureArrowhead() {
    const ns = "http://www.w3.org/2000/svg";
    const defs = document.createElementNS(ns, "defs");
    const marker = document.createElementNS(ns, "marker");
    marker.id = "flow-arrowhead";
    marker.setAttribute("markerWidth", "8");
    marker.setAttribute("markerHeight", "6");
    marker.setAttribute("refX", "7");
    marker.setAttribute("refY", "3");
    marker.setAttribute("orient", "auto");
    const tip = document.createElementNS(ns, "path");
    tip.setAttribute("class", "flow-road-tip");
    tip.setAttribute("d", "M0,0 L0,6 L7,3 Z");
    tip.setAttribute("fill", "rgba(201, 162, 39, 0.7)");
    marker.appendChild(tip);
    defs.appendChild(marker);
    this.svg.appendChild(defs);
  }

  centerOnLastWatched() {
    const id = state.getLastWatchedId();
    const project = state.byId?.get(id);
    if (!project || !this.wrapper) return;
    const pos = this._cellPos(project);
    const z = this.zoom;
    const w = this.wrapper.clientWidth;
    const h = this.wrapper.clientHeight;
    // _cellPos is in unscaled canvas units; scroll is in scaled screen px.
    this.wrapper.scrollLeft = Math.max(0, pos.x * z - w / 2);
    this.wrapper.scrollTop = Math.max(0, pos.y * z - h / 2);
  }

  destroy() {
    if (this._unsubscribeState) {
      this._unsubscribeState();
      this._unsubscribeState = null;
    }
    this._listeners.forEach(({ target, event, handler, opts }) => {
      target.removeEventListener(event, handler, opts);
    });
    this._listeners = [];
    if (this._panZoom) {
      this._panZoom.destroy();
      this._panZoom = null;
    }
    if (this._zoomUi) {
      this._zoomUi.remove();
      this._zoomUi = null;
    }
    this.nodeElements = new Map();
    this._bounds = null;
    this._didInitialCenter = false;
  }
}

const ORDER_CELL = {
  width: 220,        // cell pitch X — wider gap so roads have breathing room and don't visually crowd nodes
  height: 260,       // cell pitch Y — same reasoning, plus room for the label below each card
  nodeWidth: 110,    // visible node width (poster)
  nodeHeight: 150,   // visible node height (poster)
  cellWidth: 130,    // .flow-cell wrapper width (CSS) — wider than node so longer titles wrap nicely
};

const ORDER_ZOOM = {
  // Below ~0.4 the posters stop being recognisable and the chart reads as
  // coloured confetti; above ~2.5 only a couple of cards fit on screen.
  min: 0.4,
  max: 2.5,
  step: 1.2,                        // multiplicative — one button press / key tap
  storageKey: 'mcu_order_zoom',     // survives navigation and reloads
};

const orderRenderer = new OrderRenderer();
