const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const User = require('../models/user');
const Friend = require('../models/Friend');
const AuditLog = require('../models/AuditLog');
const AdminConfig = require('../models/AdminConfig');
const WorldNpcLogic = require('../js/world-npc-logic');   // NPC_IDS for world.npcBodyTypes
const Project = require('../models/Project');
const watchRules = require('../server/watchRules');
const contentLoader = require('../server/contentLoader');
const ProjectLogic = require('../js/project-logic');      // prerequisite loops + free board cells
const { fillDailyBuckets } = require('../server/analytics');
const { friendFilter } = require('../server/friendship');
const Character = require('../models/Character');
const Location = require('../models/Location');
const Dialogue = require('../models/Dialogue');
const Report = require('../models/Report');
const ProjectStay = require('../models/ProjectStay');
const SceneScore = require('../models/SceneScore');
const FeedPost = require('../models/FeedPost');
const SceneData = require('../server/scene-guess-data');
const Messages = require('../server/messages');
const feed = require('../server/feed');
const MessagingLogic = require('../js/messaging-logic');
const auth = require('../middleware/auth');

// Cloudinary is already configured in routes/upload.js; the SDK is a
// singleton so reading env here would double-register. We rely on the
// upload route having loaded first to set credentials.

// Best-effort audit write. Never blocks the response — if Mongo is down
// the action still succeeds and the gap is visible in monitoring.
function logAudit(req, action, target, meta) {
  AuditLog.create({
    actor: req.adminUser.id,
    actorUsername: req.adminUser.username,
    action,
    target,
    meta: meta || null,
    ip: req.ip || ''
  }).catch(err => console.error('Audit log write failed:', err));
}

function clampPage(req) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
  return { page, limit, skip: (page - 1) * limit };
}

// -----------------------------------------------------------------------
// USERS
// -----------------------------------------------------------------------

router.get('/users', async (req, res) => {
  const { page, limit, skip } = clampPage(req);
  const q = (req.query.q || '').toString().trim();
  const filter = q ? { username: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } : {};

  const [items, total] = await Promise.all([
    User.find(filter)
      .select('username isAdmin banned bannedAt banReason createdAt lastActiveAt watchedProjects profilePicture')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter)
  ]);

  // Strip large nested arrays from list view — admin only needs counts
  const lite = items.map(u => ({
    _id: u._id,
    username: u.username,
    isAdmin: !!u.isAdmin,
    banned: !!u.banned,
    bannedAt: u.bannedAt,
    banReason: u.banReason,
    createdAt: u.createdAt,
    lastActiveAt: u.lastActiveAt || null,
    profilePicture: u.profilePicture || '',
    watchedCount: Array.isArray(u.watchedProjects) ? u.watchedProjects.length : 0,
    memoryCount: Array.isArray(u.watchedProjects)
      ? u.watchedProjects.reduce((sum, e) => sum + (Array.isArray(e.memories) ? e.memories.length : 0), 0)
      : 0
  }));

  res.json({ items: lite, total, page, limit });
});

router.get('/users/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  const user = await User.findById(req.params.id).select('-password').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });

  const [friendCount, pendingCount] = await Promise.all([
    // friendFilter also counts older friendships stored without a `type`.
    Friend.countDocuments(friendFilter(user._id)),
    Friend.countDocuments({ recipient: user._id, status: 'pending' })
  ]);

  res.json({ user, friendCount, pendingCount });
});

// Daily signup buckets for the analytics overview chart.
router.get('/users/stats/signups', async (req, res) => {
  const days = Math.max(1, Math.min(365, parseInt(req.query.days, 10) || 30));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const buckets = await User.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        count: { $sum: 1 }
    }},
    { $sort: { _id: 1 } }
  ]);
  // One bucket per UTC day, zeros included — the chart's axis means days.
  res.json({ days, buckets: fillDailyBuckets(buckets, days) });
});

router.delete('/users/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  if (req.params.id === req.adminUser.id) {
    return res.status(400).json({ error: "You can't delete your own admin account" });
  }
  const user = await User.findById(req.params.id).select('username isAdmin').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });

  await Promise.all([
    User.deleteOne({ _id: req.params.id }),
    Friend.deleteMany({ $or: [{ requester: req.params.id }, { recipient: req.params.id }] }),
    // Island stay time — otherwise a deleted user stays "keeper" of a house
    // and nobody can edit it until someone out-stays them.
    ProjectStay.deleteMany({ userId: req.params.id }),
    // Scene Guess bests — same reason: a deleted user's record (and crown)
    // would otherwise sit on the island forever.
    SceneScore.deleteMany({ userId: req.params.id })
  ]);
  SceneData.invalidate('board', null);
  auth.invalidateUser(req.params.id);
  logAudit(req, 'deleteUser', req.params.id, { username: user.username });
  res.json({ message: 'User deleted' });
});

router.post('/users/:id/password', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'Password must be 8–128 characters' });
  }
  const hashed = await bcrypt.hash(password, 10);
  // Bump tokenVersion to invalidate the user's existing sessions — a
  // password reset should always log out everywhere, otherwise a stolen
  // token outlives the reset.
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { password: hashed, $inc: { tokenVersion: 1 } },
    { new: true }
  ).select('username').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  auth.invalidateUser(req.params.id);
  logAudit(req, 'resetPassword', req.params.id, { username: user.username });
  res.json({ message: 'Password updated' });
});

