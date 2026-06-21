/************************************************
 * FRIEND HOME VIEW — /friend/:username/home
 *
 * Renders the friend's 3D home using their saved homeLayout (the rooms
 * and project posters they placed), but with the VISITOR's character —
 * you walk into your friend's house as yourself.
 *
 * Multiplayer: opens a socket on mount and joins room `home:<ownerId>`
 * via the shared Multiplayer module. If the owner is also on /home
 * they're already in the same room, so you see each other walk, chat,
 * and emote (same UX as /world, scoped to one home).
 ************************************************/
const FriendHomeView = (() => {
  let _mp = null;
  let _voice = null;
  let _voiceBtn = null;
  let _voiceBtnHandler = null;
  let _voiceCtxHandler = null;
  let _voiceTouchStart = null;
  let _voiceTouchEnd = null;
  let _voiceLongPressTimer = null;
  let _voiceLongPressFired = false;

  async function mount(container, params) {
    if (!Auth.isLoggedIn()) {
      Router.go('/login');
      return;
    }
    const username = params && params.username;
    if (!username) { Router.go('/'); return; }

    const friend = await FriendView.enter(username);
    if (!friend) {
      FriendView.render404(container, username);
      return;
    }

    container.innerHTML = `
      ${FriendView.renderHeader('home')}
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
    FriendView.wireHeader(container);

    const stage = container.querySelector('#pg-stage');
    const layout = friend.homeLayout || { rooms: [] };

    if (!layout.rooms || layout.rooms.length === 0) {
      const safeName = String(friend.username).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      stage.innerHTML = `
        <div class="pg-empty">
          <div class="pg-empty-card">
            <h2>${safeName} hasn't placed any rooms yet</h2>
            <p>Their home will appear here once they unlock and place project rooms.</p>
          </div>
        </div>
      `;
      return;
    }

    // Visitor's own character — fetched the same way /world does it.
    let character = null;
    try {
      const res = await fetch(`${API}/profile/home-character`, {
        headers: { Authorization: `Bearer ${Auth.getToken()}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.homeCharacter && data.homeCharacter.skin != null) character = data.homeCharacter;
      }
    } catch (_) { /* fall through to default */ }
    if (!character) character = Playground3D.defaultCharacter();

    Playground3D.init(stage, character, layout);

    if (typeof Multiplayer !== 'undefined' && Multiplayer.start) {
      _mp = Multiplayer.start({
        events: Multiplayer.HOME_EVENTS,
        joinPayload: { ownerUsername: username },
        character
      });
    }

    _wireVoiceToggle();
  }

  function _wireVoiceToggle() {
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
        _voiceBtn.classList.remove('listen-only', 'voice-error');
        _voiceBtn.setAttribute('aria-pressed', 'false');
        _voiceBtn.title = 'Voice chat (off)';
        return;
      }
      if (!_mp || !_mp.getSocket) return;
      _voiceBtn.classList.remove('listen-only', 'voice-error');
      _voice = VoiceManager.start({
        socket: _mp.getSocket(),
        scope: 'home',
        getLocalState: () => Playground3D.getLocalState && Playground3D.getLocalState(),
        getRemotePlayers: () => Playground3D.getRemotePlayers && Playground3D.getRemotePlayers(),
        onError: (msg) => {
          _voiceBtn.classList.remove('listen-only');
          _voiceBtn.classList.add('voice-error');
          _voiceBtn.setAttribute('aria-pressed', 'false');
          _voiceBtn.title = msg || 'Voice chat error';
          _voice = null;
          if (typeof toast === 'function') toast(msg || 'Voice chat couldn’t start.', 'error');
        },
        onMicUnavailable: (msg) => {
          _voiceBtn.classList.add('listen-only');
          _voiceBtn.setAttribute('aria-label', 'Listen-only — mic blocked, others can’t hear you.');
          _voiceBtn.title = msg || 'Listen-only — mic blocked';
          if (typeof toast === 'function') {
            toast('Microphone blocked — you’re in listen-only mode (others can’t hear you).', { type: 'warn', duration: 4500 });
          }
        },
        onPeerStateChange: (peerId, st) => {
          if (Playground3D.setRemotePlayerSpeaking) {
            Playground3D.setRemotePlayerSpeaking(peerId, !!st.speaking);
          }
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

    _voiceCtxHandler = (e) => {
      e.preventDefault();
      if (_voice && VoiceManager.openDebugPanel) {
        VoiceManager.openDebugPanel(_voice, _voiceBtn);
      }
    };
    _voiceBtn.addEventListener('contextmenu', _voiceCtxHandler);

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
    _voiceBtn.addEventListener('touchend',    _voiceTouchEnd);
    _voiceBtn.addEventListener('touchmove',   _voiceTouchEnd);
    _voiceBtn.addEventListener('touchcancel', _voiceTouchEnd);
  }

  function unmount() {
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
    if (typeof Playground3D !== 'undefined' && Playground3D.destroy) {
      Playground3D.destroy();
    }
  }

  return { mount, unmount, title: 'Friend — Home' };
})();
