/************************************************
 * Unit tests for server/character.js — the saved-character slot ranges.
 *
 * The same maxes live in three places that must agree: server/character.js
 * (validation + socket sanitising), the Mongoose schema in models/user.js,
 * and the option arrays in js/playground.js (the customizer and renderers).
 * Adding an option anywhere without the others either 400s the save or lets
 * a bad index through; this file fails first.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../server/character.js');
const User = require('../models/user.js');

// js/playground.js is a browser script (const Playground = (() => …)()).
function loadPlayground() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'playground.js'), 'utf8');
  const ctx = { console };
  vm.createContext(ctx);
  return vm.runInContext(src + '\n;Playground', ctx);
}
const PG = loadPlayground();

// slot → [option array, accent?]. Accent (*Color2) slots have an "Auto"
// sentinel at 0, so their max is the palette LENGTH, not length − 1.
const SOURCES = {
  skin: ['SKIN_TONES'], hairStyle: ['HAIR_STYLES'], hairColor: ['HAIR_COLORS'],
  shirtColor: ['SHIRT_COLORS'], pantsColor: ['PANTS_COLORS'], eyeColor: ['EYE_COLORS'],
  eyeShape: ['EYE_SHAPES'], facialHairStyle: ['FACIAL_HAIR_STYLES'], facialHairColor: ['HAIR_COLORS'],
  glasses: ['GLASSES_STYLES'], hat: ['HAT_STYLES'], shoeColor: ['SHOE_COLORS'], build: ['BUILDS'],
  bodyType: ['BODY_TYPES'], shirtStyle: ['SHIRT_STYLES'], pantsStyle: ['PANTS_STYLES'],
  shoeStyle: ['SHOE_STYLES'], outerwear: ['OUTERWEAR_STYLES'], outerwearColor: ['SHIRT_COLORS'],
  suit: ['SUIT_STYLES'], suitColor: ['SUIT_COLORS'], gloves: ['GLOVES_STYLES'], belt: ['BELT_STYLES'],
  mask: ['MASK_STYLES'], accessoryColor: ['ACCESSORY_COLORS'], gender: ['GENDER_LABELS'],
  shirtColor2: ['SHIRT_COLORS', true], pantsColor2: ['PANTS_COLORS', true],
  outerwearColor2: ['SHIRT_COLORS', true], shoeColor2: ['SHOE_COLORS', true],
  helmet: ['HELMET_STYLES'], helmetColor: ['SHIRT_COLORS'], prop: ['PROP_STYLES'], propColor: ['SHIRT_COLORS'],
  emblem: ['EMBLEM_STYLES'], emblemColor: ['SHIRT_COLORS']
};
const DEPRECATED = new Set(['gear']);   // kept for old saves; no option array

test('every range matches its js/playground.js option array', () => {
  for (const [key, rule] of Object.entries(C.HOME_CHARACTER_RANGES)) {
    if (DEPRECATED.has(key)) continue;
    assert.ok(SOURCES[key], `no option array mapped for '${key}'`);
    const [name, accent] = SOURCES[key];
    const arr = PG[name];
    assert.ok(Array.isArray(arr), `Playground.${name} exists`);
    assert.equal(rule.max, accent ? arr.length : arr.length - 1, `${key} max vs Playground.${name}`);
  }
});

test('every range matches the models/user.js schema', () => {
  for (const [key, rule] of Object.entries(C.HOME_CHARACTER_RANGES)) {
    const p = User.schema.path('homeCharacter.' + key);
    assert.ok(p, `models/user.js has homeCharacter.${key}`);
    assert.equal(p.options.max, rule.max, `${key} schema max`);
    assert.equal(p.options.min, 0, `${key} schema min`);
  }
  // …and the schema has no slot the server doesn't know about.
  const schemaKeys = Object.keys(User.schema.paths)
    .filter(k => k.startsWith('homeCharacter.')).map(k => k.slice('homeCharacter.'.length));
  assert.deepEqual(schemaKeys.sort(), [...C.CHARACTER_KEYS].sort());
});

test('sanitizeCharacter: keeps in-range integers, drops everything else', () => {
  assert.equal(C.sanitizeCharacter(null), null);
  assert.equal(C.sanitizeCharacter('x'), null);
  assert.equal(C.sanitizeCharacter([1, 2]), null);
  const out = C.sanitizeCharacter({
    skin: 3, hairStyle: 2.9, build: 99, gender: -1, shirtColor: '4', eyeColor: NaN,
    evil: 5, __proto__: { polluted: 1 }, constructor: 1
  });
  assert.deepEqual(out, { skin: 3, hairStyle: 2 });
  assert.equal({}.polluted, undefined);
});

test('validateCharacterUpdate: partial, all-or-nothing on bad keys', () => {
  const ok = C.validateCharacterUpdate({ skin: 2, build: 1, unknown: 7 });
  assert.deepEqual(ok.update, { 'homeCharacter.skin': 2, 'homeCharacter.build': 1 });
  assert.deepEqual(ok.errors, {});
  const bad = C.validateCharacterUpdate({ skin: 2, build: 4 });
  assert.ok(bad.errors.build);
  assert.deepEqual(C.validateCharacterUpdate(null), { update: {}, errors: {} });
});