router.post('/users/:id/ban', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  if (req.params.id === req.adminUser.id) {
    return res.status(400).json({ error: "You can't ban yourself" });
  }
  const reason = (req.body?.reason || '').toString().slice(0, 280);
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { banned: true, bannedAt: new Date(), banReason: reason, $inc: { tokenVersion: 1 } },
    { new: true }
  ).select('username').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  auth.invalidateUser(req.params.id);
  logAudit(req, 'ban', req.params.id, { username: user.username, reason });
  res.json({ message: 'User banned' });
});

router.post('/users/:id/unban', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { banned: false, bannedAt: null, banReason: '', $inc: { tokenVersion: 1 } },
    { new: true }
  ).select('username').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  auth.invalidateUser(req.params.id);
  logAudit(req, 'unban', req.params.id, { username: user.username });
  res.json({ message: 'User unbanned' });
});

// -----------------------------------------------------------------------
// MEMORIES (moderation)
// -----------------------------------------------------------------------

// Flatten every memory across every user into a paginated feed. We do this
// in the aggregation so the API can sort by uploadedAt globally and so
// pagination can skip into a known total.
router.get('/memories', async (req, res) => {
  const { page, limit, skip } = clampPage(req);
  const userIdFilter = req.query.userId && mongoose.isValidObjectId(req.query.userId)
    ? new mongoose.Types.ObjectId(req.query.userId)
    : null;

  const matchStage = userIdFilter ? { _id: userIdFilter } : {};
  // Photos live in two places: the project's Memories (watchedProjects) and
  // feed posts. Photos added on a mid-series episode post exist ONLY on the
  // post, so they were invisible here and couldn't be moderated — both
  // sources are listed now, de-duplicated by URL (the profile copy wins).
  const postPipeline = [
    { $match: { 'memories.0': { $exists: true } } },
    { $unwind: '$memories' },
    { $project: {
        _id: 0,
        userId: { $ifNull: ['$memories.by', '$author'] },
        projectId: '$projectId',
        url: '$memories.url',
        type: '$memories.type',
        caption: '$memories.caption',
        uploadedAt: '$createdAt',
        episode: '$episode',
        source: 'post'
    }},
    ...(userIdFilter ? [{ $match: { userId: userIdFilter } }] : []),
    { $lookup: { from: User.collection.name, localField: 'userId', foreignField: '_id', as: 'u',
                 pipeline: [{ $project: { username: 1 } }] } },
    { $addFields: { username: { $arrayElemAt: ['$u.username', 0] } } },
    { $project: { u: 0 } }
  ];
  const pipeline = [
    { $match: matchStage },
    { $unwind: '$watchedProjects' },
    { $unwind: '$watchedProjects.memories' },
    { $project: {
        _id: 0,
        userId: '$_id',
        username: '$username',
        projectId: '$watchedProjects.projectId',
        url: '$watchedProjects.memories.url',
        type: '$watchedProjects.memories.type',
        caption: '$watchedProjects.memories.caption',
        uploadedAt: '$watchedProjects.memories.uploadedAt',
        source: 'profile'
    }},
    { $unionWith: { coll: FeedPost.collection.name, pipeline: postPipeline } },
    { $sort: { source: -1 } },                       // 'profile' before 'post'
    { $group: { _id: '$url', doc: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$doc' } },
    { $sort: { uploadedAt: -1, url: 1 } }
  ];

  const [agg] = await User.aggregate([
    ...pipeline,
    { $facet: { items: [{ $skip: skip }, { $limit: limit }], total: [{ $count: 'n' }] } }
  ]);
  const items = (agg && agg.items) || [];
  const total = (agg && agg.total[0] && agg.total[0].n) || 0;
  res.json({ items, total, page, limit });
});

// Best-effort Cloudinary destroy. The URL pattern from CloudinaryStorage is
//   https://res.cloudinary.com/<cloud>/<resource_type>/upload/v<ver>/<public_id>.<ext>
// We extract the public_id and resource_type from the URL itself rather
// than trusting the client's `type` field.
function parseCloudinary(url) {
  if (typeof url !== 'string') return null;
  const m = url.match(/res\.cloudinary\.com\/[^/]+\/(image|video|raw)\/upload\/(?:[^/]+\/)*v\d+\/(.+?)\.[^.]+$/);
  if (!m) return null;
  return { resource_type: m[1], public_id: m[2] };
}

router.delete('/memories', async (req, res) => {
  const { userId, projectId, url } = req.body || {};
  if (!mongoose.isValidObjectId(userId)) return res.status(400).json({ error: 'Invalid userId' });
  if (typeof projectId !== 'string' || !projectId) return res.status(400).json({ error: 'Invalid projectId' });
  if (typeof url !== 'string' || !url) return res.status(400).json({ error: 'Invalid url' });

  // The photo may be on the project's Memories, on feed posts, or (episode
  // posts) only on a post — remove it everywhere it appears.
  const [result, posts] = await Promise.all([
    User.updateOne(
      { _id: userId, 'watchedProjects.projectId': projectId, 'watchedProjects.memories.url': url },
      { $pull: { 'watchedProjects.$.memories': { url } } }
    ),
    FeedPost.updateMany({ 'memories.url': url }, { $pull: { memories: { url } } })
  ]);
  if (result.modifiedCount === 0 && posts.modifiedCount === 0) {
    return res.status(404).json({ error: 'Memory not found' });
  }

  // Cloudinary destroy is fire-and-forget — the Mongo write is the source
  // of truth for visibility, the cloud delete just reclaims storage.
  const parsed = parseCloudinary(url);
  if (parsed) {
    cloudinary.uploader.destroy(parsed.public_id, { resource_type: parsed.resource_type, invalidate: true })
      .catch(err => console.error('Cloudinary destroy failed:', err && err.message));
  }
  // Same cleanup the user's own delete does — pull it out of friends' feeds.
  feed.removeMemory(userId, projectId, url);
  logAudit(req, 'deleteMemory', { userId, projectId, url }, null);
  res.json({ message: 'Memory deleted' });
});

// -----------------------------------------------------------------------
// FRIENDS (moderation)
// -----------------------------------------------------------------------

router.get('/friends/pending', async (req, res) => {
  const { page, limit, skip } = clampPage(req);
  const [items, total] = await Promise.all([
    Friend.find({ status: 'pending' })
      .populate('requester', 'username')
      .populate('recipient', 'username')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Friend.countDocuments({ status: 'pending' })
  ]);
  res.json({ items, total, page, limit });
});

router.delete('/friends/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid friend id' });
  }
  const doc = await Friend.findByIdAndDelete(req.params.id).lean();
  if (!doc) return res.status(404).json({ error: 'Not found' });
  logAudit(req, 'deleteFriendRequest', req.params.id, { requester: doc.requester, recipient: doc.recipient });
  res.json({ message: 'Friend record deleted' });
});

