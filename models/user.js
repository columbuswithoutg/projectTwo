const mongoose = require('mongoose');

const WatchEntrySchema = new mongoose.Schema({
  projectId: { type: String, required: true },
  count: { type: Number, default: 1 },
  watchedWith: [{ type: String, default: [] }], // stores usernames
  memories: [{
    url: { type: String },
    type: { type: String, enum: ['image', 'video'] },
    caption: { type: String, default: '' },
    uploadedAt: { type: Date, default: Date.now }
  }]
}, { _id: false });

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  watchedProjects: { type: [WatchEntrySchema], default: [] },
  profilePicture: { type: String, default: '' },
  walkers: { type: mongoose.Schema.Types.Mixed, default: [] },
  // Daily Infinity Stone hunt (/world). Shape:
  //   { days: { 'YYYY-MM-DD': { collected: ['space',...], completedAt: Date|null } },
  //     streak: Number, bestStreak: Number }
  // Days older than 30 days are pruned on write (routes/progress.js).
  stoneHunt: { type: mongoose.Schema.Types.Mixed, default: {} },
  // Admin-panel fields. isAdmin is set manually in MongoDB (no public path
  // to admin promotion). banned/bannedAt/banReason gate the user out of the
  // app; tokenVersion is bumped on ban so existing JWTs invalidate without
  // a per-request DB hit on the common path (compare claim vs stored).
  isAdmin: { type: Boolean, default: false, index: true },
  banned: { type: Boolean, default: false, index: true },
  bannedAt: { type: Date, default: null },
  banReason: { type: String, default: '', maxlength: 280 },
  tokenVersion: { type: Number, default: 0 },
  // Last time this user made an authed request. Updated by the auth
  // middleware at most once per minute per user (throttled in-memory) so
  // the "online" badge in the admin Users tab doesn't 2x our DB writes.
  lastActiveAt: { type: Date, default: null, index: true },
  // /home playground character — the layered SVG / 3D rig built via the
  // in-app character builder. Each value is a small integer index into the
  // option arrays defined client-side in js/playground.js (palettes) and
  // both renderers (playground.js + playground3d.js for hair/face/hat/etc.).
  // Stays unset (null) until the user saves their first build, which is
  // also the cue that triggers the builder modal automatically on first
  // visit (the `character.skin == null` check in views/home.js).
  // Slots: skin, hair (style+color), shirt, pants, eyes (color+shape),
  // facial hair (style+color), glasses, hat, shoes.
  // `build` (body size/bulk) and `gear` (hero gear set) were added for the
  // Avengers presets; `skin` max bumped 11→12 for the Hulk green tone. Option
  // counts mirror js/playground.js + routes/profile.js — keep all three in sync.
  homeCharacter: {
    skin:            { type: Number, default: null, min: 0, max: 12 },
    hairStyle:       { type: Number, default: null, min: 0, max: 13 },
    hairColor:       { type: Number, default: null, min: 0, max: 13 },
    shirtColor:      { type: Number, default: null, min: 0, max: 15 },
    pantsColor:      { type: Number, default: null, min: 0, max: 15 },
    eyeColor:        { type: Number, default: null, min: 0, max: 7 },
    eyeShape:        { type: Number, default: null, min: 0, max: 4 },
    facialHairStyle: { type: Number, default: null, min: 0, max: 5 },
    facialHairColor: { type: Number, default: null, min: 0, max: 13 },
    glasses:         { type: Number, default: null, min: 0, max: 4 },
    hat:             { type: Number, default: null, min: 0, max: 4 },
    shoeColor:       { type: Number, default: null, min: 0, max: 7 },
    build:           { type: Number, default: null, min: 0, max: 3 },
    gear:            { type: Number, default: null, min: 0, max: 6 },   // DEPRECATED (round 2): ignored by renderer; kept for old docs
    // Clothing SHAPE slots — maxes mirror js/playground.js array lengths +
    // routes/profile.js HOME_CHARACTER_RANGES. Keep all three in sync. 0 =
    // legacy/plain for shirt/pants/shoe, 0 = None for the rest.
    shirtStyle:      { type: Number, default: null, min: 0, max: 8 },
    pantsStyle:      { type: Number, default: null, min: 0, max: 6 },
    shoeStyle:       { type: Number, default: null, min: 0, max: 6 },
    outerwear:       { type: Number, default: null, min: 0, max: 6 },
    outerwearColor:  { type: Number, default: null, min: 0, max: 15 },
    suit:            { type: Number, default: null, min: 0, max: 5 },
    suitColor:       { type: Number, default: null, min: 0, max: 7 },
    gloves:          { type: Number, default: null, min: 0, max: 3 },
    belt:            { type: Number, default: null, min: 0, max: 3 },
    mask:            { type: Number, default: null, min: 0, max: 4 },
    accessoryColor:  { type: Number, default: null, min: 0, max: 5 },
    // Round 2: gender, accent/secondary colors (max = palette.length due to the
    // "Auto" sentinel at index 0), reusable hero slots + their colors.
    gender:          { type: Number, default: null, min: 0, max: 2 },
    shirtColor2:     { type: Number, default: null, min: 0, max: 16 },
    pantsColor2:     { type: Number, default: null, min: 0, max: 16 },
    outerwearColor2: { type: Number, default: null, min: 0, max: 16 },
    shoeColor2:      { type: Number, default: null, min: 0, max: 8 },
    helmet:          { type: Number, default: null, min: 0, max: 6 },
    helmetColor:     { type: Number, default: null, min: 0, max: 15 },
    prop:            { type: Number, default: null, min: 0, max: 6 },
    propColor:       { type: Number, default: null, min: 0, max: 15 },
    emblem:          { type: Number, default: null, min: 0, max: 7 },
    emblemColor:     { type: Number, default: null, min: 0, max: 15 }
  },
  // Project-themed room layout for /home. Each room is a 1×1 grid cell;
  // world-space cell size + wall/doorway geometry are derived at render time
  // (see js/playground3d.js). The room count is gated server-side to
  // floor(watchedProjects.length / 2) — see routes/profile.js validation.
  homeLayout: {
    rooms: {
      type: [{
        projectId: { type: String, required: true },
        gx:        { type: Number, required: true },
        gy:        { type: Number, required: true },
        _id: false
      }],
      default: []
    }
  }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);