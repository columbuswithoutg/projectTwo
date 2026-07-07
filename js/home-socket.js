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
    punch:    'world:punch',
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
    punch:    null,             // punching stays local in homes (no relay)
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

    // `joined` distinguishes the FIRST connect from automatic reconnects.
    // Socket.IO assigns a fresh socket.id on reconnect and the server resends
    // a full snapshot, so we drop the stale remote rigs first — otherwise
    // addRemotePlayer early-returns on the old ids and peers freeze in place.
    let joined = false;
    let errToasted = false;       // throttle connect_error toasts to once per outage
    socket.on('connect', () => {
      if (joined) {
        if (Playground3D.clearRemotePlayers) Playground3D.clearRemotePlayers();
        if (typeof toast === 'function') toast('Reconnected', 'success');
      }
      joined = true;
      errToasted = false;
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

    // Punch relay (world only — events.punch is null for homes). Every
    // local punch is broadcast so peers see the swing; a hit also carries
    // the victim's socket id.
    if (events.punch) {
      if (Playground3D.setPunchHandler) {
        Playground3D.setPunchHandler(({ target }) => {
          if (socket.connected) socket.emit(events.punch, { target: target || null });
        });
      }
      socket.on(events.punch, ({ id, target }) => {
        if (Playground3D.playRemotePunch) Playground3D.playRemotePunch(id);
        if (!target) return;
        if (target === socket.id) {
          if (Playground3D.knockdownLocal) Playground3D.knockdownLocal();
        } else if (Playground3D.knockdownRemote) {
          Playground3D.knockdownRemote(target);
        }
      });
    }

    // Surface a lost connection so the world doesn't silently look empty /
    // single-player. 'io client disconnect' is our own stop()/navigation —
    // not an error, so stay quiet for it.
    socket.on('disconnect', (reason) => {
      if (reason === 'io client disconnect') return;
      if (typeof toast === 'function') toast('Connection lost — reconnecting…', 'warn');
    });

    socket.on('connect_error', (err) => {
      console.warn('[Multiplayer] connect_error', err && err.message);
      // Toast once per outage. A handshake rejection ('Invalid token',
      // 'Account suspended') won't auto-recover, so the user needs to know.
      if (!errToasted && typeof toast === 'function') {
        errToasted = true;
        const m = err && err.message;
        toast(
          (m === 'Account suspended') ? 'Your account has been suspended.'
          : (m === 'Invalid token') ? 'Session expired — please log in again.'
          : 'Can’t reach the world server.',
          'error'
        );
      }
    });

    // Chat input — same DOM ids as /world's HTML (.world-chat-row).
    const input = document.getElementById('world-chat-input');
    const onChatKey = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) { input.value = ''; return; }
        // Only clear the input once the message is actually on its way —
        // clearing before the connected check silently ate text typed while
        // disconnected.
        if (socket.connected) {
          socket.emit(events.chat, { text });
          input.value = '';
          // Mirror our own message as an in-world bubble over the local rig —
          // the server echo only renders bubbles for REMOTE ids, so without
          // this the sender never sees the bubble everyone else sees.
          if (Playground3D.showLocalChat) Playground3D.showLocalChat(text);
        } else if (typeof toast === 'function') {
          toast('Not connected — message not sent.', 'warn');
        }
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
      // Detach the punch → socket bridge so a stale closure can't emit on
      // a dead socket after unmount.
      if (events.punch && Playground3D.setPunchHandler) Playground3D.setPunchHandler(null);
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
