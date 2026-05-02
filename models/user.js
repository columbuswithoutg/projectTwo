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
  // /home playground character — the four-slot layered SVG figure built
  // via the in-app character builder. Each value is a small integer index
  // into the option arrays defined client-side in js/playground.js. Stays
  // unset (null) until the user saves their first build, which is also
  // the cue that triggers the builder modal automatically on first visit.
  homeCharacter: {
    skin:        { type: Number, default: null, min: 0, max: 4 },
    hairStyle:   { type: Number, default: null, min: 0, max: 5 },
    hairColor:   { type: Number, default: null, min: 0, max: 5 },
    shirtColor:  { type: Number, default: null, min: 0, max: 7 },
    pantsColor:  { type: Number, default: null, min: 0, max: 7 }
  }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);