/************************************************
 * Unit tests for js/playground3d-humanoid-logic.js — body shapes, skeleton
 * classification, animation-state selection, LOD tiers and slot coverage for
 * the realistic (rigged glTF) characters.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('../js/playground3d-humanoid-logic.js');

const [SLIM, NORMAL, LARGE, HUGE] = [0, 1, 2, 3];

// ── Body shapes ──

test('bodyShapeFor: Huge > Large > Normal > Slim on chest, traps and arms', () => {
  const shape = (build) => H.bodyShapeFor({ build, gender: 1 }).parts;
  const [s, n, l, h] = [SLIM, NORMAL, LARGE, HUGE].map(shape);
  for (const [label, pick] of [
    ['chest width', (p) => p.spineHigh[0]],
    ['chest depth', (p) => p.spineHigh[2]],
    ['traps', (p) => p.shoulder[0]],
    ['arms', (p) => p.upperArm[0]],
    ['legs', (p) => p.thigh[0]]
  ]) {
    assert.ok(pick(s) < pick(n) && pick(n) < pick(l) && pick(l) < pick(h),
      `${label} must grow Slim<Normal<Large<Huge: ${[s, n, l, h].map(pick)}`);
  }
});

test('bodyShapeFor: Normal is the identity shape', () => {
  const p = H.bodyShapeFor({ build: NORMAL, gender: 1 }).parts;
  for (const [k, v] of Object.entries(p)) {
    if (k === 'head') continue;
    assert.deepEqual(v, [1, 1, 1], `${k} should be untouched on Normal`);
  }
});

test('bodyShapeFor: Hulk-type has a V-taper and a massive torso', () => {
  const s = H.bodyShapeFor({ build: HUGE, gender: 1 });
  assert.ok(s.parts.spineHigh[0] > s.parts.spineLow[0], 'chest wider than waist');
  assert.ok(s.parts.spineHigh[0] >= 1.7, `chest width ${s.parts.spineHigh[0]}`);
  assert.ok(s.parts.neck[0] >= 2, `traps swallow the neck: neck width ${s.parts.neck[0]}`);
  assert.ok(s.parts.shoulder[0] > 1.4 && s.parts.shoulder[0] < s.parts.neck[0],
    `collarbones thicken part-way (no chest shelf): ${s.parts.shoulder[0]}`);
  assert.equal(s.rootScale, 1.40, 'height matches Playground.BUILDS Huge');
  assert.ok(s.jointShift.shoulder > 1.5, 'shoulder sockets move out with the chest');
  assert.ok(s.parts.forearm[0] >= s.parts.upperArm[0], 'Hulk forearms at least as big as the upper arms');
  assert.ok(s.posture.spine > 0 && s.posture.neck > 0 && s.posture.shrug > 0, 'hunched, shrugged stance');
  assert.ok(s.posture.head < 0, 'head counter-pitches so the face stays forward');
  assert.ok(s.posture.armSplay > 0 && s.posture.legSplay > 0, 'arms held out by the lats, wide stance');
  assert.deepEqual(H.bodyShapeFor({ build: NORMAL }).posture,
    { spine: 0, neck: 0, head: 0, shrug: 0, armSplay: 0, legSplay: 0 });
});

test('bodyShapeFor: limbs thicken but never lengthen (y stays 1)', () => {
  const p = H.bodyShapeFor({ build: HUGE, gender: 2 }).parts;
  for (const k of ['hips', 'spineLow', 'spineHigh', 'neck', 'shoulder', 'upperArm', 'forearm', 'thigh', 'shin', 'foot']) {
    assert.equal(p[k][1], 1, `${k} length`);
  }
});

test('bodyShapeFor: Feminine → female model; Masculine and Neutral → male', () => {
  assert.equal(H.bodyShapeFor({ gender: 2 }).model, 'female');
  assert.equal(H.bodyShapeFor({ gender: 1 }).model, 'male');
  assert.equal(H.bodyShapeFor({ gender: 0 }).model, 'male');
  assert.match(H.bodyShapeFor({ gender: 2 }).file, /body_female\.glb$/);
});

test('bodyShapeFor: realistic 100% heads on everyday builds; Hulk-type keeps its bigger head', () => {
  for (const b of [SLIM, NORMAL, LARGE]) {
    const s = H.bodyShapeFor({ build: b });
    assert.equal(s.headScale, 1);
    assert.deepEqual(s.parts.head, [1, 1, 1]);
  }
  const hulk = H.bodyShapeFor({ build: HUGE });
  assert.equal(hulk.headScale, 1.105, 'the head size approved in the live preview');
  assert.deepEqual(hulk.parts.head, [1.105, 1.105, 1.105]);
});

test('bodyShapeFor: bad or missing build falls back to Normal', () => {
  const normal = H.bodyShapeFor({ build: NORMAL });
  for (const c of [{}, { build: 99 }, { build: -1 }, { build: 1.5 }, null]) {
    assert.deepEqual(H.bodyShapeFor(c).parts, normal.parts);
  }
});

test('BUILD_SHAPE heights mirror Playground.BUILDS', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'playground.js'), 'utf8');
  const scales = [...src.matchAll(/name: '(\w+)',\s*scale: ([\d.]+)/g)].map((m) => [m[1], +m[2]]);
  assert.deepEqual(scales, H.BUILD_SHAPE.map((b) => [b.name, b.scale]));
});

// ── Skeleton classification ──

test('parseBoneName: prefixes, sides and twist indices', () => {
  assert.deepEqual(H.parseBoneName('DEF-upper_arm.L'), { base: 'upperarm', side: 'L', idx: 0 });
  assert.deepEqual(H.parseBoneName('DEF-upper_arm.L.001'), { base: 'upperarm', side: 'L', idx: 1 });
  assert.deepEqual(H.parseBoneName('mixamorig:LeftForeArm'), { base: 'forearm', side: 'L', idx: 0 });
  assert.deepEqual(H.parseBoneName('mixamorig:Spine2'), { base: 'spine', side: null, idx: 2 });
  assert.deepEqual(H.parseBoneName('DEF-spine.003'), { base: 'spine', side: null, idx: 3 });
  assert.deepEqual(H.parseBoneName('DEF-head'), { base: 'head', side: null, idx: 0 });
  assert.deepEqual(H.parseBoneName('thigh_R'), { base: 'thigh', side: 'R', idx: 0 });
});

const limbs = (prefix, fmt) => ['L', 'R'].flatMap((s) =>
  ['shoulder', 'upper_arm', 'forearm', 'hand', 'thigh', 'shin', 'foot', 'toe'].map((b) => ({ name: prefix + fmt(b, s) })));

test('classifySkeleton: stock Rigify (DEF-spine … spine.006)', () => {
  const bones = [
    ...['', '.001', '.002', '.003', '.004', '.005', '.006'].map((i) => ({ name: 'DEF-spine' + i })),
    ...limbs('DEF-', (b, s) => `${b}.${s}`),
    { name: 'DEF-upper_arm.L.001' }, { name: 'DEF-f_index.01.L' }, { name: 'DEF-breast.L' }
  ];
  const c = H.classifySkeleton(bones);
  assert.equal(c.hips, 'DEF-spine');
  assert.deepEqual(c.spine, ['DEF-spine.001', 'DEF-spine.002', 'DEF-spine.003']);
  assert.deepEqual(c.neck, ['DEF-spine.004', 'DEF-spine.005']);
  assert.equal(c.head, 'DEF-spine.006');
  assert.deepEqual(c['upperArm.L'], ['DEF-upper_arm.L', 'DEF-upper_arm.L.001']);
  assert.deepEqual(H.missingParts(c), []);
});

test('classifySkeleton: Quaternius Universal rig (Unreal-style names, as shipped)', () => {
  // Joint names exactly as audited from Superhero_{Male,Female}_FullBody.gltf
  // and UAL1_Standard.glb (fingers trimmed — they're ignored anyway).
  const bones = ['root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head',
    ...['l', 'r'].flatMap((s) => ['clavicle', 'upperarm', 'lowerarm', 'hand', 'index_01', 'thumb_04_leaf',
      'thigh', 'calf', 'foot', 'ball', 'ball_leaf'].map((b) => `${b}_${s}`))].map((name) => ({ name }));
  const c = H.classifySkeleton(bones);
  assert.equal(c.hips, 'pelvis');
  assert.deepEqual(c.spine, ['spine_01', 'spine_02', 'spine_03']);
  assert.deepEqual(c.neck, ['neck_01']);
  assert.equal(c.head, 'Head');
  assert.deepEqual(c['shoulder.L'], ['clavicle_l']);
  assert.deepEqual(c['forearm.R'], ['lowerarm_r']);
  assert.deepEqual(c['shin.L'], ['calf_l']);
  assert.deepEqual(c['toe.R'], ['ball_r']);
  assert.deepEqual(H.missingParts(c), []);
});

test('classifySkeleton: Rigify with named DEF-neck / DEF-head', () => {
  const bones = [
    { name: 'DEF-hips' }, { name: 'DEF-spine.001' }, { name: 'DEF-spine.002' }, { name: 'DEF-spine.003' },
    { name: 'DEF-neck' }, { name: 'DEF-head' },
    ...limbs('DEF-', (b, s) => `${b}.${s}`)
  ];
  const c = H.classifySkeleton(bones);
  assert.equal(c.hips, 'DEF-hips');
  assert.deepEqual(c.spine, ['DEF-spine.001', 'DEF-spine.002', 'DEF-spine.003']);
  assert.deepEqual(c.neck, ['DEF-neck']);
  assert.equal(c.head, 'DEF-head');
  assert.deepEqual(c['shin.R'], ['DEF-shin.R']);
  assert.deepEqual(H.missingParts(c), []);
});

test('classifySkeleton: Mixamo', () => {
  const names = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
    ...['Left', 'Right'].flatMap((s) => ['Shoulder', 'Arm', 'ForeArm', 'Hand', 'UpLeg', 'Leg', 'Foot', 'ToeBase'].map((b) => s + b))];
  const c = H.classifySkeleton(names.map((n) => ({ name: 'mixamorig:' + n })));
  assert.equal(c.hips, 'mixamorig:Hips');
  assert.deepEqual(c.spine, ['mixamorig:Spine', 'mixamorig:Spine1', 'mixamorig:Spine2']);
  assert.equal(c.head, 'mixamorig:Head');
  assert.deepEqual(c['thigh.L'], ['mixamorig:LeftUpLeg']);
  assert.deepEqual(c['shin.L'], ['mixamorig:LeftLeg']);
  assert.deepEqual(c['upperArm.R'], ['mixamorig:RightArm']);
  assert.deepEqual(H.missingParts(c), []);
});

test('missingParts reports what an incomplete rig lacks', () => {
  const c = H.classifySkeleton([{ name: 'Hips' }, { name: 'Head' }]);
  const m = H.missingParts(c);
  assert.ok(m.includes('spine') && m.includes('hand.L') && m.includes('foot.R'));
});

// ── Animation state ──

const base = { now: 10000, maxSpeed: 4 };

test('selectAnimState: idle / walk / run thresholds with speed-matched playback', () => {
  assert.equal(H.selectAnimState({ ...base, speed: 0 }).base, 'idle');
  const walk = H.selectAnimState({ ...base, speed: 1.5 });
  assert.equal(walk.base, 'walk');
  assert.equal(walk.timeScale, 1);
  const run = H.selectAnimState({ ...base, speed: 4 });
  assert.equal(run.base, 'run');
  assert.equal(run.timeScale, 1);
  assert.ok(H.selectAnimState({ ...base, speed: 0.1 }).base === 'idle', 'tiny drift is still idle');
  assert.equal(H.selectAnimState({ ...base, speed: 50 }).timeScale, 1.4, 'playback speed is clamped');
});

test('selectAnimState: jump up vs fall by vertical velocity; landing window', () => {
  assert.equal(H.selectAnimState({ ...base, airborne: true, velY: 5 }).base, 'jumpUp');
  assert.equal(H.selectAnimState({ ...base, airborne: true, velY: -2 }).base, 'fall');
  assert.equal(H.selectAnimState({ ...base, landAt: base.now - 50 }).base, 'land');
  assert.equal(H.selectAnimState({ ...base, landAt: base.now - 500 }).base, 'idle');
  assert.equal(H.selectAnimState({ ...base, landAt: base.now - 50, speed: 4 }).base, 'run',
    'landing at full speed flows straight into the run');
});

test('selectAnimState: knockdown then get-up; no overlays while down', () => {
  const k = { ...base, downUntil: base.now + 300, getupUntil: base.now + 900, punchUntil: base.now + 100 };
  assert.deepEqual(H.selectAnimState(k), { base: 'down', overlay: null, timeScale: 1 });
  assert.equal(H.selectAnimState({ ...k, now: base.now + 500 }).base, 'getup');
  assert.equal(H.selectAnimState({ ...k, now: base.now + 1000 }).base, 'idle');
  assert.equal(H.downPhase(0, 0, 0), null);
});

test('selectAnimState: punch overlay beats wave; both layer over walking', () => {
  const both = { ...base, speed: 1.5, punchUntil: base.now + 200, emoteUntil: base.now + 2000 };
  assert.deepEqual([H.selectAnimState(both).base, H.selectAnimState(both).overlay], ['walk', 'punch']);
  assert.equal(H.selectAnimState({ ...both, punchUntil: 0 }).overlay, 'wave');
  assert.equal(H.selectAnimState({ ...both, punchUntil: 0, emoteUntil: base.now - 1 }).overlay, null);
});

test('selectAnimState: hit flinch beats punch and wave, layers over idle and walk', () => {
  const s = { ...base, hitUntil: base.now + 200, punchUntil: base.now + 200, emoteUntil: base.now + 2000 };
  assert.deepEqual([H.selectAnimState(s).base, H.selectAnimState(s).overlay], ['idle', 'hit']);
  assert.deepEqual([H.selectAnimState({ ...s, speed: 1.5 }).base, H.selectAnimState({ ...s, speed: 1.5 }).overlay], ['walk', 'hit']);
});

test('selectAnimState: an expired hit falls through to punch, then wave, then none', () => {
  const s = { ...base, hitUntil: base.now - 1, punchUntil: base.now + 200, emoteUntil: base.now + 2000 };
  assert.equal(H.selectAnimState(s).overlay, 'punch');
  assert.equal(H.selectAnimState({ ...s, punchUntil: base.now - 1 }).overlay, 'wave');
  assert.equal(H.selectAnimState({ ...s, punchUntil: 0, emoteUntil: 0 }).overlay, null);
});

test('selectAnimState: no hit overlay while down, getting up, or falling', () => {
  const k = { ...base, hitUntil: base.now + 200, downUntil: base.now + 300, getupUntil: base.now + 900 };
  assert.deepEqual(H.selectAnimState(k), { base: 'down', overlay: null, timeScale: 1 });
  assert.deepEqual([H.selectAnimState({ ...k, now: base.now + 500 }).base, H.selectAnimState({ ...k, now: base.now + 500 }).overlay], ['getup', null]);
  assert.equal(H.selectAnimState({ ...base, airborne: true, falling: true, hitUntil: base.now + 200 }).overlay, null);
});

test('selectAnimState: falling to respawn shows the fall with no overlay', () => {
  const s = H.selectAnimState({ ...base, airborne: true, falling: true, velY: 3, punchUntil: base.now + 100 });
  assert.deepEqual(s, { base: 'fall', overlay: null, timeScale: 1 });
});

// ── LOD ──

test('lodTier: every frame near, throttled mid, frozen far or off-screen', () => {
  assert.deepEqual(H.lodTier(5, true, false), { animate: true, interval: 0, castShadow: true });
  const mid = H.lodTier(40, true, false);
  assert.equal(mid.animate, true);
  assert.equal(mid.interval, 1 / 15);
  assert.equal(mid.castShadow, false);
  assert.equal(H.lodTier(80, true, false).animate, false);
  assert.equal(H.lodTier(1, false, false).animate, false);
  assert.equal(H.lodTier(25, true, true).interval, 1 / 15, 'mobile tiers are tighter');
});

// ── Garments (real geometry: shells, skirts, capes) ──

test('garmentsFor: the Skirt trouser style hangs a skirt from the waist', () => {
  const g = H.garmentsFor({ pantsStyle: 4 });
  assert.equal(g.skirt.kind, 'skirt');
  assert.equal(g.skirt.color, 'bottom', 'takes the trouser colour');
  assert.ok(g.skirt.length > 0.2 && g.skirt.length < 0.45);
  assert.equal(g.shell, null);
});

test('garmentsFor: dress and robe are longer than a skirt, in the suit colour', () => {
  const skirt = H.garmentsFor({ pantsStyle: 4 }).skirt;
  const dress = H.garmentsFor({ suit: 2 }).skirt;
  const robe = H.garmentsFor({ suit: 3 }).skirt;
  assert.ok(skirt.length < dress.length && dress.length < robe.length,
    `skirt ${skirt.length} < dress ${dress.length} < robe ${robe.length}`);
  for (const s of [dress, robe]) assert.equal(s.color, 'suit');
});

test('garmentsFor: Armor is a metal shell over the whole body but the head (Iron Man)', () => {
  const g = H.garmentsFor({ suit: 4 });
  assert.equal(g.shell.kind, 'armor');
  assert.ok(g.shell.metal > 0.5, 'reads as metal, not cloth');
  assert.ok(g.shell.pauldrons, 'shoulder pads');
  for (const p of ['torso', 'upperArm', 'forearm', 'thigh', 'shin', 'foot']) {
    assert.ok(g.shell.parts.includes(p), `armour covers ${p}`);
  }
  assert.ok(!g.shell.parts.includes('head') && !g.shell.parts.includes('neck'));
  assert.ok(g.shell.inflate > H.garmentsFor({ outerwear: 1 }).shell.inflate, 'armour sits proudest');
});

test('garmentsFor: vest covers only the torso; jacket adds sleeves', () => {
  assert.deepEqual(H.garmentsFor({ outerwear: 5 }).shell.parts, ['torso']);
  const jacket = H.garmentsFor({ outerwear: 1 }).shell;
  assert.deepEqual(jacket.parts, ['torso', 'upperArm', 'forearm']);
  assert.equal(jacket.metal, 0, 'cloth, not metal');
  // A bomber's sleeve stops short at the cuff.
  assert.ok(H.garmentsFor({ outerwear: 2 }).shell.cut.forearm < 1);
});

test('garmentsFor: trench coat adds coat tails; hoodie flags a hood', () => {
  const trench = H.garmentsFor({ outerwear: 3 });
  assert.equal(trench.shell.kind, 'trench');
  assert.equal(trench.skirt.kind, 'coat');
  assert.ok(trench.skirt.length > 0.5, 'tails reach the knee');
  assert.equal(H.garmentsFor({ outerwear: 4 }).hood, true);
});

test('garmentsFor: a cape hangs and is not a shell (Thor)', () => {
  const g = H.garmentsFor({ outerwear: 6 });
  assert.equal(g.shell, null);
  assert.ok(g.cape.length > 0.8, 'reaches past the knees');
  assert.equal(g.cape.color, 'outer');
});

test('garmentsFor: outerwear is worn over a suit; nothing selected → nothing built', () => {
  const over = H.garmentsFor({ suit: 4, outerwear: 1 });
  assert.equal(over.shell.kind, 'jacket', 'the jacket is the outer layer');
  assert.deepEqual(H.garmentsFor({}), { shell: null, skirt: null, cape: null, hood: false });
  assert.deepEqual(H.garmentsFor(null), { shell: null, skirt: null, cape: null, hood: false });
});

// ── Slot coverage ──

test('SLOT_MAP covers every stored character key (server whitelist + schema)', () => {
  const sock = fs.readFileSync(path.join(__dirname, '..', 'routes', 'world-socket.js'), 'utf8');
  const block = sock.match(/CHARACTER_KEYS = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(block, 'CHARACTER_KEYS found in routes/world-socket.js');
  const keys = [...block[1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
  assert.ok(keys.length >= 30, `parsed ${keys.length} keys`);
  const schema = fs.readFileSync(path.join(__dirname, '..', 'js', 'character-schema.js'), 'utf8');
  const schemaKeys = [...schema.matchAll(/key: '(\w+)'/g)].map((m) => m[1]);
  for (const k of new Set([...keys, ...schemaKeys])) {
    assert.ok(H.SLOT_MAP[k], `slot '${k}' has no SLOT_MAP entry`);
  }
});

test('selectAnimState: backpedalling reverses the locomotion clip, not the rest', () => {
  // Walking backwards plays the same clip with a negative time scale so the
  // legs cycle backwards — otherwise the character moonwalks.
  const fwd = H.selectAnimState({ ...base, speed: 1.5 });
  const back = H.selectAnimState({ ...base, speed: 1.5, backward: true });
  assert.equal(back.base, 'walk', 'still the walk clip, just reversed');
  assert.equal(back.timeScale, -fwd.timeScale);

  // Backpedalling never breaks into a jog, even at full stick.
  const runBack = H.selectAnimState({ ...base, speed: 4, backward: true });
  assert.equal(runBack.base, 'walk');
  assert.ok(runBack.timeScale < 0);
  assert.ok(Math.abs(runBack.timeScale) <= 1.4, 'capped cadence');

  // Standing still has no direction to reverse.
  assert.equal(H.selectAnimState({ ...base, speed: 0, backward: true }).timeScale, 1);
  // Airborne and knocked-down clips read the same whichever way you were going.
  assert.equal(H.selectAnimState({ ...base, speed: 3, backward: true, airborne: true, velY: 5 }).timeScale, 1);
  assert.equal(H.selectAnimState({ ...base, speed: 3, backward: true, falling: true }).timeScale, 1);
});

test('selectAnimState: backpedal at its real (slower) speed steps slower than walking forward', () => {
  // The engine passes speed × BACKPEDAL_MUL (0.6) while stepping back.
  const fwd = H.selectAnimState({ ...base, speed: 2.0 });
  const back = H.selectAnimState({ ...base, speed: 2.0 * 0.6, backward: true });
  assert.equal(back.base, 'walk');
  assert.ok(Math.abs(back.timeScale) < Math.abs(fwd.timeScale), 'slower cadence backwards');
});

test('slot map covers bodyType, and the schema offers Realistic / Box', () => {
  const schema = require('../js/character-schema.js').CHARACTER_SCHEMA;
  const entry = schema.find((e) => e.key === 'bodyType');
  assert.ok(entry, 'bodyType is in the customizer schema');
  assert.equal(entry.optionsFrom, 'BODY_TYPES');
  assert.ok(entry.noRandom, 'Randomize leaves the body type alone');
});
