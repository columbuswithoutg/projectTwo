const mongoose = require('mongoose');

// Append-only forensic log of admin actions. Every destructive admin
// endpoint writes one row; the admin UI surfaces this as the audit tab.
// Writes are best-effort (fire-and-forget) so a Mongo blip can't block
// the actual admin action — the gap will be visible in monitoring.
const AuditLogSchema = new mongoose.Schema({
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  actorUsername: { type: String, required: true },
  action: {
    type: String,
    required: true,
    enum: [
      'ban', 'unban', 'deleteUser', 'deleteMemory',
      'resetPassword', 'configChange', 'contentEdit',
      'deleteFriendRequest'
    ]
  },
  // target is intentionally Mixed — userId for user-actions, {userId,
  // projectId, url} for memories, friendId for friend rows, etc.
  target: { type: mongoose.Schema.Types.Mixed, default: null },
  meta: { type: mongoose.Schema.Types.Mixed, default: null },
  ip: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now, index: true }
});

AuditLogSchema.index({ actor: 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', AuditLogSchema);
