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

  function _module(src) {
    if (document.querySelector('script[type="module"][src="' + src + '"]')) return;
    const s = document.createElement('script');
    s.type = 'module';
    s.src = src;
    s.onerror = () => console.warn('[chunks] module failed to load', src);
    document.head.appendChild(s);
  }

  function load(name) {
    if (done.has(name)) return Promise.resolve();
    if (pending.has(name)) return pending.get(name);
    const spec = _manifest()[name];
    if (!spec) return Promise.reject(new Error('unknown chunk: ' + name));
    const p = Promise.all((spec.scripts || []).map(_script))
      .then(() => {
        (spec.modules || []).forEach(_module);
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

  return { load, isLoaded: (name) => done.has(name) };
})();
