const mongoose = require('mongoose');

const FriendSchema = new mongoose.Schema({
    requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    type: { type: String, enum: ['friend', 'watch'], default: 'friend' },
    projectId: { type: String, default: null },
    projectTitle: { type: String, default: null } // ← add this
}, { timestamps: true });

module.exports = mongoose.model('Friend', FriendSchema);