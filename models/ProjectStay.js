const mongoose = require('mongoose');

// All-time active time (ms) a user has spent standing on a project's island
// in /world. Written by routes/world-socket.js in periodic $inc flushes (see
// js/world-stay-logic.js for the AFK rule); the top row per projectId is that
// island's "keeper" — the only user allowed to edit its house (WorldHouse).
// Own collection rather than a User sub-array: the write is a hot upsert-$inc
// and the keeper query is a per-project top-1, both awkward on embedded docs.
const ProjectStaySchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  projectId: { type: String, required: true },
  ms:        { type: Number, default: 0 }
}, { timestamps: true });

ProjectStaySchema.index({ userId: 1, projectId: 1 }, { unique: true });
// Keeper lookup: highest ms, ties to the earlier updatedAt.
ProjectStaySchema.index({ projectId: 1, ms: -1, updatedAt: 1 });

module.exports = mongoose.model('ProjectStay', ProjectStaySchema);
