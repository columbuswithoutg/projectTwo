/************************************************
 * /api/reports — bug reports, suggestions & requests (user side)
 *
 * A user files a report, sees their own list with the admin's status and
 * replies, and can reply back on an open thread. A request (kind
 * 'request') asks the admin to change something on the account — mark
 * titles watched, undo a watch, fix a count, add a title, rename, delete
 * the account; rules in server/user-requests.js. One open request of each
 * type at a time, and an unhandled one can be withdrawn. The admin side lives in
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
const Requests = require('../server/user-requests');
const watchRules = require('../server/watchRules');
const Username = require('../server/username');

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
        replies: (d.replies || []).map(shapeReply),
        // kind 'request': what was asked and, once handled, the outcome
        // (the admin's name stays out, like on replies).
        request: d.request ? shapeRequest(d.request) : null
    };
}

function shapeRequest(r) {
    const res = r.resolution && r.resolution.outcome
        ? { outcome: r.resolution.outcome, at: r.resolution.at || null, added: r.resolution.added || [], skipped: r.resolution.skipped || [] }
        : null;
    return {
        type: r.type,
        projectIds: r.projectIds || [],
        projectId: r.projectId || '',
        count: r.count || null,
        title: r.title || '',
        newUsername: r.newUsername || '',
        resolution: res
    };
}

router.post('/', auth, async (req, res) => {
    const isRequest = req.body && req.body.kind === 'request';
    const v = isRequest ? L.validateRequest(req.body) : L.validateReport(req.body);
    if (!v.ok) return res.status(400).json({ error: L.errorText(v.error), field: v.field });
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await Report.countDocuments({ user: req.user.id, createdAt: { $gte: since } });
    if (recent >= C.REPORTS_PER_HOUR) {
        return res.status(429).json({ error: 'You’ve sent a lot of reports recently — please try again in an hour.' });
    }
    const me = await User.findById(req.user.id).select(isRequest ? 'username watchedProjects.projectId watchedProjects.count' : 'username').lean();
    if (!me) return res.status(401).json({ error: 'Invalid token' });
    let report = v.report;
    if (isRequest) {
        // One open request of each type: the user withdraws (or waits on)
        // the one they have before sending another.
        const type = report.request.type;
        const waiting = await Report.findOne({ user: req.user.id, kind: 'request', 'request.type': type, status: { $in: Requests.OPEN_STATUSES } }).lean();
        if (waiting) {
            return res.status(409).json({ error: `You already have a “${L.REQUEST_LABEL[type]}” request waiting — withdraw it on My Reports to send a new one.`, reportId: String(waiting._id) });
        }
        const projects = await watchRules.allProjects();
        const checked = await Requests.checkNewRequest(report.request, me, projects, Username.exists);
        if (!checked.ok) return res.status(400).json({ error: checked.error });
        const titleOf = (id) => (projects.get(id) || {}).title;
        report = { ...report, request: checked.request, title: L.requestTitle(checked.request, titleOf) };
    }
    const doc = await Report.create({ ...report, user: req.user.id, username: me.username });
    res.status(201).json({ report: shapeReport(doc) });
});

// Withdraw a request the admin hasn't acted on yet (closes it).
router.post('/:id/withdraw', auth, async (req, res) => {
    if (!validId(req.params.id)) return res.status(404).json({ error: 'Not found' });
    const doc = await Report.findOne({ _id: req.params.id, user: req.user.id });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    if (doc.kind !== 'request') return res.status(400).json({ error: 'Only requests can be withdrawn.' });
    if (!Requests.OPEN_STATUSES.includes(doc.status) || (doc.request && doc.request.resolution && doc.request.resolution.outcome)) {
        return res.status(400).json({ error: 'The admin has already handled this request.' });
    }
    doc.status = 'closed';
    await doc.save();
    res.json({ report: shapeReport(doc) });
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