// -----------------------------------------------------------------------
// AUDIT
// -----------------------------------------------------------------------

router.get('/audit', async (req, res) => {
  const { page, limit, skip } = clampPage(req);
  const filter = {};
  if (req.query.action) filter.action = req.query.action;
  if (req.query.actorId && mongoose.isValidObjectId(req.query.actorId)) {
    filter.actor = req.query.actorId;
  }
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(filter)
  ]);
  res.json({ items, total, page, limit });
});

// -----------------------------------------------------------------------
// REPORTS — bug reports & suggestions filed by users (routes/reports.js is
// the user side). Replies are pushed to the user's Messages inbox as the
// reserved "Admin" sender so they notice them.
// -----------------------------------------------------------------------

function escapeRegexAdmin(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

router.get('/reports', async (req, res) => {
  const { page, limit, skip } = clampPage(req);
  const filter = {};
  if (MessagingLogic.isKind(req.query.kind)) filter.kind = req.query.kind;
  if (MessagingLogic.isStatus(req.query.status)) filter.status = req.query.status;
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  if (q) {
    const re = new RegExp(escapeRegexAdmin(q), 'i');
    filter.$or = [{ title: re }, { username: re }];
  }
  const [items, total] = await Promise.all([
    Report.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Report.countDocuments(filter)
  ]);
  res.json({ items, total, page, limit });
});

router.get('/reports/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid report id' });
  const doc = await Report.findById(req.params.id).lean();
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.json(doc);
});

router.patch('/reports/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid report id' });
  const status = req.body && req.body.status;
  if (!MessagingLogic.isStatus(status)) return res.status(400).json({ error: 'Invalid status' });
  const doc = await Report.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  const from = doc.status;
  doc.status = status;
  await doc.save();
  // Tell the reporter — a status change used to be invisible to them unless
  // it came with a reply. Best-effort, like the reply notification below.
  if (from !== status && await User.exists({ _id: doc.user })) {
    const label = doc.kind === 'bug' ? 'bug report' : 'suggestion';
    const STATUS_TEXT = {
      'open': 'is open again',
      'in-progress': 'is now being worked on',
      'fixed': 'has been fixed — thanks for reporting it!',
      'wontfix': "won't be changed for now",
      'closed': 'has been closed'
    };
    Messages.sendSystem({
      recipientId: doc.user,
      reportId: doc._id,
      text: `Your ${label} “${doc.title}” ${STATUS_TEXT[status] || `is now ${status}`}`.replace(/([^!.])$/, '$1.')
    }).catch(err => console.error('Report status → inbox failed:', err && err.message));
  }
  logAudit(req, 'reportStatus', req.params.id, { from, to: status, username: doc.username, title: doc.title });
  res.json(doc.toObject());
});

router.post('/reports/:id/replies', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid report id' });
  const v = MessagingLogic.validateReply(req.body);
  if (!v.ok) return res.status(400).json({ error: MessagingLogic.errorText(v.error) });
  const status = req.body && req.body.status;
  if (status !== undefined && status !== '' && !MessagingLogic.isStatus(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const doc = await Report.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  if (doc.replies.length >= MessagingLogic.C.REPLIES_MAX) return res.status(400).json({ error: 'Thread is full' });
  doc.replies.push({ author: req.adminUser.id, authorUsername: req.adminUser.username, isAdmin: true, text: v.text });
  doc.lastReplyAt = new Date();
  if (status) doc.status = status;
  await doc.save();

  // Surface the reply in the user's inbox. Best-effort: a missing user
  // (deleted since filing) or a Mongo blip must not fail the admin action.
  const userExists = await User.exists({ _id: doc.user });
  if (userExists) {
    const label = doc.kind === 'bug' ? 'bug report' : 'suggestion';
    Messages.sendSystem({
      recipientId: doc.user,
      reportId: doc._id,
      text: `Re: your ${label} “${doc.title}” — ${v.text}`
    }).catch(err => console.error('Report reply → inbox failed:', err && err.message));
  }
  logAudit(req, 'reportReply', req.params.id, { username: doc.username, title: doc.title, status: status || undefined });
  res.json(doc.toObject());
});

router.delete('/reports/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid report id' });
  const doc = await Report.findByIdAndDelete(req.params.id).lean();
  if (!doc) return res.status(404).json({ error: 'Not found' });
  logAudit(req, 'deleteReport', req.params.id, { username: doc.username, title: doc.title, kind: doc.kind });
  res.json({ message: 'Report deleted' });
});

// -----------------------------------------------------------------------
// OVERVIEW (Phase 2 starter — included in Phase 1 since it's trivial)
// -----------------------------------------------------------------------

