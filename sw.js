// Service worker for the MCU Tracker SPA shell.
//
// THIS FILE IS A TEMPLATE. scripts/build.mjs reads it and writes dist/sw.js
// with __CACHE_VERSION__ and __PRECACHE__ filled in from the build's content
// hashes. Never edit dist/sw.js by hand — and there is no manual version
// bump any more: any change to any built file changes CACHE_VERSION, and the
// activate handler drops every older cache.
//
// - Precaches the shell (spa.html, the core bundle, the stylesheet, icons and
//   the manifest) so an offline visit still renders the app skeleton.
// - /dist/* files carry a content hash in their name → cache-first, kept
//   until the version changes. Lazy chunks (world, admin) land here on first
//   use.
// - /assets/* → stale-while-revalidate. event.waitUntil keeps the worker
//   alive until the refreshed copy is written; without it the browser could
//   kill the worker first, the cache never updated, and a returning phone ran
//   old files ("blank map when reopened on Chrome").
// - /api/* and /socket.io/* → network only, never cached.
const CACHE_VERSION = '__CACHE_VERSION__';
const PRECACHE = __PRECACHE__;

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

  // Navigation requests — network first, fall back to the cached shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/spa.html'))
    );
    return;
  }

  // Hashed build output — cache-first. A given URL never changes content.
  if (url.pathname.startsWith('/dist/')) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res && res.status === 200) event.waitUntil(cache.put(req, res.clone()));
        return res;
      })
    );
    return;
  }

  // Stale-while-revalidate for images/models and the precached shell files.
  if (url.pathname.startsWith('/assets/') || PRECACHE.includes(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(req);
        const networkFetch = fetch(req).then((res) => {
          if (res && res.status === 200) event.waitUntil(cache.put(req, res.clone()));
          return res;
        });
        if (cached) {
          event.waitUntil(networkFetch.catch(() => {}));
          return cached;
        }
        return networkFetch;
      })
    );
  }
});
