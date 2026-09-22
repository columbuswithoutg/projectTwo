// Messages inbox bookkeeping shared by routes/messages.js (user sends) and
// routes/admin.js (report replies). Owns the one rule that spans both: a
// message to someone standing in /world is ALSO pushed to their Whisper tab
// live, and — because they saw it — is stored already read.
const Message = require('../models/Message');
const MessagingLogic = require('../js/messaging-logic');
const WorldSocket = require('../routes/world-socket');

const { pairKey, adminPairKey } = MessagingLogic;

// Wire shape for one message. `mine` is computed server-side so the client
// never needs its own user id.
function shape(doc, meId) {
    return {
        id: String(doc._id),
        text: doc.text,
        createdAt: doc.createdAt,
        readAt: doc.readAt || null,
        mine: !!doc.sender && String(doc.sender) === String(meId),
        kind: doc.kind || 'dm',
        reportId: doc.reportId ? String(doc.reportId) : null,
        system: doc.system || null
    };
}

// User → user. `recipient` is { _id, username }. Returns the created doc.
async function sendDirect({ senderId, senderUsername, recipient, text, kind = 'dm' }) {
    const delivered = WorldSocket.deliverWhisper(recipient._id, {
        channel: 'whisper', id: 'inbox', username: senderUsername, to: recipient.username, text
    });
    return Message.create({
        sender: senderId,
        recipient: recipient._id,
        pairKey: pairKey(senderId, recipient._id),
        kind,
        text,
        readAt: delivered > 0 ? new Date() : null
    });
}

// Reserved "Admin" sender (no User document). Not pushed live — the unread
// badge poll surfaces it, and there's no reserved-name collision to worry
// about with real players' whisper tabs.
function sendSystem({ recipientId, text, kind = 'report-reply', reportId = null }) {
    return Message.create({
        sender: null,
        system: MessagingLogic.SYSTEM_ADMIN,
        recipient: recipientId,
        pairKey: adminPairKey(recipientId),
        kind,
        reportId,
        text: String(text).slice(0, MessagingLogic.C.DM_MAX_LEN)
    });
}

function unreadCount(userId) {
    return Message.countDocuments({ recipient: userId, readAt: null });
}

module.exports = { shape, sendDirect, sendSystem, unreadCount };
