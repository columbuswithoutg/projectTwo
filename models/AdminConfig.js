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
    dialoguesEnabled: { type: Boolean, default: true },
    // Global on/off for the /world Infinity Stone hunt + snap PvP event. Unlike
    // the two above (per-user defaults), this is an authoritative global switch:
    // the server refuses stone grabs/snaps and the client hides the HUD when off.
    // Defaults off — it's an opt-in event the admin turns on.
    worldEventStonesEnabled: { type: Boolean, default: false }
  },
  // /world settings. npcBodyTypes: body for each hero NPC, keyed by NPC id
  // (WorldNpcLogic.NPC_IDS, e.g. 'npc_hulk') — 0 = Realistic (rigged human),
  // 1 = Box (the original blocky body); mirrors Playground.BODY_TYPES. A hero
  // with no entry is Realistic. Global: every player sees the same NPCs.
  world: {
    npcBodyTypes: { type: Map, of: { type: Number, min: 0, max: 1 }, default: {} },
    // How many props a keeper may place in one house (WorldHouseLogic
    // C.MAX_PROPS is the fallback when no setting exists).
    maxProps: { type: Number, default: 20, min: 1, max: 60 },
    // Same cap for each room of a player's /home (edited by the owner only).
    homeMaxProps: { type: Number, default: 20, min: 1, max: 60 }
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
    flags:     { fightsEnabled: false, dialoguesEnabled: true, worldEventStonesEnabled: false },
    world:     { npcBodyTypes: {}, maxProps: 20, homeMaxProps: 20 }
  };
};

module.exports = mongoose.model('AdminConfig', AdminConfigSchema);
