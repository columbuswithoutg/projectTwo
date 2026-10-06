/************************************************
 * PLAYGROUND3D GEAR LOGIC — pure maths behind the realistic body's clothes
 *
 * The realistic (rigged) bodies used to wear pieces built for the blocky
 * Box body: a 0.55 cube head stretched to the real head's bounding box put
 * glasses 5–7 cm in front of the eyes and hats on top of the crown, and
 * torso pieces sat at fixed offsets (belts and emblems buried in the chest,
 * bow ties floating). Everything here works from MEASUREMENTS of the baked
 * body instead (bind pose, body units ≈ metres, +Y up, +Z forward, the body
 * symmetric about x = 0):
 *
 *   measureHead(pos, parts, eyes)  skull ellipsoid, crown/brow/chin heights,
 *                                  the face's midline profile, half-widths…
 *   measureTorso(pos, parts)       radius of torso + pelvis + neck per height
 *                                  × angle round the body (a "surface table")
 *   surfaceAt(table, y, theta)     a point on that surface (theta 0 = front,
 *                                  +π/2 = the character's left, π = back)
 *   glassesFit / hatFit / hoodFit / maskRegion / helmetFit
 *                                  where each piece sits on THIS head
 *   autoAccent(hex, mode)          a contrasting trim colour for "Auto"
 *   regionPlanesFromBox()          the old box-fraction region → half-spaces
 *
 * Used by js/playground3d-humanoid.js (measurements per body variant) and
 * js/playground3d-gear.js (the builders). Unit tests: test/gear.test.js.
 *
 * UMD-ish: attaches to self.PG3DGearLogic in the browser, module.exports
 * under Node (same pattern as playground3d-physics.js).
 ************************************************/
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PG3DGearLogic = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const PART = { head: 0, neck: 1, torso: 2, upperArm: 3, forearm: 4, hand: 5, pelvis: 6, thigh: 7, shin: 8, foot: 9 };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // ── head ──

  // pos: flat [x,y,z,…] of the baked body; parts: per-vertex part index;
  // eyes: { c: [[x,y,z],[x,y,z]] | [null,null], r }; index (optional): the
  // triangle index — the midline profiles then come from slicing triangles.
  // (Binning vertices near x = 0 failed on the masculine head: its 2 mm row at
  // eye level held only BACK-of-head midline vertices, so the "nose bridge"
  // came out 9 cm behind the face and the visor was drawn inside the head.)
  function measureHead(pos, parts, eyes, index) {
    const n = parts.length;
    let minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity, maxX = 0;
    for (let i = 0; i < n; i++) {
      if (Math.round(parts[i]) !== PART.head) continue;
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
      if (Math.abs(x) > maxX) maxX = Math.abs(x);
    }
    const haveEyes = !!(eyes && eyes.c && eyes.c[0] && eyes.c[1]);
    const eyeY = haveEyes ? (eyes.c[0][1] + eyes.c[1][1]) / 2 : lerp(minY, maxY, 0.55);
    const eyeX = haveEyes ? Math.abs(eyes.c[0][0] - eyes.c[1][0]) / 2 : (maxX * 0.38);
    const eyeZ = haveEyes ? (eyes.c[0][2] + eyes.c[1][2]) / 2 : lerp(minZ, maxZ, 0.75);
    const eyeR = haveEyes && eyes.r ? eyes.r : 0.012;
    const crownY = maxY;

    // Profiles per height (2 mm bins): the face's midline (|x| < 1.2 cm) front,
    // the head's half-width and its back.
    const DY = 0.002;
    const nb = Math.max(1, Math.ceil((maxY - minY) / DY) + 1);
    const front = new Array(nb).fill(-Infinity);
    const side = new Array(nb).fill(0);
    const back = new Array(nb).fill(Infinity);
    // Skull ellipsoid: only the cranium above the ears (the ears and the jaw
    // would make it too wide / too deep).
    const earTop = eyeY + 0.35 * (crownY - eyeY);
    let sxMax = 0, szMin = Infinity, szMax = -Infinity;
    if (index) sliceHeadProfiles(pos, parts, index, minY, DY, nb, front, side, back);
    for (let i = 0; i < n; i++) {
      if (Math.round(parts[i]) !== PART.head) continue;
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const b = Math.min(nb - 1, Math.max(0, Math.round((y - minY) / DY)));
      if (!index) {
        if (Math.abs(x) < 0.012 && z > front[b]) front[b] = z;
        if (Math.abs(x) > side[b]) side[b] = Math.abs(x);
        if (z < back[b]) back[b] = z;
      }
      if (y >= eyeY) {
        if (z < szMin) szMin = z;
        if (z > szMax) szMax = z;
        if (y >= earTop && Math.abs(x) > sxMax) sxMax = Math.abs(x);
      }
    }
    fillProfile(front, -Infinity);
    fillProfile(side, 0);
    fillProfile(back, Infinity);
    const at = (arr, y) => {
      const f = (y - minY) / DY;
      const i = Math.floor(f);
      if (i <= 0) return arr[0];
      if (i >= nb - 1) return arr[nb - 1];
      return lerp(arr[i], arr[i + 1], f - i);
    };
    const skull = {
      c: [0, eyeY, (szMin + szMax) / 2],
      r: [sxMax || maxX * 0.9, Math.max(0.05, crownY - eyeY), Math.max(0.05, (szMax - szMin) / 2)]
    };
    // The nose tip: the most forward midline point below the eyes.
    let noseY = eyeY, noseZ = -Infinity;
    for (let b = 0; b < nb; b++) {
      const y = minY + b * DY;
      if (y > eyeY || y < eyeY - 0.06) continue;
      if (front[b] > noseZ) { noseZ = front[b]; noseY = y; }
    }
    // The chin: the lowest point of the head's front half.
    let chinY = Infinity;
    for (let i = 0; i < n; i++) {
      if (Math.round(parts[i]) !== PART.head) continue;
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      if (Math.abs(x) < 0.02 && z > skull.c[2] && y < chinY) chinY = y;
    }
    if (!isFinite(chinY)) chinY = minY;
    const browY = eyeY + Math.max(0.016, 0.17 * (crownY - eyeY));
    return {
      minY, maxY, minZ, maxZ, maxX,
      eyeY, eyeX, eyeZ, eyeR, crownY, chinY, browY,
      hairlineY: eyeY + 0.55 * (crownY - eyeY),
      bridgeZ: at(front, eyeY),
      noseY, noseZ: isFinite(noseZ) ? noseZ : maxZ,
      templeX: at(side, eyeY + 0.015),
      earY: eyeY - 0.012,
      earZ: skull.c[2] - 0.012,
      earX: at(side, eyeY - 0.012),
      skull,
      profile: { y0: minY, dy: DY, front, side, back },
      frontAt: (y) => at(front, y),
      sideAt: (y) => at(side, y),
      backAt: (y) => at(back, y)
    };
  }

  // Head profiles per 2 mm row from the triangles: where each row's cross-
  // section crosses the midline (x = 0) gives the face's front and the back
  // of the head; its widest point gives the half-width.
  function sliceHeadProfiles(pos, parts, index, minY, DY, nb, front, side, back) {
    const isHead = (v) => Math.round(parts[v]) === PART.head;
    for (let t = 0; t < index.length; t += 3) {
      const tri = [index[t], index[t + 1], index[t + 2]];
      if (!isHead(tri[0]) || !isHead(tri[1]) || !isHead(tri[2])) continue;
      const ys = tri.map((v) => pos[v * 3 + 1]);
      const r0 = Math.max(0, Math.ceil((Math.min(ys[0], ys[1], ys[2]) - minY) / DY - 1e-9));
      const r1 = Math.min(nb - 1, Math.floor((Math.max(ys[0], ys[1], ys[2]) - minY) / DY + 1e-9));
      for (let b = r0; b <= r1; b++) {
        const y = minY + b * DY;
        const p = [];
        for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
          const yi = ys[i], yj = ys[j];
          if (yi === yj || (yi - y) * (yj - y) > 0) continue;
          const k = (y - yi) / (yj - yi), vi = tri[i] * 3, vj = tri[j] * 3;
          p.push(pos[vi] + (pos[vj] - pos[vi]) * k, pos[vi + 2] + (pos[vj + 2] - pos[vi + 2]) * k);
          if (p.length === 4) break;
        }
        if (p.length < 4) continue;
        side[b] = Math.max(side[b], Math.abs(p[0]), Math.abs(p[2]));
        if (p[0] * p[2] <= 0 && p[0] !== p[2]) {
          const z = p[1] + (p[3] - p[1]) * (p[0] / (p[0] - p[2]));
          if (z > front[b]) front[b] = z;
          if (z < back[b]) back[b] = z;
        }
      }
    }
  }

  // Fill empty bins of a profile from their nearest filled neighbours.
  function fillProfile(arr, empty) {
    let last = null;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] !== empty) last = arr[i];
      else if (last != null) arr[i] = last;
    }
    last = null;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i] !== empty) last = arr[i];
      else if (last != null) arr[i] = last;
    }
    for (let i = 0; i < arr.length; i++) if (arr[i] === empty) arr[i] = 0;
  }

  // ── torso surface table ──

  const TORSO_PARTS = [PART.torso, PART.pelvis, PART.neck];

  // Radius of the torso + pelvis + neck round a centre line, per height (dy)
  // and angle (nA bins; theta = atan2(x, z − cz)). The arms in the T-pose
  // bind are a different part, so they don't count. opts.parts: measure only
  // these parts (e.g. [PART.neck] — at the neck's base the shoulders would
  // otherwise make the "neck" as wide as the trapezius).
  //
  // opts.index (the mesh's triangle index): slice the TRIANGLES at each
  // height instead of binning vertices. The body mesh is low-poly — a 1 cm
  // row holds a handful of vertices, so the vertex method interpolated across
  // empty bins and the back's "radius" jumped 7–23 cm between rows.
  function measureTorso(pos, parts, opts) {
    const dy = (opts && opts.dy) || 0.01;
    const nA = (opts && opts.nA) || 48;
    const keep = new Set((opts && opts.parts) || TORSO_PARTS);
    if (opts && opts.index) return sliceTorso(pos, parts, opts.index, dy, nA, keep);
    const n = parts.length;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      if (!keep.has(Math.round(parts[i]))) continue;
      const y = pos[i * 3 + 1];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (!isFinite(minY)) return null;
    const nY = Math.max(1, Math.ceil((maxY - minY) / dy) + 1);
    const zLo = new Array(nY).fill(Infinity), zHi = new Array(nY).fill(-Infinity);
    const halfW = new Array(nY).fill(0);
    for (let i = 0; i < n; i++) {
      if (!keep.has(Math.round(parts[i]))) continue;
      const b = Math.min(nY - 1, Math.max(0, Math.round((pos[i * 3 + 1] - minY) / dy)));
      const z = pos[i * 3 + 2];
      if (z < zLo[b]) zLo[b] = z;
      if (z > zHi[b]) zHi[b] = z;
      if (Math.abs(pos[i * 3]) > halfW[b]) halfW[b] = Math.abs(pos[i * 3]);
    }
    const cz = zLo.map((lo, b) => (isFinite(lo) ? (lo + zHi[b]) / 2 : NaN));
    fillNaN(cz);
    const r = new Float32Array(nY * nA);
    for (let i = 0; i < n; i++) {
      if (!keep.has(Math.round(parts[i]))) continue;
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const b = Math.min(nY - 1, Math.max(0, Math.round((y - minY) / dy)));
      const dz = z - cz[b];
      const th = Math.atan2(x, dz);
      const a = ((Math.round((th + Math.PI) / (2 * Math.PI) * nA) % nA) + nA) % nA;
      const d = Math.hypot(x, dz);
      if (d > r[b * nA + a]) r[b * nA + a] = d;
    }
    // Close gaps round each ring (sparse meshes leave empty angle bins).
    for (let b = 0; b < nY; b++) {
      const row = r.subarray(b * nA, b * nA + nA);
      fillRing(row);
    }
    fillEmptyRows(r, nY, nA);
    return { y0: minY, dy, nY, nA, cz, r, halfW, yMax: maxY };
  }

  // measureTorso from triangle cross-sections (see above).
  function sliceTorso(pos, parts, index, dy, nA, keep) {
    const inPart = (v) => keep.has(Math.round(parts[v]));
    let minY = Infinity, maxY = -Infinity;
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t], b = index[t + 1], c = index[t + 2];
      if (!inPart(a) || !inPart(b) || !inPart(c)) continue;
      for (const v of [a, b, c]) {
        const y = pos[v * 3 + 1];
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (!isFinite(minY)) return null;
    const nY = Math.max(1, Math.ceil((maxY - minY) / dy) + 1);
    // Cross-section segments per row: [x0, z0, x1, z1, …].
    const segs = Array.from({ length: nY }, () => []);
    const E = [[0, 1], [1, 2], [2, 0]];
    for (let t = 0; t < index.length; t += 3) {
      const tri = [index[t], index[t + 1], index[t + 2]];
      if (!inPart(tri[0]) || !inPart(tri[1]) || !inPart(tri[2])) continue;
      const ys = tri.map((v) => pos[v * 3 + 1]);
      const r0 = Math.max(0, Math.ceil((Math.min(ys[0], ys[1], ys[2]) - minY) / dy - 1e-9));
      const r1 = Math.min(nY - 1, Math.floor((Math.max(ys[0], ys[1], ys[2]) - minY) / dy + 1e-9));
      for (let r = r0; r <= r1; r++) {
        const y = minY + r * dy;
        const pts = [];
        for (const [i, j] of E) {
          const yi = ys[i], yj = ys[j];
          if (yi === yj || (yi - y) * (yj - y) > 0) continue;
          const k = (y - yi) / (yj - yi), vi = tri[i] * 3, vj = tri[j] * 3;
          pts.push(pos[vi] + (pos[vj] - pos[vi]) * k, pos[vi + 2] + (pos[vj + 2] - pos[vi + 2]) * k);
          if (pts.length === 4) break;
        }
        if (pts.length === 4) segs[r].push(pts[0], pts[1], pts[2], pts[3]);
      }
    }
    const cz = new Array(nY).fill(NaN);
    const halfW = new Array(nY).fill(0);
    const r = new Float32Array(nY * nA);
    for (let b = 0; b < nY; b++) {
      const s = segs[b];
      if (!s.length) continue;
      let zLo = Infinity, zHi = -Infinity;
      for (let i = 0; i < s.length; i += 2) {
        if (s[i + 1] < zLo) zLo = s[i + 1];
        if (s[i + 1] > zHi) zHi = s[i + 1];
        if (Math.abs(s[i]) > halfW[b]) halfW[b] = Math.abs(s[i]);
      }
      const c = cz[b] = (zLo + zHi) / 2;
      // Walk each segment in ~3 mm steps; every point raises its angle bin.
      for (let i = 0; i < s.length; i += 4) {
        const len = Math.hypot(s[i + 2] - s[i], s[i + 3] - s[i + 1]);
        const steps = Math.max(1, Math.ceil(len / 0.003));
        for (let k = 0; k <= steps; k++) {
          const x = s[i] + (s[i + 2] - s[i]) * (k / steps);
          const dz = s[i + 1] + (s[i + 3] - s[i + 1]) * (k / steps) - c;
          const a = ((Math.round((Math.atan2(x, dz) + Math.PI) / (2 * Math.PI) * nA) % nA) + nA) % nA;
          const d = Math.hypot(x, dz);
          if (d > r[b * nA + a]) r[b * nA + a] = d;
        }
      }
      fillRing(r.subarray(b * nA, b * nA + nA));
    }
    fillNaN(cz);
    fillEmptyRows(r, nY, nA);
    return { y0: minY, dy, nY, nA, cz, r, halfW, yMax: maxY };
  }

  function fillNaN(arr) {
    let last = null;
    for (let i = 0; i < arr.length; i++) { if (!isNaN(arr[i])) last = arr[i]; else if (last != null) arr[i] = last; }
    last = null;
    for (let i = arr.length - 1; i >= 0; i--) { if (!isNaN(arr[i])) last = arr[i]; else if (last != null) arr[i] = last; }
    for (let i = 0; i < arr.length; i++) if (isNaN(arr[i])) arr[i] = 0;
  }

  // Empty (0) bins on a closed ring → interpolated between their filled neighbours.
  function fillRing(row) {
    const n = row.length;
    const filled = [];
    for (let i = 0; i < n; i++) if (row[i] > 0) filled.push(i);
    if (!filled.length) return;
    for (let k = 0; k < filled.length; k++) {
      const a = filled[k], b = filled[(k + 1) % filled.length];
      const gap = ((b - a) + n) % n || n;
      for (let s = 1; s < gap; s++) {
        row[(a + s) % n] = lerp(row[a], row[b], s / gap);
      }
    }
  }

  function fillEmptyRows(r, nY, nA) {
    const empty = (b) => { for (let a = 0; a < nA; a++) if (r[b * nA + a] > 0) return false; return true; };
    for (let b = 0; b < nY; b++) {
      if (!empty(b)) continue;
      let src = -1;
      for (let d = 1; d < nY && src < 0; d++) {
        if (b - d >= 0 && !empty(b - d)) src = b - d;
        else if (b + d < nY && !empty(b + d)) src = b + d;
      }
      if (src >= 0) for (let a = 0; a < nA; a++) r[b * nA + a] = r[src * nA + a];
    }
  }

  // Point on the torso surface at height y, angle theta (0 front, +π/2 the
  // character's left, π back). → { x, z, r, nx, nz } (outward normal in xz).
  function surfaceAt(T, y, theta) {
    const fy = clamp((y - T.y0) / T.dy, 0, T.nY - 1);
    const b0 = Math.floor(fy), b1 = Math.min(T.nY - 1, b0 + 1), ty = fy - b0;
    const fa = ((theta + Math.PI) / (2 * Math.PI)) * T.nA;
    const a0 = ((Math.floor(fa) % T.nA) + T.nA) % T.nA, a1 = (a0 + 1) % T.nA, ta = fa - Math.floor(fa);
    const R = (b, a) => T.r[b * T.nA + a];
    const r = lerp(lerp(R(b0, a0), R(b0, a1), ta), lerp(R(b1, a0), R(b1, a1), ta), ty);
    const cz = lerp(T.cz[b0], T.cz[b1], ty);
    const sx = Math.sin(theta), sz = Math.cos(theta);
    return { x: sx * r, z: cz + sz * r, r, nx: sx, nz: sz };
  }

  // Torso landmarks from the table: the chest (bust) line = the most forward
  // point between the waist and the shoulders; the waist = the narrowest ring
  // between the hips and the chest.
  function torsoLandmarks(T, hints) {
    const waistHint = hints && hints.waistY;
    let chestY = null, chestZ = -Infinity;
    const lo = waistHint != null ? waistHint + 0.08 : T.y0 + (T.yMax - T.y0) * 0.45;
    const hi = T.y0 + (T.yMax - T.y0) * 0.88;
    for (let y = lo; y <= hi; y += T.dy) {
      const f = surfaceAt(T, y, 0).z;
      if (f > chestZ) { chestZ = f; chestY = y; }
    }
    return { chestY: chestY != null ? chestY : lo, chestZ };
  }

  // ── fits ──

  // Glasses on this head: lenses centred on the eyes, just in front of the
  // cornea (and of the nose bridge), temples running back to the ears.
  // style: 1 Round, 2 Square, 3 Aviator, 4 Half-rim.
  function glassesFit(H, style) {
    const lensZ = Math.max(H.eyeZ + H.eyeR + 0.011, H.bridgeZ + 0.003);
    const k = H.eyeX;                        // half the eye spacing
    let w, h, dy = 0.002;
    if (style === 2) { w = 1.32 * k; h = 0.92 * k; }
    else if (style === 3) { w = 1.42 * k; h = 1.2 * k; dy = -0.004; }
    else if (style === 4) { w = 1.24 * k; h = 0.62 * k; }
    else { w = 1.2 * k; h = 1.2 * k; }
    const lensY = H.eyeY + dy;
    const outer = k + w / 2;
    return {
      lensZ, lensY, w, h,
      lens: [[-k, lensY, lensZ], [k, lensY, lensZ]],
      bridge: { y: H.eyeY + 0.004, z: lensZ + 0.0015, halfGap: Math.max(0.004, k - w / 2) },
      hinge: [outer + 0.002, H.eyeY + 0.004, lensZ - 0.004],
      templeEnd: [Math.max(H.earX, H.templeX) + 0.003, H.earY + 0.006, H.earZ],
      tube: 0.0022,
      wrap: 0.10
    };
  }

  // A rim plane through a front and a back point on the midline: kept side
  // = above. → [nx, ny, nz, d] with dot(n, p) >= d above the rim.
  function rimPlane(front, back) {
    const dz = front[2] - back[2], dy = front[1] - back[1];
    // Normal ⟂ the rim line in the yz plane, pointing up.
    let ny = dz, nz = -dy;
    const len = Math.hypot(ny, nz) || 1;
    ny /= len; nz /= len;
    if (ny < 0) { ny = -ny; nz = -nz; }
    return [0, ny, nz, ny * front[1] + nz * front[2]];
  }

  // Hats over the skull (plus hair clearance). style: 1 Beanie, 2 Cap,
  // 3 Top hat, 4 Hood (see hoodFit). bald: no hair to clear.
  function hatFit(H, style, opts) {
    const bald = !!(opts && opts.bald);
    const hc = bald ? 0.008 : 0.014;
    const S = H.skull;
    const front = (y) => [0, y, H.frontAt(y) + hc * 0.5];
    const back = (y) => [0, y, H.backAt(y) - hc];
    if (style === 3) {
      const bandY = S.c[1] + 0.45 * S.r[1];
      // Skull cross-section at the band height (ellipse), plus clearance.
      const t = clamp((bandY - S.c[1]) / S.r[1], -1, 1);
      const k = Math.sqrt(Math.max(0.05, 1 - t * t));
      const rx = S.r[0] * k + hc * 0.7, rz = S.r[2] * k + hc * 0.7;
      return {
        kind: 'tophat', bandY, c: [0, bandY, S.c[2]], rx, rz,
        crown: 0.16, brim: 0.042, band: 0.026, tilt: -0.07,
        hairClip: [0, 1, 0, bandY - 0.004]
      };
    }
    const r = [S.r[0] + hc + 0.004, S.r[1] + hc * 0.85, S.r[2] + hc + 0.004];
    if (style === 2) {
      const plane = rimPlane(front(H.browY + 0.03), back(H.eyeY + 0.03));
      return {
        kind: 'cap', c: S.c.slice(), r, plane,
        bill: { len: 0.068, span: 1.22, droop: 0.14, thick: 0.005, y: H.browY + 0.03, z: H.frontAt(H.browY + 0.03) + hc * 0.5 },
        hairClip: [plane[0], plane[1], plane[2], plane[3] + 0.004]
      };
    }
    // Beanie (default).
    const plane = rimPlane(front(H.browY + 0.022), back(H.eyeY - 0.035));
    return {
      kind: 'beanie', c: S.c.slice(), r: [r[0], r[1] * 1.06, r[2]], plane,
      cuff: { height: 0.034, out: 0.005 },
      hairClip: [plane[0], plane[1], plane[2], plane[3] + 0.004]
    };
  }

  // The hood worn up: a loose shell round the skull with an oval face
  // opening from the hairline to just under the chin.
  function hoodFit(H) {
    const S = H.skull;
    const c = [0, S.c[1] - 0.008, S.c[2] - 0.012];
    const r = [S.r[0] + 0.032, S.r[1] + 0.036, S.r[2] + 0.036];
    const openTop = H.hairlineY + 0.008;
    const openBot = H.chinY - 0.012;
    return {
      c, r,
      opening: {
        cy: (openTop + openBot) / 2,
        rx: H.templeX + 0.006,
        ry: (openTop - openBot) / 2,
        zMin: H.eyeZ - 0.03
      },
      bottomY: H.chinY - 0.02,
      rim: 0.009
    };
  }

  // Face masks as conforming regions of the head (shell layers):
  //   { y: [lo, hi], zMin, holes: [{ cx, cy, rx, ry, zMin }] }  (holes mirror in x)
  // style: 1 Domino, 2 Full, 4 Bandana (3 Visor is geometry, see visorFit).
  function maskRegion(H, style) {
    if (style === 2) {
      return {
        y: [H.chinY - 0.006, H.eyeY + 0.05], zMin: H.eyeZ - 0.045,
        holes: [{ cx: H.eyeX, cy: H.eyeY, rx: H.eyeR * 1.2, ry: H.eyeR * 0.75, zMin: H.eyeZ - 0.02 }]
      };
    }
    if (style === 4) {
      return { y: [H.chinY - 0.03, H.noseY + 0.006], zMin: H.eyeZ - 0.06, holes: [] };
    }
    return {
      y: [H.eyeY - 0.016, H.eyeY + 0.021], zMin: H.eyeZ - 0.034,
      holes: [{ cx: H.eyeX, cy: H.eyeY, rx: H.eyeR * 1.3, ry: H.eyeR * 0.85, zMin: H.eyeZ - 0.02 }]
    };
  }

  // A curved visor band across the eyes.
  function visorFit(H) {
    const S = H.skull;
    return {
      c: [0, H.eyeY + 0.003, S.c[2]],
      rx: H.templeX + 0.012,
      rz: (H.bridgeZ - S.c[2]) + 0.014,
      height: 0.032,
      arc: 1.75           // radians either side of the front
    };
  }

  // Dome helmets: over the skull, rim at the brow in front and lower at the
  // back so the skull is covered (no "bald under a skullcap").
  function helmetFit(H, opts) {
    const S = H.skull;
    const pad = (opts && opts.pad) || 0.012;
    const r = [S.r[0] + pad + 0.01, S.r[1] + pad, S.r[2] + pad + 0.006];
    const plane = rimPlane([0, H.browY + 0.008, H.frontAt(H.browY + 0.008) + pad], [0, H.eyeY - 0.07, H.backAt(H.eyeY - 0.03) - pad]);
    return { c: S.c.slice(), r, plane };
  }

  // ── colours ──

  function hexToRgb(hex) { return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => v / 255); }
  function rgbToHex(rgb) { return rgb.reduce((h, v) => (h << 8) | Math.round(clamp(v, 0, 1) * 255), 0); }
  function luminance(hex) {
    const lin = hexToRgb(hex).map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  }
  function contrastRatio(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  // A trim colour that reads against `hex`:
  //   'tone'     same hue, clearly darker (or lighter on dark colours)
  //   'contrast' near-black on light colours, off-white on dark ones
  function autoAccent(hex, mode) {
    if (mode === 'contrast') {
      const dark = 0x22262e, light = 0xf2f2f2;
      return contrastRatio(hex, dark) >= contrastRatio(hex, light) ? dark : light;
    }
    const rgb = hexToRgb(hex);
    if (luminance(hex) > 0.18) return rgbToHex(rgb.map((c) => c * 0.62));
    return rgbToHex(rgb.map((c) => c + (1 - c) * 0.38));
  }

  // ── regions ──

  // The original box-fraction region spec (see detailsFor) → half-spaces
  // [nx, ny, nz, d] kept where dot(n, (|x|, y, z)) >= d.
  function regionPlanesFromBox(region, box) {
    const out = [];
    if (!region || !box) return out;
    const at = (axis, f) => box.min[axis] + (box.max[axis] - box.min[axis]) * f;
    const halfW = Math.max(Math.abs(box.min[0]), Math.abs(box.max[0]));
    const push = (x, y, z, d) => out.push([x, y, z, d]);
    if (region.vee) {
      const v = region.vee;
      push(-v.slope, 1, 0, at(1, v.top) - v.depth * (box.max[1] - box.min[1]));
    }
    if (region.under) push(region.under.slope, -1, 0, -at(1, region.under.y));
    if (region.armhole) {
      // Kept above a line that drops `slope` × the part's height from the
      // centre line (at `y`) to its outer edge: a tank top's shoulders and
      // armholes, together with xAbs.
      const a = region.armhole;
      push(a.slope * (box.max[1] - box.min[1]) / (halfW || 1), 1, 0, at(1, a.y));
    }
    if (region.y) {
      if (region.y[0] != null) push(0, 1, 0, at(1, region.y[0]));
      if (region.y[1] != null) push(0, -1, 0, -at(1, region.y[1]));
    }
    if (region.xAbs) {
      if (region.xAbs[0] != null) push(1, 0, 0, halfW * region.xAbs[0]);
      if (region.xAbs[1] != null) push(-1, 0, 0, -halfW * region.xAbs[1]);
    }
    if (region.z) {
      if (region.z[0] != null) push(0, 0, 1, at(2, region.z[0]));
      if (region.z[1] != null) push(0, 0, -1, -at(2, region.z[1]));
    }
    return out;
  }

  // A diagonal band (sash, quiver strap) as two parallel planes in the xy
  // plane, NOT mirrored: from point a to point b (x,y), `width` wide.
  function bandPlanes(a, b, width) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;           // ⟂ the band's direction
    const d0 = nx * a[0] + ny * a[1];
    return [[nx, ny, 0, d0 - width / 2], [-nx, -ny, 0, -(d0 + width / 2)]];
  }

  return {
    PART, measureHead, measureTorso, surfaceAt, torsoLandmarks,
    glassesFit, hatFit, hoodFit, maskRegion, visorFit, helmetFit, rimPlane,
    autoAccent, contrastRatio, luminance,
    regionPlanesFromBox, bandPlanes
  };
});
