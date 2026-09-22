/************************************************
 * PLAYGROUND 3D — interior props for keeper-decorated /world houses
 *
 * Cheap three.js primitives (boxes, cylinders, spheres — no textures apart
 * from the shared lamp glow) in the same spirit as playground3d.js's
 * _makeLamp. Each builder returns a THREE.Group centred at the origin with
 * its feet at y=0; playground3d.js positions it on the platform, rotates it
 * in 90° steps, and registers the footprint as a collision box.
 *
 * Kinds mirror WorldHouseLogic.PROP_KINDS: chair, table, frame, plant,
 * lamp, rug, bookshelf, crate.
 *
 * Global: PG3DProps. Loaded in the `world` chunk before playground3d.js.
 ************************************************/
const PG3DProps = (() => {

  const WOOD = 0x7a5a3a, WOOD_DARK = 0x4e3a25, IRON = 0x3a342a, LEAF = 0x4f8a52, POT = 0xb5563f;

  // Half extents (at rot 0) for the collision box; `solid: false` = walk over.
  const FOOTPRINTS = {
    chair:     { hx: 0.35, hz: 0.35, solid: true },
    table:     { hx: 0.70, hz: 0.40, solid: true },
    frame:     { hx: 0.70, hz: 0.05, solid: false },   // wall-hung; the wall itself collides
    plant:     { hx: 0.30, hz: 0.30, solid: true },
    lamp:      { hx: 0.18, hz: 0.18, solid: true },
    rug:       { hx: 1.00, hz: 0.70, solid: false },
    bookshelf: { hx: 0.60, hz: 0.22, solid: true },
    crate:     { hx: 0.40, hz: 0.40, solid: true }
  };

  function footprint(kind) {
    return FOOTPRINTS[kind] || { hx: 0.3, hz: 0.3, solid: true };
  }

  function box(THREE, w, h, d, color, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
  function cyl(THREE, rTop, rBot, h, color, x, y, z, segs) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, segs || 8), new THREE.MeshLambertMaterial({ color }));
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
  }
  function legs(THREE, g, hx, hz, h, r, color) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cyl(THREE, r, r, h, color, sx * hx, h / 2, sz * hz, 6));
  }

  const BUILDERS = {
    chair(THREE, o) {
      const g = new THREE.Group();
      legs(THREE, g, 0.25, 0.25, 0.45, 0.03, WOOD_DARK);
      g.add(box(THREE, 0.6, 0.08, 0.6, o.accent, 0, 0.49, 0));
      g.add(box(THREE, 0.6, 0.6, 0.06, WOOD, 0, 0.83, -0.27));
      return g;
    },
    table(THREE, o) {
      const g = new THREE.Group();
      legs(THREE, g, 0.6, 0.3, 0.72, 0.04, WOOD_DARK);
      g.add(box(THREE, 1.4, 0.08, 0.8, WOOD, 0, 0.76, 0));
      return g;
    },
    frame(THREE, o) {
      // A framed picture hung on a wall: the group's origin sits ON the wall's
      // inner face (z = 0) and the picture faces +z into the room; playground3d
      // places it against the wall WorldHouseLogic.frameWall picks. With a
      // keeper portrait (o.hasPortrait) the picture plane is left white for
      // playground3d.js to texture once the image loads (g.userData.picture);
      // otherwise a two-tone placeholder so it still reads as art.
      const g = new THREE.Group();
      const y = 1.5;                                   // picture centre height
      g.add(box(THREE, 1.4, 1.05, 0.06, o.accent, 0, y, 0.03));
      const picture = new THREE.Mesh(
        new THREE.PlaneGeometry(1.24, 0.9),
        new THREE.MeshBasicMaterial({ color: o.hasPortrait ? 0xffffff : 0xf5f0e6 })
      );
      picture.position.set(0, y, 0.065);
      g.add(picture);
      g.userData.picture = picture;
      if (!o.hasPortrait) g.add(box(THREE, 0.8, 0.5, 0.02, o.roof, 0, y + 0.05, 0.08));
      return g;
    },
    plant(THREE, o) {
      const g = new THREE.Group();
      g.add(cyl(THREE, 0.22, 0.17, 0.35, POT, 0, 0.175, 0, 10));
      const leaf = new THREE.MeshLambertMaterial({ color: LEAF });
      for (const [x, y, z, r] of [[0, 0.62, 0, 0.3], [0.2, 0.5, 0.1, 0.2], [-0.18, 0.55, -0.12, 0.22]]) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), leaf);
        s.position.set(x, y, z);
        s.castShadow = true;
        g.add(s);
      }
      return g;
    },
    lamp(THREE, o) {
      // Same recipe as the doorway lamps in playground3d.js: post, emissive
      // head, additive glow sprite on the shared lamp texture.
      const g = new THREE.Group();
      const postH = 1.6;
      g.add(cyl(THREE, 0.05, 0.12, postH, IRON, 0, postH / 2, 0, 8));
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshBasicMaterial({ color: o.lamp }));
      head.position.set(0, postH + 0.1, 0);
      g.add(head);
      if (o.lampTex && THREE.Sprite) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: o.lampTex, color: o.lamp,
          blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
        }));
        sprite.scale.set(1.4, 1.4, 1);
        sprite.position.set(0, postH + 0.1, 0);
        g.add(sprite);
      }
      return g;
    },
    rug(THREE, o) {
      const g = new THREE.Group();
      const mk = (w, d, color, y) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({
          color, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
        }));
        m.rotation.x = -Math.PI / 2;
        m.position.y = y;
        m.receiveShadow = true;
        return m;
      };
      g.add(mk(2.0, 1.4, o.accent, 0.012));
      g.add(mk(1.6, 1.0, o.roof, 0.016));
      return g;
    },
    bookshelf(THREE, o) {
      const g = new THREE.Group();
      g.add(box(THREE, 0.06, 1.8, 0.4, WOOD, -0.57, 0.9, 0));
      g.add(box(THREE, 0.06, 1.8, 0.4, WOOD, 0.57, 0.9, 0));
      g.add(box(THREE, 1.2, 0.05, 0.4, WOOD, 0, 1.78, 0));
      g.add(box(THREE, 1.2, 1.8, 0.04, WOOD_DARK, 0, 0.9, -0.18));
      const bookColors = [0xb5563f, 0x6478a6, 0x6f8f5a, 0xb98a3f, 0x8a5a86];
      for (let s = 0; s < 3; s++) {
        const y = 0.35 + s * 0.55;
        g.add(box(THREE, 1.08, 0.05, 0.36, WOOD, 0, y - 0.2, 0));
        g.add(box(THREE, 0.95, 0.34, 0.24, bookColors[(s * 2) % bookColors.length], -0.02, y, -0.03));
        g.add(box(THREE, 0.5, 0.3, 0.2, bookColors[(s * 2 + 1) % bookColors.length], 0.2, y + 0.02, 0.05));
      }
      return g;
    },
    crate(THREE, o) {
      const g = new THREE.Group();
      g.add(box(THREE, 0.8, 0.8, 0.8, WOOD, 0, 0.4, 0));
      for (const y of [0.06, 0.74]) {
        g.add(box(THREE, 0.84, 0.06, 0.84, WOOD_DARK, 0, y, 0));
      }
      g.add(box(THREE, 0.06, 0.8, 0.84, WOOD_DARK, -0.4, 0.4, 0));
      g.add(box(THREE, 0.06, 0.8, 0.84, WOOD_DARK, 0.4, 0.4, 0));
      return g;
    }
  };

  // Build one prop. `opts`: { THREE, lampTex, lampColor, trimColor, roofColor,
  // hasPortrait } — house colours tint the accent parts so props match the room.
  function make(kind, opts) {
    const THREE = (opts && opts.THREE) || window.THREE;
    const build = BUILDERS[kind];
    if (!THREE || !build) return null;
    const o = {
      lampTex: opts && opts.lampTex,
      hasPortrait: !!(opts && opts.hasPortrait),
      lamp:   (opts && opts.lampColor != null) ? opts.lampColor : 0xffd98a,
      accent: (opts && opts.trimColor != null) ? opts.trimColor : 0x9a8c6f,
      roof:   (opts && opts.roofColor != null) ? opts.roofColor : 0x6478a6
    };
    const g = build(THREE, o);
    g.userData.propKind = kind;
    return g;
  }

  return { KINDS: Object.keys(FOOTPRINTS), footprint, make };
})();
