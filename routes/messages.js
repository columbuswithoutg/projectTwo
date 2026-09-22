/************************************************
 * /api/messages — the Messages inbox
 *
 * Persisted whispers + direct messages, one thread per pair of users, plus
 * the reserved "Admin" thread that bug/suggestion replies land in. Anyone
 * can message anyone by username (same rule as /world whispers). Every
 * route is authed; the mount in server.js adds the shared apiLimiter.
 ************************************************/
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Message = require('../models/Message');
const User = require('../models/user');
const auth = require('../middleware/auth');
const Messages = require('../server/messages');
const L = require('../js/messaging-logic');

const { C } = L;

function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findUserByName(name) {
    const clean = String(name || '').trim();
    if (!clean || clean.length > C.USERNAME_MAX) return null;
    return User.findOne({ username: { $regex: '^' + escapeRegex(clean) + '$', $options: 'i' } })
        .select('_id username profilePicture').lean();
}

function shapeUser(u) {
    return u ? { id: String(u._id), username: u.username, profilePicture: u.profilePicture || '' } : null;
}

// `before` cursor → Date or null (bad input = newest page).
function parseBefore(q) {
    if (!q) return null;
    const d = new Date(String(q));
    return isNaN(d) ? null : d;
}

// Per-user floor between sends — a bounded map in the same spirit as the
// lastActiveAt throttle in middleware/auth.js. Resets on deploy; fine.
const lastSend = new Map();
function tooSoon(userId) {
    const now = Date.now();
    const last = lastSend.get(userId) || 0;
    if (now - last < C.SEND_FLOOR_MS) return true;
    lastSend.set(userId, now);
    if (lastSend.size > 5000) lastSend.delete(lastSend.keys().next().value);
    return false;
}

// One page of a thread (oldest → newest) and mark the ones addressed to me
// as read. Returns { messages, nextBefore }.
async function threadPage(pairKey, meId, before) {
    const filter = { pairKey };
    if (before) filter.createdAt = { $lt: before };
    const docs = await Message.find(filter).sort({ createdAt: -1 }).limit(C.THREAD_PAGE + 1).lean();
    const hasMore = docs.length > C.THREAD_PAGE;
    const page = hasMore ? docs.slice(0, C.THREAD_PAGE) : docs;
    await Message.updateMany({ pairKey, recipient: meId, readAt: null }, { $set: { readAt: new Date() } });
    page.reverse();
    return {
        messages: page.map(d => Messages.shape(d, meId)),
        nextBefore: hasMore && page.length ? page[0].createdAt : null
    };
}

// Cheap, polled by the nav badge.
router.get('/unread-count', auth, async (req, res) => {
    const count = await Messages.unreadCount(req.user.id);
    res.json({ count });
});

// Conversation list: one row per pairKey, newest activity first.
router.get('/', auth, async (req, res) => {
    const me = new mongoose.Types.ObjectId(String(req.user.id));
    const rows = await Message.aggregate([
        { $match: { $or: [{ sender: me }, { recipient: me }] } },
        { $sort: { createdAt: -1 } },
        { $group: {
            _id: '$pairKey',
            last: { $first: '$$ROOT' },
            unread: { $sum: { $cond: [
                { $and: [{ $eq: ['$recipient', me] }, { $eq: ['$readAt', null] }] }, 1, 0
            ] } }
        } },
        { $sort: { 'last.createdAt': -1 } },
        { $limit: C.CONVERSATIONS_MAX }
    ]);

    // Resolve the "other" user of each pair in one query.
    const otherIds = [];
    for (const r of rows) {
        const m = r.last;
        if (m.system) continue;
        const other = String(m.sender) === String(me) ? m.recipient : m.sender;
        if (other) otherIds.push(other);
    }
    const users = otherIds.length
        ? await User.find({ _id: { $in: otherIds } }).select('_id username profilePicture').lean()
        : [];
    const byId = new Map(users.map(u => [String(u._id), u]));

    const conversations = rows.map(r => {
        const m = r.last;
        const otherId = m.system ? null : (String(m.sender) === String(me) ? m.recipient : m.sender);
        return {
            key: r._id,
            system: m.system || null,
            other: otherId ? shapeUser(byId.get(String(otherId))) : null,
            last: { text: m.text, createdAt: m.createdAt, mine: !!m.sender && String(m.sender) === String(me) },
            unread: r.unread
        };
    });
    res.json({ conversations });
});

// The reserved Admin thread (report replies).
router.get('/system', auth, async (req, res) => {
    const page = await threadPage(L.adminPairKey(req.user.id), req.user.id, parseBefore(req.query.before));
    res.json({ other: null, system: L.SYSTEM_ADMIN, ...page });
});

// Thread with one user, by username.
router.get('/with/:username', auth, async (req, res) => {
    const other = await findUserByName(req.params.username);
    if (!other) return res.status(404).json({ error: 'User not found' });
    const page = await threadPage(L.pairKey(req.user.id, other._id), req.user.id, parseBefore(req.query.before));
    res.json({ other: shapeUser(other), system: null, ...page });
});

// Send from the inbox page. Live-delivered to /world if they're there.
router.post('/', auth, async (req, res) => {
    const m = L.normalizeDm(req.body);
    if (!m.ok) return res.status(400).json({ error: L.errorText(m.error), code: m.error });
    const recipient = await findUserByName(m.to);
    if (!recipient) return res.status(404).json({ error: 'User not found' });
    if (String(recipient._id) === String(req.user.id)) {
        return res.status(400).json({ error: "You can't message yourself" });
    }
    if (tooSoon(req.user.id)) return res.status(429).json({ error: 'Slow down a little.' });
    const me = await User.findById(req.user.id).select('username').lean();
    if (!me) return res.status(401).json({ error: 'Invalid token' });
    const doc = await Messages.sendDirect({
        senderId: req.user.id, senderUsername: me.username, recipient, text: m.text, kind: 'dm'
    });
    res.status(201).json({ message: Messages.shape(doc, req.user.id), to: shapeUser(recipient) });
});

module.exports = router;
