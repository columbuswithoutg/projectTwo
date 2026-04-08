/************************************************
 * SPA ROUTER
 * Handles client-side navigation between views
 ************************************************/
const Router = (() => {
  const routes = {};
  let currentView = null;
  let appContainer = null;

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
    // Normalize path
    if (path.endsWith('.html')) {
      path = path.replace('.html', '').replace('/index', '/');
    }
    if (path === '' || path === '/index') path = '/';

    const view = routes[path];
    if (!view) {
      // Fallback: try without trailing slash
      const stripped = path.replace(/\/$/, '');
      if (stripped && stripped !== path && routes[stripped]) {
        navigate(stripped, pushState);
        return;
      }
      // Last resort: go to /
      if (path !== '/' && routes['/']) {
        navigate('/', pushState);
      }
      return;
    }

    // Skip if already on this view
    if (view === currentView && pushState) return;

    if (pushState) {
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
