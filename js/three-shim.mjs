// Three.js bridge for the classic-script 3D engine (js/playground3d.js).
//
// This is an ES module — the only one in the app. It used to be inline in
// spa.html, which meant every page (login included) waited on the unpkg
// fetch before any deferred script could run: a parser-inserted module
// script and classic `defer` scripts share one in-order execution list, and
// the module isn't "ready" until its whole import graph has downloaded.
// Now the chunk loader injects this file only when the world chunk loads
// (see js/chunk-loader.js), AFTER that chunk's classic scripts have run, so
// the 'three-ready' listeners below already exist when the event fires.
//
// `three` and `three/addons/` resolve through the importmap that stays
// inline in spa.html. Exposes window.THREE (+ RoundedBoxGeometry) and
// dispatches 'three-ready'; then, separately, GLTFLoader + SkeletonUtils
// with 'three-addons-ready' / 'three-addons-failed' so a slow or failed
// addon fetch can never delay or break the engine (characters just stay
// procedural). window.__threeAddons records that outcome for anyone who
// starts listening after the event has already fired.
//
// The ONE place the Three.js version lives in JS. spa.html's importmap must
// repeat it as a literal (an importmap is static JSON, read before any module
// runs); test/three-version.test.js fails if the two ever disagree.
export const THREE_VERSION = '0.160.0';
const UNPKG = 'https://unpkg.com/three@' + THREE_VERSION + '/';

// Dynamic imports, not static ones: a failed static `import` rejects this
// whole module before a line of it runs, so nothing could report it and the
// 3D views sat on their spinner forever. Here a failure is caught and
// announced as 'three-failed' (detail.error), which Playground3D turns into a
// Retry message; window.__threeCore records the outcome for late listeners.
// (The chunk loader also dispatches 'three-failed' when THIS file can't be
// fetched.) RoundedBoxGeometry lives in examples/jsm; its internal
// `import 'three'` resolves through the importmap. It is attached onto the
// THREE namespace copy we expose so the classic-script engine can use it like
// core geometry.
const ns = {};
window.__threeCore = 'loading';
Promise.all([
  import('three'),
  import(UNPKG + 'examples/jsm/geometries/RoundedBoxGeometry.js')
]).then(([THREE, rbg]) => {
  Object.assign(ns, THREE, { RoundedBoxGeometry: rbg.RoundedBoxGeometry });
  window.THREE = ns;
  window.__threeCore = 'ready';
  window.dispatchEvent(new Event('three-ready'));
  loadAddons();
}).catch((error) => {
  console.error('[three] Three.js failed to load', error);
  window.__threeCore = 'failed';
  window.dispatchEvent(new CustomEvent('three-failed', { detail: { error } }));
});

// Browsers cache a FAILED module fetch per URL, so a retry must use a new URL:
// attempt n > 0 imports the absolute unpkg path with ?r=n. (Their internal
// `import 'three'` still resolves through the importmap.)
const ADDON_BASE = UNPKG + 'examples/jsm/';
let _addonTry = 0;
function loadAddons() {
  const n = _addonTry;
  const url = (path) => (n ? ADDON_BASE + path + '?r=' + n : 'three/addons/' + path);
  window.__threeAddons = 'loading';
  return Promise.all([
    import(url('loaders/GLTFLoader.js')),
    import(url('utils/SkeletonUtils.js'))
  ]).then(([gltf, skel]) => {
    ns.GLTFLoader = gltf.GLTFLoader;
    ns.SkeletonUtils = skel;
    window.__threeAddons = 'ready';
    window.dispatchEvent(new Event('three-addons-ready'));
  }).catch((err) => {
    console.warn('[three] addons unavailable — characters stay procedural', err);
    window.__threeAddons = 'failed';
    window.dispatchEvent(new Event('three-addons-failed'));
  });
}
// PG3DHumanoid.retry() calls this after a failure (the Retry toast).
window.__retryThreeAddons = () => {
  if (window.__threeAddons !== 'failed') return Promise.resolve();
  _addonTry += 1;
  return loadAddons();
};
