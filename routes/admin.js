const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const User = require('../models/user');
const Friend = require('../models/Friend');
const AuditLog = require('../models/AuditLog');
const AdminConfig = require('../models/AdminConfig');
const Project = require('../models/Project');
const Character = require('../models/Character');
const Location = require('../models/Location');
const Dialogue = require('../models/Dialogue');
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
    Friend.countDocuments({ $or: [{ requester: user._id }, { recipient: user._id }], status: 'accepted', type: 'friend' }),
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
  res.json({ days, buckets });
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
    Friend.deleteMany({ $or: [{ requester: req.params.id }, { recipient: req.params.id }] })
  ]);
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
        uploadedAt: '$watchedProjects.memories.uploadedAt'
    }},
    { $sort: { uploadedAt: -1 } }
  ];

  const [items, totalAgg] = await Promise.all([
    User.aggregate([...pipeline, { $skip: skip }, { $limit: limit }]),
    User.aggregate([...pipeline, { $count: 'n' }])
  ]);
  const total = totalAgg[0]?.n || 0;
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

  const result = await User.updateOne(
    { _id: userId, 'watchedProjects.projectId': projectId },
    { $pull: { 'watchedProjects.$.memories': { url } } }
  );
  if (result.matchedCount === 0) {
    return res.status(404).json({ error: 'Memory not found' });
  }

  // Cloudinary destroy is fire-and-forget — the Mongo write is the source
  // of truth for visibility, the cloud delete just reclaims storage.
  const parsed = parseCloudinary(url);
  if (parsed) {
    cloudinary.uploader.destroy(parsed.public_id, { resource_type: parsed.resource_type })
      .catch(err => console.error('Cloudinary destroy failed:', err && err.message));
  }
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
  'fight.spawnChance': { min: 0, max: 1 }
};

function pickNumber(value, rule) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < rule.min || value > rule.max) return null;
  return value;
}

function diffConfig(prev, next) {
  const out = {};
  const sections = ['walker', 'encounter', 'fight', 'flags'];
  for (const sec of sections) {
    const p = (prev && prev[sec]) || {};
    const n = (next && next[sec]) || {};
    for (const k of Object.keys(n)) {
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
        errors[path] = `must be a number between ${rule.min} and ${rule.max}`;
      } else {
        update[`${sec}.${key}`] = v;
      }
    }
  }

  if (body.flags && typeof body.flags === 'object') {
    if ('fightsEnabled' in body.flags) update['flags.fightsEnabled'] = !!body.flags.fightsEnabled;
    if ('dialoguesEnabled' in body.flags) update['flags.dialoguesEnabled'] = !!body.flags.dialoguesEnabled;
    if ('worldEventStonesEnabled' in body.flags) update['flags.worldEventStonesEnabled'] = !!body.flags.worldEventStonesEnabled;
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
  if (Array.isArray(body.prerequisites)) {
    out.prerequisites = body.prerequisites
      .filter(p => typeof p === 'string' && ID_REGEX.test(p))
      .slice(0, PREREQ_MAX);
  } else {
    out.prerequisites = [];
  }
  out.phase = trimStr(body.phase || '', 40);
  out.gridX = Number.isFinite(body.gridX) ? body.gridX : 0;
  out.gridY = Number.isFinite(body.gridY) ? body.gridY : 0;
  out.location = trimStr(body.location || '', 80);
  out.image = trimStr(body.image || '', 200);
  return { out, errors };
}

router.get('/content/projects', async (req, res) => {
  const items = await Project.find({}).sort({ release: 1, gridY: 1, gridX: 1 }).lean();
  res.json({ items });
});

router.post('/content/projects', async (req, res) => {
  const { out, errors } = sanitizeProject(req.body || {}, true);
  if (Object.keys(errors).length) return badRequest(res, 'Validation failed', errors);
  const exists = await Project.exists({ id: out.id });
  if (exists) return badRequest(res, 'A project with that id already exists', { id: 'duplicate' });
  await Project.create(out);
  logAudit(req, 'contentEdit', { type: 'project', id: out.id }, { action: 'create' });
  res.json(out);
});

router.put('/content/projects/:id', async (req, res) => {
  const { out, errors } = sanitizeProject(req.body || {}, false);
  if (Object.keys(errors).length) return badRequest(res, 'Validation failed', errors);
  const before = await Project.findOne({ id: req.params.id }).lean();
  if (!before) return res.status(404).json({ error: 'Not found' });
  const after = await Project.findOneAndUpdate({ id: req.params.id }, out, { new: true }).lean();
  logAudit(req, 'contentEdit', { type: 'project', id: req.params.id }, { action: 'update' });
  res.json(after);
});

router.delete('/content/projects/:id', async (req, res) => {
  const r = await Project.deleteOne({ id: req.params.id });
  if (r.deletedCount === 0) return res.status(404).json({ error: 'Not found' });
  logAudit(req, 'contentEdit', { type: 'project', id: req.params.id }, { action: 'delete' });
  res.json({ message: 'Deleted' });
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

module.exports = router;
