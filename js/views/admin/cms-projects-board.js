/************************************************
 * ADMIN — CMS PROJECTS BOARD (drag-to-move layout editor)
 *
 * A visual companion to the plain list/form editor in cms-projects.js.
 * Renders every project as a node at its gridX/gridY with prerequisite
 * arrows between them (a mini watch-order chart), lets the admin drag
 * nodes to free cells, click an empty cell to create a project there, and
 * click a node to open its normal edit form. Moves are staged locally and
 * committed in one "Save layout" request.
 *
 * Navigation matches the public watch-order chart (js/pan-zoom.js): drag
 * empty space to move around, mouse wheel / pinch to zoom at the cursor,
 * − and + buttons; no scrollbars and no percentage readout.
 *
 * The shell (toolbar, canvas, listeners, pan/zoom) is built ONCE per mount
 * and only the SVG is repainted, so the view stays exactly where it was
 * after a drop, a save, a discard or a cancelled project form — it used to
 * jump back to the top-left on every change. The view centre is kept in
 * grid coordinates (_viewCenter), so it also survives the board growing or
 * shrinking when a node moves past the edge.
 *
 * Unsaved moves live in module state: they survive switching CMS sub-tabs
 * and saving/deleting a project through the form. Leaving the admin page
 * with moves pending asks first (AdminView.canLeave, via the router).
 *
 * Registered on AdminView._projectsBoard (not AdminView._cms.*, which is
 * reserved for real CMS sub-tabs keyed off js/views/admin/cms.js).
 ************************************************/
