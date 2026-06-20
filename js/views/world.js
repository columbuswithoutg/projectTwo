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
  let _onKeyDown = null;
  let _mp = null;
  let _voice = null;
  let _voiceBtn = null;
  let _voiceBtnHandler = null;
  let _voiceCtxHandler = null;
  let _voiceTouchStart = null;
  let _voiceTouchEnd = null;
  let _voiceLongPressTimer = null;
  let _voiceLongPressFired = false;

  function mount(container) {
    if (!Auth.isLoggedIn()) {
      Router.go('/login');
      return;
    }

    container.innerHTML = `
      <header class="world-header">
        <button id="world-back" type="button" title="Back">← Back</button>
        <h1 class="world-title">World</h1>
        <div class="world-header-spacer"></div>
      </header>
      <div id="pg-stage" class="pg-stage"></div>
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

    // Load the player's character; if missing (never built), use default.
    _loadCharacterThenStart();
  }

  async function _loadCharacterThenStart() {
    let character = null;
    try {
      const res = await fetch(`${API}/profile/home-character`, {
        headers: { Authorization: `Bearer ${Auth.getToken()}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.homeCharacter && data.homeCharacter.skin != null) character = data.homeCharacter;
      }
    } catch (_) { /* offline / network blip — fall through with defaults */ }

    // Make sure WatchState is populated so isUnlocked checks use this
    // user's progress, not stale or empty defaults.
    if (typeof state !== 'undefined' && state.data && state.data.size === 0) {
      try { await state.load(); } catch (_) {}
    }
    if (typeof projects !== 'undefined' && typeof state !== 'undefined' && state.initProjects) {
      state.initProjects(projects);
    }

    if (!character) character = Playground3D.defaultCharacter();
    Playground3D.initWorld(_stage, character);

    // Avenger NPCs — each preset model roams the apron around its debut node.
    // Map preset → roster character (via charId) to resolve the debut project;
    // Playground3D spawns each hero once its debut node is unlocked.
    if (Playground3D.setWorldNpcs && typeof Playground !== 'undefined' && Array.isArray(Playground.CHARACTER_PRESETS)) {
      const roster = (typeof window.characters !== 'undefined' && window.characters) || [];
      const npcSpecs = Playground.CHARACTER_PRESETS.map(p => {
        const c = roster.find(x => x.id === p.charId);
        return (c && c.debut) ? { id: 'npc_' + p.id, name: p.name, character: p.char, debut: c.debut } : null;
      }).filter(Boolean);
      Playground3D.setWorldNpcs(npcSpecs);
    }

    // Clicking a node prompt opens the same popup the watch order uses.
    Playground3D.setProjectClickHandler((project) => {
      if (typeof showPopup === 'function') showPopup(project);
    });

    // Keyboard: E activates the nearest node's prompt.
    _onKeyDown = (e) => {
      if (_isTextField(document.activeElement)) return;
      if (e.key === 'e' || e.key === 'E') {
        const node = Playground3D.getActiveNode && Playground3D.getActiveNode();
        if (node && typeof showPopup === 'function') {
          showPopup(node);
        }
      }
    };
    window.addEventListener('keydown', _onKeyDown);

    if (typeof Multiplayer !== 'undefined' && Multiplayer.start) {
      _mp = Multiplayer.start({
        events: Multiplayer.WORLD_EVENTS,
        joinPayload: {},
        character
      });
    }

    _wireVoiceToggle('world');
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
        _voiceBtn.setAttribute('aria-pressed', 'false');
        _voiceBtn.title = 'Voice chat (off)';
        return;
      }
      if (!_mp || !_mp.getSocket) return;
      const socket = _mp.getSocket();
      _voice = VoiceManager.start({
        socket,
        scope,
        getLocalState: () => Playground3D.getLocalState && Playground3D.getLocalState(),
        getRemotePlayers: () => Playground3D.getRemotePlayers && Playground3D.getRemotePlayers(),
        onError: (msg) => {
          _voiceBtn.setAttribute('aria-pressed', 'false');
          _voiceBtn.title = msg || 'Voice chat error';
          _voice = null;
        },
        onMicUnavailable: (msg) => {
          _voiceBtn.title = msg || 'Voice chat (listen-only)';
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
          }
        }
      });
      _voiceBtn.setAttribute('aria-pressed', 'true');
      _voiceBtn.title = 'Voice chat (on) — click to mute, right-click for diagnostics';
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

  function _isTextField(el) {
    if (!el) return false;
    const t = el.tagName;
    return t === 'INPUT' || t === 'TEXTAREA' || el.isContentEditable;
  }

  function unmount() {
    if (_onKeyDown) { window.removeEventListener('keydown', _onKeyDown); _onKeyDown = null; }
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
    if (_mp) { try { _mp.stop(); } catch (_) {} _mp = null; }
    Playground3D.destroy();
    _stage = null;
  }

  return { mount, unmount, title: 'World — MCU Tracker' };
})();