// -----------------------------------------------------------------------
// CONFIG (Phase 2 — live walker physics tuning)
// -----------------------------------------------------------------------

// Validation rules — keep in sync with the schema constraints in
// models/AdminConfig.js. Returning "field: reason" lets the admin UI
// surface a precise error rather than a generic 400.
const CONFIG_RULES = {
  'walker.speed':      { min: 10, max: 120 },
  'walker.pauseMin':   { min: 0, max: 5000 },
  'walker.pauseMax':   { min: 500, max: 8000 },
  'encounter.dist':    { min: 10, max: 80 },
  'encounter.cooldown':{ min: 5000, max: 120000 },
  'fight.spawnChance': { min: 0, max: 1 },
  'world.maxProps':    { min: 1, max: 60, integer: true },
  'world.homeMaxProps':{ min: 1, max: 60, integer: true },
  'world.sceneRoundSec':{ min: 15, max: 60, integer: true }
};

// Per-NPC body type (world.npcBodyTypes): keys must be real NPC ids, values a
// Playground.BODY_TYPES index (0 Realistic, 1 Box).
const NPC_BODY_RULE = { min: 0, max: 1, integer: true };

function pickNumber(value, rule) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < rule.min || value > rule.max) return null;
  if (rule.integer && !Number.isInteger(value)) return null;
  return value;
}

function diffConfig(prev, next) {
  const out = {};
  const sections = ['walker', 'encounter', 'fight', 'flags', 'world'];
  for (const sec of sections) {
    const p = (prev && prev[sec]) || {};
    const n = (next && next[sec]) || {};
    for (const k of Object.keys(n)) {
      // One level of nesting (world.npcBodyTypes) — diff per NPC, not the map.
      if (n[k] && typeof n[k] === 'object') {
        const pk = (p[k] && typeof p[k] === 'object') ? p[k] : {};
        for (const kk of Object.keys(n[k])) {
          if (pk[kk] !== n[k][kk]) out[`${sec}.${k}.${kk}`] = { from: pk[kk], to: n[k][kk] };
        }
        continue;
      }
      if (p[k] !== n[k]) out[`${sec}.${k}`] = { from: p[k], to: n[k] };
    }
  }
  return out;
}

router.get('/config', async (req, res) => {
  const defaults = AdminConfig.defaults();
  const doc = await AdminConfig.findOne({}).lean();
  if (!doc) {
    return res.json({ ...defaults, version: 0, updatedBy: '', updatedAt: null });
  }
  res.json(doc);
});

router.put('/config', async (req, res) => {
  const body = req.body || {};
  const update = {};
  const errors = {};

  for (const [path, rule] of Object.entries(CONFIG_RULES)) {
    const [sec, key] = path.split('.');
    if (body[sec] && Object.prototype.hasOwnProperty.call(body[sec], key)) {
      const v = pickNumber(body[sec][key], rule);
      if (v === null) {
        errors[path] = rule.integer
          ? `must be a whole number between ${rule.min} and ${rule.max}`
          : `must be a number between ${rule.min} and ${rule.max}`;
      } else {
        update[`${sec}.${key}`] = v;
      }
    }
  }

  const npcBodies = body.world && body.world.npcBodyTypes;
  if (npcBodies !== undefined) {
    if (!npcBodies || typeof npcBodies !== 'object' || Array.isArray(npcBodies)) {
      errors['world.npcBodyTypes'] = 'must be an object of NPC id → body type';
    } else {
      for (const [id, raw] of Object.entries(npcBodies)) {
        if (!WorldNpcLogic.NPC_IDS.includes(id)) { errors['world.npcBodyTypes.' + id] = 'unknown NPC'; continue; }
        const v = pickNumber(raw, NPC_BODY_RULE);
        if (v === null) errors['world.npcBodyTypes.' + id] = 'must be 0 (Realistic) or 1 (Box)';
        else update['world.npcBodyTypes.' + id] = v;
      }
    }
  }

  if (body.flags && typeof body.flags === 'object') {
    if ('fightsEnabled' in body.flags) update['flags.fightsEnabled'] = !!body.flags.fightsEnabled;
    if ('dialoguesEnabled' in body.flags) update['flags.dialoguesEnabled'] = !!body.flags.dialoguesEnabled;
    if ('worldEventStonesEnabled' in body.flags) update['flags.worldEventStonesEnabled'] = !!body.flags.worldEventStonesEnabled;
    if ('sceneGuessEnabled' in body.flags) update['flags.sceneGuessEnabled'] = !!body.flags.sceneGuessEnabled;
  }

  // pauseMin must be < pauseMax — silently swap if both updated and inverted
  // would lock walkers in a bad state at frame time.
  const newMin = update['walker.pauseMin'];
  const newMax = update['walker.pauseMax'];
  if (typeof newMin === 'number' && typeof newMax === 'number' && newMin >= newMax) {
    errors['walker.pauseMin'] = 'must be less than pauseMax';
  }

  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Validation failed', fields: errors });
  }
  if (!Object.keys(update).length) {
    return res.status(400).json({ error: 'No editable fields provided' });
  }

  const before = await AdminConfig.findOne({}).lean();
  const after = await AdminConfig.findOneAndUpdate(
    {},
    {
      $set: { ...update, updatedBy: req.adminUser.username },
      $inc: { version: 1 }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  logAudit(req, 'configChange', null, { diff: diffConfig(before || AdminConfig.defaults(), after) });
  SceneData.invalidate('settings');   // Scene Guess on/off + round length apply at once
  res.json(after);
});

router.post('/config/reset', async (req, res) => {
  const before = await AdminConfig.findOne({}).lean();
  const defaults = AdminConfig.defaults();
  const after = await AdminConfig.findOneAndUpdate(
    {},
    {
      $set: { ...defaults, updatedBy: req.adminUser.username },
      $inc: { version: 1 }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  logAudit(req, 'configChange', null, { reset: true, diff: diffConfig(before || defaults, after) });
  SceneData.invalidate('settings');
  res.json(after);
});

// -----------------------------------------------------------------------
// OVERVIEW (Phase 2 starter — included in Phase 1 since it's trivial)
// -----------------------------------------------------------------------

router.get('/analytics/overview', async (req, res) => {
  const [users, banned, memoryAgg] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ banned: true }),
    User.aggregate([
      { $unwind: { path: '$watchedProjects', preserveNullAndEmptyArrays: false } },
      { $unwind: { path: '$watchedProjects.memories', preserveNullAndEmptyArrays: false } },
      { $count: 'n' }
    ])
  ]);
  res.json({
    users,
    banned,
    memories: memoryAgg[0]?.n || 0
  });
});

