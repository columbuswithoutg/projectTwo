/************************************************
 * MULTIPLAYER — shared Socket.IO client for /world and /home.
 *
 * Used by:
 *   - js/views/world.js  → /world (one global room, every signed-in user)
 *   - js/views/home.js   → /home  (one room per owner — visitors meet host)
 *   - js/views/friend-home.js → /friend/:owner/home (joins owner's room)
 *
 * Why a shared module: the two view modes have identical wire shapes —
 * presence snapshot, position broadcast, chat with bubble, wave emote —
 * differing only in event names and the join payload. Keeping one
 * implementation means a fix to chat throttling or position smoothing
 * lands in both places at once.
 *
 * Depends on globals from earlier defer-loaded scripts:
 *   - io (socket.io-client),  Auth, Playground3D, state? no — just Auth +
 *     Playground3D's addRemotePlayer / showRemoteChat / etc.
 ************************************************/
const Multiplayer = (() => {

  // Event-name maps. Keep these in sync with routes/world-socket.js.
  const WORLD_EVENTS = {
    join:     'world:join',
    pos:      'world:pos',
    chat:     'world:chat',
    emote:    'world:emote',
    snapshot: 'world:snapshot',
    joined:   'world:joined',
    left:     'world:left',
    leave:    null              // /world auto-cleans on disconnect; no explicit leave
  };
  const HOME_EVENTS = {
    join:     'home:join',
    pos:      'home:pos',
    chat:     'home:chat',
    emote:    'home:emote',
    snapshot: 'home:snapshot',
    joined:   'home:joined',
    left:     'home:left',
    leave:    'home:leave'      // emitted before disconnect so the room's owner gets prompt notice
  };

  const POS_INTERVAL_MS = 100;
  const POS_EPSILON = 0.05;
  const YAW_EPSILON = 0.02;
  const CHAT_LOG_MAX = 20;

  // ── start ──
  //
  // Options:
  //   events      { join, pos, chat, emote, snapshot, joined, left, leave }
  //   joinPayload extra fields merged with { username, character } on join.
  //               For home, this is { ownerUsername }.
  //   character   the local player's saved homeCharacter (or default).
  //
  // Returns { stop } — call stop() in the view's unmount(), BEFORE
  // Playground3D.destroy(), so the leave event reaches the room while
  // the socket is still open.
  function start({ events, joinPayload, character }) {
    if (typeof io !== 'function') {
      console.warn('[Multiplayer] socket.io client not loaded');
      return { stop() {} };
    }

    const socket = io({ auth: { token: Auth.getToken() } });
    let posTimer = null;
    let lastPosSent = { x: 0, y: 0, z: 0, yaw: 0, walking: false };
    let chatLog = [];

    function appendChatLog(username, text) {
      chatLog.push({ username, text });
      if (chatLog.length > CHAT_LOG_MAX) chatLog.shift();
      renderChatLog();
    }
    function renderChatLog() {
      const el = document.getElementById('world-chat-log');
      if (!el) return;
      const esc = (s) => String(s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      el.innerHTML = chatLog.map(m =>
        `<div class="world-chat-line"><span class="world-chat-name">${esc(m.username)}</span>${esc(m.text)}</div>`
      ).join('');
      el.scrollTop = el.scrollHeight;
    }

    socket.on('connect', () => {
      socket.emit(events.join, {
        username: Auth.getUsername() || 'Anon',
        character,
        ...(joinPayload || {})
      });
    });

    socket.on(events.snapshot, ({ players }) => {
      for (const p of (players || [])) {
        Playground3D.addRemotePlayer(p.socketId, p.character, p.username, p.x, p.z, p.yaw, p.y);
      }
    });
    socket.on(events.joined, (p) => {
      Playground3D.addRemotePlayer(p.socketId, p.character, p.username, p.x, p.z, p.yaw, p.y);
    });
    socket.on(events.pos, (p) => {
      Playground3D.updateRemotePlayer(p.id, p.x, p.z, p.yaw, p.walking, p.y);
    });
    socket.on(events.left, ({ id }) => {
      Playground3D.removeRemotePlayer(id);
    });
    socket.on(events.chat, ({ id, username, text }) => {
      Playground3D.showRemoteChat(id, username, text);
      appendChatLog(username, text);
    });
    socket.on(events.emote, ({ id, kind }) => {
      Playground3D.playRemoteEmote(id, kind);
    });

    socket.on('connect_error', (err) => {
      console.warn('[Multiplayer] connect_error', err && err.message);
    });

    // Chat input — same DOM ids as /world's HTML (.world-chat-row).
    const input = document.getElementById('world-chat-input');
    const onChatKey = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const text = input.value.trim();
        input.value = '';
        if (text && socket.connected) socket.emit(events.chat, { text });
      } else if (e.key === 'Escape') {
        input.value = '';
        input.blur();
      }
    };
    if (input) input.addEventListener('keydown', onChatKey);

    // Emote button.
    const emoteBtn = document.getElementById('world-emote-btn');
    const onEmoteClick = () => {
      if (socket.connected) socket.emit(events.emote, { kind: 'wave' });
      Playground3D.playLocalEmote('wave');
    };
    if (emoteBtn) emoteBtn.addEventListener('click', onEmoteClick);

    // Throttled position broadcast — only emit when state moved by
    // epsilon, identical to the old inline /world implementation.
    posTimer = setInterval(() => {
      const s = Playground3D.getLocalState && Playground3D.getLocalState();
      if (!s || !socket.connected) return;
      const dx = Math.abs(s.x - lastPosSent.x);
      const dz = Math.abs(s.z - lastPosSent.z);
      const dy = Math.abs((s.y || 0) - (lastPosSent.y || 0));
      const dyaw = Math.abs(((s.yaw - lastPosSent.yaw) + Math.PI) % (2 * Math.PI) - Math.PI);
      if (dx < POS_EPSILON && dz < POS_EPSILON && dy < POS_EPSILON && dyaw < YAW_EPSILON && s.walking === lastPosSent.walking) return;
      lastPosSent = { x: s.x, y: s.y || 0, z: s.z, yaw: s.yaw, walking: s.walking };
      socket.emit(events.pos, lastPosSent);
    }, POS_INTERVAL_MS);

    function stop() {
      if (posTimer) { clearInterval(posTimer); posTimer = null; }
      if (input) input.removeEventListener('keydown', onChatKey);
      if (emoteBtn) emoteBtn.removeEventListener('click', onEmoteClick);
      if (socket) {
        if (events.leave && socket.connected) {
          try { socket.emit(events.leave); } catch (_) {}
        }
        try { socket.disconnect(); } catch (_) {}
      }
      chatLog = [];
    }

    return { stop, getSocket: () => socket };
  }

  return { start, WORLD_EVENTS, HOME_EVENTS };
})();
