/************************************************
 * CHARACTER RANGES — the one server-side definition of a saved
 * homeCharacter (the /customize look).
 *
 * Every slot is a small integer index into an option array defined
 * client-side in js/playground.js (palettes / style lists). Used by:
 *   - routes/profile.js  PUT /api/profile/home-character (validation)
 *   - routes/world-socket.js  join payloads + live outfit broadcasts
 * models/user.js carries the same maxes in the Mongoose schema;
 * test/character.test.js keeps the three in sync.
 *
 * NOTE: the four accent (*Color2) maxes are palette.length, NOT length-1 —
 * index 0 is the "Auto" sentinel and 1..N map to palette[0..N-1].
 ************************************************/
const HOME_CHARACTER_RANGES = Object.freeze({
  skin:            { max: 12 },   // 12 = Hulk green (added for Avengers presets)
  hairStyle:       { max: 13 },
  hairColor:       { max: 13 },
  shirtColor:      { max: 16 },
  pantsColor:      { max: 15 },
  eyeColor:        { max: 7 },
  eyeShape:        { max: 4 },
  facialHairStyle: { max: 5 },
  facialHairColor: { max: 13 },
  glasses:         { max: 4 },
  hat:             { max: 4 },
  shoeColor:       { max: 7 },
  build:           { max: 3 },    // body size/bulk
  bodyType:        { max: 1 },    // BODY_TYPES: 0 = Realistic, 1 = Box
  gear:            { max: 6 },    // DEPRECATED (round 2): hero `gear` slot removed
                                  // from UI/render; kept so old docs/clients
                                  // that still PUT it don't 400. Ignored.
  // Clothing SHAPE slots — maxes mirror the array lengths in js/playground.js
  // (SHIRT_STYLES/PANTS_STYLES/SHOE_STYLES/OUTERWEAR_STYLES/SUIT_STYLES/
  // GLOVES_STYLES/BELT_STYLES/MASK_STYLES).
  shirtStyle:      { max: 8 },    // 0 = plain tee (legacy); 8 = ripped (bare chest)
  pantsStyle:      { max: 6 },    // 0 = plain pants (legacy)
  shoeStyle:       { max: 6 },    // 0 = plain shoe (legacy)
  outerwear:       { max: 6 },    // 0 = none
  outerwearColor:  { max: 16 },   // reuses SHIRT_COLORS
  suit:            { max: 5 },    // 0 = none (overrides top+bottom)
  suitColor:       { max: 7 },    // SUIT_COLORS
  gloves:          { max: 3 },    // 0 = none
  belt:            { max: 4 },    // 0 = none
  mask:            { max: 4 },    // 0 = none
  accessoryColor:  { max: 5 },    // ACCESSORY_COLORS (gloves/belt/mask trim)
  gender:          { max: 2 },    // 0 = Neutral (back-compat)
  shirtColor2:     { max: 17 },   // Auto + SHIRT_COLORS (17)
  pantsColor2:     { max: 16 },   // Auto + PANTS_COLORS (16)
  outerwearColor2: { max: 17 },   // Auto + SHIRT_COLORS (17)
  shoeColor2:      { max: 8 },    // Auto + SHOE_COLORS (8)
  helmet:          { max: 6 },    // HELMET_STYLES (0 = none); 6 = Soldier (WWII Cap)
  helmetColor:     { max: 16 },   // SHIRT_COLORS
  prop:            { max: 6 },    // PROP_STYLES (0 = none); 6 = Bow + quiver
  propColor:       { max: 16 },   // SHIRT_COLORS
  emblem:          { max: 7 },    // EMBLEM_STYLES (0 = none); 6 = Soldier flag, 7 = Discs
  emblemColor:     { max: 16 }    // SHIRT_COLORS
});

const CHARACTER_KEYS = Object.freeze(Object.keys(HOME_CHARACTER_RANGES));

// An integer in 0..max, or null.
function pickInt(value, max) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const v = Math.floor(value);
  if (v < 0 || v > max) return null;
  return v;
}

// PUT validation. Partial: keys missing from `body` are skipped; a key that
// IS present must be a valid index or the whole request fails.
// → { update: { 'homeCharacter.<key>': v }, errors: { <key>: msg } }
function validateCharacterUpdate(body) {
  const src = (body && typeof body === 'object') ? body : {};
  const update = {};
  const errors = {};
  for (const [key, rule] of Object.entries(HOME_CHARACTER_RANGES)) {
    if (!(key in src)) continue;
    const v = pickInt(src[key], rule.max);
    if (v === null) errors[key] = `must be an integer 0..${rule.max}`;
    else update['homeCharacter.' + key] = v;
  }
  return { update, errors };
}

// A character someone else will render (socket join payloads, broadcasts):
// only known slots, each an in-range integer. Anything else is dropped, never
// clamped, so a junk value can't masquerade as a real option. Renderers
// default a missing slot. Non-object input → null.
function sanitizeCharacter(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const key of CHARACTER_KEYS) {
    const v = pickInt(raw[key], HOME_CHARACTER_RANGES[key].max);
    if (v !== null) out[key] = v;
  }
  return out;
}

module.exports = { HOME_CHARACTER_RANGES, CHARACTER_KEYS, pickInt, validateCharacterUpdate, sanitizeCharacter };
