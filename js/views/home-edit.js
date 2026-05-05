/************************************************
 * HOME EDIT VIEW — /home/edit
 *
 * 2D top-down floor-plan editor for the project-themed home. Reads the
 * user's current layout + watched projects, lets them pick which watched
 * project becomes which room, and where each new room attaches. Slot
 * placement (N/E/S/W of any placed room) keeps the grid connected and
 * overlap-free; removal is gated by a connectivity check.
 *
 * On Save, PUTs to /api/profile/home-layout and routes back to /home.
 * Cancel routes back without saving.
 ************************************************/
const HomeEditView = (() => {

  const CELL = 100;            // SVG units per grid cell (display only)
  const SIDES = [
    { dx: 0, dy: -1 },         // N (smaller gy = north)
    { dx: 0, dy:  1 },         // S
    { dx: -1, dy: 0 },         // W
    { dx:  1, dy: 0 }          // E
  ];

  // ── module state (per mount) ──
  let _container = null;
  let _layout = [];             // [{ projectId, gx, gy }] — mutable working copy
  let _maxRooms = 0;
  let _watchedCount = 0;
  let _watchedIds = [];         // all projectIds the user has watched
  let _saving = false;

  // ── public API ──

  function mount(container) {
    if (!Auth.isLoggedIn()) {
      Router.go('/login');
      return;
    }
    _container = container;
    container.innerHTML = `
      <header class="pg-header">
        <button id="pg-edit-back" type="button" title="Back">← Back</button>
        <h1 class="pg-title">Edit Home</h1>
        <div style="width:48px"></div>
      </header>
      <div class="pg-edit-shell">
        <div class="pg-edit-main" id="pg-edit-main"><div class="pg-edit-loading">Loading…</div></div>
        <aside class="pg-edit-panel" id="pg-edit-panel"></aside>
      </div>
    `;
    document.getElementById('pg-edit-back').addEventListener('click', () => Router.go('/home'));
    _load();
  }

  function unmount() {
    _container = null;
    _layout = [];
    _maxRooms = 0;
    _watchedCount = 0;
    _watchedIds = [];
    _saving = false;
  }

  // ── data load ──

  async function _load() {
    let layout = { rooms: [] };
    let serverIds = null;
    try {
      const res = await fetch(`${API}/profile/home-layout`, {
        headers: { Authorization: `Bearer ${Auth.getToken()}` }
      });
      if (res.ok) {
        const data = await res.json();
        layout = data.homeLayout || { rooms: [] };
        _maxRooms = data.maxRooms || 0;
        _watchedCount = data.watchedCount || 0;
        if (Array.isArray(data.watchedIds)) serverIds = data.watchedIds;
      }
    } catch (_) { /* fall through */ }

    _layout = (layout.rooms || []).map(r => ({
      projectId: r.projectId, gx: r.gx | 0, gy: r.gy | 0
    }));
    // Server is the source of truth for watched ids — works even when the
    // user lands directly on /home/edit without first visiting a view that
    // calls state.load(). Falls back to state.data if the server didn't
    // include watchedIds (shouldn't happen with the current API, but
    // defensive in case of an older server during a partial deploy).
    if (serverIds) {
      _watchedIds = serverIds;
    } else if (typeof state !== 'undefined' && state.data) {
      _watchedIds = [...state.data.keys()];
    } else {
      _watchedIds = [];
    }
    if (_watchedCount === 0) _watchedCount = _watchedIds.length;
    if (_maxRooms === 0)     _maxRooms = Math.floor(_watchedCount / 2);

    _render();
  }

  // ── helpers ──

  function _cellKey(r) { return `${r.gx},${r.gy}`; }

  function _placedIds() { return new Set(_layout.map(r => r.projectId)); }

  function _availableProjects() {
    const placed = _placedIds();
    return _watchedIds.filter(id => !placed.has(id));
  }

  function _lookupProject(id) {
    if (typeof projects === 'undefined' || !Array.isArray(projects)) return null;
    return projects.find(p => p && p.id === id) || null;
  }

  function _imageUrl(project) {
    return project && project.image ? `${CONFIG.IMAGE_BASE}${project.image}` : '';
  }

  function _isConnected(rooms) {
    if (rooms.length <= 1) return true;
    const set = new Set(rooms.map(_cellKey));
    const seen = new Set([_cellKey(rooms[0])]);
    const queue = [rooms[0]];
    while (queue.length) {
      const r = queue.shift();
      for (const s of SIDES) {
        const k = `${r.gx + s.dx},${r.gy + s.dy}`;
        if (set.has(k) && !seen.has(k)) {
          seen.add(k);
          queue.push({ gx: r.gx + s.dx, gy: r.gy + s.dy });
        }
      }
    }
    return seen.size === rooms.length;
  }

  function _slotCells() {
    const remaining = _maxRooms - _layout.length;
    if (remaining <= 0) return [];
    if (_availableProjects().length === 0) return [];
    if (_layout.length === 0) {
      return [{ gx: 0, gy: 0 }];
    }
    const placedSet = new Set(_layout.map(_cellKey));
    const slotSet = new Set();
    const slots = [];
    for (const r of _layout) {
      for (const s of SIDES) {
        const k = `${r.gx + s.dx},${r.gy + s.dy}`;
        if (placedSet.has(k) || slotSet.has(k)) continue;
        slotSet.add(k);
        slots.push({ gx: r.gx + s.dx, gy: r.gy + s.dy });
      }
    }
    return slots;
  }

  function _bounds() {
    const slots = _slotCells();
    const all = [..._layout, ...slots];
    if (all.length === 0) {
      // Degenerate — show a small empty grid.
      return { minX: -1, maxX: 1, minY: -1, maxY: 1 };
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const c of all) {
      if (c.gx < minX) minX = c.gx;
      if (c.gx > maxX) maxX = c.gx;
      if (c.gy < minY) minY = c.gy;
      if (c.gy > maxY) maxY = c.gy;
    }
    return { minX, maxX, minY, maxY };
  }

  // ── rendering ──

  function _render() {
    _renderGrid();
    _renderPanel();
  }

  function _renderGrid() {
    const main = document.getElementById('pg-edit-main');
    if (!main) return;
    const b = _bounds();
    // 1 cell of padding on each side; min canvas of 3×3.
    const padX0 = b.minX - 1, padY0 = b.minY - 1;
    const padX1 = b.maxX + 1, padY1 = b.maxY + 1;
    const w = (padX1 - padX0 + 1) * CELL;
    const h = (padY1 - padY0 + 1) * CELL;
    const xOf = gx => (gx - padX0) * CELL;
    const yOf = gy => (gy - padY0) * CELL;

    let svg = `<svg class="pg-edit-grid" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">`;

    // Background grid lines (subtle).
    svg += `<rect x="0" y="0" width="${w}" height="${h}" fill="#0c0e18" />`;
    for (let gx = padX0; gx <= padX1 + 1; gx++) {
      const x = xOf(gx);
      svg += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="rgba(255,255,255,0.04)" stroke-width="1" />`;
    }
    for (let gy = padY0; gy <= padY1 + 1; gy++) {
      const y = yOf(gy);
      svg += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="rgba(255,255,255,0.04)" stroke-width="1" />`;
    }

    // Placed rooms.
    for (const r of _layout) {
      const project = _lookupProject(r.projectId);
      const url = _imageUrl(project);
      const x = xOf(r.gx), y = yOf(r.gy);
      const title = project ? (project.title || r.projectId) : r.projectId;
      svg += `<g class="pg-edit-room" data-action="room" data-gx="${r.gx}" data-gy="${r.gy}">`;
      svg += `<rect x="${x + 4}" y="${y + 4}" width="${CELL - 8}" height="${CELL - 8}" rx="6" fill="#1a1d2c" stroke="rgba(255,255,255,0.18)" stroke-width="1.5" />`;
      if (url) {
        svg += `<image href="${url}" x="${x + 6}" y="${y + 6}" width="${CELL - 12}" height="${CELL - 12}" preserveAspectRatio="xMidYMid slice" />`;
      }
      // Title chip at the bottom.
      const chipH = 18;
      svg += `<rect x="${x + 6}" y="${y + CELL - chipH - 6}" width="${CELL - 12}" height="${chipH}" fill="rgba(0,0,0,0.7)" />`;
      svg += `<text x="${x + CELL / 2}" y="${y + CELL - 12}" text-anchor="middle" fill="#fff" font-size="10" font-family="system-ui, sans-serif">${_escape(_shorten(title, 18))}</text>`;
      svg += `</g>`;
    }

    // Slot "+" buttons.
    for (const c of _slotCells()) {
      const x = xOf(c.gx), y = yOf(c.gy);
      svg += `<g class="pg-edit-slot" data-action="slot" data-gx="${c.gx}" data-gy="${c.gy}">`;
      svg += `<rect x="${x + 8}" y="${y + 8}" width="${CELL - 16}" height="${CELL - 16}" rx="10" fill="rgba(201,162,39,0.08)" stroke="rgba(201,162,39,0.55)" stroke-width="2" stroke-dasharray="6 6" />`;
      svg += `<text x="${x + CELL / 2}" y="${y + CELL / 2 + 12}" text-anchor="middle" fill="#dca960" font-size="36" font-family="system-ui, sans-serif">+</text>`;
      svg += `</g>`;
    }

    svg += `</svg>`;
    main.innerHTML = svg;

    // Event delegation on the grid.
    main.querySelector('.pg-edit-grid').addEventListener('click', _onGridClick);
  }

  function _renderPanel() {
    const panel = document.getElementById('pg-edit-panel');
    if (!panel) return;
    const remaining = Math.max(0, _maxRooms - _layout.length);
    const lockedCount = Math.max(0, Math.ceil((_watchedIds.length === _watchedCount ? _watchedCount : _watchedIds.length) / 2) - _maxRooms); // future capacity
    const available = _availableProjects();

    // "Locked slot" helper — how many more watches until the next room.
    const watchedNow = _watchedCount || _watchedIds.length;
    const nextUnlockAt = (_maxRooms + 1) * 2;
    const watchesToNext = Math.max(0, nextUnlockAt - watchedNow);

    let html = '';
    html += `<div class="pg-edit-summary">`;
    html += `<div><strong>${_layout.length}</strong> placed / <strong>${_maxRooms}</strong> unlocked</div>`;
    html += `<div class="pg-edit-sub">${watchedNow} watched • next room at ${nextUnlockAt}</div>`;
    html += `</div>`;

    html += `<h3>Available projects</h3>`;
    if (available.length === 0) {
      if (remaining === 0) {
        html += `<p class="pg-edit-empty">All your unlocked rooms are placed. Watch ${watchesToNext} more project${watchesToNext === 1 ? '' : 's'} to unlock another.</p>`;
      } else {
        html += `<p class="pg-edit-empty">You don't have any unplaced watched projects.</p>`;
      }
    } else {
      html += `<ul class="pg-edit-available-list">`;
      for (const id of available) {
        const project = _lookupProject(id);
        if (!project) continue;
        const disabled = remaining === 0;
        html += `<li class="pg-edit-avail-item${disabled ? ' is-disabled' : ''}" data-action="hint-avail">`;
        html += `<img src="${_imageUrl(project)}" alt="" />`;
        html += `<span>${_escape(project.title || id)}</span>`;
        html += `</li>`;
      }
      html += `</ul>`;
    }

    if (watchesToNext > 0) {
      html += `<h3>Locked</h3>`;
      html += `<p class="pg-edit-empty">🔒 Watch ${watchesToNext} more project${watchesToNext === 1 ? '' : 's'} to unlock the next room slot.</p>`;
    }

    html += `<div class="pg-edit-actions">`;
    html += `<button class="pg-btn pg-btn-cancel" type="button" id="pg-edit-cancel">Cancel</button>`;
    html += `<button class="pg-btn pg-btn-save" type="button" id="pg-edit-save"${_saving ? ' disabled' : ''}>${_saving ? 'Saving…' : 'Save'}</button>`;
    html += `</div>`;
    html += `<div class="pg-edit-error" id="pg-edit-error"></div>`;

    panel.innerHTML = html;
    document.getElementById('pg-edit-cancel').addEventListener('click', () => Router.go('/home'));
    document.getElementById('pg-edit-save').addEventListener('click', _save);
  }

  // ── interactions ──

  function _onGridClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const gx = parseInt(target.dataset.gx, 10);
    const gy = parseInt(target.dataset.gy, 10);
    if (action === 'slot') {
      _openPicker(gx, gy);
    } else if (action === 'room') {
      _openRoomMenu(gx, gy);
    }
  }

  function _openPicker(gx, gy) {
    const available = _availableProjects();
    if (available.length === 0) return;
    const overlay = document.createElement('div');
    overlay.className = 'pg-modal-overlay pg-picker-overlay';
    overlay.innerHTML = `
      <div class="pg-modal pg-picker">
        <header class="pg-modal-head">
          <h2>Pick a project for this room</h2>
          <button class="pg-modal-close" type="button" aria-label="Close">✕</button>
        </header>
        <div class="pg-modal-body">
          <ul class="pg-picker-list">
            ${available.map(id => {
              const p = _lookupProject(id);
              if (!p) return '';
              return `<li class="pg-picker-item" data-id="${_escape(id)}">
                <img src="${_imageUrl(p)}" alt="" />
                <span>${_escape(p.title || id)}</span>
              </li>`;
            }).join('')}
          </ul>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.parentNode && overlay.parentNode.removeChild(overlay);
    overlay.querySelector('.pg-modal-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelectorAll('.pg-picker-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        _layout.push({ projectId: id, gx, gy });
        close();
        _render();
      });
    });
  }

  function _openRoomMenu(gx, gy) {
    const idx = _layout.findIndex(r => r.gx === gx && r.gy === gy);
    if (idx === -1) return;
    const project = _lookupProject(_layout[idx].projectId);
    const wouldRemain = _layout.filter((_, i) => i !== idx);
    const removable = _isConnected(wouldRemain);

    const overlay = document.createElement('div');
    overlay.className = 'pg-modal-overlay pg-roommenu-overlay';
    overlay.innerHTML = `
      <div class="pg-modal pg-roommenu">
        <header class="pg-modal-head">
          <h2>${_escape(project ? (project.title || _layout[idx].projectId) : _layout[idx].projectId)}</h2>
          <button class="pg-modal-close" type="button" aria-label="Close">✕</button>
        </header>
        <div class="pg-modal-body">
          <p class="pg-edit-sub">Position: (${gx}, ${gy})</p>
          ${removable
            ? `<button class="pg-btn pg-btn-danger" type="button" id="pg-room-remove">Remove room</button>`
            : `<button class="pg-btn" type="button" disabled title="Removing this room would orphan others">Remove room (would orphan)</button>`}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.parentNode && overlay.parentNode.removeChild(overlay);
    overlay.querySelector('.pg-modal-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    if (removable) {
      overlay.querySelector('#pg-room-remove').addEventListener('click', () => {
        _layout.splice(idx, 1);
        close();
        _render();
      });
    }
  }

  async function _save() {
    if (_saving) return;
    const errEl = document.getElementById('pg-edit-error');
    if (errEl) errEl.textContent = '';
    if (_layout.length > _maxRooms) {
      if (errEl) errEl.textContent = `You can place at most ${_maxRooms} room${_maxRooms === 1 ? '' : 's'} right now.`;
      return;
    }
    if (!_isConnected(_layout)) {
      if (errEl) errEl.textContent = 'Layout is not connected — every room must be reachable from every other.';
      return;
    }
    _saving = true;
    _renderPanel();
    try {
      const res = await fetch(`${API}/profile/home-layout`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Auth.getToken()}`
        },
        body: JSON.stringify({ rooms: _layout })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      Router.go('/home');
    } catch (e) {
      _saving = false;
      _renderPanel();
      const err = document.getElementById('pg-edit-error');
      if (err) err.textContent = e.message || 'Save failed';
    }
  }

  // ── tiny utilities ──

  function _escape(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function _shorten(s, n) {
    s = String(s);
    return s.length <= n ? s : s.slice(0, n - 1) + '…';
  }

  return { mount, unmount, title: 'Edit Home — MCU Tracker' };
})();
