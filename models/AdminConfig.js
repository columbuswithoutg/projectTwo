const mongoose = require('mongoose');

// Singleton document — there is exactly one AdminConfig row, always
// accessed via findOneAndUpdate({}, ..., {upsert:true}). Mirrors the
// gameplay-relevant subset of the PHYSICS object in js/walkers.js. The
// default-valued fields below are the factory defaults the Reset button
// restores to.
const AdminConfigSchema = new mongoose.Schema({
  walker: {
    speed:    { type: Number, default: 40, min: 10, max: 120 },
    pauseMin: { type: Number, default: 800, min: 0, max: 5000 },
    pauseMax: { type: Number, default: 2500, min: 500, max: 8000 }
  },
  encounter: {
    dist:     { type: Number, default: 26, min: 10, max: 80 },
    cooldown: { type: Number, default: 30000, min: 5000, max: 120000 }
  },
  fight: {
    spawnChance: { type: Number, default: 0.15, min: 0, max: 1 }
  },
  flags: {
    fightsEnabled:    { type: Boolean, default: false },
    dialoguesEnabled: { type: Boolean, default: true }
  },
  // Bumped on every save so the client can detect staleness. Currently
  // unused for cache busting (the boot-time fetch is fresh per page load),
  // but reserved so a future ETag/SSE push has a comparison value.
  version:   { type: Number, default: 1 },
  updatedBy: { type: String, default: '' }
}, { timestamps: true });

// Factory defaults exposed for the /reset endpoint and for the public
// fallback when no config doc exists yet. Single source of truth — keep
// in sync with the schema defaults above.
AdminConfigSchema.statics.defaults = function () {
  return {
    walker:    { speed: 40, pauseMin: 800, pauseMax: 2500 },
    encounter: { dist: 26, cooldown: 30000 },
    fight:     { spawnChance: 0.15 },
    flags:     { fightsEnabled: false, dialoguesEnabled: true }
  };
};

module.exports = mongoose.model('AdminConfig', AdminConfigSchema);
