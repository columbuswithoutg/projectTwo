/************************************************
 * WORLD VIEW — /world
 *
 * Walkable 3D recreation of the universe map. Player IS the walker.
 * Only WATCHED projects are rendered — the world is a record of where you've
 * been, so an unwatched island never appears. A brand-new account with nothing
 * watched gets the start node (Iron Man) alone as its entry point.
 *
 * Multiplayer: delegates socket lifecycle, chat, emotes, and position
 * broadcast to the shared Multiplayer module (js/home-socket.js).
 * /world is one global room; /home and /friend/:user/home use the same
 * module with the home:* event names.
 ************************************************/
const WorldView = (() => {

  let _stage = null;
  let _mp = null;
  // Monotonic mount token. Bumped on every mount() and unmount(); the async
  // bring-up captures its value and bails after each await if it no longer
  // matches, so navigating away mid-fetch can't init the engine / open a
  // socket / wire a global keydown handler against a torn-down view.
  let _mountSeq = 0;
  let _loadTimer = null;
  let _voice = null;
  let _voiceBtn = null;
  let _voiceBtnHandler = null;
  let _voiceCtxHandler = null;
  let _voiceTouchStart = null;
  let _voiceTouchEnd = null;
  let _voiceLongPressTimer = null;
  let _voiceLongPressFired = false;
  let _peerFailToastAt = 0;        // throttle the "voice trouble" hint toast
  let _voiceState = 'off';         // last _voiceVisual state, re-painted when the island changes
  let _voiceMsg = '';
  // Keeper-editable houses. `_zone` mirrors the server's world:zone (the
  // island we stand on); keepers/me come from GET /api/world/houses.
  let _zone = null;
  let _houseMe = null;
  let _houseKeepers = {};
  let _houseMine = {};             // projectId → my own stay ms (for "time to take over")
  let _housesAt = 0;
  let _housePoll = null;           // 30 s refresh so keeper tags / take-over times stay current
  const HOUSE_POLL_MS = 30000;
  // Live estimate of my own stay on the island I'm standing on, so the tags
  // tick up between polls. Mirrors the server's AFK rule
  // (js/world-stay-logic.js): time counts while I've acted within the last
  // minute. The next poll re-baselines it; shownMs keeps it from ticking back.
  const STAY_AFK_MS = 60000;
  let _liveStay = null;            // { projectId, extraMs, lastActiveAt, creditedUpTo, shownMs }
  let _liveTick = null;
  let _liveLabel = '';
  let _lastInputAt = 0;
  let _liveInputHandler = null;
  let _houseBtnHandler = null;
  let _houseEditorClose = null;    // close fn of the open editor overlay, if any
  let _houseEditing = null;        // projectId whose editor is open (its preview survives the poll)
  // Daily Infinity Stone hunt state.
  let _snapKeyHandler = null;      // 'G' → snap when holding all six
  // Pending spawn-picker resolver, so unmount() can settle the awaited promise
  // (resolve null → the bring-up's post-await _mountSeq guard bails cleanly)
  // if the user navigates away while the picker is open. Null when none open.
  let _spawnPickerResolve = null;

  function mount(container) {
    if (!Auth.isLoggedIn()) {
      Router.go('/login');
      return;
    }

    container.innerHTML = `
      <header class="world-header">
        <button id="world-back" type="button" title="Back">← Back</button>
        <h1 class="world-title">World</h1>
        <div class="world-header-spacer">
          <span class="world-house-keeper" id="world-house-keeper" hidden></span>
          <button class="world-house-btn" id="world-house-btn" type="button" hidden
                  title="You keep this house — decorate it">Edit house</button>
          <button class="world-snap-btn" id="world-snap-btn" type="button" hidden
                  title="Snap! (G)">✊ SNAP</button>
          <button class="world-stone-chip" id="world-stone-chip" type="button" hidden
                  title="Infinity Stones you hold — tap for the snap leaderboard">💎 0/6</button>
        </div>
      </header>
      <div id="pg-stage" class="pg-stage">
        <div class="world-loading" id="world-loading">
          <div class="world-loading-spinner" aria-hidden="true"></div>
          <div class="world-loading-text">Entering the world…</div>
        </div>
      </div>
      <div class="world-chat-row" data-channel="world">
        <div class="world-chat-tabs" role="tablist" aria-label="Chat channel">
          <button class="world-chat-tab active" type="button" role="tab" aria-selected="true" data-channel="world" title="Everyone in the world">World</button>
          <button class="world-chat-tab off-island" type="button" role="tab" aria-selected="false" data-channel="project" title="Not on a project island"><span id="world-chat-project-label">Project</span></button>
          <button class="world-chat-tab" type="button" role="tab" aria-selected="false" data-channel="whisper" title="Private message to one player">Whisper</button>
        </div>
        <div class="world-chat-log" id="world-chat-log" aria-live="polite"></div>
        <div class="world-chat-cooldown" id="world-chat-cooldown" hidden></div>
        <div class="world-chat-inputrow">
          <select class="world-whisper-to" id="world-whisper-to" aria-label="Whisper to"><option value="">Whisper to…</option></select>
          <div class="world-chat-field">
            <input class="pg3d-chat" id="world-chat-input" placeholder="Say something to everyone…" maxlength="200" autocomplete="off" enterkeyhint="send" />
            <button class="world-chat-clear" id="world-chat-clear" type="button" aria-label="Clear message">✕</button>
          </div>
          <button class="world-chat-send" id="world-chat-send" type="button" aria-label="Send message" title="Send (Enter)">➤</button>
          <button class="pg3d-emote" id="world-emote-btn" type="button" aria-label="Wave">👋</button>
          <button class="pg3d-voice" id="world-voice-btn" type="button" aria-label="Toggle voice chat" aria-pressed="false" title="Voice chat (off)">🎙️</button>
        </div>
      </div>
    `;
    document.getElementById('world-back').addEventListener('click', () => Router.go('/'));
    _stage = document.getElementById('pg-stage');

    // Fallback: if the scene still hasn't rendered its canvas after a while
    // (slow connection, or the THREE CDN is blocked), the bare loading box
    // would otherwise sit forever — surface a hint so the user isn't stuck
    // staring at nothing.
    const myMount = ++_mountSeq;
    _loadTimer = setTimeout(() => {
      // Don't cry "still loading" while the spawn picker is up — the bring-up is
      // deliberately paused waiting on the user's island choice.
      if (_mountSeq === myMount && _stage && !_stage.querySelector('.pg3d-canvas')
          && !document.querySelector('.world-spawn')) {
        if (typeof toast === 'function') toast('Still loading the world — check your connection.', 'warn');
      }
    }, 12000);

    // Load the player's character; if missing (never built), use default.
    _loadCharacterThenStart(myMount);
  }

  async function _loadCharacterThenStart(myMount) {
    let character = null;
    let fetchFailed = false;
    try {
      const res = await fetch(`${API}/profile/home-character`, {
        headers: { Authorization: `Bearer ${Auth.getToken()}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.homeCharacter && data.homeCharacter.skin != null) character = data.homeCharacter;
      } else {
        fetchFailed = true;
      }
    } catch (_) { fetchFailed = true; /* offline / network blip — fall through with defaults */ }

    // Bail if the view was unmounted (or remounted) while the fetch was in
    // flight — _stage is gone and initializing now would throw / leak.
    if (myMount !== _mountSeq) return;

    // Make sure WatchState is populated so isUnlocked checks use this
    // user's progress, not stale or empty defaults.
    if (typeof state !== 'undefined' && state.data && state.data.size === 0) {
      try { await state.load(); } catch (_) {}
      if (myMount !== _mountSeq) return;
    }
    if (typeof projects !== 'undefined' && typeof state !== 'undefined' && state.initProjects) {
      state.initProjects(projects);
    }

    if (!character) {
      character = Playground3D.defaultCharacter();
      // Only nag about a real failure — a brand-new user with no saved
      // character legitimately falls back to the default and shouldn't see an error.
      if (fetchFailed && typeof toast === 'function') {
        toast('Couldn’t load your character — using a default look.', 'warn');
      }
    }
    // Spawn picker: when the watched nodes form more than one disconnected
    // island (e.g. someone who's seen Iron Man and Moon Knight but nothing
    // joining them), let the player choose which one to start on — otherwise
    // they'd always land on the first and couldn't walk to the others.
    let chosenSpawnId = null;
    const islands = _spawnIslands();
    if (islands.length > 1) {
      chosenSpawnId = await _openSpawnPicker(islands, 'enter');
      if (myMount !== _mountSeq) return;   // unmounted while the picker was open
    }
    Playground3D.initWorld(_stage, character, chosenSpawnId);
    _loadHouses(myMount);

    // Avenger NPCs — each preset model roams the apron around its debut node.
    // Map preset → roster character (via charId) to resolve the debut project;
    // Playground3D spawns each hero once its debut node is unlocked.
    if (Playground3D.setWorldNpcs && typeof Playground !== 'undefined' && Array.isArray(Playground.CHARACTER_PRESETS)) {
      const npcBodies = await _npcBodyTypes();
      if (myMount !== _mountSeq) return;
      const roster = (typeof window.characters !== 'undefined' && window.characters) || [];
      const unresolved = [];
      const npcSpecs = Playground.CHARACTER_PRESETS.map(p => {
        const c = roster.find(x => x.id === p.charId);
        if (!c || !c.debut) { unresolved.push(p.charId); return null; }
        const id = 'npc_' + p.id;
        return { id, name: p.name, character: { ...p.char, bodyType: npcBodies[id] === 1 ? 1 : 0 }, debut: c.debut };
      }).filter(Boolean);
      // The Avengers vanishing from /world is a silent, confusing failure. It
      // happens when the roster (from /api/content/characters) drifts from the
      // preset list — a renamed charId or a character missing its `debut` node.
      // Surface it in the console so it's diagnosable rather than mysterious.
      if (unresolved.length) {
        console.warn('[World] %d/%d NPC presets unresolved (no roster match or missing debut):',
          unresolved.length, Playground.CHARACTER_PRESETS.length, unresolved);
      }
      Playground3D.setWorldNpcs(npcSpecs);
    }

    // Is the Infinity Stone hunt + snap event live? Global admin switch
    // (flags.worldEventStonesEnabled). When off, the whole feature stays dark:
    // no HUD, no snap handlers — and the server sends no stones / refuses grabs.
    const stonesOn = await _stonesEventOn();
    if (myMount !== _mountSeq) return;

    if (typeof Multiplayer !== 'undefined' && Multiplayer.start) {
      _mp = Multiplayer.start({
        events: Multiplayer.WORLD_EVENTS,
        joinPayload: {},
        character,
        onStoneChange: stonesOn ? _refreshStoneHud : undefined,
        onSnapped: stonesOn ? _onSnapped : undefined,
        onZone: _onZone,
        onHouse: _onHouse
      });
    }

    _wireVoiceToggle('world');
    const houseBtn = document.getElementById('world-house-btn');
    if (houseBtn) {
      _houseBtnHandler = () => { if (_zone) _openHouseEditor(_zone); };
      houseBtn.addEventListener('click', _houseBtnHandler);
    }
    _maybeShowControlsHint();
    if (stonesOn) _initStones();
  }

  // Resolve the global feature flags. boot.js stashes them on window.APP_FLAGS
  // after its /config/public fetch; if a deep-link to /world beat that fetch,
  // fetch once ourselves so the event's on/off state is always correct.
  async function _ensureFlags() {
    if (window.APP_FLAGS && window.APP_WORLD) return window.APP_FLAGS;
    try {
      const res = await fetch(`${API}/config/public`);
      if (res.ok) {
        const cfg = await res.json();
        if (cfg && cfg.flags) window.APP_FLAGS = cfg.flags;
        if (cfg && cfg.world) window.APP_WORLD = cfg.world;
      }
    } catch (_) { /* offline — treat as defaults (event off) */ }
    return window.APP_FLAGS || {};
  }
  // Admin-chosen body type per hero NPC (id → Playground.BODY_TYPES index).
  async function _npcBodyTypes() {
    await _ensureFlags();
    return (window.APP_WORLD && window.APP_WORLD.npcBodyTypes) || {};
  }
  async function _stonesEventOn() {
    const flags = await _ensureFlags();
    return !!flags.worldEventStonesEnabled;
  }

  /* ── Shared Infinity Stone PvP ── */

  function _initStones() {
    const chip = document.getElementById('world-stone-chip');
    if (chip) { chip.hidden = false; chip.addEventListener('click', _openStoneLeaderboard); }
    _refreshStoneHud();
    const snapBtn = document.getElementById('world-snap-btn');
    if (snapBtn) snapBtn.addEventListener('click', _doSnap);
    // Keyboard: G snaps (only fires when you actually hold all six — the
    // server re-checks anyway). Ignored while typing in the chat box.
    _snapKeyHandler = (e) => {
      if (_isTextField(document.activeElement)) return;
      if (e.key === 'g' || e.key === 'G') _doSnap();
    };
    window.addEventListener('keydown', _snapKeyHandler);
  }

  // Reflect the local player's held count in the chip + reveal the SNAP
  // button at six. Driven by every stone ownership change from the server.
  function _refreshStoneHud() {
    const n = Playground3D.getLocalStoneCount ? Playground3D.getLocalStoneCount() : 0;
    const chip = document.getElementById('world-stone-chip');
    if (chip) {
      chip.textContent = `💎 ${n}/6`;
      chip.classList.toggle('complete', n >= 6);
    }
    const snapBtn = document.getElementById('world-snap-btn');
    if (snapBtn) snapBtn.hidden = n < 6;
    if (n >= 6 && !_snapHinted) {
      _snapHinted = true;
      if (typeof toast === 'function') toast('You hold all six — press SNAP (G)!', { type: 'success', duration: 5000 });
    } else if (n < 6) {
      _snapHinted = false;
    }
  }

  function _doSnap() {
    if (!_mp || !_mp.sendSnap) return;
    if (Playground3D.getLocalStoneCount && Playground3D.getLocalStoneCount() < 6) return;
    _mp.sendSnap();     // server verifies + broadcasts world:snapped
  }

  // A snap happened (could be us or someone else). The engine already dusted
  // the victims (fade + respawn); here we do the room-wide flash + toast.
  function _onSnapped(payload) {
    _snapFlash();
    const victims = (payload && Array.isArray(payload.victims)) ? payload.victims : [];
    const socket = _mp && _mp.getSocket && _mp.getSocket();
    const myId = socket && socket.id;
    const iSnapped = myId && payload && payload.by === myId;
    const iDusted = myId && victims.includes(myId);
    // Dusted back to the start in a disconnected world → offer where to
    // reassemble (the engine already respawned us at Iron Man; this relocates).
    if (iDusted) {
      const islands = _spawnIslands();
      if (islands.length > 1) _openSpawnPicker(islands, 'respawn');
    }
    if (typeof toast !== 'function') return;
    if (iSnapped) toast('✨ You snapped! Half the world turned to dust.', { type: 'success', duration: 5000 });
    else if (iDusted) toast('💨 You were dusted — reassembling at the start.', { type: 'warn', duration: 5000 });
    else toast('✨ Someone snapped. You survived.', { type: 'info', duration: 4000 });
  }

  let _snapHinted = false;

  function _isTextField(el) {
    if (!el) return false;
    const t = el.tagName;
    return t === 'INPUT' || t === 'TEXTAREA' || el.isContentEditable;
  }

  // Full-stage white flash for any snap.
  function _snapFlash() {
    if (!_stage) return;
    const flash = document.createElement('div');
    flash.className = 'world-snap-flash';
    _stage.appendChild(flash);
    requestAnimationFrame(() => flash.classList.add('show'));
    setTimeout(() => flash.classList.remove('show'), 450);
    setTimeout(() => { if (flash.parentNode) flash.parentNode.removeChild(flash); }, 1000);
  }

  async function _openStoneLeaderboard() {
    document.querySelector('.world-lb')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'world-lb';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Infinity Stone leaderboard');
    overlay.innerHTML = `
      <div class="world-lb-panel">
        <button class="popup-close" aria-label="Close">✕</button>
        <h3>✊ Snap Leaderboard</h3>
        <p class="world-lb-sub">Grab all six stones — punch to steal them — then snap to dust half the room.</p>
        <div class="world-lb-rows">Loading…</div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = wireModalDismiss(overlay, () => overlay.remove(), {
      initialFocus: overlay.querySelector('.popup-close')
    });
    overlay.querySelector('.popup-close').addEventListener('click', close);

    try {
      const res = await fetch(`${API}/friends/stones`, {
        headers: { Authorization: `Bearer ${Auth.getToken()}` }
      });
      const rows = res.ok ? await res.json() : null;
      const host = overlay.querySelector('.world-lb-rows');
      if (!host) return;
      if (!Array.isArray(rows) || !rows.length) {
        host.innerHTML = '<p class="friends-empty">Couldn’t load the leaderboard.</p>';
        return;
      }
      host.innerHTML = rows.map((r, i) => `
        <div class="world-lb-row${r.you ? ' you' : ''}">
          <span class="world-lb-rank">${i + 1}</span>
          <span class="world-lb-name">${esc(r.username)}${r.you ? ' (you)' : ''}</span>
          <span class="world-lb-score" title="Lifetime snaps">✊ ${r.snaps}</span>
        </div>
      `).join('');
    } catch (_) {
      const host = overlay.querySelector('.world-lb-rows');
      if (host) host.innerHTML = '<p class="friends-empty">Couldn’t load the leaderboard.</p>';
    }
  }

  /* ── Keeper houses ── */

  // Load every decorated house + each island's keeper. Called once after
  // the engine boots, and again (throttled) when we step onto an island so
  // a player who just overtook the keeper sees the Edit button.
  async function _loadHouses(myMount) {
    try {
      const res = await fetch(`${API}/world/houses`, {
        headers: { Authorization: `Bearer ${Auth.getToken()}` }
      });
      if (!res.ok) return;
      const data = await res.json();
      if (myMount !== _mountSeq) return;
      _houseMe = data.me || null;
      _houseKeepers = data.keepers || {};
      _houseMine = data.mine || {};
      _housesAt = Date.now();
      if (_liveStay) { _liveSettle(_housesAt); _liveStay.extraMs = 0; }
      // Keep the editor's live preview: the island being edited stays on its
      // draft (setHouses only rebuilds nodes whose house object changed).
      const houses = data.houses || {};
      if (_houseEditing && Playground3D.getHouse) {
        const live = Playground3D.getHouse(_houseEditing);
        if (live) houses[_houseEditing] = live;
      }
      if (Playground3D.setHouses) Playground3D.setHouses(houses);
      _refreshHouseHud();
    } catch (_) { /* offline — houses stay default, HUD stays hidden */ }
    if (!_housePoll && myMount === _mountSeq) {
      _housePoll = setInterval(() => _loadHouses(_mountSeq), HOUSE_POLL_MS);
    }
  }

  // In-world tags over every unlocked house: who keeps it (and their stay),
  // plus my own stay there so I can compare. "Unclaimed" only shows on the
  // island I'm standing on — elsewhere it's just skyline clutter.
  function _pushKeeperTags() {
    if (!Playground3D.setHouseKeepers || typeof projects === 'undefined') return;
    const tags = {};
    for (const p of projects) {
      if (!p || !p.id) continue;
      const k = _houseKeepers[p.id];
      const here = p.id === _zone;
      const mineMs = _myStay(p.id);
      if (!k) {
        if (here) tags[p.id] = { line1: '🔑 Unclaimed', line2: `you ${_fmtStay(mineMs)} · stay to claim it`, unclaimed: true };
        continue;
      }
      const mine = !!(_houseMe && k.userId === _houseMe);
      tags[p.id] = mine
        ? { line1: `🔑 You · ${_fmtStay(Math.max(k.ms, mineMs))}`, line2: 'you keep this house', mine: true }
        : { line1: `🔑 ${k.username} · ${_fmtStay(k.ms)}`,
            line2: (here || mineMs) ? `you ${_fmtStay(mineMs)}` : '' };
    }
    Playground3D.setHouseKeepers(tags);
  }

  // My stay on `projectId`: last polled total, plus live credit while I'm there.
  function _myStay(projectId) {
    const base = _houseMine[projectId] || 0;
    const s = _liveStay;
    if (!s || s.projectId !== projectId) return base;
    s.shownMs = Math.max(s.shownMs, base + s.extraMs);
    return s.shownMs;
  }

  // Credit time up to `now`, capped at the AFK limit past my last action.
  function _liveSettle(now) {
    const s = _liveStay;
    if (!s) return;
    const cap = Math.min(now, s.lastActiveAt + STAY_AFK_MS);
    if (cap > s.creditedUpTo) { s.extraMs += cap - s.creditedUpTo; s.creditedUpTo = cap; }
  }

  // Once a second: count walking / key / pointer input as activity, then
  // repaint the tags only when the shown minute actually changes.
  function _liveStep() {
    const s = _liveStay;
    if (!s) return;
    const now = Date.now();
    const st = Playground3D.getLocalState && Playground3D.getLocalState();
    if ((st && st.walking) || now - _lastInputAt < 1500) {
      _liveSettle(now);
      s.lastActiveAt = now;
      s.creditedUpTo = Math.max(s.creditedUpTo, now);
    }
    _liveSettle(now);
    const label = _fmtStay(_myStay(s.projectId));
    if (label !== _liveLabel) { _liveLabel = label; _refreshHouseHud(); }
  }

  function _onZone(projectId) {
    const next = projectId || null;
    if (_liveStay && _liveStay.projectId !== next) {
      // Leaving: keep what I earned on that island's tag until the next poll.
      _liveSettle(Date.now());
      const id = _liveStay.projectId;
      _houseMine[id] = Math.max(_houseMine[id] || 0, _myStay(id));
      _liveStay = null;
    }
    if (next && !_liveStay) {
      const now = Date.now();
      _liveStay = { projectId: next, extraMs: 0, lastActiveAt: now, creditedUpTo: now, shownMs: 0 };
      _liveLabel = '';
    }
    if (!_liveTick) _liveTick = setInterval(_liveStep, 1000);
    if (!_liveInputHandler) {
      _liveInputHandler = () => { _lastInputAt = Date.now(); };
      window.addEventListener('keydown', _liveInputHandler, true);
      window.addEventListener('pointerdown', _liveInputHandler, true);
    }
    _zone = next;
    if (_zone && Date.now() - _housesAt > 30000) _loadHouses(_mountSeq);
    _refreshHouseHud();
    if (_voice) _voiceVisual(_voiceState, _voiceMsg);
  }

  function _onHouse(p) {
    if (p && p.projectId && p.keeper) _houseKeepers[p.projectId] = p.keeper;
    _refreshHouseHud();
  }

  function _fmtStay(ms) {
    return (typeof WorldHouseLogic !== 'undefined') ? WorldHouseLogic.formatStay(ms) : '';
  }

  function _projectTitle(id) {
    const p = (typeof projects !== 'undefined' && Array.isArray(projects)) ? projects.find(q => q.id === id) : null;
    return (p && p.title) || id;
  }

  // On an island: the keeper sees "Edit house", everyone else sees who keeps
  // it (or that it's unclaimed). Off-island: nothing.
  function _refreshHouseHud() {
    _pushKeeperTags();
    const btn = document.getElementById('world-house-btn');
    const label = document.getElementById('world-house-keeper');
    if (!btn || !label) return;
    if (!_zone) { btn.hidden = true; label.hidden = true; return; }
    const k = _houseKeepers[_zone];
    const mine = !!(k && _houseMe && k.userId === _houseMe);
    btn.hidden = !mine;
    label.hidden = mine;
    if (mine) {
      btn.title = `You keep ${_projectTitle(_zone)} (${_fmtStay(Math.max(k.ms, _myStay(_zone)))} here) — decorate it`;
    } else if (k) {
      // Two spans: the keeper's name may ellipsise, my own stay (my progress
      // toward taking the house) never does — with a fill showing how close.
      const my = _myStay(_zone);
      const pct = Math.min(1, my / Math.max(1, k.ms));
      label.innerHTML = `<span class="world-house-keeper-name">🔑 ${esc(k.username)} · ${_fmtStay(k.ms)}</span>`
        + `<span class="world-house-keeper-you" style="--pct:${pct.toFixed(3)}">you ${_fmtStay(my)}</span>`;
      label.title = `${k.username} keeps ${_projectTitle(_zone)} with ${_fmtStay(k.ms)} here · you ${_fmtStay(my)}. The longest stay (moving or chatting) keeps the house.`;
    } else {
      label.innerHTML = `<span class="world-house-keeper-name">🔑 Unclaimed</span>`
        + `<span class="world-house-keeper-you" style="--pct:0">you ${_fmtStay(_myStay(_zone))}</span>`;
      label.title = `Nobody keeps ${_projectTitle(_zone)} yet — the longest stay here wins it.`;
    }
  }

  // Colour swatches + sign + a top-down prop grid. Every change previews
  // live in the engine (only locally); Save PUTs, Cancel restores.
  function _openHouseEditor(projectId) {
    if (typeof WorldHouseLogic === 'undefined') return;
    if (_houseEditorClose) { _houseEditorClose(); }
    const L = WorldHouseLogic;
    const saved = (Playground3D.getHouse && Playground3D.getHouse(projectId)) || L.defaultHouse();
    // A stored house that no longer validates (e.g. a portrait URL the rules
    // now reject) must not break the editor: drop the offending field, and as
    // a last resort start from defaults.
    const v0 = L.validateHouse(saved);
    const v1 = v0.ok ? v0 : L.validateHouse({ ...saved, portrait: '' });
    const draft = v1.ok ? v1.house : L.defaultHouse();
    const hex = (n) => '#' + ('000000' + (n >>> 0).toString(16)).slice(-6);
    const GLYPH = { chair: '🪑', table: '🛋️', frame: '🖼️', plant: '🪴', lamp: '💡', rug: '🟫', bookshelf: '📚', crate: '📦', window: '🪟' };
    const SLOTS = [['wallColor', 'Walls'], ['roofColor', 'Roof'], ['trimColor', 'Trim'], ['lampColor', 'Lamps']];
    // Shape / finish rows: [field, label, [[value, caption, title], …]].
    const STYLE_ROWS = [
      ['roofStyle', 'Roof', [['flat', 'Flat', 'A flat slab roof'], ['gable', 'Gable', 'A pitched roof with a ridge'], ['hip', 'Hip', 'A pyramid roof sloping on all four sides']]],
      ['wallStyle', 'Walls', [['plaster', 'Plaster', 'Smooth stucco'], ['brick', 'Brick', 'Brick courses'], ['stone', 'Stone', 'Rough stone blocks'], ['timber', 'Timber', 'Wooden planks']]],
      ['windowStyle', 'Windows', [['cross', 'Cross', 'Four panes'], ['grid', 'Grid', 'Six small panes'], ['plain', 'Plain', 'One clear pane'], ['shutters', 'Shutters', 'A plain pane with trim-coloured shutters']]]
    ];
    const CELL = 32, N = L.C.GRID_MAX, RING = N + 2;   // 12×12: interior 1..10 + the wall ring
    // The fixed door: openings per side straight from the engine (roads decide
    // them, never the house). Drawn as locked wall cells; a window can't go there.
    const layout = (Playground3D.getHouseLayout && Playground3D.getHouseLayout(projectId)) || null;
    const doorCells = {};
    for (const side of L.SIDES) doorCells[side] = layout ? L.openingsToCells(layout[side]) : [];
    const isDoorCell = (side, pos) => doorCells[side].some(([a, b]) => pos >= a && pos <= b);
    // Wall-ring cell → which wall and how far along it (top row is north).
    const ringCell = (gx, gy) => {
      if (gy === 0 && gx >= 1 && gx <= N) return { side: 'N', pos: gx };
      if (gy === RING - 1 && gx >= 1 && gx <= N) return { side: 'S', pos: gx };
      if (gx === 0 && gy >= 1 && gy <= N) return { side: 'W', pos: gy };
      if (gx === RING - 1 && gy >= 1 && gy <= N) return { side: 'E', pos: gy };
      return null;
    };
    const ringXY = (side, along) => {   // (side, offset along the wall) → SVG centre
      if (side === 'N') return [along * CELL, CELL / 2];
      if (side === 'S') return [along * CELL, (RING - 0.5) * CELL];
      if (side === 'W') return [CELL / 2, along * CELL];
      return [(RING - 0.5) * CELL, along * CELL];
    };
    let selectedKind = 'chair';     // a prop kind, or 'window'
    let selectedProp = -1;          // index into draft.props
    let selectedWindow = -1;        // index into draft.windows (explicit mode only)

    const overlay = document.createElement('div');
    overlay.className = 'world-house';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Edit house');
    const swatchRows = SLOTS.map(([slot, name]) => `
      <div class="world-house-row" data-slot="${slot}">
        <span class="world-house-label">${name}</span>
        <div class="world-house-swatches">
          <button type="button" class="world-house-swatch default" data-idx="" title="Default">Auto</button>
          ${L.PALETTE.map((c, i) => `<button type="button" class="world-house-swatch" data-idx="${i}" style="background:${hex(c)}" title="Colour ${i + 1}"></button>`).join('')}
        </div>
      </div>`).join('');
    const styleRows = STYLE_ROWS.map(([field, name, opts]) => `
      <div class="world-house-row" data-style="${field}">
        <span class="world-house-label">${name}</span>
        <div class="world-house-chips">
          ${opts.map(([v, cap, title]) => `<button type="button" class="world-house-chip" data-value="${v}" title="${esc(title)}">${cap}</button>`).join('')}
          ${field === 'roofStyle' ? `
            <span class="world-house-chipsep" aria-hidden="true"></span>
            <button type="button" class="world-house-chip" data-dir="0" title="Ridge runs east–west">Ridge E–W</button>
            <button type="button" class="world-house-chip" data-dir="1" title="Ridge runs north–south">Ridge N–S</button>
            <button type="button" class="world-house-chip" data-chimney title="A brick chimney on the roof">Chimney</button>` : ''}
          ${field === 'windowStyle' ? `
            <span class="world-house-chipsep" aria-hidden="true"></span>
            <button type="button" class="world-house-chip" data-winauto title="Let the house pick: one window on each long stretch of wall">Auto</button>` : ''}
        </div>
      </div>`).join('');
    overlay.innerHTML = `
      <div class="world-house-panel">
        <button class="popup-close" aria-label="Close">✕</button>
        <h3>🏠 ${esc(_projectTitle(projectId))}</h3>
        <p class="world-house-sub">You keep this house (longest stay). Everyone in the world sees what you save. While this panel is open the camera circles your house from outside, so every change shows as you make it. The door stays where the road meets the house.</p>
        <button type="button" class="world-house-tool world-house-peek" data-peek="on" title="Hide the panel to look at the house">👁 Look at the house</button>
        <div class="world-house-styles">${styleRows}</div>
        <div class="world-house-colors">${swatchRows}</div>
        <label class="world-house-signrow">
          <span class="world-house-label">Sign</span>
          <input type="text" id="world-house-sign" maxlength="${L.C.SIGN_MAX}" placeholder="Name over the door" autocomplete="off" />
        </label>
        <div class="world-house-portraitrow">
          <span class="world-house-label">Portrait</span>
          <span class="world-house-portrait-thumb" id="world-house-portrait-thumb" aria-hidden="true"></span>
          <label class="world-house-tool world-house-upload">
            <span id="world-house-upload-text">Upload photo</span>
            <input type="file" id="world-house-portrait-file" accept="image/*" hidden />
          </label>
          <button type="button" class="world-house-tool" id="world-house-portrait-remove" title="Remove the portrait">🗑</button>
          <span class="world-house-portrait-hint" id="world-house-portrait-hint"></span>
        </div>
        <div class="world-house-props">
          <div class="world-house-kinds">
            ${L.PROP_KINDS.map(k => `<button type="button" class="world-house-kind" data-kind="${k}" title="${k}">${GLYPH[k] || '▪'} ${k}</button>`).join('')}
            <button type="button" class="world-house-kind world-house-kind-window" data-kind="window" title="Place a window on the wall ring">${GLYPH.window} window</button>
          </div>
          <div class="world-house-tools">
            <button type="button" class="world-house-tool" data-tool="rotate" title="Rotate the selected prop">↻ Rotate</button>
            <button type="button" class="world-house-tool" data-tool="remove" title="Remove the selected prop or window">Remove</button>
            <span class="world-house-count" id="world-house-count"></span>
          </div>
          <p class="world-house-hint">Tap an empty floor cell to place the chosen prop; tap a prop to select it. Frames hang on the nearest wall. The outer ring is the wall: pick 🪟 and tap it to place windows. 🚪 is the door — it's fixed. Top of the plan is north.</p>
          <svg class="world-house-grid" viewBox="0 0 ${RING * CELL} ${RING * CELL}" role="img" aria-label="House floor plan with walls"></svg>
        </div>
        <div class="world-house-actions">
          <button type="button" class="world-house-cancel">Cancel</button>
          <button type="button" class="world-house-save">Save</button>
        </div>
      </div>
    `;
    const peekPill = document.createElement('button');
    peekPill.type = 'button';
    peekPill.className = 'world-house-peekpill';
    peekPill.setAttribute('data-peek', 'off');
    peekPill.textContent = '✏️ Back to editing';
    overlay.appendChild(peekPill);
    document.body.appendChild(overlay);
    // Show the house from outside while editing (the keeper is standing
    // inside it, where its roof is hidden). Cleared on close.
    if (Playground3D.setHouseShowcase) Playground3D.setHouseShowcase(projectId);

    const grid = overlay.querySelector('.world-house-grid');
    const signInput = overlay.querySelector('#world-house-sign');
    const countEl = overlay.querySelector('#world-house-count');
    signInput.value = draft.sign || '';

    function preview() {
      const v = L.validateHouse(draft);
      if (v.ok && Playground3D.applyHouse) Playground3D.applyHouse(projectId, v.house);
    }
    function renderSwatches() {
      overlay.querySelectorAll('.world-house-row').forEach((row) => {
        const slot = row.getAttribute('data-slot');
        const cur = draft[slot];
        row.querySelectorAll('.world-house-swatch').forEach((b) => {
          const idx = b.getAttribute('data-idx');
          b.classList.toggle('active', (idx === '' && cur == null) || (idx !== '' && Number(idx) === cur));
        });
      });
    }
    function renderChips() {
      overlay.querySelectorAll('.world-house-row[data-style]').forEach((row) => {
        const field = row.getAttribute('data-style');
        row.querySelectorAll('.world-house-chip[data-value]').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-value') === draft[field]);
        });
      });
      const gable = draft.roofStyle === 'gable';
      overlay.querySelectorAll('.world-house-chip[data-dir]').forEach((b) => {
        b.hidden = !gable;
        b.classList.toggle('active', gable && Number(b.getAttribute('data-dir')) === (draft.roofDir || 0));
      });
      const chimney = overlay.querySelector('.world-house-chip[data-chimney]');
      if (chimney) chimney.classList.toggle('active', !!draft.chimney);
      const auto = overlay.querySelector('.world-house-chip[data-winauto]');
      if (auto) auto.classList.toggle('active', draft.windows == null);
    }
    function renderKinds() {
      overlay.querySelectorAll('.world-house-kind').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-kind') === selectedKind);
      });
      const n = draft.props.length;
      const w = draft.windows == null ? 'auto' : `${draft.windows.length}/${L.C.MAX_WINDOWS}`;
      countEl.textContent = `${n}/${L.C.MAX_PROPS} props · ${w} windows`;
      const hasSel = selectedProp >= 0 || selectedWindow >= 0;
      overlay.querySelectorAll('.world-house-tool').forEach((b) => { b.disabled = !hasSel; });
    }
    function renderGrid() {
      const cells = [];
      // Wall ring (12×12 outer cells): the fixed door, then free wall / corners.
      for (let gy = 0; gy < RING; gy++) {
        for (let gx = 0; gx < RING; gx++) {
          const inner = gx >= 1 && gx <= N && gy >= 1 && gy <= N;
          const x = gx * CELL, y = gy * CELL;
          if (inner) {
            cells.push(`<rect class="world-house-cell" data-gx="${gx}" data-gy="${gy}" x="${x}" y="${y}" width="${CELL}" height="${CELL}" />`);
            continue;
          }
          const rc = ringCell(gx, gy);
          if (!rc) { cells.push(`<rect class="world-house-corner" x="${x}" y="${y}" width="${CELL}" height="${CELL}" />`); continue; }
          if (isDoorCell(rc.side, rc.pos)) {
            cells.push(`<g class="world-house-wall locked" data-side="${rc.side}" data-pos="${rc.pos}">
              <title>Door — fixed by the road</title>
              <rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" />
              <text x="${x + CELL / 2}" y="${y + CELL / 2 + 1}" text-anchor="middle" dominant-baseline="middle" font-size="16">🚪</text>
            </g>`);
          } else {
            cells.push(`<rect class="world-house-wall" data-side="${rc.side}" data-pos="${rc.pos}" x="${x}" y="${y}" width="${CELL}" height="${CELL}" />`);
          }
        }
      }
      // Windows: the keeper's own (selectable) or, in auto mode, a greyed
      // preview of where the house puts them by itself.
      let windows = '';
      if (draft.windows != null) {
        windows = draft.windows.map((w, i) => {
          const [wx, wy] = ringXY(w.side, w.pos + 0.5);
          const sel = i === selectedWindow ? ' selected' : '';
          return `<g class="world-house-window${sel}" data-w="${i}" transform="translate(${wx} ${wy})">
            <rect x="${-CELL / 2 + 2}" y="${-CELL / 2 + 2}" width="${CELL - 4}" height="${CELL - 4}" rx="5" />
            <text x="0" y="1" text-anchor="middle" dominant-baseline="middle" font-size="16">🪟</text>
          </g>`;
        }).join('');
      } else if (layout) {
        for (const side of L.SIDES) {
          for (const c of L.autoWindowCentres(layout[side])) {
            const [wx, wy] = ringXY(side, c);
            windows += `<g class="world-house-window auto" transform="translate(${wx} ${wy})"><title>Auto window</title>
              <text x="0" y="1" text-anchor="middle" dominant-baseline="middle" font-size="16">🪟</text></g>`;
          }
        }
      }
      const props = draft.props.map((p, i) => {
        const cx = (p.gx + 0.5) * CELL, cy = (p.gy + 0.5) * CELL;
        const sel = i === selectedProp ? ' selected' : '';
        return `<g class="world-house-prop${sel}" data-i="${i}" transform="translate(${cx} ${cy})">
          <rect x="${-CELL / 2 + 2}" y="${-CELL / 2 + 2}" width="${CELL - 4}" height="${CELL - 4}" rx="5" />
          <text x="0" y="1" text-anchor="middle" dominant-baseline="middle" font-size="18">${GLYPH[p.kind] || '▪'}</text>
          <path d="M0,-${CELL / 2 - 3} l4,5 h-8 z" transform="rotate(${(p.rot || 0) * 90})" />
        </g>`;
      }).join('');
      grid.innerHTML = `<rect class="world-house-floor" x="${CELL}" y="${CELL}" width="${N * CELL}" height="${N * CELL}" />${cells.join('')}${windows}${props}`;
    }
    // Portrait: a photo the keeper uploads (same /upload route as memories),
    // shown inside every Frame prop. Uploading auto-places a frame if there
    // is none yet, so the picture is visible straight away.
    const thumb = overlay.querySelector('#world-house-portrait-thumb');
    const fileInput = overlay.querySelector('#world-house-portrait-file');
    const uploadText = overlay.querySelector('#world-house-upload-text');
    const removeBtn = overlay.querySelector('#world-house-portrait-remove');
    const portraitHint = overlay.querySelector('#world-house-portrait-hint');
    function renderPortrait() {
      const url = draft.portrait || '';
      thumb.style.backgroundImage = url ? `url("${url.replace(/"/g, '%22')}")` : '';
      thumb.classList.toggle('empty', !url);
      removeBtn.disabled = !url;
      const frames = draft.props.filter(p => p.kind === 'frame').length;
      portraitHint.textContent = !url ? 'Shown inside your Frame props.'
        : (frames ? `Hanging in ${frames} frame${frames > 1 ? 's' : ''}.` : 'Place a Frame prop to hang it.');
    }
    function ensureFrame() {
      if (draft.props.some(p => p.kind === 'frame') || draft.props.length >= L.C.MAX_PROPS) return;
      const taken = new Set(draft.props.map(p => `${p.gx},${p.gy}`));
      // Wall cells, north wall first (the picture then faces the room).
      for (const [gx, gy] of [[4, 1], [7, 1], [3, 1], [8, 1], [1, 5], [10, 5], [4, 10], [7, 10]]) {
        if (!taken.has(`${gx},${gy}`)) { draft.props.push({ kind: 'frame', ...L.snapFrameToWall(gx, gy) }); return; }
      }
    }
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      if (!file.type.startsWith('image/')) { if (typeof toast === 'function') toast('Please choose an image.', 'warn'); return; }
      uploadText.textContent = 'Uploading…';
      fileInput.disabled = true;
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(`${API}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${Auth.getToken()}` }, body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.url) throw new Error(data.error || 'Upload failed');
        draft.portrait = data.url;
        ensureFrame();
        renderPortrait(); renderKinds(); renderGrid(); preview();
      } catch (e) {
        if (typeof toast === 'function') toast(e.message || 'Upload failed', 'error');
      } finally {
        uploadText.textContent = 'Upload photo';
        fileInput.disabled = false;
      }
    });
    removeBtn.addEventListener('click', () => { draft.portrait = ''; renderPortrait(); preview(); });

    function renderAll() { renderSwatches(); renderChips(); renderKinds(); renderGrid(); renderPortrait(); }
    renderAll();
    preview();

    overlay.addEventListener('click', (e) => {
      // Peek: hide the panel (and the dark backdrop) so the whole house is
      // visible; the pill brings the panel back. Nothing else is dismissed.
      const peek = e.target.closest('[data-peek]');
      if (peek) { overlay.classList.toggle('peeking', peek.getAttribute('data-peek') === 'on'); return; }
      const sw = e.target.closest('.world-house-swatch');
      if (sw) {
        const slot = sw.closest('.world-house-row').getAttribute('data-slot');
        const idx = sw.getAttribute('data-idx');
        draft[slot] = idx === '' ? null : Number(idx);
        renderSwatches(); preview();
        return;
      }
      // Shape / finish chips.
      const chip = e.target.closest('.world-house-chip');
      if (chip) {
        if (chip.hasAttribute('data-value')) {
          draft[chip.closest('.world-house-row').getAttribute('data-style')] = chip.getAttribute('data-value');
        } else if (chip.hasAttribute('data-dir')) {
          draft.roofDir = Number(chip.getAttribute('data-dir'));
        } else if (chip.hasAttribute('data-chimney')) {
          draft.chimney = !draft.chimney;
        } else if (chip.hasAttribute('data-winauto')) {
          draft.windows = null;
          selectedWindow = -1;
        }
        renderChips(); renderKinds(); renderGrid(); preview();
        return;
      }
      const kind = e.target.closest('.world-house-kind');
      if (kind) { selectedKind = kind.getAttribute('data-kind'); selectedProp = -1; selectedWindow = -1; renderKinds(); renderGrid(); return; }
      const tool = e.target.closest('.world-house-tool');
      if (tool && selectedWindow >= 0 && draft.windows && draft.windows[selectedWindow]) {
        if (tool.getAttribute('data-tool') === 'rotate') {
          if (typeof toast === 'function') toast('Windows face out from their wall — move it to another spot instead.', 'info');
          return;
        }
        draft.windows.splice(selectedWindow, 1);
        selectedWindow = -1;
        renderKinds(); renderGrid(); preview();
        return;
      }
      if (tool && selectedProp >= 0 && draft.props[selectedProp]) {
        if (tool.getAttribute('data-tool') === 'rotate') {
          // A frame's facing is fixed by the wall it hangs on.
          if (draft.props[selectedProp].kind === 'frame') {
            if (typeof toast === 'function') toast('Frames face into the room from their wall — move it to another wall instead.', 'info');
            return;
          }
          draft.props[selectedProp].rot = ((draft.props[selectedProp].rot || 0) + 1) % 4;
        } else {
          draft.props.splice(selectedProp, 1);
          selectedProp = -1;
        }
        renderKinds(); renderGrid(); renderPortrait(); preview();
        return;
      }
      const propEl = e.target.closest('.world-house-prop');
      if (propEl) { selectedProp = Number(propEl.getAttribute('data-i')); selectedWindow = -1; renderKinds(); renderGrid(); return; }
      const winEl = e.target.closest('.world-house-window');
      if (winEl && winEl.hasAttribute('data-w')) { selectedWindow = Number(winEl.getAttribute('data-w')); selectedProp = -1; renderKinds(); renderGrid(); return; }
      // The wall ring: windows only (and never on the door).
      const wall = e.target.closest('.world-house-wall');
      if (wall) {
        const side = wall.getAttribute('data-side'), pos = Number(wall.getAttribute('data-pos'));
        if (wall.classList.contains('locked')) {
          if (typeof toast === 'function') toast('The door is fixed — it sits where the road comes in.', 'info');
          return;
        }
        if (selectedKind !== 'window') {
          if (typeof toast === 'function') toast('That\'s the wall — pick 🪟 window to put a window there.', 'info');
          return;
        }
        const current = draft.windows == null ? [] : draft.windows;
        const can = L.canPlaceWindow(current, side, pos, layout ? layout[side] : []);
        if (!can.ok) { if (typeof toast === 'function') toast(can.error, 'warn'); return; }
        draft.windows = [...current, { side, pos }];   // leaving auto mode keeps only what you place
        selectedWindow = draft.windows.length - 1;
        selectedProp = -1;
        renderChips(); renderKinds(); renderGrid(); preview();
        return;
      }
      const cell = e.target.closest('.world-house-cell');
      if (cell) {
        const gx = Number(cell.getAttribute('data-gx')), gy = Number(cell.getAttribute('data-gy'));
        if (selectedKind === 'window') {
          if (typeof toast === 'function') toast('Windows go on the wall — tap the outer ring.', 'info');
          return;
        }
        if (draft.props.length >= L.C.MAX_PROPS) {
          if (typeof toast === 'function') toast(`That's the limit — ${L.C.MAX_PROPS} props per house.`, 'warn');
          return;
        }
        // Frames hang on the nearest wall, so an inside tap snaps to the edge;
        // that wall cell may already be taken.
        const placed = selectedKind === 'frame' ? L.snapFrameToWall(gx, gy) : { gx, gy, rot: 0 };
        if (draft.props.some(p => p.gx === placed.gx && p.gy === placed.gy)) {
          if (typeof toast === 'function') toast('That wall spot is taken — tap nearer a free stretch of wall.', 'warn');
          return;
        }
        draft.props.push({ kind: selectedKind, ...placed });
        selectedProp = draft.props.length - 1;
        renderKinds(); renderGrid(); renderPortrait(); preview();
      }
    });
    signInput.addEventListener('input', () => { draft.sign = L.sanitizeSign(signInput.value); preview(); });

    let closed = false;
    const restore = () => { if (Playground3D.applyHouse) Playground3D.applyHouse(projectId, saved); };
    const close = wireModalDismiss(overlay, () => {
      if (closed) return;
      closed = true;
      overlay.remove();
      _houseEditorClose = null;
      _houseEditing = null;
      if (Playground3D.clearHouseShowcase) Playground3D.clearHouseShowcase();
    }, { initialFocus: overlay.querySelector('.popup-close') });
    _houseEditing = projectId;
    _houseEditorClose = () => { restore(); close(); };
    overlay.querySelector('.popup-close').addEventListener('click', () => { restore(); close(); });
    overlay.querySelector('.world-house-cancel').addEventListener('click', () => { restore(); close(); });
    overlay.querySelector('.world-house-save').addEventListener('click', async () => {
      const v = L.validateHouse(draft);
      if (!v.ok) { if (typeof toast === 'function') toast(v.error, 'warn'); return; }
      const btn = overlay.querySelector('.world-house-save');
      btn.disabled = true;
      try {
        const res = await fetch(`${API}/world/houses/${encodeURIComponent(projectId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Auth.getToken()}` },
          body: JSON.stringify(v.house)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (data && data.keeper) { _houseKeepers[projectId] = data.keeper; _refreshHouseHud(); }
          if (typeof toast === 'function') toast(data.error || 'Couldn’t save the house.', 'error');
          restore();
          close();
          return;
        }
        if (Playground3D.applyHouse) Playground3D.applyHouse(projectId, data.house || v.house);
        if (data.keeper) _houseKeepers[projectId] = data.keeper;
        _refreshHouseHud();
        if (typeof toast === 'function') toast('House saved — everyone can see it now.', 'success');
        close();
      } catch (_) {
        if (typeof toast === 'function') toast('Couldn’t save the house — check your connection.', 'error');
        btn.disabled = false;
      }
    });
  }

  /* ── Spawn picker (disconnected islands) ── */

  // Group the visible nodes into disconnected "islands". Delegates to the
  // engine's own visibility rule (watched only, plus the start node while
  // nothing is watched) so the picker can never offer an island the world
  // doesn't actually build. Returns [] when the data isn't ready; length > 1
  // means the world is disconnected.
  function _spawnIslands() {
    if (typeof PG3DPhysics === 'undefined' || !PG3DPhysics.spawnIslands) return [];
    if (typeof projects === 'undefined' || !Array.isArray(projects)) return [];
    const isUnlocked = (typeof Playground3D !== 'undefined' && Playground3D.isProjectUnlocked)
      ? Playground3D.isProjectUnlocked
      : (p) => typeof state !== 'undefined' && state.isWatched && state.isWatched(p.id);
    return PG3DPhysics.spawnIslands(projects, isUnlocked);
  }

  // Show the island picker. `mode` is 'enter' (before the world builds — resolves
  // to the chosen anchor id, or null if dismissed) or 'respawn' (after a snap —
  // teleports the live player onto the chosen island and resolves).
  function _openSpawnPicker(islands, mode) {
    document.querySelector('.world-spawn')?.remove();
    return new Promise((resolve) => {
      let settled = false;
      const settle = (val) => { if (settled) return; settled = true; _spawnPickerResolve = null; resolve(val); };
      // Let unmount() settle us if the view tears down while we're open.
      _spawnPickerResolve = () => settle(null);

      const overlay = document.createElement('div');
      overlay.className = 'world-spawn';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', mode === 'respawn' ? 'Choose where to reassemble' : 'Choose where to spawn');

      const heading = mode === 'respawn' ? '💨 Reassemble where?' : '🌍 Where to?';
      const sub = mode === 'respawn'
        ? 'Your islands aren’t connected by road — pick where to come back.'
        : 'Your watched locations aren’t all connected by road — pick where to start.';

      const cards = islands.map((isl) => {
        const a = isl.anchor;
        const url = (typeof CONFIG !== 'undefined' && CONFIG.IMAGE_BASE && a.image) ? `${CONFIG.IMAGE_BASE}${a.image}` : '';
        const n = isl.nodes.length;
        const count = n === 1 ? '1 location' : `${n} locations`;
        return `
          <button class="world-spawn-card" type="button" data-id="${esc(a.id)}">
            <span class="world-spawn-poster"${url ? ` style="background-image:url('${esc(url)}')"` : ''} aria-hidden="true"></span>
            <span class="world-spawn-name">${esc(a.title)}</span>
            <span class="world-spawn-count">${count}</span>
          </button>`;
      }).join('');

      overlay.innerHTML = `
        <div class="world-spawn-panel">
          <button class="popup-close" aria-label="Close">✕</button>
          <h3>${heading}</h3>
          <p class="world-spawn-sub">${sub}</p>
          <div class="world-spawn-grid">${cards}</div>
        </div>
      `;
      document.body.appendChild(overlay);

      // Dismissing without a pick resolves null — in 'enter' mode the caller
      // then uses the default Iron Man spawn; in 'respawn' the engine already
      // put the player back at the start, so doing nothing is correct.
      const close = wireModalDismiss(overlay, () => { overlay.remove(); settle(null); }, {
        initialFocus: overlay.querySelector('.world-spawn-card') || overlay.querySelector('.popup-close')
      });
      overlay.querySelector('.popup-close').addEventListener('click', close);
      overlay.querySelectorAll('.world-spawn-card').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          settle(id);                  // beat the closeFn's settle(null)
          if (mode === 'respawn' && Playground3D.teleportToNode) Playground3D.teleportToNode(id);
          close();
        });
      });
    });
  }

  // First-visit controls hint. /world is the marquee feature but nothing
  // tells a newcomer how to move, so it can read as static/broken. Show a
  // dismissible overlay once (localStorage-gated), fading on first input.
  function _maybeShowControlsHint() {
    if (!_stage) return;
    let seen = false;
    try { seen = localStorage.getItem('world_controls_seen') === '1'; } catch (_) {}
    if (seen) return;
    try { localStorage.setItem('world_controls_seen', '1'); } catch (_) {}

    // Same query that reveals the joystick / jump / punch buttons in styles.css,
    // so the hint always describes the controls actually on screen.
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse), (max-width: 768px)').matches;
    const hint = document.createElement('div');
    hint.className = 'world-hint';
    hint.innerHTML = coarse
      ? `<span class="world-hint-icon">🕹️</span> Joystick to move · ⤒ jump · 👊 punch · pinch to zoom · chat tabs for World / Project / Whisper`
      : `<span class="world-hint-icon">⌨️</span> <b>WASD</b> to move · <b>Space</b> to jump · <b>F</b> to punch · drag to look · <b>/w name</b> to whisper`;
    _stage.appendChild(hint);
    requestAnimationFrame(() => hint.classList.add('show'));

    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      window.removeEventListener('keydown', onInput, true);
      window.removeEventListener('pointerdown', onInput, true);
      hint.classList.remove('show');
      setTimeout(() => { if (hint.parentNode) hint.parentNode.removeChild(hint); }, 400);
    };
    const onInput = () => dismiss();
    window.addEventListener('keydown', onInput, true);
    window.addEventListener('pointerdown', onInput, true);
    setTimeout(dismiss, 6000);
  }

  // Centralized voice-button visual state so "off", "on" (transmitting),
  // "listen-only" (mic blocked), and "error" are each visually distinct —
  // previously listen-only/error looked identical to the green transmitting
  // state, so users thought they were heard when they weren't.
  function _voiceVisual(stateName, msg) {
    if (!_voiceBtn) return;
    _voiceState = stateName;
    _voiceMsg = msg || '';
    _voiceBtn.classList.remove('listen-only', 'voice-error', 'idle');
    // /world voice is island-scoped: "on" but off-island means nobody can be
    // heard until you step onto an island — dim the button and say so.
    const where = _zone ? `talking to players on ${_projectTitle(_zone)}` : 'walk onto a project island to talk';
    switch (stateName) {
      case 'on':
        _voiceBtn.setAttribute('aria-pressed', 'true');
        _voiceBtn.classList.toggle('idle', !_zone);
        _voiceBtn.setAttribute('aria-label', `Voice on — ${where}. Click to mute; right-click or long-press for diagnostics.`);
        _voiceBtn.title = `Voice on — ${where} · click to mute · right-click for diagnostics`;
        _voiceBtn.textContent = '🎙️';
        break;
      case 'listen-only':
        _voiceBtn.setAttribute('aria-pressed', 'true');
        _voiceBtn.classList.add('listen-only');
        _voiceBtn.classList.toggle('idle', !_zone);
        _voiceBtn.setAttribute('aria-label', `Listen-only — mic blocked, others can’t hear you (${where}). Right-click or long-press for diagnostics.`);
        _voiceBtn.title = (msg || 'Listen-only — mic blocked') + ` · ${where} · right-click for diagnostics`;
        _voiceBtn.textContent = '🎧';
        break;
      case 'error':
        _voiceBtn.setAttribute('aria-pressed', 'false');
        _voiceBtn.classList.add('voice-error');
        _voiceBtn.setAttribute('aria-label', msg || 'Voice chat error');
        _voiceBtn.title = msg || 'Voice chat error';
        _voiceBtn.textContent = '🎙️';
        break;
      case 'off':
      default:
        _voiceBtn.setAttribute('aria-pressed', 'false');
        _voiceBtn.setAttribute('aria-label', 'Turn on voice chat');
        _voiceBtn.title = 'Voice chat (off)';
        _voiceBtn.textContent = '🎙️';
    }
  }

  function _wireVoiceToggle(scope) {
    _voiceBtn = document.getElementById('world-voice-btn');
    if (!_voiceBtn) return;
    if (typeof VoiceManager === 'undefined' || !VoiceManager.start) {
      _voiceBtn.disabled = true;
      _voiceBtn.title = 'Voice chat unavailable';
      return;
    }
    _voiceBtnHandler = (e) => {
      // Long-press just fired and opened the diag panel; swallow the
      // synthetic click that follows touchend so we don't immediately
      // toggle voice off and destroy the panel.
      if (_voiceLongPressFired) {
        _voiceLongPressFired = false;
        if (e && e.preventDefault) e.preventDefault();
        return;
      }
      if (_voice) {
        try { _voice.stop(); } catch (_) {}
        _voice = null;
        _voiceVisual('off');
        return;
      }
      if (!_mp || !_mp.getSocket) return;
      const socket = _mp.getSocket();
      // Mic acquisition is async; onMicUnavailable/onError may fire before OR
      // after start() returns. Track which fired so we don't optimistically
      // paint the "transmitting" (green) state over a mic-denied/error state.
      let sawError = false, sawListenOnly = false;
      const handle = VoiceManager.start({
        socket,
        scope,
        getLocalState: () => Playground3D.getLocalState && Playground3D.getLocalState(),
        getRemotePlayers: () => Playground3D.getRemotePlayers && Playground3D.getRemotePlayers(),
        getZone: () => _zone,
        onError: (msg) => {
          sawError = true;
          _voice = null;
          _voiceVisual('error', msg);
          if (typeof toast === 'function') toast(msg || 'Voice chat couldn’t start.', 'error');
        },
        onMicUnavailable: (msg) => {
          sawListenOnly = true;
          _voiceVisual('listen-only', msg);
          if (typeof toast === 'function') {
            toast('Microphone blocked — you’re in listen-only mode (others can’t hear you).', { type: 'warn', duration: 4500 });
          }
        },
        onPeerStateChange: (peerId, st) => {
          if (Playground3D.setRemotePlayerSpeaking) {
            Playground3D.setRemotePlayerSpeaking(peerId, !!st.speaking);
          }
          // One-line snapshot on connection FAILURE so users have an
          // actionable artifact even without the debug panel open. Routine
          // teardowns (a peer left, we walked off the island, voice stopped)
          // also report connected:false — those carry a different `reason`
          // and must not raise the alarm.
          const trouble = st && st.connected === false && (st.reason === 'failed' || st.reason === 'disconnected');
          if (trouble && _voice && _voice._diag) {
            const d = _voice._diag();
            const peer = d.peers.find(p => p.id === peerId);
            if (peer) {
              console.warn('[Voice] peer disconnected:', peer.username,
                'connState=' + peer.connectionState,
                'iceState=' + peer.iceConnectionState,
                'rxBytes=' + peer.bytesReceived,
                'iceTypes=' + (peer.iceCandidateTypes || []).join(','));
            }
            // Surface the otherwise-silent failure and point at the diagnostics
            // panel (right-click / long-press the mic) — throttled so a flapping
            // peer doesn't spam toasts.
            const t = Date.now();
            if (typeof toast === 'function' && t - _peerFailToastAt > 20000) {
              _peerFailToastAt = t;
              toast('Voice is having trouble connecting — long-press the mic for diagnostics.', 'warn');
            }
          }
        }
      });
      // Synchronous fatal error (e.g. no WebRTC) already nulled _voice and
      // painted the error state — don't overwrite it. Otherwise keep the live
      // handle and show "on", unless the mic was already denied synchronously.
      if (sawError) {
        _voice = null;
      } else {
        _voice = handle;
        if (!sawListenOnly) _voiceVisual('on');
      }
    };
    _voiceBtn.addEventListener('click', _voiceBtnHandler);

    // Right-click → open the diagnostics panel.
    _voiceCtxHandler = (e) => {
      e.preventDefault();
      if (_voice && VoiceManager.openDebugPanel) {
        VoiceManager.openDebugPanel(_voice, _voiceBtn);
      }
    };
    _voiceBtn.addEventListener('contextmenu', _voiceCtxHandler);

    // Long-press on touch → open the diagnostics panel.
    _voiceTouchStart = () => {
      if (_voiceLongPressTimer) clearTimeout(_voiceLongPressTimer);
      _voiceLongPressFired = false;
      _voiceLongPressTimer = setTimeout(() => {
        _voiceLongPressTimer = null;
        _voiceLongPressFired = true;
        if (_voice && VoiceManager.openDebugPanel) {
          VoiceManager.openDebugPanel(_voice, _voiceBtn);
        }
      }, 600);
    };
    _voiceTouchEnd = () => {
      if (_voiceLongPressTimer) { clearTimeout(_voiceLongPressTimer); _voiceLongPressTimer = null; }
    };
    _voiceBtn.addEventListener('touchstart', _voiceTouchStart, { passive: true });
    _voiceBtn.addEventListener('touchend',   _voiceTouchEnd);
    _voiceBtn.addEventListener('touchmove',  _voiceTouchEnd);
    _voiceBtn.addEventListener('touchcancel', _voiceTouchEnd);
  }

  function unmount() {
    // Invalidate any in-flight async bring-up (character fetch / state.load)
    // so it can't init the engine against this torn-down view.
    _mountSeq++;
    if (_loadTimer) { clearTimeout(_loadTimer); _loadTimer = null; }
    // Voice must stop BEFORE multiplayer so voice:leave reaches the room
    // while the socket is still open.
    if (_voice) { try { _voice.stop(); } catch (_) {} _voice = null; }
    if (_voiceBtn) {
      if (_voiceBtnHandler)  _voiceBtn.removeEventListener('click', _voiceBtnHandler);
      if (_voiceCtxHandler)  _voiceBtn.removeEventListener('contextmenu', _voiceCtxHandler);
      if (_voiceTouchStart)  _voiceBtn.removeEventListener('touchstart', _voiceTouchStart);
      if (_voiceTouchEnd) {
        _voiceBtn.removeEventListener('touchend',    _voiceTouchEnd);
        _voiceBtn.removeEventListener('touchmove',   _voiceTouchEnd);
        _voiceBtn.removeEventListener('touchcancel', _voiceTouchEnd);
      }
    }
    if (_voiceLongPressTimer) { clearTimeout(_voiceLongPressTimer); _voiceLongPressTimer = null; }
    _voiceBtn = null; _voiceBtnHandler = null; _voiceCtxHandler = null;
    _voiceTouchStart = null; _voiceTouchEnd = null;
    _voiceState = 'off'; _voiceMsg = '';
    // Keeper-house teardown — the HUD button lives inside the container; the
    // editor overlay is on document.body so it needs an explicit remove.
    const houseBtn = document.getElementById('world-house-btn');
    if (houseBtn && _houseBtnHandler) houseBtn.removeEventListener('click', _houseBtnHandler);
    _houseBtnHandler = null;
    if (_houseEditorClose) { try { _houseEditorClose(); } catch (_) {} _houseEditorClose = null; }
    document.querySelector('.world-house')?.remove();
    if (_housePoll) { clearInterval(_housePoll); _housePoll = null; }
    _zone = null; _houseMe = null; _houseKeepers = {}; _houseMine = {}; _housesAt = 0;
    if (_liveTick) { clearInterval(_liveTick); _liveTick = null; }
    if (_liveInputHandler) {
      window.removeEventListener('keydown', _liveInputHandler, true);
      window.removeEventListener('pointerdown', _liveInputHandler, true);
      _liveInputHandler = null;
    }
    _liveStay = null; _liveLabel = ''; _lastInputAt = 0;
    // Stone contest teardown — engine stones die in Playground3D.destroy();
    // the chip/snap button/flash live inside the container and vanish with it.
    if (_snapKeyHandler) { window.removeEventListener('keydown', _snapKeyHandler); _snapKeyHandler = null; }
    _snapHinted = false;
    document.querySelector('.world-lb')?.remove();
    // Settle a still-open spawn picker so its awaited promise doesn't dangle.
    if (_spawnPickerResolve) { _spawnPickerResolve(); _spawnPickerResolve = null; }
    document.querySelector('.world-spawn')?.remove();
    if (_mp) { try { _mp.stop(); } catch (_) {} _mp = null; }
    Playground3D.destroy();
    _stage = null;
  }

  return { mount, unmount, title: 'World — MCU Tracker' };
})();
