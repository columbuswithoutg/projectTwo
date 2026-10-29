const mongoose = require('mongoose');
const Q = require('../js/quote-guess-logic');

// One line in an island's Quote Guess bank (CMS → Quotes). A line is drawn
// into games only when status 'approved' AND active. Player suggestions
// arrive 'pending' and wait in the admin queue; a rejected suggestion keeps
// its row so the same line can't be suggested again (unique textKey).
//
// The answers live here and never in the public project data: a game's
// rounds are built server-side (server/quote-guess-data.js) and only the
// current question reaches clients before its reveal.
const SpeakerSchema = new mongoose.Schema({
  name:        { type: String, required: true, maxlength: Q.C.MAX_SPEAKER },
  key:         { type: String, required: true },          // QuoteGuessLogic.norm(name)
  characterId: { type: String, default: null }            // portrait link (characters.js id), best-effort
}, { _id: false });

const ReplySchema = new mongoose.Schema({
  speaker: { type: SpeakerSchema, required: true },
  text:    { type: String, required: true, maxlength: Q.C.MAX_REPLY }
}, { _id: false });

const QuoteLineSchema = new mongoose.Schema({
  projectId:  { type: String, required: true },
  episode:    { type: Number, default: null },            // 0-based, series only
  timeSec:    { type: Number, default: null },            // within the episode / film (required on suggestions)
  speaker:    { type: SpeakerSchema, required: true },
  text:       { type: String, required: true, maxlength: Q.C.MAX_TEXT },
  textKey:    { type: String, required: true },
  reply:      { type: ReplySchema, default: null },
  note:       { type: String, default: '', maxlength: Q.C.MAX_NOTE },    // shown at the reveal
  source:     { type: String, default: '', maxlength: Q.C.MAX_SOURCE },  // where it was checked (admin only)
  decoys: {
    speakers: { type: [String], default: [] },
    replies:  { type: [String], default: [] }
  },
  active:     { type: Boolean, default: true },
  status:     { type: String, enum: Q.STATUSES, default: 'approved' },
  origin:     { type: String, enum: Q.ORIGINS, default: 'admin' },
  importId:   { type: String, default: null },            // one bulk import (undo / cleanup)
  addedBy:    { type: String, default: '' },
  suggestedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  suggestedByName: { type: String, default: '' },          // "Suggested by @…" at the reveal
  reviewedBy:   { type: String, default: '' },
  reviewedAt:   { type: Date, default: null },
  rejectReason: { type: String, default: '', maxlength: Q.C.MAX_REASON }
}, { timestamps: true });

// Draws and pool counts.
QuoteLineSchema.index({ projectId: 1, status: 1, active: 1 });
// The admin queue, oldest first.
QuoteLineSchema.index({ status: 1, createdAt: 1 });
// A player's suggestions (rate limits) and "Lines added".
QuoteLineSchema.index({ suggestedBy: 1, status: 1 });
QuoteLineSchema.index({ importId: 1 }, { sparse: true });
// One line once per island, whatever its status.
QuoteLineSchema.index({ projectId: 1, textKey: 1 }, { unique: true });

module.exports = mongoose.model('QuoteLine', QuoteLineSchema);
