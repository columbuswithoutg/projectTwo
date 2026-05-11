/************************************************
 * WORLD VIEW — /world
 *
 * Walkable 3D recreation of the universe map. Player IS the walker.
 * Locked projects (prereqs not met) aren't rendered. Mounting walks the
 * character at the first unlocked node (Iron Man for fresh accounts).
 *
 * Multiplayer: opens a Socket.IO connection on mount, joins the global
 * 'world' room, broadcasts position ~10Hz, relays chat / emote / remote
 * presence via Playground3D's world-mode API.
 ************************************************/
const WorldView = (() => {

  let _stage = null;
  let _socket = null;
  let _posTimer = null;
  let _lastPosSent = { x: 0, z: 0, yaw: 0, walking: false };
  let _onKeyDown = null;
  let _onKeyUp = null;

  const POS_INTERVAL_MS = 100;
  const POS_EPSILON = 0.05;
  const YAW_EPSILON = 0.02;

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
        <input class="pg3d-chat" id="world-chat-input" placeholder="Say something…" maxlength="200" autocomplete="off" />
        <button class="pg3d-emote" id="world-emote-btn" type="button" aria-label="Wave">👋</button>
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

    Playground3D.initWorld(_stage, character || Playground3D.defaultCharacter());

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

    // Chat input wiring.
    const input = document.getElementById('world-chat-input');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const text = input.value.trim();
          input.value = '';
          if (text && _socket) _socket.emit('world:chat', { text });
        } else if (e.key === 'Escape') {
          input.value = '';
          input.blur();
        }
      });
    }

    // Emote button.
    const emoteBtn = document.getElementById('world-emote-btn');
    if (emoteBtn) {
      emoteBtn.addEventListener('click', () => {
        if (_socket) _socket.emit('world:emote', { kind: 'wave' });
        Playground3D.playLocalEmote('wave');
      });
    }

    _connectSocket(character || Playground3D.defaultCharacter());
  }

  function _connectSocket(character) {
    if (typeof io !== 'function') {
      console.warn('[WorldView] socket.io client not loaded');
      return;
    }
    _socket = io({ auth: { token: Auth.getToken() } });

    _socket.on('connect', () => {
      _socket.emit('world:join', {
        username: Auth.getUsername() || 'Anon',
        character
      });
    });

    _socket.on('world:snapshot', ({ players }) => {
      for (const p of (players || [])) {
        Playground3D.addRemotePlayer(p.socketId, p.character, p.username, p.x, p.z, p.yaw);
      }
    });
    _socket.on('world:joined', (p) => {
      Playground3D.addRemotePlayer(p.socketId, p.character, p.username, p.x, p.z, p.yaw);
    });
    _socket.on('world:pos', (p) => {
      Playground3D.updateRemotePlayer(p.id, p.x, p.z, p.yaw, p.walking);
    });
    _socket.on('world:left', ({ id }) => {
      Playground3D.removeRemotePlayer(id);
    });
    _socket.on('world:chat', ({ id, username, text }) => {
      // Server broadcasts to everyone including the sender. The local
      // player's bubble is also rendered through this code path so the
      // bubble lifetime / styling is consistent with remote bubbles.
      Playground3D.showRemoteChat(id, username, text);
    });
    _socket.on('world:emote', ({ id, kind }) => {
      Playground3D.playRemoteEmote(id, kind);
    });

    _socket.on('connect_error', (err) => {
      console.warn('[WorldView] socket connect_error', err.message);
    });

    // Throttled position broadcast — only emit when state moved by epsilon.
    _posTimer = setInterval(() => {
      const s = Playground3D.getLocalState && Playground3D.getLocalState();
      if (!s || !_socket || !_socket.connected) return;
      const dx = Math.abs(s.x - _lastPosSent.x);
      const dz = Math.abs(s.z - _lastPosSent.z);
      const dyaw = Math.abs(((s.yaw - _lastPosSent.yaw) + Math.PI) % (2 * Math.PI) - Math.PI);
      if (dx < POS_EPSILON && dz < POS_EPSILON && dyaw < YAW_EPSILON && s.walking === _lastPosSent.walking) return;
      _lastPosSent = { x: s.x, z: s.z, yaw: s.yaw, walking: s.walking };
      _socket.emit('world:pos', _lastPosSent);
    }, POS_INTERVAL_MS);
  }

  function _isTextField(el) {
    if (!el) return false;
    const t = el.tagName;
    return t === 'INPUT' || t === 'TEXTAREA' || el.isContentEditable;
  }

  function unmount() {
    if (_onKeyDown) { window.removeEventListener('keydown', _onKeyDown); _onKeyDown = null; }
    if (_posTimer) { clearInterval(_posTimer); _posTimer = null; }
    if (_socket) { try { _socket.disconnect(); } catch (_) {} _socket = null; }
    Playground3D.destroy();
    _stage = null;
    _lastPosSent = { x: 0, z: 0, yaw: 0, walking: false };
  }

  return { mount, unmount, title: 'World — MCU Tracker' };
})();
