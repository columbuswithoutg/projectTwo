/************************************************
 * CHARACTER SCHEMA — single source of truth for the customizer UI
 *
 * One flat list describing every editable slot of a homeCharacter, grouped
 * into sections. The /customize page (js/views/customize.js) renders controls
 * straight from this list, so adding a future slot is a one-line edit here
 * plus the data/3D/2D/server changes.
 *
 * Each entry:
 *   { section, key, label, control }
 *     control: 'swatch'  → color circles from Playground[<palette>]
 *              'label'    → text buttons from inline `options` or Playground[<optionsFrom>]
 *              'accent'   → an "Auto" chip + color circles from Playground[<palette>];
 *                           value 0 = Auto (built-in default), i≥1 → palette[i-1]
 *   swatch / accent entries carry `palette` (a color-array name on Playground)
 *   label entries carry `options` (inline string[]) OR `optionsFrom`
 *     (a string[] name on Playground, or the special 'BUILDS' → BUILDS[].name)
 *   label entries may carry `lean` — a sparse { optionIndex: 'm' | 'f' } map the
 *     page uses to surface gender-leaning options first (still all selectable).
 *
 * Counts here are display-only; the authoritative option counts live in
 * js/playground.js (array lengths) mirrored by routes/profile.js + models/user.js.
 ************************************************/
