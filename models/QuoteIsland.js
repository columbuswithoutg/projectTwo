const mongoose = require('mongoose');

// Admin switch for one island's Quote Guess game (CMS → Quotes). An island
// is live for players only when the global flag
// (AdminConfig.flags.quoteGuessEnabled) is on, this row says enabled, AND
// its bank is playable (QuoteGuessLogic.playable). No row = off.
// `acceptSuggestions` lets players suggest lines here even before the island
// is live (the global flags.quoteSuggestEnabled gates it too).
const QuoteIslandSchema = new mongoose.Schema({
  projectId:         { type: String, required: true, unique: true },
  enabled:           { type: Boolean, default: false },
  acceptSuggestions: { type: Boolean, default: true },
  updatedBy:         { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('QuoteIsland', QuoteIslandSchema);
