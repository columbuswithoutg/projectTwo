/************************************************
 * WORLD VIEW — /world
 *
 * Walkable 3D recreation of the universe map. Player IS the walker.
 * Locked projects (prereqs not met) aren't rendered. Mounting walks the
 * character at the first unlocked node (Iron Man for fresh accounts).
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
      <div class="world-chat-row">
        <div class="world-chat-log" id="world-chat-log" aria-live="polite"></div>
        <div class="world-chat-inputrow">
          <input class="pg3d-chat" id="world-chat-input" placeholder="Say something…" maxlength="200" autocomplete="off" />
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
    // Spawn picker: when the unlocked nodes form more than one disconnected
    // island (e.g. a fresh user's Iron Man / Guardians / Doctor Strange all
    // stand alone), let the player choose which one to start on — otherwise
    // they'd always land on Iron Man with no way to walk to the others.
    let chosenSpawnId = null;
    const islands = _spawnIslands();
    if (islands.length > 1) {
      chosenSpawnId = await _openSpawnPicker(islands, 'enter');
      if (myMount !== _mountSeq) return;   // unmounted while the picker was open
    }
    Playground3D.initWorld(_stage, character, chosenSpawnId);

    // Avenger NPCs — each preset model roams the apron around its debut node.
    // Map preset → roster character (via charId) to resolve the debut project;
    // Playground3D spawns each hero once its debut node is unlocked.
    if (Playground3D.setWorldNpcs && typeof Playground !== 'undefined' && Array.isArray(Playground.CHARACTER_PRESETS)) {
      const roster = (typeof window.characters !== 'undefined' && window.characters) || [];
      const unresolved = [];
      const npcSpecs = Playground.CHARACTER_PRESETS.map(p => {
        const c = roster.find(x => x.id === p.charId);
        if (!c || !c.debut) { unresolved.push(p.charId); return null; }
        return { id: 'npc_' + p.id, name: p.name, character: p.char, debut: c.debut };
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
        onSnapped: stonesOn ? _onSnapped : undefined
      });
    }

    _wireVoiceToggle('world');
    _maybeShowControlsHint();
    if (stonesOn) _initStones();
  }

  // Resolve the global feature flags. boot.js stashes them on window.APP_FLAGS
  // after its /config/public fetch; if a deep-link to /world beat that fetch,
  // fetch once ourselves so the event's on/off state is always correct.
  async function _ensureFlags() {
    if (window.APP_FLAGS) return window.APP_FLAGS;
    try {
      const res = await fetch(`${API}/config/public`);
      if (res.ok) { const cfg = await res.json(); if (cfg && cfg.flags) window.APP_FLAGS = cfg.flags; }
    } catch (_) { /* offline — treat as defaults (event off) */ }
    return window.APP_FLAGS || {};
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

  /* ── Spawn picker (disconnected islands) ── */

  // Group the unlocked nodes into disconnected "islands". Mirrors the engine's
  // _isProjectUnlocked (watched OR a start node with no prerequisites). Returns
  // [] when the data isn't ready; length > 1 means the world is disconnected.
  function _spawnIslands() {
    if (typeof PG3DPhysics === 'undefined' || !PG3DPhysics.spawnIslands) return [];
    if (typeof projects === 'undefined' || !Array.isArray(projects)) return [];
    const isUnlocked = (p) =>
      (typeof state !== 'undefined' && state.isWatched && state.isWatched(p.id)) ||
      !(p.prerequisites && p.prerequisites.length);
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
        : 'Your unlocked locations aren’t all connected by road — pick where to start.';

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

    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const hint = document.createElement('div');
    hint.className = 'world-hint';
    hint.innerHTML = coarse
      ? `<span class="world-hint-icon">🕹️</span> Drag the joystick to move · ⤒ to jump · 👊 to punch`
      : `<span class="world-hint-icon">⌨️</span> <b>WASD</b> to move · <b>Space</b> to jump · <b>F</b> to punch · drag to look`;
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
    _voiceBtn.classList.remove('listen-only', 'voice-error');
    switch (stateName) {
      case 'on':
        _voiceBtn.setAttribute('aria-pressed', 'true');
        _voiceBtn.setAttribute('aria-label', 'Voice on — others can hear you. Click to mute; right-click or long-press for diagnostics.');
        _voiceBtn.title = 'Voice on — click to mute · right-click for diagnostics';
        _voiceBtn.textContent = '🎙️';
        break;
      case 'listen-only':
        _voiceBtn.setAttribute('aria-pressed', 'true');
        _voiceBtn.classList.add('listen-only');
        _voiceBtn.setAttribute('aria-label', 'Listen-only — mic blocked, others can’t hear you. Right-click or long-press for diagnostics.');
        _voiceBtn.title = msg || 'Listen-only — mic blocked · right-click for diagnostics';
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
          // One-line snapshot on connection failure so users have an
          // actionable artifact even without the debug panel open.
          if (st && st.connected === false && _voice && _voice._diag) {
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