const CHARACTER_SCHEMA = [
  // ── Body ──
  { section: 'Body',  key: 'skin',   label: 'Skin',   control: 'swatch', palette: 'SKIN_TONES' },
  { section: 'Body',  key: 'gender', label: 'Gender', control: 'label',  optionsFrom: 'GENDER_LABELS' },
  { section: 'Body',  key: 'build',  label: 'Build',  control: 'label',  optionsFrom: 'BUILDS' },

  // ── Face ──
  { section: 'Face',  key: 'eyeColor',        label: 'Eye color',  control: 'swatch', palette: 'EYE_COLORS' },
  { section: 'Face',  key: 'eyeShape',        label: 'Eye shape',  control: 'label',  options: ['Round', 'Narrow', 'Wide', 'Sharp', 'Soft'] },
  { section: 'Face',  key: 'facialHairStyle', label: 'Facial hair',control: 'label',  options: ['Clean', 'Stubble', 'Mustache', 'Goatee', 'Beard', 'Chinstrap'] },
  { section: 'Face',  key: 'facialHairColor', label: 'Beard color',control: 'swatch', palette: 'HAIR_COLORS' },
  { section: 'Face',  key: 'glasses',         label: 'Glasses',    control: 'label',  options: ['None', 'Round', 'Square', 'Aviator', 'Half-rim'] },

  // ── Hair ──
  { section: 'Hair',  key: 'hairStyle', label: 'Hair style', control: 'label',
    options: ['Pixie', 'Bob', 'Spiky', 'Long', 'Bald', 'Cap', 'Ponytail', 'Mohawk', 'Afro', 'Curly', 'Buzz', 'Side-part', 'Topknot', 'Undercut'],
    lean: { 1: 'f', 3: 'f', 6: 'f', 12: 'f', 7: 'm', 10: 'm', 13: 'm' } },
  { section: 'Hair',  key: 'hairColor', label: 'Hair color', control: 'swatch', palette: 'HAIR_COLORS' },
  { section: 'Hair',  key: 'hat',       label: 'Hat',        control: 'label',  options: ['None', 'Beanie', 'Cap', 'Top hat', 'Hood'] },

  // ── Top ──
  { section: 'Top',   key: 'shirtStyle',  label: 'Style',  control: 'label',  optionsFrom: 'SHIRT_STYLES', lean: { 1: 'f', 5: 'f' } },
  { section: 'Top',   key: 'shirtColor',  label: 'Color',  control: 'swatch', palette: 'SHIRT_COLORS' },
  { section: 'Top',   key: 'shirtColor2', label: 'Accent', control: 'accent', palette: 'SHIRT_COLORS' },

  // ── Bottom ──
  { section: 'Bottom', key: 'pantsStyle',  label: 'Style',  control: 'label',  optionsFrom: 'PANTS_STYLES', lean: { 4: 'f', 2: 'm', 6: 'm' } },
  { section: 'Bottom', key: 'pantsColor',  label: 'Color',  control: 'swatch', palette: 'PANTS_COLORS' },
  { section: 'Bottom', key: 'pantsColor2', label: 'Accent', control: 'accent', palette: 'PANTS_COLORS' },

  // ── Footwear ──
  { section: 'Footwear', key: 'shoeStyle',  label: 'Style',  control: 'label',  optionsFrom: 'SHOE_STYLES', lean: { 5: 'f', 6: 'f', 3: 'm' } },
  { section: 'Footwear', key: 'shoeColor',  label: 'Color',  control: 'swatch', palette: 'SHOE_COLORS' },
  { section: 'Footwear', key: 'shoeColor2', label: 'Accent', control: 'accent', palette: 'SHOE_COLORS' },

  // ── Outerwear ──
  { section: 'Outerwear', key: 'outerwear',       label: 'Layer',  control: 'label',  optionsFrom: 'OUTERWEAR_STYLES' },
  { section: 'Outerwear', key: 'outerwearColor',  label: 'Color',  control: 'swatch', palette: 'SHIRT_COLORS' },
  { section: 'Outerwear', key: 'outerwearColor2', label: 'Accent', control: 'accent', palette: 'SHIRT_COLORS' },

  // ── Full-body (overrides top + bottom) ──
  { section: 'Full-body', key: 'suit',      label: 'Suit',  control: 'label',  optionsFrom: 'SUIT_STYLES' },
  { section: 'Full-body', key: 'suitColor', label: 'Color', control: 'swatch', palette: 'SUIT_COLORS' },

  // ── Accessories ──
  { section: 'Accessories', key: 'gloves',         label: 'Gloves', control: 'label',  optionsFrom: 'GLOVES_STYLES' },
  { section: 'Accessories', key: 'belt',           label: 'Belt',   control: 'label',  optionsFrom: 'BELT_STYLES' },
  { section: 'Accessories', key: 'mask',           label: 'Mask',   control: 'label',  optionsFrom: 'MASK_STYLES' },
  { section: 'Accessories', key: 'accessoryColor', label: 'Trim',   control: 'swatch', palette: 'ACCESSORY_COLORS' },

  // ── Hero (reusable pieces; replaced the old all-in-one gear slot) ──
  { section: 'Hero', key: 'helmet',      label: 'Helmet',    control: 'label',  optionsFrom: 'HELMET_STYLES' },
  { section: 'Hero', key: 'helmetColor', label: 'Helmet color', control: 'swatch', palette: 'SHIRT_COLORS' },
  { section: 'Hero', key: 'prop',        label: 'Held item', control: 'label',  optionsFrom: 'PROP_STYLES' },
  { section: 'Hero', key: 'propColor',   label: 'Item color', control: 'swatch', palette: 'SHIRT_COLORS' },
  { section: 'Hero', key: 'emblem',      label: 'Emblem',    control: 'label',  optionsFrom: 'EMBLEM_STYLES' },
  { section: 'Hero', key: 'emblemColor', label: 'Emblem color', control: 'swatch', palette: 'SHIRT_COLORS' }
];

// Section order for the page (sections not listed fall to the end).
const CHARACTER_SECTION_ORDER = [
  'Body', 'Face', 'Hair', 'Top', 'Bottom', 'Footwear',
  'Outerwear', 'Full-body', 'Accessories', 'Hero'
];

// Resolve a label entry's options against Playground (used by the page + the
// Randomize helper so option counts always match the live arrays).
function characterSchemaOptions(entry) {
  if (entry.options) return entry.options;
  const from = entry.optionsFrom;
  if (!from || typeof Playground === 'undefined') return [];
  if (from === 'BUILDS') return (Playground.BUILDS || []).map(b => b.name);
  return Playground[from] || [];
}

// Number of choices for a slot (for Randomize): swatch = palette length,
// accent = palette length + 1 (the Auto sentinel), label = options length.
function characterSchemaCount(entry) {
  if (entry.control === 'swatch') {
    return ((typeof Playground !== 'undefined' && Playground[entry.palette]) || []).length;
  }
  if (entry.control === 'accent') {
    return ((typeof Playground !== 'undefined' && Playground[entry.palette]) || []).length + 1;
  }
  return characterSchemaOptions(entry).length;
}
