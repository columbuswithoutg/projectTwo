/************************************************
 * ADMIN — CONFIG TAB (Phase 2)
 * Live walker physics tuning. Eight controls + Save/Reset.
 ************************************************/
(function () {
  const esc = AdminView._escapeHtml;

  // Mirror of CONFIG_RULES in routes/admin.js — keep in sync.
  const SLIDERS = [
    { path: 'walker.speed',       label: 'Walker speed (px/s)',     min: 10,    max: 120,    step: 1,    default: 40 },
    { path: 'walker.pauseMin',    label: 'Walker pause min (ms)',   min: 0,     max: 5000,   step: 50,   default: 800 },
    { path: 'walker.pauseMax',    label: 'Walker pause max (ms)',   min: 500,   max: 8000,   step: 50,   default: 2500 },
    { path: 'encounter.dist',     label: 'Encounter distance (px)', min: 10,    max: 80,     step: 1,    default: 26 },
    { path: 'encounter.cooldown', label: 'Encounter cooldown (ms)', min: 5000,  max: 120000, step: 1000, default: 30000 },
    { path: 'fight.spawnChance',  label: 'Fight spawn chance',      min: 0,     max: 1,      step: 0.05, default: 0.15 }
  ];

  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }
  function setPath(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      cur[parts[i]] = cur[parts[i]] || {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  // Render a value the way humans think about it (cooldown ms -> "30s",
  // spawn chance -> "15%"). Sliders still send raw numbers to the API.
  function formatValue(path, v) {
    if (v == null || isNaN(v)) return '—';
    if (path === 'encounter.cooldown') return Math.round(v / 1000) + 's';
    if (path === 'fight.spawnChance') return Math.round(v * 100) + '%';
    return String(v);
  }

  const Config = {
    _state: { current: null, original: null, dirty: false },

    mount(container) {
      container.innerHTML = `
        <div class="admin-config">
          <div id="admin-config-body">Loading…</div>
        </div>
      `;
      Config.fetch();
    },

    async fetch() {
      const body = document.getElementById('admin-config-body');
      try {
        const cfg = await AdminView.api('/config');
        Config._state.current = JSON.parse(JSON.stringify(cfg));
        Config._state.original = JSON.parse(JSON.stringify(cfg));
        Config._state.dirty = false;
        Config.render();
      } catch (e) {
        body.innerHTML = `<div class="admin-error">${esc(e.message)}</div>`;
      }
    },

    render() {
      const body = document.getElementById('admin-config-body');
      const cfg = Config._state.current;
      const updatedAt = cfg.updatedAt ? AdminView.formatDate(cfg.updatedAt) : 'never';
      const updatedBy = cfg.updatedBy || '—';
      const version = cfg.version || 0;

      body.innerHTML = `
        <p class="admin-config-meta">Last changed by <b>${esc(updatedBy)}</b> at ${esc(updatedAt)} · version ${esc(version)}</p>

        <h3 class="admin-h3">Walker physics</h3>
        <div class="admin-config-grid">
          ${SLIDERS.map(s => {
            const v = getPath(cfg, s.path);
            return `
              <label class="admin-config-row" data-path="${esc(s.path)}">
                <span class="admin-config-label">${esc(s.label)}</span>
                <input type="range"
                  min="${s.min}" max="${s.max}" step="${s.step}"
                  value="${v != null ? v : s.default}"
                  data-path="${esc(s.path)}" />
                <span class="admin-config-val" data-val="${esc(s.path)}">${esc(formatValue(s.path, v))}</span>
              </label>
            `;
          }).join('')}
        </div>

        <h3 class="admin-h3">Default toggles for new users</h3>
        <p class="admin-config-help">Only applies to users who have never personally toggled the setting on /map. Existing user choices are preserved.</p>
        <div class="admin-config-grid">
          <label class="admin-config-row admin-config-toggle">
            <span class="admin-config-label">Fights enabled (default)</span>
            <input type="checkbox" data-path="flags.fightsEnabled" ${cfg.flags?.fightsEnabled ? 'checked' : ''} />
          </label>
          <label class="admin-config-row admin-config-toggle">
            <span class="admin-config-label">Dialogues enabled (default)</span>
            <input type="checkbox" data-path="flags.dialoguesEnabled" ${cfg.flags?.dialoguesEnabled ? 'checked' : ''} />
          </label>
        </div>

        <div class="admin-config-actions">
          <button class="admin-btn" id="admin-config-save" disabled>Save changes</button>
          <button class="admin-btn admin-btn-danger" id="admin-config-reset">Reset to defaults…</button>
        </div>
      `;

      body.querySelectorAll('input[type="range"]').forEach(input => {
        input.addEventListener('input', (e) => {
          const path = e.target.dataset.path;
          const value = parseFloat(e.target.value);
          setPath(Config._state.current, path, value);
          const valEl = body.querySelector(`[data-val="${path}"]`);
          if (valEl) valEl.textContent = formatValue(path, value);
          Config._markDirty();
        });
      });

      body.querySelectorAll('input[type="checkbox"]').forEach(input => {
        input.addEventListener('change', (e) => {
          const path = e.target.dataset.path;
          setPath(Config._state.current, path, !!e.target.checked);
          Config._markDirty();
        });
      });

      document.getElementById('admin-config-save').addEventListener('click', Config.save);
      document.getElementById('admin-config-reset').addEventListener('click', Config.reset);
    },

    _markDirty() {
      Config._state.dirty = true;
      const btn = document.getElementById('admin-config-save');
      if (btn) btn.disabled = false;
    },

    async save() {
      const cfg = Config._state.current;
      // Send only the editable subset — never echo updatedAt/version/etc.
      const payload = {
        walker:    cfg.walker,
        encounter: cfg.encounter,
        fight:     cfg.fight,
        flags:     cfg.flags
      };
      try {
        const updated = await AdminView.api('/config', {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        Config._state.current = JSON.parse(JSON.stringify(updated));
        Config._state.original = JSON.parse(JSON.stringify(updated));
        Config._state.dirty = false;
        Config.render();
        AdminView.toast('Saved. Refresh /map to see walker changes.', 'success');
      } catch (e) {
        // Server-side validation errors come back as {error, fields}
        AdminView.toast(e.message, 'error');
      }
    },

    async reset() {
      const ok = await confirmDialog({
        title: 'Reset to factory defaults?',
        message: 'All eight values will be reset. This is logged in the audit trail.',
        confirmLabel: 'Reset'
      });
      if (!ok) return;
      try {
        const updated = await AdminView.api('/config/reset', { method: 'POST' });
        Config._state.current = JSON.parse(JSON.stringify(updated));
        Config._state.original = JSON.parse(JSON.stringify(updated));
        Config._state.dirty = false;
        Config.render();
        AdminView.toast('Reset to defaults', 'success');
      } catch (e) {
        AdminView.toast(e.message, 'error');
      }
    },

    unmount() {}
  };

  AdminView._tabs.config = Config;
})();
