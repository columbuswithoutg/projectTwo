/************************************************
 * NAV DRAWER — the ☰ menu shared by the watch order, map, board, feed and
 * home views.
 *
 * Three views used to carry their own copy of the markup and wiring, and
 * the closed drawer was only slid off-screen: its fifteen buttons stayed in
 * the Tab order and the screen-reader tree, Escape did nothing, focus never
 * moved in or back, and the feed / board had no menu at all.
 *
 *   NavDrawer.toggleHtml()        the ☰ button for a header
 *   NavDrawer.html(variant)       the drawer: 'full' (walkers + clear
 *                                 progress), 'lite' (feed / board), 'home'
 *   NavDrawer.wire(root, opts)    open / close + a11y. opts.onOpen runs on
 *                                 every open (views refresh toggle labels);
 *                                 opts.actions wires the shared buttons
 *                                 (friends, goals, report, character,
 *                                 walkers, log out) for views that have no
 *                                 handlers of their own. Returns { open, close }.
 *
 * Closed = `inert` (unfocusable, hidden from assistive tech, CSS hides it).
 * Open = on the shared modal stack (wireModalDismiss): Escape closes it, Tab
 * stays inside, focus returns to ☰, and a route change closes it like any
 * other dialog. Buttons keep their old ids, so views that wire their own
 * handlers (#friends-btn, #clear-progress, the toggles…) keep working.
 ************************************************/
const NavDrawer = (() => {
  const BADGE = '<span class="nav-badge" data-unread-badge hidden></span>';

  function navigate(variant) {
    if (variant === 'home') {
      return `
              <div class="nav-section">
                <div class="nav-section-title">Navigate</div>
                <button type="button" data-route="/world">World</button>
                <button type="button" data-route="/">Watch order</button>
                <button type="button" data-route="/board">Board</button>
                <button type="button" data-route="/profile">Profile</button>
                <button type="button" data-route="/characters">Characters</button>
                <button type="button" data-route="/map">Universe map</button>
              </div>`;
    }
    return `
              <div class="nav-section">
                <div class="nav-section-title">Navigate</div>
                <button type="button" id="world-btn" data-route="/world">World</button>
                <button type="button" id="home-btn" data-route="/home">Home</button>
                <button type="button" id="profile-btn" data-route="/profile">Profile</button>
                <button type="button" id="characters-btn" data-route="/characters">Characters</button>
                <button type="button" id="map-btn" data-route="/map">Universe map</button>
              </div>`;
  }

  function you(variant) {
    if (variant === 'home') {
      return `
              <div class="nav-section">
                <div class="nav-section-title">You</div>
                <button type="button" id="nav-character-btn">Customize character</button>
                <button type="button" data-route="/messages">Messages ${BADGE}</button>
                <button type="button" id="report-btn">Report a bug</button>
              </div>`;
    }
    return `
              <div class="nav-section">
                <div class="nav-section-title">You</div>
                <button type="button" id="nav-character-btn">Customize character</button>
                <button type="button" id="friends-btn">Friends</button>
                <button type="button" id="messages-btn" data-route="/messages">Messages ${BADGE}</button>
                <button type="button" id="goals-btn">Goals</button>
                <button type="button" id="report-btn">Report a bug</button>
              </div>`;
  }

  const WALKERS = `
              <div class="nav-section">
                <div class="nav-section-title">Walkers</div>
                <button type="button" id="walkers-btn">Walkers</button>
                <button type="button" id="fights-toggle-btn" aria-pressed="true">Fights: On</button>
                <button type="button" id="dialogues-toggle-btn" aria-pressed="true">Dialogues: On</button>
              </div>`;

  function data(variant) {
    return `
              <div class="nav-section">
                <div class="nav-section-title">Data</div>
                ${variant === 'full' ? '<button type="button" id="clear-progress">Clear progress</button>' : ''}
                <button type="button" id="logout-btn">Log out</button>
              </div>`;
  }

  function toggleHtml() {
    return '<button id="nav-toggle" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="nav-drawer-content">☰</button>';
  }

  function html(variant = 'full') {
    return `
        <div id="nav-drawer" inert>
          <div id="nav-drawer-overlay"></div>
          <div id="nav-drawer-content" role="dialog" aria-modal="true" aria-label="Menu">
            <button id="close-drawer" type="button" aria-label="Close menu">✕</button>
            <nav aria-label="Main">${navigate(variant)}${you(variant)}${variant === 'full' ? WALKERS : ''}${data(variant)}
            </nav>
          </div>
        </div>`;
  }

  function wire(root, opts = {}) {
    const q = (sel) => (root || document).querySelector(sel);
    const drawer = q('#nav-drawer');
    const content = q('#nav-drawer-content');
    const toggle = q('#nav-toggle');
    const overlay = q('#nav-drawer-overlay');
    const closeBtn = q('#close-drawer');
    if (!drawer || !content || !toggle) return { open() {}, close() {} };

    let dismiss = null;
    let inertTimer = null;
    const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    function finishClose() {
      drawer.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      clearTimeout(inertTimer);
      // Back to inert once the slide-out has played (at once under reduced motion).
      inertTimer = setTimeout(() => drawer.setAttribute('inert', ''), reduced() ? 0 : 320);
    }
    function close() { if (dismiss) dismiss(); }
    function open() {
      if (dismiss) return;
      clearTimeout(inertTimer);
      drawer.removeAttribute('inert');
      if (opts.onOpen) { try { opts.onOpen(); } catch (_) {} }
      // A forced reflow between un-hiding and .open, so the slide-in
      // transitions from the off-screen state (a rAF would also do it, but
      // never fires in a background tab).
      void drawer.offsetWidth;
      drawer.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
      dismiss = wireModalDismiss(content, () => { dismiss = null; finishClose(); }, {
        backdrop: false,
        initialFocus: closeBtn
      });
    }

    toggle.addEventListener('click', () => (dismiss ? close() : open()));
    closeBtn.addEventListener('click', close);
    if (overlay) overlay.addEventListener('click', close);

    // Route buttons, and auto-close on any button except the in-place
    // toggles (their label change must stay visible).
    content.querySelectorAll('nav button').forEach(btn => {
      if (btn.id === 'fights-toggle-btn' || btn.id === 'dialogues-toggle-btn') return;
      btn.addEventListener('click', () => {
        close();
        if (btn.dataset.route) Router.go(btn.dataset.route);
      });
    });

    if (opts.actions) {
      const on = (sel, fn) => { const el = q(sel); if (el) el.addEventListener('click', fn); };
      on('#friends-btn', () => showFriendsPanel());
      on('#goals-btn', () => { if (typeof showGoalsPanel === 'function') showGoalsPanel(); });
      on('#report-btn', () => showReportDialog());
      on('#walkers-btn', () => { if (typeof Walkers !== 'undefined') Walkers.showWalkerPicker(); });
      on('#nav-character-btn', () => {
        if (typeof HomeBuilder !== 'undefined' && HomeBuilder.open) HomeBuilder.open({});
        else Router.go('/customize');
      });
      on('#logout-btn', () => Auth.logout());
      if (typeof MessagesBadge !== 'undefined' && MessagesBadge.apply) MessagesBadge.apply();
    }

    return { open, close };
  }

  return { toggleHtml, html, wire };
})();
