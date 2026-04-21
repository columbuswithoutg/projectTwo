/************************************************
 * RENDERER — World Map
 ************************************************/
class MapRenderer {
  constructor() {
    this.wrapper = null;
    this.viewport = null;          // #world-viewport (zoom + pan lives here)
    this.mapContainer = null;      // #map-container (fight zoom mutates this)
    this.nodesContainer = null;
    this.svg = null;
    this.labelsContainer = null;
    this.glowsContainer = null;
    this.continentsSvg = null;
    this.worldViewBtn = null;
    this.shelfContainer = null;    // #up-next-shelf
    this.shelfTrack = null;        // .shelf-track inside it

    this.nodeElements = new Map();
    this.labelElements = new Map();
    this.shelfElements = new Map();
    this.arrowElements = [];
    this.pendingCenterTarget = null;

    // Camera state
    this.worldZoom = CONFIG_WORLD.zoomDefault;
    this.panX = 0;
    this.panY = 0;
    this.tween = null;

    // Version cache for expensive rebuilds
    this._arrowsVersion = -1;
    this._glowsVersion = -1;
    this._shelfVersion = -1;

    // Bound listener handles (for destroy)
    this._listeners = [];

    // Camera lock — set true during fight zoom so wheel/pan/keys/pinch can't
    // desync the composed inner+outer transform.
    this.cameraLocked = false;
  }

  init() {
    this.wrapper = $("#map-wrapper");
    this.viewport = $("#world-viewport");
    this.mapContainer = $("#map-container");
    this.nodesContainer = $("#nodes");
    this.svg = $("#connections");
    this.labelsContainer = $("#cluster-labels");
    this.glowsContainer = $("#region-glows");
    this.continentsSvg = $("#world-continents");
    this.worldViewBtn = $("#world-view-btn");
    this.shelfContainer = $("#up-next-shelf");
    this.shelfTrack = this.shelfContainer ? this.shelfContainer.querySelector(".shelf-track") : null;

    this.nodeElements = new Map();
    this.labelElements = new Map();
    this.shelfElements = new Map();
    this.arrowElements = [];

    this.setupEventDelegation();
    this.setupNavigationControls();
    this.renderContinents();
    this.renderRegionGlows();
    this.renderClusterLabels();

    // Initial camera: center on start node
    this._jumpToStartNode();

    if (!this._subscribed) {
      state.subscribe(() => this.render());
      this._subscribed = true;
    }
  }

  _jumpToStartNode() {
    // Position camera on the start node's cluster at default zoom
    const startProject = state.byId?.get(CONFIG.START_NODE_ID);
    const startLocId = startProject?.location;
    const loc = startLocId ? LOCATION_BY_ID.get(startLocId) : LOCATION_BY_ID.get("nyc");
    if (loc) {
      this._setCamera(CONFIG_WORLD.zoomDefault, loc.worldX, loc.worldY, false);
    }
  }

  setupEventDelegation() {
    const handlePinClick = (e) => {
      const node = e.target.closest(".node");
      if (!node) return;

      const id = node.dataset.id;
      const project = state.byId.get(id);
      if (!project) return;

      const isReadonly = this.nodesContainer.classList.contains('readonly');

      if (isReadonly && !state.isWatched(project.id)) return;
      if (!isReadonly && !isUnlocked(project)) return;

      showPopup(project);
    };

    this.nodesContainer.addEventListener("click", handlePinClick);
    // Shelf pins share the same click-to-open-popup behavior as map pins.
    if (this.shelfTrack) this.shelfTrack.addEventListener("click", handlePinClick);
  }

