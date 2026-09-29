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
// - The realistic-character models (MODEL_FILES, a versioned folder whose
//   URLs never change content) → cache-first in their OWN cache, which is
//   kept across deploys. They used to live in the per-build cache, so every
//   release made returning players download ~2.4 MB again. The page can ask
//   for them ahead of time with postMessage({ type: 'warm-models' })
//   (js/humanoid-prefetch.js).
const CACHE_VERSION = '__CACHE_VERSION__';
const PRECACHE = __PRECACHE__;
const MODEL_CACHE = '__MODEL_CACHE__';
const MODEL_FILES = __MODEL_FILES__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_VERSION && k !== MODEL_CACHE).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// Fill the model cache ahead of time (only files not already in it).
self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'warm-models') return;
  event.waitUntil(
    caches.open(MODEL_CACHE).then((cache) => Promise.all(MODEL_FILES.map(async (f) => {
      if (await cache.match(f)) return;
      try {
        const res = await fetch(f);
        if (res && res.status === 200) await cache.put(f, res);
      } catch (_) { /* offline — the page loads them itself later */ }
    })))
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

  // Character models — cache-first from the long-lived model cache.
  if (MODEL_FILES.includes(url.pathname)) {
    event.respondWith(
      caches.open(MODEL_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res && res.status === 200) event.waitUntil(cache.put(req, res.clone()));
        return res;
      })
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