// -----------------------------------------------------------------------
// CONTENT CMS (Phase 3 — projects, characters, locations, dialogues)
// -----------------------------------------------------------------------

// id slugs are referenced from many places (project.prerequisites,
// character.debut, dialogue requires, watch progress) — we accept these
// chars and reject anything else. Renaming an id is therefore a delete +
// recreate flow, not an update; the editor disables the id field on
// existing rows.
const ID_REGEX = /^[a-z0-9_-]{1,80}$/i;

// String fields are bounded to keep documents sane and prevent a stuck
// admin from accidentally storing megabytes via copy-paste.
const STR_MAX = 280;
const STAGE_MAX = 20;
const PREREQ_MAX = 20;
const DIALOG_LINE_MAX = 600;
const DIALOG_LINES_MAX = 12;

function badRequest(res, msg, fields) {
  return res.status(400).json({ error: msg, fields: fields || undefined });
}

function trimStr(v, max = STR_MAX) {
  if (typeof v !== 'string') return '';
  return v.slice(0, max);
}

// ---------- Projects ----------

const GRID_MIN = -500, GRID_MAX = 500;

function _gridCoord(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(GRID_MIN, Math.min(GRID_MAX, Math.trunc(v)));
}

function sanitizeProject(body, requireId = true) {
  const errors = {};
  const out = {};
  if (requireId) {
    if (!ID_REGEX.test(body.id || '')) errors.id = 'invalid id';
    else out.id = body.id;
  }
  if (typeof body.title !== 'string' || !body.title.trim()) errors.title = 'required';
  else out.title = trimStr(body.title);
  out.release = trimStr(body.release || '', 40);
  // Prerequisite lists are checked by checkPrereqs() against the real
  // project list — bad, unknown, self or duplicate-list ids, a list over
  // PREREQ_MAX and lock loops are all explicit 400s now. (They used to be
  // dropped or truncated silently, and an unknown id locked a project forever.)
  out.prerequisites = Array.isArray(body.prerequisites) ? body.prerequisites : (body.prerequisites == null ? [] : body.prerequisites);
  out.recommendedPrerequisites = Array.isArray(body.recommendedPrerequisites)
    ? body.recommendedPrerequisites
    : (body.recommendedPrerequisites == null ? [] : body.recommendedPrerequisites);
  out.phase = trimStr(body.phase || '', 40);
  // Board position is owned by the CMS board editor (PUT
  // /content/projects/bulk/positions). Omit the keys entirely when the
  // caller doesn't send them so `Project.create` falls back to the schema
  // default and `findOneAndUpdate`'s $set leaves the stored coords
  // untouched — otherwise every plain form save (e.g. editing just the
  // title) would silently reset the project to (0,0).
  if (body.gridX !== undefined) out.gridX = _gridCoord(body.gridX);
  if (body.gridY !== undefined) out.gridY = _gridCoord(body.gridY);
  out.location = trimStr(body.location || '', 80);
  out.image = trimStr(body.image || '', 200);
  // Watch timer: minutes for a movie, or one entry per episode for a series
  // (a non-empty episode list makes it a series and runtime is ignored).
  out.episodes = watchRules.sanitizeEpisodes(body.episodes);
  out.runtime = out.episodes.length ? 0 : watchRules.sanitizeRuntime(body.runtime);
  return { out, errors };
}

// The public site falls back to the built-in projects.js while the
// collection is empty (routes/content.js). The first admin write must not
// replace those 84 titles with a one-project database, so every write seeds
// the collection from the built-in list first.
async function ensureProjectsSeeded() {
  if (await Project.exists({})) return;
  const items = contentLoader.get('projects') || [];
  if (!items.length) return;
  try {
    await Project.insertMany(items, { ordered: false });
  } catch (err) {
    // A concurrent seed (two admins at once) only duplicates ids — fine.
    if (err && err.code !== 11000 && !(err.writeErrors && err.writeErrors.every(e => e.code === 11000))) throw err;
  }
  watchRules.invalidate();
}

// Prerequisite rules on every project write. → { ok, required, recommended }
// or { status, body } to send. Loops include phase unlockers (Phase N waits
// for one title) and hidden prerequisites.
async function checkPrereqs(edit) {
  const all = await Project.find({}).select('id title phase prerequisites hiddenPrerequisites gridX gridY').lean();
  const titleOf = (id) => (all.find(p => p.id === id) || {}).title || id;
  const known = new Set(all.map(p => p.id));
  const v = ProjectLogic.validatePrereqLists(edit, known, { max: PREREQ_MAX });
  if (v.errors.length) {
    const first = v.errors[0];
    return { status: 400, body: { error: ProjectLogic.errorText(first, titleOf), problems: v.errors, ids: first.ids || [] } };
  }
  const cycle = ProjectLogic.findPrereqCycle(all, { ...edit, prerequisites: v.required },
    { phaseUnlockers: watchRules.PHASE_UNLOCKERS });
  if (cycle) {
    return {
      status: 400,
      body: { error: ProjectLogic.errorText({ code: 'cycle', path: cycle }, titleOf), cycle: cycle.map(s => s.id) }
    };
  }
  return { ok: true, all, required: v.required, recommended: v.recommended };
}

