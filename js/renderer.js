/************************************************
 * RENDERER
 ************************************************/
class MapRenderer {
  constructor() {
    this.container = null;
    this.mapContainer = null;
    this.nodesContainer = null;
    this.svg = null;
    this.nodeElements = new Map();
    this.arrowElements = [];
    this.pendingCenterTarget = null;
  }

  init() {
    this.container = $("#map-wrapper");
    this.mapContainer = $("#map-container");
    this.nodesContainer = $("#nodes");
    this.svg = $("#connections");
    this.nodeElements = new Map();
    this.arrowElements = [];
    this.setupEventDelegation();
    // Only subscribe once
    if (!this._subscribed) {
      state.subscribe(() => this.render());
      this._subscribed = true;
    }
  }

  setupEventDelegation() {
    this.nodesContainer.addEventListener("click", (e) => {
      const node = e.target.closest(".node");
      if (!node) return;

      const id = node.dataset.id;
      const project = state.byId.get(id);
      if (!project) return;

      const isReadonly = this.nodesContainer.classList.contains('readonly');

      if (isReadonly && !state.isWatched(project.id)) return;
      if (!isReadonly && !isUnlocked(project)) return;

      showPopup(project);
    });
  }

  render() {
    if (!this.nodesContainer) return;  // view not mounted
    const bounds = getBounds();
    if (!bounds) return;

    this.updateContainerSize(bounds);
    this.renderNodes(bounds);
    this.updatePhaseIndicator();

    requestAnimationFrame(() => {
      this.renderArrows();
      this.centerOnTarget();
    });
  }

  updateContainerSize(bounds) {
    const gridWidth = bounds.maxX - bounds.minX;
    const gridHeight = bounds.maxY - bounds.minY;

    const width = gridWidth * CONFIG.H_SPACING + CONFIG.NODE_WIDTH;
    const height = gridHeight * CONFIG.V_SPACING + CONFIG.NODE_HEIGHT;

    this.mapContainer.style.width = `${width}px`;
    this.mapContainer.style.height = `${height}px`;
  }

  renderNodes(bounds) {
    const visible = projects.filter(isVisible);
    const fragment = document.createDocumentFragment();

    const existingIds = new Set(this.nodeElements.keys());
    const newIds = new Set(visible.map(p => p.id));

    existingIds.forEach(id => {
      if (!newIds.has(id)) {
        this.nodeElements.get(id)?.remove();
        this.nodeElements.delete(id);
      }
    });

    visible.forEach(p => {
      let node = this.nodeElements.get(p.id);
      const pos = toPixel(p.gridX, p.gridY, bounds);

      if (!node) {
        node = this.createNodeElement(p, pos);
        fragment.appendChild(node);
        this.nodeElements.set(p.id, node);
      } else {
        node.style.left = `${pos.x}px`;
        node.style.top = `${pos.y}px`;
        this.updateNodeState(node, p);
      }
    });

    if (fragment.childNodes.length) {
      this.nodesContainer.appendChild(fragment);
    }
  }

  createNodeElement(project, pos) {
    const node = document.createElement("div");
    node.className = "node";
    node.dataset.id = project.id;
    node.style.left = `${pos.x}px`;
    node.style.top = `${pos.y}px`;

    if (project.image) {
      const img = document.createElement("img");
      img.src = CONFIG.IMAGE_BASE + project.image;
      img.loading = "lazy";
      img.onerror = () => img.remove();
      node.appendChild(img);
    }

    const check = document.createElement("span");
    check.className = "checkmark";
    check.textContent = "✔";
    node.appendChild(check);

    this.updateNodeState(node, project);
    return node;
  }

  updateNodeState(node, project) {
    const isWatched = state.isWatched(project.id);
    const locked = !isUnlocked(project);

    node.classList.toggle("watched", isWatched);
    node.classList.toggle("locked", locked);
  }

  renderArrows() {
    this.arrowElements.forEach(el => el.remove());
    this.arrowElements = [];

    if (!this.svg.querySelector("#arrowhead")) {
      this.createArrowhead();
    }

    const containerRect = this.mapContainer.getBoundingClientRect();

    projects.forEach(parent => {
      if (!isVisible(parent)) return;

      const fromNode = this.nodeElements.get(parent.id);
      if (!fromNode) return;

      parent.unlocks.forEach(childId => {
        const child = state.byId.get(childId);
        if (!child || !isVisible(child)) return;

        const toNode = this.nodeElements.get(childId);
        if (!toNode) return;

        const elements = this.createArrow(fromNode, toNode, containerRect, parent.id, childId);
        elements.forEach(el => {
          this.svg.appendChild(el);
          this.arrowElements.push(el);
        });
      });
    });
  }