(function () {
  const esc = AdminView._escapeHtml;

  const CELL_W = 110, CELL_H = 130;   // keeps ORDER_CELL's 220:260 pitch aspect
  const NODE_W = 88, NODE_H = 98;
  const PAD = 1;                      // ring of empty cells around the extents
  const ZOOM_MIN = 0.35, ZOOM_MAX = 1.6, ZOOM_STEP = 1.2;
  const ZOOM_KEY = 'mcu_admin_board_zoom';
  const EDGE_PX = 40;                 // auto-scroll band while dragging a node

  let _host = null;
  let _items = [];                    // reference to Editor._items
  let _pos = new Map();               // id -> { gx, gy }  working copy
  let _orig = new Map();              // id -> { gx, gy }  last-saved baseline
  let _padX0 = 0, _padY0 = 0;         // origin offset used by the LAST paint (hit-testing must match)
  let _W = 0, _H = 0;                 // natural (zoom 1) SVG size of the last paint
  let _off = { x: 0, y: 0 };          // centring margin when the board is smaller than the canvas
  let _drag = null;                   // { id, pointerId, el, startU, x0, y0, moved, hoverCell, hoverInvalid }
  let _pendingEmpty = null;           // { cell, x, y, pointerId, moved } — a press on empty space
  let _saving = false;
  let _zoom = _loadZoom();
  let _viewCenter = null;             // { gx, gy } fractional cell coords at the canvas centre
  let _shell = null;                  // persistent DOM for the current mount
  let _panZoom = null;
  let _onResize = null;

  // ── public API ──────────────────────────────────────────────────────

  function mount(host, items) {
    // The list/board toggle and adoptItems() re-mount without an unmount.
    if (_shell && _shell.painted) _rememberView();
    if (_panZoom) { _panZoom.destroy(); _panZoom = null; }
    if (_onResize) { window.removeEventListener('resize', _onResize); _onResize = null; }
    _shell = null;
    _host = host;
    reseed(items, /* keepMoves */ true);
    _ensureShell();
    _fitHeight();
    _paint();
  }

  function unmount() {
    if (_shell && _shell.painted) _rememberView();
    if (_panZoom) { _panZoom.destroy(); _panZoom = null; }
    if (_onResize) { window.removeEventListener('resize', _onResize); _onResize = null; }
    _host = null;
    _shell = null;
    _drag = null;
    _pendingEmpty = null;
    _syncPendingDot();
  }

  // Re-seed from a fresh item list. keepMoves keeps in-flight positions for
  // ids that still exist (board <-> list toggle, a form save or delete);
  // otherwise resets clean (after the board's own save).
  function reseed(items, keepMoves) {
    _items = items || [];
    const nextOrig = new Map();
    const nextPos = new Map();
    for (const p of _items) {
      const cell = { gx: p.gridX | 0, gy: p.gridY | 0 };
      nextOrig.set(p.id, cell);
      const kept = keepMoves && _pos.has(p.id) ? _pos.get(p.id) : cell;
      nextPos.set(p.id, { gx: kept.gx, gy: kept.gy });
    }
    _orig = nextOrig;
    _pos = nextPos;
    if (_shell) _paint();
    _syncPendingDot();
  }

  function isDirty() {
    return _dirtyList().length > 0;
  }

  // Throw away every unsaved move (the leave guard calls this once the admin
  // has confirmed).
  function discardAll() {
    _pos = new Map([..._orig].map(([id, p]) => [id, { gx: p.gx, gy: p.gy }]));
    if (_shell) _paint();
    _syncPendingDot();
  }

  // ── derived state ───────────────────────────────────────────────────

  function _itemById(id) {
    return _items.find(p => p.id === id) || null;
  }

  function _bounds() {
    if (_pos.size === 0) return { minX: 0, maxX: 2, minY: 0, maxY: 2 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of _pos.values()) {
      if (p.gx < minX) minX = p.gx;
      if (p.gx > maxX) maxX = p.gx;
      if (p.gy < minY) minY = p.gy;
      if (p.gy > maxY) maxY = p.gy;
    }
    return { minX, maxX, minY, maxY };
  }

  function _occupancy() {
    const m = new Map(); // "gx,gy" -> [id]
    for (const [id, p] of _pos) {
      const k = `${p.gx},${p.gy}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(id);
    }
    return m;
  }

  function _conflicts() {
    return [..._occupancy().entries()].filter(([, ids]) => ids.length > 1);
  }

  function _dirtyList() {
    const out = [];
    for (const [id, p] of _pos) {
      const o = _orig.get(id);
      if (o && (o.gx !== p.gx || o.gy !== p.gy)) out.push({ id, gridX: p.gx, gridY: p.gy });
    }
    return out;
  }

  // ── shell (built once per mount) ────────────────────────────────────

  function _ensureShell() {
    _host.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'admin-cms-board';
    wrap.innerHTML = `
      <div class="admin-board-toolbar">
        <span class="admin-board-status"></span>
        <span class="admin-board-hint">Drag to move around · scroll to zoom · drag a project to move it</span>
        <div class="admin-board-zoom" role="group" aria-label="Zoom">
          <button type="button" class="admin-btn admin-board-zoom-out" aria-label="Zoom out" title="Zoom out">−</button>
          <button type="button" class="admin-btn admin-board-zoom-in" aria-label="Zoom in" title="Zoom in">+</button>
        </div>
        <button type="button" class="admin-btn admin-board-discard">Discard</button>
        <button type="button" class="admin-btn admin-board-save">Save layout</button>
      </div>
      <div class="admin-board-warn" hidden></div>
      <div class="admin-board-canvas"><div class="admin-board-stage"></div></div>
    `;
    _host.appendChild(wrap);

    const $w = (sel) => wrap.querySelector(sel);
    _shell = {
      wrap,
      canvas: $w('.admin-board-canvas'),
      stage: $w('.admin-board-stage'),
      status: $w('.admin-board-status'),
      warn: $w('.admin-board-warn'),
      zoomIn: $w('.admin-board-zoom-in'),
      zoomOut: $w('.admin-board-zoom-out'),
      discard: $w('.admin-board-discard'),
      save: $w('.admin-board-save')
    };
    const c = _shell.canvas;

    // Delegated on the persistent canvas: they keep working across repaints
    // and while the canvas holds the pointer capture.
    c.addEventListener('pointerdown', _onPointerDown, { passive: false });
    c.addEventListener('pointermove', _onPointerMove);
    c.addEventListener('pointerup', _onPointerUp);
    c.addEventListener('pointercancel', _onPointerCancel);
    c.addEventListener('pointerleave', _hideGhost);
    c.addEventListener('keydown', _onKeyDown);
    c.addEventListener('scroll', _rememberView, { passive: true });

    _shell.zoomIn.addEventListener('click', () => _zoomAtCenter(ZOOM_STEP));
    _shell.zoomOut.addEventListener('click', () => _zoomAtCenter(1 / ZOOM_STEP));
    _shell.save.addEventListener('click', _save);
    _shell.discard.addEventListener('click', _discard);

    _panZoom = PanZoom.attach(c, {
      min: ZOOM_MIN,
      max: ZOOM_MAX,
      getZoom: () => _zoom,
      setZoom: _setZoom,
      // Nodes are dragged to new cells; everything else moves the view.
      canPanFrom: (t) => !(t && t.closest && t.closest('.admin-board-node')),
      onPanStart: _hideGhost,
      onPinchStart: _cancelNodeDrag
    });

    _onResize = () => { _fitHeight(); _applySize(); _restoreView(); };
    window.addEventListener('resize', _onResize);
  }

  // The canvas fills the rest of the window (it used to be a 70vh box with
  // its own scrollbars inside the scrolling admin page).
  function _fitHeight() {
    if (!_shell) return;
    const c = _shell.canvas;
    const page = c.closest('.admin-page');
    const pageTop = page ? page.getBoundingClientRect().top - page.scrollTop : 0;
    const top = c.getBoundingClientRect().top - pageTop;
    const h = Math.max(420, Math.round(window.innerHeight - top - 20));
    c.style.height = h + 'px';
  }

  // ── rendering ───────────────────────────────────────────────────────

  function _paint() {
    if (!_shell) return;
    // Remember where the camera is right now (scroll events are async and
    // may not have fired since the last pan) — the first paint of a fresh
    // shell keeps the centre saved from the previous mount instead.
    if (_shell.painted) _rememberView();
    _shell.painted = true;
    const b = _bounds();
    _padX0 = b.minX - PAD;
    _padY0 = b.minY - PAD;
    const cols = (b.maxX - b.minX) + PAD * 2 + 1;
    const rows = (b.maxY - b.minY) + PAD * 2 + 1;
    const W = cols * CELL_W;
    const H = rows * CELL_H;
    _W = W; _H = H;

    const xOf = gx => (gx - _padX0) * CELL_W;
    const yOf = gy => (gy - _padY0) * CELL_H;

    const conflicts = _conflicts();
    const conflictIds = new Set(conflicts.flatMap(([, ids]) => ids));
    const dirty = _dirtyList();
    const dirtyIds = new Set(dirty.map(d => d.id));

    let svg = `<svg class="admin-board-svg" viewBox="0 0 ${W} ${H}" width="${W * _zoom}" height="${H * _zoom}" xmlns="http://www.w3.org/2000/svg">`;
    svg += `<defs><marker id="admin-board-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">`;
    svg += `<path d="M0,0 L0,6 L7,3 Z" class="admin-board-arrow-tip" /></marker></defs>`;
    svg += `<rect class="admin-board-bg" data-action="bg" x="0" y="0" width="${W}" height="${H}" />`;

    // Grid lines.
    svg += `<g class="admin-board-lines">`;
    for (let c = 0; c <= cols; c++) {
      const x = c * CELL_W;
      svg += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" />`;
    }
    for (let r = 0; r <= rows; r++) {
      const y = r * CELL_H;
      svg += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" />`;
    }
    svg += `</g>`;

    // Hover ghost on empty cells ("click to add a project here") and the
    // drop indicator — both hidden until used.
    svg += `<g class="admin-board-ghost" style="display:none"><rect width="${CELL_W - 12}" height="${CELL_H - 12}" x="6" y="6" rx="8" />`;
    svg += `<text x="${CELL_W / 2}" y="${CELL_H / 2 + 10}" text-anchor="middle">+</text></g>`;
    svg += `<rect class="admin-board-drop" width="${CELL_W}" height="${CELL_H}" style="display:none" />`;

    // Prerequisite edges — AABB-perimeter clipped, one path per edge (no
    // themed multi-layer "road" here, this is an editor not the public view).
    svg += `<g class="admin-board-edges">`;
    const halfW = NODE_W / 2, halfH = NODE_H / 2;
    for (const child of _items) {
      const cPos = _pos.get(child.id);
      if (!cPos) continue;
      const edges = [
        ...(child.prerequisites || []).map(id => [id, false]),
        // Recommended (optional) links: dashed, so the admin can tell them apart.
        ...(child.recommendedPrerequisites || []).map(id => [id, true])
      ];
      edges.forEach(([parentId, optional]) => {
        const pPos = _pos.get(parentId);
        if (!pPos) return;
        const fromX = xOf(pPos.gx) + CELL_W / 2, fromY = yOf(pPos.gy) + CELL_H / 2;
        const toX = xOf(cPos.gx) + CELL_W / 2, toY = yOf(cPos.gy) + CELL_H / 2;
        const dx = toX - fromX, dy = toY - fromY;
        const len = Math.hypot(dx, dy);
        if (len === 0) return;
        const ux = dx / len, uy = dy / len;
        const exit = (v, h) => {
          const tx = Math.abs(ux) > 1e-6 ? v / Math.abs(ux) : Infinity;
          const ty = Math.abs(uy) > 1e-6 ? h / Math.abs(uy) : Infinity;
          return Math.min(tx, ty);
        };
        const d0 = exit(halfW, halfH);
        const x1 = fromX + ux * d0, y1 = fromY + uy * d0;
        const x2 = toX - ux * d0, y2 = toY - uy * d0;
        svg += `<path class="admin-board-edge${optional ? ' is-recommended' : ''}" d="M ${x1} ${y1} L ${x2} ${y2}" marker-end="url(#admin-board-arrow)" />`;
      });
    }
    svg += `</g>`;

    // Nodes.
    svg += `<g class="admin-board-nodes">`;
    for (const p of _items) {
      const pos = _pos.get(p.id);
      if (!pos) continue;
      const x = xOf(pos.gx) + (CELL_W - NODE_W) / 2;
      const y = yOf(pos.gy) + (CELL_H - NODE_H) / 2;
      const classes = ['admin-board-node'];
      if (dirtyIds.has(p.id)) classes.push('is-moved');
      if (conflictIds.has(p.id)) classes.push('is-conflict');
      const title = p.title || p.id;
      const label = `${esc(title)}, cell ${pos.gx}, ${pos.gy}. Press Enter to edit, arrow keys to move.`;
      svg += `<g class="${classes.join(' ')}" data-action="node" data-id="${esc(p.id)}" data-gx="${pos.gx}" data-gy="${pos.gy}" tabindex="0" role="button" aria-label="${label}">`;
      svg += `<title>${esc(title)}</title>`;
      svg += `<rect class="admin-board-node-rect" x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="6" />`;
      svg += `<text class="admin-board-node-label" x="${x + NODE_W / 2}" y="${y + NODE_H / 2 - 6}" text-anchor="middle">${esc(_shorten(title, 16))}</text>`;
      if (p.release) {
        svg += `<text class="admin-board-node-sub" x="${x + NODE_W / 2}" y="${y + NODE_H / 2 + 12}" text-anchor="middle">${esc(p.release.slice(0, 4))}</text>`;
      }
      svg += `<text class="admin-board-node-coord" x="${x + NODE_W / 2}" y="${y + NODE_H - 6}" text-anchor="middle">${pos.gx}, ${pos.gy}</text>`;
      svg += `</g>`;
    }
    svg += `</g>`;
    svg += `</svg>`;

    _shell.stage.innerHTML = svg;
    _applySize();
    _restoreView();

    // Toolbar + warnings.
    _shell.status.textContent = dirty.length
      ? `${_items.length} projects · ${dirty.length} moved`
      : `${_items.length} projects`;
    _shell.discard.disabled = !dirty.length || _saving;
    _shell.save.disabled = !dirty.length || conflicts.length > 0 || _saving;
    _shell.save.textContent = _saving ? 'Saving…' : `Save layout${dirty.length ? ` (${dirty.length})` : ''}`;
    _syncZoomButtons();

    if (conflicts.length) {
      const cellList = conflicts.map(([key, ids]) => {
        const [gx, gy] = key.split(',');
        const names = ids.map(id => (_itemById(id) || {}).title || id).map(esc).join(', ');
        return `cell (${gx}, ${gy}): ${names}`;
      }).join(' · ');
      _shell.warn.innerHTML = `⚠ Overlapping projects — drag one apart before saving. ${cellList}`;
      _shell.warn.hidden = false;
    } else {
      _shell.warn.hidden = true;
      _shell.warn.textContent = '';
    }
    _syncPendingDot();
  }

  // Size the SVG for the current zoom and centre it when it's smaller than
  // the canvas.
  function _applySize() {
    if (!_shell) return;
    const svgEl = _svgEl();
    if (!svgEl) return;
    const c = _shell.canvas;
    const w = _W * _zoom, h = _H * _zoom;
    svgEl.setAttribute('width', w);
    svgEl.setAttribute('height', h);
    _off = {
      x: Math.max(0, (c.clientWidth - w) / 2),
      y: Math.max(0, (c.clientHeight - h) / 2)
    };
    svgEl.style.marginLeft = _off.x + 'px';
    svgEl.style.marginTop = _off.y + 'px';
  }

  // ── view: zoom + where the camera is ────────────────────────────────

  function _loadZoom() {
    try {
      const v = parseFloat(localStorage.getItem(ZOOM_KEY));
      if (Number.isFinite(v)) return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v));
    } catch (_) {}
    return 0.8;
  }

  function _saveZoom() {
    clearTimeout(_saveZoom._t);
    _saveZoom._t = setTimeout(() => {
      try { localStorage.setItem(ZOOM_KEY, String(_zoom)); } catch (_) {}
    }, 250);
  }

  function _syncZoomButtons() {
    if (!_shell) return;
    _shell.zoomOut.disabled = _zoom <= ZOOM_MIN + 1e-4;
    _shell.zoomIn.disabled = _zoom >= ZOOM_MAX - 1e-4;
  }

  // Zoom keeping the content under (ax, ay) — px from the canvas's top-left —
  // where it is. Resizes the SVG in place; no repaint.
  function _setZoom(next, ax, ay) {
    if (!_shell) return;
    const c = _shell.canvas;
    const z0 = _zoom;
    const z1 = PanZoomLogic.clampZoom(next, ZOOM_MIN, ZOOM_MAX, z0);
    if (Math.abs(z1 - z0) < 1e-4) return;
    if (ax == null) ax = c.clientWidth / 2;
    if (ay == null) ay = c.clientHeight / 2;
    const cx = (c.scrollLeft + ax - _off.x) / z0;
    const cy = (c.scrollTop + ay - _off.y) / z0;
    _zoom = z1;
    _applySize();
    c.scrollLeft = Math.max(0, cx * z1 + _off.x - ax);
    c.scrollTop = Math.max(0, cy * z1 + _off.y - ay);
    _rememberView();
    _saveZoom();
    _syncZoomButtons();
  }

  function _zoomAtCenter(factor) {
    _setZoom(_zoom * factor);
  }

  // Grid cell coordinates (fractional) under the canvas centre.
  function _rememberView() {
    if (!_shell) return;
    const c = _shell.canvas;
    if (!c.clientWidth || !_W) return;
    _viewCenter = {
      gx: _padX0 + (c.scrollLeft + c.clientWidth / 2 - _off.x) / (CELL_W * _zoom),
      gy: _padY0 + (c.scrollTop + c.clientHeight / 2 - _off.y) / (CELL_H * _zoom)
    };
  }

  function _restoreView() {
    if (!_shell) return;
    if (!_viewCenter) {
      // First visit: the middle of the board.
      const b = _bounds();
      _viewCenter = { gx: (b.minX + b.maxX + 1) / 2, gy: (b.minY + b.maxY + 1) / 2 };
    }
    const c = _shell.canvas;
    const keep = _viewCenter;
    c.scrollLeft = Math.max(0, (keep.gx - _padX0) * CELL_W * _zoom + _off.x - c.clientWidth / 2);
    c.scrollTop = Math.max(0, (keep.gy - _padY0) * CELL_H * _zoom + _off.y - c.clientHeight / 2);
    _viewCenter = keep;   // the scroll event must not overwrite it with a clamped value mid-paint
  }

  // ── geometry / hit-testing ──────────────────────────────────────────

  function _svgEl() {
    return _shell ? _shell.stage.querySelector('.admin-board-svg') : null;
  }

  function _clientToUser(svgEl, clientX, clientY) {
    const ctm = svgEl && svgEl.getScreenCTM();
    if (!ctm) return null;
    const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  }

  function _cellFromUser(u) {
    return { gx: _padX0 + Math.floor(u.x / CELL_W), gy: _padY0 + Math.floor(u.y / CELL_H) };
  }

  function _cellOriginPx(gx, gy) {
    return { x: (gx - _padX0) * CELL_W, y: (gy - _padY0) * CELL_H };
  }

  // ── pointer / drag interaction ──────────────────────────────────────
  //
  // Everything resolves in pointerup — there is no separate click listener.
  // A press on a node that never moves DRAG_PX screen pixels is a click
  // (open its form); a press on empty space that never moves is "add a
  // project here"; a moving press on empty space is a pan (js/pan-zoom.js).

  function _onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    _rememberView();   // a click may open a form that replaces the board
    const svgEl = _svgEl();
    if (!svgEl || !svgEl.contains(e.target)) return;
    const g = e.target.closest('.admin-board-node');
    const u = _clientToUser(svgEl, e.clientX, e.clientY);
    if (!u) return;

    if (!g) {
      _pendingEmpty = { cell: _cellFromUser(u), x: e.clientX, y: e.clientY, pointerId: e.pointerId, moved: false };
      return;
    }

    e.preventDefault(); // no text selection / touch scroll while dragging a node
    _hideGhost();
    _drag = {
      id: g.dataset.id,
      pointerId: e.pointerId,
      el: g,
      startU: u,
      x0: e.clientX,
      y0: e.clientY,
      moved: false
    };
    try { _shell.canvas.setPointerCapture(e.pointerId); } catch (_) {}
    g.classList.add('is-dragging');
    g.parentNode.appendChild(g); // raise above siblings for the drag duration
  }

  function _onPointerMove(e) {
    if (_pendingEmpty && e.pointerId === _pendingEmpty.pointerId &&
        PanZoomLogic.pastThreshold(e.clientX - _pendingEmpty.x, e.clientY - _pendingEmpty.y)) {
      _pendingEmpty.moved = true;
    }
    if (!_drag) {
      if (e.pointerType === 'mouse' && e.buttons === 0) _showGhost(e);
      return;
    }
    if (e.pointerId !== _drag.pointerId) return;
    if (!_drag.moved) {
      if (!PanZoomLogic.pastThreshold(e.clientX - _drag.x0, e.clientY - _drag.y0)) return;
      _drag.moved = true;
    }
    _autoScroll(e);
    _dragTo(e.clientX, e.clientY);
  }

  function _dragTo(clientX, clientY) {
    const svgEl = _svgEl();
    const u = _clientToUser(svgEl, clientX, clientY);
    if (!u || !_drag) return;
    const dx = u.x - _drag.startU.x;
    const dy = u.y - _drag.startU.y;
    _drag.el.setAttribute('transform', `translate(${dx} ${dy})`);

    const cell = _cellFromUser(u);
    const occupants = _occupancy().get(`${cell.gx},${cell.gy}`) || [];
    const isInvalid = occupants.some(id => id !== _drag.id);

    const drop = svgEl.querySelector('.admin-board-drop');
    if (drop) {
      const c = _cellOriginPx(cell.gx, cell.gy);
      drop.setAttribute('x', c.x);
      drop.setAttribute('y', c.y);
      drop.style.display = '';
      drop.classList.toggle('is-invalid', isInvalid);
    }
    _drag.hoverCell = cell;
    _drag.hoverInvalid = isInvalid;
  }

  // Dragging a node toward an edge scrolls the board that way.
  function _autoScroll(e) {
    const c = _shell.canvas;
    const r = c.getBoundingClientRect();
    const push = (d) => (d < EDGE_PX ? Math.ceil((EDGE_PX - d) / 3) : 0);
    const sx = push(r.right - e.clientX) - push(e.clientX - r.left);
    const sy = push(r.bottom - e.clientY) - push(e.clientY - r.top);
    if (sx) c.scrollLeft += sx;
    if (sy) c.scrollTop += sy;
  }

  function _onPointerUp(e) {
    try { _shell && _shell.canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    _rememberView();   // after a pan (scroll events can lag behind)

    if (_drag && e.pointerId === _drag.pointerId) {
      const drag = _drag;
      _drag = null;
      drag.el.classList.remove('is-dragging');
      const svgEl = _svgEl();
      const drop = svgEl && svgEl.querySelector('.admin-board-drop');
      if (drop) drop.style.display = 'none';

      if (!drag.moved) {
        // Click on a node — open its edit form.
        drag.el.removeAttribute('transform');
        const item = _itemById(drag.id);
        if (item) AdminView._cms.projects.openForm(item, false);
        return;
      }

      drag.el.removeAttribute('transform');
      if (!drag.hoverCell) { _paint(); return; }
      if (drag.hoverInvalid) {
        AdminView.toast('That cell is taken', 'error');
        _paint();
        return;
      }
      _pos.set(drag.id, { gx: drag.hoverCell.gx, gy: drag.hoverCell.gy });
      _paint();
      return;
    }

    if (_pendingEmpty && e.pointerId === _pendingEmpty.pointerId) {
      const pending = _pendingEmpty;
      _pendingEmpty = null;
      const moved = pending.moved || PanZoomLogic.pastThreshold(e.clientX - pending.x, e.clientY - pending.y);
      if (!moved && !_occupancy().has(`${pending.cell.gx},${pending.cell.gy}`)) {
        AdminView._cms.projects.openForm({}, true, { gridX: pending.cell.gx, gridY: pending.cell.gy });
      }
    }
  }

  function _cancelNodeDrag() {
    if (_drag) {
      _drag.el.classList.remove('is-dragging');
      _drag.el.removeAttribute('transform');
      _drag = null;
      const svgEl = _svgEl();
      const drop = svgEl && svgEl.querySelector('.admin-board-drop');
      if (drop) drop.style.display = 'none';
    }
    _pendingEmpty = null;
  }

  function _onPointerCancel(e) {
    if (_drag && e.pointerId === _drag.pointerId) _cancelNodeDrag();
    if (_pendingEmpty && e.pointerId === _pendingEmpty.pointerId) _pendingEmpty = null;
  }

  // "+" ghost on the empty cell under the mouse — click it to add a project.
  function _showGhost(e) {
    const svgEl = _svgEl();
    const ghost = svgEl && svgEl.querySelector('.admin-board-ghost');
    if (!ghost) return;
    const onNode = e.target && e.target.closest && e.target.closest('.admin-board-node');
    const u = !onNode && _clientToUser(svgEl, e.clientX, e.clientY);
    const cell = u && _cellFromUser(u);
    if (!cell || _occupancy().has(`${cell.gx},${cell.gy}`) || (_panZoom && _panZoom.isPanning())) {
      ghost.style.display = 'none';
      return;
    }
    const o = _cellOriginPx(cell.gx, cell.gy);
    ghost.setAttribute('transform', `translate(${o.x} ${o.y})`);
    ghost.style.display = '';
  }

  function _hideGhost() {
    const svgEl = _svgEl();
    const ghost = svgEl && svgEl.querySelector('.admin-board-ghost');
    if (ghost) ghost.style.display = 'none';
  }

  // ── keyboard support ────────────────────────────────────────────────

  function _onKeyDown(e) {
    const g = e.target.closest && e.target.closest('.admin-board-node');
    if (!g) return;
    const id = g.dataset.id;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const item = _itemById(id);
      if (item) AdminView._cms.projects.openForm(item, false);
      return;
    }
    const deltas = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    const d = deltas[e.key];
    if (!d) return;
    e.preventDefault();
    const cur = _pos.get(id);
    if (!cur) return;
    const next = { gx: cur.gx + d[0], gy: cur.gy + d[1] };
    const occupants = _occupancy().get(`${next.gx},${next.gy}`) || [];
    if (occupants.some(oid => oid !== id)) {
      AdminView.toast('That cell is taken', 'error');
      return;
    }
    _pos.set(id, next);
    _paint();
    // Focus the node's new element and keep it in view.
    const el = _shell && _shell.stage.querySelector(`.admin-board-node[data-id="${CSS.escape(id)}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
    }
  }

  // ── save / discard ──────────────────────────────────────────────────

  async function _save() {
    if (_saving) return;
    if (_conflicts().length) {
      AdminView.toast('Resolve overlapping cells first', 'error');
      return;
    }
    const positions = _dirtyList();
    if (!positions.length) return;
    _saving = true;
    _paint();
    try {
      const data = await AdminView.api('/content/projects/bulk/positions', {
        method: 'PUT',
        body: JSON.stringify({ positions })
      });
      AdminView.toast(`Saved ${data.updated} position${data.updated === 1 ? '' : 's'}`, 'success');
      _saving = false;
      if (AdminView._cms.projects && AdminView._cms.projects.adoptItems) {
        AdminView._cms.projects.adoptItems(data.items, { keepMoves: false });
      }
    } catch (e) {
      AdminView.toast(e.message, 'error');
    } finally {
      _saving = false;
      if (_shell) _paint();
    }
  }

  async function _discard() {
    const dirty = _dirtyList();
    if (!dirty.length) return;
    const ok = await confirmDialog({
      title: `Discard ${dirty.length} unsaved move${dirty.length === 1 ? '' : 's'}?`,
      message: 'Positions will revert to their last-saved cells.',
      confirmLabel: 'Discard',
      danger: true
    });
    if (!ok) return;
    discardAll();
  }

  // A dot on the CMS "Projects" sub-tab while moves are waiting to be saved.
  function _syncPendingDot() {
    const dirty = isDirty();
    document.querySelectorAll('.admin-subtab[data-cms="projects"]')
      .forEach(el => el.classList.toggle('has-pending', dirty));
  }

  // ── tiny utilities ──────────────────────────────────────────────────

  function _shorten(s, n) {
    s = String(s);
    return s.length <= n ? s : s.slice(0, n - 1) + '…';
  }

  AdminView._projectsBoard = { mount, unmount, reseed, isDirty, discardAll };
})();
