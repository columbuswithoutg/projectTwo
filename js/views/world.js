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
    _voiceBtnHandler = () => {
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
        onPeerStateChange: (peerId, st) => {
          if (Playground3D.setRemotePlayerSpeaking) {
            Playground3D.setRemotePlayerSpeaking(peerId, !!st.speaking);
          }
        }
      });
      _voiceBtn.setAttribute('aria-pressed', 'true');
      _voiceBtn.title = 'Voice chat (on) — click to mute';
    };
    _voiceBtn.addEventListener('click', _voiceBtnHandler);
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
    if (_voiceBtn && _voiceBtnHandler) {
      _voiceBtn.removeEventListener('click', _voiceBtnHandler);
    }
    _voiceBtn = null; _voiceBtnHandler = null;
    if (_mp) { try { _mp.stop(); } catch (_) {} _mp = null; }
    Playground3D.destroy();
    _stage = null;
  }

  return { mount, unmount, title: 'World — MCU Tracker' };
})();
