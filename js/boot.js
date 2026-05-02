// Extracted from spa.html so the <script> tag can use `defer` — inline
// scripts don't respect defer, which forced every other script above them
// to run synchronously.
// Phase 3: fetch content from server before mounting any view, so the
// SPA renders against the latest DB version of projects/characters/
// locations/dialogues. Promise.allSettled means a single failed endpoint
// (or full server unreachability) doesn't block the others — each one
// that succeeds replaces its global, each that fails leaves the static-
// file fallback in place.
async function bootContent() {
  const endpoints = ['projects', 'characters', 'locations', 'dialogues'];
  const results = await Promise.allSettled(endpoints.map(name =>
    fetch(`${API}/content/${name}`).then(r => r.ok ? r.json() : null)
  ));
  const [projRes, charRes, locRes, dialRes] = results.map(r => r.status === 'fulfilled' ? r.value : null);

  if (projRes && Array.isArray(projRes.items) && projRes.items.length) {
    window.projects = projRes.items;
  }
  if (charRes && Array.isArray(charRes.items) && charRes.items.length) {
    window.characters = charRes.items;
  }
  if (locRes && Array.isArray(locRes.items) && locRes.items.length) {
    window.LOCATIONS = locRes.items;
  }
  if (dialRes && dialRes.data && typeof WALKER_DIALOGUES?.applyData === 'function') {
    WALKER_DIALOGUES.applyData(dialRes.data);
  }
}

bootContent().catch(() => { /* fallbacks already in place */ }).finally(() => {
  Router.register('/', WatchOrderView);
  Router.register('/map', AppView);
  Router.register('/login', LoginView);
  Router.register('/profile', ProfileView);
  Router.register('/characters', CharactersView);
  Router.register('/home', HomeView);
  Router.register('/admin', AdminView);
  Router.init('app');
});

// Fetch admin-tunable walker physics from the server in parallel with
// boot. Walkers.applyConfig merges into PHYSICS so the next frame uses
// the new values. Wrapped in try/catch and ignores network errors so
// a Mongo blip can never block the SPA from booting — the hardcoded
// PHYSICS defaults already give a working game.
fetch(`${API}/config/public`)
  .then(r => r.ok ? r.json() : null)
  .then(cfg => {
    if (cfg && typeof Walkers !== 'undefined') {
      Walkers.applyConfig(cfg);
      Walkers.applyFlagDefaults(cfg.flags || {});
    }
  })
  .catch(() => { /* offline / blocked — defaults are fine */ });

// Best-effort flush of the debounced progress save when the tab is hidden or
// closed — pagehide fires on mobile Safari where beforeunload does not.
// The fetch inside _persistNow uses keepalive so the browser preserves it
// across the navigation.
window.addEventListener('pagehide', () => state?.flushPersist?.());
