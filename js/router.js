/************************************************
 * SPA ROUTER
 * Handles client-side navigation between views.
 *
 * Supports two route shapes:
 *   - exact paths: '/', '/profile', '/home', etc.
 *   - parameterized paths: '/friend/:username', '/friend/:username/map'
 * Matched parameters are passed to view.mount(container, params).
 ************************************************/
const Router = (() => {
  // Two stores so exact-match wins over patterns regardless of insertion order.
  const exactRoutes = {};
  const patternRoutes = [];   // [{ pattern: '/friend/:username', view, parts: [...] }]
  let currentView = null;
  let appContainer = null;

  // Routes anyone can reach without being logged in. Every other route
  // gets force-redirected to /login by the auth gate inside navigate().
  // Keep this list tight — adding a route here exposes it to anonymous
  // visitors. The per-view auth checks remain as a backup so a future
  // view that's accidentally added without going through navigate (e.g.
  // a test harness calling view.mount() directly) still self-defends.
  const PUBLIC_ROUTES = new Set(['/login']);

  function register(path, view) {
    if (path.includes(':')) {
      patternRoutes.push({
        pattern: path,
        view,
        parts: path.split('/')
      });
    } else {
      exactRoutes[path] = view;
    }
  }

  // Match `path` against registered pattern routes. Returns { route, params }
  // or null. Patterns and paths are compared segment-by-segment; `:name`
  // segments capture into params. No regex, no nested catch-alls — flat
  // patterns only, which is all the SPA needs.
  function matchPattern(path) {
    const pathParts = path.split('/');
    for (const r of patternRoutes) {
      if (r.parts.length !== pathParts.length) continue;
      const params = {};
      let ok = true;
      for (let i = 0; i < r.parts.length; i++) {
        const seg = r.parts[i];
        if (seg.startsWith(':')) {
          const value = decodeURIComponent(pathParts[i] || '');
          if (!value) { ok = false; break; }
          params[seg.slice(1)] = value;
        } else if (seg !== pathParts[i]) {
          ok = false; break;
        }
      }
      if (ok) return { route: r, params };
    }
    return null;
  }

  function init(containerId) {
    appContainer = document.getElementById(containerId);

    // Handle browser back/forward
    window.addEventListener('popstate', () => navigate(location.pathname, false));

    // Intercept link clicks for SPA navigation
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[data-link]');
      if (link) {
        e.preventDefault();
        navigate(link.getAttribute('href'));
      }
    });

    // Navigate to current URL
    navigate(location.pathname, false);
  }

  // Lazy routes await a chunk download inside navigate(); a navigation that
  // starts while one is in flight supersedes it (see the seq check below).
  let navSeq = 0;

  async function navigate(path, pushState = true) {
    const seq = ++navSeq;
    // Strip query + hash first so "?q=1" and "#section" don't break lookups.
    const qIdx = path.indexOf('?');
    if (qIdx !== -1) path = path.slice(0, qIdx);
    const hIdx = path.indexOf('#');
    if (hIdx !== -1) path = path.slice(0, hIdx);

    // Drop trailing slashes (except for the root "/") so "/profile/" → "/profile".
    if (path.length > 1) path = path.replace(/\/+$/, '');
    // Strip .html suffix and the synthetic /index path.
    if (path.endsWith('.html')) path = path.slice(0, -5);
    if (path === '' || path === '/index' || path === '/index.html') path = '/';

    // Auto-exit FriendView when leaving any /friend/* route. This catches
    // address-bar navigation, browser back/forward, and clicks on
    // non-friend links — without it, friend state.data + walker overrides
    // would leak into the user's own views. Called even when not yet active
    // so a friend load still in flight is cancelled too.
    if (typeof FriendView !== 'undefined' && !path.startsWith('/friend/')) {
      FriendView.exit();
    }

    // Auth gate. If the user isn't logged in and asked for anything other
    // than a public route, force-redirect to /login. Use replaceState (not
    // push) so the unauthorized URL doesn't sit in the browser history —
    // the back button won't take them back into the gated route.
    let redirectedToLogin = false;
    const authReady = typeof Auth !== 'undefined';
    if (authReady && !PUBLIC_ROUTES.has(path) && !Auth.isLoggedIn()) {
      path = '/login';
      redirectedToLogin = true;
    }

    // Resolve route — exact match first, then pattern match.
    let entry = exactRoutes[path];
    let params = {};
    let matched = null;
    if (!entry) {
      matched = matchPattern(path);
      if (matched) { entry = matched.route.view; params = matched.params; }
    }
    if (!entry) {
      // Last resort: go to /
      if (path !== '/' && exactRoutes['/']) {
        navigate('/', pushState);
      }
      return;
    }

    // A route registered with a function is lazy: the function loads its
    // chunk (boot.js + chunk-loader.js) and resolves to the view object.
    // The result is memoized onto the route so the await happens once.
    let view = entry;
    if (typeof entry === 'function') {
      try {
        view = await entry();
      } catch (err) {
        console.error('[router] chunk load failed for', path, err);
        _reloadOnce(path);
        return;
      }
      if (seq !== navSeq) return;   // superseded while the chunk downloaded
      if (matched) matched.route.view = view; else exactRoutes[path] = view;
      try { sessionStorage.removeItem('mcu-chunk-reload'); } catch (_) {}
    }

    // Skip if already on this view AND no params changed (so /friend/kevin →
    // /friend/elsid still re-mounts even though both resolve to FriendWatchView).
    const sameView = view === currentView;
    const sameParams = sameView && _shallowEqualParams(currentView._params, params);
    if (sameView && sameParams && pushState) return;

    if (redirectedToLogin) {
      // Rewrite the URL to /login without a new history entry.
      if (location.pathname !== '/login') {
        history.replaceState(null, '', '/login');
      }
    } else if (pushState) {
      history.pushState(null, '', path);
    }

    // Unmount current view
    if (currentView && currentView.unmount) {
      currentView.unmount();
    }

    // Clear container
    appContainer.innerHTML = '';

    // Mount new view (with params for parameterized routes — existing
    // exact-route views ignore the second argument).
    currentView = view;
    currentView._params = params;
    document.title = view.title || 'MCU Tracker';
    view.mount(appContainer, params);
  }

  // A chunk URL that fails to load usually means a deploy happened while
  // this tab was open: its manifest points at hashes that no longer exist.
  // One full page load picks up the new shell; the sessionStorage guard
  // stops a genuinely broken build from reload-looping.
  function _reloadOnce(path) {
    const key = 'mcu-chunk-reload';
    let last = null;
    try { last = sessionStorage.getItem(key); } catch (_) {}
    if (last === path) {
      console.error('[router] chunk still failing after a reload — giving up on', path);
      return;
    }
    try { sessionStorage.setItem(key, path); } catch (_) {}
    location.assign(path);
  }

  function _shallowEqualParams(a, b) {
    a = a || {}; b = b || {};
    const ak = Object.keys(a), bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) if (a[k] !== b[k]) return false;
    return true;
  }

  // Helper for programmatic navigation (replaces window.location.href)
  function go(path) {
    navigate(path);
  }

  return { register, init, navigate, go };
})();
