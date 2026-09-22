/************************************************
 * PLAYGROUND 3D — house finishes for keeper-decorated /world houses
 *
 * The parts of a house the keeper can restyle beyond colour:
 *   wallTexture(THREE, style)   shared, cached canvas textures (plaster /
 *                               brick / stone / timber). Painted on WHITE:
 *                               Lambert output is map × color, so the wall
 *                               palette colour tints every finish and a
 *                               texture can only darken — joints stay white
 *                               (= pure wall colour), block bodies go a
 *                               touch darker. One tile = TILE_W × TILE_H
 *                               world units; playground3d.js rewrites each
 *                               wall panel's UVs from world position so the
 *                               grid runs unbroken across fillers / sills.
 *   windowGlass(THREE, style)   a translucent pane with a per-style mullion
 *                               pattern (texture cached per style).
 *   roofExtra(THREE, opts)      the pitched part (gable prism / hip pyramid)
 *                               plus fascia and chimney, sitting ON TOP of
 *                               the flat slab playground3d.js already builds
 *                               (the slab stays: it is the ceiling that hides
 *                               when you walk in).
 *   roofHeightAt(...)           pure roof-surface math (tested in Node).
 *
 * Cheap primitives only, like playground3d-props.js. UMD like
 * world-house-logic.js so `roofHeightAt` is unit-testable without THREE.
 * Global: PG3DHouse. Loaded in the `world` chunk before playground3d.js.
 ************************************************/
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PG3DHouse = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const TILE_W = 2, TILE_H = 1;          // world units covered by one texture tile
  const TEX_W = 128, TEX_H = 64;         // texels per tile (2:1 like the tile)
  const PLATFORM_HALF = 6;
  const OVERHANG = 0.5;                  // eaves past the wall line
  const BASE_HALF = PLATFORM_HALF + OVERHANG;
  const PITCH = { flat: 0, gable: 2.6, hip: 2.2 };
  const CHIMNEY_AT = { x: 3.5, z: -3.5 }; // NE-ish corner: off the ridge whichever way it runs
  const BRICK = 0x8a5a4a, BRICK_CAP = 0x5a4a44;

  const _wallTex = new Map();            // style → CanvasTexture
  const _glassTex = new Map();           // style → CanvasTexture
  const _shared = new Set();             // every texture above (never disposed per house)

  // Deterministic PRNG so a cached texture is identical on every mount.
  function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  }

  // ── wall finishes ──

  const WALL_PAINTERS = {
    plaster(ctx, rnd) {
      // Faint stucco speckle over white (the original recipe).
      for (let i = 0; i < 900; i++) {
        const a = 0.05 + rnd() * 0.06;
        ctx.fillStyle = (rnd() > 0.5) ? `rgba(255,255,255,${a})` : `rgba(80,66,44,${a})`;
        ctx.fillRect(rnd() * TEX_W, rnd() * TEX_H, 1, 1);
      }
    },
    brick(ctx, rnd) {
      // 4 courses per tile, 4 bricks per course, every other course offset by
      // half a brick. Mortar = the untouched white gaps.
      const rows = 4, cols = 4, bh = TEX_H / rows, bw = TEX_W / cols, gap = 2;
      for (let r = 0; r < rows; r++) {
        const off = (r % 2) ? bw / 2 : 0;
        for (let c = -1; c <= cols; c++) {
          const x = c * bw + off, y = r * bh;
          const dark = 0.15 + rnd() * 0.07;
          ctx.fillStyle = `rgba(0,0,0,${dark})`;
          ctx.fillRect(x + gap / 2, y + gap / 2, bw - gap, bh - gap);
          ctx.strokeStyle = 'rgba(0,0,0,0.25)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x + gap / 2 + 0.5, y + gap / 2 + 0.5, bw - gap - 1, bh - gap - 1);
        }
      }
    },
    stone(ctx, rnd) {
      // Three uneven courses of 2–3 blocks each; joints stay white.
      const courses = [[0, 22], [22, 20], [42, 22]];
      const gap = 3;
      courses.forEach(([y, h], i) => {
        const n = 2 + ((i + 1) % 2);
        let x = (i % 2) ? -TEX_W / (n * 2) : 0;
        // widths sum to TEX_W (+ the wrapped half block) so the tile repeats cleanly
        for (let k = 0; k <= n; k++) {
          const w = TEX_W / n;
          const dark = 0.13 + rnd() * 0.1;
          ctx.fillStyle = `rgba(0,0,0,${dark})`;
          ctx.fillRect(x + gap / 2, y + gap / 2, w - gap, h - gap);
          ctx.strokeStyle = 'rgba(0,0,0,0.22)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x + gap / 2 + 0.5, y + gap / 2 + 0.5, w - gap - 1, h - gap - 1);
          // a few pits so each block reads as rough stone
          for (let p = 0; p < 3; p++) {
            ctx.fillStyle = `rgba(0,0,0,${0.08 + rnd() * 0.08})`;
            ctx.fillRect(x + gap + rnd() * (w - gap * 2), y + gap + rnd() * (h - gap * 2), 2, 1);
          }
          x += w;
        }
      });
    },
    timber(ctx, rnd) {
      // Vertical planks (white, i.e. the wall colour) split by dark seams,
      // with faint grain so they read as wood rather than stripes.
      const plank = 16, seam = 2;
      for (let x = 0; x < TEX_W; x += plank) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(x, 0, seam, TEX_H);
        for (let g = 0; g < 4; g++) {
          const gx = x + seam + 1 + rnd() * (plank - seam - 2);
          const gy = rnd() * TEX_H, gl = 6 + rnd() * 20;
          ctx.fillStyle = `rgba(0,0,0,${0.04 + rnd() * 0.05})`;
          ctx.fillRect(gx, gy, 1, gl);
        }
      }
      // One horizontal rail per tile so the framing shows.
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(0, TEX_H - 3, TEX_W, 3);
    }
  };

  function wallTexture(THREE, style) {
    if (!THREE || !THREE.CanvasTexture || typeof document === 'undefined') return null;
    const key = WALL_PAINTERS[style] ? style : 'plaster';
    let tex = _wallTex.get(key);
    if (tex) return tex;
    const canvas = document.createElement('canvas');
    canvas.width = TEX_W; canvas.height = TEX_H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, TEX_W, TEX_H);
    WALL_PAINTERS[key](ctx, seeded(0x1234567 + key.length * 977));
    tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    _wallTex.set(key, tex);
    _shared.add(tex);
    return tex;
  }

  // ── window glass ──

  const GLASS_BARS = {
    cross:    [['v', 0.5], ['h', 0.5]],
    grid:     [['v', 0.5], ['h', 1 / 3], ['h', 2 / 3]],
    plain:    [],
    shutters: []
  };

  function glassTexture(THREE, style) {
    const key = GLASS_BARS[style] ? style : 'cross';
    let tex = _glassTex.get(key);
    if (tex) return tex;
    const S = 128;
    const canvas = document.createElement('canvas');
    canvas.width = S; canvas.height = S;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, S, S);                      // start fully transparent
    // Faint glass tint + a soft sheen across the top so it reads as glass.
    ctx.fillStyle = 'rgba(200,222,240,0.12)';
    ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(0, 0, S, S * 0.42);
    // Opaque frame + this style's mullions.
    ctx.fillStyle = '#6e5a3a';
    const fr = 8;
    ctx.fillRect(0, 0, S, fr); ctx.fillRect(0, S - fr, S, fr);
    ctx.fillRect(0, 0, fr, S); ctx.fillRect(S - fr, 0, fr, S);
    for (const [dir, at] of GLASS_BARS[key]) {
      if (dir === 'v') ctx.fillRect(S * at - 3, 0, 6, S);
      else ctx.fillRect(0, S * at - 3, S, 6);
    }
    tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;               // a wide pane repeats the pattern per cell
    _glassTex.set(key, tex);
    _shared.add(tex);
    return tex;
  }

  // A translucent pane for a carved window opening — mostly clear so the
  // interior shows through the wall hole. `repeat` (default 1) tiles the
  // mullion pattern that many times across the width, so a double window
  // (two adjacent cells merged into one pane) shows two framed panes.
  // Caller positions / orients it.
  function windowGlass(THREE, style, w, h, repeat) {
    if (!THREE || !THREE.CanvasTexture || typeof document === 'undefined') return null;
    const mat = new THREE.MeshBasicMaterial({
      map: glassTexture(THREE, style), transparent: true, depthWrite: false, side: THREE.DoubleSide
    });
    mat.userData.keepMap = true;                    // texture is shared across the town
    const geom = new THREE.PlaneGeometry(w, h);
    const n = Math.max(1, Math.round(repeat || 1));
    if (n > 1 && geom.attributes.uv) {
      const uv = geom.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * n);
      uv.needsUpdate = true;
    }
    return new THREE.Mesh(geom, mat);
  }

  // See-through wall material for the 'glass' finish: a pale tint (or the
  // keeper's wall colour) at low opacity. No shadows — glass casting a solid
  // shadow reads wrong. Each panel gets its own instance like the others.
  const GLASS_TINT = 0xcfe6f5;
  function glassWallMaterial(THREE, color) {
    return new THREE.MeshLambertMaterial({
      color: color != null ? color : GLASS_TINT, transparent: true, opacity: 0.32
    });
  }

  function isShared(tex) { return !!tex && _shared.has(tex); }

  // ── roof ──

  // Height of the pitched surface above its base at platform-local (lx, lz).
  // gable dir 0: ridge runs along x (E–W), so the slope depends on z; dir 1
  // swaps. hip: a pyramid. flat: 0. Never negative.
  function roofHeightAt(style, dir, lx, lz, pitch) {
    const P = (pitch != null) ? pitch : (PITCH[style] || 0);
    if (!P) return 0;
    let t;
    if (style === 'gable') t = Math.abs(dir === 1 ? lx : lz) / BASE_HALF;
    else if (style === 'hip') t = Math.max(Math.abs(lx), Math.abs(lz)) / BASE_HALF;
    else return 0;
    return Math.max(0, P * (1 - t));
  }

  // Non-indexed triangle soup with outward-facing winding: each triangle is
  // flipped if its normal points toward the roof's interior reference point,
  // so FrontSide materials render every face without hand-checking winding.
  function triSoup(THREE, tris, ref, uvFor) {
    const pos = [], uv = [];
    const ax = new THREE.Vector3(), bx = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Vector3();
    for (let [a, b, cc] of tris) {
      ax.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      bx.set(cc[0] - a[0], cc[1] - a[1], cc[2] - a[2]);
      n.crossVectors(ax, bx);
      c.set((a[0] + b[0] + cc[0]) / 3 - ref[0], (a[1] + b[1] + cc[1]) / 3 - ref[1], (a[2] + b[2] + cc[2]) / 3 - ref[2]);
      if (n.dot(c) < 0) { const t = b; b = cc; cc = t; }
      for (const v of [a, b, cc]) {
        pos.push(v[0], v[1], v[2]);
        if (uvFor) { const [u, w] = uvFor(v); uv.push(u, w); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (uvFor) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    return g;
  }

  // Build the parts above the flat slab. `opts`:
  //   style, dir, chimney            — from the house
  //   roofMat                        — the slab's material (shared; NOT owned here)
  //   wallMat                        — gable-end material (owned by the caller via userData.owned)
  //   trimColor                      — fascia colour
  //   baseY                          — world y of the roof base (slab top − 0.02)
  // Returns a Group positioned by the caller at the platform centre (y = 0),
  // with userData.topY = highest world y, or null when there is nothing to add.
  function roofExtra(THREE, opts) {
    if (!THREE) return null;
    const style = opts.style || 'flat';
    const dir = opts.dir === 1 ? 1 : 0;
    const P = PITCH[style] || 0;
    const baseY = opts.baseY || 0;
    const wantChimney = !!opts.chimney;
    if (!P && !wantChimney) return null;

    const g = new THREE.Group();
    const B = BASE_HALF;
    const ref = [0, baseY + P * 0.3, 0];
    const own = (m) => { m.userData.owned = true; return m; };

    if (P) {
      let slopes, ends = null;
      if (style === 'gable') {
        // Ridge along x (dir 0): eaves at z = ±B; dir 1 mirrors the axes.
        const v = (x, y, z) => dir === 1 ? [z, y, x] : [x, y, z];
        const e1 = v(-B, baseY, -B), e2 = v(B, baseY, -B), e3 = v(B, baseY, B), e4 = v(-B, baseY, B);
        const r1 = v(-B, baseY + P, 0), r2 = v(B, baseY + P, 0);
        slopes = triSoup(THREE, [[e1, e2, r2], [e1, r2, r1], [e4, e3, r2], [e4, r2, r1]], ref);
        // Gable ends carry the wall finish so the house reads as one body;
        // UVs follow world position like the wall panels below them.
        const uvFor = (p) => [(dir === 1 ? p[0] + (opts.centreX || 0) : p[2] + (opts.centreZ || 0)) / TILE_W, p[1] / TILE_H];
        ends = triSoup(THREE, [[e1, e4, r1], [e2, e3, r2]], ref, uvFor);
      } else {
        const apex = [0, baseY + P, 0];
        const e1 = [-B, baseY, -B], e2 = [B, baseY, -B], e3 = [B, baseY, B], e4 = [-B, baseY, B];
        slopes = triSoup(THREE, [[e1, e2, apex], [e2, e3, apex], [e3, e4, apex], [e4, e1, apex]], ref);
      }
      const roof = new THREE.Mesh(slopes, opts.roofMat);
      roof.castShadow = true;
      g.add(roof);
      if (ends && opts.wallMat) {
        const em = new THREE.Mesh(ends, opts.wallMat);
        em.castShadow = true;
        g.add(em);
      }
      // Fascia board under the eaves in the trim colour.
      const fascia = new THREE.Mesh(
        new THREE.BoxGeometry(B * 2 + 0.2, 0.15, B * 2 + 0.2),
        own(new THREE.MeshLambertMaterial({ color: opts.trimColor != null ? opts.trimColor : 0x9a8c6f }))
      );
      fascia.position.set(0, baseY + 0.02, 0);
      fascia.castShadow = true;
      g.add(fascia);
    }

    let topY = baseY + P;
    if (wantChimney) {
      const surface = baseY + roofHeightAt(style, dir, CHIMNEY_AT.x, CHIMNEY_AT.z, P);
      const stack = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.6, 0.8), own(new THREE.MeshLambertMaterial({ color: BRICK })));
      stack.position.set(CHIMNEY_AT.x, surface + 0.6, CHIMNEY_AT.z);   // sunk 0.2 into the roof
      stack.castShadow = true;
      g.add(stack);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.12, 1.0), own(new THREE.MeshLambertMaterial({ color: BRICK_CAP })));
      cap.position.set(CHIMNEY_AT.x, surface + 1.4, CHIMNEY_AT.z);
      cap.castShadow = true;
      g.add(cap);
      topY = Math.max(topY, surface + 1.46);
    }
    g.userData.topY = topY;
    return g;
  }

  // Free a roofExtra group: geometries always, materials only when owned
  // (the slab's roof material and the wall material belong to the node).
  function disposeRoofExtra(group) {
    if (!group) return;
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of mats) if (m.userData && m.userData.owned) m.dispose();
    });
    if (group.parent) group.parent.remove(group);
  }

  return { TILE_W, TILE_H, PITCH, OVERHANG, GLASS_TINT, wallTexture, windowGlass, glassWallMaterial, roofExtra, disposeRoofExtra, roofHeightAt, isShared };
});
