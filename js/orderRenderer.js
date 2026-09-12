/************************************************
 * ORDER RENDERER — Watch-Order Flowchart View
 * Positions all projects on a 2D grid using their gridX/gridY values
 * and draws SVG arrows between prerequisites.
 *
 * Navigation is native browser scroll plus a zoom layer:
 *
 *   .flow-wrapper   overflow:auto — owns the scrollbars
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

  // Mouse-drag pan over the flow canvas — same hand-grab feel as the map.
  // Native scrollwheel/touchpad still work via the wrapper's overflow:auto;
  // this just adds click-and-drag for users who expect to grab the canvas.
  setupPanControls() {
    const wrapper = this.wrapper;
    if (!wrapper) return;

    let panning = false;
    let dragged = false;
    let pointerId = null;
    let startX = 0, startY = 0;
    let startScrollLeft = 0, startScrollTop = 0;
    const DRAG_THRESHOLD = 4;

    const onDown = (e) => {
      // Don't initiate a drag on a card — the user is trying to click it.
      if (e.target.closest('.flow-cell')) return;
      // Don't pan during a fight (wrapper's scroll is supposed to be locked).
      if (wrapper.classList.contains('fight-zoom')) return;
      // Only respond to primary pointer (left mouse / touch). Avoids
      // hijacking right-click context menus or middle-click autoscroll.
      if (e.button !== undefined && e.button !== 0) return;

      panning = true;
      dragged = false;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      startScrollLeft = wrapper.scrollLeft;
      startScrollTop = wrapper.scrollTop;
      try { wrapper.setPointerCapture(e.pointerId); } catch (_) {}
      wrapper.classList.add('panning');
    };

    const onMove = (e) => {
      if (!panning || e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!dragged && Math.hypot(dx, dy) > DRAG_THRESHOLD) dragged = true;
      wrapper.scrollLeft = startScrollLeft - dx;
      wrapper.scrollTop = startScrollTop - dy;
    };

    const onUp = (e) => {
      if (!panning || e.pointerId !== pointerId) return;
      panning = false;
      pointerId = null;
      try { wrapper.releasePointerCapture(e.pointerId); } catch (_) {}
      wrapper.classList.remove('panning');

      // Suppress the click that follows pointerup if we actually dragged —
      // otherwise releasing on a card would open its popup.
      if (dragged) {
        const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        document.addEventListener('click', swallow, { capture: true, once: true });
        // Safety net: if no click event fires (touch with no follow-up
        // click) remove the listener so it doesn't eat a future click.
        setTimeout(() => {
          document.removeEventListener('click', swallow, { capture: true });
        }, 80);
      }
    };

    wrapper.addEventListener('pointerdown', onDown);
    wrapper.addEventListener('pointermove', onMove);
    wrapper.addEventListener('pointerup', onUp);
    wrapper.addEventListener('pointercancel', onUp);

    this._listeners.push(
      { target: wrapper, event: 'pointerdown', handler: onDown },
      { target: wrapper, event: 'pointermove', handler: onMove },
      { target: wrapper, event: 'pointerup', handler: onUp },
      { target: wrapper, event: 'pointercancel', handler: onUp },
    );
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

  _saveZoom() {
    try { localStorage.setItem(ORDER_ZOOM.storageKey, String(this.zoom)); } catch (_) {}
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

    // Ctrl/⌘ + wheel zooms; a plain wheel keeps scrolling the chart, which is
    // still the main way around a flowchart this tall. Trackpad pinch arrives
    // as ctrl+wheel too, so pinching on a laptop lands here for free.
    on(wrapper, 'wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (locked()) return;
      // deltaMode 1 = lines, 2 = pages. Normalise to pixels or a line-mode
      // mouse jumps several zoom steps per notch.
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16;
      else if (e.deltaMode === 2) dy *= wrapper.clientHeight;
      const factor = Math.min(2, Math.max(0.5, Math.exp(-dy * 0.0025)));
      const rect = wrapper.getBoundingClientRect();
      this.zoomBy(factor, e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });

    // Two-finger pinch. Touch events rather than pointer events: the wrapper
    // keeps its default touch-action so one-finger scrolling still gets native
    // momentum, and we only preventDefault once a second finger lands — at
    // which point the browser hasn't committed to a scroll yet.
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
    let pinchDist = null;
    let pinchZoom = 1;

    on(wrapper, 'touchstart', (e) => {
      if (e.touches.length !== 2 || locked()) { pinchDist = null; return; }
      pinchDist = dist(e.touches);
      pinchZoom = this.zoom;
      e.preventDefault();
    }, { passive: false });

    on(wrapper, 'touchmove', (e) => {
      if (pinchDist == null || e.touches.length !== 2) return;
      e.preventDefault();
      const d = dist(e.touches);
      if (d <= 0) return;
      const m = mid(e.touches);
      const rect = wrapper.getBoundingClientRect();
      this.setZoom(pinchZoom * (d / pinchDist), m.x - rect.left, m.y - rect.top);
    }, { passive: false });

    const endPinch = (e) => { if (!e.touches || e.touches.length < 2) pinchDist = null; };
    on(wrapper, 'touchend', endPinch);
    on(wrapper, 'touchcancel', endPinch);

    // Keyboard: +/- to step, 0 to reset. Matches the map view's bindings.
    on(window, 'keydown', (e) => {
      if (e.target.matches && e.target.matches('input, textarea, [contenteditable]')) return;
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

  // Floating −/100%/+ cluster. Built here (not in the view markup) so every
  // view that mounts the flowchart gets it, and torn down in destroy().
  _buildZoomUi() {
    if (!this.wrapper || !this.wrapper.parentNode) return;
    this.wrapper.parentNode.querySelectorAll('.flow-zoom-ui').forEach(el => el.remove());

    const ui = document.createElement('div');
    ui.className = 'flow-zoom-ui';
    ui.innerHTML = `
      <button type="button" class="flow-zoom-btn" data-act="out" aria-label="Zoom out">−</button>
      <button type="button" class="flow-zoom-level" data-act="reset" aria-label="Reset zoom to 100%" title="Reset zoom (0)">100%</button>
      <button type="button" class="flow-zoom-btn" data-act="in" aria-label="Zoom in">+</button>
    `;
    const onClick = (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'in') this.zoomBy(ORDER_ZOOM.step);
      else if (act === 'out') this.zoomBy(1 / ORDER_ZOOM.step);
      else this.resetZoom();
    };
    ui.addEventListener('click', onClick);
    this._listeners.push({ target: ui, event: 'click', handler: onClick });

    this.wrapper.parentNode.appendChild(ui);
    this._zoomUi = ui;
    this._syncZoomUi();
  }

  _syncZoomUi() {
    if (!this._zoomUi) return;
    const level = this._zoomUi.querySelector('.flow-zoom-level');
    if (level) level.textContent = `${Math.round(this.zoom * 100)}%`;
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

    const roadBase = document.createElementNS(ns, "path");
    roadBase.setAttribute("d", d);
    roadBase.setAttribute("stroke", "rgba(201, 162, 39, 0.12)");
    roadBase.setAttribute("stroke-width", "16");
    roadBase.setAttribute("stroke-linecap", "round");
    roadBase.setAttribute("fill", "none");
    elements.push(roadBase);

    const laneOuter = document.createElementNS(ns, "path");
    laneOuter.setAttribute("d", d);
    laneOuter.setAttribute("stroke", "rgba(201, 162, 39, 0.28)");
    laneOuter.setAttribute("stroke-width", "18");
    laneOuter.setAttribute("stroke-linecap", "round");
    laneOuter.setAttribute("fill", "none");
    laneOuter.setAttribute("opacity", "0.5");
    elements.push(laneOuter);

    const laneInner = document.createElementNS(ns, "path");
    laneInner.setAttribute("d", d);
    laneInner.setAttribute("stroke", "rgba(10, 12, 20, 0.55)");
    laneInner.setAttribute("stroke-width", "14");
    laneInner.setAttribute("stroke-linecap", "round");
    laneInner.setAttribute("fill", "none");
    elements.push(laneInner);

    const dash = document.createElementNS(ns, "path");
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
