/************************************************
 * APP VIEW — Main watch order tracker
 ************************************************/
const AppView = {
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
        <h1>Watch Order Progression</h1>

        <div id="nav-drawer">
          <div id="nav-drawer-overlay"></div>
          <div id="nav-drawer-content">
            <button id="close-drawer">✕</button>
            <nav>
              <button id="profile-btn">👤 Profile</button>
              <button id="characters-btn">🦸 Characters</button>
              <button id="walkers-btn">🚶 Walkers</button>
              <button id="friends-btn">👥 Friends</button>
              <button id="clear-progress">🗑 Clear Progress</button>
              <button id="logout-btn">🚪 Logout</button>
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
    document.getElementById('profile-btn')?.addEventListener('click', () => Router.go('/profile'));
    document.getElementById('characters-btn')?.addEventListener('click', () => Router.go('/characters'));

    // Close drawer after any nav button
    document.querySelectorAll('#nav-drawer-content nav button').forEach(btn => {
      btn.addEventListener('click', closeDrawer);
    });

    $("#clear-progress")?.addEventListener("click", () => {
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
      Walkers.resetInit();
      // resetLocal fires listeners → invalidates layout cache → next user
      // doesn't inherit the previous user's map state.
      state.resetLocal();
      Router.go('/login');
    });

    $("#friends-btn")?.addEventListener("click", () => showFriendsPanel());
    $("#walkers-btn")?.addEventListener("click", () => Walkers.showWalkerPicker());

    // Render map
    renderer.setCenterTarget(state.getLastWatchedId());
    renderer.render();

    // Init walkers
    await Walkers.init();
    // Track the deploy delay so unmount can cancel it — otherwise a fast
    // logout within 500ms triggers deploy() against a destroyed renderer.
    AppView._deployTimer = setTimeout(() => {
      AppView._deployTimer = null;
      Walkers.deploy();
    }, 500);

    // Load profile picture into header
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
