/************************************************
 * APP VIEW — Main watch order tracker
 ************************************************/
const AppView = {
  title: 'Universe Map',
  _initialized: false,
  _mountSeq: 0,

  mount(container) {
    if (!Auth.isLoggedIn()) {
      Router.go('/login');
      return;
    }

    container.innerHTML = `
      <header id="header">
        ${NavDrawer.toggleHtml()}

        <div class="view-tabs" role="tablist" aria-label="View mode">
          <button class="view-tab" data-route="/" role="tab" aria-selected="false"><span class="vt-long">Watch </span>Order</button>
          <button class="view-tab" data-route="/board" role="tab" aria-selected="false">Board</button>
          <button class="view-tab" data-route="/feed" role="tab" aria-selected="false">Feed</button>
          <button class="view-tab" data-route="/world" role="tab" aria-selected="false">World</button>
        </div>

        ${NavDrawer.html('full')}
        <button id="header-profile-btn" title="Profile" aria-label="Profile">
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
    const seq = ++AppView._mountSeq;
    await state.ensureLoaded();
    // Superseded while progress loaded (remounted by boot's content refresh,
    // or left): only the latest mount may build the map.
    if (seq !== AppView._mountSeq) return;
    this._initialized = true;
    // ...but re-derive the project fields on every mount: boot.js swaps
    // `projects` for the DB copy in the background and that array carries no
    // phaseNum/unlocks, which makes isUnlocked() false for everything and
    // leaves the map with no pins at all.
    state.initProjects(projects);

    // Re-bind renderer to fresh DOM elements
    renderer.init();

    // Drawer (js/nav-drawer.js). Re-read the live toggle values every time it
    // opens — the server's flag defaults (/api/config/public →
    // Walkers.applyFlagDefaults) arrive after mount, so a label rendered
    // once can disagree with the real setting and make the first tap look
    // like a no-op.
    const refreshToggleLabels = () => {
      if (typeof Walkers === 'undefined') return;
      const f = document.getElementById('fights-toggle-btn');
      if (f) { f.textContent = `Fights: ${Walkers.getFightsEnabled() ? 'On' : 'Off'}`; f.setAttribute('aria-pressed', String(!!Walkers.getFightsEnabled())); }
      const d = document.getElementById('dialogues-toggle-btn');
      if (d) { d.textContent = `Dialogues: ${Walkers.getDialoguesEnabled() ? 'On' : 'Off'}`; d.setAttribute('aria-pressed', String(!!Walkers.getDialoguesEnabled())); }
    };
    NavDrawer.wire(document, { onOpen: refreshToggleLabels });

    // View-mode tab toggle (Watch Order ↔ World) — the two focal surfaces.
    // On /map neither is active; the tabs act as quick jumps to a focal view.
    document.querySelectorAll('.view-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const route = tab.dataset.route;
        if (route) Router.go(route);
      });
    });

    // One logout path for the whole app (js/auth.js): flushes the pending
    // progress save, signs out everywhere, clears every per-user cache.
    $("#logout-btn")?.addEventListener("click", () => Auth.logout());

    $("#friends-btn")?.addEventListener("click", () => showFriendsPanel());
    $("#report-btn")?.addEventListener("click", () => showReportDialog());
    MessagesBadge.apply();
    $("#goals-btn")?.addEventListener("click", () => showGoalsPanel());
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
    if (seq !== AppView._mountSeq) return;
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
    AppView._mountSeq++;   // a setup still awaiting progress must not finish
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
