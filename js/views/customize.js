/************************************************
 * CHARACTER CUSTOMIZER — /customize
 *
 * Full-page replacement for the old builder modal. A big rotatable 3D preview
 * (Playground3D.createPreview, with a 2D fallback) beside categorized option
 * sections generated from CHARACTER_SCHEMA. Randomize / Reset / Save in the
 * toolbar; Save PUTs to /api/profile/home-character then navigates back to the
 * route the user came from (default /home), which re-fetches and re-renders
 * the character.
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
            <div class="pg-presets" id="cz-presets"></div>
            <div class="cz-tools">
              <button class="pg-btn" type="button" id="cz-random">🎲 Randomize</button>
              <button class="pg-btn" type="button" id="cz-reset">↺ Reset</button>
            </div>
          </div>
          <div class="cz-sections" id="cz-sections"></div>
          <p class="pg-builder-error" id="cz-error" hidden></p>
        </div>
      </div>
    `;

    document.getElementById('cz-back').addEventListener('click', () => CustomizeView._leave());
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
    CustomizeView._renderSections();
    CustomizeView._renderPresets();
    CustomizeView._updatePreview();
  },

  // ── option controls ──
  _renderSections() {
    const host = document.getElementById('cz-sections');
    if (!host) return;
    const order = (typeof CHARACTER_SECTION_ORDER !== 'undefined') ? CHARACTER_SECTION_ORDER : [];
    const sections = [];
    (CHARACTER_SCHEMA || []).forEach(e => {
      if (!sections.includes(e.section)) sections.push(e.section);
    });
    // Order: declared order first, then any extras in first-seen order.
    sections.sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

    host.innerHTML = sections.map(sec => {
      const fields = CHARACTER_SCHEMA.filter(e => e.section === sec);
      const groups = fields.map(e => `
        <fieldset class="pg-builder-group" data-key="${e.key}">
          <legend>${e.label}</legend>
          <div class="${(e.control === 'swatch' || e.control === 'accent') ? 'pg-swatches' : 'pg-styles'}" data-target="${e.key}"></div>
        </fieldset>
      `).join('');
      return `
        <section class="cz-section">
          <h3 class="cz-section-title">${sec}</h3>
          ${groups}
        </section>
      `;
    }).join('');

    CHARACTER_SCHEMA.forEach(e => {
      if (e.control === 'swatch') CustomizeView._renderSwatches(e.key, Playground[e.palette] || []);
      else if (e.control === 'accent') CustomizeView._renderAccent(e.key, Playground[e.palette] || []);
      else CustomizeView._renderLabels(e.key, characterSchemaOptions(e), e.lean);
    });
    CustomizeView._applyHidden();
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

  _renderLabels(key, labels, lean) {
    const host = document.querySelector(`[data-target="${key}"]`);
    if (!host) return;
    // Surface gender-leaning options first (still all selectable) when a lean
    // map is defined and a gender is selected. Stable sort preserves order.
    let order = labels.map((label, idx) => ({ idx, label }));
    const gender = CustomizeView._current ? (CustomizeView._current.gender ?? 0) : 0;
    if (lean && gender > 0) {
      const want = gender === 2 ? 'f' : 'm';
      const rank = (l) => (l === want ? 0 : (l ? 2 : 1));   // current gender · neutral · other
      order = order.slice().sort((a, b) => rank(lean[a.idx]) - rank(lean[b.idx]));
    }
    host.innerHTML = order.map(({ idx, label }) =>
      `<button type="button" class="pg-style" data-idx="${idx}">${label}</button>`
    ).join('');
    CustomizeView._markActive(key);
    host.querySelectorAll('.pg-style').forEach(btn => {
      btn.addEventListener('click', () => CustomizeView._choose(key, parseInt(btn.dataset.idx, 10)));
    });
  },

  _choose(key, idx) {
    CustomizeView._current[key] = idx;
    CustomizeView._markActive(key);
    // Changing gender re-orders the leaning style lists.
    if (key === 'gender') {
      (CHARACTER_SCHEMA || []).forEach(e => {
        if (e.control === 'label' && e.lean) CustomizeView._renderLabels(e.key, characterSchemaOptions(e), e.lean);
      });
    }
    CustomizeView._applyHidden();
    CustomizeView._updatePreview();
  },

  // Grey out + disable slots whose output is fully hidden by the current
  // choice, with a "hidden by …" hint. Values are preserved.
  _applyHidden() {
    const hidden = (typeof Playground !== 'undefined' && Playground.characterHidden)
      ? Playground.characterHidden(CustomizeView._current) : {};
    (CHARACTER_SCHEMA || []).forEach(e => {
      const host = document.querySelector(`[data-target="${e.key}"]`);
      const fs = host && host.closest('.pg-builder-group');
      if (!fs) return;
      const reason = hidden[e.key];
      fs.classList.toggle('cz-hidden', !!reason);
      const legend = fs.querySelector('legend');
      if (legend) {
        if (!legend.dataset.base) legend.dataset.base = legend.textContent;
        legend.innerHTML = reason
          ? `${legend.dataset.base} <span class="cz-hint">· hidden by ${reason}</span>`
          : legend.dataset.base;
      }
    });
  },

  _markActive(key) {
    const host = document.querySelector(`[data-target="${key}"]`);
    if (!host) return;
    host.querySelectorAll('[data-idx]').forEach(el => {
      el.classList.toggle('active', parseInt(el.dataset.idx, 10) === CustomizeView._current[key]);
    });
  },

  _markAll() {
    (CHARACTER_SCHEMA || []).forEach(e => CustomizeView._markActive(e.key));
  },

  // ── presets (grouped) ──
  _renderPresets() {
    const host = document.getElementById('cz-presets');
    if (!host) return;
    const presets = (typeof Playground !== 'undefined' && Playground.CHARACTER_PRESETS) || [];
    if (!presets.length) { host.style.display = 'none'; return; }
    const base = Playground.defaultCharacter();
    // Group in first-seen order.
    const groups = [];
    presets.forEach((p, i) => {
      const g = p.group || 'Presets';
      let bucket = groups.find(x => x.name === g);
      if (!bucket) { bucket = { name: g, items: [] }; groups.push(bucket); }
      bucket.items.push({ p, i });
    });
    host.innerHTML = groups.map(g => `
      <div class="cz-preset-group">
        <span class="pg-presets-label">${g.name}</span>
        ${g.items.map(({ p, i }) => `<button type="button" class="pg-preset" data-preset="${i}">${p.name}</button>`).join('')}
      </div>
    `).join('');
    host.querySelectorAll('.pg-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = presets[parseInt(btn.dataset.preset, 10)];
        if (!p) return;
        CustomizeView._current = { ...base, ...p.char };
        CustomizeView._renderSections();
        CustomizeView._updatePreview();
      });
    });
  },

  // ── toolbar actions ──
  _randomize() {
    (CHARACTER_SCHEMA || []).forEach(e => {
      const n = characterSchemaCount(e);
      if (n > 0) CustomizeView._current[e.key] = Math.floor(Math.random() * n);
    });
    CustomizeView._renderSections();
    CustomizeView._updatePreview();
  },

  _reset() {
    CustomizeView._current = { ...CustomizeView._initial };
    CustomizeView._renderSections();
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

  _leave() {
    Router.go(CustomizeView._return || '/home');
  },

  unmount() {
    if (CustomizeView._previewHandle) {
      try { CustomizeView._previewHandle.destroy(); } catch (_) {}
      CustomizeView._previewHandle = null;
    }
    CustomizeView._overlayRoot = null;
    CustomizeView._current = null;
    CustomizeView._initial = null;
  }
};
