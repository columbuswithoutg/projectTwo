// Extracted from spa.html so the <script> tag can use `defer` — inline
// scripts don't respect defer, which forced every other script above them
// to run synchronously.
// Phase 3: fetch content from server before mounting any view, so the
// SPA renders against the latest DB version of projects/characters/
// locations/dialogues. Promise.allSettled means a single failed endpoint
// (or full server unreachability) doesn't block the others — each one
// that succeeds replaces its global, each that fails leaves the static-
// file fallback in place.
// Normalized signature of a content list — ignores Mongo bookkeeping
// fields so "same content, different envelope" doesn't count as a change.
function contentSig(arr) {
  try {
    return JSON.stringify(arr.map(item => {
      const { _id, __v, createdAt, updatedAt, ...rest } = item;
      return rest;
    }));
  } catch (_) { return null; }
}

// Fetch the live DB content and overwrite the static-file globals.
// Returns true if anything meaningfully changed (→ content views remount).
async function bootContent() {
  const endpoints = ['projects', 'characters', 'locations', 'dialogues'];
  // 4s cap per fetch: a cold/hung server must never hold a refresh hostage —
  // the static-file fallbacks are already rendered. Feature-checked so an
  // older browser degrades to no-timeout instead of a TypeError.
  const fetchOpts = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout)
    ? () => ({ signal: AbortSignal.timeout(4000) })
    : () => ({});
  const results = await Promise.allSettled(endpoints.map(name =>
    fetch(`${API}/content/${name}`, fetchOpts())
      .then(r => r.ok ? r.json() : null)
  ));
  const [projRes, charRes, locRes, dialRes] = results.map(r => r.status === 'fulfilled' ? r.value : null);

  let changed = false;
  const swap = (res, key) => {
    if (!res || !Array.isArray(res.items) || !res.items.length) return;
    if (contentSig(res.items) !== contentSig(window[key])) changed = true;
    window[key] = res.items;
  };
  swap(projRes, 'projects');
  swap(charRes, 'characters');
  swap(locRes, 'LOCATIONS');
  if (dialRes && dialRes.data && typeof WALKER_DIALOGUES?.applyData === 'function') {
    // Dialogue swaps never need a view remount — walkers read live.
    WALKER_DIALOGUES.applyData(dialRes.data);
  }
  return changed;
}

// Mount IMMEDIATELY against the bundled static fallback data — the live
// content fetch runs in the background and only re-renders when the DB
// copy actually differs. (Boot used to block on the fetch; a cold server
// meant seconds of splash for content that rarely changes.)
Router.register('/', WatchOrderView);
Router.register('/map', AppView);
Router.register('/login', LoginView);
Router.register('/profile', ProfileView);
Router.register('/characters', CharactersView);
Router.register('/home', HomeView);
Router.register('/home/edit', HomeEditView);
Router.register('/customize', CustomizeView);
Router.register('/world', WorldView);
Router.register('/admin', AdminView);
Router.register('/friend/:username',         FriendWatchView);
Router.register('/friend/:username/map',     FriendMapView);
Router.register('/friend/:username/home',    FriendHomeView);
Router.register('/friend/:username/profile', FriendProfileView);
Router.init('app');

// First view is mounted — fade the static boot splash out and drop it.
// The setTimeout is a safety net in case transitionend never fires
// (display:none ancestors, reduced-motion transition removal, etc.).
const bootSplash = document.getElementById('boot-splash');
if (bootSplash) {
  bootSplash.classList.add('hide');
  bootSplash.addEventListener('transitionend', () => bootSplash.remove(), { once: true });
  setTimeout(() => { if (bootSplash.parentNode) bootSplash.remove(); }, 600);
}
// The a11y loading announcement lives outside the aria-hidden splash —
// drop it too so screen readers don't keep a stale "Loading…" status.
document.getElementById('boot-splash-status')?.remove();

// Background content refresh. Only the pure content views remount — the
// 3D views (/world, /home) and /customize keep their session and pick up
// fresh content on their next natural mount.
bootContent().then(changed => {
  if (!changed) return;
  const path = location.pathname;
  if (path === '/' || path === '/map' || path === '/characters') {
    Router.navigate(path, false);
  }
}).catch(() => { /* fallbacks already rendered */ });

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
    // Expose global feature flags (e.g. the /world Infinity Stone event) so
    // views can gate on them. Distinct from Walkers' per-user flag defaults —
    // these are read as authoritative global switches.
    if (cfg && cfg.flags) window.APP_FLAGS = cfg.flags;
  })
  .catch(() => { /* offline / blocked — defaults are fine */ });

// Best-effort flush of the debounced progress save when the tab is hidden or
// closed — pagehide fires on mobile Safari where beforeunload does not.
// The fetch inside _persistNow uses keepalive so the browser preserves it
// across the navigation.
window.addEventListener('pagehide', () => state?.flushPersist?.());

// Register the PWA service worker. Runs after load so it never competes with
// first-paint work. Network-only for /api/*, stale-while-revalidate for the
// SPA shell — see sw.js. Registration failure is non-fatal; the app works the
// same without it, just no offline shell or install prompt.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.warn('SW registration failed', err);
    });
  });
}
