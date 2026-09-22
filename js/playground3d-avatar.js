/************************************************
 * PLAYGROUND 3D — avatar mesh builders
 *
 * Extracted from js/playground3d.js (2026-09-22). Builds the procedural
 * ("Realistic" base) and legacy Box-body avatars plus every hero piece:
 * hair, facial hair, glasses, hats, helmets, props, emblems, clothing,
 * footwear, outerwear, suits and accessories. Also owns the shared
 * geometry cache and the hero-gear material, which the rigged-glTF
 * upgrade path in playground3d.js reuses.
 *
 * Pure builders: they read window.THREE, Playground (palettes / hidden
 * slots) and their arguments — no engine state. playground3d.js aliases
 * these back to their old underscore names, so the engine code is
 * unchanged. Must load BEFORE js/playground3d.js.
 ************************************************/
(function (root) {
  // ── shared geometry cache ──
  // Capsules / rounded boxes cost more to build than BoxGeometry and are
  // identical across avatars (dims depend only on build/bulk/style), so they
  // are cached for the page lifetime and shared between rigs — including the
  // thumbnail batches on /customize. Shared geometries are marked and MUST
  // be skipped by every rig-dispose site (double-dispose = invisible avatars).
  const _geomCache = new Map();
  function _sharedGeom(key, make) {
    let g = _geomCache.get(key);
    if (!g) {
      g = make();
      g.userData.shared = true;
      _geomCache.set(key, g);
    }
    return g;
  }

  // Hero gear material — standard-shaded so the pieces sit in the same light
  // as the rigged bodies (the old Lambert boxes read flat and pasted-on).
  function _gearMat(hex, o) {
    o = o || {};
    const THREE = window.THREE;
    const m = new THREE.MeshStandardMaterial({
      color: hex, metalness: o.metal != null ? o.metal : 0.15, roughness: o.rough != null ? o.rough : 0.6
    });
    if (o.emissive != null) {
      m.emissive = new THREE.Color(o.emissive);
      m.emissiveIntensity = o.emissiveIntensity != null ? o.emissiveIntensity : 1;
    }
    return m;
  }
  const _METAL = { metal: 0.8, rough: 0.35 };

  // ── Box body (Body type: "Box") ──
  // The original all-box character, restored from before the rounded/capsule
  // rework (4047b59) so players can pick the blocky look. Pure boxes: box
  // legs, torso and arms, cube head, no elbows or knees. It shares every
  // outfit/gear helper with the procedural body and exposes the same core
  // bones, so walk, punch, knockdown and idle all run through the shared
  // pose code (which already skips the missing lower-limb segments).
  function _buildBoxPlayer(c) {
    const THREE = window.THREE;
    const skinHex = _palette('SKIN_TONES', c.skin);
    const shirtHex = _palette('SHIRT_COLORS', c.shirtColor);
    const pantsHex = _palette('PANTS_COLORS', c.pantsColor);
    const hairHex = _palette('HAIR_COLORS', c.hairColor);
    const shoeHex = _palette('SHOE_COLORS', c.shoeColor);
    const eyeHex  = _palette('EYE_COLORS', c.eyeColor);
    const beardHex = _palette('HAIR_COLORS', c.facialHairColor ?? c.hairColor);
    const styleIdx = c.hairStyle ?? 0;
    const eyeShapeIdx = c.eyeShape ?? 0;
    const beardIdx = c.facialHairStyle ?? 0;
    const glassesIdx = c.glasses ?? 0;
    const hatIdx = c.hat ?? 0;
    // Body build (size/bulk). `?? 1` keeps pre-existing saved characters
    // (which have no `build` field) at Normal.
    const buildIdx = c.build ?? 1;
    // ── clothing-shape slots ──
    // A full-body suit (suit > 0) recolors and owns the torso + legs + arms and
    // suppresses the standalone top/bottom styles; only a cape may layer over it
    // (handled below). All slots default 0 → legacy/None, so pre-upgrade saved
    // characters render identically.
    const suitIdx = c.suit ?? 0;
    const suitActive = suitIdx > 0;
    const topStyle = c.shirtStyle ?? 0;
    const bottomStyle = c.pantsStyle ?? 0;
    const footStyle = c.shoeStyle ?? 0;
    let outerIdx = c.outerwear ?? 0;
    if (suitActive && outerIdx !== 6) outerIdx = 0;     // suit allows only a cape
    const topSpec = _topSpec(suitActive ? -1 : topStyle);
    const bottomSpec = _bottomSpec(suitActive ? -1 : bottomStyle);
    // Round 2: gender silhouette, reusable hero pieces, and the shared
    // hidden-slot map (so the rig never builds a part the UI greys out).
    const g = _genderSpec(c.gender ?? 0);
    const helmetIdx = c.helmet ?? 0, propIdx = c.prop ?? 0, emblemIdx = c.emblem ?? 0;
    const hidden = (typeof Playground !== 'undefined' && Playground.characterHidden)
      ? Playground.characterHidden(c) : {};
    const buildDef = (typeof Playground !== 'undefined' && Playground.BUILDS && Playground.BUILDS[buildIdx])
      || { scale: 1, bulk: 1 };
    const bulk = buildDef.bulk;

    const skinMat  = new THREE.MeshLambertMaterial({ color: skinHex });
    const shirtMat = new THREE.MeshLambertMaterial({ color: shirtHex });
    const pantsMat = new THREE.MeshLambertMaterial({ color: pantsHex });
    const hairMat  = new THREE.MeshLambertMaterial({ color: hairHex });
    const shoeMat  = new THREE.MeshLambertMaterial({ color: shoeHex });
    const eyeMat   = new THREE.MeshLambertMaterial({ color: eyeHex });
    const beardMat = new THREE.MeshLambertMaterial({ color: beardHex });
    // New clothing-shape materials.
    const outerMat = new THREE.MeshLambertMaterial({ color: _palette('SHIRT_COLORS', c.outerwearColor) });
    const suitMat  = new THREE.MeshLambertMaterial({ color: _palette('SUIT_COLORS', c.suitColor) });
    const accMat   = new THREE.MeshLambertMaterial({ color: _palette('ACCESSORY_COLORS', c.accessoryColor) });
    // Base limb/torso colors honoring the suit override. A "ripped" top (Hulk)
    // bares the chest, so the torso + sleeves render in skin tone.
    const rippedTop = !suitActive && topStyle === 8;
    const legMat   = suitActive ? suitMat : pantsMat;
    const topMat   = suitActive ? suitMat : (rippedTop ? skinMat : shirtMat);
    // Hero-piece colors + pants accent (secondary) material (Auto → legMat).
    const helmetMat = new THREE.MeshLambertMaterial({ color: _palette('SHIRT_COLORS', c.helmetColor) });
    const propMat   = new THREE.MeshLambertMaterial({ color: _palette('SHIRT_COLORS', c.propColor) });
    const emblemMat = new THREE.MeshLambertMaterial({ color: _palette('SHIRT_COLORS', c.emblemColor) });
    const pantsAccInt = ((c.pantsColor2 ?? 0) > 0) ? _palette('PANTS_COLORS', (c.pantsColor2) - 1) : null;
    const pantsAccMat = (pantsAccInt != null) ? new THREE.MeshLambertMaterial({ color: pantsAccInt }) : legMat;

    const mkBox = (w, h, d, mat, cast = true) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.castShadow = cast;
      return m;
    };

    // Root — moved/yawed by the engine. Origin at feet center.
    const root = new THREE.Group();

    // Body group — for breathing scale that doesn't affect feet placement.
    const body = new THREE.Group();
    root.add(body);

    // Legs (with pivots at the hip so we can swing them).
    const HIP_Y = 0.7;
    const LEG_LEN = 0.7;
    const LEG_W = 0.32 * bulk;
    const LEG_D = 0.32 * bulk;
    const FOOT_H = 0.18;

    const mkLeg = (xOffset) => {
      const pivot = new THREE.Group();
      pivot.position.set(xOffset, HIP_Y, 0);
      const shape = bottomSpec.legShape;
      // Shorts/skirt expose a bare (skin) lower leg; everything else is a
      // single pant/suit-colored limb. Slim narrows the limb. Index 0/legacy
      // and the suit case both fall through to a plain full-length leg, so the
      // base geometry is unchanged from before.
      const bare = (shape === 'shorts' || shape === 'skirt');
      const limbMat = bare ? skinMat : legMat;
      const wScale = (shape === 'slim') ? 0.85 : 1;
      const leg = mkBox(LEG_W * wScale, LEG_LEN, LEG_D * wScale, limbMat);
      leg.position.y = -LEG_LEN / 2;
      pivot.add(leg);
      if (shape === 'shorts') {
        const sh = mkBox(LEG_W * 1.06, LEG_LEN * 0.5, LEG_D * 1.06, legMat);
        sh.position.y = -LEG_LEN * 0.25;
        pivot.add(sh);
      } else if (shape === 'cargo') {
        [-1, 1].forEach(s => {
          const pk = mkBox(0.06, LEG_LEN * 0.22, LEG_D * 0.7, pantsAccMat);
          pk.position.set(s * (LEG_W / 2 + 0.02), -LEG_LEN * 0.45, 0);
          pivot.add(pk);
        });
      } else if (shape === 'joggers') {
        const cuff = mkBox(LEG_W * 1.1, 0.12, LEG_D * 1.1, pantsAccMat);
        cuff.position.y = -LEG_LEN + 0.06;
        pivot.add(cuff);
      } else if (shape === 'greaves') {
        const plate = mkBox(LEG_W * 1.12, LEG_LEN * 0.55, LEG_D * 1.12, pantsAccInt != null ? pantsAccMat : accMat);
        plate.position.set(0, -LEG_LEN * 0.6, 0.02);
        pivot.add(plate);
      }
      // Footwear (index 0 reproduces the legacy foot box exactly).
      const fw = _buildFootwear(footStyle, shoeMat, { LEG_W, LEG_D, LEG_LEN, FOOT_H }, c.shoeColor2 ?? 0);
      if (fw) pivot.add(fw);
      return pivot;
    };
    const leftLeg = mkLeg(-0.18 * bulk);
    const rightLeg = mkLeg(0.18 * bulk);
    body.add(leftLeg);
    body.add(rightLeg);
    // Skirt — a single flared piece around the hips (the legs underneath stay
    // bare skin). Only for the standalone skirt bottom, not a suit.
    if (!suitActive && bottomSpec.legShape === 'skirt') {
      const skirt = new THREE.Mesh(
        new THREE.CylinderGeometry(LEG_W * 2.2, LEG_W * 3.4, 0.55, 16),
        pantsMat
      );
      skirt.position.y = HIP_Y - 0.18;
      skirt.castShadow = true;
      body.add(skirt);
    }

    // Torso. Width/depth widen with `bulk` so a Huge build reads as broad,
    // not just a bigger copy; height stays fixed (overall scale handles tall).
    const TORSO_W = 0.85 * bulk * g.torsoWMul, TORSO_H = 0.75, TORSO_D = 0.45 * bulk;
    const torso = mkBox(TORSO_W, TORSO_H, TORSO_D, topMat);
    torso.position.y = HIP_Y + TORSO_H / 2;
    body.add(torso);
    // Top-style detail (collar / hood / pocket / stripe) — torso-local.
    // Suppressed for a suit (the suit builder owns torso detailing).
    if (!suitActive) {
      const topDetail = _buildTopDetail(topStyle, shirtMat, skinMat, { TORSO_W, TORSO_H, TORSO_D }, c.shirtColor2 ?? 0);
      if (topDetail) torso.add(topDetail);
    }

    // Arms (pivot at the shoulder, hangs down).
    const SHOULDER_Y = HIP_Y + TORSO_H - 0.05;
    const ARM_LEN = 0.7;
    const ARM_W = 0.22 * bulk, ARM_D = 0.22 * bulk;

    const mkArm = (xSign) => {
      const pivot = new THREE.Group();
      pivot.position.set(xSign * (TORSO_W / 2 + ARM_W / 2 - 0.02), SHOULDER_Y, 0);
      const arm = mkBox(ARM_W, ARM_LEN, ARM_D, skinMat);
      arm.position.y = -ARM_LEN / 2;
      pivot.add(arm);
      // Sleeve length depends on the top style: 'short' (legacy tee, 0.4),
      // 'long' (long-sleeve/hoodie/turtleneck/suit, 0.95), or 'none' (tank).
      if (topSpec.sleeve !== 'none') {
        const frac = topSpec.sleeve === 'long' ? 0.95 : 0.4;
        const sleeve = mkBox(ARM_W * 1.02, ARM_LEN * frac, ARM_D * 1.02, topMat);
        sleeve.position.y = -ARM_LEN * (frac / 2);
        pivot.add(sleeve);
      }
      return pivot;
    };
    const leftArm = mkArm(-1);
    const rightArm = mkArm(1);
    body.add(leftArm);
    body.add(rightArm);

    // Gender shaping — parented to bones so it animates. Neutral (g.* all 0)
    // adds nothing → identical to pre-round-2 output.
    if (g.shoulderPad > 0) {
      const pad = mkBox(TORSO_W * 1.18, 0.12, TORSO_D * 1.05, topMat);
      pad.position.y = TORSO_H / 2 - 0.02;
      torso.add(pad);
    }
    if (g.chest > 0) {
      [-1, 1].forEach(s => {
        const b = new THREE.Mesh(new THREE.SphereGeometry(g.chest * bulk, 10, 8), topMat);
        b.position.set(s * TORSO_W * 0.22, TORSO_H * 0.08, TORSO_D / 2);
        b.castShadow = true;
        torso.add(b);
      });
    }
    if (g.hip > 0) {
      const hipPiece = new THREE.Mesh(new THREE.CylinderGeometry(TORSO_W * 0.42, TORSO_W * 0.52, 0.35, 14), legMat);
      hipPiece.position.y = HIP_Y;
      hipPiece.castShadow = true;
      body.add(hipPiece);
    }

    // Head + face.
    const HEAD_SZ = 0.55;
    const head = new THREE.Group();
    head.position.y = HIP_Y + TORSO_H + HEAD_SZ / 2 + 0.02;
    const headBox = mkBox(HEAD_SZ, HEAD_SZ, HEAD_SZ, skinMat);
    head.add(headBox);
    // Eyes — shape varies by eyeShape index. Positive Z is "front".
    const eyeFrontZ = HEAD_SZ / 2 + 0.001;
    const eyeShapeDims = _eyeShapeDims(eyeShapeIdx);
    const leftEye = new THREE.Mesh(
      new THREE.BoxGeometry(eyeShapeDims.w, eyeShapeDims.h, 0.02),
      eyeMat
    );
    leftEye.position.set(-0.12, 0.04, eyeFrontZ);
    leftEye.rotation.z = eyeShapeDims.rot || 0;
    head.add(leftEye);
    const rightEye = new THREE.Mesh(
      new THREE.BoxGeometry(eyeShapeDims.w, eyeShapeDims.h, 0.02),
      eyeMat
    );
    rightEye.position.set(0.12, 0.04, eyeFrontZ);
    rightEye.rotation.z = -(eyeShapeDims.rot || 0);
    head.add(rightEye);
    // Mouth — small dark bar.
    const mouthMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.02), mouthMat);
    mouth.position.set(0, -0.12, HEAD_SZ / 2 + 0.001);
    head.add(mouth);

    // Facial hair — skipped when hidden (a full mask covers the face).
    if (!hidden.facialHairStyle) {
      const beard = _buildFacialHair(beardIdx, beardMat, HEAD_SZ);
      if (beard) head.add(beard);
    }

    // Hair — skipped when hidden (helmet / hood).
    if (!hidden.hairStyle) {
      const hair = _buildHair(styleIdx, hairMat, HEAD_SZ);
      if (hair) head.add(hair);
    }

    // Glasses — skipped when hidden (full mask).
    if (!hidden.glasses) {
      const glasses = _buildGlasses(glassesIdx, HEAD_SZ);
      if (glasses) head.add(glasses);
    }

    // Hat — skipped when hidden (helmet). Cap variant borrows the shirt color.
    if (!hidden.hat) {
      const hat = _buildHat(hatIdx, HEAD_SZ, shirtHex);
      if (hat) head.add(hat);
    }

    body.add(head);

    // Outerwear layer (jacket / coat / vest / cape) — body-local, over the
    // torso. No-op when outerIdx is 0.
    const outerwearGrp = _buildOuterwear(outerIdx, outerMat, { TORSO_W, TORSO_H, TORSO_D, HIP_Y }, c.outerwearColor2 ?? 0);
    if (outerwearGrp) body.add(outerwearGrp);

    // Full-body suit detailing (the base torso/legs/arms are already recolored
    // to the suit color above). No-op when suit is 0.
    if (suitActive) {
      const suitExtra = _buildSuit(suitIdx, suitMat, accMat, { TORSO_W, TORSO_H, TORSO_D, HIP_Y });
      if (suitExtra) body.add(suitExtra);
    }

    // Reusable hero pieces (replaced the old `gear` slot). Helmet → head,
    // emblem → torso (proud of any chest layer), prop → a hand (swings w/ arm).
    const helmetGrp = _buildHelmet(helmetIdx, helmetMat, HEAD_SZ);
    if (helmetGrp) head.add(helmetGrp);
    const emblemGrp = _buildEmblem(emblemIdx, emblemMat, { TORSO_D });
    if (emblemGrp) torso.add(emblemGrp);
    _buildProp(propIdx, propMat, { leftArm, rightArm, torso, dims: { ARM_LEN } });

    // Accessories (gloves / belt / mask) — mask suppressed when a helmet hides it.
    _buildAccessories({
      head, torso, leftArm, rightArm,
      dims: { HEAD_SZ, TORSO_W, TORSO_H, TORSO_D, ARM_LEN, ARM_W, ARM_D },
      styles: { gloves: c.gloves ?? 0, belt: c.belt ?? 0, mask: hidden.mask ? 0 : (c.mask ?? 0) },
      mat: accMat
    });

    // Build scale — grows the whole figure from the feet (root origin is at
    // foot level, so feet stay planted). Untouched by the tick, which only
    // animates body.scale (breathing) and root position/rotation.
    root.scale.setScalar(buildDef.scale);

    // Default forward: character faces -Z by convention. The engine yaws
    // the root via root.rotation.y to face the movement direction.
    // userData.bones is read both by the local _tick() (via the module-
    // level _rig set by the local-only call sites) and by
    // _tickRemotePlayers() (via the remote rig stored in _remotePlayers).
    root.userData.bones = {
      body, head, torso, leftArm, rightArm, leftLeg, rightLeg
    };
    return root;
  }

  function _buildProceduralPlayer(c) {
    const THREE = window.THREE;
    const skinHex = _palette('SKIN_TONES', c.skin);
    const shirtHex = _palette('SHIRT_COLORS', c.shirtColor);
    const pantsHex = _palette('PANTS_COLORS', c.pantsColor);
    const hairHex = _palette('HAIR_COLORS', c.hairColor);
    const shoeHex = _palette('SHOE_COLORS', c.shoeColor);
    const eyeHex  = _palette('EYE_COLORS', c.eyeColor);
    const beardHex = _palette('HAIR_COLORS', c.facialHairColor ?? c.hairColor);
    const styleIdx = c.hairStyle ?? 0;
    const eyeShapeIdx = c.eyeShape ?? 0;
    const beardIdx = c.facialHairStyle ?? 0;
    const glassesIdx = c.glasses ?? 0;
    const hatIdx = c.hat ?? 0;
    // Body build (size/bulk). `?? 1` keeps pre-existing saved characters
    // (which have no `build` field) at Normal.
    const buildIdx = c.build ?? 1;
    // ── clothing-shape slots ──
    // A full-body suit (suit > 0) recolors and owns the torso + legs + arms and
    // suppresses the standalone top/bottom styles; only a cape may layer over it
    // (handled below). All slots default 0 → legacy/None, so pre-upgrade saved
    // characters render identically.
    const suitIdx = c.suit ?? 0;
    const suitActive = suitIdx > 0;
    const topStyle = c.shirtStyle ?? 0;
    const bottomStyle = c.pantsStyle ?? 0;
    const footStyle = c.shoeStyle ?? 0;
    let outerIdx = c.outerwear ?? 0;
    if (suitActive && outerIdx !== 6) outerIdx = 0;     // suit allows only a cape
    const topSpec = _topSpec(suitActive ? -1 : topStyle);
    const bottomSpec = _bottomSpec(suitActive ? -1 : bottomStyle);
    // Round 2: gender silhouette, reusable hero pieces, and the shared
    // hidden-slot map (so the rig never builds a part the UI greys out).
    const g = _genderSpec(c.gender ?? 0);
    const helmetIdx = c.helmet ?? 0, propIdx = c.prop ?? 0, emblemIdx = c.emblem ?? 0;
    const hidden = (typeof Playground !== 'undefined' && Playground.characterHidden)
      ? Playground.characterHidden(c) : {};
    const buildDef = (typeof Playground !== 'undefined' && Playground.BUILDS && Playground.BUILDS[buildIdx])
      || { scale: 1, bulk: 1 };
    const bulk = buildDef.bulk;

    const skinMat  = new THREE.MeshLambertMaterial({ color: skinHex });
    const shirtMat = new THREE.MeshLambertMaterial({ color: shirtHex });
    const pantsMat = new THREE.MeshLambertMaterial({ color: pantsHex });
    const hairMat  = new THREE.MeshLambertMaterial({ color: hairHex });
    const shoeMat  = new THREE.MeshLambertMaterial({ color: shoeHex });
    const eyeMat   = new THREE.MeshLambertMaterial({ color: eyeHex });
    const beardMat = new THREE.MeshLambertMaterial({ color: beardHex });
    // New clothing-shape materials.
    const outerMat = new THREE.MeshLambertMaterial({ color: _palette('SHIRT_COLORS', c.outerwearColor) });
    const suitMat  = new THREE.MeshLambertMaterial({ color: _palette('SUIT_COLORS', c.suitColor) });
    const accMat   = new THREE.MeshLambertMaterial({ color: _palette('ACCESSORY_COLORS', c.accessoryColor) });
    // Base limb/torso colors honoring the suit override. A "ripped" top (Hulk)
    // bares the chest, so the torso + sleeves render in skin tone.
    const rippedTop = !suitActive && topStyle === 8;
    const legMat   = suitActive ? suitMat : pantsMat;
    const topMat   = suitActive ? suitMat : (rippedTop ? skinMat : shirtMat);
    // Hero-piece colors + pants accent (secondary) material (Auto → legMat).
    const helmetMat = new THREE.MeshLambertMaterial({ color: _palette('SHIRT_COLORS', c.helmetColor) });
    const propMat   = new THREE.MeshLambertMaterial({ color: _palette('SHIRT_COLORS', c.propColor) });
    const emblemMat = new THREE.MeshLambertMaterial({ color: _palette('SHIRT_COLORS', c.emblemColor) });
    const pantsAccInt = ((c.pantsColor2 ?? 0) > 0) ? _palette('PANTS_COLORS', (c.pantsColor2) - 1) : null;
    const pantsAccMat = (pantsAccInt != null) ? new THREE.MeshLambertMaterial({ color: pantsAccInt }) : legMat;

    const mkBox = (w, h, d, mat, cast = true) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.castShadow = cast;
      return m;
    };
    // Rounded/organic primitives for the core body — shared via the geometry
    // cache (dims repeat across avatars). Both fall back to plain boxes if a
    // stale module shim hasn't exposed the examples/jsm geometry yet.
    const rnd = (n) => Math.round(n * 1000) / 1000;
    const mkRounded = (w, h, d, r, mat, cast = true) => {
      const geo = _sharedGeom(`rb:${rnd(w)}:${rnd(h)}:${rnd(d)}:${rnd(r)}`, () =>
        THREE.RoundedBoxGeometry
          ? new THREE.RoundedBoxGeometry(w, h, d, 3, r)
          : new THREE.BoxGeometry(w, h, d));
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = cast;
      return m;
    };
    // Capsule: `len` is the TOTAL height (cylinder + both caps).
    const mkCapsule = (radius, len, mat, cast = true) => {
      const cyl = Math.max(0.01, len - radius * 2);
      const geo = _sharedGeom(`cap:${rnd(radius)}:${rnd(len)}`, () =>
        THREE.CapsuleGeometry
          ? new THREE.CapsuleGeometry(radius, cyl, 3, 8)
          : new THREE.BoxGeometry(radius * 2, len, radius * 2));
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = cast;
      return m;
    };
    const mkSphere = (radius, mat, cast = true) => {
      const geo = _sharedGeom(`sph:${rnd(radius)}`, () => new THREE.SphereGeometry(radius, 8, 6));
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = cast;
      return m;
    };

    // Root — moved/yawed by the engine. Origin at feet center.
    const root = new THREE.Group();

    // Body group — for breathing scale that doesn't affect feet placement.
    const body = new THREE.Group();
    root.add(body);

    // Legs (with pivots at the hip so we can swing them).
    const HIP_Y = 0.7;
    const LEG_LEN = 0.7;
    const LEG_W = 0.32 * bulk;
    const LEG_D = 0.32 * bulk;
    const FOOT_H = 0.18;

    // Two-segment legs: hip pivot (keeps the legacy `leftLeg`/`rightLeg` bone
    // names the animation code swings) + a child knee pivot at mid-leg so the
    // walk cycle can bend. Segments are capsules for the rounded look; the
    // lower segment carries footwear/cuffs via an attach group that restores
    // the legacy hip-local coordinate space, so the sub-builders are untouched.
    const mkLeg = (xOffset) => {
      const pivot = new THREE.Group();
      pivot.position.set(xOffset, HIP_Y, 0);
      const shape = bottomSpec.legShape;
      // Shorts/skirt expose a bare (skin) lower leg; everything else is a
      // single pant/suit-colored limb. Slim narrows the limb. Index 0/legacy
      // and the suit case both fall through to a plain full-length leg.
      const bare = (shape === 'shorts' || shape === 'skirt');
      const limbMat = bare ? skinMat : legMat;
      const wScale = (shape === 'slim') ? 0.85 : 1;
      const SEG = LEG_LEN / 2;
      const legR = (LEG_W * wScale) / 2;

      const upper = mkCapsule(legR, SEG + legR, limbMat);
      upper.position.y = -SEG / 2;
      pivot.add(upper);

      const knee = new THREE.Group();
      knee.position.y = -SEG;
      pivot.add(knee);
      const lower = mkCapsule(legR, SEG + legR * 0.6, limbMat);
      lower.position.y = -SEG / 2;
      knee.add(lower);
      // Attach group: children positioned in the OLD hip-local space keep
      // working (offset undoes the knee pivot's translation).
      const kneeAttach = new THREE.Group();
      kneeAttach.position.y = SEG;
      knee.add(kneeAttach);

      if (shape === 'shorts') {
        const sh = mkBox(LEG_W * 1.06, LEG_LEN * 0.5, LEG_D * 1.06, legMat);
        sh.position.y = -LEG_LEN * 0.25;
        pivot.add(sh);
      } else if (shape === 'cargo') {
        [-1, 1].forEach(s => {
          const pk = mkBox(0.06, LEG_LEN * 0.22, LEG_D * 0.7, pantsAccMat);
          pk.position.set(s * (LEG_W / 2 + 0.02), -LEG_LEN * 0.45, 0);
          pivot.add(pk);
        });
      } else if (shape === 'joggers') {
        const cuff = mkBox(LEG_W * 1.1, 0.12, LEG_D * 1.1, pantsAccMat);
        cuff.position.y = -LEG_LEN + 0.06;
        kneeAttach.add(cuff);                    // below the knee — rides the shin
      } else if (shape === 'greaves') {
        const plate = mkBox(LEG_W * 1.12, LEG_LEN * 0.55, LEG_D * 1.12, pantsAccInt != null ? pantsAccMat : accMat);
        plate.position.set(0, -LEG_LEN * 0.6, 0.02);
        kneeAttach.add(plate);                   // shin armor rides the lower leg
      }
      // Footwear (index 0 reproduces the legacy foot box exactly) — parented
      // to the shin so feet follow the knee bend.
      const fw = _buildFootwear(footStyle, shoeMat, { LEG_W, LEG_D, LEG_LEN, FOOT_H }, c.shoeColor2 ?? 0);
      if (fw) kneeAttach.add(fw);
      pivot.userData.lower = knee;
      return pivot;
    };
    const leftLeg = mkLeg(-0.18 * bulk);
    const rightLeg = mkLeg(0.18 * bulk);
    body.add(leftLeg);
    body.add(rightLeg);
    // Skirt — a single flared piece around the hips (the legs underneath stay
    // bare skin). Only for the standalone skirt bottom, not a suit.
    if (!suitActive && bottomSpec.legShape === 'skirt') {
      const skirt = new THREE.Mesh(
        new THREE.CylinderGeometry(LEG_W * 2.2, LEG_W * 3.4, 0.55, 16),
        pantsMat
      );
      skirt.position.y = HIP_Y - 0.18;
      skirt.castShadow = true;
      body.add(skirt);
    }

    // Torso. Width/depth widen with `bulk` so a Huge build reads as broad,
    // not just a bigger copy; height stays fixed (overall scale handles tall).
    const TORSO_W = 0.85 * bulk * g.torsoWMul, TORSO_H = 0.75, TORSO_D = 0.45 * bulk;
    // Tapered rounded torso — vertices narrow from 1.0 at the hips to 0.93 at
    // the shoulders. Done once inside the cache factory (shared across rigs).
    const torsoGeo = _sharedGeom(
      `rbTaper:${rnd(TORSO_W)}:${rnd(TORSO_H)}:${rnd(TORSO_D)}:0.1`,
      () => {
        const geo = THREE.RoundedBoxGeometry
          ? new THREE.RoundedBoxGeometry(TORSO_W, TORSO_H, TORSO_D, 3, 0.1)
          : new THREE.BoxGeometry(TORSO_W, TORSO_H, TORSO_D);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const t = (pos.getY(i) / TORSO_H) + 0.5;          // 0 bottom → 1 top
          pos.setX(i, pos.getX(i) * (1 - 0.07 * t));
        }
        pos.needsUpdate = true;
        geo.computeVertexNormals();
        return geo;
      });
    const torso = new THREE.Mesh(torsoGeo, topMat);
    torso.castShadow = true;
    torso.position.y = HIP_Y + TORSO_H / 2;
    body.add(torso);
    // Neck — bridges the small gap between torso top and head bottom.
    const neck = new THREE.Mesh(
      _sharedGeom('neck', () => new THREE.CylinderGeometry(0.10, 0.13, 0.14, 8)),
      skinMat
    );
    neck.position.y = HIP_Y + TORSO_H + 0.02;
    neck.castShadow = true;
    body.add(neck);
    // Top-style detail (collar / hood / pocket / stripe) — torso-local.
    // Suppressed for a suit (the suit builder owns torso detailing).
    if (!suitActive) {
      const topDetail = _buildTopDetail(topStyle, shirtMat, skinMat, { TORSO_W, TORSO_H, TORSO_D }, c.shirtColor2 ?? 0);
      if (topDetail) torso.add(topDetail);
    }

    // Arms (pivot at the shoulder, hangs down).
    const SHOULDER_Y = HIP_Y + TORSO_H - 0.05;
    const ARM_LEN = 0.7;
    const ARM_W = 0.22 * bulk, ARM_D = 0.22 * bulk;

    // Two-segment arms mirroring the legs: shoulder pivot (legacy bone name)
    // + child elbow pivot at mid-arm, capsule segments, sphere hand on the
    // forearm. An attach group on the elbow restores the legacy shoulder-
    // local space for props/gloves so those sub-builders swing with the
    // forearm without coordinate changes.
    const mkArm = (xSign) => {
      const pivot = new THREE.Group();
      pivot.position.set(xSign * (TORSO_W / 2 + ARM_W / 2 - 0.02), SHOULDER_Y, 0);
      const SEG = ARM_LEN / 2;
      const armR = ARM_W / 2;

      const upper = mkCapsule(armR, SEG + armR, skinMat);
      upper.position.y = -SEG / 2;
      pivot.add(upper);

      const elbow = new THREE.Group();
      elbow.position.y = -SEG;
      pivot.add(elbow);
      const fore = mkCapsule(armR, SEG + armR * 0.6, skinMat);
      fore.position.y = -SEG / 2;
      elbow.add(fore);
      const hand = mkSphere(armR * 1.05, skinMat);
      hand.position.y = -SEG;
      elbow.add(hand);
      const elbowAttach = new THREE.Group();
      elbowAttach.position.y = SEG;
      elbow.add(elbowAttach);

      // Sleeve length depends on the top style: 'short' (legacy tee, 0.4),
      // 'long' (long-sleeve/hoodie/turtleneck/suit, 0.95), or 'none' (tank).
      // Short sleeves cover the upper segment only; long sleeves add a
      // forearm capsule that bends with the elbow.
      if (topSpec.sleeve !== 'none') {
        const long = topSpec.sleeve === 'long';
        const upFrac = long ? 1 : 0.8;
        const upSleeve = mkCapsule(armR * 1.12, SEG * upFrac + armR, topMat);
        upSleeve.position.y = -SEG * (upFrac / 2);
        pivot.add(upSleeve);
        if (long) {
          const loSleeve = mkCapsule(armR * 1.12, SEG * 0.9 + armR * 0.5, topMat);
          loSleeve.position.y = -SEG * 0.45;
          elbow.add(loSleeve);
        }
      }
      pivot.userData.lower = elbow;
      pivot.userData.attach = elbowAttach;
      return pivot;
    };
    const leftArm = mkArm(-1);
    const rightArm = mkArm(1);
    body.add(leftArm);
    body.add(rightArm);

    // Gender shaping — parented to bones so it animates. Neutral (g.* all 0)
    // adds nothing → identical to pre-round-2 output.
    if (g.shoulderPad > 0) {
      const pad = mkBox(TORSO_W * 1.18, 0.12, TORSO_D * 1.05, topMat);
      pad.position.y = TORSO_H / 2 - 0.02;
      torso.add(pad);
    }
    if (g.chest > 0) {
      [-1, 1].forEach(s => {
        const b = new THREE.Mesh(new THREE.SphereGeometry(g.chest * bulk, 10, 8), topMat);
        b.position.set(s * TORSO_W * 0.22, TORSO_H * 0.08, TORSO_D / 2);
        b.castShadow = true;
        torso.add(b);
      });
    }
    if (g.hip > 0) {
      const hipPiece = new THREE.Mesh(new THREE.CylinderGeometry(TORSO_W * 0.42, TORSO_W * 0.52, 0.35, 14), legMat);
      hipPiece.position.y = HIP_Y;
      hipPiece.castShadow = true;
      body.add(hipPiece);
    }

    // Head + face.
    const HEAD_SZ = 0.55;
    const head = new THREE.Group();
    head.position.y = HIP_Y + TORSO_H + HEAD_SZ / 2 + 0.02;
    const headBox = mkRounded(HEAD_SZ, HEAD_SZ, HEAD_SZ, 0.13, skinMat);
    head.add(headBox);
    // Eyes — shape varies by eyeShape index. Positive Z is "front".
    const eyeFrontZ = HEAD_SZ / 2 + 0.001;
    const eyeShapeDims = _eyeShapeDims(eyeShapeIdx);
    const leftEye = new THREE.Mesh(
      new THREE.BoxGeometry(eyeShapeDims.w, eyeShapeDims.h, 0.02),
      eyeMat
    );
    leftEye.position.set(-0.12, 0.04, eyeFrontZ);
    leftEye.rotation.z = eyeShapeDims.rot || 0;
    head.add(leftEye);
    const rightEye = new THREE.Mesh(
      new THREE.BoxGeometry(eyeShapeDims.w, eyeShapeDims.h, 0.02),
      eyeMat
    );
    rightEye.position.set(0.12, 0.04, eyeFrontZ);
    rightEye.rotation.z = -(eyeShapeDims.rot || 0);
    head.add(rightEye);
    // Mouth — small dark bar.
    const mouthMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.02), mouthMat);
    mouth.position.set(0, -0.12, HEAD_SZ / 2 + 0.001);
    head.add(mouth);

    // Facial hair — skipped when hidden (a full mask covers the face).
    if (!hidden.facialHairStyle) {
      const beard = _buildFacialHair(beardIdx, beardMat, HEAD_SZ);
      if (beard) head.add(beard);
    }

    // Hair — skipped when hidden (helmet / hood).
    if (!hidden.hairStyle) {
      const hair = _buildHair(styleIdx, hairMat, HEAD_SZ);
      if (hair) head.add(hair);
    }

    // Glasses — skipped when hidden (full mask).
    if (!hidden.glasses) {
      const glasses = _buildGlasses(glassesIdx, HEAD_SZ);
      if (glasses) head.add(glasses);
    }

    // Hat — skipped when hidden (helmet). Cap variant borrows the shirt color.
    if (!hidden.hat) {
      const hat = _buildHat(hatIdx, HEAD_SZ, shirtHex);
      if (hat) head.add(hat);
    }

    body.add(head);

    // Outerwear layer (jacket / coat / vest / cape) — body-local, over the
    // torso. No-op when outerIdx is 0.
    const outerwearGrp = _buildOuterwear(outerIdx, outerMat, { TORSO_W, TORSO_H, TORSO_D, HIP_Y }, c.outerwearColor2 ?? 0);
    if (outerwearGrp) body.add(outerwearGrp);

    // Full-body suit detailing (the base torso/legs/arms are already recolored
    // to the suit color above). No-op when suit is 0.
    if (suitActive) {
      const suitExtra = _buildSuit(suitIdx, suitMat, accMat, { TORSO_W, TORSO_H, TORSO_D, HIP_Y });
      if (suitExtra) body.add(suitExtra);
    }

    // Reusable hero pieces (replaced the old `gear` slot). Helmet → head,
    // emblem → torso (proud of any chest layer), prop → a hand (swings w/ arm).
    const helmetGrp = _buildHelmet(helmetIdx, helmetMat, HEAD_SZ);
    if (helmetGrp) head.add(helmetGrp);
    const emblemGrp = _buildEmblem(emblemIdx, emblemMat, { TORSO_D });
    if (emblemGrp) torso.add(emblemGrp);
    // Props/gloves mount on the elbow attach groups (legacy shoulder-local
    // coordinates preserved) so they swing with the forearm.
    _buildProp(propIdx, propMat, {
      leftArm: leftArm.userData.attach, rightArm: rightArm.userData.attach,
      torso, dims: { ARM_LEN }
    });

    // Accessories (gloves / belt / mask) — mask suppressed when a helmet hides it.
    _buildAccessories({
      head, torso,
      leftArm: leftArm.userData.attach, rightArm: rightArm.userData.attach,
      dims: { HEAD_SZ, TORSO_W, TORSO_H, TORSO_D, ARM_LEN, ARM_W, ARM_D },
      styles: { gloves: c.gloves ?? 0, belt: c.belt ?? 0, mask: hidden.mask ? 0 : (c.mask ?? 0) },
      mat: accMat
    });

    // Build scale — grows the whole figure from the feet (root origin is at
    // foot level, so feet stay planted). Untouched by the tick, which only
    // animates body.scale (breathing) and root position/rotation.
    root.scale.setScalar(buildDef.scale);

    // Default forward: character faces -Z by convention. The engine yaws
    // the root via root.rotation.y to face the movement direction.
    // userData.bones is read both by the local _tick() (via the module-
    // level _rig set by the local-only call sites) and by
    // _tickRemotePlayers() (via the remote rig stored in _remotePlayers).
    root.userData.bones = {
      body, head, torso, leftArm, rightArm, leftLeg, rightLeg,
      // Second limb segments (elbow/knee pivots) for the bending walk cycle.
      leftArmLower: leftArm.userData.lower,
      rightArmLower: rightArm.userData.lower,
      leftLegLower: leftLeg.userData.lower,
      rightLegLower: rightLeg.userData.lower
    };
    return root;
  }

  function _buildHair(styleIdx, mat, headSize) {
    const THREE = window.THREE;
    const grp = new THREE.Group();
    const top = headSize / 2;
    switch (styleIdx) {
      case 0: { // pixie — flat thin cap on crown
        const cap = new THREE.Mesh(new THREE.BoxGeometry(headSize * 1.02, 0.10, headSize * 1.02), mat);
        cap.castShadow = true;
        cap.position.y = top - 0.02;
        grp.add(cap);
        break;
      }
      case 1: { // bob — top + side flaps
        const cap = new THREE.Mesh(new THREE.BoxGeometry(headSize * 1.05, 0.18, headSize * 1.05), mat);
        cap.position.y = top - 0.04;
        cap.castShadow = true;
        grp.add(cap);
        const lflap = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, headSize * 1.0), mat);
        lflap.position.set(-headSize / 2 - 0.02, -0.10, 0);
        lflap.castShadow = true;
        grp.add(lflap);
        const rflap = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, headSize * 1.0), mat);
        rflap.position.set(headSize / 2 + 0.02, -0.10, 0);
        rflap.castShadow = true;
        grp.add(rflap);
        break;
      }
      case 2: { // spiky — four small angled boxes
        for (let i = 0; i < 4; i++) {
          const s = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.22, 0.14), mat);
          s.castShadow = true;
          const ang = (i / 4) * Math.PI * 2;
          s.position.set(Math.cos(ang) * 0.12, top + 0.08, Math.sin(ang) * 0.12);
          s.rotation.set(0.2 * Math.cos(ang), ang, 0.2 * Math.sin(ang));
          grp.add(s);
        }
        break;
      }
      case 3: { // long — top + back rectangle to shoulders
        const cap = new THREE.Mesh(new THREE.BoxGeometry(headSize * 1.05, 0.16, headSize * 1.05), mat);
        cap.position.y = top - 0.03;
        cap.castShadow = true;
        grp.add(cap);
        const back = new THREE.Mesh(new THREE.BoxGeometry(headSize * 1.0, 0.85, 0.10), mat);
        back.position.set(0, -0.35, -headSize / 2 - 0.04);
        back.castShadow = true;
        grp.add(back);
        break;
      }
      case 4:   // bald — nothing
        return null;
      case 5: { // cap — dome + brim
        const dome = new THREE.Mesh(new THREE.BoxGeometry(headSize * 1.05, 0.20, headSize * 1.05), mat);
        dome.position.y = top + 0.02;
        dome.castShadow = true;
        grp.add(dome);
        const brim = new THREE.Mesh(new THREE.BoxGeometry(headSize * 1.4, 0.04, headSize * 0.6), mat);
        brim.position.set(0, top - 0.04, headSize / 2 + 0.04);
        brim.castShadow = true;
        grp.add(brim);
        break;
      }
      case 6: { // ponytail — thin cap + long tied tail hanging behind
        const cap = new THREE.Mesh(new THREE.BoxGeometry(headSize * 1.04, 0.14, headSize * 1.04), mat);
        cap.position.y = top - 0.02;
        cap.castShadow = true;
        grp.add(cap);
        const tail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.55, 0.14), mat);
        tail.position.set(0, -0.10, -headSize / 2 - 0.05);
        tail.castShadow = true;
        grp.add(tail);
        break;
      }
      case 7: { // mohawk — narrow vertical crest down the centerline
        const crest = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.30, headSize * 1.10), mat);
        crest.position.y = top + 0.12;
        crest.castShadow = true;
        grp.add(crest);
        break;
      }
      case 8: { // afro — oversized rounded halo
        const halo = new THREE.Mesh(new THREE.SphereGeometry(headSize * 0.85, 14, 12), mat);
        halo.position.y = top - 0.05;
        halo.castShadow = true;
        grp.add(halo);
        break;
      }
      case 9: { // curly — base cap + scattered ringlet bumps
        const cap = new THREE.Mesh(new THREE.BoxGeometry(headSize * 1.04, 0.12, headSize * 1.04), mat);
        cap.position.y = top - 0.02;
        cap.castShadow = true;
        grp.add(cap);
        const bumps = [
          [ 0.14, 0.04,  0.14], [-0.14, 0.04,  0.14],
          [ 0.14, 0.04, -0.14], [-0.14, 0.04, -0.14],
          [ 0.00, 0.10,  0.00]
        ];
        for (const [px, py, pz] of bumps) {
          const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 8), mat);
          b.position.set(px, top + py, pz);
          b.castShadow = true;
          grp.add(b);
        }
        break;
      }
      case 10: { // buzz — extremely thin cap hugging the crown
        const cap = new THREE.Mesh(new THREE.BoxGeometry(headSize * 1.01, 0.05, headSize * 1.01), mat);
        cap.position.y = top - 0.01;
        cap.castShadow = true;
        grp.add(cap);
        break;
      }
      case 11: { // side-part — asymmetric cap with a swept bang up front
        const cap = new THREE.Mesh(new THREE.BoxGeometry(headSize * 1.04, 0.14, headSize * 1.04), mat);
        cap.position.y = top - 0.02;
        cap.castShadow = true;
        grp.add(cap);
        const sweep = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.10, 0.18), mat);
        sweep.position.set(-headSize * 0.18, top + 0.04, headSize * 0.32);
        sweep.rotation.z = 0.4;
        sweep.castShadow = true;
        grp.add(sweep);
        break;
      }
      case 12: { // topknot — pixie cap + a small bun on top
        const cap = new THREE.Mesh(new THREE.BoxGeometry(headSize * 1.02, 0.10, headSize * 1.02), mat);
        cap.position.y = top - 0.02;
        cap.castShadow = true;
        grp.add(cap);
        const knot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), mat);
        knot.position.y = top + 0.18;
        knot.castShadow = true;
        grp.add(knot);
        break;
      }
      case 13: { // undercut — tall block on top, shaved sides
        const top1 = new THREE.Mesh(new THREE.BoxGeometry(headSize * 0.82, 0.26, headSize * 1.0), mat);
        top1.position.y = top + 0.08;
        top1.castShadow = true;
        grp.add(top1);
        break;
      }
    }
    return grp;
  }

  // Eye-shape index → box width/height (depth stays at 0.02 from the
  // caller). Index 0 is round (0.06×0.06) so existing characters look
  // identical when eyeShape is null/0.
  function _eyeShapeDims(idx) {
    switch (idx) {
      case 1: return { w: 0.12, h: 0.04 };               // narrow / sleepy
      case 2: return { w: 0.10, h: 0.12 };               // wide / expressive
      case 3: return { w: 0.13, h: 0.05, rot: -0.26 };   // sharp / angled
      case 4: return { w: 0.09, h: 0.07 };               // soft / oval
      case 0:
      default: return { w: 0.06, h: 0.06 };              // round (legacy)
    }
  }

  function _buildFacialHair(styleIdx, mat, headSize) {
    const THREE = window.THREE;
    if (!styleIdx) return null;
    const grp = new THREE.Group();
    const front = headSize / 2 + 0.005;
    switch (styleIdx) {
      case 1: { // stubble — thin sheet across the lower face
        const sheet = new THREE.Mesh(new THREE.BoxGeometry(headSize * 0.92, 0.16, 0.02), mat);
        sheet.position.set(0, -0.16, front);
        grp.add(sheet);
        break;
      }
      case 2: { // mustache — small bar above mouth
        const bar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.03), mat);
        bar.position.set(0, -0.08, front);
        grp.add(bar);
        break;
      }
      case 3: { // goatee — small patch below mouth
        const patch = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.10, 0.03), mat);
        patch.position.set(0, -0.20, front);
        grp.add(patch);
        break;
      }
      case 4: { // full beard — wraps chin and jaw
        const front_ = new THREE.Mesh(new THREE.BoxGeometry(headSize * 0.95, 0.22, 0.04), mat);
        front_.position.set(0, -0.18, front);
        grp.add(front_);
        const left = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, headSize * 0.7), mat);
        left.position.set(-headSize / 2 - 0.005, -0.16, 0);
        grp.add(left);
        const right = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, headSize * 0.7), mat);
        right.position.set(headSize / 2 + 0.005, -0.16, 0);
        grp.add(right);
        const stache = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.04), mat);
        stache.position.set(0, -0.08, front);
        grp.add(stache);
        break;
      }
      case 5: { // chinstrap — thin band running jawline
        const left = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, headSize * 0.6), mat);
        left.position.set(-headSize / 2 - 0.005, -0.12, 0);
        grp.add(left);
        const right = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, headSize * 0.6), mat);
        right.position.set(headSize / 2 + 0.005, -0.12, 0);
        grp.add(right);
        const chin = new THREE.Mesh(new THREE.BoxGeometry(headSize * 0.9, 0.05, 0.04), mat);
        chin.position.set(0, -0.22, front);
        grp.add(chin);
        break;
      }
    }
    grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return grp;
  }

  function _buildGlasses(styleIdx, headSize) {
    const THREE = window.THREE;
    if (!styleIdx) return null;
    const frameMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
    const grp = new THREE.Group();
    const z = headSize / 2 + 0.025;
    const xL = -0.12, xR = 0.12, y = 0.04;
    switch (styleIdx) {
      case 1: { // round
        const lensL = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.012, 8, 16), frameMat);
        lensL.position.set(xL, y, z); lensL.rotation.y = 0; grp.add(lensL);
        const lensR = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.012, 8, 16), frameMat);
        lensR.position.set(xR, y, z); grp.add(lensR);
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.015, 0.015), frameMat);
        bridge.position.set(0, y, z); grp.add(bridge);
        break;
      }
      case 2: { // square
        const mkFrame = (x) => {
          const f = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.10, 0.02), frameMat);
          f.position.set(x, y, z);
          return f;
        };
        grp.add(mkFrame(xL));
        grp.add(mkFrame(xR));
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.015, 0.015), frameMat);
        bridge.position.set(0, y, z); grp.add(bridge);
        break;
      }
      case 3: { // aviator — slightly larger teardrops
        const lensMat = new THREE.MeshLambertMaterial({ color: 0x4a6a8a, transparent: true, opacity: 0.6 });
        const mkLens = (x) => {
          const g = new THREE.Group();
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.10, 0.012, 8, 18), frameMat);
          g.add(ring);
          const fill = new THREE.Mesh(new THREE.CircleGeometry(0.09, 18), lensMat);
          g.add(fill);
          g.position.set(x, y - 0.01, z);
          return g;
        };
        grp.add(mkLens(xL));
        grp.add(mkLens(xR));
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.012), frameMat);
        bridge.position.set(0, y + 0.02, z); grp.add(bridge);
        break;
      }
      case 4: { // half-rim — bottom arc only
        const mkBottom = (x) => {
          const arc = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.01, 6, 12, Math.PI), frameMat);
          arc.rotation.z = Math.PI; // open side up
          arc.position.set(x, y, z);
          return arc;
        };
        grp.add(mkBottom(xL));
        grp.add(mkBottom(xR));
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.012), frameMat);
        bridge.position.set(0, y, z); grp.add(bridge);
        break;
      }
    }
    return grp;
  }

  function _buildHat(styleIdx, headSize, shirtHex) {
    const THREE = window.THREE;
    if (!styleIdx) return null;
    const top = headSize / 2;
    const grp = new THREE.Group();
    switch (styleIdx) {
      case 1: { // beanie — knit cap with cuff
        const mat = new THREE.MeshLambertMaterial({ color: 0x3a4a8a });
        const cuffMat = new THREE.MeshLambertMaterial({ color: 0x243466 });
        const cap = new THREE.Mesh(new THREE.SphereGeometry(headSize * 0.62, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat);
        cap.position.y = top;
        cap.castShadow = true;
        grp.add(cap);
        const cuff = new THREE.Mesh(new THREE.CylinderGeometry(headSize * 0.62, headSize * 0.62, 0.10, 16), cuffMat);
        cuff.position.y = top + 0.02;
        cuff.castShadow = true;
        grp.add(cuff);
        break;
      }
      case 2: { // cap — dome + brim, painted with shirt color
        const mat = new THREE.MeshLambertMaterial({ color: shirtHex });
        const dome = new THREE.Mesh(new THREE.SphereGeometry(headSize * 0.60, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat);
        dome.position.y = top;
        dome.castShadow = true;
        grp.add(dome);
        const brim = new THREE.Mesh(new THREE.BoxGeometry(headSize * 1.3, 0.04, headSize * 0.55), mat);
        brim.position.set(0, top - 0.01, headSize * 0.45);
        brim.castShadow = true;
        grp.add(brim);
        break;
      }
      case 3: { // top hat — tall cylinder + thin brim with red band
        const mat = new THREE.MeshLambertMaterial({ color: 0x111111 });
        const bandMat = new THREE.MeshLambertMaterial({ color: 0xa02828 });
        const brim = new THREE.Mesh(new THREE.CylinderGeometry(headSize * 0.80, headSize * 0.80, 0.04, 20), mat);
        brim.position.y = top + 0.02;
        brim.castShadow = true;
        grp.add(brim);
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(headSize * 0.50, headSize * 0.50, 0.55, 20), mat);
        stack.position.y = top + 0.32;
        stack.castShadow = true;
        grp.add(stack);
        const band = new THREE.Mesh(new THREE.CylinderGeometry(headSize * 0.51, headSize * 0.51, 0.06, 20), bandMat);
        band.position.y = top + 0.08;
        band.castShadow = true;
        grp.add(band);
        break;
      }
      case 4: { // hood — cowl around the head, tucked behind
        const mat = new THREE.MeshLambertMaterial({ color: 0x2a2a2a });
        const cowl = new THREE.Mesh(new THREE.SphereGeometry(headSize * 0.78, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2 + 0.3), mat);
        cowl.position.set(0, top - 0.05, -0.05);
        cowl.castShadow = true;
        grp.add(cowl);
        break;
      }
    }
    return grp;
  }

  // ── Gender + reusable hero pieces (replaced the old all-in-one `gear`) ──

  // Gender silhouette spec. Index 0 (Neutral) is unchanged so pre-round-2
  // characters render identically. Applied as a torso-width multiplier plus
  // extra meshes parented to the torso/body bones (so they animate).
  function _genderSpec(idx) {
    switch (idx) {
      case 1: return { torsoWMul: 1.10, shoulderPad: 0.16, chest: 0,    hip: 0    }; // masculine
      case 2: return { torsoWMul: 0.92, shoulderPad: 0,    chest: 0.07, hip: 0.55 }; // feminine
      case 0:
      default: return { torsoWMul: 1.00, shoulderPad: 0,   chest: 0,    hip: 0    }; // neutral
    }
  }

  // Helmet → Group parented to head, or null. Covers hair/hat (enforced by the
  // hide rules upstream). `mat` is the helmet color material.
  function _buildHelmet(idx, mat, headSize) {
    if (!idx) return null;
    const THREE = window.THREE;
    const grp = new THREE.Group();
    const fz = headSize / 2;
    const mkB = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    // Sphere-based helms: the head slot is scaled per axis to the real head,
    // so a sphere here becomes head-shaped on the rigged body (and a slightly
    // rounded cube on the legacy one). Sphere phi runs around Y with +Z (the
    // face) at phi = π/2.
    const R = headSize * 0.56;
    const front = (r, widthRad, thetaStart, thetaLen, m) =>
      new THREE.Mesh(new THREE.SphereGeometry(r, 28, 18, Math.PI / 2 - widthRad / 2, widthRad, thetaStart, thetaLen), m);
    switch (idx) {
      case 1: { // Iron Man — red shell, gold faceplate, glowing eye slits
        const shell = new THREE.Mesh(new THREE.SphereGeometry(R * 1.02, 28, 20), mat);
        shell.scale.set(1, 1.08, 1.04); grp.add(shell);
        const gold = _gearMat(0xd9a420, { metal: 0.85, rough: 0.3 });
        const face = front(R * 1.03, Math.PI * 0.5, Math.PI * 0.3, Math.PI * 0.46, gold);
        face.scale.set(1, 1.08, 1.04); grp.add(face);
        // Cheek ridges and the chin line frame the plate.
        [-1, 1].forEach(s => {
          const ridge = mkB(0.035, 0.2, 0.03, gold);
          ridge.position.set(s * headSize * 0.33, -0.02, R * 0.92); ridge.rotation.y = s * 0.45; grp.add(ridge);
        });
        const chin = mkB(headSize * 0.42, 0.045, 0.03, gold);
        chin.position.set(0, -headSize * 0.36, R * 0.9); grp.add(chin);
        [-0.1, 0.1].forEach(x => {
          const eye = mkB(0.11, 0.04, 0.03, _gearMat(0xbff4ff, { emissive: 0x9fe6ff, emissiveIntensity: 1.6 }));
          eye.position.set(x, 0.06, R * 1.02); eye.rotation.y = x > 0 ? -0.25 : 0.25; grp.add(eye);
        });
        const mouth = mkB(0.12, 0.018, 0.02, _gearMat(0x3a2408, { metal: 0.6, rough: 0.5 }));
        mouth.position.set(0, -0.11, R * 1.04); grp.add(mouth);
        break;
      }
      case 2: { // cowl — crown + sides, open face
        const cowl = mkB(headSize * 1.06, headSize * 0.66, headSize * 1.06, mat);
        cowl.position.set(0, headSize * 0.2, -0.02); grp.add(cowl);
        [-1, 1].forEach(s => {
          const side = mkB(headSize * 0.18, headSize * 0.7, headSize * 1.04, mat);
          side.position.set(s * headSize * 0.46, -headSize * 0.05, 0); grp.add(side);
        });
        break;
      }
      case 3: { // winged — skullcap + side wings
        const cap = mkB(headSize * 1.06, headSize * 0.5, headSize * 1.06, mat);
        cap.position.y = headSize * 0.3; grp.add(cap);
        [-1, 1].forEach(s => {
          const wing = mkB(0.04, 0.22, 0.12, _gearMat(0xd8dce4));
          wing.position.set(s * headSize * 0.6, headSize * 0.42, 0);
          wing.rotation.z = s * 0.5; grp.add(wing);
        });
        break;
      }
      case 4: { // knight — full helm + dark visor slit
        grp.add(mkB(headSize * 1.08, headSize * 1.08, headSize * 1.08, mat));
        const visor = mkB(headSize * 0.8, 0.06, 0.03, _gearMat(0x111111));
        visor.position.set(0, 0.04, fz + 0.04); grp.add(visor);
        break;
      }
      case 5: { // visor — skullcap + tinted band over the eyes
        const cap = mkB(headSize * 1.06, headSize * 0.5, headSize * 1.06, mat);
        cap.position.y = headSize * 0.3; grp.add(cap);
        const visor = mkB(headSize * 1.02, 0.16, 0.05, _gearMat(0x28435a));
        visor.position.set(0, 0.05, fz + 0.03); grp.add(visor);
        break;
      }
      case 6: { // soldier — rounded helm open at the face + white "A" + temple wings (WWII Cap)
        const white = _gearMat(0xf0f0f0, { metal: 0.2, rough: 0.5 });
        // Dome over the crown, then a band round the back and sides that
        // stops ±45° either side of the face, so the eyes and mouth show.
        const dome = new THREE.Mesh(new THREE.SphereGeometry(R * 1.05, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), mat);
        dome.scale.set(1, 1.02, 1.04); grp.add(dome);
        const band = new THREE.Mesh(new THREE.SphereGeometry(R * 1.05, 28, 10, Math.PI * 0.75, Math.PI * 1.5, Math.PI * 0.5, Math.PI * 0.3), mat);
        band.scale.set(1, 1.02, 1.04); grp.add(band);
        [-1, 1].forEach(s => {                    // ear flaps, leaving the face open
          const side = mkB(headSize * 0.1, headSize * 0.34, headSize * 0.42, mat);
          side.position.set(s * R * 1.0, -headSize * 0.1, -0.02); grp.add(side);
        });
        const zA = R * 1.02;
        const aLeft = mkB(0.035, 0.17, 0.02, white);  aLeft.position.set(-0.035, 0.15, zA);  aLeft.rotation.z = -0.3; grp.add(aLeft);
        const aRight = mkB(0.035, 0.17, 0.02, white); aRight.position.set(0.035, 0.15, zA);  aRight.rotation.z = 0.3;  grp.add(aRight);
        const aBar = mkB(0.085, 0.03, 0.02, white);   aBar.position.set(0, 0.12, zA + 0.005); grp.add(aBar);
        [-1, 1].forEach(s => {                    // swept-back temple wings
          const wing = mkB(0.15, 0.08, 0.02, white);
          wing.position.set(s * R * 1.02, headSize * 0.14, 0.05);
          wing.rotation.z = s * 0.3; wing.rotation.y = s * 0.5; grp.add(wing);
        });
        break;
      }
    }
    grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return grp;
  }

  // Held prop — attached to a HAND (the end of an arm pivot) so it swings with
  // the walk cycle. No-op for index 0. `mat` is the prop color material.
  // The hand hangs at local y = -ARM_LEN; each prop is gripped there and given
  // a natural orientation (the bow lies in the FRONTAL plane facing forward,
  // not wrapped around the body; blades/handles tilt slightly forward so they
  // read as wielded rather than dangling at the side).
  function _buildProp(idx, mat, ctx) {
    if (!idx) return;
    const THREE = window.THREE;
    const { leftArm, rightArm, dims } = ctx;
    const { ARM_LEN } = dims;
    const handY = -ARM_LEN;
    const metal = () => _gearMat(0xc9ccd4, _METAL);
    const grp = new THREE.Group();
    // Held items (staffs, bows) can reach above the head — keep them out of the
    // body-height measurement the customizer uses to frame body regions.
    grp.userData.noFrame = true;
    let arm = rightArm;
    // Recurve bow: two limbs sweeping forward at the tips, a leather grip and
    // a string between the tips. Lies in the frontal plane, tips toward +Z.
    const buildBow = () => {
      const limb = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, -0.46, 0.06), new THREE.Vector3(-0.015, -0.36, 0.13), new THREE.Vector3(0, -0.18, 0.06),
        new THREE.Vector3(0, 0, 0.02),
        new THREE.Vector3(0, 0.18, 0.06), new THREE.Vector3(-0.015, 0.36, 0.13), new THREE.Vector3(0, 0.46, 0.06)
      ]);
      grp.add(new THREE.Mesh(new THREE.TubeGeometry(limb, 36, 0.014, 7, false), mat));
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.13, 10), _gearMat(0x2a1a10, { rough: 0.9 }));
      grip.position.z = 0.02; grp.add(grip);
      const string = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.9, 0.007), _gearMat(0xdddddd, { rough: 0.8 }));
      string.position.z = -0.01; grp.add(string);
    };
    switch (idx) {
      case 1: { // shield — strapped to the left forearm, facing forward
        arm = leftArm;
        const white = _gearMat(0xf0f0f0, _METAL);
        const blue = _gearMat(0x2a4a9a, _METAL);
        // Concentric rings, each a hair prouder than the last, then the star.
        const ring = (r, h, m) => { const d = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 32), m); d.rotation.x = Math.PI / 2; grp.add(d); };
        ring(0.34, 0.05, mat);
        ring(0.265, 0.056, white);
        ring(0.19, 0.062, mat);
        ring(0.115, 0.068, blue);
        const star = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.02, 5), white);
        star.rotation.x = Math.PI / 2; star.rotation.y = Math.PI; star.position.z = 0.04; grp.add(star);
        // Forearm straps behind the disc.
        [-0.06, 0.06].forEach(y => {
          const strap = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.05), _gearMat(0x5a3a22, { rough: 0.9 }));
          strap.position.set(0, y, -0.04); grp.add(strap);
        });
        grp.position.set(0, handY + 0.12, 0.2);
        break;
      }
      case 2: { // Mjolnir — squat bevelled head, leather-wrapped handle, strap loop
        const leather = _gearMat(0x4a2e1a, { rough: 0.9 });
        const wrap = _gearMat(0x7a5230, { rough: 0.85 });
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.44, 12), leather);
        handle.position.y = -0.1; grp.add(handle);
        [-0.02, 0.0, 0.02, 0.04, 0.06].forEach(y => {
          const band = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.007, 6, 14), wrap);
          band.rotation.x = Math.PI / 2; band.position.y = y - 0.1; grp.add(band);
        });
        const loop = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 14), leather);
        loop.position.y = 0.14; grp.add(loop);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.2), metal());
        head.position.y = -0.38; grp.add(head);
        const bevel = new THREE.Mesh(new THREE.BoxGeometry(0.365, 0.16, 0.16), metal());
        bevel.position.y = -0.38; grp.add(bevel);
        const bevel2 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.215, 0.215), metal());
        bevel2.position.y = -0.38; grp.add(bevel2);
        grp.position.set(0.02, handY + 0.06, 0.14);
        grp.rotation.x = -0.3;
        break;
      }
      case 3: { // bow — held vertically in the left hand, FACING FORWARD
        arm = leftArm;
        buildBow();
        grp.position.set(-0.03, handY, 0.26);
        break;
      }
      case 4: { // sword — blade up, gripped, tilted forward
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.55, 0.03), metal());
        blade.position.y = 0.3; grp.add(blade);
        const guard = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.06), mat);
        guard.position.y = 0.02; grp.add(guard);
        const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.05), _gearMat(0x3a2a1a));
        grip.position.y = -0.06; grp.add(grip);
        grp.position.set(0, handY + 0.04, 0.12);
        grp.rotation.x = -0.25;
        break;
      }
      case 5: { // staff — vertical, gripped at the side, slight forward tilt
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 10), mat);
        grp.add(shaft);
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), _gearMat(0xd9a420));
        orb.position.y = 0.55; grp.add(orb);
        grp.position.set(0, handY + 0.2, 0.12);
        grp.rotation.x = -0.12;
        break;
      }
      case 6: { // bow + quiver — bow in the left hand, a quiver of arrows on the back
        arm = leftArm;
        buildBow();
        grp.position.set(-0.03, handY, 0.26);
        // Quiver — parented to the torso/back so it rides the body, not the arm.
        if (ctx.torso) {
          const q = new THREE.Group();
          q.add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.5, 12), _gearMat(0x5a3a22, { rough: 0.9 })));
          const shaftMat = _gearMat(0xcfcfcf, { rough: 0.7 });
          const headMat = _gearMat(0xd9a420, _METAL);
          [-0.03, 0.03].forEach(x => {
            const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.28, 6), shaftMat);
            sh.position.set(x, 0.34, 0); q.add(sh);
            const tip = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.06, 8), headMat);
            tip.position.set(x, 0.5, 0); q.add(tip);
          });
          q.position.set(-0.18, 0.1, -0.28);   // upper-left of the back
          q.rotation.z = 0.35;
          q.traverse(o => { if (o.isMesh) o.castShadow = true; });
          ctx.torso.add(q);
        }
        break;
      }
    }
    grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
    arm.add(grp);
  }

  // Chest emblem → Group parented to torso, drawn proud of any jacket / suit
  // chest layer so it stays visible. No-op for index 0.
  function _buildEmblem(idx, mat, d) {
    if (!idx) return null;
    const THREE = window.THREE;
    const { TORSO_D } = d;
    const fz = TORSO_D / 2 + 0.14;       // proud of jacket/armor chest layers
    const grp = new THREE.Group();
    switch (idx) {
      case 1: { // star
        const star = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 5), mat);
        star.rotation.x = Math.PI / 2; grp.add(star);
        break;
      }
      case 2: { // arc reactor — recessed steel housing, glowing ring + white-hot core
        const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.025, 24), _gearMat(0x8a8f99, _METAL));
        housing.rotation.x = Math.PI / 2; housing.position.z = -0.01; grp.add(housing);
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.03, 24), _gearMat(0x9fe6ff, { emissive: 0x6fd0e6, emissiveIntensity: 1.6, rough: 0.3 }));
        ring.rotation.x = Math.PI / 2; grp.add(ring);
        const core = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 18), _gearMat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 2.2 }));
        core.rotation.x = Math.PI / 2; grp.add(core);
        break;
      }
      case 3: { // lightning bolt
        const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.02), mat); b1.position.set(0.02, 0.06, 0); b1.rotation.z = 0.5; grp.add(b1);
        const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.02), mat); b2.position.set(-0.02, -0.06, 0); b2.rotation.z = 0.5; grp.add(b2);
        break;
      }
      case 4: { // spider — body + radiating legs
        grp.add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), mat));
        for (let i = 0; i < 4; i++) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.02), mat);
          leg.rotation.z = (i - 1.5) * 0.45; grp.add(leg);
        }
        break;
      }
      case 5: { // badge — rounded plate
        grp.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.03), mat));
        break;
      }
      case 6: { // soldier flag — white chest star + red/white abdomen stripes (WWII Cap)
        const white = _gearMat(0xf0f0f0);
        const red = _gearMat(0xc62a2a);
        const star = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.02, 5), white);
        star.rotation.x = Math.PI / 2; star.position.y = 0.14; grp.add(star);
        [red, white, red, white, red].forEach((m, i) => {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.26, 0.02), m);
          bar.position.set((i - 2) * 0.042, -0.13, 0); grp.add(bar);
        });
        break;
      }
      case 7: { // discs — Thor's silver chest discs in a 3-2 cluster (hardcoded silver)
        const silver = _gearMat(0xc9ccd4);
        const disc = (x, y) => {
          const d2 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.025, 16), silver);
          d2.rotation.x = Math.PI / 2; d2.position.set(x, y, 0); grp.add(d2);
        };
        disc(-0.14, 0.07); disc(0, 0.07); disc(0.14, 0.07);
        disc(-0.07, -0.05); disc(0.07, -0.05);
        break;
      }
    }
    grp.position.set(0, 0.06, fz);
    grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return grp;
  }

  // ── clothing-shape builders ───────────────────────────────────────────
  // Two data-only spec helpers (consulted by the base leg/arm meshes) + five
  // geometry builders following the established conventions: _buildTopDetail/
  // _buildFootwear/_buildOuterwear/_buildSuit return a Group-or-null (like
  // _buildHair/_buildHat); _buildAccessories attaches to multiple anchors
  // (like _buildGear). idx -1 means "suppressed by a suit".

  // Sleeve length for the arm overlay. Index 0 = legacy short sleeve.
  function _topSpec(idx) {
    switch (idx) {
      case -1: return { sleeve: 'long' };   // suit owns the arms
      case 1:  return { sleeve: 'none' };   // tank
      case 8:  return { sleeve: 'none' };   // ripped — bare arms
      case 2:  return { sleeve: 'long' };   // long sleeve
      case 3:  return { sleeve: 'long' };   // hoodie
      case 6:  return { sleeve: 'long' };   // turtleneck
      case 0:                                // tee (legacy)
      case 4:                                // polo
      case 5:                                // v-neck
      case 7:                                // jersey
      default: return { sleeve: 'short' };
    }
  }

  // Leg silhouette. Index 0 = legacy full-length pants.
  function _bottomSpec(idx) {
    switch (idx) {
      case 1:  return { legShape: 'slim' };
      case 2:  return { legShape: 'cargo' };
      case 3:  return { legShape: 'shorts' };
      case 4:  return { legShape: 'skirt' };
      case 5:  return { legShape: 'joggers' };
      case 6:  return { legShape: 'greaves' };
      case -1:                               // suit (recolored plain legs)
      case 0:                                // pants (legacy)
      default: return { legShape: 'pants' };
    }
  }

  // Torso-local detail group, or null. `mat` is the shirt material, `skinMat`
  // exposes cut-outs (tank shoulders / v-neck).
  function _buildTopDetail(idx, mat, skinMat, d, accentField) {
    const THREE = window.THREE;
    const { TORSO_W, TORSO_H, TORSO_D } = d;
    const fz = TORSO_D / 2 + 0.005;
    // Accent (secondary) color — Auto (field 0) → each detail's built-in default.
    const accInt = (accentField > 0) ? _palette('SHIRT_COLORS', accentField - 1) : null;
    const accMat = (accInt != null) ? new THREE.MeshLambertMaterial({ color: accInt }) : null;
    const grp = new THREE.Group();
    const mkB = (w, h, dep, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, dep), m);
    switch (idx) {
      case 1: { // tank — bare (skin) shoulders over the shirt
        [-1, 1].forEach(s => {
          const sh = mkB(TORSO_W * 0.28, TORSO_H * 0.42, TORSO_D * 1.02, skinMat);
          sh.position.set(s * TORSO_W * 0.36, TORSO_H * 0.27, 0);
          grp.add(sh);
        });
        break;
      }
      case 3: { // hoodie — front pocket (accent or darker shade) + hood
        const dark = accMat || new THREE.MeshLambertMaterial({ color: mat.color.clone().multiplyScalar(0.78) });
        const pocket = mkB(TORSO_W * 0.6, TORSO_H * 0.26, 0.04, dark);
        pocket.position.set(0, -TORSO_H * 0.18, fz);
        grp.add(pocket);
        const hood = mkB(TORSO_W * 0.7, TORSO_H * 0.26, TORSO_D * 0.6, mat);
        hood.position.set(0, TORSO_H * 0.5, -TORSO_D * 0.35);
        grp.add(hood);
        break;
      }
      case 4: { // polo — collar wings (accent-tinted) + bow tie when an accent is chosen
        const cMat = accMat || mat;
        [-1, 1].forEach(s => {
          const cw = mkB(TORSO_W * 0.24, TORSO_H * 0.14, 0.04, cMat);
          cw.position.set(s * TORSO_W * 0.12, TORSO_H * 0.42, fz);
          cw.rotation.z = s * 0.4;
          grp.add(cw);
        });
        if (accMat) {
          [-1, 1].forEach(s => {
            const bt = mkB(0.1, 0.07, 0.04, accMat);
            bt.position.set(s * 0.05, TORSO_H * 0.3, fz + 0.01);
            bt.rotation.z = s * 0.6;
            grp.add(bt);
          });
        }
        break;
      }
      case 5: { // v-neck — skin V at the collar
        const v = mkB(TORSO_W * 0.2, TORSO_H * 0.22, 0.05, skinMat);
        v.position.set(0, TORSO_H * 0.36, fz);
        v.rotation.z = Math.PI / 4;
        grp.add(v);
        break;
      }
      case 6: { // turtleneck — collar ring at the neck
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(TORSO_W * 0.3, TORSO_W * 0.3, 0.16, 12), mat);
        collar.position.set(0, TORSO_H * 0.52, 0);
        grp.add(collar);
        break;
      }
      case 7: { // jersey — chest stripe (accent or white)
        const stripe = mkB(TORSO_W * 1.01, TORSO_H * 0.16, 0.02, accMat || new THREE.MeshLambertMaterial({ color: 0xffffff }));
        stripe.position.set(0, 0, fz);
        grp.add(stripe);
        break;
      }
      case 8: { // ripped — tattered cloth remnants clinging to a bare (skin) chest
        const fzz = TORSO_D / 2 + 0.005;
        // Torn shoulder flaps — thin, angled panels on the front + back (not
        // full-depth blocks), so they read as hanging cloth, not pauldrons.
        [-1, 1].forEach(s => {
          [fzz, -fzz].forEach(z => {
            const flap = mkB(TORSO_W * 0.2, TORSO_H * 0.42, 0.04, mat);
            flap.position.set(s * TORSO_W * 0.26, TORSO_H * 0.1, z);
            flap.rotation.z = s * 0.4;
            grp.add(flap);
          });
        });
        // Ragged hem — three uneven tabs hanging off the front waist (a broken
        // shirt bottom), instead of a solid wrap-around band.
        [-0.3, 0.0, 0.3].forEach((x, i) => {
          const h = TORSO_H * (i === 1 ? 0.14 : 0.24);
          const tab = mkB(TORSO_W * 0.22, h, 0.05, mat);
          tab.position.set(x * TORSO_W, -TORSO_H * 0.32 - (TORSO_H * 0.24 - h) / 2, fzz);
          grp.add(tab);
        });
        break;
      }
      default: return null; // 0 tee, 2 long sleeve — no torso detail
    }
    grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return grp;
  }

  // Footwear group (added to a leg pivot). Index 0 reproduces the legacy foot.
  function _buildFootwear(idx, mat, d, accentField) {
    const THREE = window.THREE;
    const { LEG_W, LEG_D, LEG_LEN, FOOT_H } = d;
    const baseY = -LEG_LEN + FOOT_H / 2;
    const accInt = (accentField > 0) ? _palette('SHOE_COLORS', accentField - 1) : null;
    const grp = new THREE.Group();
    const mkB = (w, h, dep, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, dep), m);
    switch (idx) {
      case 1: { // sneakers — foot + sole (accent or white)
        const foot = mkB(LEG_W * 1.7, FOOT_H, LEG_D * 1.6, mat);
        foot.position.set(0, baseY, 0.06); grp.add(foot);
        const sole = mkB(LEG_W * 1.75, FOOT_H * 0.4, LEG_D * 1.65, new THREE.MeshLambertMaterial({ color: accInt != null ? accInt : 0xf0f0f0 }));
        sole.position.set(0, -LEG_LEN + FOOT_H * 0.2, 0.06); grp.add(sole);
        break;
      }
      case 2: { // hi-tops — foot + ankle collar
        const foot = mkB(LEG_W * 1.6, FOOT_H, LEG_D * 1.5, mat);
        foot.position.set(0, baseY, 0.05); grp.add(foot);
        const collar = mkB(LEG_W * 1.2, 0.18, LEG_D * 1.2, mat);
        collar.position.set(0, -LEG_LEN + 0.22, 0); grp.add(collar);
        break;
      }
      case 3: { // boots — foot + tall shaft (+ accent cuff when chosen)
        const foot = mkB(LEG_W * 1.6, FOOT_H, LEG_D * 1.55, mat);
        foot.position.set(0, baseY, 0.06); grp.add(foot);
        const shaft = mkB(LEG_W * 1.25, 0.4, LEG_D * 1.25, mat);
        shaft.position.set(0, -LEG_LEN + 0.3, 0); grp.add(shaft);
        if (accInt != null) {
          const cuff = mkB(LEG_W * 1.3, 0.1, LEG_D * 1.3, new THREE.MeshLambertMaterial({ color: accInt }));
          cuff.position.set(0, -LEG_LEN + 0.48, 0); grp.add(cuff);
        }
        break;
      }
      case 4: { // dress — slim, longer toe
        const foot = mkB(LEG_W * 1.5, FOOT_H * 0.85, LEG_D * 1.85, mat);
        foot.position.set(0, baseY, 0.1); grp.add(foot);
        break;
      }
      case 5: { // heels — slim foot + heel nub
        const foot = mkB(LEG_W * 1.4, FOOT_H * 0.7, LEG_D * 1.7, mat);
        foot.position.set(0, baseY, 0.07); grp.add(foot);
        const heel = mkB(LEG_W * 0.4, FOOT_H * 1.3, LEG_D * 0.4, mat);
        heel.position.set(0, -LEG_LEN - FOOT_H * 0.35, -LEG_D * 0.55); grp.add(heel);
        break;
      }
      case 6: { // sandals — flat sole + strap
        const sole = mkB(LEG_W * 1.6, FOOT_H * 0.5, LEG_D * 1.6, mat);
        sole.position.set(0, -LEG_LEN + FOOT_H * 0.25, 0.06); grp.add(sole);
        const strap = mkB(LEG_W * 1.3, 0.05, LEG_D * 0.4, mat);
        strap.position.set(0, baseY + 0.02, 0.1); grp.add(strap);
        break;
      }
      default: { // 0 — legacy foot box (LEG_W*1.6 × FOOT_H × LEG_D*1.4 @ +0.05z)
        const foot = mkB(LEG_W * 1.6, FOOT_H, LEG_D * 1.4, mat);
        foot.position.set(0, baseY, 0.05); grp.add(foot);
      }
    }
    grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return grp;
  }

  // Outerwear layer (body-local), or null for index 0.
  function _buildOuterwear(idx, mat, d, accentField) {
    if (!idx) return null;
    const THREE = window.THREE;
    const { TORSO_W, TORSO_H, TORSO_D, HIP_Y } = d;
    const cy = HIP_Y + TORSO_H / 2;            // torso center in body space
    const fz = TORSO_D / 2 + 0.06;
    const grp = new THREE.Group();
    const mkB = (w, h, dep, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, dep), m);
    // Seam/lining accent — Auto (field 0) → today's near-black seam.
    const seamInt = (accentField > 0) ? _palette('SHIRT_COLORS', accentField - 1) : 0x111111;
    const seamMat = new THREE.MeshLambertMaterial({ color: seamInt });
    switch (idx) {
      case 1: case 2: { // jacket / bomber — shell + open-front seam
        const shell = mkB(TORSO_W * 1.12, TORSO_H * 1.04, TORSO_D * 1.12, mat);
        shell.position.y = cy; grp.add(shell);
        const seam = mkB(0.05, TORSO_H * 1.0, 0.02, seamMat);
        seam.position.set(0, cy, fz); grp.add(seam);
        if (idx === 2) { // bomber — ribbed hem
          const hem = mkB(TORSO_W * 1.14, 0.1, TORSO_D * 1.14, mat);
          hem.position.y = cy - TORSO_H * 0.52; grp.add(hem);
        }
        break;
      }
      case 3: { // trench coat — shell + long skirt below the torso
        const shell = mkB(TORSO_W * 1.12, TORSO_H * 1.04, TORSO_D * 1.12, mat);
        shell.position.y = cy; grp.add(shell);
        const skirt = mkB(TORSO_W * 1.12, TORSO_H * 0.95, TORSO_D * 1.12, mat);
        skirt.position.y = HIP_Y - TORSO_H * 0.38; grp.add(skirt);
        const seam = mkB(0.05, TORSO_H * 1.9, 0.02, seamMat);
        seam.position.set(0, cy - TORSO_H * 0.4, fz); grp.add(seam);
        break;
      }
      case 4: { // hooded jacket — shell + hood behind the head
        const shell = mkB(TORSO_W * 1.12, TORSO_H * 1.02, TORSO_D * 1.12, mat);
        shell.position.y = cy; grp.add(shell);
        const hood = mkB(TORSO_W * 0.82, TORSO_H * 0.42, TORSO_D * 0.72, mat);
        hood.position.set(0, HIP_Y + TORSO_H + 0.06, -TORSO_D * 0.4); grp.add(hood);
        break;
      }
      case 5: { // vest — shorter sleeveless shell + seam
        const shell = mkB(TORSO_W * 1.1, TORSO_H * 0.95, TORSO_D * 1.1, mat);
        shell.position.y = cy; grp.add(shell);
        const seam = mkB(0.05, TORSO_H * 0.9, 0.02, seamMat);
        seam.position.set(0, cy, fz); grp.add(seam);
        break;
      }
      case 6: { // cape — flat plane behind, hanging to the legs
        const cape = mkB(TORSO_W * 1.15, TORSO_H + 0.7, 0.04, mat);
        cape.position.set(0, cy - 0.25, -TORSO_D / 2 - 0.05); grp.add(cape);
        break;
      }
    }
    grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return grp;
  }

  // Full-body suit detailing (body-local), or null for index 0. The base
  // torso/legs/arms are already recolored to the suit color by _buildPlayer.
  function _buildSuit(idx, mat, accMat, d) {
    if (!idx) return null;
    const THREE = window.THREE;
    const { TORSO_W, TORSO_H, TORSO_D, HIP_Y } = d;
    const cy = HIP_Y + TORSO_H / 2;
    const fz = TORSO_D / 2 + 0.01;
    const grp = new THREE.Group();
    const mkB = (w, h, dep, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, dep), m);
    switch (idx) {
      case 1: { // bodysuit — accent chest seam + waist belt
        const seam = mkB(0.05, TORSO_H * 0.9, 0.02, accMat);
        seam.position.set(0, cy, fz); grp.add(seam);
        const belt = mkB(TORSO_W * 1.04, 0.1, TORSO_D * 1.04, accMat);
        belt.position.y = HIP_Y + 0.02; grp.add(belt);
        break;
      }
      case 2: { // dress — flared skirt from the waist
        const skirt = new THREE.Mesh(new THREE.CylinderGeometry(TORSO_W * 0.5, TORSO_W * 0.95, 0.7, 16), mat);
        skirt.position.y = HIP_Y - 0.15; grp.add(skirt);
        break;
      }
      case 3: { // robe — long front panel + skirt
        const panel = mkB(TORSO_W * 0.4, TORSO_H + 0.7, 0.04, accMat);
        panel.position.set(0, cy - 0.3, fz); grp.add(panel);
        const skirt = new THREE.Mesh(new THREE.CylinderGeometry(TORSO_W * 0.55, TORSO_W * 0.82, 0.8, 14), mat);
        skirt.position.y = HIP_Y - 0.2; grp.add(skirt);
        break;
      }
      case 4: { // armor — chest plate + shoulder pads
        const plate = mkB(TORSO_W * 1.05, TORSO_H * 0.7, TORSO_D * 1.08, accMat);
        plate.position.set(0, cy + TORSO_H * 0.05, 0); grp.add(plate);
        [-1, 1].forEach(s => {
          const pad = new THREE.Mesh(new THREE.SphereGeometry(TORSO_W * 0.28, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), accMat);
          pad.position.set(s * TORSO_W * 0.5, cy + TORSO_H * 0.42, 0); grp.add(pad);
        });
        break;
      }
      case 5: { // jumpsuit — collar + waist accent
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(TORSO_W * 0.3, TORSO_W * 0.32, 0.12, 12), accMat);
        collar.position.y = cy + TORSO_H * 0.5; grp.add(collar);
        const belt = mkB(TORSO_W * 1.04, 0.08, TORSO_D * 1.04, accMat);
        belt.position.y = HIP_Y + 0.02; grp.add(belt);
        break;
      }
    }
    grp.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return grp;
  }

  // Accessories — attach gloves to arms, belt to torso, mask to head. Mirrors
  // the _buildGear attach-and-track pattern. No-op when all styles are 0.
  function _buildAccessories(ctx) {
    const THREE = window.THREE;
    const { head, torso, leftArm, rightArm, dims, styles, mat } = ctx;
    const { HEAD_SZ, TORSO_W, TORSO_H, TORSO_D, ARM_LEN, ARM_W, ARM_D } = dims;
    const { gloves, belt, mask } = styles;
    if (!gloves && !belt && !mask) return;
    const added = [];
    const mkB = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    const add = (parent, mesh) => { parent.add(mesh); added.push(mesh); return mesh; };

    if (gloves) {
      const len = gloves === 3 ? 0.32 : (gloves === 2 ? 0.22 : 0.12); // gauntlet / full / fingerless
      [leftArm, rightArm].forEach(a => {
        const g = mkB(ARM_W * 1.08, len, ARM_D * 1.08, mat);
        g.position.y = -ARM_LEN + len / 2;
        add(a, g);
      });
    }

    if (belt) {
      if (belt === 3) { // sash — diagonal across the chest
        const sash = mkB(TORSO_W * 1.4, 0.12, 0.04, mat);
        sash.position.set(0, 0, TORSO_D / 2 + 0.01);
        sash.rotation.z = 0.5;
        add(torso, sash);
      } else {          // belt / utility / widow
        const b = mkB(TORSO_W * 1.04, 0.12, TORSO_D * 1.04, mat);
        b.position.y = -TORSO_H / 2 + 0.04;
        add(torso, b);
        if (belt === 2) { // utility — gold buckle
          const buckle = mkB(0.14, 0.1, 0.03, _gearMat(0xd9a420, _METAL));
          buckle.position.set(0, -TORSO_H / 2 + 0.04, TORSO_D / 2 + 0.02);
          add(torso, buckle);
        } else if (belt === 4) { // widow — black disc with a red hourglass
          const y = -TORSO_H / 2 + 0.04, z = TORSO_D / 2 + 0.02;
          const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.03, 20), _gearMat(0x151515, { metal: 0.5, rough: 0.4 }));
          disc.rotation.x = Math.PI / 2; disc.position.set(0, y, z); add(torso, disc);
          const red = _gearMat(0xe23636, { rough: 0.45 });
          const top = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.042, 12), red);
          top.rotation.x = Math.PI; top.position.set(0, y + 0.022, z + 0.02); add(torso, top);
          const bottom = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.042, 12), red);
          bottom.position.set(0, y - 0.022, z + 0.02); add(torso, bottom);
        }
      }
    }

    if (mask) {
      const fz = HEAD_SZ / 2 + 0.012;
      switch (mask) {
        case 1: { const band = mkB(HEAD_SZ * 0.96, 0.14, 0.04, mat); band.position.set(0, 0.06, fz); add(head, band); break; }       // domino
        case 2: { const full = mkB(HEAD_SZ * 1.02, HEAD_SZ * 0.72, 0.05, mat); full.position.set(0, 0, fz); add(head, full); break; } // full mask
        case 3: { const visor = mkB(HEAD_SZ * 1.0, 0.1, 0.06, new THREE.MeshLambertMaterial({ color: mat.color, emissive: 0x113344 })); visor.position.set(0, 0.06, fz); add(head, visor); break; } // visor
        case 4: { const band = mkB(HEAD_SZ * 1.0, HEAD_SZ * 0.34, 0.04, mat); band.position.set(0, -0.14, fz); add(head, band); break; } // bandana
      }
    }

    added.forEach(p => p.traverse(o => { if (o.isMesh) o.castShadow = true; }));
  }

  function _palette(name, idx) {
    const arr = (typeof Playground !== 'undefined') ? Playground[name] : null;
    if (!arr) return 0xffffff;
    const v = arr[idx ?? 0] || arr[0];
    // Convert "#rrggbb" to int.
    return parseInt(v.replace('#', ''), 16);
  }

  root.PG3DAvatar = {
    sharedGeom: _sharedGeom, gearMat: _gearMat, METAL: _METAL, palette: _palette,
    buildBoxPlayer: _buildBoxPlayer, buildProceduralPlayer: _buildProceduralPlayer,
    buildHair: _buildHair, buildFacialHair: _buildFacialHair, buildGlasses: _buildGlasses,
    buildHat: _buildHat, buildHelmet: _buildHelmet, buildProp: _buildProp, buildEmblem: _buildEmblem,
    buildTopDetail: _buildTopDetail, buildFootwear: _buildFootwear, buildOuterwear: _buildOuterwear,
    buildSuit: _buildSuit, buildAccessories: _buildAccessories
  };
})(typeof self !== 'undefined' ? self : this);
