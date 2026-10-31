const mongoose = require('mongoose');
const { REPORT_KINDS, REPORT_STATUSES, REQUEST_TYPES } = require('../js/messaging-logic');

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

// kind 'request' only: what the user asked the admin to do (fields per
// type, see js/messaging-logic.js validateRequest) and, once the admin has
// acted from the Reports tab, the outcome (server/user-requests.js).
const RequestSchema = new mongoose.Schema({
  type:        { type: String, enum: REQUEST_TYPES, required: true },
  projectIds:  { type: [String], default: undefined },
  projectId:   { type: String },
  count:       { type: Number },
  title:       { type: String, maxlength: 120 },
  newUsername: { type: String, maxlength: 30 },
  oldUsername: { type: String, maxlength: 40 },
  resolution: {
    outcome:  { type: String, enum: ['approved', 'rejected'] },
    by:       { type: String, default: '' },
    at:       { type: Date },
    // mark-watched: the titles actually added / already on the list.
    added:    { type: [String], default: undefined },
    skipped:  { type: [String], default: undefined }
  }
}, { _id: false });

const ReportSchema = new mongoose.Schema({
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  username:    { type: String, default: '' },
  kind:        { type: String, enum: REPORT_KINDS, required: true },
  status:      { type: String, enum: REPORT_STATUSES, default: 'open' },
  title:       { type: String, required: true, maxlength: 120 },
  // A request's note is optional; bugs and suggestions must say something.
  description: { type: String, required: function () { return this.kind !== 'request'; }, default: '', maxlength: 2000 },
  request:     { type: RequestSchema, default: undefined },
  page:        { type: String, default: '', maxlength: 200 },
  userAgent:   { type: String, default: '', maxlength: 300 },
  replies:     { type: [ReplySchema], default: [] },
  lastReplyAt: { type: Date, default: null }
}, { timestamps: true });

ReportSchema.index({ user: 1, createdAt: -1 });
ReportSchema.index({ status: 1, createdAt: -1 });
ReportSchema.index({ kind: 1, status: 1, createdAt: -1 });
// "One open request of each type": the user route checks it before filing.
ReportSchema.index({ user: 1, 'request.type': 1, status: 1 }, { partialFilterExpression: { kind: 'request' } });

module.exports = mongoose.model('Report', ReportSchema);
