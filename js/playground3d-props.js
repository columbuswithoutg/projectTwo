/************************************************
 * PLAYGROUND 3D — interior props for keeper-decorated /world houses and
 * decorated /home rooms
 *
 * Cheap three.js primitives (boxes, cylinders, spheres — no textures apart
 * from the shared lamp glow) in the same spirit as playground3d.js's
 * _makeLamp. Each builder returns a THREE.Group centred at the origin with
 * its feet at y=0; playground3d.js positions it on the platform, rotates it
 * in 90° steps, and registers the footprint as a collision box.
 *
 * Kinds mirror WorldHouseLogic.PROP_KINDS. Local axes: the front faces +z,
 * the back is at −z, width runs along x.
 *
 * Joining: pieces of one group standing side by side (WorldHouseLogic
 * JOIN_GROUP) are built exactly one cell (1.0) wide and flush, with no end
 * panel / arm / leg on a joined side — so the seam is invisible and a row of
 * tables is one long table, counters + sink + stove one worktop. A piece with
 * no neighbour keeps its original, roomier width. The engine passes the
 * neighbours in `opts` (joinL / joinR, rugs: joinN / joinS / joinE / joinW,
 * sofas: armL / armR).
 *
 * Behaviour: a builder may set `g.userData.act` = { label(on), apply(on),
 * tick?(on, dt, t) } — a toggle the player works with E (TV, fire, stove,
 * tap, fan, shower; fridge / wardrobe / dresser open and close) — and
 * `g.userData.anim(t)` for ambient motion that needs no input (a clock's
 * hands, fish, fairy lights).
 *
 * Global: PG3DProps. Loaded in the `world` chunk before playground3d.js.
 ************************************************/
