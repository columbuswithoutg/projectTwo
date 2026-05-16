/************************************************
 * WATCH ORDER VIEW — Flowchart of MCU projects
 * Primary surface. Geographic map lives at /map.
 ************************************************/
const WatchOrderView = {
  title: 'Watch Order',
  _initialized: false,

  mount(container) {
    if (!Auth.isLoggedIn()) {
      Router.go('/login');
      return;
    }

    container.innerHTML = `
      <header id="header">
        <button id="nav-toggle">☰</button>

        <div class="view-tabs" role="tablist" aria-label="View mode">
          <button class="view-tab active" data-route="/" role="tab" aria-selected="true">Watch Order</button>
          <button class="view-tab" data-route="/map" role="tab" aria-selected="false">Universe Map</button>
        </div>

        <div id="nav-drawer">
          <div id="nav-drawer-overlay"></div>
          <div id="nav-drawer-content">
            <button id="close-drawer">✕</button>
            <nav>
              <div class="nav-section">
                <div class="nav-section-title">Navigate</div>
                <button id="home-btn">🏠 Home</button>
                <button id="world-btn">🌍 World</button>
                <button id="profile-btn">👤 Profile</button>
                <button id="characters-btn">🦸 Characters</button>
              </div>
              <div class="nav-section">
                <div class="nav-section-title">You</div>
                <button id="nav-character-btn">🧑 Customize character</button>
                <button id="friends-btn">👥 Friends</button>
              </div>
              <div class="nav-section">
                <div class="nav-section-title">Walkers</div>
                <button id="walkers-btn">🚶 Walkers</button>
                <button id="fights-toggle-btn">⚔️ Fights: ON</button>
                <button id="dialogues-toggle-btn">💬 Dialogues: ON</button>
              </div>
              <div class="nav-section">
                <div class="nav-section-title">Data</div>
                <button id="clear-progress">🗑 Clear Progress</button>
                <button id="logout-btn">🚪 Logout</button>
              </div>
            </nav>
          </div>
        </div>

        <button id="header-profile-btn" title="Profile">
          <img id="header-avatar" src="" alt="" style="display:none" />
          <span id="header-avatar-initials">👤</span>
        </button>
      </header>

      <div class="flow-wrapper">
        <div class="flow-canvas">
          <svg class="flow-arrows" xmlns="http://www.w3.org/2000/svg"></svg>
          <div class="flow-nodes"></div>
          <!-- Walkers (characters) live in their own layer so they sit above
               the road arrows but compose with the same scroll/canvas. -->
          <div class="flow-walkers"></div>
        </div>
      </div>
    `;

    this._setup();
  },

  async _setup() {
    if (!this._initialized) {
      await state.load();
      state.initProjects(projects);
      this._initialized = true;
    }

    orderRenderer.init();

    // Drawer
    const drawer = document.getElementById('nav-drawer');
    const openDrawer = () => drawer.classList.add('open');
    const closeDrawer = () => drawer.classList.remove('open');
    document.getElementById('nav-toggle').addEventListener('click', openDrawer);
    document.getElementById('close-drawer').addEventListener('click', closeDrawer);
    document.getElementById('nav-drawer-overlay').addEventListener('click', closeDrawer);

    // SPA navigation buttons
    document.getElementById('home-btn')?.addEventListener('click', () => Router.go('/home'));
    document.getElementById('world-btn')?.addEventListener('click', () => Router.go('/world'));
    document.getElementById('profile-btn')?.addEventListener('click', () => Router.go('/profile'));
    document.getElementById('characters-btn')?.addEventListener('click', () => Router.go('/characters'));

    // Tab toggle — switch to map view
    document.querySelectorAll('.view-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const route = tab.dataset.route;
        if (route) Router.go(route);
      });
    });

    document.querySelectorAll('#nav-drawer-content nav button').forEach(btn => {
      btn.addEventListener('click', closeDrawer);
    });

    $("#clear-progress")?.addEventListener("click", () => {
      state.clear();
      orderRenderer.centerOnLastWatched();
    });

    $("#logout-btn")?.addEventListener("click", () => {
      state.flushPersist?.();
      localStorage.removeItem("mcu_token");
      localStorage.removeItem("mcu_username");
      WatchOrderView._initialized = false;
      AppView._initialized = false;
      state.resetLocal();
      Router.go('/login');
    });

    $("#friends-btn")?.addEventListener("click", () => showFriendsPanel());
    $("#walkers-btn")?.addEventListener("click", () => Walkers.showWalkerPicker());
    // Character editor — opens the same builder modal as /home. No live
    // Playground3D scene to hot-swap here, so onSave is a no-op; the next
    // /home visit picks up the fresh character on its own fetch.
    $("#nav-character-btn")?.addEventListener("click", () => HomeBuilder.open({}));

    // Fight toggle — flips the persistent setting and updates the label.
    const fightsBtn = $("#fights-toggle-btn");
    const refreshFightsLabel = () => {
      if (fightsBtn) fightsBtn.textContent = `⚔️ Fights: ${Walkers.getFightsEnabled() ? 'ON' : 'OFF'}`;
    };
    refreshFightsLabel();
    fightsBtn?.addEventListener('click', () => {
      Walkers.setFightsEnabled(!Walkers.getFightsEnabled());
      refreshFightsLabel();
    });

    // Dialogue toggle — same pattern.
    const dialoguesBtn = $("#dialogues-toggle-btn");
    const refreshDialoguesLabel = () => {
      if (dialoguesBtn) dialoguesBtn.textContent = `💬 Dialogues: ${Walkers.getDialoguesEnabled() ? 'ON' : 'OFF'}`;
    };
    refreshDialoguesLabel();
    dialoguesBtn?.addEventListener('click', () => {
      Walkers.setDialoguesEnabled(!Walkers.getDialoguesEnabled());
      refreshDialoguesLabel();
    });

    // Render the flowchart
    orderRenderer.render();

    // Walkers run on the flow adapter while this view is active.
    WalkerView.set(FlowWalkerAdapter);

    // Init + deploy walkers (same lifecycle as the map view).
    await Walkers.init();
    WatchOrderView._deployTimer = setTimeout(() => {
      WatchOrderView._deployTimer = null;
      Walkers.deploy();
    }, 500);

    // Header profile picture
    if (Auth.isLoggedIn()) {
      fetch(`${API}/profile`, {
        headers: { Authorization: `Bearer ${Auth.getToken()}` }
      }).then(r => r.json()).then(data => {
        const img      = document.getElementById('header-avatar');
        const initials = document.getElementById('header-avatar-initials');
        if (data.profilePicture && img) {
          img.src = data.profilePicture;
          img.style.display = 'block';
          if (initials) initials.style.display = 'none';
        } else if (initials && data.username) {
          initials.textContent = data.username[0].toUpperCase();
        }
      }).catch(() => {});
    }

    document.getElementById('header-profile-btn')?.addEventListener('click', () => {
      Router.go('/profile');
    });
  },

  unmount() {
    if (WatchOrderView._deployTimer) {
      clearTimeout(WatchOrderView._deployTimer);
      WatchOrderView._deployTimer = null;
    }
    Walkers.destroy();
    orderRenderer.destroy();
  }
};
