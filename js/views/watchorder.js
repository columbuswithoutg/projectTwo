/************************************************
 * WATCH ORDER VIEW — Flowchart of MCU projects
 * Primary surface. Geographic map lives at /map.
 ************************************************/
const WatchOrderView = {
  title: 'Watch Order',
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

        ${HelpCentre.buttonHtml()}
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

    // Wired before _setup()'s awaits: the avatar button used to stay dead
    // until progress AND walkers had loaded.
    container.querySelector('#header-profile-btn')?.addEventListener('click', () => {
      Router.go('/profile');
    });

    this._setup();
  },

  async _setup() {
    const seq = ++WatchOrderView._mountSeq;
    await state.ensureLoaded();
    // Superseded while progress loaded: the view was remounted (boot's
    // background content refresh) or left. Only the latest mount may build
    // the chart — two used to render every poster twice and deploy walkers twice.
    if (seq !== WatchOrderView._mountSeq) return;
    // Re-derive on EVERY mount, not just the first. boot.js swaps `projects`
    // for the DB copy in the background; that array has no phaseNum/unlocks,
    // and without them isUnlocked() is false for everything and the flow
    // renders zero nodes. Cheap and idempotent, so just always run it.
    state.initProjects(projects);

    orderRenderer.init();

    // Drawer (js/nav-drawer.js): open / close, the shared buttons (log out,
    // friends, report, goals, walkers, character editor, messages badge) and
    // the Fights / Dialogues toggles, whose labels it re-reads on every open.
    NavDrawer.wire(document, { actions: true, walkerToggles: true });

    // Tab toggle — switch to map view
    document.querySelectorAll('.view-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const route = tab.dataset.route;
        if (route) Router.go(route);
      });
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
  },

  unmount() {
    WatchOrderView._mountSeq++;   // a setup still awaiting progress must not finish
    if (WatchOrderView._deployTimer) {
      clearTimeout(WatchOrderView._deployTimer);
      WatchOrderView._deployTimer = null;
    }
    Walkers.destroy();
    // No adapter while no walker view is mounted, so a late deploy() (e.g.
    // FriendView.exit → restoreSelections) is a no-op (MAP2-05).
    if (typeof WalkerView !== 'undefined') WalkerView.set(null);
    orderRenderer.destroy();
  }
};
