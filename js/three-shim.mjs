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
import * as THREE from 'three';
// RoundedBoxGeometry lives in examples/jsm; its internal `import 'three'`
// resolves through the importmap. Attached onto the THREE namespace copy we
// expose so the classic-script engine can use it like core geometry.
import { RoundedBoxGeometry } from 'https://unpkg.com/three@0.160.0/examples/jsm/geometries/RoundedBoxGeometry.js';

const ns = { ...THREE, RoundedBoxGeometry };
window.THREE = ns;
window.dispatchEvent(new Event('three-ready'));

Promise.all([
  import('three/addons/loaders/GLTFLoader.js'),
  import('three/addons/utils/SkeletonUtils.js')
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
