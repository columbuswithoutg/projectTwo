const mongoose = require('mongoose');

// Admin switch for one island's Scene Guess game (CMS → Scene stills). An
// island is live for players only when the global flag
// (AdminConfig.flags.sceneGuessEnabled) is on, this row says enabled, AND it
// has SceneGuessLogic.C.MIN_POOL active stills. No row = off, so a project
// with no screenshots never shows anything.
const SceneIslandSchema = new mongoose.Schema({
  projectId: { type: String, required: true, unique: true },
  enabled:   { type: Boolean, default: false },
  updatedBy: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('SceneIsland', SceneIslandSchema);
