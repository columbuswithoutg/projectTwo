/************************************************
 * CHUNK LOADER
 *
 * The build (scripts/build.mjs) concatenates the app into a few classic
 * scripts: `core` (always loaded by spa.html) plus lazy chunks — `world`
 * (Three.js engine, sockets, voice, the 3D views) and `admin`. Because
 * every file shares state through top-level declarations in the global
 * scope, a chunk is loaded by inserting ordinary <script> tags, exactly
 * as spa.html used to do for all 60+ files. Once a chunk's scripts have
 * run, its globals (HomeView, Playground3D, …) resolve like any other.
 *
 * Which files a chunk holds, and their hashed URLs, come from the JSON
 * manifest the build writes into spa.html:
 *   <script type="application/json" id="chunk-manifest">
 *     { "world": { "scripts": [...], "modules": [...] }, "admin": { "scripts": [...] } }
 *   </script>
 * `scripts` are classic scripts, loaded in order (async=false keeps
 * insertion order even though they fetch in parallel). `modules` are ES
 * modules injected fire-and-forget AFTER the scripts have executed — used
 * for the Three.js shim (js/three-shim.mjs), so an unpkg outage slows the 3D views down but
 * never blocks navigation (Playground3D waits for 'three-ready' itself).
 *
 * Chunks.load(name) → Promise. Deduped per name; a failed load clears the
 * entry so the next navigation retries (the router falls back to a full
 * page load, which also picks up a new deploy's hashes).
 ************************************************/
const Chunks = (() => {
  let manifest = null;
  const pending = new Map();   // name -> Promise
  const done = new Set();

  function _manifest() {
    if (manifest) return manifest;
    const el = document.getElementById('chunk-manifest');
    try { manifest = el ? JSON.parse(el.textContent) : {}; } catch (_) { manifest = {}; }
    return manifest;
  }

  function _script(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('chunk script failed to load: ' + src));
      document.head.appendChild(s);
    });
  }

  // attempt > 0 (a retry) adds ?r=attempt: browsers memoise a failed module
  // fetch per URL for the page's lifetime, so only a new URL refetches.
  function _module(src, attempt) {
    const url = attempt ? src + (src.indexOf('?') === -1 ? '?' : '&') + 'r=' + attempt : src;
    if (document.querySelector('script[type="module"][src="' + url + '"]')) return;
    const s = document.createElement('script');
    s.type = 'module';
    s.src = url;
    s.onerror = () => {
      console.warn('[chunks] module failed to load', url);
      // Drop the dead element (the dedupe check above would otherwise match
      // it forever) and say so: the only lazy module is the Three.js shim,
      // and a failed fetch of it — or of a STATIC import inside it — surfaces
      // only here. Playground3D listens for 'three-failed' to show Retry.
      if (s.parentNode) s.parentNode.removeChild(s);
      // The shim never ran, so nothing else records the outcome: a mount that
      // starts AFTER this event checks window.__threeCore and would otherwise
      // sit out the full THREE_WAIT_MS before showing Retry.
      try { window.__threeCore = 'failed'; } catch (_) {}
      try {
        window.dispatchEvent(new CustomEvent('three-failed', { detail: { error: new Error('module failed to load: ' + url) } }));
      } catch (_) {}
    };
    document.head.appendChild(s);
  }

  // Re-inject a loaded chunk's modules under a fresh URL (Playground3D's
  // "3D engine couldn't load — Retry"). → false when there's nothing to retry.
  const moduleTries = new Map();   // name -> retry count
  function retryModules(name) {
    const spec = _manifest()[name];
    if (!spec || !done.has(name) || !(spec.modules || []).length) return false;
    const n = (moduleTries.get(name) || 0) + 1;
    moduleTries.set(name, n);
    // Clear a 'failed' left by the last attempt (ours or the shim's) so a
    // mount during the retry waits for the new outcome instead of failing at once.
    try { window.__threeCore = 'loading'; } catch (_) {}
    spec.modules.forEach((src) => _module(src, n));
    return true;
  }

  function load(name) {
    if (done.has(name)) return Promise.resolve();
    if (pending.has(name)) return pending.get(name);
    const spec = _manifest()[name];
    if (!spec) return Promise.reject(new Error('unknown chunk: ' + name));
    const p = Promise.all((spec.scripts || []).map(_script))
      .then(() => {
        (spec.modules || []).forEach((src) => _module(src, 0));
        done.add(name);
        pending.delete(name);
      })
      .catch((err) => {
        pending.delete(name);
        throw err;
      });
    pending.set(name, p);
    return p;
  }

  return { load, retryModules, isLoaded: (name) => done.has(name) };
})();
