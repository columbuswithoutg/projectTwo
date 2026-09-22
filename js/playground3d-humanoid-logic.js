/************************************************
 * PLAYGROUND3D HUMANOID LOGIC — pure, dependency-free helpers
 *
 * The decisions behind the realistic (rigged glTF) characters, extracted so
 * they can be unit-tested with `node --test` (the loader/renderer in
 * js/playground3d-humanoid.js needs THREE + a DOM):
 *
 *   bodyShapeFor(c)      character slots → base model + per-part shape factors
 *   classifySkeleton()   raw bone names → logical parts (Rigify / Mixamo / custom)
 *   selectAnimState()    movement/combat inputs → animation state + overlay
 *   lodTier()            distance/visibility → how often to animate
 *   SLOT_MAP             how every stored character slot is realised
 *
 * Shape factors are *proportions*: they're applied on top of the uniform
 * root scale (Playground.BUILDS[].scale), so a Huge build is 1.40× taller AND
 * 1.85× wider in the chest relative to its own height. The engine bakes them
 * into the bind pose once per (model, build) — bones are never scaled at
 * runtime, which avoids shear when a limb bends.
 *
 * UMD-ish: attaches to window.PG3DHumanoidLogic in the browser, exports via
 * module.exports under Node (same pattern as playground3d-physics.js).
 ************************************************/
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PG3DHumanoidLogic = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const ASSET_BASE = '/assets/models/humanoid/v1/';
  const BODY_FILES = { male: 'body_male.glb', female: 'body_female.glb' };

  // Indexed like Playground.GENDER_LABELS = ['Neutral', 'Masculine', 'Feminine'].
  const GENDER_FEMININE = 2;

  // Indexed like Playground.BUILDS (Slim, Normal, Large, Huge). `scale` mirrors
  // BUILDS[].scale (height); the rest are proportions relative to that height.
  // `head` is head size vs. a realistic head — 100% on everyday builds (real
  // faces looked oversized at 130% in the live preview); the Hulk-type keeps
  // the slightly bigger head the user approved. `hunch` (0–1) drives the
  // posture offset in bodyShapeFor().posture.
  const BUILD_SHAPE = [
    { name: 'Slim',   scale: 0.92, chestW: 0.90, chestD: 0.92, traps: 0.90, arms: 0.88, forearms: 0.89, legs: 0.90, hands: 0.95, head: 1.00, hunch: 0 },
    { name: 'Normal', scale: 1.00, chestW: 1.00, chestD: 1.00, traps: 1.00, arms: 1.00, forearms: 1.00, legs: 1.00, hands: 1.00, head: 1.00, hunch: 0 },
    { name: 'Large',  scale: 1.12, chestW: 1.20, chestD: 1.15, traps: 1.20, arms: 1.20, forearms: 1.18, legs: 1.15, hands: 1.10, head: 1.00, hunch: 0 },
    // Hulk-type: huge chest and traps that swallow the neck, V-taper to the
    // waist, oversized forearms and fists, and a hunched brute's stance.
    { name: 'Huge',   scale: 1.40, chestW: 1.85, chestD: 1.60, traps: 2.30, arms: 1.70, forearms: 1.75, legs: 1.45, hands: 1.80, head: 1.105, hunch: 1 }
  ];
  const DEFAULT_BUILD = 1;

  function mix(a, b, t) { return a + (b - a) * t; }
  function round3(v) { return Math.round(v * 1000) / 1000 || 0; }   // || 0: no -0
  function vec(x, y, z) { return [round3(x), round3(y), round3(z)]; }

  function buildIndex(c) {
    const b = c && Number.isInteger(c.build) ? c.build : DEFAULT_BUILD;
    return b >= 0 && b < BUILD_SHAPE.length ? b : DEFAULT_BUILD;
  }

  // Character slots → which base model to load and how to shape it.
  // parts: logical part → [x, y, z] factors in that bone's local frame, where
  //   y runs along the bone (kept at 1 so limbs thicken without lengthening)
  //   and x/z are width/depth. `spineLow`/`spineHigh` are the two ends of the
  //   spine chain; the engine interpolates between them bone by bone (V-taper).
  // jointShift: how far joints move outward (clavicle length → shoulder
  //   position; pelvis width → hip sockets) so thick arms/legs don't sink into
  //   a widened torso.
  function bodyShapeFor(c) {
    const s = BUILD_SHAPE[buildIndex(c)];
    const model = c && c.gender === GENDER_FEMININE ? 'female' : 'male';
    const waistW = mix(1, s.chestW, 0.55);
    const waistD = mix(1, s.chestD, 0.6);
    const headScale = round3(s.head);
    return {
      model,
      file: ASSET_BASE + BODY_FILES[model],
      build: s.name,
      rootScale: s.scale,
      headScale,
      // Silhouette width relative to a Normal body, for collision sizing.
      widthFactor: round3(s.scale * s.chestW),
      jointShift: { shoulder: round3(mix(1, s.chestW, 0.85)), hip: round3(mix(1, s.legs, 0.7)) },
      // Radians: forward pitch of the upper spine and neck, head counter-pitch
      // (keeps the face forward), shoulder shrug, arms held out from the body
      // (flared lats) and a wider stance — the Hulk-type's brute posture. The
      // engine fades it out while the character is knocked down.
      posture: {
        spine: round3(0.14 * s.hunch), neck: round3(0.2 * s.hunch),
        head: round3(-0.2 * s.hunch), shrug: round3(0.14 * s.hunch),
        armSplay: round3(0.18 * s.hunch), legSplay: round3(0.07 * s.hunch)
      },
      parts: {
        hips:      vec(mix(1, s.legs, 0.8), 1, mix(1, s.legs, 0.4)),
        spineLow:  vec(waistW, 1, waistD),
        spineHigh: vec(s.chestW, 1, s.chestD),
        // The neck carries most of the trapezius mass. Collarbones only thicken
        // part-way: scaling them fully pushes the top of the chest down into a
        // visible shelf (seen on the Hulk-type in the live preview).
        neck:      vec(mix(1, s.traps, 0.9), 1, mix(1, s.traps, 0.7)),
        shoulder:  vec(mix(1, s.traps, 0.45), 1, mix(1, s.traps, 0.45)),
        upperArm:  vec(s.arms, 1, s.arms),
        forearm:   vec(s.forearms, 1, s.forearms),
        hand:      vec(s.hands, s.hands, s.hands),
        thigh:     vec(s.legs, 1, s.legs),
        shin:      vec(mix(1, s.legs, 0.9), 1, mix(1, s.legs, 0.9)),
        foot:      vec(mix(1, s.legs, 0.5), 1, mix(1, s.legs, 0.35)),
        head:      vec(headScale, headScale, headScale)
      }
    };
  }

  // ── Skeleton classification ──
  // Normalises one bone name: strips rig prefixes (DEF-, ORG-, mixamorig:),
  // twist-segment suffixes (.001) and side markers (.L / _R / Left… / …Right).
  function parseBoneName(raw) {
    let n = String(raw || '').trim()
      .replace(/^(DEF|ORG|MCH)[-_.]/i, '')
      .replace(/^mixamorig\d*:?/i, '');
    let idx = 0;
    let side = null;
    const take = (re, fn) => { const m = n.match(re); if (m) { fn(m); n = n.slice(0, m.index) + n.slice(m.index + m[0].length); } return !!m; };
    take(/\.(\d{3})$/, (m) => { idx = +m[1]; });
    if (!take(/[._-](L|R)$/i, (m) => { side = m[1].toUpperCase(); })) {
      if (!take(/^(Left|Right)/, (m) => { side = m[1][0]; })) {
        take(/(Left|Right)$/, (m) => { side = m[1][0]; });
      }
    }
    // Rigify may put the twist index after the side (upper_arm.L.001 handled
    // above); some exporters put it before (upper_arm.001.L).
    take(/\.(\d{3})$/, (m) => { idx = idx || +m[1]; });
    let base = n.toLowerCase().replace(/[\s_.-]/g, '');
    // Trailing chain numbers: Mixamo Spine1/Spine2, Unreal-style spine_01 / neck_01.
    const num = base.match(/^([a-z]+?)(\d+)$/);
    if (num) { idx = idx || +num[2]; base = num[1]; }
    return { base, side, idx };
  }

  const LIMB_BASES = {
    shoulder: ['shoulder', 'clavicle'],
    upperArm: ['upperarm', 'arm'],
    forearm:  ['forearm', 'lowerarm'],
    hand:     ['hand'],
    thigh:    ['thigh', 'upleg', 'upperleg'],
    shin:     ['shin', 'calf', 'leg', 'lowerleg'],
    foot:     ['foot'],
    toe:      ['toe', 'toebase', 'toes', 'ball']
  };

  // bones: [{ name }] in any order. Returns logical → bone name (limbs keyed
  // like 'upperArm.L' → [names…] ordered by twist index, the first being the
  // main bone), plus spine/neck chains ordered hips-to-head. Fingers, breast,
  // pelvis-side and other helper bones are ignored.
  function classifySkeleton(bones) {
    const parsed = (bones || []).map((b) => Object.assign({ name: b.name }, parseBoneName(b.name)));
    const out = { hips: null, spine: [], neck: [], head: null };
    const central = parsed.filter((p) => !p.side);

    const byBase = (list, names) => list.filter((p) => names.includes(p.base)).sort((a, b) => a.idx - b.idx);

    let spines = byBase(central, ['spine']);
    const hipsNamed = byBase(central, ['hips', 'pelvis', 'root', 'roothips']).filter((p) => p.base !== 'root' || !out.hips);
    if (hipsNamed.length) out.hips = hipsNamed.find((p) => p.base !== 'root') ? hipsNamed.find((p) => p.base !== 'root').name : hipsNamed[0].name;
    else if (spines.length > 1 && spines[0].idx === 0) out.hips = spines.shift().name;   // Rigify: DEF-spine is the hips

    const headNamed = byBase(central, ['head']);
    const neckNamed = byBase(central, ['neck']);
    if (headNamed.length) out.head = headNamed[0].name;
    if (neckNamed.length) out.neck = neckNamed.map((p) => p.name);
    // Stock Rigify names the neck/head spine.004–.006: peel them off the top.
    if (!out.head && spines.length >= 4) out.head = spines.pop().name;
    if (!out.neck.length && !neckNamed.length && spines.length >= 5) out.neck = spines.splice(-2).map((p) => p.name);
    out.spine = spines.map((p) => p.name);

    for (const side of ['L', 'R']) {
      const sided = parsed.filter((p) => p.side === side);
      for (const part of Object.keys(LIMB_BASES)) {
        const hits = byBase(sided, LIMB_BASES[part]);
        if (hits.length) out[part + '.' + side] = hits.map((p) => p.name);
      }
    }
    return out;
  }

  // Which required parts a classified skeleton is missing (empty = usable).
  function missingParts(cls) {
    const need = ['hips', 'head'];
    const missing = need.filter((k) => !cls[k]);
    if (!cls.spine || !cls.spine.length) missing.push('spine');
    for (const side of ['L', 'R']) {
      for (const part of ['upperArm', 'forearm', 'hand', 'thigh', 'shin', 'foot']) {
        if (!cls[part + '.' + side]) missing.push(part + '.' + side);
      }
    }
    return missing;
  }

  // ── Animation state ──
  // Reference speeds are the ground speeds the walk/jog clips were authored
  // at (u/s at build scale 1) — playback is scaled to real speed so feet don't
  // skate. Calibrated in the asset audit; override via opts.
  const ANIM = {
    IDLE_EPS: 0.15,       // below this ground speed → idle
    RUN_FRAC: 0.55,       // at/above this fraction of maxSpeed → run
    WALK_REF: 1.5,
    BACK_MAX_TS: 1.4,     // backpedal cadence cap — a step back is never a scramble
    RUN_REF: 4.0,
    LAND_MS: 180,
    JUMP_UP_VEL: 0.5
  };

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // Knockdown timeline: 'down' until downUntil, then 'getup' until getupUntil.
  function downPhase(now, downUntil, getupUntil) {
    if (downUntil && now < downUntil) return 'down';
    if (getupUntil && now < getupUntil) return 'getup';
    return null;
  }

  // inp: { speed, maxSpeed, airborne, velY, falling, now, landAt,
  //        downUntil, getupUntil, hitUntil, punchUntil, emoteUntil,
  //        pose ('sit' | 'lie' | null) }
  // → { base, overlay, timeScale }
  function selectAnimState(inp, opts) {
    const A = Object.assign({}, ANIM, opts || {});
    const now = inp.now || 0;
    const speed = Math.max(0, inp.speed || 0);
    const maxSpeed = inp.maxSpeed || A.RUN_REF;

    const down = downPhase(now, inp.downUntil, inp.getupUntil);
    if (down) return { base: down, overlay: null, timeScale: 1 };
    // Sitting / lying: the pose layer owns the limbs over a plain idle, and
    // no overlay (a punch from a chair would tear the pose apart).
    if (inp.pose) return { base: 'idle', overlay: null, timeScale: 1 };

    let base;
    let timeScale = 1;
    if (inp.falling) {
      return { base: 'fall', overlay: null, timeScale: 1 };
    } else if (inp.airborne) {
      base = (inp.velY || 0) > A.JUMP_UP_VEL ? 'jumpUp' : 'fall';
    } else if (inp.landAt && now - inp.landAt < A.LAND_MS && speed < A.RUN_FRAC * maxSpeed) {
      base = 'land';
    } else if (speed < A.IDLE_EPS) {
      base = 'idle';
    } else if (speed < A.RUN_FRAC * maxSpeed) {
      base = 'walk';
      timeScale = clamp(speed / A.WALK_REF, 0.6, 1.6);
    } else {
      base = 'run';
      timeScale = clamp(speed / A.RUN_REF, 0.7, 1.4);
    }

    // Backpedalling is always a careful walk, never a jog, played in reverse
    // (negative time scale) so the legs cycle backwards with the motion —
    // without it the character moonwalks. The engine layers a lean-back on
    // top. Only locomotion reverses; jumps, landings and knockdowns read the
    // same whichever way you were going.
    if (inp.backward && (base === 'walk' || base === 'run')) {
      base = 'walk';
      timeScale = -clamp(speed / A.WALK_REF, 0.6, A.BACK_MAX_TS);
    }

    // A flinch (just been hit) beats a swing, which beats a wave.
    let overlay = null;
    if (inp.hitUntil && now < inp.hitUntil) overlay = 'hit';
    else if (inp.punchUntil && now < inp.punchUntil) overlay = 'punch';
    else if (inp.emoteUntil && now < inp.emoteUntil) overlay = 'wave';
    return { base, overlay, timeScale: round3(timeScale) };
  }

  // ── Level of detail ──
  // → { animate, interval (seconds between mixer updates; 0 = every frame),
  //     castShadow }
  function lodTier(dist, onScreen, isMobile) {
    if (!onScreen) return { animate: false, interval: Infinity, castShadow: false };
    const near = isMobile ? 12 : 20;
    const far = isMobile ? 30 : 50;
    const shadow = isMobile ? 15 : 30;
    if (dist <= near) return { animate: true, interval: 0, castShadow: dist <= shadow };
    if (dist <= far) return { animate: true, interval: 1 / 15, castShadow: dist <= shadow };
    return { animate: false, interval: Infinity, castShadow: false };
  }

  // ── Slot map ──
  // How each stored homeCharacter slot is realised on a realistic body.
  //   body        → picks/shapes the base model
  //   tint        → recolours a body region or material (target)
  //   mesh        → toggles a model part (hair, outfits)
  //   attach      → existing procedural piece mounted on a bone anchor
  //   unsupported → kept in storage, greyed out in the customizer
  //   deprecated  → legacy key, ignored
  const SLOT_MAP = {
    gender:          { kind: 'body' },
    build:           { kind: 'body' },
    bodyType:        { kind: 'body' },   // 1 = Box skips the rigged body entirely
    skin:            { kind: 'tint', target: 'skin' },
    eyeColor:        { kind: 'tint', target: 'eyes' },
    eyeShape:        { kind: 'unsupported' },
    hairStyle:       { kind: 'mesh', target: 'hair' },
    hairColor:       { kind: 'tint', target: 'hair' },
    facialHairStyle: { kind: 'mesh', target: 'beard' },
    facialHairColor: { kind: 'tint', target: 'beard' },
    glasses:         { kind: 'attach', anchor: 'head' },
    hat:             { kind: 'attach', anchor: 'head' },
    shirtStyle:      { kind: 'tint', target: 'top' },
    shirtColor:      { kind: 'tint', target: 'top' },
    shirtColor2:     { kind: 'tint', target: 'topAccent' },
    pantsStyle:      { kind: 'tint', target: 'bottom' },
    pantsColor:      { kind: 'tint', target: 'bottom' },
    pantsColor2:     { kind: 'tint', target: 'bottomAccent' },
    shoeStyle:       { kind: 'tint', target: 'shoes' },
    shoeColor:       { kind: 'tint', target: 'shoes' },
    shoeColor2:      { kind: 'tint', target: 'shoesAccent' },
    outerwear:       { kind: 'attach', anchor: 'back' },
    outerwearColor:  { kind: 'tint', target: 'outerwear' },
    outerwearColor2: { kind: 'tint', target: 'outerwearAccent' },
    suit:            { kind: 'tint', target: 'suit' },
    suitColor:       { kind: 'tint', target: 'suit' },
    gloves:          { kind: 'tint', target: 'hands' },
    belt:            { kind: 'attach', anchor: 'pelvis' },
    mask:            { kind: 'attach', anchor: 'head' },
    accessoryColor:  { kind: 'tint', target: 'accessory' },
    helmet:          { kind: 'attach', anchor: 'head' },
    helmetColor:     { kind: 'tint', target: 'helmet' },
    prop:            { kind: 'attach', anchor: 'hand.R' },
    propColor:       { kind: 'tint', target: 'prop' },
    emblem:          { kind: 'attach', anchor: 'chest' },
    emblemColor:     { kind: 'tint', target: 'emblem' },
    gear:            { kind: 'deprecated' }
  };

  // ── garments ──
  // Clothing that needs real geometry on a rigged body, rather than a tint:
  // "shell" pieces are a second skin layer (jacket, vest, armour) and "skirt"
  // / "cape" pieces hang from the waist or shoulders. Lengths are in body
  // units (a body stands ~1.9 tall); the engine resolves the colour slots.
  const PANTS_SKIRT = 4;                                   // Playground.PANTS_STYLES
  const SUIT = { BODYSUIT: 1, DRESS: 2, ROBE: 3, ARMOR: 4, JUMPSUIT: 5 };
  const OUTER = { JACKET: 1, BOMBER: 2, TRENCH: 3, HOODIE: 4, VEST: 5, CAPE: 6 };
  const SLEEVED = ['torso', 'upperArm', 'forearm'];

  function garmentsFor(c) {
    c = c || {};
    const suit = c.suit ?? 0;
    const outer = c.outerwear ?? 0;
    const pants = c.pantsStyle ?? 0;
    const out = { shell: null, skirt: null, cape: null, hood: false };

    // Full-body armour (Iron Man) — a metal shell over everything but the head,
    // two-tone: the biceps and thighs take the accessory colour (Iron Man's
    // gold on red; a Knight's silver trim on grey).
    if (suit === SUIT.ARMOR) {
      // Gauntlets over armour move the trim to the arms — plated arms and
      // vambraces over dark legs (Thor). Silver thighs read as grey trousers.
      const accentParts = (c.gloves ?? 0) === 3 ? ['upperArm', 'forearm'] : ['upperArm', 'thigh'];
      out.shell = {
        kind: 'armor', color: 'suit', accent: 'accessory', accentParts,
        parts: ['torso', 'upperArm', 'forearm', 'hand', 'pelvis', 'thigh', 'shin', 'foot'],
        inflate: 0.022, metal: 0.85, rough: 0.28, pauldrons: true
      };
    }

    // Skirts: a dress/robe suit, or the Skirt trouser style.
    if (suit === SUIT.DRESS) out.skirt = { kind: 'dress', color: 'suit', length: 0.5, flare: 1.8 };
    else if (suit === SUIT.ROBE) out.skirt = { kind: 'robe', color: 'suit', length: 0.85, flare: 1.5 };
    else if (pants === PANTS_SKIRT) out.skirt = { kind: 'skirt', color: 'bottom', length: 0.32, flare: 1.9 };

    if (outer === OUTER.CAPE) {
      // Shoulder-width, ankle-length. Wider than this reads as a flag, not a
      // cape (measured against a 0.45-wide chest in the live preview).
      out.cape = { color: 'outer', length: 0.95, width: 0.46, sweep: 0.1 };
    } else if (outer) {
      const kind = ['', 'jacket', 'bomber', 'trench', 'hoodie', 'vest'][outer];
      out.shell = {
        kind, color: 'outer', accent: 'outerAccent',
        parts: outer === OUTER.VEST ? ['torso'] : SLEEVED,
        // A bomber's sleeves stop at a ribbed cuff; the rest reach the wrist.
        cut: outer === OUTER.BOMBER ? { forearm: 0.85 } : null,
        inflate: outer === OUTER.VEST ? 0.016 : 0.014, metal: 0, rough: 0.8
      };
      // Coat tails hang from the waist like a skirt.
      if (outer === OUTER.TRENCH) out.skirt = { kind: 'coat', color: 'outer', length: 0.62, flare: 1.3 };
      if (outer === OUTER.HOODIE) out.hood = true;
    }
    return out;
  }

  return {
    ASSET_BASE, BODY_FILES, BUILD_SHAPE, ANIM, SLOT_MAP,
    bodyShapeFor, parseBoneName, classifySkeleton, missingParts,
    downPhase, selectAnimState, lodTier, garmentsFor
  };
});
