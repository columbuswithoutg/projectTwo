// Minimal service worker for the MCU Tracker SPA shell.
// - Precaches the SPA shell + static fallback data so an offline visit still
//   renders the app skeleton (auth-gated views won't function without /api,
//   but the shell, router, and views load).
// - Stale-while-revalidate for /js/* and /assets/* — repeat visits are
//   instant; new deploys update on the second load.
// - Network-only for /api/* — auth-sensitive responses are never cached.
// Bump CACHE_VERSION whenever the precache list or strategy changes.

const CACHE_VERSION = 'mcu-v6'; // v6: punch + knockdown, node-prompt feature removed
const PRECACHE = [
  '/',
  '/spa.html',
  '/styles.css',
  '/projects.js',
  '/characters.js',
  '/locations.js',
  '/assets/favicon.jpg',
  '/assets/avengers-logo.svg',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API or auth-sensitive paths.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) {
    return;
  }

  // Navigation requests — try network first, fall back to cached shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/spa.html'))
    );
    return;
  }

  // Stale-while-revalidate for static assets and JS modules.
  if (url.pathname.startsWith('/js/') || url.pathname.startsWith('/assets/') ||
      PRECACHE.includes(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(req);
        const networkFetch = fetch(req).then((res) => {
          if (res && res.status === 200) cache.put(req, res.clone());
          return res;
        }).catch(() => cached);
        return cached || networkFetch;
      })
    );
  }
});
