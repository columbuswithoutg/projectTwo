const mongoose = require('mongoose');

// Singleton document holding the entire walker-dialogues dataset. Three
// top-level objects mirror the IIFE's internal data in
// js/walker-dialogues.js:
//
//   pairs               — keyed by "id1|id2" (alphabetically sorted) → array
//                         of { requires, lines, startsWith? } exchanges.
//   villainDefeatLines  — keyed by villain id → array of strings shown
//                         when that villain's HP reaches zero.
//   villainVictoryLines — keyed by villain id → array of strings shown
//                         when the villain wins.
//
// We use Mixed because the structure is intrinsically a free-shape Map,
// not a finite list of subdocuments. Schema enforcement happens at the
// API layer (routes/admin.js) when the admin saves an edit.
const DialogueSchema = new mongoose.Schema({
  pairs:               { type: mongoose.Schema.Types.Mixed, default: {} },
  villainDefeatLines:  { type: mongoose.Schema.Types.Mixed, default: {} },
  villainVictoryLines: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true, minimize: false });

module.exports = mongoose.model('Dialogue', DialogueSchema);
