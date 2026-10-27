/************************************************
 * WATCH ORDER VIEW — Flowchart of MCU projects
 * Primary surface. Geographic map lives at /map.
 ************************************************/
const WatchOrderView = {
  title: 'Watch Order',
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
          <button class="view-tab active" data-route="/" role="tab" aria-selected="true"><span class="vt-long">Watch </span>Order</button>
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
    const seq = ++WatchOrderView._mountSeq;
    await state.ensureLoaded();
    // Superseded while progress loaded: the view was remounted (boot's
    // background content refresh) or left. Only the latest mount may build
    // the chart — two used to render every poster twice and deploy walkers twice.
    if (seq !== WatchOrderView._mountSeq) return;
    this._initialized = true;
    // Re-derive on EVERY mount, not just the first. boot.js swaps `projects`
    // for the DB copy in the background; that array has no phaseNum/unlocks,
    // and without them isUnlocked() is false for everything and the flow
    // renders zero nodes. Cheap and idempotent, so just always run it.
    state.initProjects(projects);

    orderRenderer.init();

    // Drawer (js/nav-drawer.js). Re-read the live toggle values every time it
    // opens: the server's flag defaults (/api/config/public →
    // Walkers.applyFlagDefaults) land AFTER this view mounts, so a label
    // rendered once at mount can disagree with the real setting — and then
    // the first tap appears to do nothing because it flips the value to
    // whatever the label already claimed.
    const refreshToggleLabels = () => {
      if (typeof Walkers === 'undefined') return;
      const f = document.getElementById('fights-toggle-btn');
      if (f) { f.textContent = `Fights: ${Walkers.getFightsEnabled() ? 'On' : 'Off'}`; f.setAttribute('aria-pressed', String(!!Walkers.getFightsEnabled())); }
      const d = document.getElementById('dialogues-toggle-btn');
      if (d) { d.textContent = `Dialogues: ${Walkers.getDialoguesEnabled() ? 'On' : 'Off'}`; d.setAttribute('aria-pressed', String(!!Walkers.getDialoguesEnabled())); }
    };
    NavDrawer.wire(document, { onOpen: refreshToggleLabels });

    // Tab toggle — switch to map view
    document.querySelectorAll('.view-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const route = tab.dataset.route;
        if (route) Router.go(route);
      });
    });

    // One logout path for the whole app (js/auth.js): server-side sign-out
    // everywhere + every per-user cache cleared.
    $("#logout-btn")?.addEventListener("click", () => Auth.logout());

    $("#friends-btn")?.addEventListener("click", () => showFriendsPanel());
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
    if (seq !== WatchOrderView._mountSeq) return;
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
    WatchOrderView._mountSeq++;   // a setup still awaiting progress must not finish
    if (WatchOrderView._deployTimer) {
      clearTimeout(WatchOrderView._deployTimer);
      WatchOrderView._deployTimer = null;
    }
    Walkers.destroy();
    orderRenderer.destroy();
  }
};
