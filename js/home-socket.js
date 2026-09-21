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
    join:        'world:join',
    pos:         'world:pos',
    chat:        'world:chat',
    emote:       'world:emote',
    punch:       'world:punch',
    stones:      'world:stones',        // full holder snapshot
    stoneUpdate: 'world:stone-update',  // single stone ownership change
    stoneGrab:   'world:stone-grab',    // client claims a free stone (→ server)
    snap:        'world:snap',          // client requests a snap (→ server)
    snapped:     'world:snapped',       // server: a snap happened
    npcs:        'world:npcs',          // server: hero HP / KO / aggro snapshot on join
    npcUpdate:   'world:npc-update',    // server: one hero's state changed (hit / ko / getup / heal / …)
    npcPunch:    'world:npc-punch',     // both ways: a hero swings at its target
    snapshot:    'world:snapshot',
    joined:      'world:joined',
    left:        'world:left',
    leave:       null,             // /world auto-cleans on disconnect; no explicit leave
    zone:        'world:zone',     // server: the project island we're standing on changed
    channels:    true              // World / Project / Whisper chat tabs + 10s cooldown
  };
  const HOME_EVENTS = {
    join:        'home:join',
    pos:         'home:pos',
    chat:        'home:chat',
    emote:       'home:emote',
    punch:       null,             // punching stays local in homes (no relay)
    stones:      null,             // stones are a /world-only contest
    stoneUpdate: null,
    stoneGrab:   null,
    snap:        null,
    snapped:     null,
    npcs:        null,             // no hero NPCs in homes
    npcUpdate:   null,
    npcPunch:    null,
    snapshot:    'home:snapshot',
    joined:      'home:joined',
    left:        'home:left',
    leave:       'home:leave',     // emitted before disconnect so the room's owner gets prompt notice
    zone:        null,             // homes have one shared chat — no channels
    channels:    false
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
  function start({ events, joinPayload, character, onStoneChange, onSnapped }) {
    if (typeof io !== 'function') {
      console.warn('[Multiplayer] socket.io client not loaded');
      return { stop() {}, getSocket: () => null, sendSnap() {} };
    }

    const socket = io({ auth: { token: Auth.getToken() } });
    let posTimer = null;
    let lastPosSent = { x: 0, y: 0, z: 0, yaw: 0, walking: false, backward: false };
    let chatLog = [];

    const esc = (s) => String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function appendChatLog(username, text) {
      chatLog.push({ username, text });
      if (chatLog.length > CHAT_LOG_MAX) chatLog.shift();
      renderChatLog();
    }
    function renderChatLog() {
      const el = document.getElementById('world-chat-log');
      if (!el) return;
      if (events.channels) { renderChannelLog(el); return; }
      el.innerHTML = chatLog.map(m =>
        `<div class="world-chat-line"><span class="world-chat-name">${esc(m.username)}</span>${esc(m.text)}</div>`
      ).join('');
      el.scrollTop = el.scrollHeight;
    }

    // ── Chat channels (/world only: events.channels) ──
    // One log per tab; only the active one renders. The server decides who
    // receives what — these logs just file each incoming line by channel.
    const ChatL = (typeof WorldChatLogic !== 'undefined') ? WorldChatLogic : null;
    const TAB_KEY = 'world_chat_tab';
    const chan = {
      logs: { world: [], project: [], whisper: [] },
      unread: { world: false, project: false, whisper: false },
      active: 'world',
      projectId: null,
      whisperTo: '',
      cooldownUntil: 0,
      cooldownTimer: null,
      sending: false
    };
    try {
      const saved = localStorage.getItem(TAB_KEY);
      if (saved === 'world' || saved === 'project' || saved === 'whisper') chan.active = saved;
    } catch (_) {}

    function renderChannelLog(el) {
      const myId = socket.id;
      el.innerHTML = chan.logs[chan.active].map((m) => {
        if (m.channel === 'whisper') {
          const mine = m.id === myId;
          const other = mine ? m.to : m.username;
          const label = mine ? `→ ${esc(m.to)}` : `${esc(m.username)} →`;
          return `<div class="world-chat-line whisper"><button type="button" class="world-chat-name" data-whisper="${esc(other)}" title="Whisper ${esc(other)}">${label}</button>${esc(m.text)}</div>`;
        }
        const nameAttr = m.id === myId ? '' : ` data-whisper="${esc(m.username)}" title="Whisper ${esc(m.username)}"`;
        return `<div class="world-chat-line ${m.channel}"><button type="button" class="world-chat-name"${nameAttr}>${esc(m.username)}</button>${esc(m.text)}</div>`;
      }).join('');
      el.scrollTop = el.scrollHeight;
    }

    function projectTitle(id) {
      if (!id) return '';
      const p = (typeof projects !== 'undefined' && Array.isArray(projects)) ? projects.find(q => q.id === id) : null;
      return (p && p.title) || id;
    }

    function placeholderFor(tab) {
      if (tab === 'project') return chan.projectId ? `Say something to ${projectTitle(chan.projectId)}…` : 'Walk onto a project island to chat here';
      if (tab === 'whisper') return chan.whisperTo ? `Whisper to ${chan.whisperTo}…` : 'Pick a player, or type /w name message';
      return 'Say something to everyone…';
    }

    function renderTabs() {
      document.querySelectorAll('.world-chat-tab').forEach((btn) => {
        const tab = btn.getAttribute('data-channel');
        const on = tab === chan.active;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
        btn.classList.toggle('unread', !on && chan.unread[tab]);
      });
      const label = document.getElementById('world-chat-project-label');
      if (label) {
        label.textContent = chan.projectId ? projectTitle(chan.projectId) : 'Project';
        label.parentElement.classList.toggle('off-island', !chan.projectId);
        label.parentElement.title = chan.projectId ? `Chat with players on ${projectTitle(chan.projectId)}` : 'Not on a project island';
      }
      const row = document.querySelector('.world-chat-row');
      if (row) row.setAttribute('data-channel', chan.active);
      if (input) input.placeholder = placeholderFor(chan.active);
    }

    function setTab(tab) {
      if (!chan.logs[tab]) return;
      chan.active = tab;
      chan.unread[tab] = false;
      try { localStorage.setItem(TAB_KEY, tab); } catch (_) {}
      if (tab === 'whisper') refreshWhisperPicker();
      renderTabs();
      renderCooldown();
      renderChatLog();
    }

    function refreshWhisperPicker() {
      const sel = document.getElementById('world-whisper-to');
      if (!sel) return;
      const names = new Set();
      const players = (Playground3D.getRemotePlayers && Playground3D.getRemotePlayers()) || [];
      for (const p of players) if (p.username) names.add(p.username);
      if (chan.whisperTo) names.add(chan.whisperTo);
      const sorted = [...names].sort((a, b) => a.localeCompare(b));
      sel.innerHTML = `<option value="">${sorted.length ? 'Whisper to…' : 'No one else here'}</option>` +
        sorted.map(n => `<option value="${esc(n)}"${n === chan.whisperTo ? ' selected' : ''}>${esc(n)}</option>`).join('');
    }

    function setWhisperTarget(name) {
      chan.whisperTo = name || '';
      refreshWhisperPicker();
      renderTabs();
    }

    function fileChannelLine(msg) {
      const channel = (msg && ChatL && ChatL.CHANNELS.includes(msg.channel)) ? msg.channel : 'world';
      const log = chan.logs[channel];
      log.push({ ...msg, channel });
      if (log.length > CHAT_LOG_MAX) log.shift();
      // First whisper someone sends us → pre-pick them so replying is one tap.
      if (channel === 'whisper' && msg.id !== socket.id && !chan.whisperTo) setWhisperTarget(msg.username);
      if (channel !== chan.active) { chan.unread[channel] = true; renderTabs(); }
      else renderChatLog();
    }

    // The cooldown is World-only, so the countdown and the locked Send button
    // only show on the World tab — Project / Whisper stay sendable meanwhile.
    function renderCooldown() {
      const left = Math.max(0, chan.cooldownUntil - Date.now());
      const shown = (ChatL ? ChatL.hasCooldown(chan.active) : true) && left > 0;
      const el = document.getElementById('world-chat-cooldown');
      const sendBtn = document.getElementById('world-chat-send');
      const row = document.querySelector('.world-chat-row');
      if (el) {
        el.hidden = !shown;
        el.textContent = shown ? `You can chat in World again in ${Math.ceil(left / 1000)}s` : '';
      }
      if (sendBtn) sendBtn.disabled = shown || chan.sending;
      if (row) row.classList.toggle('cooling', shown);
      if (left <= 0 && chan.cooldownTimer) { clearInterval(chan.cooldownTimer); chan.cooldownTimer = null; }
    }

    function startCooldown(ms) {
      chan.cooldownUntil = Date.now() + ms;
      if (!chan.cooldownTimer) chan.cooldownTimer = setInterval(renderCooldown, 250);
      renderCooldown();
    }

    function nudgeCooldown() {
      const el = document.getElementById('world-chat-cooldown');
      if (!el) return;
      el.classList.remove('nudge');
      void el.offsetWidth;          // restart the animation
      el.classList.add('nudge');
    }

    const chatWarn = (msg) => { if (typeof toast === 'function') toast(msg, 'warn'); };

    // Send whatever's in the box on the active tab (or as a whisper when it
    // starts with /w). The box only clears once the server acks the message.
    function sendChannelChat() {
      if (!input || chan.sending) return;
      let text = input.value.trim();
      if (!text) { input.value = ''; syncInputState(); return; }
      let channel = chan.active;
      let to = null;
      const cmd = ChatL && ChatL.parseWhisperCommand(text);
      if (cmd) {
        channel = 'whisper'; to = cmd.to; text = cmd.text;
      } else if (/^\/(w|whisper|msg)\b/i.test(text)) {
        chatWarn('To whisper, type /w name message');
        return;
      } else if (channel === 'whisper') {
        to = chan.whisperTo;
        if (!to) { chatWarn(ChatL.errorText('no-target')); return; }
      } else if (channel === 'project' && !chan.projectId) {
        chatWarn(ChatL.errorText('no-project'));
        return;
      }
      const left = chan.cooldownUntil - Date.now();
      if (ChatL.hasCooldown(channel) && left > 0) { nudgeCooldown(); return; }
      if (!socket.connected) { chatWarn('Not connected — message not sent.'); return; }

      chan.sending = true;
      renderCooldown();
      let settled = false;
      const guard = setTimeout(() => done({ ok: false, error: 'timeout' }), 6000);
      function done(res) {
        if (settled) return;
        settled = true;
        clearTimeout(guard);
        chan.sending = false;
        if (res && res.ok) {
          input.value = '';
          syncInputState();
          if (cmd) { setWhisperTarget(cmd.to); setTab('whisper'); }
          // Whispers are private — no speech bubble over our head.
          if (channel !== 'whisper' && Playground3D.showLocalChat) Playground3D.showLocalChat(text);
          if (ChatL.hasCooldown(channel)) startCooldown(res.cooldownMs || ChatL.C.COOLDOWN_MS);
          else renderCooldown();
          return;
        }
        if (res && res.error === 'cooldown') {
          startCooldown(res.retryInMs || 0);
          nudgeCooldown();
          return;
        }
        renderCooldown();
        chatWarn(res && res.error === 'timeout' ? 'Message not sent — the server didn’t answer.' : ChatL.errorText(res && res.error, res));
      }
      socket.emit(events.chat, { channel, text, to }, done);
    }

    function syncInputState() {
      const row = document.querySelector('.world-chat-inputrow');
      if (row && input) row.classList.toggle('has-text', input.value.length > 0);
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
        // Our old socket id is gone, so any hero that was angry at it has been
        // released server-side; drop the local fight state before the fresh
        // world:npcs snapshot lands.
        if (events.npcs && Playground3D.resetNpcCombat) Playground3D.resetNpcCombat();
        if (typeof toast === 'function') toast('Reconnected', 'success');
      }
      joined = true;
      errToasted = false;
      if (events.zone) {
        // A fresh socket starts with no island server-side; force the next
        // position tick to go out (even standing still) so the server
        // re-derives our zone and the Project tab comes back.
        chan.projectId = null;
        lastPosSent = { x: NaN, y: 0, z: NaN, yaw: 0, walking: false, backward: false };
        renderTabs();
      }
      // Tell the engine our (possibly new-on-reconnect) socket id so it can
      // tell "held by me" from "held by a remote" for the shared stones, and
      // "the hero is angry at ME" for NPC fights.
      if ((events.stones || events.punch) && Playground3D.setLocalId) Playground3D.setLocalId(socket.id);
      socket.emit(events.join, {
        username: Auth.getUsername() || 'Anon',
        character,
        ...(joinPayload || {})
      });
    });

    socket.on(events.snapshot, ({ players, serverTime }) => {
      // Adopt the server's clock. Local NPCs are simulated from it so every
      // client puts the same hero in the same place; without this they'd drift
      // apart by however far the two devices' clocks disagree.
      if (typeof serverTime === 'number' && Playground3D.setWorldClockOffset) {
        Playground3D.setWorldClockOffset(serverTime - Date.now());
      }
      for (const p of (players || [])) {
        Playground3D.addRemotePlayer(p.socketId, p.character, p.username, p.x, p.z, p.yaw, p.y);
      }
    });
    socket.on(events.joined, (p) => {
      Playground3D.addRemotePlayer(p.socketId, p.character, p.username, p.x, p.z, p.yaw, p.y);
      if (events.channels && chan.active === 'whisper') refreshWhisperPicker();
    });
    socket.on(events.pos, (p) => {
      Playground3D.updateRemotePlayer(p.id, p.x, p.z, p.yaw, p.walking, p.y, p.backward);
    });
    socket.on(events.left, ({ id }) => {
      Playground3D.removeRemotePlayer(id);
      if (events.channels && chan.active === 'whisper') refreshWhisperPicker();
    });
    socket.on(events.chat, (msg) => {
      const { id, username, text } = msg || {};
      if (events.channels) {
        // Whispers stay private: log only, no bubble over the sender's head.
        if (msg.channel !== 'whisper') Playground3D.showRemoteChat(id, username, text);
        fileChannelLine(msg);
        return;
      }
      Playground3D.showRemoteChat(id, username, text);
      appendChatLog(username, text);
    });
    if (events.zone) {
      socket.on(events.zone, ({ projectId }) => {
        chan.projectId = projectId || null;
        renderTabs();
      });
    }
    socket.on(events.emote, ({ id, kind }) => {
      Playground3D.playRemoteEmote(id, kind);
    });

    // Punch relay (world only — events.punch is null for homes). Every
    // local punch is broadcast so peers see the swing; a hit also carries
    // the victim's socket id.
    if (events.punch) {
      if (Playground3D.setPunchHandler) {
        Playground3D.setPunchHandler(({ target, npc }) => {
          if (socket.connected) socket.emit(events.punch, { target: target || null, npc: npc || null });
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

    // Avengers NPC fights (world only). The server owns every hero's HP, KO
    // and target; the engine renders from these broadcasts. When a hero is
    // angry at US, the engine asks for its swings (setNpcPunchHandler) and we
    // knock ourselves down on the server's echo — same shape as world:punch.
    if (events.npcs) {
      if (Playground3D.setNpcPunchHandler) {
        Playground3D.setNpcPunchHandler((npc) => {
          if (socket.connected) socket.emit(events.npcPunch, { npc });
        });
      }
      socket.on(events.npcs, ({ npcs, serverTime }) => {
        if (Playground3D.setWorldNpcState) Playground3D.setWorldNpcState(npcs || {}, serverTime);
      });
      socket.on(events.npcUpdate, (u) => {
        if (u && Playground3D.applyNpcUpdate) Playground3D.applyNpcUpdate(u);
      });
      socket.on(events.npcPunch, ({ npc, target }) => {
        if (Playground3D.playNpcPunch) Playground3D.playNpcPunch(npc);
        if (!target) return;
        if (target === socket.id) {
          if (Playground3D.knockdownLocal) Playground3D.knockdownLocal();
        } else if (Playground3D.knockdownRemote) {
          Playground3D.knockdownRemote(target);
        }
      });
    }

    // Shared Infinity Stone contest (world only — these events are null for
    // homes). Server is authoritative over ownership; the engine renders.
    if (events.stones) {
      if (Playground3D.setStoneGrabHandler) {
        Playground3D.setStoneGrabHandler((stone) => {
          if (socket.connected) socket.emit(events.stoneGrab, { stone });
        });
      }
      socket.on(events.stones, ({ stones }) => {
        if (Playground3D.setWorldStones) Playground3D.setWorldStones(stones || {});
        if (onStoneChange) { try { onStoneChange(); } catch (_) {} }
      });
      socket.on(events.stoneUpdate, ({ stone, holder }) => {
        if (Playground3D.setStoneHeld) Playground3D.setStoneHeld(stone, holder || null);
        if (onStoneChange) { try { onStoneChange(); } catch (_) {} }
      });
      socket.on(events.snapped, (payload) => {
        if (Playground3D.applySnap) Playground3D.applySnap(payload || {});
        if (onSnapped) { try { onSnapped(payload || {}); } catch (_) {} }
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
      if (events.channels) {
        if (e.key === 'Enter') { e.preventDefault(); sendChannelChat(); }
        else if (e.key === 'Escape') { input.value = ''; syncInputState(); input.blur(); }
        return;
      }
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

    // Channel UI wiring (tabs, whisper picker, send / clear buttons, tapping a
    // name in the log to whisper them). One delegated click listener on the
    // chat row so teardown is a single removeEventListener.
    const chatRow = events.channels ? document.querySelector('.world-chat-row') : null;
    const whisperSel = events.channels ? document.getElementById('world-whisper-to') : null;
    const onChatRowClick = (e) => {
      const tabBtn = e.target.closest('.world-chat-tab');
      if (tabBtn) { setTab(tabBtn.getAttribute('data-channel')); return; }
      const nameBtn = e.target.closest('[data-whisper]');
      if (nameBtn) {
        setWhisperTarget(nameBtn.getAttribute('data-whisper'));
        setTab('whisper');
        if (input) input.focus();
        return;
      }
      if (e.target.closest('#world-chat-send')) { sendChannelChat(); return; }
      if (e.target.closest('#world-chat-clear')) {
        if (input) { input.value = ''; syncInputState(); input.focus(); }
      }
    };
    const onWhisperChange = () => { setWhisperTarget(whisperSel.value); if (input) input.focus(); };
    const onWhisperOpen = () => refreshWhisperPicker();
    const onChatInput = () => syncInputState();
    if (chatRow) {
      chatRow.addEventListener('click', onChatRowClick);
      if (whisperSel) {
        whisperSel.addEventListener('change', onWhisperChange);
        whisperSel.addEventListener('pointerdown', onWhisperOpen);
        whisperSel.addEventListener('focus', onWhisperOpen);
      }
      if (input) input.addEventListener('input', onChatInput);
      renderTabs();
      renderCooldown();
      renderChatLog();
    }

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
      const backward = !!s.backward;
      if (dx < POS_EPSILON && dz < POS_EPSILON && dy < POS_EPSILON && dyaw < YAW_EPSILON
          && s.walking === lastPosSent.walking && backward === lastPosSent.backward) return;
      lastPosSent = { x: s.x, y: s.y || 0, z: s.z, yaw: s.yaw, walking: s.walking, backward };
      socket.emit(events.pos, lastPosSent);
    }, POS_INTERVAL_MS);

    function stop() {
      if (posTimer) { clearInterval(posTimer); posTimer = null; }
      if (input) input.removeEventListener('keydown', onChatKey);
      if (chatRow) {
        chatRow.removeEventListener('click', onChatRowClick);
        if (whisperSel) {
          whisperSel.removeEventListener('change', onWhisperChange);
          whisperSel.removeEventListener('pointerdown', onWhisperOpen);
          whisperSel.removeEventListener('focus', onWhisperOpen);
        }
        if (input) input.removeEventListener('input', onChatInput);
      }
      if (chan.cooldownTimer) { clearInterval(chan.cooldownTimer); chan.cooldownTimer = null; }
      chan.logs = { world: [], project: [], whisper: [] };
      if (emoteBtn) emoteBtn.removeEventListener('click', onEmoteClick);
      // Detach the punch + stone-grab → socket bridges so a stale closure
      // can't emit on a dead socket after unmount.
      if (events.punch && Playground3D.setPunchHandler) Playground3D.setPunchHandler(null);
      if (events.npcs && Playground3D.setNpcPunchHandler) Playground3D.setNpcPunchHandler(null);
      if (events.stones && Playground3D.setStoneGrabHandler) Playground3D.setStoneGrabHandler(null);
      if (socket) {
        if (events.leave && socket.connected) {
          try { socket.emit(events.leave); } catch (_) {}
        }
        try { socket.disconnect(); } catch (_) {}
      }
      chatLog = [];
    }

    // Request a snap (the view calls this when the local player holds all 6).
    function sendSnap() {
      if (events.snap && socket.connected) socket.emit(events.snap);
    }

    return { stop, getSocket: () => socket, sendSnap };
  }

  return { start, WORLD_EVENTS, HOME_EVENTS };
})();
