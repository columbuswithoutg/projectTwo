/************************************************
 * CHARACTER CUSTOMIZER — /customize
 *
 * Full-page replacement for the old builder modal. A big rotatable 3D preview
 * (Playground3D.createPreview, with a 2D fallback) beside a single-slot editor:
 * category tabs (Body / Face / Hair / …) → a slot selector within the active
 * category → that one slot's options. Shape/style ("label") slots render every
 * option as a live mini-avatar tile (the current character with just that slot
 * swapped); color ("swatch"/"accent") slots stay as fast-to-scan colour dots.
 * Randomize / Reset / Save in the toolbar; Save PUTs to
 * /api/profile/home-character then navigates back to the route the user came
 * from (default /home), which re-fetches and re-renders the character.
 *
 * Entry: HomeBuilder.open() (the legacy modal entry point) now stashes the
 * caller's route on window.__czReturn and routes here — so the ✎ button,
 * drawer "Customize character", and first-visit flow all land on this page.
 ************************************************/
const CustomizeView = {
  title: 'Customize — MCU Tracker',

  mount(container, _params) {
    if (!Auth.isLoggedIn()) { Router.go('/login'); return; }

    // The router strips query strings, so the caller stashes the return route
    // on a global instead. Sanitize to an in-app path; default to /home.
    let ret = (typeof window !== 'undefined' && window.__czReturn) || '/home';
    if (typeof ret !== 'string' || ret[0] !== '/') ret = '/home';
    CustomizeView._return = ret;

    container.innerHTML = `
      <header class="pg-header">
        <button id="cz-back" title="Back" aria-label="Back">←</button>
        <h1 class="pg-title">Customize</h1>
        <button id="cz-save" class="pg-btn pg-btn-save" type="button">Save</button>
      </header>
      <div class="cz-wrap">
        <div class="cz-preview" id="cz-preview"></div>
        <div class="cz-panel">
          <div class="cz-toolbar">
            <div class="cz-tools">
              <button class="pg-btn" type="button" id="cz-random">🎲 Randomize</button>
              <button class="pg-btn" type="button" id="cz-reset">↺ Reset</button>
            </div>
          </div>
          <div class="cz-tabs" id="cz-tabs"></div>
          <div class="cz-slot-pills" id="cz-slot-pills"></div>
          <div class="cz-options" id="cz-options"></div>
          <p class="pg-builder-error" id="cz-error" hidden></p>
        </div>
      </div>
    `;

    document.getElementById('cz-back').addEventListener('click', () => CustomizeView._back());
    document.getElementById('cz-save').addEventListener('click', () => CustomizeView._save());
    document.getElementById('cz-random').addEventListener('click', () => CustomizeView._randomize());
    document.getElementById('cz-reset').addEventListener('click', () => CustomizeView._reset());

    CustomizeView._overlayRoot = container;
    CustomizeView._previewHandle = null;
    CustomizeView._load();
  },

  async _load() {
    const base = Playground.defaultCharacter();
    let saved = null;
    try {
      const res = await fetch(`${API}/profile/home-character`, {
        headers: { Authorization: `Bearer ${Auth.getToken()}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.homeCharacter && data.homeCharacter.skin != null) saved = data.homeCharacter;
      }
    } catch (_) { /* offline — fall back to defaults */ }

    // Guard against the view having been unmounted while the fetch was in
    // flight (fast navigation away).
    if (!CustomizeView._overlayRoot || !CustomizeView._overlayRoot.isConnected) return;

    CustomizeView._initial = { ...base, ...(saved || {}) };
    CustomizeView._current = { ...CustomizeView._initial };

    // Which tab/slot is open. Start on the first section's first slot.
    CustomizeView._sections = CustomizeView._computeSections();
    const presets = (typeof Playground !== 'undefined' && Playground.CHARACTER_PRESETS) || [];
    CustomizeView._hasPresets = presets.length > 0;
    CustomizeView._activeSection = CustomizeView._sections[0] || null;
    const firstSlots = CustomizeView._slotsIn(CustomizeView._activeSection);
    CustomizeView._activeSlot = firstSlots.length ? firstSlots[0].key : null;

    CustomizeView._renderPanel();
    CustomizeView._updatePreview();
  },

  // ── schema helpers ──
  // Sections in CHARACTER_SECTION_ORDER, then any extras in first-seen order.
  _computeSections() {
    const order = (typeof CHARACTER_SECTION_ORDER !== 'undefined') ? CHARACTER_SECTION_ORDER : [];
    const sections = [];
    (CHARACTER_SCHEMA || []).forEach(e => { if (!sections.includes(e.section)) sections.push(e.section); });
    sections.sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    return sections;
  },

  _slotsIn(section) {
    return (CHARACTER_SCHEMA || []).filter(e => e.section === section);
  },

  // Schema sections, plus a trailing "Presets" pseudo-tab (it has no slots —
  // its tab shows the full-look preset buttons instead of a slot editor).
  _tabList() {
    const base = CustomizeView._sections || [];
    return CustomizeView._hasPresets ? base.concat(['Presets']) : base.slice();
  },

  // ── panel: tabs → slot pills → options ──
  _renderPanel() {
    CustomizeView._renderTabs();
    CustomizeView._renderSlotPills();
    CustomizeView._renderOptions();
  },

  _renderTabs() {
    const host = document.getElementById('cz-tabs');
    if (!host) return;
    host.innerHTML = CustomizeView._tabList().map(sec =>
      `<button type="button" class="cz-tab${sec === CustomizeView._activeSection ? ' active' : ''}" data-section="${sec}">${sec}</button>`
    ).join('');
    host.querySelectorAll('.cz-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        CustomizeView._activeSection = btn.dataset.section;
        if (CustomizeView._activeSection === 'Presets') {
          CustomizeView._activeSlot = null;
        } else {
          const slots = CustomizeView._slotsIn(CustomizeView._activeSection);
          CustomizeView._activeSlot = slots.length ? slots[0].key : null;
        }
        CustomizeView._renderTabs();
        CustomizeView._renderSlotPills();
        CustomizeView._renderOptions();
      });
    });
  },

  // Slots of the active section. Slots whose output is fully hidden by another
  // choice are dimmed with a "· hidden by …" hint (still selectable).
  _renderSlotPills() {
    const host = document.getElementById('cz-slot-pills');
    if (!host) return;
    // The Presets tab has no slots — hide the pill row entirely.
    if (CustomizeView._activeSection === 'Presets') {
      host.innerHTML = '';
      host.style.display = 'none';
      return;
    }
    host.style.display = '';
    const hidden = (typeof Playground !== 'undefined' && Playground.characterHidden)
      ? Playground.characterHidden(CustomizeView._current) : {};
    const slots = CustomizeView._slotsIn(CustomizeView._activeSection);
    host.innerHTML = slots.map(e => {
      const reason = hidden[e.key];
      return `<button type="button" class="cz-slot-pill${e.key === CustomizeView._activeSlot ? ' active' : ''}${reason ? ' cz-pill-hidden' : ''}" data-slot="${e.key}">${e.label}${reason ? ` <span class="cz-hint">· ${reason}</span>` : ''}</button>`;
    }).join('');
    host.querySelectorAll('.cz-slot-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        CustomizeView._activeSlot = btn.dataset.slot;
        CustomizeView._renderSlotPills();
        CustomizeView._renderOptions();
      });
    });
  },

  // The active slot's options: colour dots for swatch/accent, mini-avatar tiles
  // for label (shape/style) slots.
  _renderOptions() {
    const host = document.getElementById('cz-options');
    if (!host) return;
    // Bump the thumbnail generation so any in-flight 3D-thumbnail run from a
    // previously open slot abandons itself instead of writing into stale tiles.
    CustomizeView._thumbGen = (CustomizeView._thumbGen || 0) + 1;
    // The Presets tab shows the full-look buttons instead of a slot editor.
    if (CustomizeView._activeSection === 'Presets') { CustomizeView._renderPresetPanel(); return; }
    const e = (CHARACTER_SCHEMA || []).find(x => x.key === CustomizeView._activeSlot);
    if (!e) { host.innerHTML = ''; return; }
    const hidden = (typeof Playground !== 'undefined' && Playground.characterHidden)
      ? Playground.characterHidden(CustomizeView._current) : {};
    const reason = hidden[e.key];
    const isColor = (e.control === 'swatch' || e.control === 'accent');
    host.innerHTML = `
      <div class="cz-option-head">
        <h3>${e.label}</h3>
        ${reason ? `<span class="cz-hint">· hidden by ${reason}</span>` : ''}
      </div>
      <div class="${isColor ? 'pg-swatches' : 'cz-tiles'}${reason ? ' cz-dim' : ''}" data-target="${e.key}"></div>
    `;
    if (e.control === 'swatch') CustomizeView._renderSwatches(e.key, Playground[e.palette] || []);
    else if (e.control === 'accent') CustomizeView._renderAccent(e.key, Playground[e.palette] || []);
    else CustomizeView._renderTiles(e.key, e);
  },

  _renderSwatches(key, palette) {
    const host = document.querySelector(`[data-target="${key}"]`);
    if (!host) return;
    host.innerHTML = palette.map((color, idx) =>
      `<button type="button" class="pg-swatch" data-idx="${idx}" style="background:${color}" aria-label="${key} ${idx + 1}"></button>`
    ).join('');
    CustomizeView._markActive(key);
    host.querySelectorAll('.pg-swatch').forEach(btn => {
      btn.addEventListener('click', () => CustomizeView._choose(key, parseInt(btn.dataset.idx, 10)));
    });
  },

  // Accent swatches — an "Auto" chip at index 0, then palette colors at 1..N.
  _renderAccent(key, palette) {
    const host = document.querySelector(`[data-target="${key}"]`);
    if (!host) return;
    host.innerHTML = `<button type="button" class="pg-swatch cz-auto" data-idx="0" title="Auto (default)" aria-label="${key} auto">A</button>`
      + palette.map((color, idx) =>
        `<button type="button" class="pg-swatch" data-idx="${idx + 1}" style="background:${color}" aria-label="${key} ${idx + 1}"></button>`
      ).join('');
    CustomizeView._markActive(key);
    host.querySelectorAll('.pg-swatch').forEach(btn => {
      btn.addEventListener('click', () => CustomizeView._choose(key, parseInt(btn.dataset.idx, 10)));
    });
  },

  // Mini-avatar preview tiles: each option = the current character with just
  // this one slot swapped, captioned with the option name. Gender-leaning
  // options are surfaced first (still all selectable) when a gender is set.
  //
  // Each tile shows a real 3D thumbnail (so it matches the big rotatable
  // preview) rendered off-screen by Playground3D and filled in a few per frame
  // so the grid paints instantly. Falls back to the 2D SVG sprite when Three.js
  // isn't available.
  _renderTiles(key, entry) {
    const host = document.querySelector(`[data-target="${key}"]`);
    if (!host) return;
    const labels = characterSchemaOptions(entry);
    let order = labels.map((label, idx) => ({ idx, label }));
    const gender = CustomizeView._current ? (CustomizeView._current.gender ?? 0) : 0;
    if (entry.lean && gender > 0) {
      const want = gender === 2 ? 'f' : 'm';
      const rank = (l) => (l === want ? 0 : (l ? 2 : 1));   // current gender · neutral · other
      order = order.slice().sort((a, b) => rank(entry.lean[a.idx]) - rank(entry.lean[b.idx]));
    }

    const use3D = (typeof Playground3D !== 'undefined'
      && typeof Playground3D.renderThumbnail === 'function'
      && typeof window !== 'undefined' && window.THREE);

    host.innerHTML = '';
    const jobs = [];
    order.forEach(({ idx, label }) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'cz-tile';
      tile.dataset.idx = idx;
      let av;
      if (use3D) {
        av = document.createElement('img');
        av.className = 'cz-tile-av';
        av.alt = label;
        av.draggable = false;
        jobs.push({ idx, img: av });
      } else {
        av = Playground.renderCharacter({ ...CustomizeView._current, [key]: idx });
        av.classList.add('cz-tile-av');
      }
      const cap = document.createElement('span');
      cap.className = 'cz-tile-cap';
      cap.textContent = label;
      tile.appendChild(av);
      tile.appendChild(cap);
      tile.addEventListener('click', () => CustomizeView._choose(key, idx));
      host.appendChild(tile);
    });
    CustomizeView._markActive(key);

    if (use3D && jobs.length) {
      const gen = CustomizeView._thumbGen;
      const base = { ...CustomizeView._current };
      let i = 0;
      // A few per tick so the grid paints instantly. setTimeout (not rAF) so the
      // run still completes if the tab is backgrounded mid-render.
      const step = () => {
        if (gen !== CustomizeView._thumbGen) return;   // navigated away — abandon
        const end = Math.min(i + 4, jobs.length);
        for (; i < end; i++) {
          const j = jobs[i];
          try {
            const url = Playground3D.renderThumbnail({ ...base, [key]: j.idx });
            if (url) j.img.src = url;
          } catch (_) { /* skip a bad tile */ }
        }
        if (i < jobs.length) setTimeout(step, 0);
      };
      setTimeout(step, 0);
    }
  },

  _choose(key, idx) {
    CustomizeView._current[key] = idx;
    CustomizeView._markActive(key);
    CustomizeView._updatePreview();
    // The choice may hide/un-hide sibling slots → refresh their pills. Tiles for
    // the active slot each override `key`, so they don't change on their own
    // selection; lean reordering for other slots happens when navigated to.
    CustomizeView._renderSlotPills();
  },

  _markActive(key) {
    const host = document.querySelector(`[data-target="${key}"]`);
    if (!host) return;
    host.querySelectorAll('[data-idx]').forEach(el => {
      el.classList.toggle('active', parseInt(el.dataset.idx, 10) === CustomizeView._current[key]);
    });
  },

  // ── presets (grouped) — rendered into the options area under the Presets tab ──
  // Each preset is a full-look 3D thumbnail tile (same renderer as the per-slot
  // tiles), captioned with the preset name and grouped by category.
  _renderPresetPanel() {
    const host = document.getElementById('cz-options');
    if (!host) return;
    const presets = (typeof Playground !== 'undefined' && Playground.CHARACTER_PRESETS) || [];
    const base = Playground.defaultCharacter();
    // Group in first-seen order.
    const groups = [];
    presets.forEach((p, i) => {
      const g = p.group || 'Presets';
      let bucket = groups.find(x => x.name === g);
      if (!bucket) { bucket = { name: g, items: [] }; groups.push(bucket); }
      bucket.items.push({ p, i });
    });

    const use3D = (typeof Playground3D !== 'undefined'
      && typeof Playground3D.renderThumbnail === 'function'
      && typeof window !== 'undefined' && window.THREE);

    host.innerHTML = `
      <div class="cz-option-head">
        <h3>Presets</h3>
        <span class="cz-hint">· apply a full look, then tweak any tab</span>
      </div>
      <div class="cz-presets-panel">
        ${groups.map((g, gi) => `
          <div class="cz-preset-group">
            <span class="pg-presets-label">${g.name}</span>
            <div class="cz-tiles" data-preset-grid="${gi}"></div>
          </div>
        `).join('')}
      </div>
    `;

    const jobs = [];
    groups.forEach((g, gi) => {
      const grid = host.querySelector(`[data-preset-grid="${gi}"]`);
      if (!grid) return;
      g.items.forEach(({ p }) => {
        const char = { ...base, ...p.char };
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'cz-tile';
        let av;
        if (use3D) {
          av = document.createElement('img');
          av.className = 'cz-tile-av';
          av.alt = p.name;
          av.draggable = false;
          jobs.push({ img: av, char });
        } else {
          av = Playground.renderCharacter(char);
          av.classList.add('cz-tile-av');
        }
        const cap = document.createElement('span');
        cap.className = 'cz-tile-cap';
        cap.textContent = p.name;
        tile.appendChild(av);
        tile.appendChild(cap);
        tile.addEventListener('click', () => {
          CustomizeView._current = { ...base, ...p.char };
          // Flash the chosen preset as active for immediate feedback, then
          // update the big preview. Other tabs reflect the look when opened.
          host.querySelectorAll('.cz-tile.active').forEach(b => b.classList.remove('active'));
          tile.classList.add('active');
          CustomizeView._updatePreview();
        });
        grid.appendChild(tile);
      });
    });

    if (use3D && jobs.length) {
      const gen = CustomizeView._thumbGen;
      let i = 0;
      const step = () => {
        if (gen !== CustomizeView._thumbGen) return;   // navigated away — abandon
        const end = Math.min(i + 4, jobs.length);
        for (; i < end; i++) {
          try {
            const url = Playground3D.renderThumbnail(jobs[i].char);
            if (url) jobs[i].img.src = url;
          } catch (_) { /* skip a bad tile */ }
        }
        if (i < jobs.length) setTimeout(step, 0);
      };
      setTimeout(step, 0);
    }
  },

  // ── toolbar actions ──
  _randomize() {
    (CHARACTER_SCHEMA || []).forEach(e => {
      const n = characterSchemaCount(e);
      if (n > 0) CustomizeView._current[e.key] = Math.floor(Math.random() * n);
    });
    CustomizeView._renderPanel();
    CustomizeView._updatePreview();
  },

  _reset() {
    CustomizeView._current = { ...CustomizeView._initial };
    CustomizeView._renderPanel();
    CustomizeView._updatePreview();
  },

  _updatePreview() {
    const host = document.getElementById('cz-preview');
    if (!host) return;
    if (typeof Playground3D !== 'undefined' && Playground3D.createPreview) {
      if (!CustomizeView._previewHandle) {
        host.innerHTML = '';
        CustomizeView._previewHandle = Playground3D.createPreview(host, CustomizeView._current);
      } else {
        CustomizeView._previewHandle.setCharacter(CustomizeView._current);
      }
      return;
    }
    // 2D fallback.
    host.innerHTML = '';
    const sprite = Playground.renderCharacter(CustomizeView._current);
    sprite.classList.add('pg-builder-sprite');
    host.appendChild(sprite);
  },

  // ── save / leave ──
  async _save() {
    const btn = document.getElementById('cz-save');
    const err = document.getElementById('cz-error');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try {
      const res = await fetch(`${API}/profile/home-character`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Auth.getToken()}`
        },
        body: JSON.stringify(CustomizeView._current)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      CustomizeView._leave();
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
      if (err) { err.hidden = false; err.textContent = e.message; }
    }
  },

  // True if the editing copy differs from the last saved state.
  _isDirty() {
    const a = CustomizeView._current, b = CustomizeView._initial;
    if (!a || !b) return false;
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) { if ((a[k] ?? null) !== (b[k] ?? null)) return true; }
    return false;
  },

  // Back button — warn before discarding unsaved changes.
  async _back() {
    if (CustomizeView._isDirty()) {
      let ok;
      if (typeof confirmDialog === 'function') {
        ok = await confirmDialog({
          title: 'Leave without saving?',
          message: "You've changed your character but haven't saved yet. Your changes will be lost if you leave now.",
          confirmLabel: 'Leave',
          cancelLabel: 'Keep editing',
          danger: true
        });
      } else {
        ok = window.confirm('You have unsaved changes. Leave without saving?');
      }
      if (!ok) return;
    }
    CustomizeView._leave();
  },

  _leave() {
    Router.go(CustomizeView._return || '/home');
  },

  unmount() {
    if (CustomizeView._previewHandle) {
      try { CustomizeView._previewHandle.destroy(); } catch (_) {}
      CustomizeView._previewHandle = null;
    }
    // Release the shared off-screen thumbnail WebGL context.
    if (typeof Playground3D !== 'undefined' && Playground3D.disposeThumbnails) {
      try { Playground3D.disposeThumbnails(); } catch (_) {}
    }
    CustomizeView._overlayRoot = null;
    CustomizeView._current = null;
    CustomizeView._initial = null;
  }
};
