const mongoose = require('mongoose');

const FriendSchema = new mongoose.Schema({
    requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    type: { type: String, enum: ['friend', 'watch'], default: 'friend' },
    projectId: { type: String, default: null },
    projectTitle: { type: String, default: null }
}, { timestamps: true });

// Every hot query filters on one of these fields; without an index Mongo does
// a collection scan on each friends/search/pending/list/progress call.
FriendSchema.index({ recipient: 1, status: 1, type: 1 });
FriendSchema.index({ requester: 1, recipient: 1, type: 1 });
// Prevents duplicate watch-requests for the same (requester, recipient,
// project) pair at the DB level — matches the app-level guard in
// routes/friends.js so we don't race under concurrent clicks.
FriendSchema.index(
    { requester: 1, recipient: 1, projectId: 1 },
    { unique: true, partialFilterExpression: { type: 'watch', status: 'pending' } }
);

module.exports = mongoose.model('Friend', FriendSchema);