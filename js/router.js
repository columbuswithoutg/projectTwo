/************************************************
 * SPA ROUTER
 * Handles client-side navigation between views
 ************************************************/
const Router = (() => {
  const routes = {};
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
    routes[path] = view;
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

  function navigate(path, pushState = true) {
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

    const view = routes[path];
    if (!view) {
      // Last resort: go to /
      if (path !== '/' && routes['/']) {
        navigate('/', pushState);
      }
      return;
    }

    // Skip if already on this view
    if (view === currentView && pushState) return;

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

    // Mount new view
    currentView = view;
    document.title = view.title || 'MCU Tracker';
    view.mount(appContainer);
  }

  // Helper for programmatic navigation (replaces window.location.href)
  function go(path) {
    navigate(path);
  }

  return { register, init, navigate, go };
})();