router.get('/content/projects', async (req, res) => {
  const items = await Project.find({}).sort({ release: 1, gridY: 1, gridX: 1 }).lean();
  if (items.length) return res.json({ source: 'db', items });
  // Empty collection: show what the site is actually serving (the built-in
  // list), so the editor and its prerequisite picker aren't blank.
  const fallback = (contentLoader.get('projects') || []).slice()
    .sort((a, b) => String(a.release || '').localeCompare(String(b.release || '')));
  res.json({ source: 'fallback', items: fallback });
});

router.post('/content/projects', async (req, res) => {
  const { out, errors } = sanitizeProject(req.body || {}, true);
  if (Object.keys(errors).length) return badRequest(res, 'Validation failed', errors);
  await ensureProjectsSeeded();
  const exists = await Project.exists({ id: out.id });
  if (exists) return badRequest(res, 'A project with that id already exists', { id: 'duplicate' });
  const check = await checkPrereqs(out);
  if (!check.ok) return res.status(check.status).json(check.body);
  out.prerequisites = check.required;
  out.recommendedPrerequisites = check.recommended;
  // A cell nobody else uses: the one asked for (409 + a suggestion if it's
  // taken), or the first free cell below the board.
  const occ = ProjectLogic.occupiedCells(check.all);
  if (out.gridX === undefined || out.gridY === undefined) {
    const cell = ProjectLogic.defaultNewCell(check.all);
    out.gridX = cell.gx;
    out.gridY = cell.gy;
  } else if (occ.has(`${out.gridX},${out.gridY}`)) {
    const takenBy = check.all.find(p => p.id === occ.get(`${out.gridX},${out.gridY}`));
    const free = ProjectLogic.firstFreeCell(occ, { anchor: { gx: out.gridX, gy: out.gridY } });
    return res.status(409).json({
      error: `Cell (${out.gridX}, ${out.gridY}) is taken by ${(takenBy && takenBy.title) || 'another project'}`,
      suggested: free ? { gridX: free.gx, gridY: free.gy } : null
    });
  }
  await Project.create(out);
  watchRules.invalidate();
  logAudit(req, 'contentEdit', { type: 'project', id: out.id }, { action: 'create' });
  res.json(out);
});

router.put('/content/projects/:id', async (req, res) => {
  const { out, errors } = sanitizeProject({ ...(req.body || {}), id: req.params.id }, false);
  if (Object.keys(errors).length) return badRequest(res, 'Validation failed', errors);
  await ensureProjectsSeeded();
  const before = await Project.findOne({ id: req.params.id }).lean();
  if (!before) return res.status(404).json({ error: 'Not found' });
  // Checked even when only the phase changed: a phase can close a loop too.
  const check = await checkPrereqs({ ...out, id: req.params.id, hiddenPrerequisites: before.hiddenPrerequisites || [] });
  if (!check.ok) return res.status(check.status).json(check.body);
  out.prerequisites = check.required;
  out.recommendedPrerequisites = check.recommended;
  const after = await Project.findOneAndUpdate({ id: req.params.id }, out, { new: true }).lean();
  watchRules.invalidate();
  logAudit(req, 'contentEdit', { type: 'project', id: req.params.id }, { action: 'update' });
  res.json(after);
});

router.delete('/content/projects/:id', async (req, res) => {
  await ensureProjectsSeeded();
  const r = await Project.deleteOne({ id: req.params.id });
  if (r.deletedCount === 0) return res.status(404).json({ error: 'Not found' });
  // Unlink it everywhere (the confirm dialog always promised this; nothing
  // did it, so dependants stayed locked behind a project that no longer exists).
  const id = req.params.id;
  const linked = await Project.find({
    $or: [{ prerequisites: id }, { recommendedPrerequisites: id }, { hiddenPrerequisites: id }]
  }).select('id').lean();
  if (linked.length) {
    await Project.updateMany({}, { $pull: { prerequisites: id, recommendedPrerequisites: id, hiddenPrerequisites: id } });
  }
  watchRules.invalidate();
  logAudit(req, 'contentEdit', { type: 'project', id }, { action: 'delete', unlinked: linked.map(p => p.id) });
  res.json({ message: 'Deleted', unlinked: linked.map(p => p.id) });
});

// Bulk position commit for the CMS "board" editor (drag-to-move). One
// request, one bulkWrite, one audit entry — instead of N separate PUTs each
// racking up their own audit row and their own round trip.
//
// PATH NOTE: the extra `bulk/` segment is deliberate. `PUT
// /content/projects/:id` is declared above, and "positions" would pass
// ID_REGEX, so a two-segment `/content/projects/positions` path would be
// silently swallowed by the :id route instead of reaching this handler.
const POSITIONS_MAX = 500;

