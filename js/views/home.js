/************************************************
 * HOME VIEW — /home
 *
 * Mounts the 3D playground when the user has rooms placed; otherwise
 * shows a static "your home unlocks at 2 watched projects" card with a
 * link to the Watch Order. The ✎ button opens a small action menu with
 * "Edit character" (existing builder modal) and "Edit rooms" (routes to
 * /home/edit). One room unlocks per 2 watched projects (server-gated).
 ************************************************/
const HomeView = {
  title: 'Home — MCU Tracker',

  mount(container) {
    if (!Auth.isLoggedIn()) {
      Router.go('/login');
      return;
    }

    container.innerHTML = `
      <header class="pg-header">
        <button id="nav-toggle">☰</button>
        <h1 class="pg-title">Home</h1>
        <button id="pg-customize-btn" title="Edit">✎</button>

        <div id="nav-drawer">
          <div id="nav-drawer-overlay"></div>
          <div id="nav-drawer-content">
            <button id="close-drawer">✕</button>
            <nav>
              <div class="nav-section">
                <div class="nav-section-title">Navigate</div>
                <button data-route="/">📋 Watch Order</button>
                <button data-route="/map">🗺 Universe Map</button>
                <button data-route="/world">🌍 World</button>
                <button data-route="/profile">👤 Profile</button>
                <button data-route="/characters">🦸 Characters</button>
              </div>
              <div class="nav-section">
                <div class="nav-section-title">You</div>
                <button id="nav-character-btn">🧑 Customize character</button>
              </div>
              <div class="nav-section">
                <div class="nav-section-title">Data</div>
                <button id="logout-btn">🚪 Logout</button>
              </div>
            </nav>
          </div>
        </div>
      </header>

      <div id="pg-stage" class="pg-stage"></div>
    `;

    // Drawer wiring (same pattern as watchorder/app views).
    const drawer = document.getElementById('nav-drawer');
    const closeDrawer = () => drawer.classList.remove('open');
    document.getElementById('nav-toggle').addEventListener('click', () => drawer.classList.add('open'));
    document.getElementById('close-drawer').addEventListener('click', closeDrawer);
    document.getElementById('nav-drawer-overlay').addEventListener('click', closeDrawer);
    document.querySelectorAll('#nav-drawer-content nav button[data-route]').forEach(btn => {
      btn.addEventListener('click', () => {
        closeDrawer();
        Router.go(btn.dataset.route);
      });
    });
    document.getElementById('logout-btn')?.addEventListener('click', () => {
      Auth.logout();
    });
    // Drawer shortcut to the character editor — reuse the same path as the
    // ✎ button so onSave still hot-swaps the live 3D playground.
    document.getElementById('nav-character-btn')?.addEventListener('click', () => {
      closeDrawer();
      HomeView._openBuilder();
    });

    document.getElementById('pg-customize-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      HomeView._toggleEditMenu();
    });
    // Click outside the menu to dismiss.
    document.addEventListener('click', HomeView._onDocClick = () => HomeView._closeEditMenu());

    HomeView._stage = document.getElementById('pg-stage');
    HomeView._loadAndStart();
  },

  async _loadAndStart() {
    // Fetch character + layout in parallel so the first render isn't gated
    // on the slower of the two.
    let character = null;
    let layout = { rooms: [] };
    let maxRooms = 0;
    let watchedCount = 0;
    try {
      const [charRes, layoutRes] = await Promise.all([
        fetch(`${API}/profile/home-character`, { headers: { Authorization: `Bearer ${Auth.getToken()}` } }),
        fetch(`${API}/profile/home-layout`,    { headers: { Authorization: `Bearer ${Auth.getToken()}` } })
      ]);
      if (charRes.ok) {
        const data = await charRes.json();
        character = data.homeCharacter;
      }
      if (layoutRes.ok) {
        const data = await layoutRes.json();
        layout = data.homeLayout || { rooms: [] };
        maxRooms = data.maxRooms || 0;
        watchedCount = data.watchedCount || 0;
      }
    } catch (_) {
      // Network/server issue — fall through with empty layout and defaults
      // so the user still sees a reasonable page rather than a blank.
    }

    const isFresh = !character || character.skin == null;
    HomeView._character = character && character.skin != null ? character : null;
    HomeView._layout = layout;
    HomeView._maxRooms = maxRooms;
    HomeView._watchedCount = watchedCount;

    if (!layout.rooms || layout.rooms.length === 0) {
      HomeView._renderEmptyHome();
      // Open the character builder on the first visit so users still get
      // the "make your character" moment even when there are no rooms yet.
      if (isFresh) HomeView._openBuilder({ firstTime: true });
      return;
    }

    // Inject the multiplayer chat row (same DOM ids as /world so the
    // shared Multiplayer module's input/emote/log wiring just works).
    // Sits as a sibling of #pg-stage; the joystick fix already promoted
    // .pg-joy to the root stacking context so the chat row no longer
    // occludes it.
    const stageHost = HomeView._stage.parentNode || document.body;
    if (!stageHost.querySelector('.world-chat-row')) {
      stageHost.insertAdjacentHTML('beforeend', `
        <div class="world-chat-row">
          <div class="world-chat-log" id="world-chat-log" aria-live="polite"></div>
          <div class="world-chat-inputrow">
            <input class="pg3d-chat" id="world-chat-input" placeholder="Say something…" maxlength="200" autocomplete="off" />
            <button class="pg3d-emote" id="world-emote-btn" type="button" aria-label="Wave">👋</button>
            <button class="pg3d-voice" id="world-voice-btn" type="button" aria-label="Toggle voice chat" aria-pressed="false" title="Voice chat (off)">🎙️</button>
          </div>
        </div>
      `);
    }

    const localChar = HomeView._character || Playground3D.defaultCharacter();
    Playground3D.init(HomeView._stage, localChar, layout);

    if (typeof Multiplayer !== 'undefined' && Multiplayer.start) {
      HomeView._mp = Multiplayer.start({
        events: Multiplayer.HOME_EVENTS,
        joinPayload: { ownerUsername: Auth.getUsername() },
        character: localChar
      });
    }

    HomeView._wireVoiceToggle();

    if (isFresh) {
      HomeView._openBuilder({ firstTime: true });
    }
  },

  _wireVoiceToggle() {
    const btn = document.getElementById('world-voice-btn');
    if (!btn) return;
    HomeView._voiceBtn = btn;
    if (typeof VoiceManager === 'undefined' || !VoiceManager.start) {
      btn.disabled = true;
      btn.title = 'Voice chat unavailable';
      return;
    }
    HomeView._voiceBtnHandler = () => {
      if (HomeView._voice) {
        try { HomeView._voice.stop(); } catch (_) {}
        HomeView._voice = null;
        btn.setAttribute('aria-pressed', 'false');
        btn.title = 'Voice chat (off)';
        return;
      }
      if (!HomeView._mp || !HomeView._mp.getSocket) return;
      HomeView._voice = VoiceManager.start({
        socket: HomeView._mp.getSocket(),
        scope: 'home',
        getLocalState: () => Playground3D.getLocalState && Playground3D.getLocalState(),
        getRemotePlayers: () => Playground3D.getRemotePlayers && Playground3D.getRemotePlayers(),
        onError: (msg) => {
          btn.setAttribute('aria-pressed', 'false');
          btn.title = msg || 'Voice chat error';
          HomeView._voice = null;
        },
        onPeerStateChange: (peerId, st) => {
          if (Playground3D.setRemotePlayerSpeaking) {
            Playground3D.setRemotePlayerSpeaking(peerId, !!st.speaking);
          }
        }
      });
      btn.setAttribute('aria-pressed', 'true');
      btn.title = 'Voice chat (on) — click to mute';
    };
    btn.addEventListener('click', HomeView._voiceBtnHandler);
  },

  _renderEmptyHome() {
    const watched = HomeView._watchedCount || 0;
    const needed = Math.max(0, 2 - watched);
    const heading = needed > 0
      ? 'Your home unlocks at 2 watched projects'
      : 'Pick your first room';
    const sub = needed > 0
      ? `You've watched ${watched} so far — ${needed} more to unlock your first room.`
      : `You've earned ${HomeView._maxRooms} room slot${HomeView._maxRooms === 1 ? '' : 's'}. Open the editor to place your first room.`;
    const cta = needed > 0
      ? `<a class="pg-empty-cta" href="/" data-link>Go to Watch Order</a>`
      : `<button class="pg-empty-cta" type="button" id="pg-empty-edit">Edit rooms</button>`;
    HomeView._stage.innerHTML = `
      <div class="pg-empty">
        <div class="pg-empty-card">
          <h2>${heading}</h2>
          <p>${sub}</p>
          ${cta}
        </div>
      </div>
    `;
    const editBtn = document.getElementById('pg-empty-edit');
    if (editBtn) editBtn.addEventListener('click', () => Router.go('/home/edit'));
  },

  _toggleEditMenu() {
    if (HomeView._menuEl) { HomeView._closeEditMenu(); return; }
    const btn = document.getElementById('pg-customize-btn');
    if (!btn) return;
    const menu = document.createElement('div');
    menu.className = 'pg-menu';
    menu.innerHTML = `
      <button type="button" class="pg-menu-item" data-action="character">🧑 Edit character</button>
      <button type="button" class="pg-menu-item" data-action="rooms">🏠 Edit rooms</button>
    `;
    document.body.appendChild(menu);
    HomeView._menuEl = menu;
    // Position under the ✎ button, right-aligned.
    const r = btn.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    menu.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = e.target?.dataset?.action;
      if (action === 'character') {
        HomeView._closeEditMenu();
        HomeView._openBuilder();
      } else if (action === 'rooms') {
        HomeView._closeEditMenu();
        Router.go('/home/edit');
      }
    });
  },

  _closeEditMenu() {
    if (HomeView._menuEl && HomeView._menuEl.parentNode) {
      HomeView._menuEl.parentNode.removeChild(HomeView._menuEl);
    }
    HomeView._menuEl = null;
  },

  _openBuilder({ firstTime = false } = {}) {
    HomeBuilder.open({
      initial: HomeView._character || Playground3D.defaultCharacter(),
      onSave: (saved) => {
        HomeView._character = saved;
        Playground3D.setCharacter(saved);
      },
      onCancel: () => {
        if (firstTime) {
          // no-op: default is already drawn
        }
      }
    });
  },

  unmount() {
    HomeView._closeEditMenu();
    if (HomeView._onDocClick) {
      document.removeEventListener('click', HomeView._onDocClick);
      HomeView._onDocClick = null;
    }
    // Voice must stop BEFORE multiplayer so voice:leave reaches the room
    // while the socket is still open.
    if (HomeView._voice) { try { HomeView._voice.stop(); } catch (_) {} HomeView._voice = null; }
    if (HomeView._voiceBtn && HomeView._voiceBtnHandler) {
      HomeView._voiceBtn.removeEventListener('click', HomeView._voiceBtnHandler);
    }
    HomeView._voiceBtn = null;
    HomeView._voiceBtnHandler = null;
    // Stop multiplayer BEFORE Playground3D.destroy() so the leave event
    // reaches the server while the socket is still open.
    if (HomeView._mp) { try { HomeView._mp.stop(); } catch (_) {} HomeView._mp = null; }
    Playground3D.destroy();
    HomeView._stage = null;
    HomeView._character = null;
    HomeView._layout = null;
  }
};
