/************************************************
 * Unit tests for js/playground3d-gear-logic.js — measurements of the
 * realistic body and where glasses / hats / hoods / masks sit on it.
 * Synthetic heads and torsos stand in for the baked GLB geometry.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const G = require('../js/playground3d-gear-logic.js');

const P = G.PART;

// A synthetic head: an ellipsoid cranium (radii .09/.12/.11 round y=1.70)
// with a nose ridge on the front midline and a jaw below — roughly the
// Masculine Normal head (eyes at ±.034, 1.698, .070).
function syntheticHead(k = 1, base = 1.70) {
  const pos = [], parts = [];
  const C = [0, base, 0.005 * k], R = [0.09 * k, 0.12 * k, 0.11 * k];
  for (let i = 0; i <= 40; i++) {
    const th = (i / 40) * Math.PI;
    for (let j = 0; j < 48; j++) {
      const ph = (j / 48) * Math.PI * 2;
      let x = Math.sin(th) * Math.sin(ph) * R[0];
      let y = Math.cos(th) * R[1];
      let z = Math.sin(th) * Math.cos(ph) * R[2];
      // Nose: push the lower front midline forward.
      if (Math.abs(x) < 0.012 && z > 0 && y < -0.005 && y > -0.05) z += 0.02 * (1 - Math.abs(y + 0.03) / 0.03);
      pos.push(C[0] + x, C[1] + y, C[2] + z);
      parts.push(P.head);
    }
  }
  return { pos: Float32Array.from(pos), parts: Float32Array.from(parts) };
}
// Eyeballs just inside the synthetic face (a real head has sockets; this
// ellipsoid's front at eye height is z ≈ .115).
const EYES = { c: [[-0.034, 1.698, 0.098], [0.034, 1.698, 0.098]], r: 0.012 };

// A synthetic torso: elliptic cylinder (half-width .16, half-depth .11)
// from y=0.95 to 1.50, centred at z=-0.02, with a "chest" bulge at 1.35.
function syntheticTorso() {
  const pos = [], parts = [];
  for (let y = 0.95; y <= 1.5001; y += 0.005) {
    for (let j = 0; j < 72; j++) {
      const th = (j / 72) * Math.PI * 2 - Math.PI;
      const bulge = Math.cos(th) > 0 ? 0.02 * Math.exp(-((y - 1.35) ** 2) / 0.002) * Math.cos(th) : 0;
      pos.push(Math.sin(th) * 0.16, y, -0.02 + Math.cos(th) * (0.11 + bulge));
      parts.push(y < 1.1 ? P.pelvis : P.torso);
    }
  }
  // An arm in the T-pose (must be ignored).
  for (let x = 0.2; x < 0.7; x += 0.01) { pos.push(x, 1.45, 0); parts.push(P.upperArm); }
  return { pos: Float32Array.from(pos), parts: Float32Array.from(parts) };
}

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} ≉ ${b} (±${eps})`);

test('measureHead: eyes, crown, skull ellipsoid and the face profile', () => {
  const { pos, parts } = syntheticHead();
  const H = G.measureHead(pos, parts, EYES);
  near(H.eyeY, 1.698, 1e-6);
  near(H.eyeX, 0.034, 1e-6);
  near(H.crownY, 1.82, 0.003, 'crown');
  near(H.skull.r[1], 1.82 - 1.698, 0.004, 'skull height');
  near(H.skull.r[0], 0.09, 0.012, 'skull half-width');
  near(H.skull.c[2], 0.005, 0.02, 'skull depth centre');
  assert.ok(H.browY > H.eyeY && H.browY < H.crownY);
  assert.ok(H.chinY < H.eyeY - 0.08, 'chin below the eyes');
  assert.ok(H.noseZ > H.bridgeZ, 'nose tip in front of the bridge');
  assert.ok(H.noseY < H.eyeY, 'nose below the eyes');
  near(H.sideAt(H.eyeY), 0.09, 0.01, 'half-width at the eyes');
});

test('glassesFit: lenses on the eyes, in front of the cornea, temples to the ears', () => {
  const { pos, parts } = syntheticHead();
  const H = G.measureHead(pos, parts, EYES);
  for (const style of [1, 2, 3, 4]) {
    const F = G.glassesFit(H, style);
    near(Math.abs(F.lens[1][0]), 0.034, 1e-9, 'lens x');
    near(F.lensY, H.eyeY, 0.006, 'lens height');
    const cornea = H.eyeZ + H.eyeR;
    assert.ok(F.lensZ - cornea >= 0.008 && F.lensZ - cornea <= 0.02, `lens ${F.lensZ} vs cornea ${cornea}`);
    assert.ok(F.lensZ >= H.bridgeZ, 'lenses never inside the nose bridge');
    assert.ok(F.templeEnd[2] < F.lensZ - 0.05, 'temples run back towards the ears');
    near(F.templeEnd[0], Math.max(H.earX, H.templeX) + 0.003, 1e-9);
  }
  // Aviators are bigger and sit lower than round lenses.
  assert.ok(G.glassesFit(H, 3).h > G.glassesFit(H, 1).h * 0.95);
  assert.ok(G.glassesFit(H, 3).lensY < G.glassesFit(H, 1).lensY);
});

test('hatFit: beanie and cap rims sit between the brow and 3 cm above it', () => {
  const { pos, parts } = syntheticHead();
  const H = G.measureHead(pos, parts, EYES);
  for (const style of [1, 2]) {
    const F = G.hatFit(H, style);
    // Where the rim plane crosses the front midline (x = 0, z = face front).
    const z = H.frontAt(H.browY);
    const [ , ny, nz, d] = F.plane;
    const yRim = (d - nz * z) / ny;
    assert.ok(yRim >= H.browY - 0.002 && yRim <= H.browY + 0.035, `style ${style} rim ${yRim} vs brow ${H.browY}`);
    // The dome clears the skull by at least 1.5 cm of hair room.
    assert.ok(F.r[0] >= H.skull.r[0] + 0.015 && F.r[2] >= H.skull.r[2] + 0.015);
    // The hair clip keeps the eyes and removes the crown.
    const keep = (p) => F.hairClip[1] * p[1] + F.hairClip[2] * p[2] >= F.hairClip[3];
    assert.equal(keep([0, H.eyeY, H.eyeZ]), false, 'eyes are below the rim, so hair there is kept by the inverse clip');
    assert.equal(keep([0, H.crownY, H.skull.c[2]]), true, 'the crown is above the rim');
  }
  const top = G.hatFit(H, 3);
  assert.ok(top.rx > H.skull.r[0] * 0.5 && top.rx < H.skull.r[0] + 0.02, 'top hat sits on the skull, not around the face');
  assert.ok(top.bandY > H.eyeY + 0.03 && top.bandY < H.crownY);
});

test('hoodFit: the face opening contains the eyes, nose, mouth and chin', () => {
  const { pos, parts } = syntheticHead();
  const H = G.measureHead(pos, parts, EYES);
  const F = G.hoodFit(H);
  const inside = (x, y, m) => ((x / (F.opening.rx - m)) ** 2 + ((y - F.opening.cy) / (F.opening.ry - m)) ** 2) <= 1;
  assert.ok(inside(H.eyeX, H.eyeY, 0.008), 'eyes');
  assert.ok(inside(0, H.noseY, 0.008), 'nose');
  assert.ok(inside(0, H.chinY + 0.003, 0.004), 'chin');
  // Loose, but not the old 2–2.7× head width.
  assert.ok(F.r[0] * 2 <= H.maxX * 2 * 1.5, 'hood width ≤ 1.5 × head');
  assert.ok(F.r[0] > H.skull.r[0] && F.r[1] > H.skull.r[1]);
});

test('maskRegion: the full mask covers the nose tip; domino holes sit on the eyes', () => {
  const { pos, parts } = syntheticHead();
  const H = G.measureHead(pos, parts, EYES);
  const full = G.maskRegion(H, 2);
  assert.ok(H.noseY >= full.y[0] && H.noseY <= full.y[1], 'nose height inside the full mask');
  const dom = G.maskRegion(H, 1);
  assert.ok(H.eyeY > dom.y[0] && H.eyeY < dom.y[1]);
  near(dom.holes[0].cx, H.eyeX, 1e-9);
  near(dom.holes[0].cy, H.eyeY, 1e-9);
  const band = G.maskRegion(H, 4);
  assert.ok(band.y[1] < H.eyeY, 'a bandana stays below the eyes');
});

test('measureTorso / surfaceAt: an elliptic cylinder within 2 mm, arms ignored', () => {
  const { pos, parts } = syntheticTorso();
  const T = G.measureTorso(pos, parts, { dy: 0.01, nA: 48 });
  const s = G.surfaceAt(T, 1.2, 0);              // front
  near(s.z, -0.02 + 0.11, 0.003, 'front');
  near(G.surfaceAt(T, 1.2, Math.PI / 2).x, 0.16, 0.003, 'left side');
  near(G.surfaceAt(T, 1.2, -Math.PI / 2).x, -0.16, 0.003, 'right side');
  near(G.surfaceAt(T, 1.2, Math.PI).z, -0.02 - 0.11, 0.003, 'back');
  // The T-pose arm at y=1.45 must not widen the table.
  assert.ok(G.surfaceAt(T, 1.45, Math.PI / 2).x < 0.18, 'arm excluded');
  const L = G.torsoLandmarks(T, { waistY: 1.05 });
  near(L.chestY, 1.35, 0.02, 'chest line at the bulge');
});

// ── triangle slicing (the shipped bodies are low-poly) ──

// A closed ring-grid mesh: rows × cols vertices from f(row, col) → [x, y, z],
// quads between neighbouring rows, wrapping round the columns.
function ringMesh(rows, cols, f, part) {
  const pos = [], parts = [], index = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) { pos.push(...f(i, j)); parts.push(part(i)); }
  }
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * cols + j, b = i * cols + (j + 1) % cols, c = a + cols, d = b + cols;
      index.push(a, b, c, b, d, c);
    }
  }
  return { pos: Float32Array.from(pos), parts: Float32Array.from(parts), index: Uint32Array.from(index) };
}

test('measureHead (sliced): the face front is found even with no vertex on the midline', () => {
  // A coarse ellipsoid head whose columns sit ±15° off the midline: binning
  // vertices near x = 0 finds nothing at the front (the masculine head's bug).
  const C = [0, 1.70, 0.005], R = [0.09, 0.12, 0.11];
  const m = ringMesh(17, 12, (i, j) => {
    const th = (i / 16) * Math.PI, ph = ((j + 0.5) / 12) * Math.PI * 2;
    return [C[0] + Math.sin(th) * Math.sin(ph) * R[0], C[1] + Math.cos(th) * R[1], C[2] + Math.sin(th) * Math.cos(ph) * R[2]];
  }, () => P.head);
  const sliced = G.measureHead(m.pos, m.parts, EYES, m.index);
  near(sliced.bridgeZ, C[2] + R[2] * Math.cos(Math.PI / 12), 0.006, 'front at the eyes');
  near(sliced.backAt(1.70), C[2] - R[2] * Math.cos(Math.PI / 12), 0.006, 'back at the eyes');
  assert.ok(sliced.bridgeZ > sliced.eyeZ, 'the bridge is in front of the eyes');
  const binned = G.measureHead(m.pos, m.parts, EYES);
  assert.ok(!(binned.bridgeZ > binned.eyeZ), 'the vertex method misses it (why slicing exists)');
});

test('measureTorso (sliced): rows 4 cm apart still give a smooth 1 cm table', () => {
  const m = ringMesh(15, 24, (i, j) => {
    const y = 0.95 + i * 0.04, th = (j / 24) * Math.PI * 2 - Math.PI;
    return [Math.sin(th) * 0.16, y, -0.02 + Math.cos(th) * 0.11];
  }, (i) => (i < 4 ? P.pelvis : P.torso));
  const T = G.measureTorso(m.pos, m.parts, { dy: 0.01, nA: 48, index: m.index });
  for (let y = 0.97; y <= 1.49; y += 0.01) {
    near(G.surfaceAt(T, y, Math.PI).z, -0.13, 0.004, `back at ${y.toFixed(2)}`);
    near(G.surfaceAt(T, y, 0).z, 0.09, 0.004, `front at ${y.toFixed(2)}`);
    near(Math.abs(G.surfaceAt(T, y, Math.PI / 2).x), 0.16, 0.006, `side at ${y.toFixed(2)}`);
  }
  // Only the listed parts count.
  const pelvisOnly = G.measureTorso(m.pos, m.parts, { dy: 0.01, nA: 48, index: m.index, parts: [P.pelvis] });
  assert.ok(pelvisOnly.yMax < 1.1 + 1e-6, 'pelvis rows only');
});

test('rimPlane passes through both points and keeps the side above', () => {
  const pl = G.rimPlane([0, 1.72, 0.09], [0, 1.66, -0.1]);
  const d = (p) => pl[1] * p[1] + pl[2] * p[2] - pl[3];
  near(d([0, 1.72, 0.09]), 0, 1e-9);
  near(d([0, 1.66, -0.1]), 0, 1e-9);
  assert.ok(d([0, 1.85, 0]) > 0, 'the crown is kept');
});

test('bandPlanes: a diagonal band, not mirrored', () => {
  const [a, b] = G.bandPlanes([0.15, 1.45], [-0.12, 1.0], 0.07);
  const inside = (x, y) => a[0] * x + a[1] * y >= a[3] && b[0] * x + b[1] * y >= b[3];
  assert.ok(inside(0.15, 1.45) && inside(-0.12, 1.0) && inside(0.015, 1.225));
  assert.ok(!inside(-0.15, 1.45), 'the opposite shoulder is outside — the band is one-sided');
});

test('regionPlanesFromBox reproduces the old box-fraction half-spaces', () => {
  const box = { min: [-0.2, 1.0, -0.15], max: [0.2, 1.5, 0.1] };
  const pl = G.regionPlanesFromBox({ y: [0.1, 0.32], xAbs: [null, 0.42], z: [0.5, null] }, box);
  assert.deepEqual(pl.map((p) => p.map((v) => +v.toFixed(4))), [
    [0, 1, 0, 1.05], [0, -1, 0, -1.16], [-1, 0, 0, -0.084], [0, 0, 1, -0.025]
  ]);
});

// js/playground.js is a browser script (const Playground = (() => …)()).
function loadPlayground() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'playground.js'), 'utf8');
  const ctx = { console };
  vm.createContext(ctx);
  return vm.runInContext(src + '\n;Playground', ctx);
}

test('autoAccent: Auto trims read on every palette colour', () => {
  const PG = loadPlayground();
  const toHex = (s) => (typeof s === 'number' ? s : parseInt(String(s).replace('#', ''), 16));
  for (const name of ['SHIRT_COLORS', 'PANTS_COLORS', 'SHOE_COLORS', 'SUIT_COLORS']) {
    for (const c of PG[name]) {
      const hex = toHex(c);
      assert.ok(G.contrastRatio(hex, G.autoAccent(hex, 'contrast')) >= 3, `${name} ${c} contrast`);
      assert.ok(G.contrastRatio(hex, G.autoAccent(hex, 'tone')) >= 1.35, `${name} ${c} tone`);
    }
  }
});

// Crown + laurel (crown-fit): heads of different sizes and heights stand in
// for the builds and sexes (Feminine ≈ 0.93, Huge ≈ 1.105 × 1.4 tall).
const HEADS = [
  ['Masculine Normal', 1, 1.70],
  ['Feminine Slim', 0.93, 1.58],
  ['Huge', 1.105, 1.70],
  ['small', 0.85, 1.45]
];
function headOf(k, base) {
  const { pos, parts } = syntheticHead(k, base);
  const eyes = { c: [[-0.034 * k, base - 0.002, 0.098 * k], [0.034 * k, base - 0.002, 0.098 * k]], r: 0.012 };
  return G.measureHead(pos, parts, eyes);
}

test('crownFit: bare head — the band rings the skull + hair just above the hairline', () => {
  for (const [name, k, base] of HEADS) {
    const H = headOf(k, base);
    const F = G.crownFit(H);
    const S = H.skull;
    // Scale makes the band's inner radius the ring radius.
    near(F.scale * G.CROWN_BAND.r, F.ringR, 1e-9, name);
    // The ring is wider than the skull where it rests (no clipping), but not loose.
    const t = (F.bottom - S.c[1]) / S.r[1];
    const k2 = Math.sqrt(1 - t * t);
    assert.ok(F.ringR > Math.max(S.r[0], S.r[2]) * k2 + 0.01, name + ' clears the hair');
    assert.ok(F.ringR < Math.max(S.r[0], S.r[2]) + 0.01, name + ' is not wider than the head');
    // Above the hairline, below the top of the head; the band's top above the crown is fine.
    assert.ok(F.bottom >= H.hairlineY - 0.002 && F.bottom < H.crownY, name + ' rests at the upper forehead');
    near(F.y, F.bottom + G.CROWN_BAND.h * F.scale / 2, 1e-9, name + ' origin = band centre');
    assert.deepEqual(F.center, [0, F.y, S.c[2]]);
  }
  // Fits follow the head: a bigger head gets a bigger crown, a lower head a lower one.
  const a = G.crownFit(headOf(1, 1.70)), b = G.crownFit(headOf(1.105, 1.70)), c = G.crownFit(headOf(0.93, 1.58));
  assert.ok(b.scale > a.scale && c.scale < a.scale);
  assert.ok(c.y < a.y - 0.1);
  // Bald: less hair room.
  assert.ok(G.crownFit(headOf(1, 1.70), { bald: true }).ringR < a.ringR);
});

test('crownFit: with a hat, hood or helmet the reward sits higher, on top of it', () => {
  for (const [name, k, base] of HEADS) {
    const H = headOf(k, base);
    const bare = G.crownFit(H);
    for (const hat of [1, 2, 4]) {
      const F = G.crownFit(H, { hat });
      assert.ok(F.bottom > bare.bottom + 0.005, `${name} hat ${hat} lifts it (${F.bottom} vs ${bare.bottom})`);
      // Still on the dome: below the hat's own top.
      const D = hat === 4 ? G.hoodFit(H) : G.hatFit(H, hat);
      assert.ok(F.bottom < D.c[1] + D.r[1], `${name} hat ${hat} rests on the dome`);
    }
    // Top hat: the band rings the lid, wider than the hat.
    const T = G.hatFit(H, 3);
    const F = G.crownFit(H, { hat: 3 });
    const lid = T.bandY + T.crown * Math.cos(T.tilt);
    assert.ok(F.bottom < lid && F.y + G.CROWN_BAND.h * F.scale / 2 > lid, name + ' rings the top hat\'s lid');
    assert.ok(F.ringR > Math.max(T.rx, T.rz), name + ' wider than the top hat');
    // Helmets (dome, knight, classic with and without the head box) lift it too.
    for (const helmet of [2, 3, 4, 5, 1, 6]) {
      const opts = { helmet };
      if (helmet === 1) opts.headBox = { center: [0, base - 0.03 * k, 0.01], size: [0.18 * k, 0.27 * k, 0.24 * k] };
      const Fh = G.crownFit(H, opts);
      assert.ok(Fh.bottom > bare.bottom, `${name} helmet ${helmet} lifts it`);
      assert.ok(Fh.bottom < H.crownY + 0.12 * k, `${name} helmet ${helmet} is not floating`);
    }
    // A helmet hides the hat: the hat is ignored.
    assert.deepEqual(G.crownFit(H, { helmet: 3, hat: 3 }), G.crownFit(H, { helmet: 3 }));
  }
});

// 3D2-03: volumetric hair on the realistic body. The Afro's halo buried the
// band (and hid the laurel); Spiky's and Curly's pieces must not cross it.
const HL = require('../js/playground3d-humanoid-logic.js');
// How far hair balls reach out from the ring's axis anywhere over the band's height.
function hairReach(balls, F) {
  const top = F.bottom + G.CROWN_BAND.h * F.scale;
  let m = 0;
  for (const [p, rad] of balls) {
    const d = p[1] < F.bottom ? F.bottom - p[1] : p[1] > top ? p[1] - top : 0;
    if (d < rad) m = Math.max(m, Math.hypot(p[0], p[2] - F.center[2]) + Math.sqrt(rad * rad - d * d));
  }
  return m;
}

test('crownFit: Afro (hair 8) — the band rests on the halo, never inside it', () => {
  const afro = HL.hairSpec(8);
  assert.deepEqual(afro.extras, ['afro']);
  for (const [name, k, base] of HEADS) {
    const H = headOf(k, base);
    const bare = G.crownFit(H);
    const F = G.crownFit(H, { hair: afro });
    const A = G.hairPieces(H.skull, 'afro'), kk = 1 + A.bump;
    near(F.scale * G.CROWN_BAND.r, F.ringR, 1e-9, name);
    assert.equal(F.center[2], A.c[2], name + ' centred on the halo (set back)');
    // The halo's widest cross-section over the band's height fits inside the ring.
    const top = F.bottom + G.CROWN_BAND.h * F.scale;
    for (let y = F.bottom; y <= top; y += 0.002) {
      const t = (y - A.c[1]) / (A.r[1] * kk);
      if (Math.abs(t) >= 1) continue;
      const w = Math.max(A.r[0], A.r[2]) * kk * Math.sqrt(1 - t * t);
      assert.ok(w <= F.ringR + 1e-9, `${name} halo ${w.toFixed(4)} inside the ring ${F.ringR.toFixed(4)} at ${y.toFixed(3)}`);
    }
    // ... but resting on it, not floating: the halo is ring-wide at the band's lower edge.
    const tb = (F.bottom - A.c[1]) / (A.r[1] * kk);
    near(Math.max(A.r[0], A.r[2]) * kk * Math.sqrt(1 - tb * tb), F.ringR, 0.002, name + ' touches the halo');
    assert.ok(F.bottom > bare.bottom + 0.02 && F.ringR > bare.ringR, name + ' higher and wider than on a bare head');
    assert.ok(F.bottom < A.c[1] + A.r[1] * kk, name + ' below the top of the afro');
    // The bare-head fit was inside the hair (the bug).
    const t0 = (bare.bottom - A.c[1]) / (A.r[1] * kk);
    assert.ok(Math.max(A.r[0], A.r[2]) * kk * Math.sqrt(1 - t0 * t0) > bare.ringR + 0.02, name + ' old fit was buried');
  }
});

test('crownFit: Spiky (hair 2) and Curly (hair 9) — no spike or curl crosses the band', () => {
  for (const [style, kind] of [[2, 'spikes'], [9, 'curls']]) {
    const spec = HL.hairSpec(style);
    assert.ok(spec.extras.includes(kind));
    for (const [name, k, base] of HEADS) {
      const H = headOf(k, base);
      const bare = G.crownFit(H);
      const F = G.crownFit(H, { hair: spec });
      const balls = G.hairBalls(H.skull, kind);
      assert.ok(balls.length > 10, kind + ' pieces');
      assert.ok(hairReach(balls, F) <= F.ringR - 0.002 + 1e-9, `${name} ${kind} inside the band (${hairReach(balls, F)} vs ${F.ringR})`);
      assert.ok(F.bottom >= bare.bottom - 1e-12 && F.bottom < bare.bottom + 0.06, `${name} ${kind} lifted a little at most`);
      near(F.ringR, bare.ringR, 1e-12, name + ' same ring: only lifted');
      if (F.bottom > bare.bottom) {
        // Lifted just enough: 4 mm lower and the hair would touch the band.
        const lower = { ...F, bottom: F.bottom - 0.004 };
        assert.ok(hairReach(balls, lower) > F.ringR - 0.002, `${name} ${kind} rests on the hair`);
      }
    }
    // Curly hair stands well off the scalp: the band has to rise over it.
    const H = headOf(1, 1.70);
    if (kind === 'curls') assert.ok(G.crownFit(H, { hair: spec }).bottom > G.crownFit(H).bottom + 0.015);
  }
});

test('crownFit: hair pieces are ignored under a hat or helmet; plain styles change nothing', () => {
  const H = headOf(1, 1.70);
  for (const style of [8, 2, 9]) {
    const hair = HL.hairSpec(style);
    for (const hat of [1, 2, 3, 4]) assert.deepEqual(G.crownFit(H, { hat, hair }), G.crownFit(H, { hat }));
    assert.deepEqual(G.crownFit(H, { helmet: 2, hair }), G.crownFit(H, { helmet: 2 }));
  }
  for (const style of [0, 1, 3, 10, 11]) assert.deepEqual(G.crownFit(H, { hair: HL.hairSpec(style) }), G.crownFit(H));
  assert.deepEqual(G.crownFit(H, { hair: null }), G.crownFit(H));
});

test('hair volume: the humanoid builder places spikes, curls and the afro from PG3DGearLogic.hairPieces', () => {
  const src = fs.readFileSync(path.join(__dirname, '../js/playground3d-humanoid.js'), 'utf8');
  for (const kind of ['spikes', 'curls', 'afro']) assert.ok(src.includes(`G.hairPieces(variant.skull, '${kind}')`), kind);
  assert.ok(!/R\.x \* 1\.65|ConeGeometry\(0\.022/.test(src), 'no duplicated hair numbers');
  // The pieces follow the scalp: every curl sits just off it, none inside the skull.
  const S = { c: [0, 0, 0], r: [0.09, 0.12, 0.11] };
  for (const b of G.hairPieces(S, 'curls')) {
    const e = Math.hypot(b.p[0] / S.r[0], b.p[1] / S.r[1], b.p[2] / S.r[2]);
    assert.ok(e > 1 && e < 1.1);
  }
});
