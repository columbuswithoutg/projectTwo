const mongoose = require('mongoose');
const { REPORT_KINDS, REPORT_STATUSES } = require('../js/messaging-logic');

// A bug report or suggestion filed by a user. The admin Reports tab lists
// these, changes `status`, and replies; the user sees the same thread on
// /reports. `username` is denormalised so a report stays readable after
// its author is deleted. Replies are embedded (capped at REPLIES_MAX in
// the routes) — a report is a short support thread, not a chat.
const ReplySchema = new mongoose.Schema({
  author:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  authorUsername: { type: String, default: '' },
  isAdmin:        { type: Boolean, default: false },
  text:           { type: String, required: true, maxlength: 2000 },
  createdAt:      { type: Date, default: Date.now }
}, { _id: true });

const ReportSchema = new mongoose.Schema({
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  username:    { type: String, default: '' },
  kind:        { type: String, enum: REPORT_KINDS, required: true },
  status:      { type: String, enum: REPORT_STATUSES, default: 'open' },
  title:       { type: String, required: true, maxlength: 120 },
  description: { type: String, required: true, maxlength: 2000 },
  page:        { type: String, default: '', maxlength: 200 },
  userAgent:   { type: String, default: '', maxlength: 300 },
  replies:     { type: [ReplySchema], default: [] },
  lastReplyAt: { type: Date, default: null }
}, { timestamps: true });

ReportSchema.index({ user: 1, createdAt: -1 });
ReportSchema.index({ status: 1, createdAt: -1 });
ReportSchema.index({ kind: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('Report', ReportSchema);
