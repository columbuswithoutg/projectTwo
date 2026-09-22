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
          <button class="view-tab" data-route="/feed" role="tab" aria-selected="false">Feed</button>
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
                <button id="messages-btn">Messages <span class="nav-badge" data-unread-badge hidden></span></button>
                <button id="goals-btn">Goals</button>
                <button id="report-btn">Report a bug</button>
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
      this._initialized = true;
    }
    // Re-derive on EVERY mount, not just the first. boot.js swaps `projects`
    // for the DB copy in the background; that array has no phaseNum/unlocks,
    // and without them isUnlocked() is false for everything and the flow
    // renders zero nodes. Cheap and idempotent, so just always run it.
    state.initProjects(projects);

    orderRenderer.init();

    // Drawer
    const drawer = document.getElementById('nav-drawer');
    // Re-read the live values every time the drawer opens. The server's flag
    // defaults (/api/config/public → Walkers.applyFlagDefaults) land AFTER
    // this view mounts, so a label rendered once at mount can disagree with
    // the real setting — and then the first tap appears to do nothing because
    // it flips the value to whatever the label already claimed.
    const refreshToggleLabels = () => {
      if (typeof Walkers === 'undefined') return;
      const f = document.getElementById('fights-toggle-btn');
      if (f) f.textContent = `Fights: ${Walkers.getFightsEnabled() ? 'On' : 'Off'}`;
      const d = document.getElementById('dialogues-toggle-btn');
      if (d) d.textContent = `Dialogues: ${Walkers.getDialoguesEnabled() ? 'On' : 'Off'}`;
    };
    const openDrawer = () => { refreshToggleLabels(); drawer.classList.add('open'); };
    const closeDrawer = () => drawer.classList.remove('open');
    document.getElementById('nav-toggle').addEventListener('click', openDrawer);
    document.getElementById('close-drawer').addEventListener('click', closeDrawer);
    document.getElementById('nav-drawer-overlay').addEventListener('click', closeDrawer);

    // SPA navigation buttons
    document.getElementById('world-btn')?.addEventListener('click', () => Router.go('/world'));
    document.getElementById('home-btn')?.addEventListener('click', () => Router.go('/home'));
    document.getElementById('profile-btn')?.addEventListener('click', () => Router.go('/profile'));
    document.getElementById('characters-btn')?.addEventListener('click', () => Router.go('/characters'));
    document.getElementById('map-btn')?.addEventListener('click', () => Router.go('/map'));

    // Tab toggle — switch to map view
    document.querySelectorAll('.view-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const route = tab.dataset.route;
        if (route) Router.go(route);
      });
    });

    // Auto-close on tap — but NOT for the in-place toggles. Fights/Dialogues
    // flip a setting and rewrite their own label; closing the drawer hid that
    // label change, so on mobile (where the drawer is the only way in) the
    // buttons looked like they did nothing at all.
    document.querySelectorAll('#nav-drawer-content nav button').forEach(btn => {
      if (btn.id === 'fights-toggle-btn' || btn.id === 'dialogues-toggle-btn') return;
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
    $("#messages-btn")?.addEventListener("click", () => Router.go('/messages'));
    $("#report-btn")?.addEventListener("click", () => showReportDialog());
    MessagesBadge.apply();
    $("#goals-btn")?.addEventListener("click", () => showGoalsPanel());
    $("#walkers-btn")?.addEventListener("click", () => Walkers.showWalkerPicker());
    // Character editor — HomeBuilder.open() now routes to the /customize page
    // (stashing this route to return to). The next /home visit (or the page's
    // own fetch) picks up the freshly saved character.
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

    // Header avatar — instant initials, then upgrade to the profile photo.
    initHeaderAvatar();

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
