/************************************************
 * HUMANOID PREFETCH — warm the realistic-character models early
 *
 * The /world, /home and friend-home scenes wait behind a loading cover until
 * the rigged bodies are ready (js/playground3d.js _waitForCharacters). This
 * starts the ~2.4 MB download long before anyone gets there: once the app
 * has loaded, the user is logged in and the browser is idle, it asks the
 * service worker to fill its model cache (sw.js 'warm-models' — a cache that
 * survives deploys) or, before a worker controls the page, fetches the files
 * at low priority into the HTTP cache. Skipped on Data Saver / 2G and for
 * ?rig=legacy.
 *
 * __MODEL_BASE__ is filled in by scripts/build.mjs from
 * PG3DHumanoidLogic.ASSET_BASE, so the two can't drift.
 ************************************************/
(function (root) {
  const BASE = (typeof __MODEL_BASE__ !== 'undefined') ? __MODEL_BASE__ : '/assets/models/humanoid/v1/';
  let done = false;

  function constrained() {
    const c = navigator.connection;
    return !!(c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || '')));
  }

  function legacyRig() {
    try {
      return /[?&]rig=legacy\b/.test(location.search) || localStorage.getItem('pg3dRig') === 'legacy';
    } catch (_) { return false; }
  }

  function warmNow() {
    if (done) return;
    if (typeof Auth === 'undefined' || !Auth.isLoggedIn || !Auth.isLoggedIn()) return;
    if (constrained() || legacyRig()) return;
    done = true;
    const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (sw) { sw.postMessage({ type: 'warm-models' }); return; }
    fetch(BASE + 'manifest.json').then((r) => (r.ok ? r.json() : null)).then((m) => {
      if (!m) return;
      const files = [
        ...Object.values(m.bodies || {}).map((b) => b && b.file),
        m.hair && m.hair.file,
        m.anims && m.anims.file
      ].filter(Boolean);
      for (const f of files) fetch(BASE + f, { priority: 'low' }).catch(() => {});
    }).catch(() => {});
  }

  // Wait for an idle moment so it never competes with the page's own loading.
  function warm() {
    if (done) return;
    const idle = root.requestIdleCallback || ((fn) => setTimeout(fn, 2500));
    idle(warmNow, { timeout: 8000 });
  }

  if (document.readyState === 'complete') warm();
  else root.addEventListener('load', warm, { once: true });

  // The login view calls this once a session starts (no page reload there).
  root.HumanoidPrefetch = { warm };
})(typeof self !== 'undefined' ? self : this);