  setupNavigationControls() {
    const wrapper = this.wrapper;
    const on = (target, event, handler, opts) => {
      target.addEventListener(event, handler, opts);
      this._listeners.push({ target, event, handler, opts });
    };

    // Wheel zoom
    on(wrapper, "wheel", (e) => {
      e.preventDefault();
      if (this.cameraLocked) return;
      const rect = wrapper.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const dir = e.deltaY > 0 ? -1 : 1;
      const factor = 1 + dir * 0.12;
      this._zoomAt(this.worldZoom * factor, mouseX, mouseY);
      this._cancelTween();
    }, { passive: false });

    // Pointer drag pan + pinch zoom
    const activePointers = new Map();
    let lastPinchDist = null;
    let lastPanX = 0, lastPanY = 0;
    let panning = false;

    on(wrapper, "pointerdown", (e) => {
      if (this.cameraLocked) return;
      if (e.target.closest(".node")) return;
      wrapper.setPointerCapture(e.pointerId);
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size === 1) {
        panning = true;
        lastPanX = e.clientX;
        lastPanY = e.clientY;
        wrapper.classList.add("panning");
      }
    });

    on(wrapper, "pointermove", (e) => {
      if (this.cameraLocked) return;
      if (!activePointers.has(e.pointerId)) return;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.size === 2) {
        // Pinch zoom
        const pts = Array.from(activePointers.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;
        const rect = wrapper.getBoundingClientRect();
        if (lastPinchDist != null) {
          const factor = dist / lastPinchDist;
          this._zoomAt(this.worldZoom * factor, midX - rect.left, midY - rect.top);
          this._cancelTween();
        }
        lastPinchDist = dist;
        panning = false; // suppress pan while pinching
      } else if (panning && activePointers.size === 1) {
        const dx = e.clientX - lastPanX;
        const dy = e.clientY - lastPanY;
        lastPanX = e.clientX;
        lastPanY = e.clientY;
        this._setCamera(this.worldZoom, null, null, false, this.panX + dx, this.panY + dy);
        this._cancelTween();
      }
    });

    const endPointer = (e) => {
      if (activePointers.has(e.pointerId)) {
        activePointers.delete(e.pointerId);
      }
      if (activePointers.size < 2) lastPinchDist = null;
      if (activePointers.size === 0) {
        panning = false;
        wrapper.classList.remove("panning");
        this.viewport.classList.remove("interacting");
      }
    };
    on(wrapper, "pointerup", endPointer);
    on(wrapper, "pointercancel", endPointer);

    // Keyboard navigation
    on(window, "keydown", (e) => {
      // Don't hijack typing in inputs
      if (e.target.matches("input, textarea, [contenteditable]")) return;
      if (this.cameraLocked) return;

      const PAN_STEP = 80;
      const ZOOM_STEP = 0.15;
      switch (e.key) {
        case "ArrowLeft":
          this._setCamera(this.worldZoom, null, null, false, this.panX + PAN_STEP, this.panY);
          e.preventDefault(); break;
        case "ArrowRight":
          this._setCamera(this.worldZoom, null, null, false, this.panX - PAN_STEP, this.panY);
          e.preventDefault(); break;
        case "ArrowUp":
          this._setCamera(this.worldZoom, null, null, false, this.panX, this.panY + PAN_STEP);
          e.preventDefault(); break;
        case "ArrowDown":
          this._setCamera(this.worldZoom, null, null, false, this.panX, this.panY - PAN_STEP);
          e.preventDefault(); break;
        case "+": case "=":
          this._zoomAt(this.worldZoom + ZOOM_STEP, null, null);
          e.preventDefault(); break;
        case "-": case "_":
          this._zoomAt(this.worldZoom - ZOOM_STEP, null, null);
          e.preventDefault(); break;
        case "Home": case "w": case "W":
          this.goToWorldView();
          e.preventDefault(); break;
        case "Escape":
          this.goToWorldView();
          break;
      }
    });

    // World-view button
    on(this.worldViewBtn, "click", () => {
      if (this.cameraLocked) return;
      this.goToWorldView();
    });

    // Cluster-label clicks (delegated)
    on(this.labelsContainer, "click", (e) => {
      if (this.cameraLocked) return;
      const label = e.target.closest(".cluster-label");
      if (!label) return;
      const locId = label.dataset.location;
      if (locId) this.goToRegion(locId);
    });
    this.labelsContainer.style.pointerEvents = "auto";

