const mongoose = require('mongoose');

// A player's Scene Guess record on one island: their best finished game,
// how often they've played, and — for whoever holds the island record —
// the still they picked to show on the island screen between games.
// The island champion is computed on read (top `best`, ties to the earlier
// `achievedAt`), the same way keepers come from ProjectStay; no role is
// stored. Own collection for the same reason as ProjectStay: per-project
// top-1 queries and atomic per-user upserts.
const SceneScoreSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  projectId:  { type: String, required: true },
  best:       { type: Number, default: 0 },
  // When `best` was set. Explicit (not updatedAt): a later, lower game must
  // not move the tie-break. Within one game the server staggers it by rank.
  achievedAt: { type: Date, default: null },
  plays:      { type: Number, default: 0 },
  // The 10 stills of the best game — the champion's pick comes from these.
  bestStills: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  pick:       { type: mongoose.Schema.Types.ObjectId, ref: 'SceneStill', default: null }
}, { timestamps: true });

SceneScoreSchema.index({ userId: 1, projectId: 1 }, { unique: true });
// Champion / board lookup: highest best, ties to the earlier achievedAt.
SceneScoreSchema.index({ projectId: 1, best: -1, achievedAt: 1 });

module.exports = mongoose.model('SceneScore', SceneScoreSchema);
