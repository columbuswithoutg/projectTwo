/************************************************
 * HOME — CHARACTER BUILDER (navigation shim)
 *
 * The character builder is now a dedicated full page at /customize
 * (js/views/customize.js). This module keeps the legacy `HomeBuilder.open()`
 * entry point so existing call sites — the ✎ menu and drawer button in
 * /home, /map, and /, plus the first-visit auto-open in HomeView — all route
 * to the new page instead of opening a modal.
 *
 * The router strips query strings, so the caller's current route is stashed on
 * window.__czReturn; the /customize page reads it to navigate back after
 * Save/Cancel. The page re-fetches the saved character itself and the origin
 * view re-renders on return, so the old onSave/onCancel callbacks are no
 * longer needed (they're accepted and ignored for backward compatibility).
 ************************************************/
const HomeBuilder = (() => {
  function open(_opts = {}) {
    let here = '/home';
    try {
      if (location && location.pathname) here = location.pathname;
    } catch (_) { /* non-browser context */ }
    if (typeof here !== 'string' || here[0] !== '/' || here === '/customize') here = '/home';
    window.__czReturn = here;
    if (typeof Router !== 'undefined' && Router.go) Router.go('/customize');
  }

  return { open };
})();
