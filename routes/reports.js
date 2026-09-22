/************************************************
 * /api/reports — bug reports & suggestions (user side)
 *
 * A user files a report, sees their own list with the admin's status and
 * replies, and can reply back on an open thread. The admin side lives in
 * routes/admin.js (list/filter, status, reply, delete). Every route is
 * authed; the mount in server.js adds the shared apiLimiter.
 ************************************************/
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Report = require('../models/Report');
const User = require('../models/user');
const auth = require('../middleware/auth');
const L = require('../js/messaging-logic');

const { C } = L;
const PAGE = 20;

function validId(id) {
    return typeof id === 'string' && mongoose.isValidObjectId(id);
}

// Replies as the reporting user sees them — an admin's username is never
// exposed, they're just "Admin".
function shapeReply(r) {
    return {
        id: String(r._id),
        from: r.isAdmin ? 'Admin' : (r.authorUsername || ''),
        isAdmin: !!r.isAdmin,
        text: r.text,
        createdAt: r.createdAt
    };
}

function shapeReport(d) {
    return {
        id: String(d._id),
        kind: d.kind,
        status: d.status,
        title: d.title,
        description: d.description,
        page: d.page || '',
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        lastReplyAt: d.lastReplyAt || null,
        replies: (d.replies || []).map(shapeReply)
    };
}

router.post('/', auth, async (req, res) => {
    const v = L.validateReport(req.body);
    if (!v.ok) return res.status(400).json({ error: L.errorText(v.error), field: v.field });
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await Report.countDocuments({ user: req.user.id, createdAt: { $gte: since } });
    if (recent >= C.REPORTS_PER_HOUR) {
        return res.status(429).json({ error: 'You’ve sent a lot of reports recently — please try again in an hour.' });
    }
    const me = await User.findById(req.user.id).select('username').lean();
    if (!me) return res.status(401).json({ error: 'Invalid token' });
    const doc = await Report.create({ ...v.report, user: req.user.id, username: me.username });
    res.status(201).json({ report: shapeReport(doc) });
});

router.get('/mine', auth, async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || PAGE));
    const filter = { user: req.user.id };
    const [items, total] = await Promise.all([
        Report.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        Report.countDocuments(filter)
    ]);
    res.json({ items: items.map(shapeReport), total, page, limit });
});

router.get('/:id', auth, async (req, res) => {
    if (!validId(req.params.id)) return res.status(404).json({ error: 'Not found' });
    const doc = await Report.findOne({ _id: req.params.id, user: req.user.id }).lean();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json({ report: shapeReport(doc) });
});

router.post('/:id/replies', auth, async (req, res) => {
    if (!validId(req.params.id)) return res.status(404).json({ error: 'Not found' });
    const v = L.validateReply(req.body);
    if (!v.ok) return res.status(400).json({ error: L.errorText(v.error) });
    const doc = await Report.findOne({ _id: req.params.id, user: req.user.id });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    if (doc.status === 'closed') return res.status(400).json({ error: 'This report is closed.' });
    if (doc.replies.length >= C.REPLIES_MAX) return res.status(400).json({ error: 'This thread is full.' });
    doc.replies.push({ author: req.user.id, authorUsername: doc.username, isAdmin: false, text: v.text });
    doc.lastReplyAt = new Date();
    await doc.save();
    res.json({ report: shapeReport(doc) });
});

module.exports = router;
