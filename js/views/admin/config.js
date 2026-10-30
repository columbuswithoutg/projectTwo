/************************************************
 * ADMIN — WORLD SETTINGS + MINIGAME SETTINGS (AdminConfig)
 *
 * One AdminConfig document (GET/PUT /api/admin/config), shown as sections:
 *   World settings (sidebar): physics   — walker/encounter/fight sliders + world limits
 *                             defaults  — default toggles for new users
 *                             npcs      — /world hero body types
 *                             event     — the Infinity Stone world event
 *   Minigames (top card of each game's page, AdminView._minigamePane):
 *                             scene     — Scene Guess switch + seconds per round
 *                             quote     — Quote Guess switch, suggestions switch, seconds per round
 * Every section saves the whole editable document, so nothing it doesn't
 * show is lost.
 ************************************************/
(function () {
  const esc = AdminView._escapeHtml;

  // Mirror of CONFIG_RULES in routes/admin.js — keep in sync.
  const SLIDERS = [
    { path: 'walker.speed',       label: 'Walker speed (px/s)',     min: 10,    max: 120,    step: 1,    default: 40,    section: 'physics' },
    { path: 'walker.pauseMin',    label: 'Walker pause min (ms)',   min: 0,     max: 5000,   step: 50,   default: 800,   section: 'physics' },
    { path: 'walker.pauseMax',    label: 'Walker pause max (ms)',   min: 500,   max: 8000,   step: 50,   default: 2500,  section: 'physics' },
    { path: 'encounter.dist',     label: 'Encounter distance (px)', min: 10,    max: 80,     step: 1,    default: 26,    section: 'physics' },
    { path: 'encounter.cooldown', label: 'Encounter cooldown (ms)', min: 5000,  max: 120000, step: 1000, default: 30000, section: 'physics' },
    { path: 'fight.spawnChance',  label: 'Fight spawn chance',      min: 0,     max: 1,      step: 0.05, default: 0.15,  section: 'physics' },
    { path: 'world.maxProps',     label: 'Props per house (/world)', min: 1,    max: 60,     step: 1,    default: 40,    section: 'limits' },
    { path: 'world.homeMaxProps', label: 'Props per room (/home)',  min: 1,     max: 60,     step: 1,    default: 40,    section: 'limits' },
    { path: 'world.sceneRoundSec', label: 'Seconds per round',      min: 15,    max: 60,     step: 1,    default: 30,    section: 'scene' },
    { path: 'world.quoteRoundSec', label: 'Seconds per round',      min: 10,    max: 30,     step: 1,    default: 20,    section: 'quote' }
  ];

  const TOGGLES = [
    { path: 'flags.fightsEnabled',           label: 'Fights enabled (default)',            section: 'defaults' },
    { path: 'flags.dialoguesEnabled',        label: 'Dialogues enabled (default)',         section: 'defaults' },
    { path: 'flags.worldEventStonesEnabled', label: 'Infinity Stone hunt + snap enabled',  section: 'event' },
    { path: 'flags.sceneGuessEnabled',       label: 'Scene Guess is on for players',       section: 'scene' },
    { path: 'flags.quoteGuessEnabled',       label: 'Quote Guess is on for players',       section: 'quote' },
    { path: 'flags.quoteSuggestEnabled',     label: 'Players can suggest quotes',          section: 'quote' }
  ];

  const HELP = {
    physics: 'Walker movement, encounters and fights on /map, plus how many props a house or room may hold. Players pick up walker changes on their next /map load.',
    defaults: 'Only applies to users who have never personally toggled the setting on /map. Existing user choices are preserved.',
    npcs: 'Pick the body each hero uses in /world. Global — every player sees the same heroes. Players see the change on their next /world entry (page load).',
    event: 'Global switch — applies to every player. When on, the /world Infinity Stone hunt and snap are live; when off, the server refuses stone grabs/snaps and the HUD is hidden. Players see the change on their next /world entry (page load).',
    scene: 'Master switch, off by default. While off, players see no trace of Scene Guess and any running game ends. When on, only islands you switch on below (each needs 10 stills) show the game. Takes effect on save.',
    quote: 'Master switch, off by default. While off, players see no trace of Quote Guess. When on, only islands you switch on below (each needs 10 lines from 4+ speakers) show the game. Suggestions go to People → Quote suggestions and only work while Quote Guess itself is on.'
  };

  // Mirror of Playground.BODY_TYPES (index = stored value). Replaced by the
  // server's copy once GET /api/config/npcs answers.
  let NPC_BODY_TYPES = ['Realistic', 'Box'];
  // { npcs: [{ id, name }], bodyTypes } from GET /api/config/npcs — the
  // server builds it from the same sources, so /admin no longer has to load
  // the world chunk for them (js/boot.js).
  let npcMeta = null;

  // The /world heroes: ids from WorldNpcLogic.NPC_IDS ('npc_' + preset id),
  // display names from the matching Playground.CHARACTER_PRESETS entry.
  // Served list first; the globals are the fallback when that fetch failed
  // but the world chunk happens to be loaded (an earlier /world visit).
  function npcList() {
    if (npcMeta && Array.isArray(npcMeta.npcs)) return npcMeta.npcs;
    const ids = (typeof WorldNpcLogic !== 'undefined' && WorldNpcLogic.NPC_IDS) || [];
    const presets = (typeof Playground !== 'undefined' && Playground.CHARACTER_PRESETS) || [];
    return ids.map(id => {
      const p = presets.find(x => 'npc_' + x.id === id);
      return { id, name: p ? p.name : id.replace(/^npc_/, '') };
    });
  }

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
    if (path === 'world.sceneRoundSec' || path === 'world.quoteRoundSec') return v + 's';
    return String(v);
  }

  const Config = {
    _state: { current: null, original: null, dirty: false },
    _host: null,
    _section: 'physics',
    _ctx: null,
    _seq: 0,

    mount(container, section, ctx) {
      Config._section = section;
      Config._ctx = ctx || {};
      Config._state = { current: null, original: null, dirty: false };
      const mini = section === 'scene' || section === 'quote';
      container.innerHTML = `
        <div class="admin-config${mini ? ' admin-config-mini' : ''}">
          <div class="admin-config-body">Loading…</div>
        </div>
      `;
      Config._host = container.querySelector('.admin-config-body');
      Config.fetch();
    },

    async fetch() {
      const seq = ++Config._seq;
      const body = Config._host;
      // NPC names in parallel with the config; a failure just leaves the
      // fallback in npcList().
      const meta = npcMeta || Config._section !== 'npcs' ? null : fetch(`${API}/config/npcs`)
        .then(r => (r.ok ? r.json() : null))
        .then(m => {
          if (!m || !Array.isArray(m.npcs)) return;
          npcMeta = m;
          if (Array.isArray(m.bodyTypes) && m.bodyTypes.length) NPC_BODY_TYPES = m.bodyTypes;
        })
        .catch(() => {});
      try {
        const cfg = await AdminView.api('/config');
        await meta;
        if (seq !== Config._seq || !body.isConnected) return;
        Config._state.current = JSON.parse(JSON.stringify(cfg));
        Config._state.original = JSON.parse(JSON.stringify(cfg));
        Config._state.dirty = false;
        Config.render();
      } catch (e) {
        if (body.isConnected) body.innerHTML = `<div class="admin-error">${esc(e.message)}</div>`;
      }
    },

    _sliders(section) {
      const cfg = Config._state.current;
      return `
        <div class="admin-config-grid">
          ${SLIDERS.filter(s => s.section === section).map(s => {
            const v = getPath(cfg, s.path);
            return `
              <label class="admin-config-row" data-path="${esc(s.path)}">
                <span class="admin-config-label">${esc(s.label)}</span>
                <input type="range"
                  min="${s.min}" max="${s.max}" step="${s.step}"
                  value="${v != null ? v : s.default}"
                  data-path="${esc(s.path)}" />
                <span class="admin-config-val" data-val="${esc(s.path)}">${esc(formatValue(s.path, v != null ? v : s.default))}</span>
              </label>
            `;
          }).join('')}
        </div>`;
    },

    _toggles(section) {
      const cfg = Config._state.current;
      return `
        <div class="admin-config-grid">
          ${TOGGLES.filter(t => t.section === section).map(t => `
            <label class="admin-config-row admin-config-toggle">
              <span class="admin-config-label">${esc(t.label)}</span>
              <input type="checkbox" data-path="${esc(t.path)}" ${getPath(cfg, t.path) ? 'checked' : ''} />
            </label>`).join('')}
        </div>`;
    },

    _npcs() {
      const cfg = Config._state.current;
      return `
        <div class="admin-config-bulk">
          <span class="admin-config-label">Set all:</span>
          ${NPC_BODY_TYPES.map((name, i) => `<button type="button" class="admin-btn" data-npc-all="${i}">${esc(name)}</button>`).join('')}
        </div>
        <div class="admin-config-grid">
          ${npcList().map(n => {
            const cur = (cfg.world?.npcBodyTypes || {})[n.id] === 1 ? 1 : 0;
            return `
              <label class="admin-config-row admin-config-toggle">
                <span class="admin-config-label">${esc(n.name)}</span>
                <select class="admin-input" data-path="world.npcBodyTypes.${esc(n.id)}">
                  ${NPC_BODY_TYPES.map((name, i) => `<option value="${i}" ${cur === i ? 'selected' : ''}>${esc(name)}</option>`).join('')}
                </select>
              </label>
            `;
          }).join('')}
        </div>`;
    },

    render() {
      const body = Config._host;
      if (!body || !body.isConnected) return;
      const cfg = Config._state.current;
      const sec = Config._section;
      const updatedAt = cfg.updatedAt ? AdminView.formatDate(cfg.updatedAt) : 'never';
      const updatedBy = cfg.updatedBy || '—';
      const version = cfg.version || 0;
      const meta = `<p class="admin-config-meta">Last changed by <b>${esc(updatedBy)}</b> at ${esc(updatedAt)} · version ${esc(version)}</p>`;

      let inner;
      if (sec === 'physics') {
        inner = `<p class="admin-config-help">${esc(HELP.physics)}</p>
          <h3 class="admin-h3">Walker physics</h3>${Config._sliders('physics')}
          <h3 class="admin-h3">World limits</h3>${Config._sliders('limits')}`;
      } else if (sec === 'defaults') {
        inner = `<h3 class="admin-h3">Default toggles for new users</h3>
          <p class="admin-config-help">${esc(HELP.defaults)}</p>${Config._toggles('defaults')}`;
      } else if (sec === 'npcs') {
        inner = `<h3 class="admin-h3">World NPCs — body type</h3>
          <p class="admin-config-help">${esc(HELP.npcs)}</p>${Config._npcs()}`;
      } else if (sec === 'event') {
        inner = `<h3 class="admin-h3">World event</h3>
          <p class="admin-config-help">${esc(HELP.event)}</p>${Config._toggles('event')}`;
      } else {
        // Minigame card: the game's switch(es) + round time, compact.
        inner = `<div class="admin-mg-head"><h3 class="admin-h3">Game settings</h3></div>
          <p class="admin-config-help">${esc(HELP[sec] || '')}</p>
          ${Config._toggles(sec)}${Config._sliders(sec)}`;
      }
      const mini = sec === 'scene' || sec === 'quote';
      body.innerHTML = `
        ${mini ? '' : meta}
        ${inner}
        <div class="admin-config-actions">
          <button class="admin-btn admin-btn-primary" data-cfg="save" disabled>Save changes</button>
          ${mini ? '' : '<button class="admin-btn admin-btn-danger" data-cfg="reset">Reset all settings to defaults…</button>'}
          ${mini ? meta : ''}
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

      body.querySelectorAll('select[data-path]').forEach(sel => {
        sel.addEventListener('change', (e) => {
          setPath(Config._state.current, e.target.dataset.path, parseInt(e.target.value, 10));
          Config._markDirty();
        });
      });
      body.querySelectorAll('[data-npc-all]').forEach(btn => {
        btn.addEventListener('click', () => {
          const v = parseInt(btn.dataset.npcAll, 10);
          body.querySelectorAll('select[data-path^="world.npcBodyTypes."]').forEach(sel => {
            sel.value = String(v);
            setPath(Config._state.current, sel.dataset.path, v);
          });
          Config._markDirty();
        });
      });

      body.querySelector('[data-cfg="save"]').addEventListener('click', () => Config.save());
      const reset = body.querySelector('[data-cfg="reset"]');
      if (reset) reset.addEventListener('click', Config.reset);
    },

    // Guards (index.js): a control moved away from the loaded/saved value.
    // Compared, not just flagged, so a slider dragged back reads as clean.
    isDirty() {
      const s = Config._state;
      return !!(s.dirty && s.current && s.original &&
                JSON.stringify(s.current) !== JSON.stringify(s.original));
    },
    discard() {
      const s = Config._state;
      if (s.original) s.current = JSON.parse(JSON.stringify(s.original));
      s.dirty = false;
    },

    _markDirty() {
      Config._state.dirty = true;
      const btn = Config._host && Config._host.querySelector('[data-cfg="save"]');
      if (btn) btn.disabled = !Config.isDirty();
    },

    async save() {
      const cfg = Config._state.current;
      if (!cfg) return;
      const before = JSON.stringify((Config._state.original || {}).flags || {});
      // Send only the editable subset — never echo updatedAt/version/etc.
      const payload = {
        walker:    cfg.walker,
        encounter: cfg.encounter,
        fight:     cfg.fight,
        flags:     cfg.flags,
        world:     {
          npcBodyTypes: { ...(cfg.world?.npcBodyTypes || {}) },
          maxProps: Number.isFinite(cfg.world?.maxProps) ? cfg.world.maxProps : 40,
          homeMaxProps: Number.isFinite(cfg.world?.homeMaxProps) ? cfg.world.homeMaxProps : 40,
          sceneRoundSec: Number.isFinite(cfg.world?.sceneRoundSec) ? cfg.world.sceneRoundSec : 30,
          quoteRoundSec: Number.isFinite(cfg.world?.quoteRoundSec) ? cfg.world.quoteRoundSec : 20
        }
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
        const sec = Config._section;
        AdminView.toast(sec === 'physics' ? 'Saved. Refresh /map to see walker changes.' : 'Saved', 'success');
        const flagsChanged = JSON.stringify(updated.flags || {}) !== before;
        if (flagsChanged && Config._ctx && Config._ctx.onSaved) Config._ctx.onSaved();
      } catch (e) {
        // Server-side validation errors come back as
        // { error: 'Validation failed', fields: { 'walker.speed': 'must be …' } }
        // (PUT /config in routes/admin.js) — name each control, not just
        // "Validation failed".
        AdminView.toast(Config._errorText(e), 'error');
      }
    },

    _errorText(e) {
      const fields = e && e.body && e.body.fields;
      if (!fields || typeof fields !== 'object') return e.message;
      const labelOf = (path) => {
        const s = SLIDERS.find(x => x.path === path);
        if (s) return s.section === 'scene' ? 'Scene Guess seconds per round'
          : s.section === 'quote' ? 'Quote Guess seconds per round' : s.label;
        const t = TOGGLES.find(x => x.path === path);
        if (t) return t.label;
        const npc = npcList().find(n => path === 'world.npcBodyTypes.' + n.id);
        return npc ? npc.name + ' body type' : path;
      };
      const parts = Object.entries(fields).map(([path, msg]) => `${labelOf(path)}: ${msg}`);
      return parts.length ? `${e.message} — ${parts.join('; ')}` : e.message;
    },

    async reset() {
      const ok = await confirmDialog({
        title: 'Reset every setting to factory defaults?',
        message: 'Physics, limits, default toggles, NPC bodies, the world event and both minigames’ switches and round times all go back to their defaults. This is logged in the audit trail.',
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

    unmount() {
      Config._seq++;
      Config._host = null;
    }
  };

  // One pane per section, all sharing the Config state above (only one is
  // ever mounted at a time).
  const sections = {};
  AdminView._configSection = function configSection(name) {
    if (!sections[name]) {
      sections[name] = {
        mount: (host, ctx) => Config.mount(host, name, ctx),
        unmount: () => Config.unmount(),
        isDirty: () => Config._section === name && Config.isDirty(),
        discard: () => Config.discard(),
        save: () => Config.save()
      };
    }
    return sections[name];
  };
  for (const name of ['physics', 'defaults', 'npcs', 'event']) {
    AdminView._tabs[name] = AdminView._configSection(name);
  }
})();
