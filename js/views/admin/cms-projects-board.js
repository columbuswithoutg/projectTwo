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
 * Modeled on js/views/home-edit.js (the /home/edit floor-plan editor):
 * module-scope state per mount, bounds -> viewBox, cell<->pixel helpers,
 * one innerHTML write per render, delegated data-action dispatch, shared
 * wireModalDismiss()/confirmDialog() for overlays. Departs from it in three
 * ways this editor needs: no adjacency restriction (flowchart nodes aren't
 * contiguous), no per-cell hit rects (a few hundred cells vs. a handful of
 * slots — one background rect + coordinate math instead), and dragging
 * instead of click-to-place.
 *
 * Registered on AdminView._projectsBoard (not AdminView._cms.*, which is
 * reserved for real CMS sub-tabs keyed off js/views/admin/cms.js).
 ************************************************/
(function () {
  const esc = AdminView._escapeHtml;

  const CELL_W = 110, CELL_H = 130;   // keeps ORDER_CELL's 220:260 pitch aspect
  const NODE_W = 88, NODE_H = 98;
  const PAD = 1;                      // ring of empty cells around the extents
  const DRAG_THRESHOLD = 4;           // svg user-units before a pointerdown counts as a drag
  const ZOOM_STEPS = [0.55, 0.75, 1];

  let _host = null;
  let _items = [];                    // reference to Editor._items
  let _pos = new Map();               // id -> { gx, gy }  working copy
  let _orig = new Map();              // id -> { gx, gy }  last-saved baseline
  let _padX0 = 0, _padY0 = 0;         // origin offset used by the LAST render (hit-testing must match)
  let _drag = null;                   // { id, pointerId, el, startU, moved }
  let _pendingEmpty = null;           // cell under a pointerdown that started on empty space
  let _zoomIdx = ZOOM_STEPS.length - 1;
  let _saving = false;
  let _beforeUnloadBound = null;

  // ── public API ──────────────────────────────────────────────────────

  function mount(host, items) {
    _host = host;
    reseed(items, /* preserveDirty */ true);
    _render();
  }

  function unmount() {
    _clearBeforeUnloadGuard();
    _host = null;
    _drag = null;
    _pendingEmpty = null;
  }

  // Re-seed from a fresh item list. Preserves in-flight drag positions for
  // ids that still exist when preserveDirty is true (board <-> list toggle,
  // or opening/cancelling the per-project form) — otherwise resets clean
  // (post-save, or first mount).
  function reseed(items, preserveDirty) {
    _items = items || [];
    const nextOrig = new Map();
    const nextPos = new Map();
    for (const p of _items) {
      const cell = { gx: p.gridX | 0, gy: p.gridY | 0 };
      nextOrig.set(p.id, cell);
      const kept = preserveDirty && _pos.has(p.id) ? _pos.get(p.id) : cell;
      nextPos.set(p.id, { gx: kept.gx, gy: kept.gy });
    }
    _orig = nextOrig;
    _pos = nextPos;
    if (_host) _render();
  }

  function isDirty() {
    return _dirtyList().length > 0;
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

  // ── rendering ───────────────────────────────────────────────────────

  function _render() {
    if (!_host) return;
    const b = _bounds();
    _padX0 = b.minX - PAD;
    _padY0 = b.minY - PAD;
    const cols = (b.maxX - b.minX) + PAD * 2 + 1;
    const rows = (b.maxY - b.minY) + PAD * 2 + 1;
    const W = cols * CELL_W;
    const H = rows * CELL_H;
    const zoom = ZOOM_STEPS[_zoomIdx];

    const xOf = gx => (gx - _padX0) * CELL_W;
    const yOf = gy => (gy - _padY0) * CELL_H;

    const conflicts = _conflicts();
    const conflictIds = new Set(conflicts.flatMap(([, ids]) => ids));
    const dirty = _dirtyList();
    const dirtyIds = new Set(dirty.map(d => d.id));

    let svg = `<svg class="admin-board-svg" viewBox="0 0 ${W} ${H}" width="${W * zoom}" height="${H * zoom}" xmlns="http://www.w3.org/2000/svg">`;
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

    // Drop indicator — hidden until a drag hovers a cell.
    svg += `<rect class="admin-board-drop" width="${CELL_W}" height="${CELL_H}" style="display:none" />`;

    // Prerequisite edges — AABB-perimeter clipped, one path per edge (no
    // themed multi-layer "road" here, this is an editor not the public view).
    svg += `<g class="admin-board-edges">`;
    const halfW = NODE_W / 2, halfH = NODE_H / 2;
    for (const child of _items) {
      const cPos = _pos.get(child.id);
      if (!cPos) continue;
      (child.prerequisites || []).forEach(parentId => {
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
        svg += `<path class="admin-board-edge" d="M ${x1} ${y1} L ${x2} ${y2}" marker-end="url(#admin-board-arrow)" />`;
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
      const label = `${esc(_shorten(title, 20))}, cell ${pos.gx}, ${pos.gy}. Press Enter to edit, arrow keys to move.`;
      svg += `<g class="${classes.join(' ')}" data-action="node" data-id="${esc(p.id)}" data-gx="${pos.gx}" data-gy="${pos.gy}" tabindex="0" role="button" aria-label="${label}">`;
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

    _host.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'admin-cms-board';

    const toolbar = document.createElement('div');
    toolbar.className = 'admin-board-toolbar';
    const statusText = dirty.length
      ? `${_items.length} projects · ${dirty.length} moved`
      : `${_items.length} projects`;
    toolbar.innerHTML = `
      <span class="admin-board-status">${esc(statusText)}</span>
      <div class="admin-board-zoom">
        <button type="button" class="admin-btn admin-board-zoom-out" ${_zoomIdx === 0 ? 'disabled' : ''}>−</button>
        <span>${Math.round(zoom * 100)}%</span>
        <button type="button" class="admin-btn admin-board-zoom-in" ${_zoomIdx === ZOOM_STEPS.length - 1 ? 'disabled' : ''}>+</button>
      </div>
      <button type="button" class="admin-btn admin-board-discard" ${dirty.length ? '' : 'disabled'}>Discard</button>
      <button type="button" class="admin-btn admin-board-save" ${(!dirty.length || conflicts.length || _saving) ? 'disabled' : ''}>${_saving ? 'Saving…' : `Save layout${dirty.length ? ` (${dirty.length})` : ''}`}</button>
    `;
    wrap.appendChild(toolbar);

    if (conflicts.length) {
      const warn = document.createElement('div');
      warn.className = 'admin-board-warn';
      const cellList = conflicts.map(([key, ids]) => {
        const [gx, gy] = key.split(',');
        const names = ids.map(id => (_itemById(id) || {}).title || id).map(esc).join(', ');
        return `cell (${gx}, ${gy}): ${names}`;
      }).join(' · ');
      warn.innerHTML = `⚠ Overlapping projects — drag one apart before saving. ${cellList}`;
      wrap.appendChild(warn);
    }

    const canvas = document.createElement('div');
    canvas.className = 'admin-board-canvas';
    canvas.innerHTML = svg;
    wrap.appendChild(canvas);

    _host.appendChild(wrap);

    // Wire up.
    const svgEl = wrap.querySelector('.admin-board-svg');
    svgEl.addEventListener('pointerdown', _onPointerDown, { passive: false });
    svgEl.addEventListener('pointermove', _onPointerMove);
    svgEl.addEventListener('pointerup', _onPointerUp);
    svgEl.addEventListener('pointercancel', _onPointerCancel);
    svgEl.addEventListener('keydown', _onKeyDown);

    wrap.querySelector('.admin-board-zoom-in')?.addEventListener('click', () => _setZoom(_zoomIdx + 1));
    wrap.querySelector('.admin-board-zoom-out')?.addEventListener('click', () => _setZoom(_zoomIdx - 1));
    wrap.querySelector('.admin-board-save')?.addEventListener('click', _save);
    wrap.querySelector('.admin-board-discard')?.addEventListener('click', _discard);
  }

  function _setZoom(idx) {
    _zoomIdx = Math.max(0, Math.min(ZOOM_STEPS.length - 1, idx));
    _render();
  }

  // ── geometry / hit-testing ──────────────────────────────────────────

  function _clientToUser(svgEl, clientX, clientY) {
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return null;
    const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  }

  function _cellFromUser(u) {
    return { gx: _padX0 + Math.floor(u.x / CELL_W), gy: _padY0 + Math.floor(u.y / CELL_H) };
  }

  function _cellCenterPx(gx, gy) {
    return { x: (gx - _padX0) * CELL_W, y: (gy - _padY0) * CELL_H };
  }

  // ── pointer / drag interaction ──────────────────────────────────────
  //
  // Everything resolves in pointerup — there is no separate click listener.
  // A drag that never exceeds DRAG_THRESHOLD is treated as a click. This
  // structurally avoids the drag-then-click double-fire that orderRenderer's
  // pan controls have to paper over with a capture-phase swallower.

  function _onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const svgEl = e.currentTarget;
    const g = e.target.closest('.admin-board-node');
    const u = _clientToUser(svgEl, e.clientX, e.clientY);
    if (!u) return;

    if (!g) {
      _pendingEmpty = { cell: _cellFromUser(u), startU: u, pointerId: e.pointerId };
      return; // let native touch-pan on the canvas proceed
    }

    e.preventDefault(); // suppress touch scroll / text selection while dragging a node
    _drag = {
      id: g.dataset.id,
      pointerId: e.pointerId,
      el: g,
      startU: u,
      moved: false
    };
    try { svgEl.setPointerCapture(e.pointerId); } catch (_) {}
    g.classList.add('is-dragging');
    g.parentNode.appendChild(g); // raise above siblings for the drag duration
  }

  function _onPointerMove(e) {
    if (!_drag || e.pointerId !== _drag.pointerId) return;
    const svgEl = e.currentTarget;
    const u = _clientToUser(svgEl, e.clientX, e.clientY);
    if (!u) return;
    const dx = u.x - _drag.startU.x;
    const dy = u.y - _drag.startU.y;
    if (!_drag.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) _drag.moved = true;
    if (!_drag.moved) return;

    _drag.el.setAttribute('transform', `translate(${dx} ${dy})`);

    const cell = _cellFromUser(u);
    const occ = _occupancy();
    const key = `${cell.gx},${cell.gy}`;
    const occupants = occ.get(key) || [];
    const isInvalid = occupants.some(id => id !== _drag.id);

    const drop = svgEl.querySelector('.admin-board-drop');
    if (drop) {
      const c = _cellCenterPx(cell.gx, cell.gy);
      drop.setAttribute('x', c.x);
      drop.setAttribute('y', c.y);
      drop.style.display = '';
      drop.classList.toggle('is-invalid', isInvalid);
    }
    _drag.hoverCell = cell;
    _drag.hoverInvalid = isInvalid;
  }

  function _onPointerUp(e) {
    const svgEl = e.currentTarget;
    try { svgEl.releasePointerCapture(e.pointerId); } catch (_) {}

    if (_drag && e.pointerId === _drag.pointerId) {
      const drag = _drag;
      _drag = null;
      drag.el.classList.remove('is-dragging');
      const drop = svgEl.querySelector('.admin-board-drop');
      if (drop) drop.style.display = 'none';

      if (!drag.moved) {
        // Click on a node — open its edit form.
        drag.el.removeAttribute('transform');
        const item = _itemById(drag.id);
        if (item) AdminView._cms.projects.openForm(item, false);
        return;
      }

      if (drag.hoverInvalid) {
        AdminView.toast('That cell is taken', 'error');
        drag.el.removeAttribute('transform');
        _render();
        return;
      }

      drag.el.removeAttribute('transform');
      _pos.set(drag.id, { gx: drag.hoverCell.gx, gy: drag.hoverCell.gy });
      _armBeforeUnloadGuard();
      _render();
      return;
    }

    if (_pendingEmpty && e.pointerId === _pendingEmpty.pointerId) {
      const pending = _pendingEmpty;
      _pendingEmpty = null;
      const u = _clientToUser(svgEl, e.clientX, e.clientY);
      const moved = u ? Math.hypot(u.x - pending.startU.x, u.y - pending.startU.y) > DRAG_THRESHOLD : false;
      if (!moved) {
        const occ = _occupancy();
        const key = `${pending.cell.gx},${pending.cell.gy}`;
        if (!occ.has(key)) {
          AdminView._cms.projects.openForm({}, true, { gridX: pending.cell.gx, gridY: pending.cell.gy });
        }
      }
    }
  }

  function _onPointerCancel(e) {
    const svgEl = e.currentTarget;
    if (_drag && e.pointerId === _drag.pointerId) {
      _drag.el.classList.remove('is-dragging');
      _drag.el.removeAttribute('transform');
      _drag = null;
      const drop = svgEl.querySelector('.admin-board-drop');
      if (drop) drop.style.display = 'none';
    }
    _pendingEmpty = null;
  }

  // ── keyboard support ────────────────────────────────────────────────

  function _onKeyDown(e) {
    const g = e.target.closest('.admin-board-node');
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
    const occ = _occupancy();
    const occupants = occ.get(`${next.gx},${next.gy}`) || [];
    if (occupants.some(oid => oid !== id)) {
      AdminView.toast('That cell is taken', 'error');
      return;
    }
    _pos.set(id, next);
    _armBeforeUnloadGuard();
    _render();
    // Restore focus to the node's new element after the re-render.
    requestAnimationFrame(() => {
      const el = _host && _host.querySelector(`.admin-board-node[data-id="${CSS.escape(id)}"]`);
      if (el) el.focus();
    });
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
    _render();
    try {
      const data = await AdminView.api('/content/projects/bulk/positions', {
        method: 'PUT',
        body: JSON.stringify({ positions })
      });
      AdminView.toast(`Saved ${data.updated} position${data.updated === 1 ? '' : 's'}`, 'success');
      _clearBeforeUnloadGuard();
      if (AdminView._cms.projects && AdminView._cms.projects.adoptItems) {
        AdminView._cms.projects.adoptItems(data.items);
      }
    } catch (e) {
      AdminView.toast(e.message, 'error');
    } finally {
      _saving = false;
      _render();
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
    _pos = new Map([..._orig].map(([id, p]) => [id, { gx: p.gx, gy: p.gy }]));
    _clearBeforeUnloadGuard();
    _render();
  }

  function _armBeforeUnloadGuard() {
    if (_beforeUnloadBound) return;
    _beforeUnloadBound = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', _beforeUnloadBound);
  }

  function _clearBeforeUnloadGuard() {
    if (!_beforeUnloadBound) return;
    window.removeEventListener('beforeunload', _beforeUnloadBound);
    _beforeUnloadBound = null;
  }

  // ── tiny utilities ──────────────────────────────────────────────────

  function _shorten(s, n) {
    s = String(s);
    return s.length <= n ? s : s.slice(0, n - 1) + '…';
  }

  AdminView._projectsBoard = { mount, unmount, reseed, isDirty };
})();
