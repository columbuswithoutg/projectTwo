const mongoose = require('mongoose');

// A player's Quote Guess record on one island — the same shape and rules as
// models/SceneScore.js: best finished game, plays, and (for the record
// holder) the line they feature on the island screen between games.
const QuoteScoreSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  projectId:  { type: String, required: true },
  best:       { type: Number, default: 0 },
  achievedAt: { type: Date, default: null },
  plays:      { type: Number, default: 0 },
  // The 10 lines of the best game — the featured line comes from these.
  bestLines:  { type: [mongoose.Schema.Types.ObjectId], default: [] },
  pick:       { type: mongoose.Schema.Types.ObjectId, ref: 'QuoteLine', default: null }
}, { timestamps: true });

QuoteScoreSchema.index({ userId: 1, projectId: 1 }, { unique: true });
QuoteScoreSchema.index({ projectId: 1, best: -1, achievedAt: 1 });

module.exports = mongoose.model('QuoteScore', QuoteScoreSchema);
