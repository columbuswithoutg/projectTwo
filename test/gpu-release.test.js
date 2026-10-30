/************************************************
 * 3D2-07: the caches that outlive a mount (poster textures, the lamp glow,
 * the modules' shared geometries / materials / textures) carry a 'dispose'
 * listener from every WebGLRenderer that drew them, so they kept every
 * disposed renderer reachable. three r160's dispose() only runs those
 * listeners (each renderer frees its GL copy and drops its listener) and the
 * object stays usable, so the engine now disposes the caches once the LAST
 * live renderer goes, through each module's disposeGpu().
 *
 * _releaseSharedGpu is lifted from js/playground3d.js and run with stubs;
 * the modules' disposeGpu run against a fake THREE.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const ENGINE = read('js/playground3d.js');

// A fake THREE: every class makes an object that counts dispose() calls and
// has enough of Object3D / BufferGeometry for the crown and the laurel.
function fakeThree() {
  const made = [];
  const vec = () => ({ x: 0, y: 0, z: 0, set() { return this; }, copy() { return this; }, setScalar() { return this; } });
  class Obj {
    constructor(a, b) {
      made.push(this);
      this.userData = {}; this.children = []; this.disposed = 0;
      this.position = vec(); this.rotation = vec(); this.quaternion = vec();
      const sc = function () { return this; };
      Object.assign(sc, vec());
      this.scale = sc;
      if (a && a.isFakeGeom) { this.geometry = a; this.material = b; this.isMesh = true; }
    }
    add(c) { this.children.push(c); return this; }
    traverse(f) { f(this); for (const c of this.children) c.traverse(f); }
    dispose() { this.disposed++; }
    translate() { return this; }
    rotateX() { return this; }
    clone() { return new Obj(); }
  }
  const THREE = new Proxy({ DoubleSide: 2, FrontSide: 0 }, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k !== 'string') return undefined;
      const geom = /Geometry$/.test(k);
      t[k] = class extends Obj { constructor(...a) { super(...a); if (geom) this.isFakeGeom = true; } };
      return t[k];
    }
  });
  return { THREE, made };
}

test('_releaseSharedGpu: waits for the last live renderer, then disposes every shared cache', () => {
  const m = ENGINE.match(/\n  const _liveRenderers = new Set\(\);\n  function _releaseSharedGpu\(renderer\) \{[\s\S]*?\n  \}\n/);
  assert.ok(m, '_releaseSharedGpu not found');
  const calls = [];
  const tex = (n) => ({ dispose() { calls.push(n); } });
  const mod = (n) => ({ disposeGpu() { calls.push(n); } });
  const ctx = {
    T: tex,
    PG3DAvatar: mod('avatar'), PG3DProps: mod('props'), PG3DScene: mod('scene'),
    PG3DQuote: mod('quote'), PG3DHouse: mod('house'), PG3DHumanoid: { preload() {} }   // no disposeGpu: skipped
  };
  vm.runInNewContext(`
    const _textureCache = new Map([['a.jpg', T('poster:a')], ['b.jpg', T('poster:b')]]);
    let _lampTex = T('lamp');
    ${m[0]}
    this.api = { live: _liveRenderers, release: _releaseSharedGpu };
  `, ctx);
  const { live, release } = ctx.api;
  const world = {}, preview = {}, thumbs = {};
  live.add(world); live.add(preview); live.add(thumbs);
  assert.equal(release(world), false, 'a preview and the thumbnails still draw');
  assert.equal(release(preview), false);
  assert.deepEqual(calls, []);
  assert.equal(release(thumbs), true);
  assert.deepEqual(calls, ['poster:a', 'poster:b', 'lamp', 'avatar', 'props', 'scene', 'quote', 'house']);
  // Every renderer registers when made and releases before it is disposed.
  assert.equal((ENGINE.match(/_liveRenderers\.add\(/g) || []).length, 3, 'engine, preview and thumbnail renderers register');
  assert.match(ENGINE, /_releaseSharedGpu\(_renderer\);[^\n]*\n\s*try \{ _renderer\.dispose\(\); \}/);
  assert.match(ENGINE, /_releaseSharedGpu\(renderer\);\n\s*try \{ renderer\.dispose\(\); \}/);
  assert.match(ENGINE, /_releaseSharedGpu\(_thumbR\);\n\s*try \{ _thumbR\.dispose\(\); \}/);
});

test('PG3DScene / PG3DQuote disposeGpu: the crown and laurel parts are disposed once and still reused', () => {
  globalThis.RoadRouter = globalThis.RoadRouter || require('../js/road-router.js');
  const S = require('../js/playground3d-scene.js');
  const Q = require('../js/playground3d-quote.js');
  const { THREE, made } = fakeThree();
  S.disposeGpu(); Q.disposeGpu();                      // nothing built yet: a no-op
  const c1 = S.makeCrown(THREE), l1 = Q.makeLaurel(THREE);
  const shared = made.filter(o => o.userData.shared);
  assert.ok(shared.length >= 10, 'crown + laurel shared parts: ' + shared.length);
  S.disposeGpu(); Q.disposeGpu();
  for (const o of shared) assert.equal(o.disposed, 1);
  // The parts stay cached: a new crown / laurel reuses the same objects.
  const parts = (g) => { const s = new Set(); g.traverse(o => { if (o.isMesh) { s.add(o.geometry); s.add(o.material); } }); return s; };
  const c2 = S.makeCrown(THREE), l2 = Q.makeLaurel(THREE);
  for (const [a, b] of [[c1, c2], [l1, l2]]) {
    const pa = parts(a);
    for (const p of parts(b)) if (p.userData.shared) assert.ok(pa.has(p), 'same shared part');
  }
});

test('PG3DAvatar / PG3DProps / PG3DHouse / PG3DHumanoid expose disposeGpu over their caches', () => {
  // Avatar: the shared-geometry cache.
  const self = {};
  vm.runInNewContext(read('js/playground3d-avatar.js'), { self, window: {} });
  const g = { userData: {}, n: 0, dispose() { this.n++; } };
  assert.equal(self.PG3DAvatar.sharedGeom('k', () => g), g);
  self.PG3DAvatar.disposeGpu();
  assert.equal(g.n, 1);
  assert.equal(self.PG3DAvatar.sharedGeom('k', () => ({})), g, 'still cached after dispose');
  // Props: the unit cube (built on first use).
  const ctx = {};
  vm.runInNewContext(read('js/playground3d-props.js') + '\nthis.P = PG3DProps;', ctx);
  assert.equal(typeof ctx.P.disposeGpu, 'function');
  ctx.P.disposeGpu();                                  // nothing built: a no-op
  assert.match(read('js/playground3d-props.js'), /function disposeGpu\(\) \{\n\s*if \(UNIT_BOX\) UNIT_BOX\.dispose\(\);/);
  // House: the town's wall / glass textures.
  const H = require('../js/playground3d-house.js');
  assert.equal(typeof H.disposeGpu, 'function');
  H.disposeGpu();
  assert.match(read('js/playground3d-house.js'), /function disposeGpu\(\) \{\n\s*for \(const t of _shared\) t\.dispose\(\);/);
  // Humanoid: models, hair and the baked variants.
  const hum = {};
  vm.runInNewContext(read('js/playground3d-humanoid.js'), { self: hum });
  assert.equal(typeof hum.PG3DHumanoid.disposeGpu, 'function');
  hum.PG3DHumanoid.disposeGpu();                       // nothing loaded: a no-op
  const d = (extra) => Object.assign({ n: 0, dispose() { this.n++; } }, extra);
  const map = d({ isTexture: true }), mat = d({ isMaterial: true, map }), geo = d({});
  const mesh = { geometry: geo, material: mat };
  const tree = { traverse(f) { f(mesh); } };
  const body = d({}), hair = d({}), shell = d({});
  hum.PG3DHumanoid._debug.variants.set('m|b', { template: tree, bodyGeo: body, hairGeo: new Map([['h', hair], ['none', null]]), shellGeo: new Map([['s', shell]]) });
  hum.PG3DHumanoid._debug.protos.m = { scene: tree };  // the template shares the proto's parts: once each
  hum.PG3DHumanoid.disposeGpu();
  for (const o of [map, mat, geo, body, hair, shell]) assert.equal(o.n, 1);
});
