/************************************************
 * APP VIEW — Main watch order tracker
 ************************************************/
const AppView = {
  title: 'Watch Order',
  _initialized: false,

  mount(container) {
    if (!Auth.isLoggedIn()) {
      Router.go('/');
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
        <div id="map-container">
          <svg id="connections"></svg>
          <div id="nodes"></div>
        </div>
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
      localStorage.removeItem("mcu_token");
      localStorage.removeItem("mcu_username");
      // Reset init flags so next login re-fetches data
      AppView._initialized = false;
      Walkers.resetInit();
      state.data.clear();
      Router.go('/');
    });

    $("#friends-btn")?.addEventListener("click", () => showFriendsPanel());
    $("#walkers-btn")?.addEventListener("click", () => Walkers.showWalkerPicker());

    // Render map
    renderer.setCenterTarget(state.getLastWatchedId());
    renderer.render();

    // Init walkers
    await Walkers.init();
    setTimeout(() => Walkers.deploy(), 500);

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
    Walkers.destroy();
    // Null out renderer DOM refs so subscriptions don't fire on stale DOM
    renderer.container = null;
    renderer.mapContainer = null;
    renderer.nodesContainer = null;
    renderer.svg = null;
  }
};