router.put('/content/projects/bulk/positions', async (req, res) => {
  const body = req.body || {};
  if (!Array.isArray(body.positions)) {
    return badRequest(res, 'positions must be an array');
  }
  if (body.positions.length > POSITIONS_MAX) {
    return badRequest(res, `At most ${POSITIONS_MAX} positions per request`);
  }

  // --- shape validation ---------------------------------------------------
  const seen = new Set();
  const wanted = new Map(); // id -> { gridX, gridY }
  for (const p of body.positions) {
    if (!p || typeof p !== 'object') return badRequest(res, 'Invalid position entry');
    if (!ID_REGEX.test(p.id || '')) return badRequest(res, 'Invalid project id', { id: String(p.id) });
    if (seen.has(p.id)) return badRequest(res, 'Duplicate id in payload', { id: p.id });
    // Integers only — a fractional coord means a client bug, don't silently truncate it away.
    if (!Number.isInteger(p.gridX) || !Number.isInteger(p.gridY)) {
      return badRequest(res, 'gridX/gridY must be integers', { id: p.id });
    }
    if (p.gridX < GRID_MIN || p.gridX > GRID_MAX || p.gridY < GRID_MIN || p.gridY > GRID_MAX) {
      return badRequest(res, `Coordinates must be between ${GRID_MIN} and ${GRID_MAX}`, { id: p.id });
    }
    seen.add(p.id);
    wanted.set(p.id, { gridX: p.gridX, gridY: p.gridY });
  }

  // --- merge against current DB state -------------------------------------
  await ensureProjectsSeeded();
  const all = await Project.find({}).select('id gridX gridY').lean();
  const known = new Set(all.map(p => p.id));
  const unknown = [...wanted.keys()].filter(id => !known.has(id));
  if (unknown.length) return badRequest(res, 'Unknown project id(s)', { ids: unknown });

  const cells = new Map(); // "gx,gy" -> [id]
  const changes = [];
  for (const p of all) {
    const next = wanted.get(p.id) || { gridX: p.gridX | 0, gridY: p.gridY | 0 };
    const key = `${next.gridX},${next.gridY}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(p.id);
    if (wanted.has(p.id) && (next.gridX !== p.gridX || next.gridY !== p.gridY)) {
      changes.push({ id: p.id, from: { gridX: p.gridX, gridY: p.gridY }, to: next });
    }
  }

  // --- collision check on the MERGED state --------------------------------
  const conflicts = [...cells.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => {
      const [gridX, gridY] = key.split(',').map(Number);
      return { gridX, gridY, ids };
    });
  if (conflicts.length) {
    // 409, not 400: the payload itself is well-formed, the resulting state isn't.
    return res.status(409).json({ error: 'Two or more projects would share a cell', conflicts });
  }

  if (!changes.length) {
    const items = await Project.find({}).sort({ release: 1, gridY: 1, gridX: 1 }).lean();
    return res.json({ updated: 0, items });
  }

  await Project.bulkWrite(
    changes.map(c => ({
      updateOne: { filter: { id: c.id }, update: { $set: { gridX: c.to.gridX, gridY: c.to.gridY } } }
    })),
    { ordered: false }
  );

  logAudit(
    req,
    'contentEdit',
    { type: 'project', scope: 'positions', count: changes.length },
    { action: 'bulkPositions', changes: changes.slice(0, 200) } // meta is Mixed/unbounded — cap it
  );

  // Return the authoritative post-write list so the board re-seeds in one
  // round trip, and any concurrent admin's moves become visible immediately.
  const items = await Project.find({}).sort({ release: 1, gridY: 1, gridX: 1 }).lean();
  res.json({ updated: changes.length, items });
});

// ---------- Characters ----------

function sanitizeCharacter(body, requireId = true) {
  const errors = {};
  const out = {};
  if (requireId) {
    if (!ID_REGEX.test(body.id || '')) errors.id = 'invalid id';
    else out.id = body.id;
  }
  if (typeof body.name !== 'string' || !body.name.trim()) errors.name = 'required';
  else out.name = trimStr(body.name);
  out.debut = trimStr(body.debut || '', 80);
  out.image = trimStr(body.image || '', 200);
  out.stages = Array.isArray(body.stages)
    ? body.stages
        .map(s => s && typeof s === 'object' ? {
          after: trimStr(s.after || '', 80),
          image: trimStr(s.image || '', 200),
          look:  trimStr(s.look || '', STR_MAX)
        } : null)
        .filter(s => s && s.after)
        .slice(0, STAGE_MAX)
    : [];
  return { out, errors };
}

router.get('/content/characters', async (req, res) => {
  const items = await Character.find({}).sort({ name: 1 }).lean();
  res.json({ items });
});

router.post('/content/characters', async (req, res) => {
  const { out, errors } = sanitizeCharacter(req.body || {}, true);
  if (Object.keys(errors).length) return badRequest(res, 'Validation failed', errors);
  const exists = await Character.exists({ id: out.id });
  if (exists) return badRequest(res, 'A character with that id already exists', { id: 'duplicate' });
  await Character.create(out);
  logAudit(req, 'contentEdit', { type: 'character', id: out.id }, { action: 'create' });
  res.json(out);
});

router.put('/content/characters/:id', async (req, res) => {
  const { out, errors } = sanitizeCharacter(req.body || {}, false);
  if (Object.keys(errors).length) return badRequest(res, 'Validation failed', errors);
  const after = await Character.findOneAndUpdate({ id: req.params.id }, out, { new: true }).lean();
  if (!after) return res.status(404).json({ error: 'Not found' });
  logAudit(req, 'contentEdit', { type: 'character', id: req.params.id }, { action: 'update' });
  res.json(after);
});

router.delete('/content/characters/:id', async (req, res) => {
  const r = await Character.deleteOne({ id: req.params.id });
  if (r.deletedCount === 0) return res.status(404).json({ error: 'Not found' });
  logAudit(req, 'contentEdit', { type: 'character', id: req.params.id }, { action: 'delete' });
  res.json({ message: 'Deleted' });
});

// ---------- Locations ----------

function sanitizeLocation(body, requireId = true) {
  const errors = {};
  const out = {};
  if (requireId) {
    if (!ID_REGEX.test(body.id || '')) errors.id = 'invalid id';
    else out.id = body.id;
  }
  if (typeof body.label !== 'string' || !body.label.trim()) errors.label = 'required';
  else out.label = trimStr(body.label);
  out.worldX = Number.isFinite(body.worldX) ? body.worldX : 0;
  out.worldY = Number.isFinite(body.worldY) ? body.worldY : 0;
  out.width = Number.isFinite(body.width) && body.width > 0 ? body.width : 280;
  out.height = Number.isFinite(body.height) && body.height > 0 ? body.height : 200;
  out.clusterRadius = Number.isFinite(body.clusterRadius) && body.clusterRadius >= 0 ? body.clusterRadius : 100;
  out.region = trimStr(body.region || '', 60);
  return { out, errors };
}

router.get('/content/locations', async (req, res) => {
  const items = await Location.find({}).sort({ region: 1, label: 1 }).lean();
  res.json({ items });
});

router.post('/content/locations', async (req, res) => {
  const { out, errors } = sanitizeLocation(req.body || {}, true);
  if (Object.keys(errors).length) return badRequest(res, 'Validation failed', errors);
  const exists = await Location.exists({ id: out.id });
  if (exists) return badRequest(res, 'A location with that id already exists', { id: 'duplicate' });
  await Location.create(out);
  logAudit(req, 'contentEdit', { type: 'location', id: out.id }, { action: 'create' });
  res.json(out);
});

router.put('/content/locations/:id', async (req, res) => {
  const { out, errors } = sanitizeLocation(req.body || {}, false);
  if (Object.keys(errors).length) return badRequest(res, 'Validation failed', errors);
  const after = await Location.findOneAndUpdate({ id: req.params.id }, out, { new: true }).lean();
  if (!after) return res.status(404).json({ error: 'Not found' });
  logAudit(req, 'contentEdit', { type: 'location', id: req.params.id }, { action: 'update' });
  res.json(after);
});

router.delete('/content/locations/:id', async (req, res) => {
  const r = await Location.deleteOne({ id: req.params.id });
  if (r.deletedCount === 0) return res.status(404).json({ error: 'Not found' });
  logAudit(req, 'contentEdit', { type: 'location', id: req.params.id }, { action: 'delete' });
  res.json({ message: 'Deleted' });
});

// ---------- Dialogues (singleton document) ----------

// Pair keys must be "id1|id2" where both halves are valid ids and are
// in canonical (alphabetical) order. Reject anything that doesn't match;
// otherwise the runtime getDialogue lookup (which sorts the args before
// joining) will silently miss admin-saved entries with a non-canonical key.
const PAIR_KEY_REGEX = /^([a-z0-9_-]{1,80})\|([a-z0-9_-]{1,80})$/i;

function sanitizePairs(input) {
  if (!input || typeof input !== 'object') return {};
  const out = {};
  for (const [key, exchanges] of Object.entries(input)) {
    const m = PAIR_KEY_REGEX.exec(key);
    if (!m) continue;
    const [, a, b] = m;
    const sortedKey = [a, b].sort().join('|');
    if (sortedKey !== key) continue; // require canonical order
    if (!Array.isArray(exchanges)) continue;
    const cleaned = exchanges
      .map(e => e && typeof e === 'object' ? {
        requires: trimStr(e.requires || '', 80),
        startsWith: e.startsWith ? trimStr(e.startsWith, 80) : undefined,
        lines: Array.isArray(e.lines)
          ? e.lines.filter(l => typeof l === 'string').map(l => trimStr(l, DIALOG_LINE_MAX)).slice(0, DIALOG_LINES_MAX)
          : []
      } : null)
      .filter(e => e && e.requires && e.lines.length >= 2);
    if (cleaned.length > 0) out[key] = cleaned;
  }
  return out;
}

function sanitizeVillainLines(input) {
  if (!input || typeof input !== 'object') return {};
  const out = {};
  for (const [key, lines] of Object.entries(input)) {
    if (!ID_REGEX.test(key)) continue;
    if (!Array.isArray(lines)) continue;
    const cleaned = lines
      .filter(l => typeof l === 'string')
      .map(l => trimStr(l, DIALOG_LINE_MAX))
      .slice(0, DIALOG_LINES_MAX);
    if (cleaned.length > 0) out[key] = cleaned;
  }
  return out;
}

router.get('/content/dialogues', async (req, res) => {
  const doc = await Dialogue.findOne({}).lean();
  res.json(doc || { pairs: {}, villainDefeatLines: {}, villainVictoryLines: {} });
});

router.put('/content/dialogues', async (req, res) => {
  const body = req.body || {};
  const update = {
    pairs: sanitizePairs(body.pairs),
    villainDefeatLines: sanitizeVillainLines(body.villainDefeatLines),
    villainVictoryLines: sanitizeVillainLines(body.villainVictoryLines)
  };
  const after = await Dialogue.findOneAndUpdate(
    {},
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
  logAudit(req, 'contentEdit', { type: 'dialogues' }, {
    action: 'update',
    pairCount: Object.keys(update.pairs).length,
    defeatCount: Object.keys(update.villainDefeatLines).length,
    victoryCount: Object.keys(update.villainVictoryLines).length
  });
  res.json(after);
});

// Scene Guess stills + island boards (routes/admin-scenes.js). The audit
// writer and the Cloudinary URL parser stay private to this file and are
// handed over rather than moved.
router.use('/scenes', require('./admin-scenes')({ logAudit, parseCloudinary }));

module.exports = router;
