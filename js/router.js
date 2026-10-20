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

    // Every in-app history entry carries its position (history.state.idx), so
    // back() can tell "there is an in-app page behind us" from "this tab
    // started here" — history.length counts other sites too.
    const st = history.state;
    _idx = (st && Number.isInteger(st.idx)) ? st.idx : 0;
    if (!st || !Number.isInteger(st.idx)) {
      try { history.replaceState({ idx: 0 }, '', location.href); } catch (_) {}
    }

    // Handle browser back/forward
    window.addEventListener('popstate', () => {
      const s = history.state;
      _idx = (s && Number.isInteger(s.idx)) ? s.idx : 0;
      navigate(location.pathname + location.search + location.hash, false);
    });

    // Reload / tab close with unsaved work: the browser's own "Leave site?"
    // prompt. Views opt in with isDirty().
    window.addEventListener('beforeunload', (e) => {
      let dirty = false;
      try { dirty = !!(currentView && currentView.isDirty && currentView.isDirty()); } catch (_) {}
      if (dirty) { e.preventDefault(); e.returnValue = ''; }
    });

    // Intercept link clicks for SPA navigation
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[data-link]');
      if (link) {
        e.preventDefault();
        navigate(link.getAttribute('href'));
      }
    });

    // Navigate to current URL
    navigate(location.pathname + location.search + location.hash, false);
  }

  // Lazy routes await a chunk download inside navigate(); a navigation that
  // starts while one is in flight supersedes it (see the seq check below).
  let navSeq = 0;
  // The full URL (path + query + hash) of the mounted view — put back in the
  // address bar when a Back/Forward is vetoed by the leave guard.
  let currentUrl = null;
  // Position of the current entry in this tab's in-app history (see init).
  let _idx = 0;

  // Loading state while a lazy route downloads its chunk: #app[aria-busy]
  // plus the thin top bar (#route-progress, spa.html), shown only after
  // 150 ms so a cached chunk never flashes it.
  let _loading = 0;
  let _barTimer = null;
  function _setLoading(on) {
    _loading = Math.max(0, _loading + (on ? 1 : -1));
    const busy = _loading > 0;
    if (appContainer) appContainer.setAttribute('aria-busy', String(busy));
    clearTimeout(_barTimer);
    const bar = document.getElementById('route-progress');
    if (!bar) return;
    if (busy) {
      _barTimer = setTimeout(() => { bar.classList.add('active'); bar.setAttribute('aria-hidden', 'false'); }, 150);
    } else {
      bar.classList.remove('active');
      bar.setAttribute('aria-hidden', 'true');
    }
  }

  // Resolves once the FIRST view has mounted (or the first navigation gave
  // up) — boot.js keeps the splash up until then, so a direct load of a lazy
  // route (/world, /admin) shows the splash instead of a blank page while
  // its chunk downloads.
  let _firstResolve = null;
  const firstMount = new Promise((resolve) => { _firstResolve = resolve; });
  function _firstDone() {
    if (_firstResolve) { _firstResolve(); _firstResolve = null; }
  }

  // opts.force skips the leave guard (a view leaving after its own save).
  async function navigate(path, pushState = true, opts = {}) {
    const seq = ++navSeq;
    // Route on the bare path, but keep the query + hash for the address bar:
    // views read location.search (/messages?with=…, /reports?report=…), and
    // pushing the stripped path used to drop it on every in-app link.
    let search = '', hash = '';
    const hIdx = path.indexOf('#');
    if (hIdx !== -1) { hash = path.slice(hIdx); path = path.slice(0, hIdx); }
    const qIdx = path.indexOf('?');
    if (qIdx !== -1) { search = path.slice(qIdx); path = path.slice(0, qIdx); }
    if (search === '?') search = '';
    if (hash === '#') hash = '';

    // Drop trailing slashes (except for the root "/") so "/profile/" → "/profile".
    if (path.length > 1) path = path.replace(/\/+$/, '');
    // Strip .html suffix and the synthetic /index path.
    if (path.endsWith('.html')) path = path.slice(0, -5);
    if (path === '' || path === '/index' || path === '/index.html') path = '/';
    const fullUrl = path + search + hash;

    // Leave guard: a view with unsaved work (customize, home editor, the
    // admin board's pending moves) may ask "Discard changes?" first.
    if (!opts.force && currentView && currentView.canLeave && fullUrl !== currentUrl) {
      let ok = true;
      try { ok = await currentView.canLeave({ to: fullUrl }); } catch (_) { ok = true; }
      if (seq !== navSeq) return;
      if (!ok) {
        // Back/Forward already moved the address bar — put the page we stayed on back.
        if (!pushState && currentUrl && location.pathname + location.search + location.hash !== currentUrl) {
          history.pushState({ idx: ++_idx }, '', currentUrl);
        }
        return;
      }
    }

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
    // The page they asked for travels along as ?next= so the login view can
    // send them back to it (js/ux-logic.js safeNextUrl keeps it in-app).
    let redirectedToLogin = false;
    let loginUrl = '/login';
    const authReady = typeof Auth !== 'undefined';
    if (authReady && !PUBLIC_ROUTES.has(path) && !Auth.isLoggedIn()) {
      if (fullUrl !== '/') loginUrl += '?next=' + encodeURIComponent(fullUrl);
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
      // Last resort: go to / (replacing the unknown URL, so Back doesn't loop).
      if (path !== '/' && exactRoutes['/']) {
        navigate('/', true, { replace: true });
      } else {
        _firstDone();
      }
      return;
    }

    // A route registered with a function is lazy: the function loads its
    // chunk (boot.js + chunk-loader.js) and resolves to the view object.
    // The result is memoized onto the route so the await happens once.
    let view = entry;
    if (typeof entry === 'function') {
      _setLoading(true);
      try {
        view = await entry();
      } catch (err) {
        console.error('[router] chunk load failed for', path, err);
        _firstDone();
        _reloadOnce(fullUrl);
        return;
      } finally {
        _setLoading(false);
      }
      if (seq !== navSeq) return;   // superseded while the chunk downloaded
      if (matched) matched.route.view = view; else exactRoutes[path] = view;
      try { sessionStorage.removeItem('mcu-chunk-reload'); } catch (_) {}
    }

    // Skip if already on this view AND no params or query changed (so
    // /friend/kevin → /friend/elsid still re-mounts even though both resolve
    // to FriendWatchView, and /messages → /messages?with=x opens the thread).
    const sameView = view === currentView;
    const sameParams = sameView && _shallowEqualParams(currentView._params, params);
    const sameSearch = currentUrl != null && currentUrl.split('#')[0] === path + search;
    if (sameView && sameParams && sameSearch && pushState) return;

    if (redirectedToLogin) {
      // Rewrite the URL to /login (+ ?next=) without a new history entry.
      if (location.pathname + location.search !== loginUrl) {
        history.replaceState({ idx: _idx }, '', loginUrl);
      }
    } else if (pushState && opts.replace) {
      history.replaceState({ idx: _idx }, '', fullUrl);
    } else if (pushState) {
      history.pushState({ idx: ++_idx }, '', fullUrl);
    }

    // A dialog must not float over the next page (a project popup left open
    // by Back used to stay on screen).
    if (typeof closeAllModals === 'function') closeAllModals();

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
    currentUrl = redirectedToLogin ? loginUrl : fullUrl;
    document.title = view.title || 'MCU Tracker';
    view.mount(appContainer, params);
    _firstDone();
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

  // Helper for programmatic navigation (replaces window.location.href).
  // opts.force skips the current view's leave guard; opts.replace swaps the
  // current history entry instead of adding one.
  function go(path, opts) {
    return navigate(path, true, opts || {});
  }

  // "← Back" buttons: the previous in-app page when there is one, otherwise
  // `fallback` (a page opened in a new tab has nothing behind it). Replaces
  // the entry so Back from the fallback doesn't return to the page we left.
  function back(fallback) {
    if (_idx > 0) { history.back(); return Promise.resolve(); }
    return navigate(fallback || '/', true, { replace: true });
  }

  // Does the mounted view hold unsaved work? (The service-worker update
  // prompt asks before reloading.)
  function currentIsDirty() {
    try { return !!(currentView && currentView.isDirty && currentView.isDirty()); } catch (_) { return false; }
  }

  // Shared "Discard changes?" for views' canLeave(): resolves true to leave.
  function confirmLeave(message) {
    if (typeof confirmDialog !== 'function') return Promise.resolve(true);
    return confirmDialog({
      title: 'Discard unsaved changes?',
      message: message || 'Your changes on this page haven’t been saved.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
      danger: true
    });
  }

  return { register, init, navigate, go, back, confirmLeave, firstMount, currentIsDirty, isLoading: () => _loading > 0 };
})();