const PG3DProps = (() => {

  const WOOD = 0x7a5a3a, WOOD_DARK = 0x4e3a25, WOOD_LIGHT = 0xb08a5a, IRON = 0x3a342a, LEAF = 0x4f8a52, POT = 0xb5563f;
  const WHITE = 0xf1f1ee, STEEL = 0xbcc2c7, STEEL_D = 0x6f767c, CREAM = 0xf2e6d0, BLACK = 0x1d1f22, CHROME = 0xd9dde0;
  const CAB = 0xe9e2d2, STONE_TOP = 0x4b5258, TILE = 0xe4ebee, BRICK = 0x9a5b45, STONE = 0x8d8a84;
  const BOOKS = [0xb5563f, 0x6478a6, 0x6f8f5a, 0xb98a3f, 0x8a5a86];

  // Half extents (at rot 0) for the collision box; `solid: false` = walk over.
  // `top` = height of a surface the player can stand on (jump onto it, walk
  // off it) — and the height small TOP_KINDS stand at; a solid prop without
  // `top` (plant, lamp, fridge) just blocks. A hx larger than 0.5 is the
  // roomy width of a lone piece; joined into a run it shrinks to one cell.
  const FOOTPRINTS = {
    chair:     { hx: 0.35, hz: 0.35, solid: true, top: 0.53 },
    table:     { hx: 0.70, hz: 0.40, solid: true, top: 0.80 },
    frame:     { hx: 0.70, hz: 0.05, solid: false },   // wall-hung; the wall itself collides
    plant:     { hx: 0.30, hz: 0.30, solid: true },
    lamp:      { hx: 0.18, hz: 0.18, solid: true },
    rug:       { hx: 1.00, hz: 0.70, solid: false },
    bookshelf: { hx: 0.60, hz: 0.22, solid: true, top: 1.805 },
    crate:     { hx: 0.40, hz: 0.40, solid: true, top: 0.80 },
    bed:       { hx: 0.50, hz: 1.00, solid: true, top: 0.60 },   // 2 cells: headboard at −z
    // living
    sofa:      { hx: 0.80, hz: 0.45, solid: true, top: 0.50 },
    armchair:  { hx: 0.45, hz: 0.45, solid: true, top: 0.50 },
    stool:     { hx: 0.22, hz: 0.22, solid: true, top: 0.66 },
    coffee_table: { hx: 0.50, hz: 0.30, solid: true, top: 0.45 },
    tv:        { hx: 0.50, hz: 0.25, solid: true },
    fireplace: { hx: 0.60, hz: 0.28, solid: true },
    piano:     { hx: 0.60, hz: 0.30, solid: true },
    aquarium:  { hx: 0.50, hz: 0.25, solid: true },
    // work / storage
    desk:      { hx: 0.60, hz: 0.35, solid: true, top: 0.76 },
    workbench: { hx: 0.75, hz: 0.35, solid: true, top: 0.90 },
    shoerack:  { hx: 0.40, hz: 0.18, solid: true, top: 0.62 },
    treadmill: { hx: 0.40, hz: 1.00, solid: true, top: 0.28 },   // 2 cells
    // kitchen
    counter:   { hx: 0.50, hz: 0.33, solid: true, top: 0.92 },
    sink:      { hx: 0.50, hz: 0.33, solid: true, top: 0.92 },
    stove:     { hx: 0.50, hz: 0.33, solid: true, top: 0.92 },
    washer:    { hx: 0.45, hz: 0.35, solid: true, top: 0.90 },
    fridge:    { hx: 0.47, hz: 0.38, solid: true },
    bin:       { hx: 0.20, hz: 0.20, solid: true },
    // bath
    toilet:    { hx: 0.25, hz: 0.38, solid: true, top: 0.42 },
    bathtub:   { hx: 0.45, hz: 1.00, solid: true, top: 0.55 },   // 2 cells: taps at −z
    shower:    { hx: 0.50, hz: 0.50, solid: true },
    // bedroom
    wardrobe:  { hx: 0.50, hz: 0.30, solid: true },
    dresser:   { hx: 0.55, hz: 0.25, solid: true, top: 0.85 },
    nightstand:{ hx: 0.25, hz: 0.22, solid: true, top: 0.55 },
    crib:      { hx: 0.50, hz: 0.55, solid: true },
    petbed:    { hx: 0.38, hz: 0.38, solid: false },
    // hung / overhead / on-a-surface: never collide
    mirror:    { hx: 0.40, hz: 0.04, solid: false },
    clock:     { hx: 0.28, hz: 0.04, solid: false },
    curtains:  { hx: 0.75, hz: 0.06, solid: false },
    towelrack: { hx: 0.35, hz: 0.04, solid: false },
    stringlights: { hx: 0.70, hz: 0.04, solid: false },
    fan:       { hx: 0.50, hz: 0.50, solid: false },
    hangplant: { hx: 0.30, hz: 0.30, solid: false },
    microwave: { hx: 0.25, hz: 0.19, solid: false },
    kettle:    { hx: 0.15, hz: 0.15, solid: false },
    pots:      { hx: 0.30, hz: 0.18, solid: false },
    fruitbowl: { hx: 0.20, hz: 0.20, solid: false },
    plates:    { hx: 0.22, hz: 0.18, solid: false },
    toaster:   { hx: 0.15, hz: 0.10, solid: false },
    vase:      { hx: 0.10, hz: 0.10, solid: false },
    laptop:    { hx: 0.18, hz: 0.14, solid: false },
    console:   { hx: 0.18, hz: 0.12, solid: false },
    books:     { hx: 0.15, hz: 0.12, solid: false }
  };

  // `w` is either true (the piece is joined into a run: exactly one cell
  // wide) or, for the older bookshelf-run call, a width in cells.
  function footprint(kind, w) {
    const fp = FOOTPRINTS[kind] || { hx: 0.3, hz: 0.3, solid: true };
    if (w === true) return fp.hx > 0.5 ? { ...fp, hx: 0.5 } : fp;
    if (kind === 'bookshelf' && w > 0) return { ...fp, hx: w / 2 };
    return fp;
  }

  // ── tiny mesh helpers (materials are shared per make() call) ──
  let MC = new Map();
  function lam(THREE, color) {
    let m = MC.get(color);
    if (!m) { m = new THREE.MeshLambertMaterial({ color }); MC.set(color, m); }
    return m;
  }
  function place(m, x, y, z, shadow) {
    m.position.set(x, y, z);
    m.castShadow = shadow !== false;
    m.receiveShadow = true;
    return m;
  }
  function box(THREE, w, h, d, color, x, y, z) {
    return place(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lam(THREE, color)), x, y, z);
  }
  function cyl(THREE, rTop, rBot, h, color, x, y, z, segs) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, segs || 8), lam(THREE, color));
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
  }
  function sph(THREE, r, color, x, y, z, segs) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, segs || 8, 6), lam(THREE, color));
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
  }
  // Unlit (emissive-looking) box with its OWN material, so it can change colour.
  function lit(THREE, w, h, d, color, x, y, z, opacity) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: opacity != null, opacity: opacity == null ? 1 : opacity });
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
  }
  function glass(THREE, w, h, d, x, y, z, color) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: color || 0xa9d4e6, transparent: true, opacity: 0.32, depthWrite: false }));
    m.position.set(x, y, z);
    return m;
  }
  function legs(THREE, g, hx, hz, h, r, color) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cyl(THREE, r, r, h, color, sx * hx, h / 2, sz * hz, 6));
  }
  // A door hinged at (x, y, z): returns the pivot group; the door panel hangs
  // off it toward +x (hinge on the left) or −x (hinge on the right).
  function hinged(THREE, x, y, z, w, h, d, color, side) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    pivot.add(box(THREE, w, h, d, color, side === 'left' ? w / 2 : -w / 2, 0, d / 2));
    return pivot;
  }
  // Eased 0..1 swing used by every openable: returns { set(on), tick(on, dt) }.
  function swing(apply) {
    let v = 0;
    return {
      set(on) { v = on ? 1 : 0; apply(v); },
      tick(on, dt) {
        const target = on ? 1 : 0;
        if (v === target) return;
        v += (target - v) * Math.min(1, dt * 9);
        if (Math.abs(target - v) < 0.01) v = target;
        apply(v);
      }
    };
  }

  const joined = (o) => !!(o.joinL || o.joinR);

  // ── kitchen: counter / sink / stove share one cabinet ──
  function cabinet(THREE, o, kind) {
    const g = new THREE.Group();
    g.add(box(THREE, 1.0, 0.08, 0.56, IRON, 0, 0.04, -0.02));                 // toe kick
    g.add(box(THREE, 1.0, 0.76, 0.62, CAB, 0, 0.46, 0));                      // carcass
    const top = kind === 'stove' ? BLACK : STONE_TOP;
    g.add(box(THREE, 1.0, 0.06, 0.68, top, 0, 0.89, 0.01));                   // worktop (flush with its neighbours)
    g.add(box(THREE, 0.88, 0.5, 0.025, o.accent, 0, 0.5, 0.32));              // door
    if (kind !== 'stove') g.add(box(THREE, 0.04, 0.14, 0.03, CHROME, 0.36, 0.62, 0.345));
    if (kind === 'counter') {
      g.add(box(THREE, 0.86, 0.02, 0.012, WOOD_DARK, 0, 0.78, 0.335));        // drawer seam
    }
    if (kind === 'sink') {
      g.add(box(THREE, 0.62, 0.025, 0.42, STEEL, 0, 0.915, 0.02));            // basin
      g.add(box(THREE, 0.5, 0.03, 0.3, STEEL_D, 0, 0.91, 0.02));
      g.add(cyl(THREE, 0.025, 0.025, 0.3, CHROME, 0, 1.04, -0.24, 6));         // tap
      const spout = box(THREE, 0.025, 0.025, 0.2, CHROME, 0, 1.18, -0.14);
      g.add(spout);
      const stream = lit(THREE, 0.025, 0.22, 0.025, 0x8fd0ee, 0, 1.06, -0.04, 0.7);
      stream.visible = false;
      g.add(stream);
      g.userData.act = {
        label: (on) => (on ? 'Turn off tap' : 'Turn on tap'),
        apply(on) { stream.visible = on; },
        tick(on, dt, t) { if (on) stream.scale.y = 0.85 + 0.15 * Math.sin(t * 24); }
      };
    }
    if (kind === 'stove') {
      g.add(box(THREE, 0.86, 0.46, 0.03, STEEL, 0, 0.5, 0.325));              // oven door
      g.add(box(THREE, 0.6, 0.26, 0.02, BLACK, 0, 0.5, 0.345));                // oven window
      g.add(box(THREE, 0.7, 0.03, 0.03, CHROME, 0, 0.77, 0.36));               // oven handle
      const burners = [];
      for (const [bx, bz] of [[-0.24, -0.14], [0.24, -0.14], [-0.24, 0.17], [0.24, 0.17]]) {
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.012, 14), new THREE.MeshBasicMaterial({ color: 0x3a3d42 }));
        ring.position.set(bx, 0.926, bz);
        g.add(ring);
        burners.push(ring);
      }
      for (let i = 0; i < 4; i++) {
        const knob = cyl(THREE, 0.03, 0.03, 0.03, CHROME, -0.3 + i * 0.2, 0.84, 0.355, 8);
        knob.rotation.x = Math.PI / 2;
        g.add(knob);
      }
      g.userData.act = {
        label: (on) => (on ? 'Turn off stove' : 'Turn on stove'),
        apply(on) { for (const b of burners) b.material.color.setHex(on ? 0xff6a2a : 0x3a3d42); },
        tick(on, dt, t) { if (on) burners.forEach((b, i) => b.material.color.setHex((Math.sin(t * 5 + i) > 0) ? 0xff6a2a : 0xff8a3a)); }
      };
    }
    return g;
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
      // Joined tables become one long top: no end legs on the joined sides.
      const g = new THREE.Group();
      const w = joined(o) ? 1.0 : 1.4;
      const x0 = -w / 2 + 0.1, x1 = w / 2 - 0.1;
      for (const [x, ok] of [[x0, !o.joinL], [x1, !o.joinR]]) {
        if (!ok) continue;
        for (const sz of [-1, 1]) g.add(cyl(THREE, 0.04, 0.04, 0.72, WOOD_DARK, x, 0.36, sz * 0.3, 6));
      }
      g.add(box(THREE, w, 0.08, 0.8, WOOD, 0, 0.76, 0));
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
      // Alone: the roomy 2.0 × 1.4 rug. Next to other rugs: a flush 1×1 tile
      // whose border only runs along the OUTER edges, so a block of rugs is
      // one big rug (the engine leaves such tiles unrotated — N/S/E/W are
      // world directions).
      const g = new THREE.Group();
      const mk = (w, d, color, y, x, z) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({
          color, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
        }));
        m.rotation.x = -Math.PI / 2;
        m.position.set(x || 0, y, z || 0);
        m.receiveShadow = true;
        return m;
      };
      const tile = o.joinN || o.joinS || o.joinE || o.joinW;
      if (!tile) {
        g.add(mk(2.0, 1.4, o.accent, 0.012));
        g.add(mk(1.6, 1.0, o.roof, 0.016));
        return g;
      }
      g.add(mk(1.0, 1.0, o.accent, 0.012));
      const b = 0.2;
      const x0 = o.joinW ? -0.5 : -0.5 + b, x1 = o.joinE ? 0.5 : 0.5 - b;
      const z0 = o.joinN ? -0.5 : -0.5 + b, z1 = o.joinS ? 0.5 : 0.5 - b;
      g.add(mk(x1 - x0, z1 - z0, o.roof, 0.016, (x0 + x1) / 2, (z0 + z1) / 2));
      return g;
    },
    bookshelf(THREE, o) {
      // A lone shelf is 1.2 wide; side by side they are exactly one cell each
      // and flush, with a divider where two meet, so a run reads as one wall
      // of shelving.
      const w = joined(o) ? 1.0 : ((o.width > 0) ? o.width : 1.2);
      const g = new THREE.Group();
      if (!o.joinL) g.add(box(THREE, 0.06, 1.8, 0.4, WOOD, -(w / 2 - 0.03), 0.9, 0));
      if (!o.joinR) g.add(box(THREE, 0.06, 1.8, 0.4, WOOD, (w / 2 - 0.03), 0.9, 0));
      if (o.joinL) g.add(box(THREE, 0.04, 1.8, 0.4, WOOD, -(w / 2 - 0.02), 0.9, 0));   // shared divider (drawn once, on the left)
      g.add(box(THREE, w, 0.05, 0.4, WOOD, 0, 1.78, 0));
      g.add(box(THREE, w, 1.8, 0.04, WOOD_DARK, 0, 0.9, -0.18));
      const bays = Math.max(1, Math.round(w / 1.1));
      const bayW = (w - 0.12) / bays;
      for (let b = 0; b < bays; b++) {
        const bx = -(w - 0.12) / 2 + bayW * (b + 0.5);
        if (b > 0) g.add(box(THREE, 0.04, 1.75, 0.36, WOOD, bx - bayW / 2, 0.88, 0));   // divider between bays
        for (let s = 0; s < 3; s++) {
          const y = 0.35 + s * 0.55;
          g.add(box(THREE, bayW - 0.04, 0.05, 0.36, WOOD, bx, y - 0.2, 0));
          g.add(box(THREE, bayW * 0.8, 0.34, 0.24, BOOKS[(s * 2 + b) % BOOKS.length], bx - bayW * 0.02, y, -0.03));
          g.add(box(THREE, bayW * 0.42, 0.3, 0.2, BOOKS[(s * 2 + 1 + b) % BOOKS.length], bx + bayW * 0.17, y + 0.02, 0.05));
        }
      }
      return g;
    },
    bed(THREE, o) {
      // Two cells long: the group origin is the midpoint, the headboard at
      // local −z (the anchor / pillow end), the foot toward +z. Blanket in
      // the trim colour, sheet cream. Beds side by side fuse into a double.
      const g = new THREE.Group();
      const w = 1.0;
      g.add(box(THREE, w, 0.35, 2.0, WOOD, 0, 0.175, 0));                // frame
      g.add(box(THREE, w - (o.joinL ? 0 : 0.08) - (o.joinR ? 0 : 0.08), 0.18, 1.9, 0xf2e6d0, (o.joinL ? 0 : 0.04) - (o.joinR ? 0 : 0.04), 0.44, 0));   // mattress / sheet
      g.add(box(THREE, w - 0.06, 0.08, 1.2, o.accent, 0, 0.57, 0.3));    // blanket over the lower half
      g.add(box(THREE, 0.6, 0.12, 0.35, 0xffffff, 0, 0.59, -0.7));       // pillow
      g.add(box(THREE, w, 0.9, 0.06, WOOD_DARK, 0, 0.45, -0.97));        // headboard
      g.add(box(THREE, w, 0.45, 0.06, WOOD_DARK, 0, 0.225, 0.97));       // footboard
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
    },

    // ── living room ──
    sofa(THREE, o) {
      // Cushions + back flush across a run; arms only at the OPEN ends (an end
      // that touches another sofa — a corner — has none).
      const g = new THREE.Group();
      const w = joined(o) ? 1.0 : 1.6;
      const armL = o.armL !== false, armR = o.armR !== false;
      const inner0 = armL ? -w / 2 + 0.2 : -w / 2, inner1 = armR ? w / 2 - 0.2 : w / 2;
      const iw = inner1 - inner0, ic = (inner0 + inner1) / 2;
      g.add(box(THREE, w, 0.18, 0.84, WOOD_DARK, 0, 0.09, 0));                                  // plinth
      g.add(box(THREE, iw, 0.2, 0.74, o.roof, ic, 0.28, 0.04));                                 // seat base
      g.add(box(THREE, w, 0.5, 0.2, o.roof, 0, 0.62, -0.32));                                   // back
      const cushions = Math.max(1, Math.round(iw / 0.8));
      const cw = iw / cushions;
      for (let i = 0; i < cushions; i++) g.add(box(THREE, cw - 0.04, 0.12, 0.56, o.accent, inner0 + cw * (i + 0.5), 0.44, 0.1));
      if (armL) g.add(box(THREE, 0.2, 0.45, 0.84, o.roof, -w / 2 + 0.1, 0.4, 0));
      if (armR) g.add(box(THREE, 0.2, 0.45, 0.84, o.roof, w / 2 - 0.1, 0.4, 0));
      return g;
    },
    armchair(THREE, o) {
      const g = new THREE.Group();
      g.add(box(THREE, 0.9, 0.16, 0.86, WOOD_DARK, 0, 0.08, 0));
      g.add(box(THREE, 0.56, 0.2, 0.72, o.roof, 0, 0.26, 0.05));
      g.add(box(THREE, 0.9, 0.55, 0.2, o.roof, 0, 0.62, -0.32));
      g.add(box(THREE, 0.5, 0.12, 0.56, o.accent, 0, 0.42, 0.1));
      g.add(box(THREE, 0.18, 0.44, 0.84, o.roof, -0.36, 0.38, 0));
      g.add(box(THREE, 0.18, 0.44, 0.84, o.roof, 0.36, 0.38, 0));
      return g;
    },
    stool(THREE, o) {
      const g = new THREE.Group();
      legs(THREE, g, 0.13, 0.13, 0.62, 0.025, WOOD_DARK);
      g.add(cyl(THREE, 0.2, 0.2, 0.06, o.accent, 0, 0.64, 0, 12));
      g.add(cyl(THREE, 0.15, 0.15, 0.02, WOOD_DARK, 0, 0.25, 0, 10));                          // foot ring
      return g;
    },
    coffee_table(THREE, o) {
      const g = new THREE.Group();
      const w = joined(o) ? 1.0 : 1.0;
      for (const [x, ok] of [[-w / 2 + 0.08, !o.joinL], [w / 2 - 0.08, !o.joinR]]) {
        if (!ok) continue;
        for (const sz of [-1, 1]) g.add(cyl(THREE, 0.03, 0.03, 0.4, WOOD_DARK, x, 0.2, sz * 0.2, 6));
      }
      g.add(box(THREE, w, 0.06, 0.6, WOOD_LIGHT, 0, 0.42, 0));
      g.add(box(THREE, w - 0.2, 0.025, 0.46, WOOD_DARK, 0, 0.18, 0));                           // lower shelf
      return g;
    },
    tv(THREE, o) {
      // Media unit + flat screen. E turns the screen on (cycling colours).
      const g = new THREE.Group();
      g.add(box(THREE, 1.0, 0.44, 0.44, WOOD_DARK, 0, 0.22, 0));
      g.add(box(THREE, 0.9, 0.3, 0.02, WOOD, 0, 0.23, 0.225));
      g.add(box(THREE, 0.3, 0.05, 0.16, BLACK, 0, 0.465, 0));                                    // stand
      g.add(box(THREE, 1.0, 0.58, 0.05, BLACK, 0, 0.78, 0));                                     // bezel
      const screen = lit(THREE, 0.92, 0.5, 0.01, 0x15181d, 0, 0.78, 0.03);
      g.add(screen);
      g.userData.act = {
        label: (on) => (on ? 'Turn TV off' : 'Turn TV on'),
        apply(on) { screen.material.color.setHex(on ? 0x35679e : 0x15181d); },
        tick(on, dt, t) { if (on) screen.material.color.setHSL(0.58 + 0.07 * Math.sin(t * 1.7), 0.5, 0.36 + 0.08 * Math.sin(t * 5)); }
      };
      return g;
    },
    fireplace(THREE, o) {
      const g = new THREE.Group();
      g.add(box(THREE, 1.2, 0.9, 0.5, BRICK, 0, 0.45, 0));                                       // hearth surround
      g.add(box(THREE, 0.62, 0.55, 0.06, BLACK, 0, 0.42, 0.24));                                 // firebox
      g.add(box(THREE, 1.4, 0.08, 0.6, WOOD, 0, 0.94, 0.02));                                    // mantel
      g.add(box(THREE, 0.9, 1.2, 0.34, BRICK, 0, 1.58, -0.08));                                  // chimney breast
      g.add(box(THREE, 1.3, 0.05, 0.5, STONE, 0, 0.025, 0.12));                                  // hearth stone
      for (const lz of [0.14, 0.22]) {
        const log = cyl(THREE, 0.05, 0.05, 0.46, WOOD_DARK, 0, 0.16, lz, 6);
        log.rotation.z = Math.PI / 2;
        g.add(log);
      }
      const flames = new THREE.Group();
      for (const [x, h, c] of [[-0.12, 0.3, 0xffa030], [0.0, 0.42, 0xff7a20], [0.12, 0.28, 0xffc04a]]) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.09, h, 6), new THREE.MeshBasicMaterial({ color: c }));
        f.position.set(x, 0.2 + h / 2, 0.2);
        flames.add(f);
      }
      flames.visible = false;
      g.add(flames);
      g.userData.act = {
        label: (on) => (on ? 'Put out the fire' : 'Light the fire'),
        apply(on) { flames.visible = on; },
        tick(on, dt, t) { if (on) flames.children.forEach((f, i) => { f.scale.y = 0.8 + 0.3 * Math.abs(Math.sin(t * 7 + i * 2)); f.scale.x = 0.9 + 0.15 * Math.sin(t * 9 + i); }); }
      };
      return g;
    },
    piano(THREE, o) {
      const g = new THREE.Group();
      g.add(box(THREE, 1.2, 1.15, 0.5, 0x24262b, 0, 0.6, -0.04));                                 // cabinet
      g.add(box(THREE, 1.24, 0.05, 0.56, 0x24262b, 0, 1.2, -0.04));                               // lid
      g.add(box(THREE, 1.22, 0.05, 0.28, 0x24262b, 0, 0.7, 0.2));                                 // key bed
      g.add(box(THREE, 1.1, 0.03, 0.2, WHITE, 0, 0.74, 0.22));                                    // keys
      for (let i = 0; i < 7; i++) g.add(box(THREE, 0.04, 0.03, 0.12, BLACK, -0.45 + i * 0.15 + (i > 2 ? 0.07 : 0), 0.765, 0.18));
      for (const sx of [-0.55, 0.55]) g.add(box(THREE, 0.06, 0.55, 0.08, 0x24262b, sx, 0.28, 0.2));
      g.add(box(THREE, 0.9, 0.5, 0.02, 0x15161a, 0, 0.95, 0.205));                                // music stand
      g.add(box(THREE, 0.5, 0.01, 0.26, WHITE, 0, 1.0, 0.19));
      return g;
    },
    aquarium(THREE, o) {
      const g = new THREE.Group();
      g.add(box(THREE, 1.0, 0.6, 0.46, WOOD_DARK, 0, 0.3, 0));                                    // stand
      g.add(box(THREE, 1.0, 0.04, 0.5, WOOD, 0, 0.62, 0));
      g.add(box(THREE, 0.94, 0.06, 0.4, 0xd8c9a0, 0, 0.67, 0));                                    // gravel
      g.add(glass(THREE, 0.96, 0.5, 0.42, 0, 0.9, 0, 0x6ec1e4));                                   // tank
      g.add(box(THREE, 0.96, 0.03, 0.42, BLACK, 0, 1.17, 0));                                      // hood
      g.add(cyl(THREE, 0.02, 0.02, 0.3, LEAF, -0.3, 0.85, -0.1, 5));
      g.add(cyl(THREE, 0.02, 0.02, 0.22, LEAF, 0.3, 0.81, 0.05, 5));
      const fish = [];
      for (const [c, y] of [[0xff8a30, 0.95], [0xffd13a, 0.82], [0xe84a5f, 1.05]]) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 5), new THREE.MeshBasicMaterial({ color: c }));
        f.rotation.z = -Math.PI / 2;
        f.position.y = y;
        g.add(f);
        fish.push(f);
      }
      g.userData.anim = (t) => fish.forEach((f, i) => {
        const a = Math.sin(t * (0.6 + i * 0.15) + i * 2);
        f.position.x = a * 0.36;
        f.position.z = Math.sin(t * 0.4 + i) * 0.1;
        f.rotation.z = (Math.cos(t * (0.6 + i * 0.15) + i * 2) > 0 ? -1 : 1) * Math.PI / 2;
      });
      return g;
    },

    // ── work / storage ──
    desk(THREE, o) {
      const g = new THREE.Group();
      const w = joined(o) ? 1.0 : 1.2;
      g.add(box(THREE, w, 0.05, 0.7, WOOD_LIGHT, 0, 0.735, 0));
      if (!o.joinL) g.add(box(THREE, 0.05, 0.71, 0.66, WOOD, -w / 2 + 0.03, 0.355, 0));
      if (!o.joinR) g.add(box(THREE, 0.05, 0.71, 0.66, WOOD, w / 2 - 0.03, 0.355, 0));
      g.add(box(THREE, w, 0.4, 0.03, WOOD, 0, 0.5, -0.3));                                        // modesty panel
      g.add(box(THREE, 0.34, 0.15, 0.4, WOOD, w / 2 - 0.25, 0.6, 0.05));                          // drawer block (right end, or each cell's)
      g.add(box(THREE, 0.1, 0.02, 0.02, CHROME, w / 2 - 0.25, 0.6, 0.26));
      return g;
    },
    workbench(THREE, o) {
      const g = new THREE.Group();
      const w = joined(o) ? 1.0 : 1.5;
      g.add(box(THREE, w, 0.08, 0.7, WOOD, 0, 0.86, 0));
      for (const [x, ok] of [[-w / 2 + 0.07, !o.joinL], [w / 2 - 0.07, !o.joinR]]) {
        if (!ok) continue;
        for (const sz of [-1, 1]) g.add(box(THREE, 0.08, 0.82, 0.08, WOOD_DARK, x, 0.41, sz * 0.28));
      }
      g.add(box(THREE, w, 0.04, 0.6, WOOD_DARK, 0, 0.3, 0));                                      // lower shelf
      g.add(box(THREE, 0.14, 0.08, 0.1, 0xc0392b, -0.1, 0.94, -0.1));                             // toolbox
      g.add(box(THREE, 0.04, 0.04, 0.28, STEEL_D, 0.2, 0.92, 0.1));                               // a screwdriver left lying
      return g;
    },
    shoerack(THREE, o) {
      const g = new THREE.Group();
      for (const sx of [-0.38, 0.38]) g.add(box(THREE, 0.03, 0.6, 0.32, WOOD, sx, 0.3, 0));
      for (const y of [0.08, 0.32, 0.58]) g.add(box(THREE, 0.8, 0.03, 0.34, WOOD, 0, y, 0));
      for (const [x, y, c] of [[-0.2, 0.1, 0x3a4a6a], [0.12, 0.1, 0x8a5a3a], [-0.1, 0.35, 0xb5563f], [0.22, 0.35, 0x2f2f33]]) {
        g.add(box(THREE, 0.2, 0.09, 0.1, c, x, y + 0.06, 0));
        g.add(box(THREE, 0.1, 0.06, 0.1, c, x - 0.04, y + 0.12, 0.0));
      }
      return g;
    },
    treadmill(THREE, o) {
      // Two cells long; the console end is at −z.
      const g = new THREE.Group();
      g.add(box(THREE, 0.8, 0.14, 1.9, 0x2a2c31, 0, 0.17, 0.05));
      g.add(box(THREE, 0.62, 0.03, 1.7, 0x16171a, 0, 0.255, 0.05));                               // belt
      for (const sx of [-0.4, 0.4]) g.add(box(THREE, 0.05, 1.05, 0.05, STEEL_D, sx, 0.7, -0.8));
      g.add(box(THREE, 0.82, 0.22, 0.14, 0x2a2c31, 0, 1.2, -0.8));                                // console
      g.add(lit(THREE, 0.5, 0.1, 0.01, 0x3dd6a0, 0, 1.2, -0.72));                                 // display
      return g;
    },

    // ── kitchen ──
    counter(THREE, o) { return cabinet(THREE, o, 'counter'); },
    sink(THREE, o) { return cabinet(THREE, o, 'sink'); },
    stove(THREE, o) { return cabinet(THREE, o, 'stove'); },
    washer(THREE, o) {
      const g = new THREE.Group();
      g.add(box(THREE, 0.92, 0.88, 0.7, WHITE, 0, 0.44, 0));
      g.add(box(THREE, 0.94, 0.03, 0.72, CHROME, 0, 0.895, 0));
      const win = cyl(THREE, 0.22, 0.22, 0.04, 0x3a4a5a, 0, 0.45, 0.36, 18);
      win.rotation.x = Math.PI / 2;
      g.add(win);
      const rim = cyl(THREE, 0.27, 0.27, 0.03, CHROME, 0, 0.45, 0.355, 18);
      rim.rotation.x = Math.PI / 2;
      g.add(rim);
      g.add(box(THREE, 0.6, 0.1, 0.03, 0xd0d6da, 0, 0.8, 0.355));
      const knob = cyl(THREE, 0.03, 0.03, 0.03, STEEL_D, 0.25, 0.8, 0.375, 8);
      knob.rotation.x = Math.PI / 2;
      g.add(knob);
      return g;
    },
    fridge(THREE, o) {
      // Open shell + hinged door, so E can swing it open onto the shelves.
      const g = new THREE.Group();
      const w = 0.94, h = 1.85, d = 0.74;
      g.add(box(THREE, 0.04, h, d, STEEL, -w / 2 + 0.02, h / 2, 0));
      g.add(box(THREE, 0.04, h, d, STEEL, w / 2 - 0.02, h / 2, 0));
      g.add(box(THREE, w, 0.04, d, STEEL, 0, h - 0.02, 0));
      g.add(box(THREE, w, 0.08, d, STEEL, 0, 0.04, 0));
      g.add(box(THREE, w - 0.08, h - 0.1, 0.03, WHITE, 0, h / 2, -d / 2 + 0.03));
      for (const y of [0.55, 0.95, 1.35]) g.add(box(THREE, w - 0.1, 0.02, d - 0.1, 0xdfe9ec, 0, y, 0));
      for (const [x, y, c] of [[-0.2, 0.62, 0xd9534f], [0.15, 0.62, 0xf0c040], [-0.1, 1.02, 0x6aa84f], [0.25, 1.02, 0xe8e8e0], [0, 1.42, 0xe6a96b]]) {
        g.add(box(THREE, 0.14, 0.14, 0.14, c, x, y + 0.08, 0));
      }
      const door = hinged(THREE, -w / 2, 0, d / 2, w, h - 0.02, 0.05, STEEL, 'left');
      door.children[0].position.y = h / 2;
      door.add(box(THREE, 0.04, 0.4, 0.05, STEEL_D, w - 0.1, 1.2, 0.06));                          // handle
      door.add(box(THREE, w - 0.04, 0.02, 0.052, STEEL_D, w / 2, 1.05, 0.025));                    // freezer seam
      g.add(door);
      const anim = swing((v) => { door.rotation.y = -v * 1.95; });
      g.userData.act = { label: (on) => (on ? 'Close the fridge' : 'Open the fridge'), apply: anim.set, tick: anim.tick, eased: true };
      return g;
    },
    bin(THREE, o) {
      const g = new THREE.Group();
      g.add(cyl(THREE, 0.2, 0.17, 0.48, STEEL, 0, 0.26, 0, 12));
      g.add(cyl(THREE, 0.21, 0.21, 0.04, STEEL_D, 0, 0.52, 0, 12));
      g.add(box(THREE, 0.1, 0.04, 0.05, STEEL_D, 0, 0.55, 0));
      return g;
    },

    // ── bathroom ──
    toilet(THREE, o) {
      const g = new THREE.Group();
      g.add(box(THREE, 0.4, 0.4, 0.18, WHITE, 0, 0.6, -0.27));                                    // cistern
      g.add(box(THREE, 0.44, 0.05, 0.2, 0xe4e4e0, 0, 0.82, -0.27));
      g.add(cyl(THREE, 0.04, 0.04, 0.04, CHROME, 0.12, 0.86, -0.27, 8));                           // flush button
      g.add(box(THREE, 0.3, 0.3, 0.4, WHITE, 0, 0.17, -0.02));                                    // pedestal
      const bowl = cyl(THREE, 0.2, 0.15, 0.14, WHITE, 0, 0.34, 0.04, 14);
      bowl.scale.z = 1.35;
      g.add(bowl);
      const seat = cyl(THREE, 0.21, 0.21, 0.04, 0xf7f7f4, 0, 0.42, 0.06, 14);
      seat.scale.z = 1.3;
      g.add(seat);
      return g;
    },
    bathtub(THREE, o) {
      const g = new THREE.Group();
      g.add(box(THREE, 0.9, 0.12, 1.96, WHITE, 0, 0.06, 0));
      g.add(box(THREE, 0.1, 0.55, 1.96, WHITE, -0.4, 0.4, 0));
      g.add(box(THREE, 0.1, 0.55, 1.96, WHITE, 0.4, 0.4, 0));
      g.add(box(THREE, 0.7, 0.55, 0.1, WHITE, 0, 0.4, -0.93));
      g.add(box(THREE, 0.7, 0.55, 0.1, WHITE, 0, 0.4, 0.93));
      const water = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.76), new THREE.MeshBasicMaterial({ color: 0xa6d8ee, transparent: true, opacity: 0.85 }));
      water.rotation.x = -Math.PI / 2;
      water.position.y = 0.42;
      g.add(water);
      g.add(cyl(THREE, 0.025, 0.025, 0.3, CHROME, 0, 0.78, -0.82, 6));
      const spout = box(THREE, 0.03, 0.03, 0.2, CHROME, 0, 0.92, -0.72);
      g.add(spout);
      for (const sx of [-0.12, 0.12]) g.add(cyl(THREE, 0.03, 0.03, 0.05, CHROME, sx, 0.8, -0.86, 8));
      return g;
    },
    shower(THREE, o) {
      const g = new THREE.Group();
      g.add(box(THREE, 0.96, 0.08, 0.96, TILE, 0, 0.04, 0));                                      // tray
      g.add(box(THREE, 0.96, 2.1, 0.04, TILE, 0, 1.05, -0.46));                                   // back panel
      g.add(glass(THREE, 0.96, 2.0, 0.03, 0, 1.05, 0.46, 0xbfe3f0));                              // front glass
      g.add(glass(THREE, 0.03, 2.0, 0.92, 0.46, 1.05, 0, 0xbfe3f0));                              // side glass
      g.add(box(THREE, 1.0, 0.05, 0.05, CHROME, 0, 2.08, 0.46));                                  // top rail
      g.add(cyl(THREE, 0.02, 0.02, 1.1, CHROME, -0.3, 1.45, -0.42, 6));                           // pipe
      const head = cyl(THREE, 0.12, 0.05, 0.05, CHROME, -0.3, 2.0, -0.3, 10);
      head.rotation.x = 0.5;
      g.add(head);
      const spray = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.4, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xa6d8ee, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
      spray.position.set(-0.3, 1.25, -0.2);
      spray.rotation.x = Math.PI;
      spray.visible = false;
      g.add(spray);
      g.userData.act = {
        label: (on) => (on ? 'Turn the shower off' : 'Turn the shower on'),
        apply(on) { spray.visible = on; },
        tick(on, dt, t) { if (on) spray.material.opacity = 0.22 + 0.08 * Math.sin(t * 20); }
      };
      return g;
    },

    // ── bedroom ──
    wardrobe(THREE, o) {
      const g = new THREE.Group();
      const w = 1.0, h = 2.05, d = 0.6;
      g.add(box(THREE, 0.04, h, d, WOOD, -w / 2 + 0.02, h / 2, 0));
      g.add(box(THREE, 0.04, h, d, WOOD, w / 2 - 0.02, h / 2, 0));
      g.add(box(THREE, w, 0.05, d, WOOD_DARK, 0, h - 0.025, 0));
      g.add(box(THREE, w, 0.08, d, WOOD_DARK, 0, 0.04, 0));
      g.add(box(THREE, w - 0.08, h - 0.1, 0.03, 0x2b2118, 0, h / 2, -d / 2 + 0.02));
      const rail = cyl(THREE, 0.015, 0.015, w - 0.1, STEEL, 0, 1.75, 0, 6);
      rail.rotation.z = Math.PI / 2;
      g.add(rail);
      for (let i = 0; i < 6; i++) g.add(box(THREE, 0.05, 0.6 + (i % 3) * 0.1, 0.3, BOOKS[i % BOOKS.length], -0.36 + i * 0.14, 1.4 - (i % 3) * 0.05, 0));   // clothes
      const l = hinged(THREE, -w / 2 + 0.01, 0, d / 2, w / 2 - 0.01, h - 0.04, 0.035, WOOD_LIGHT, 'left');
      const r = hinged(THREE, w / 2 - 0.01, 0, d / 2, w / 2 - 0.01, h - 0.04, 0.035, WOOD_LIGHT, 'right');
      l.children[0].position.y = h / 2; r.children[0].position.y = h / 2;
      for (const [p, x] of [[l, w / 2 - 0.1], [r, -(w / 2 - 0.1)]]) p.add(box(THREE, 0.025, 0.2, 0.04, CHROME, x, 1.0, 0.04));
      g.add(l, r);
      const anim = swing((v) => { l.rotation.y = -v * 1.9; r.rotation.y = v * 1.9; });
      g.userData.act = { label: (on) => (on ? 'Close the wardrobe' : 'Open the wardrobe'), apply: anim.set, tick: anim.tick, eased: true };
      return g;
    },
    dresser(THREE, o) {
      const g = new THREE.Group();
      const w = 1.0;
      g.add(box(THREE, w, 0.8, 0.48, WOOD, 0, 0.4, 0));
      g.add(box(THREE, w + 0.02, 0.05, 0.52, WOOD_DARK, 0, 0.825, 0));
      const drawers = [];
      for (const y of [0.18, 0.4, 0.62]) {
        const d = new THREE.Group();
        d.position.y = y;
        d.add(box(THREE, w - 0.1, 0.19, 0.03, WOOD_LIGHT, 0, 0, 0.255));
        d.add(box(THREE, 0.14, 0.025, 0.03, CHROME, 0, 0, 0.285));
        g.add(d);
        drawers.push(d);
      }
      const anim = swing((v) => { drawers[2].position.z = v * 0.28; drawers[1].position.z = v * 0.12; });
      g.userData.act = { label: (on) => (on ? 'Close the drawers' : 'Open the drawers'), apply: anim.set, tick: anim.tick, eased: true };
      return g;
    },
    nightstand(THREE, o) {
      const g = new THREE.Group();
      legs(THREE, g, 0.2, 0.17, 0.08, 0.025, WOOD_DARK);
      g.add(box(THREE, 0.5, 0.38, 0.42, WOOD, 0, 0.27, 0));
      g.add(box(THREE, 0.54, 0.04, 0.44, WOOD_DARK, 0, 0.5, 0));
      g.add(box(THREE, 0.4, 0.14, 0.02, WOOD_LIGHT, 0, 0.36, 0.215));
      g.add(box(THREE, 0.4, 0.14, 0.02, WOOD_LIGHT, 0, 0.19, 0.215));
      g.add(sph(THREE, 0.025, CHROME, 0, 0.36, 0.24, 6));
      g.add(sph(THREE, 0.025, CHROME, 0, 0.19, 0.24, 6));
      return g;
    },
    crib(THREE, o) {
      const g = new THREE.Group();
      const CR = 0xf4eee2;
      g.add(box(THREE, 0.98, 0.06, 1.1, CR, 0, 0.3, 0));
      g.add(box(THREE, 0.9, 0.1, 1.02, 0xcfe3f2, 0, 0.38, 0));                                      // mattress
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(box(THREE, 0.06, 0.95, 0.06, CR, sx * 0.47, 0.475, sz * 0.52));
      for (const sx of [-0.47, 0.47]) {
        g.add(box(THREE, 0.04, 0.05, 1.04, CR, sx, 0.93, 0));
        for (let i = 0; i < 6; i++) g.add(box(THREE, 0.025, 0.55, 0.025, CR, sx, 0.65, -0.42 + i * 0.168));
      }
      g.add(box(THREE, 0.94, 0.55, 0.05, CR, 0, 0.7, -0.52));
      g.add(box(THREE, 0.94, 0.4, 0.05, CR, 0, 0.62, 0.52));
      g.add(sph(THREE, 0.1, o.accent, 0.15, 0.5, 0.1, 8));                                           // a toy
      return g;
    },
    petbed(THREE, o) {
      const g = new THREE.Group();
      g.add(cyl(THREE, 0.38, 0.36, 0.14, o.accent, 0, 0.07, 0, 16));
      g.add(cyl(THREE, 0.28, 0.28, 0.15, CREAM, 0, 0.08, 0, 16));
      g.add(sph(THREE, 0.06, 0xd9534f, 0.15, 0.17, 0.05, 6));                                         // a ball
      return g;
    },

    // ── hung on a wall (origin on the wall's inner face, facing +z) ──
    mirror(THREE, o) {
      const g = new THREE.Group();
      g.add(box(THREE, 0.8, 1.3, 0.05, WOOD_LIGHT, 0, 1.45, 0.025));
      g.add(lit(THREE, 0.7, 1.2, 0.01, 0xcfe6ee, 0, 1.45, 0.055));
      g.add(lit(THREE, 0.12, 1.1, 0.012, 0xeaf6fa, -0.2, 1.45, 0.058, 0.55));                          // glint
      return g;
    },
    clock(THREE, o) {
      const g = new THREE.Group();
      const face = cyl(THREE, 0.28, 0.28, 0.05, WHITE, 0, 2.05, 0.03, 20);
      face.rotation.x = Math.PI / 2;
      g.add(face);
      const rim = cyl(THREE, 0.3, 0.3, 0.04, o.accent, 0, 2.05, 0.02, 20);
      rim.rotation.x = Math.PI / 2;
      g.add(rim);
      for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6;
        g.add(box(THREE, 0.02, i % 3 ? 0.03 : 0.06, 0.01, IRON, Math.sin(a) * 0.23, 2.05 + Math.cos(a) * 0.23, 0.06));
      }
      const hour = new THREE.Group(), minute = new THREE.Group();
      hour.position.set(0, 2.05, 0.065); minute.position.set(0, 2.05, 0.07);
      hour.add(box(THREE, 0.025, 0.13, 0.01, IRON, 0, 0.065, 0));
      minute.add(box(THREE, 0.018, 0.2, 0.01, IRON, 0, 0.1, 0));
      g.add(hour, minute);
      g.userData.anim = () => {   // the real time (the cost is two rotations, only while the house is near)
        const d = new Date();
        const m = d.getMinutes() + d.getSeconds() / 60;
        minute.rotation.z = -m / 60 * Math.PI * 2;
        hour.rotation.z = -((d.getHours() % 12) + m / 60) / 12 * Math.PI * 2;
      };
      return g;
    },
    curtains(THREE, o) {
      const g = new THREE.Group();
      const rod = cyl(THREE, 0.015, 0.015, 1.6, WOOD_DARK, 0, 2.3, 0.08, 6);
      rod.rotation.z = Math.PI / 2;
      g.add(rod);
      for (const sx of [-1, 1]) {
        g.add(box(THREE, 0.5, 1.5, 0.07, o.roof, sx * 0.5, 1.53, 0.05));
        g.add(box(THREE, 0.5, 0.05, 0.075, o.accent, sx * 0.5, 1.2, 0.052));                             // tie-back
        g.add(sph(THREE, 0.03, WOOD_DARK, sx * 0.84, 2.3, 0.08, 6));
      }
      return g;
    },
    towelrack(THREE, o) {
      const g = new THREE.Group();
      const bar = cyl(THREE, 0.012, 0.012, 0.7, CHROME, 0, 1.15, 0.1, 6);
      bar.rotation.z = Math.PI / 2;
      g.add(bar);
      for (const sx of [-0.33, 0.33]) g.add(box(THREE, 0.02, 0.02, 0.1, CHROME, sx, 1.15, 0.05));
      g.add(box(THREE, 0.5, 0.5, 0.03, o.accent, -0.05, 0.92, 0.105));
      g.add(box(THREE, 0.5, 0.1, 0.04, o.roof, -0.05, 1.18, 0.105));
      return g;
    },
    stringlights(THREE, o) {
      const g = new THREE.Group();
      const bulbs = [];
      const N = 8;
      for (let i = 0; i < N; i++) {
        const x = -0.65 + i * (1.3 / (N - 1));
        const sag = Math.sin(i / (N - 1) * Math.PI) * 0.12;
        g.add(box(THREE, 0.16, 0.012, 0.012, IRON, x, 2.45 - sag, 0.04));
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 5), new THREE.MeshBasicMaterial({ color: o.lamp }));
        b.position.set(x, 2.41 - sag, 0.05);
        g.add(b);
        bulbs.push(b);
      }
      g.userData.anim = (t) => bulbs.forEach((b, i) => b.material.color.setHex(Math.sin(t * 2.2 + i * 1.3) > -0.2 ? o.lamp : 0x8a7a50));
      return g;
    },

    // ── hung from the ceiling (origin at the floor like everything else; o.ceilingY is the slab) ──
    fan(THREE, o) {
      const g = new THREE.Group();
      const top = o.ceilingY || 4;
      const y = top - 0.75;
      g.add(cyl(THREE, 0.02, 0.02, top - y, IRON, 0, (top + y) / 2, 0, 6));
      g.add(cyl(THREE, 0.1, 0.1, 0.12, IRON, 0, y, 0, 10));
      g.add(cyl(THREE, 0.14, 0.14, 0.03, o.accent, 0, top - 0.02, 0, 10));
      const blades = new THREE.Group();
      blades.position.y = y;
      for (let i = 0; i < 4; i++) {
        const arm = new THREE.Group();
        arm.rotation.y = i * Math.PI / 2;
        arm.add(box(THREE, 0.52, 0.015, 0.13, i % 2 ? WOOD : WOOD_LIGHT, 0.36, 0, 0));
        blades.add(arm);
      }
      g.add(blades);
      let speed = 0;
      g.userData.act = {
        eased: true,
        label: (on) => (on ? 'Turn the fan off' : 'Turn the fan on'),
        apply(on) { speed = on ? 9 : 0; },
        tick(on, dt) { speed += ((on ? 9 : 0) - speed) * Math.min(1, dt * 1.5); blades.rotation.y += speed * dt; }
      };
      return g;
    },
    hangplant(THREE, o) {
      const g = new THREE.Group();
      const top = o.ceilingY || 4;
      const y = 1.95;
      g.add(cyl(THREE, 0.01, 0.01, top - y, IRON, 0, (top + y) / 2, 0, 4));
      g.add(cyl(THREE, 0.2, 0.13, 0.22, POT, 0, y - 0.1, 0, 10));
      for (const [x, z, r] of [[0, 0, 0.26], [0.16, 0.06, 0.18], [-0.15, -0.08, 0.2]]) g.add(sph(THREE, r, LEAF, x, y + 0.14, z, 8));
      for (const [x, z, h] of [[0.15, 0.1, 0.7], [-0.14, 0.12, 0.5], [0.02, -0.16, 0.6]]) g.add(box(THREE, 0.03, h, 0.03, LEAF, x, y - 0.2 - h / 2, z));
      return g;
    },

    // ── standing on a surface (the engine lifts them to the surface's height) ──
    microwave(THREE, o) {
      const g = new THREE.Group();
      g.add(box(THREE, 0.5, 0.3, 0.38, STEEL, 0, 0.15, 0));
      g.add(box(THREE, 0.32, 0.22, 0.01, BLACK, -0.06, 0.15, 0.195));
      g.add(box(THREE, 0.09, 0.22, 0.01, STEEL_D, 0.17, 0.15, 0.195));
      g.add(lit(THREE, 0.05, 0.02, 0.005, 0x3dd6a0, 0.17, 0.24, 0.2));
      return g;
    },
    kettle(THREE, o) {
      const g = new THREE.Group();
      g.add(cyl(THREE, 0.1, 0.13, 0.2, STEEL, 0, 0.1, 0, 12));
      g.add(cyl(THREE, 0.1, 0.1, 0.03, STEEL_D, 0, 0.215, 0, 12));
      const spout = box(THREE, 0.1, 0.03, 0.03, STEEL, 0.14, 0.19, 0);
      spout.rotation.z = 0.5;
      g.add(spout);
      g.add(box(THREE, 0.03, 0.18, 0.04, BLACK, -0.12, 0.14, 0));
      return g;
    },
    pots(THREE, o) {
      const g = new THREE.Group();
      g.add(cyl(THREE, 0.12, 0.12, 0.14, STEEL, -0.12, 0.07, 0, 12));
      g.add(cyl(THREE, 0.125, 0.125, 0.02, STEEL_D, -0.12, 0.15, 0, 12));
      g.add(sph(THREE, 0.025, BLACK, -0.12, 0.18, 0, 5));
      g.add(box(THREE, 0.1, 0.02, 0.03, BLACK, -0.28, 0.12, 0));
      g.add(cyl(THREE, 0.13, 0.12, 0.05, 0x2a2c31, 0.14, 0.025, 0.03, 12));
      g.add(box(THREE, 0.16, 0.02, 0.03, BLACK, 0.34, 0.04, 0.03));
      return g;
    },
    fruitbowl(THREE, o) {
      const g = new THREE.Group();
      g.add(cyl(THREE, 0.2, 0.1, 0.1, WOOD_LIGHT, 0, 0.06, 0, 12));
      for (const [x, y, z, c] of [[0, 0.14, 0, 0xd9534f], [0.09, 0.13, 0.06, 0xf0a030], [-0.08, 0.13, 0.05, 0x7ab648], [0.02, 0.13, -0.09, 0xf0d040], [-0.1, 0.14, -0.04, 0xd9534f]]) {
        g.add(sph(THREE, 0.06, c, x, y, z, 7));
      }
      return g;
    },
    plates(THREE, o) {
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) g.add(cyl(THREE, 0.15, 0.12, 0.018, i % 2 ? 0xdde7f2 : WHITE, -0.04, 0.01 + i * 0.02, 0, 14));
      g.add(cyl(THREE, 0.05, 0.04, 0.08, o.accent, 0.17, 0.04, 0.04, 8));
      return g;
    },
    toaster(THREE, o) {
      const g = new THREE.Group();
      g.add(box(THREE, 0.28, 0.18, 0.16, CHROME, 0, 0.09, 0));
      for (const sx of [-0.06, 0.06]) g.add(box(THREE, 0.03, 0.01, 0.12, BLACK, sx, 0.185, 0));
      g.add(box(THREE, 0.03, 0.04, 0.02, BLACK, 0.16, 0.12, 0));
      return g;
    },
    vase(THREE, o) {
      const g = new THREE.Group();
      g.add(cyl(THREE, 0.05, 0.09, 0.26, o.roof, 0, 0.13, 0, 10));
      for (const [x, z, h, c] of [[0, 0, 0.3, 0xe8607a], [0.04, 0.02, 0.22, 0xf0c040], [-0.04, -0.02, 0.26, 0xf5f0e6]]) {
        g.add(box(THREE, 0.012, h, 0.012, LEAF, x, 0.26 + h / 2, z));
        g.add(sph(THREE, 0.04, c, x, 0.28 + h, z, 6));
      }
      return g;
    },
    laptop(THREE, o) {
      const g = new THREE.Group();
      g.add(box(THREE, 0.34, 0.018, 0.24, STEEL, 0, 0.009, 0.02));
      const lid = new THREE.Group();
      lid.position.set(0, 0.018, -0.1);
      lid.rotation.x = -0.35;
      lid.add(box(THREE, 0.34, 0.22, 0.012, STEEL_D, 0, 0.11, 0));
      lid.add(lit(THREE, 0.3, 0.18, 0.004, 0x4a86d6, 0, 0.11, 0.008));
      g.add(lid);
      return g;
    },
    console(THREE, o) {
      const g = new THREE.Group();
      g.add(box(THREE, 0.3, 0.05, 0.2, 0x2a2c31, 0, 0.025, -0.02));
      g.add(lit(THREE, 0.2, 0.01, 0.005, 0x3d7fd6, 0, 0.05, 0.085));
      g.add(box(THREE, 0.1, 0.03, 0.06, BLACK, -0.08, 0.015, 0.1));
      g.add(box(THREE, 0.1, 0.03, 0.06, 0xc0392b, 0.08, 0.015, 0.1));
      return g;
    },
    books(THREE, o) {
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) g.add(box(THREE, 0.26 - i * 0.02, 0.05, 0.19, BOOKS[i % BOOKS.length], 0, 0.025 + i * 0.05, 0));
      const lean = box(THREE, 0.05, 0.2, 0.15, BOOKS[3], 0.17, 0.1, 0);
      lean.rotation.z = -0.15;
      g.add(lean);
      return g;
    }
  };

  // Build one prop. `opts`: { THREE, lampTex, lampColor, trimColor, roofColor,
  // hasPortrait, ceilingY, joinL, joinR, joinN, joinS, joinE, joinW, armL,
  // armR } — house colours tint the accent parts so props match the room.
  function make(kind, opts) {
    const THREE = (opts && opts.THREE) || window.THREE;
    const build = BUILDERS[kind];
    if (!THREE || !build) return null;
    const x = opts || {};
    const o = {
      lampTex: x.lampTex,
      hasPortrait: !!x.hasPortrait,
      width: (x.width > 0) ? x.width : 0,
      lamp:   (x.lampColor != null) ? x.lampColor : 0xffd98a,
      accent: (x.trimColor != null) ? x.trimColor : 0x9a8c6f,
      roof:   (x.roofColor != null) ? x.roofColor : 0x6478a6,
      ceilingY: x.ceilingY > 0 ? x.ceilingY : 4,
      joinL: !!x.joinL, joinR: !!x.joinR, joinN: !!x.joinN, joinS: !!x.joinS, joinE: !!x.joinE, joinW: !!x.joinW,
      armL: x.armL !== false, armR: x.armR !== false
    };
    MC = new Map();   // one shared material per colour within this piece
    const g = build(THREE, o);
    MC = new Map();
    g.userData.propKind = kind;
    return g;
  }

  return { KINDS: Object.keys(FOOTPRINTS), FOOTPRINTS, footprint, make };
})();
