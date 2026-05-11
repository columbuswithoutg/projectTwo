/************************************************
 * FRIEND VIEW — shared state + chrome for the dedicated /friend/:username
 * routes. Pure data-holder; the four friend views (watch/map/home/profile)
 * own their own DOM and call into this module to enter/exit friend mode
 * and to render the in-view friend header.
 *
 * Lifecycle:
 *   - friend view's mount() awaits FriendView.enter(username)
 *   - if it returns null, view renders a 404 card
 *   - tab switches within /friend/:username/* hit a cached _active and
 *     don't re-fetch
 *   - Router auto-calls FriendView.exit() when navigating to a non-friend
 *     route (see js/router.js)
 ************************************************/
const FriendView = (() => {

  let _active = null;        // { id, username, profilePicture, watchedProjects, walkers, homeLayout, homeCharacter }
  let _origData = null;      // saved state.data Map prior to swap

  function isActive()  { return !!_active; }
  function getActive() { return _active; }

  // Idempotent entry — returns the friend payload or null on failure
  // (unknown user or not friends). Does NOT navigate; the caller (the
  // friend view's mount) decides what to render.
  async function enter(username) {
    if (_active && _active.username === username) return _active;
    if (_active) exit();

    let data;
    try {
      data = await Friends.getByUsername(username);
    } catch (_) {
      return null;
    }
    if (!data || data.error) return null;

    // Snapshot current state so exit() can restore.
    _origData = new Map(state.data);
    state.readonly = true;
    state.data.clear();
    (data.watchedProjects || []).forEach(entry => {
      state.data.set(entry.projectId, {
        count: entry.count,
        watchedWith: entry.watchedWith || [],
        memories: entry.memories || []
      });
    });
    // Fire listeners so subscribers (orderRenderer, renderer, walkers)
    // re-render against the swapped data.
    state.listeners.forEach(fn => fn(state.data));

    // Friend's chosen walkers — temporary override; doesn't touch our
    // localStorage. exit() calls restoreSelections() to flip back.
    if (typeof Walkers !== 'undefined' && typeof Walkers.deployWithSelections === 'function') {
      try { Walkers.deployWithSelections(data.walkers || []); } catch (_) {}
    }

    _active = data;
    return data;
  }

  function exit() {
    if (!_active) return;
    state.data.clear();
    if (_origData) _origData.forEach((v, k) => state.data.set(k, v));
    state.readonly = false;
    state.listeners.forEach(fn => fn(state.data));
    if (typeof Walkers !== 'undefined' && typeof Walkers.restoreSelections === 'function') {
      try { Walkers.restoreSelections(); } catch (_) {}
    }
    _active = null;
    _origData = null;
  }

  // ── shared chrome ──

  function _esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Renders the friend header HTML — username (linked to profile),
  // tab nav, and ← Back to mine. activeTab ∈ {'watch','map','home','profile'}.
  // Each friend view inserts this at the top of its container and calls
  // wireHeader(rootEl) to attach event handlers.
  function renderHeader(activeTab) {
    if (!_active) return '';
    const u = _active.username;
    const enc = encodeURIComponent(u);
    const tab = (id, route, label) =>
      `<button type="button" class="friend-header-tab${activeTab === id ? ' active' : ''}" data-route="${route}">${label}</button>`;
    return `
      <header class="friend-header">
        <div class="friend-header-text">
          Viewing
          <a class="friend-header-name" href="/friend/${enc}/profile" data-link>${_esc(u)}</a>'s progress
        </div>
        <nav class="friend-header-tabs">
          ${tab('watch',   '/friend/' + enc,            '📋 Watch order')}
          ${tab('map',     '/friend/' + enc + '/map',   '🗺 Map')}
          ${tab('home',    '/friend/' + enc + '/home',  '🏠 Home')}
        </nav>
        <button type="button" class="friend-header-back" id="friend-header-back">← Back to mine</button>
      </header>
    `;
  }

  // Wire up tab clicks + the back button. Call after the header HTML is
  // in the DOM. The username link uses data-link, so the existing Router
  // global click interceptor handles it — no extra wiring needed for it.
  function wireHeader(root) {
    if (!root) return;
    root.querySelectorAll('.friend-header-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const route = btn.dataset.route;
        if (route) Router.go(route);
      });
    });
    const back = root.querySelector('#friend-header-back');
    if (back) back.addEventListener('click', () => {
      exit();
      Router.go('/');
    });
  }

  // Renders the 404 card when enter(username) returned null. Used by
  // every friend view's mount() before bailing out without renderer init.
  function render404(container, username) {
    container.innerHTML = `
      <div class="friend-404">
        <div class="friend-404-card">
          <h2>404 — couldn't visit "${_esc(username || '')}"</h2>
          <p>This account doesn't exist or you're not friends with them.</p>
          <button type="button" class="friend-header-back" id="friend-404-back">← Back to mine</button>
        </div>
      </div>
    `;
    const back = container.querySelector('#friend-404-back');
    if (back) back.addEventListener('click', () => Router.go('/'));
  }

  return { enter, exit, isActive, getActive, renderHeader, wireHeader, render404 };
})();