    // Location frame clicks — snap-zoom to that location. The frame has
    // pointer-events:auto in CSS while its parent glows container stays
    // pointer-events:none, so map-wrapper panning still works on the map
    // outside of frames. The click event bubbles up to this delegate.
    on(this.glowsContainer, "click", (e) => {
      if (this.cameraLocked) return;
      const frame = e.target.closest(".cluster-frame");
      if (!frame) return;
      const locId = frame.dataset.location;
      if (locId) this.goToRegion(locId);
    });
  }

  destroy() {
    this._listeners.forEach(({ target, event, handler, opts }) => {
      target.removeEventListener(event, handler, opts);
    });
    this._listeners = [];
    this._cancelTween();
    // The DOM (#app innerHTML) will be wiped by the router on unmount, which
    // detaches our node/arrow/label/glow elements. Clear the in-memory maps
    // and version caches so the next mount rebuilds from scratch instead of
    // short-circuiting on stale version matches.
    this.nodeElements = new Map();
    this.labelElements = new Map();
    this.shelfElements = new Map();
    this.arrowElements = [];
    this._arrowsVersion = -1;
    this._glowsVersion = -1;
    this._shelfVersion = -1;
  }

  /* ─── Camera control ─── */

  _zoomAt(newZoom, focusPx, focusPy) {
    const z = Math.max(CONFIG_WORLD.zoomMin, Math.min(CONFIG_WORLD.zoomMax, newZoom));
    const ratio = z / this.worldZoom;
    if (focusPx == null || focusPy == null) {
      // Zoom around viewport center
      const rect = this.wrapper.getBoundingClientRect();
      focusPx = rect.width / 2;
      focusPy = rect.height / 2;
    }
    // Keep the focus point stationary on screen while zooming.
    this.panX = focusPx - (focusPx - this.panX) * ratio;
    this.panY = focusPy - (focusPy - this.panY) * ratio;
    this.worldZoom = z;
    this.viewport.classList.add("interacting");
    this._applyCamera();
    this._updateWorldButton();
    this._updateLabelsForZoom();
  }

  _setCamera(zoom, worldFocusX, worldFocusY, animate, panX, panY) {
    const targetZoom = Math.max(CONFIG_WORLD.zoomMin, Math.min(CONFIG_WORLD.zoomMax, zoom));
    let targetPanX, targetPanY;
    if (panX != null && panY != null) {
      targetPanX = panX;
      targetPanY = panY;
    } else if (worldFocusX != null && worldFocusY != null) {
      // Center the world-space focus point in the viewport.
      const rect = this.wrapper.getBoundingClientRect();
      targetPanX = rect.width / 2 - worldFocusX * targetZoom;
      targetPanY = rect.height / 2 - worldFocusY * targetZoom;
    } else {
      targetPanX = this.panX;
      targetPanY = this.panY;
    }

    if (!animate) {
      this.worldZoom = targetZoom;
      this.panX = targetPanX;
      this.panY = targetPanY;
      this._applyCamera();
      this._updateWorldButton();
      this._updateLabelsForZoom();
      return;
    }

    this._tween({
      fromZoom: this.worldZoom,
      toZoom: targetZoom,
      fromPanX: this.panX,
      toPanX: targetPanX,
      fromPanY: this.panY,
      toPanY: targetPanY,
      duration: CONFIG_WORLD.snapDurationMs,
    });
  }

  _tween(cfg) {
    this._cancelTween();
    const start = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    this.viewport.classList.add("interacting");
    const step = (now) => {
      if (!this.tween) return;
      const t = Math.min(1, (now - start) / cfg.duration);
      const k = ease(t);
      this.worldZoom = cfg.fromZoom + (cfg.toZoom - cfg.fromZoom) * k;
      this.panX = cfg.fromPanX + (cfg.toPanX - cfg.fromPanX) * k;
      this.panY = cfg.fromPanY + (cfg.toPanY - cfg.fromPanY) * k;
      this._applyCamera();
      this._updateLabelsForZoom();
      if (t < 1) {
        this.tween = requestAnimationFrame(step);
      } else {
        this.tween = null;
        this.viewport.classList.remove("interacting");
        this._updateWorldButton();
      }
    };
    this.tween = requestAnimationFrame(step);
  }

  _cancelTween() {
    if (this.tween) {
      cancelAnimationFrame(this.tween);
      this.tween = null;
      this.viewport?.classList.remove("interacting");
    }
  }

  _applyCamera() {
    this.viewport.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.worldZoom})`;
  }

  _updateWorldButton() {
    if (!this.worldViewBtn) return;
    const shouldShow = this.worldZoom > CONFIG_WORLD.zoomWorldPreset + 0.05;
    this.worldViewBtn.classList.toggle("visible", shouldShow);
  }

  _updateLabelsForZoom() {
    // Crossfade: fully visible at < 0.6, hidden by 0.9
    const z = this.worldZoom;
    const opacity = Math.max(0, Math.min(1, (0.9 - z) / 0.3));
    this.labelsContainer.style.opacity = opacity.toFixed(3);
  }

  goToWorldView() {
    const centerX = CONFIG_WORLD.worldWidth / 2;
    const centerY = CONFIG_WORLD.worldHeight / 2;
    this._setCamera(CONFIG_WORLD.zoomWorldPreset, centerX, centerY, true);
  }

  goToRegion(locId) {
    const loc = LOCATION_BY_ID.get(locId);
    if (!loc) return;
    this._setCamera(CONFIG_WORLD.zoomRegionPreset, loc.worldX, loc.worldY, true);
  }

  /* ─── Main render ─── */

  render() {
    if (!this.nodesContainer) return;
    // invalidate caches — getLayout() auto-invalidates when visible set changes
    this.renderNodes();
    this.renderUpNextShelf();
    this.updatePhaseIndicator();

    requestAnimationFrame(() => {
      this.renderArrows();
      this.renderClusterLabels();
      this.renderRegionGlows();
      this.centerOnTarget();
    });
  }

  renderNodes() {
    const layout = getLayout();
    const visibleIds = new Set(layout.keys());
    const pinHalfW = CONFIG_WORLD.pinWidth / 2;
    const pinHalfH = CONFIG_WORLD.pinHeight / 2;

    // Remove no-longer-visible
    this.nodeElements.forEach((el, id) => {
      if (!visibleIds.has(id)) {
        el.remove();
        this.nodeElements.delete(id);
      }
    });

    const fragment = document.createDocumentFragment();
    visibleIds.forEach(id => {
      const project = state.byId.get(id);
      if (!project) return;
      const pos = layout.get(id);
      let node = this.nodeElements.get(id);
      if (!node) {
        node = this.createNodeElement(project, pos);
        fragment.appendChild(node);
        this.nodeElements.set(id, node);
      } else {
        node.style.left = `${pos.x - pinHalfW}px`;
        node.style.top = `${pos.y - pinHalfH}px`;
        this.updateNodeState(node, project);
      }
    });

    if (fragment.childNodes.length) {
      this.nodesContainer.appendChild(fragment);
    }
  }

  createNodeElement(project, pos) {
    const pinHalfW = CONFIG_WORLD.pinWidth / 2;
    const pinHalfH = CONFIG_WORLD.pinHeight / 2;
    const node = document.createElement("div");
    node.className = "node pin";
    node.dataset.id = project.id;
    node.title = project.title || project.id;
    node.style.left = `${pos.x - pinHalfW}px`;
    node.style.top = `${pos.y - pinHalfH}px`;

    if (project.image) {
      const img = document.createElement("img");
      img.src = CONFIG.IMAGE_BASE + project.image;
      img.loading = "lazy";
      img.draggable = false;
      img.alt = "";
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

  /* ─── Up-next shelf ─── */

  // Revealed-but-unwatched pins live on the bottom shelf, not on the map.
  // This keeps the map a record of what the user has seen and gives "what's
  // available next" its own first-class surface.
  renderUpNextShelf() {
    if (!this.shelfContainer || !this.shelfTrack) return;
    const version = getLayoutVersion();
    if (this._shelfVersion === version) return;
    this._shelfVersion = version;

    const revealed = projects
      .filter(isRevealed)
      .sort((a, b) => (a.release || "").localeCompare(b.release || ""));

    const revealedIds = new Set(revealed.map(p => p.id));
    // Drop pins no longer on the shelf (either watched → moved to map, or
    // a prereq was un-watched → back to locked).
    this.shelfElements.forEach((el, id) => {
      if (!revealedIds.has(id)) {
        el.remove();
        this.shelfElements.delete(id);
      }
    });

    const fragment = document.createDocumentFragment();
    revealed.forEach(project => {
      let node = this.shelfElements.get(project.id);
      if (!node) {
        node = this.createShelfPin(project);
        this.shelfElements.set(project.id, node);
        fragment.appendChild(node);
      } else {
        this.updateNodeState(node, project);
      }
    });
    if (fragment.childNodes.length) this.shelfTrack.appendChild(fragment);

    // Re-order DOM to match sorted `revealed` list so newly-revealed films
    // slot in at their release-date position instead of always appending.
    revealed.forEach(project => {
      const el = this.shelfElements.get(project.id);
      if (el) this.shelfTrack.appendChild(el);
    });

    this.shelfContainer.classList.toggle("empty", revealed.length === 0);
  }

  createShelfPin(project) {
    const node = document.createElement("div");
    node.className = "node pin shelf-pin";
    node.dataset.id = project.id;
    node.title = project.title || project.id;

    if (project.image) {
      const img = document.createElement("img");
      img.src = CONFIG.IMAGE_BASE + project.image;
      img.loading = "lazy";
      img.draggable = false;
      img.alt = "";
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

  /* ─── Bezier roads ─── */

  renderArrows() {
    // Skip full rebuild when the layout (visible node set) hasn't changed.
    // The SVG paths depend only on layout, not watch state toggles.
    const version = getLayoutVersion();
    if (this._arrowsVersion === version && this.arrowElements.length > 0) return;

    this.arrowElements.forEach(el => el.remove());
    this.arrowElements = [];

    if (!this.svg.querySelector("#arrowhead")) {
      this.createArrowhead();
    }

    const roads = getRoadGeometry();
    roads.forEach(road => {
      const crossCosmos = road.fromIsCosmic !== road.toIsCosmic;
      this._buildRoadPaths(road, crossCosmos).forEach(el => {
        this.svg.appendChild(el);
        this.arrowElements.push(el);
      });
    });
    this._arrowsVersion = version;
  }

  _buildRoadPaths(road, crossCosmos) {
    const ns = "http://www.w3.org/2000/svg";
    const d = road.pathD;
    const length = road.length || 600;
    const pathId = `arrow-${road.fromId}-${road.toId}`;

    if (crossCosmos) {
      // Single dashed gold line for travel/cosmic routes
      const travel = document.createElementNS(ns, "path");
      travel.setAttribute("d", d);
      travel.setAttribute("stroke", "rgba(255, 180, 80, 0.45)");
      travel.setAttribute("stroke-width", "3");
      travel.setAttribute("stroke-dasharray", "10 14");
      travel.setAttribute("fill", "none");
      travel.setAttribute("marker-end", "url(#arrowhead)");
      travel.setAttribute("id", pathId);
      travel.style.setProperty("--road-length", length);
      travel.style.strokeDasharray = "10 14";
      return [travel];
    }

    const elements = [];
    // Wide translucent base
    const roadBase = document.createElementNS(ns, "path");
    roadBase.setAttribute("d", d);
    roadBase.setAttribute("stroke", "rgba(201, 162, 39, 0.12)");
    roadBase.setAttribute("stroke-width", "26");
    roadBase.setAttribute("stroke-linecap", "round");
    roadBase.setAttribute("fill", "none");
    roadBase.setAttribute("shape-rendering", "geometricPrecision");
    elements.push(roadBase);

    // Lane border as an outlined path (works for curves)
    const laneOuter = document.createElementNS(ns, "path");
    laneOuter.setAttribute("d", d);
    laneOuter.setAttribute("stroke", "rgba(201, 162, 39, 0.28)");
    laneOuter.setAttribute("stroke-width", "28");
    laneOuter.setAttribute("fill", "none");
    laneOuter.setAttribute("opacity", "0.5");
    elements.push(laneOuter);

    // Inner dark lane carved out
    const laneInner = document.createElementNS(ns, "path");
    laneInner.setAttribute("d", d);
    laneInner.setAttribute("stroke", "rgba(10, 12, 20, 0.55)");
    laneInner.setAttribute("stroke-width", "22");
    laneInner.setAttribute("fill", "none");
    elements.push(laneInner);

    // Dashed center divider
    const dash = document.createElementNS(ns, "path");
    dash.setAttribute("id", pathId);
    dash.setAttribute("d", d);
    dash.setAttribute("stroke", "rgba(255, 255, 255, 0.22)");
    dash.setAttribute("stroke-width", "1.5");
    dash.setAttribute("stroke-dasharray", "8 12");
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

  /* ─── Cluster labels, glows, continents ─── */

  renderClusterLabels() {
    // Rebuild labels when visible clusters change.
    const clusterRects = getClusterRects();
    const activeIds = new Set(clusterRects.keys());

    this.labelElements.forEach((el, id) => {
      if (!activeIds.has(id)) {
        el.remove();
        this.labelElements.delete(id);
      }
    });

    clusterRects.forEach((rect, locId) => {
      const loc = LOCATION_BY_ID.get(locId);
      if (!loc) return;
      let label = this.labelElements.get(locId);
      if (!label) {
        label = document.createElement("div");
        label.className = "cluster-label";
        label.dataset.location = locId;
        label.textContent = loc.label;
        if (isCosmicLocation(loc)) label.classList.add("cosmic");
        this.labelsContainer.appendChild(label);
        this.labelElements.set(locId, label);
      }
      // Position above the cluster's top edge
      label.style.left = `${rect.cx}px`;
      label.style.top = `${rect.minY - 22}px`;
    });
  }

  renderRegionGlows() {
    if (!this.glowsContainer) return;
    const version = getLayoutVersion();
    if (this._glowsVersion === version && this.glowsContainer.childElementCount > 0) return;

    this.glowsContainer.innerHTML = "";
    const clusterRects = getClusterRects();
    const frag = document.createDocumentFragment();
    clusterRects.forEach((rect, locId) => {
      const loc = LOCATION_BY_ID.get(locId);
      if (!loc) return;
      const tint = REGION_TINTS[loc.region] || REGION_TINTS["nyc"];

      // Soft ambient halo — bleeds beyond the location box as a regional aura.
      const glowW = rect.width + 220;
      const glowH = rect.height + 220;
      const glow = document.createElement("div");
      glow.className = "region-glow";
      glow.style.width = `${glowW}px`;
      glow.style.height = `${glowH}px`;
      glow.style.left = `${rect.cx - glowW / 2}px`;
      glow.style.top = `${rect.cy - glowH / 2}px`;
      glow.style.background = `radial-gradient(ellipse, ${tint.a} 0%, ${tint.b} 45%, transparent 80%)`;
      frag.appendChild(glow);

      // Location frame — the fixed-size rectangle with a lazy-loaded backdrop
      // image inside it. Using a real <img> with loading="lazy" + decoding="async"
      // lets the browser defer off-screen backdrops until the user pans near them
      // and run decode off the main thread — a big win over CSS background-image
      // (which eager-fetches everything as soon as the frame mounts).
      const frame = document.createElement("div");
      frame.className = "cluster-frame";
      frame.dataset.location = locId;
      if (isCosmicLocation(loc)) frame.classList.add("cosmic");
      frame.style.left = `${rect.minX}px`;
      frame.style.top = `${rect.minY}px`;
      frame.style.width = `${rect.width}px`;
      frame.style.height = `${rect.height}px`;
      // Per-region tint ≠ image — the tint is a gold/region gradient that
      // stays as the fallback when no backdrop WebP exists yet. It renders
      // underneath the <img> via .cluster-frame's own background.
      frame.style.setProperty('--region-tint-a', tint.a);
      frame.style.setProperty('--region-tint-b', tint.b);

      const img = document.createElement("img");
      img.className = "cluster-frame-bg";
      img.src = `assets/backgrounds/${loc.id}.webp`;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.draggable = false;
      // If the file doesn't exist yet, remove the broken <img> so the tint
      // fallback shows clean — no browser "broken image" icon, no noise.
      img.onerror = () => img.remove();
      frame.appendChild(img);

      frag.appendChild(frame);
    });
    this.glowsContainer.appendChild(frag);
    this._glowsVersion = version;
  }

  renderContinents() {
    if (!this.continentsSvg || this.continentsSvg.childElementCount > 0) return;
    // Rough stylized continent silhouette (abstract — readability > accuracy).
    // Coordinates are in the SVG viewBox (0 0 4000 1700), which matches the
    // earth plane of the world canvas (cosmos band is below at y > 1700).
    const ns = "http://www.w3.org/2000/svg";
    const shapes = [
      // North America (~x 40..1540, y 100..1450)
      "M 80 400 Q 240 280 600 260 Q 900 280 1200 340 Q 1500 420 1600 640 Q 1680 900 1500 1180 Q 1280 1440 800 1460 Q 400 1420 180 1160 Q 40 900 80 400 Z",
      // South America (~x 1150..1600, y 1400..1600) — small teaser
      "M 1200 1520 Q 1340 1500 1420 1560 Q 1420 1600 1340 1600 Q 1260 1580 1200 1540 Z",
      // Europe (~x 1760..2500, y 80..800)
      "M 1780 240 Q 1960 160 2200 140 Q 2440 160 2540 320 Q 2560 500 2480 680 Q 2380 780 2200 780 Q 2000 760 1860 640 Q 1740 500 1780 240 Z",
      // Africa (~x 2100..2500, y 900..1550)
      "M 2120 960 Q 2300 920 2480 980 Q 2560 1200 2480 1400 Q 2380 1560 2220 1560 Q 2100 1480 2080 1280 Q 2060 1100 2120 960 Z",
      // Asia (~x 2500..3900, y 200..1400)
      "M 2500 240 Q 2850 200 3250 260 Q 3600 340 3820 500 Q 3880 720 3800 1000 Q 3600 1260 3280 1340 Q 2900 1380 2600 1260 Q 2500 1080 2500 800 Q 2480 500 2500 240 Z",
      // Oceania (~x 3600..3900, y 1420..1580)
      "M 3620 1460 Q 3740 1440 3860 1480 Q 3880 1540 3780 1560 Q 3660 1540 3610 1500 Z",
    ];
    shapes.forEach(d => {
      const p = document.createElementNS(ns, "path");
      p.setAttribute("d", d);
      this.continentsSvg.appendChild(p);
    });
  }

  updatePhaseIndicator() {
    this.mapContainer.dataset.phase = getHighestUnlockedPhase();
  }

  setCenterTarget(id) {
    this.pendingCenterTarget = id;
  }

  centerOnTarget() {
    const targetId = this.pendingCenterTarget;
    this.pendingCenterTarget = null;
    if (!targetId) return;
    const pos = getNodePosition(targetId);
    if (!pos) return;
    this._setCamera(Math.max(this.worldZoom, CONFIG_WORLD.zoomRegionPreset), pos.x, pos.y, true);
  }

  markAllWatched() {
    projects.forEach(p => state.setWatched?.(p.id, true));
  }
}

const renderer = new MapRenderer();
