/************************************************
 * APP VIEW — Main watch order tracker
 ************************************************/
const AppView = {
  title: 'Universe Map',
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
          <button class="view-tab" data-route="/" role="tab" aria-selected="false">Watch Order</button>
          <button class="view-tab" data-route="/world" role="tab" aria-selected="false">World</button>
        </div>

        <div id="nav-drawer">
          <div id="nav-drawer-overlay"></div>
          <div id="nav-drawer-content">
            <button id="close-drawer">✕</button>
            <nav>
              <div class="nav-section">
                <div class="nav-section-title">Navigate</div>
                <button id="world-btn">World</button>
                <button id="home-btn">Home</button>
                <button id="profile-btn">Profile</button>
                <button id="characters-btn">Characters</button>
                <button id="map-btn">Universe Map</button>
              </div>
              <div class="nav-section">
                <div class="nav-section-title">You</div>
                <button id="nav-character-btn">Customize character</button>
                <button id="friends-btn">Friends</button>
              </div>
              <div class="nav-section">
                <div class="nav-section-title">Walkers</div>
                <button id="walkers-btn">Walkers</button>
                <button id="fights-toggle-btn">Fights: On</button>
                <button id="dialogues-toggle-btn">Dialogues: On</button>
              </div>
              <div class="nav-section">
                <div class="nav-section-title">Data</div>
                <button id="clear-progress">Clear Progress</button>
                <button id="logout-btn">Logout</button>
              </div>
            </nav>
          </div>
        </div>
        <button id="header-profile-btn" title="Profile">
          <img id="header-avatar" src="" alt="" style="display:none" />
          <span id="header-avatar-initials">👤</span>
        </button>
      </header>

      <div id="map-wrapper">
        <div id="world-viewport">
          <div id="map-container">
            <!-- All backdrop layers live INSIDE #map-container so the
                 fight-zoom transform applies to continents, starfield,
                 glows, roads, and pins together. When any of these sit
                 outside they get "left behind" during a zoom — the world
                 map stays put while the pins scale, which looks broken. -->
            <svg id="world-continents" aria-hidden="true" viewBox="0 0 8000 3400" preserveAspectRatio="none"></svg>
            <div id="cosmos-starfield" aria-hidden="true"></div>
            <div id="region-glows" aria-hidden="true"></div>
            <svg id="connections"></svg>
            <div id="nodes"></div>
            <div id="cluster-labels" aria-hidden="true"></div>
          </div>
        </div>

        <button id="world-view-btn" aria-label="Show world view" title="World view (W)">
          <span aria-hidden="true">🌍</span>
        </button>
      </div>

      <div id="up-next-shelf" aria-label="Up next to watch">
        <span class="shelf-label">UP NEXT</span>
        <div class="shelf-track"></div>
      </div>
    `;

    this._setup();
  },

  async _setup() {
    // Only load state once across navigations
    if (!this._initialized) {
      await state.load();
      state.initProjects(projects);
      this._initialized = true;
    }

    // Re-bind renderer to fresh DOM elements
    renderer.init();

    // Drawer
    const drawer = document.getElementById('nav-drawer');
    const openDrawer = () => drawer.classList.add('open');
    const closeDrawer = () => drawer.classList.remove('open');

    document.getElementById('nav-toggle').addEventListener('click', openDrawer);
    document.getElementById('close-drawer').addEventListener('click', closeDrawer);
    document.getElementById('nav-drawer-overlay').addEventListener('click', closeDrawer);

    // Navigation — SPA routes instead of .html redirects
    document.getElementById('world-btn')?.addEventListener('click', () => Router.go('/world'));
    document.getElementById('home-btn')?.addEventListener('click', () => Router.go('/home'));
    document.getElementById('profile-btn')?.addEventListener('click', () => Router.go('/profile'));
    document.getElementById('characters-btn')?.addEventListener('click', () => Router.go('/characters'));
    document.getElementById('map-btn')?.addEventListener('click', () => Router.go('/map'));

    // View-mode tab toggle (Watch Order ↔ World) — the two focal surfaces.
    // On /map neither is active; the tabs act as quick jumps to a focal view.
    document.querySelectorAll('.view-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const route = tab.dataset.route;
        if (route) Router.go(route);
      });
    });

    // Close drawer after any nav button
    document.querySelectorAll('#nav-drawer-content nav button').forEach(btn => {
      btn.addEventListener('click', closeDrawer);
    });

    $("#clear-progress")?.addEventListener("click", async () => {
      const ok = await confirmDialog({
        title: 'Clear all progress?',
        message: "This unmarks every project you've watched. This can't be undone.",
        confirmLabel: 'Clear progress',
        danger: true
      });
      if (!ok) return;
      state.clear();
      renderer.setCenterTarget(CONFIG.START_NODE_ID);
    });

    $("#logout-btn")?.addEventListener("click", () => {
      // Flush any pending debounced progress save before we tear down auth —
      // otherwise the user's last click never reaches the server.
      state.flushPersist?.();
      localStorage.removeItem("mcu_token");
      localStorage.removeItem("mcu_username");
      // Reset init flags so next login re-fetches data
      AppView._initialized = false;
      WatchOrderView._initialized = false;
      Walkers.resetInit();
      // resetLocal fires listeners → invalidates layout cache → next user
      // doesn't inherit the previous user's map state.
      state.resetLocal();
      Router.go('/login');
    });

    $("#friends-btn")?.addEventListener("click", () => showFriendsPanel());
    $("#walkers-btn")?.addEventListener("click", () => Walkers.showWalkerPicker());
    // Character editor — HomeBuilder.open() now routes to the /customize page
    // (stashing this route to return to). The page fetches the saved character.
    $("#nav-character-btn")?.addEventListener("click", () => HomeBuilder.open({}));

    // Fight toggle — flips the persistent setting and updates the label.
    const fightsBtn = $("#fights-toggle-btn");
    const refreshFightsLabel = () => {
      if (fightsBtn) fightsBtn.textContent = `Fights: ${Walkers.getFightsEnabled() ? 'On' : 'Off'}`;
    };
    refreshFightsLabel();
    fightsBtn?.addEventListener('click', () => {
      Walkers.setFightsEnabled(!Walkers.getFightsEnabled());
      refreshFightsLabel();
    });

    // Dialogue toggle — same pattern.
    const dialoguesBtn = $("#dialogues-toggle-btn");
    const refreshDialoguesLabel = () => {
      if (dialoguesBtn) dialoguesBtn.textContent = `Dialogues: ${Walkers.getDialoguesEnabled() ? 'On' : 'Off'}`;
    };
    refreshDialoguesLabel();
    dialoguesBtn?.addEventListener('click', () => {
      Walkers.setDialoguesEnabled(!Walkers.getDialoguesEnabled());
      refreshDialoguesLabel();
    });

    // Render map
    renderer.setCenterTarget(state.getLastWatchedId());
    renderer.render();

    // Walkers run on the map adapter while this view is active.
    WalkerView.set(MapWalkerAdapter);

    // Init walkers
    await Walkers.init();
    // Track the deploy delay so unmount can cancel it — otherwise a fast
    // logout within 500ms triggers deploy() against a destroyed renderer.
    AppView._deployTimer = setTimeout(() => {
      AppView._deployTimer = null;
      Walkers.deploy();
    }, 500);

    // Header avatar — instant initials, then upgrade to the profile photo.
    initHeaderAvatar();

    document.getElementById('header-profile-btn')?.addEventListener('click', () => {
      Router.go('/profile');
    });
  },

  unmount() {
    if (AppView._deployTimer) {
      clearTimeout(AppView._deployTimer);
      AppView._deployTimer = null;
    }
    Walkers.destroy();
    renderer.destroy();
    renderer.wrapper = null;
    renderer.viewport = null;
    renderer.mapContainer = null;
    renderer.nodesContainer = null;
    renderer.svg = null;
    renderer.labelsContainer = null;
    renderer.glowsContainer = null;
    renderer.continentsSvg = null;
    renderer.worldViewBtn = null;
    renderer.shelfTrack = null;
    renderer.shelfContainer = null;
  }
};