  createArrowhead() {
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");

    marker.id = "arrowhead";
    marker.setAttribute("markerWidth", "8");
    marker.setAttribute("markerHeight", "6");
    marker.setAttribute("refX", "7");
    marker.setAttribute("refY", "3");
    marker.setAttribute("orient", "auto");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M0,0 L0,6 L7,3 Z");
    path.setAttribute("fill", "rgba(201, 162, 39, 0.7)");

    marker.appendChild(path);
    defs.appendChild(marker);
    this.svg.appendChild(defs);
  }

  createArrow(fromNode, toNode, containerRect, fromId, toId) {
    const a = fromNode.getBoundingClientRect();
    const b = toNode.getBoundingClientRect();

    const fx = a.left + a.width / 2 - containerRect.left;
    const fy = a.top + a.height / 2 - containerRect.top;
    const tx = b.left + b.width / 2 - containerRect.left;
    const ty = b.top + b.height / 2 - containerRect.top;

    const dx = tx - fx;
    const dy = ty - fy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;

    const offsetX = ux * (a.width / 2 + 6);
    const offsetY = uy * (a.height / 2 + 6);
    const endOffsetX = ux * (b.width / 2 + 8);
    const endOffsetY = uy * (b.height / 2 + 8);

    const x1 = fx + offsetX;
    const y1 = fy + offsetY;
    const x2 = tx - endOffsetX;
    const y2 = ty - endOffsetY;
    const d = `M ${x1} ${y1} L ${x2} ${y2}`;
    const pathId = `arrow-${fromId}-${toId}`;

    const ns = "http://www.w3.org/2000/svg";
    const elements = [];

    // Road base — wide background
    const roadBase = document.createElementNS(ns, "path");
    roadBase.setAttribute("d", d);
    roadBase.setAttribute("stroke", "rgba(201, 162, 39, 0.12)");
    roadBase.setAttribute("stroke-width", isMobile ? "18" : "26");
    roadBase.setAttribute("stroke-linecap", "round");
    roadBase.setAttribute("fill", "none");
    elements.push(roadBase);

    // Road edges — lane borders
    const laneW = isMobile ? 18 : 26;
    const perpX = -uy * laneW / 2;
    const perpY = ux * laneW / 2;

    const edgeLeft = document.createElementNS(ns, "path");
    edgeLeft.setAttribute("d", `M ${x1 + perpX} ${y1 + perpY} L ${x2 + perpX} ${y2 + perpY}`);
    edgeLeft.setAttribute("stroke", "rgba(201, 162, 39, 0.25)");
    edgeLeft.setAttribute("stroke-width", "1");
    edgeLeft.setAttribute("fill", "none");
    elements.push(edgeLeft);

    const edgeRight = document.createElementNS(ns, "path");
    edgeRight.setAttribute("d", `M ${x1 - perpX} ${y1 - perpY} L ${x2 - perpX} ${y2 - perpY}`);
    edgeRight.setAttribute("stroke", "rgba(201, 162, 39, 0.25)");
    edgeRight.setAttribute("stroke-width", "1");
    edgeRight.setAttribute("fill", "none");
    elements.push(edgeRight);

    // Dashed center lane divider
    const dash = document.createElementNS(ns, "path");
    dash.setAttribute("id", pathId);
    dash.setAttribute("d", d);
    dash.setAttribute("stroke", "rgba(255, 255, 255, 0.15)");
    dash.setAttribute("stroke-width", "1");
    dash.setAttribute("stroke-dasharray", "6 10");
    dash.setAttribute("fill", "none");
    elements.push(dash);

    // Direction arrow
    const arrow = document.createElementNS(ns, "path");
    arrow.setAttribute("d", d);
    arrow.setAttribute("stroke", "none");
    arrow.setAttribute("fill", "none");
    arrow.setAttribute("marker-end", "url(#arrowhead)");
    elements.push(arrow);

    return elements;
  }

  updatePhaseIndicator() {
    this.mapContainer.dataset.phase = getHighestUnlockedPhase();
  }

  setCenterTarget(id) {
    this.pendingCenterTarget = id;
  }

  centerOnTarget() {
    const targetId = this.pendingCenterTarget || state.getLastWatchedId();
    this.pendingCenterTarget = null;

    const node = this.nodeElements.get(targetId);
    if (!node) return;

    const wrapperRect = this.container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();

    const scrollLeft = this.container.scrollLeft + (nodeRect.left - wrapperRect.left) - (wrapperRect.width / 2) + (nodeRect.width / 2);
    const scrollTop = this.container.scrollTop + (nodeRect.top - wrapperRect.top) - (wrapperRect.height / 2) + (nodeRect.height / 2);

    this.container.scrollTo({
      left: Math.max(0, scrollLeft),
      top: Math.max(0, scrollTop),
      behavior: "smooth"
    });
  }

  markAllWatched() {
    projects.forEach(p => state.setWatched(p.id, true));
  }
}

const renderer = new MapRenderer();
