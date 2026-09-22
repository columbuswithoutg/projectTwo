const mongoose = require('mongoose');

// One row per delivered message in the Messages inbox. Covers three sources:
//   whisper      — sent from /world chat (persisted here so it survives a
//                  reload and reaches players who are offline)
//   dm           — sent from the /messages page over HTTP
//   report-reply — an admin answered a bug/suggestion report; sender is null
//                  and `system` marks the reserved "Admin" conversation
// pairKey is the symmetric conversation key (js/messaging-logic.js pairKey /
// adminPairKey) so a thread can be paged with one indexed range query.
// readAt is null until the recipient opens the thread (or saw it live in
// /world), and is what the unread badge counts.
const MessageSchema = new mongoose.Schema({
  sender:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  system:    { type: String, enum: [null, 'admin'], default: null },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  pairKey:   { type: String, required: true },
  kind:      { type: String, enum: ['whisper', 'dm', 'report-reply'], default: 'dm' },
  reportId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Report', default: null },
  text:      { type: String, required: true, maxlength: 1000 },
  readAt:    { type: Date, default: null }
}, { timestamps: true });

MessageSchema.index({ pairKey: 1, createdAt: -1 });
MessageSchema.index({ recipient: 1, readAt: 1 });
MessageSchema.index({ recipient: 1, createdAt: -1 });
MessageSchema.index({ sender: 1, createdAt: -1 });

module.exports = mongoose.model('Message', MessageSchema);
