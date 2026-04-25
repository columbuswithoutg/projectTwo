/************************************************
 * ORDER RENDERER — Watch-Order Flowchart View
 * Positions all projects on a 2D grid using their gridX/gridY values
 * and draws SVG arrows between prerequisites. Native browser scroll
 * for navigation (no custom zoom/pan).
 ************************************************/
class OrderRenderer {
  constructor() {
    this.wrapper = null;        // .flow-wrapper (scrolling container)
    this.canvas = null;         // .flow-canvas (positioned content)
    this.svg = null;            // .flow-arrows (SVG layer)
    this.nodesContainer = null; // .flow-nodes
    this.nodeElements = new Map();
    this._unsubscribeState = null;
    this._listeners = [];
    this._didInitialCenter = false;
  }

  init() {
    this.wrapper = $(".flow-wrapper");
    this.canvas = $(".flow-canvas");
    this.svg = $(".flow-arrows");
    this.nodesContainer = $(".flow-nodes");
    this.nodeElements = new Map();
    this._didInitialCenter = false;

    this.setupEventDelegation();
    this.setupPanControls();

    if (this._unsubscribeState) this._unsubscribeState();
    this._unsubscribeState = state.subscribe(() => this.render());
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
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    this.svg.setAttribute("width", w);
    this.svg.setAttribute("height", h);
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
    const w = this.wrapper.clientWidth;
    const h = this.wrapper.clientHeight;
    this.wrapper.scrollLeft = Math.max(0, pos.x - w / 2);
    this.wrapper.scrollTop = Math.max(0, pos.y - h / 2);
  }

  destroy() {
    if (this._unsubscribeState) {
      this._unsubscribeState();
      this._unsubscribeState = null;
    }
    this._listeners.forEach(({ target, event, handler }) => {
      target.removeEventListener(event, handler);
    });
    this._listeners = [];
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

const orderRenderer = new OrderRenderer();
