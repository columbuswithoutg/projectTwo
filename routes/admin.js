const express = require('express');
const router = express.Router();
const { passwordError, hashPassword } = require('../server/password');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const User = require('../models/user');
const Friend = require('../models/Friend');
const AuditLog = require('../models/AuditLog');
const AdminConfig = require('../models/AdminConfig');
const WorldNpcLogic = require('../js/world-npc-logic');   // NPC_IDS for world.npcBodyTypes
const Project = require('../models/Project');
const watchRules = require('../server/watchRules');
const AdminWatch = require('../server/admin-watch');
const contentLoader = require('../server/contentLoader');
const ProjectLogic = require('../js/project-logic');      // prerequisite loops + free board cells
const AdminUsersLogic = require('../js/admin-users-logic'); // Users table: sort allowlist + $sort spec
const { fillDailyBuckets } = require('../server/analytics');
const { friendFilter } = require('../server/friendship');
const Character = require('../models/Character');
const Location = require('../models/Location');
const Dialogue = require('../models/Dialogue');
const Report = require('../models/Report');
const ProjectStay = require('../models/ProjectStay');
const SceneScore = require('../models/SceneScore');
const SceneStill = require('../models/SceneStill');
const SceneIsland = require('../models/SceneIsland');
const FeedPost = require('../models/FeedPost');
const SceneData = require('../server/scene-guess-data');
const Messages = require('../server/messages');
const Upload = require('../models/Upload');
const UploadPolicy = require('../server/upload-policy');
const { parseAsset } = require('../server/cloudinary-url');
const feed = require('../server/feed');
const MessagingLogic = require('../js/messaging-logic');
const auth = require('../middleware/auth');
// Pure payload validators for the config / CMS / board routes below.
const {
  pickNumber, diffConfig,
  sanitizeProject, parsePositions, planPositions,
  sanitizeCharacter, sanitizeLocation, sanitizePairs, sanitizeVillainLines
} = require('../server/admin-sanitize');

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

// ?page= ?limit= ?q= plus ?sort= (username | lastActive | watched | memories
// | joined) and ?dir= (asc | desc), allowlisted in js/admin-users-logic.js;
// anything else is today's order, newest account first.
router.get('/users', async (req, res) => {
  const { page, limit, skip } = clampPage(req);
  const q = (req.query.q || '').toString().trim();
  const filter = q ? { username: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } } : {};
  const { sort, dir } = AdminUsersLogic.parseSort(req.query.sort, req.query.dir);

  // One aggregation, so Mongo sorts the WHOLE result set and then takes the
  // page — a sort applied in JS after the query could only ever order the
  // 25 rows it got. The watched / memory counts are $size'd in the
  // pipeline (they used to be counted in JS from watchedProjects, which
  // never leaves the DB now), the username is lower-cased for a
  // case-insensitive sort, and _na puts never-active users last whichever
  // way "Last active" goes. The spec comes from AdminUsersLogic.sortStage,
  // which test/admin-users-sort.test.js keeps in step with the client's
  // compareUsers.
  const pipeline = [
    { $match: filter },
    {
      $project: {
        username: 1, isAdmin: 1, banned: 1, bannedAt: 1, banReason: 1,
        createdAt: 1, lastActiveAt: 1, profilePicture: 1,
        watchedCount: { $size: { $ifNull: ['$watchedProjects', []] } },
        memoryCount: {
          $sum: {
            $map: {
              input: { $ifNull: ['$watchedProjects', []] },
              as: 'e',
              in: { $size: { $ifNull: ['$$e.memories', []] } }
            }
          }
        },
        _un: { $toLower: { $ifNull: ['$username', ''] } },
        _na: { $cond: [{ $eq: [{ $type: '$lastActiveAt' }, 'date'] }, 0, 1] }
      }
    },
    { $sort: AdminUsersLogic.sortStage(sort, dir) },
    { $skip: skip },
    { $limit: limit }
  ];

  const [items, total] = await Promise.all([
    User.aggregate(pipeline),
    User.countDocuments(filter)
  ]);

  // The list view only needs the counts (never the nested arrays), and the
  // sort helper fields stay in the DB.
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
    watchedCount: u.watchedCount || 0,
    memoryCount: u.memoryCount || 0
  }));

  res.json({ items: lite, total, page, limit, sort, dir });
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

const { deleteUser: deleteUserCascade } = require('../server/delete-user');

router.delete('/users/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  if (req.params.id === req.adminUser.id) {
    return res.status(400).json({ error: "You can't delete your own admin account" });
  }
  const user = await User.findById(req.params.id).select('username isAdmin').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  // One admin must not be able to remove another; demoting is a deliberate
  // separate step (there is no demote route yet — it's a DB edit).
  if (user.isAdmin) return res.status(400).json({ error: 'Demote this admin before deleting them' });

  // Lazy: world-socket is only needed here, and keeps admin.js loadable on
  // its own (tests, scripts).
  let WorldSocket = null;
  try { WorldSocket = require('./world-socket'); } catch (_) {}
  const dropCredits = () => (WorldSocket && WorldSocket.dropCreditsFor
    ? WorldSocket.dropCreditsFor(req.params.id).catch(() => {})
    : Promise.resolve());
  // Stop island stay credit BEFORE the cascade (and wait out a flush in
  // flight) — otherwise the next flush upserts their ProjectStay rows back.
  await dropCredits();

  // The whole cascade (posts, messages, uploads + Cloudinary, watchedWith,
  // houses, friends, stays, scores) lives in server/delete-user.js; each
  // step is independent and the summary says which, if any, failed.
  const summary = await deleteUserCascade({
    User, Friend, ProjectStay, SceneScore, FeedPost, Report, Upload,
    Message: require('../models/Message'),
    WorldHouse: require('../models/WorldHouse')
  }, cloudinary, { userId: req.params.id, username: user.username });
  SceneData.invalidate('board', null);
  // Live sockets drop last. Their disconnect handlers drain any stay into
  // pendingCredits; dropCreditsFor marked the user, so that credit is
  // discarded — the second call just sweeps anything queued meanwhile.
  auth.invalidateUser(req.params.id);
  dropCredits();
  logAudit(req, 'deleteUser', req.params.id, {
    username: user.username,
    failed: summary.ok ? undefined : summary.steps.filter(s => s.error).map(s => s.name)
  });
  const userStep = summary.steps.find(s => s.name === 'user');
  if (!userStep || userStep.error) {
    return res.status(500).json({ error: 'User delete failed', steps: summary.steps });
  }
  res.json({
    message: summary.ok ? 'User deleted' : 'User deleted — some cleanup steps failed (see server log)',
    steps: summary.steps
  });
});

router.post('/users/:id/password', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  const { password } = req.body || {};
  const pwErr = passwordError(password);   // same rules as register (server/password.js)
  if (pwErr) return res.status(400).json({ error: pwErr });
  const hashed = await hashPassword(password);
  // Bump tokenVersion to invalidate the user's existing sessions — a
  // password reset should always log out everywhere, otherwise a stolen
  // token outlives the reset.
  // Another admin's password is off limits (resetting it is a takeover);
  // your own is fine. isAdmin sits in the filter so check and write are one.
  const filter = req.params.id === req.adminUser.id
    ? { _id: req.params.id }
    : { _id: req.params.id, isAdmin: { $ne: true } };
  const user = await User.findOneAndUpdate(
    filter,
    { password: hashed, $inc: { tokenVersion: 1 } },
    { returnDocument: 'after' }
  ).select('username').lean();
  if (!user) {
    if (await User.exists({ _id: req.params.id })) {
      return res.status(400).json({ error: 'Demote this admin before resetting their password' });
    }
    return res.status(404).json({ error: 'User not found' });
  }
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
  // isAdmin in the filter, not a read-then-write: an admin is never banned
  // by another admin, even if promoted between a check and the update.
  const user = await User.findOneAndUpdate(
    { _id: req.params.id, isAdmin: { $ne: true } },
    { banned: true, bannedAt: new Date(), banReason: reason, $inc: { tokenVersion: 1 } },
    { returnDocument: 'after' }
  ).select('username').lean();
  if (!user) {
    if (await User.exists({ _id: req.params.id })) {
      return res.status(400).json({ error: 'Demote this admin before banning them' });
    }
    return res.status(404).json({ error: 'User not found' });
  }
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
    { returnDocument: 'after' }
  ).select('username').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  auth.invalidateUser(req.params.id);
  logAudit(req, 'unban', req.params.id, { username: user.username });
  res.json({ message: 'User unbanned' });
});

// Mark projects watched for a user, skipping the watch timer (and the
// "watch X first" locks) — rules in server/admin-watch.js. Each new title
// counts as one finished watch dated now, so every unlock (characters, /home
// rooms, phases) follows from the list as usual. No feed post is made; any
// timer running on those titles is dropped, and the user gets an inbox note.
router.post('/users/:id/watched', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  const user = await User.findById(req.params.id).select('username watchedProjects.projectId').lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  const projects = await watchRules.allProjects();
  const watched = new Set((user.watchedProjects || []).map(e => e.projectId));
  const plan = AdminWatch.planMarkWatched(req.body && req.body.projectIds, watched, projects);
  if (plan.error) return res.status(400).json({ error: plan.error, unknown: plan.unknown });
  if (!plan.add.length) return res.json({ added: [], skipped: plan.skip });

  // The filter makes it all-or-nothing: if the user finished one of these
  // titles since the read above, nothing is written (no duplicate entry).
  const updated = await User.findOneAndUpdate(
    { _id: user._id, 'watchedProjects.projectId': { $nin: plan.add } },
    {
      $push: { watchedProjects: { $each: AdminWatch.newEntries(plan.add) } },
      $pull: { watchSessions: { projectId: { $in: plan.add } } }
    },
    { returnDocument: 'after', projection: { _id: 1 } }
  ).lean();
  if (!updated) {
    return res.status(409).json({ error: 'Their progress just changed. Reopen the user and try again.' });
  }

  const titles = plan.add.map(id => String((projects.get(id) || {}).title || id));
  Messages.sendSystem({ recipientId: user._id, kind: 'admin-notice', text: AdminWatch.inboxText(titles) })
    .catch(err => console.error('Mark watched → inbox failed:', err && err.message));
  logAudit(req, 'markWatched', req.params.id, {
    username: user.username, projectIds: plan.add, ...(plan.skip.length ? { skipped: plan.skip } : {})
  });
  res.json({ added: plan.add, skipped: plan.skip });
});

// -----------------------------------------------------------------------
// MEMORIES (moderation)
// -----------------------------------------------------------------------

// Flatten every memory across every user into a paginated feed. We do this
// in the aggregation so the API can sort by uploadedAt globally and so
// pagination can skip into a known total.
router.get('/memories', async (req, res) => {
  const { page, limit, skip } = clampPage(req);
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
    { $lookup: { from: User.collection.name, localField: 'userId', foreignField: '_id', as: 'u',
                 pipeline: [{ $project: { username: 1 } }] } },
    { $addFields: { username: { $arrayElemAt: ['$u.username', 0] } } },
    { $project: { u: 0 } }
  ];
  const pipeline = [
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

// Best-effort Cloudinary destroy. public_id and resource_type come from the
// URL itself (server/cloudinary-url.js parseAsset — our cloud only), never
// from the client's `type` field.
const parseCloudinary = parseAsset;

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
  // of truth for visibility, the cloud delete just reclaims storage. It only
  // happens once NOTHING references the asset any more: a user who re-posted
  // someone else's photo URL used to get the original owner's asset destroyed
  // when their copy was moderated.
  const parsed = parseCloudinary(url);
  const uploader = await Upload.findOne({ url }).select('userId').lean().catch(() => null);
  if (parsed) {
    UploadPolicy.assetStillReferenced(url)
      .then(async (still) => {
        if (still) { console.log('[admin] asset kept, still referenced elsewhere:', parsed.public_id); return; }
        await cloudinary.uploader.destroy(parsed.public_id, { resource_type: parsed.resource_type, invalidate: true });
        await Upload.deleteOne({ publicId: parsed.public_id });
      })
      .catch(err => console.error('Cloudinary destroy failed:', err && err.message));
  }
  // Same cleanup the user's own delete does — pull it out of friends' feeds.
  feed.removeMemory(userId, projectId, url);
  logAudit(req, 'deleteMemory', { userId, projectId, url, uploadedBy: uploader ? String(uploader.userId) : null }, null);
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

// pickNumber / diffConfig: server/admin-sanitize.js.

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
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
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
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
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

// Payload shaping (id slugs, string bounds, grid coords, dialogue lines)
// lives in server/admin-sanitize.js; the routes here do the Mongo side.
const PREREQ_MAX = 20;

function badRequest(res, msg, fields) {
  return res.status(400).json({ error: msg, fields: fields || undefined });
}

// ---------- Projects ----------

// The public site falls back to the built-in content files while a
// collection is empty (routes/content.js). The first admin write must not
// replace those 84 titles (130 characters, 36 locations) with a one-row
// database, so every write seeds the collection from the built-in list
// first. `type` is the contentLoader key. → true when it seeded.
async function ensureSeeded(Model, type) {
  if (await Model.exists({})) return false;
  const items = contentLoader.get(type) || [];
  if (!items.length) return false;
  try {
    await Model.insertMany(items, { ordered: false });
  } catch (err) {
    // A concurrent seed (two admins at once) only duplicates ids — fine.
    if (err && err.code !== 11000 && !(err.writeErrors && err.writeErrors.every(e => e.code === 11000))) throw err;
  }
  return true;
}

async function ensureProjectsSeeded() {
  if (await ensureSeeded(Project, 'projects')) watchRules.invalidate();
}

// The public /api/content/{characters,locations,dialogues} responses are
// cached for 30 s (routes/content.js); drop them after every write here.
// Required lazily, like world-socket below.
function contentChanged(kind) {
  let Content = null;
  try { Content = require('./content'); } catch (_) {}
  if (Content && Content.invalidate) Content.invalidate(kind);
}

// ADM-09: the same guard for the other CMS collections (they had none, so
// saving one character on an empty DB made the site serve only that one).
async function ensureCharactersSeeded() {
  if (await ensureSeeded(Character, 'characters')) contentChanged('characters');
}
async function ensureLocationsSeeded() {
  if (await ensureSeeded(Location, 'locations')) contentChanged('locations');
}

// The dialogue singleton: created from js/walker-dialogues.js when there is
// none yet ($setOnInsert, so a doc that exists is never touched).
async function ensureDialoguesSeeded() {
  if (await Dialogue.exists({})) return;
  const d = contentLoader.get('dialogues') || {};
  await Dialogue.findOneAndUpdate({}, {
    $setOnInsert: { pairs: d.pairs || {}, villainDefeatLines: d.villainDefeatLines || {}, villainVictoryLines: d.villainVictoryLines || {} }
  }, { upsert: true, setDefaultsOnInsert: true });
  contentChanged('dialogues');
}

// RT-06: after any project write, drop every cache that holds projects —
// the watch rules, Scene Guess's guessing line (runtime / episodes / title)
// and the /world socket's island grid (Project chat, the stone ring).
// world-socket is required lazily, as in the user delete above.
function projectsChanged(id) {
  watchRules.invalidate();
  SceneData.invalidate('projects', id || null);
  let WorldSocket = null;
  try { WorldSocket = require('./world-socket'); } catch (_) {}
  if (WorldSocket && WorldSocket.invalidateProjectGrid) WorldSocket.invalidateProjectGrid();
}

// A deleted project's Scene Guess data: island switch, stills (+ their
// Cloudinary images, destroyed like DELETE /scenes/still/:id) and scores.
// Best-effort — the project is already gone; a failure is logged and the
// summary says so. → { stills, scores } counts, or { error }.
async function deleteProjectScenes(projectId) {
  try {
    const stills = await SceneStill.find({ projectId }).select('publicId imageUrl').lean();
    const [, , scores] = await Promise.all([
      SceneIsland.deleteMany({ projectId }),
      SceneStill.deleteMany({ projectId }),
      SceneScore.deleteMany({ projectId })
    ]);
    const { destroyStill } = require('./admin-scenes');
    for (const s of stills) destroyStill(s, parseCloudinary);
    SceneData.invalidate('islands', projectId);
    SceneData.invalidate('pool', projectId);
    SceneData.invalidate('board', projectId);
    return { stills: stills.length, scores: scores.deletedCount || 0 };
  } catch (err) {
    console.error('Project delete → Scene Guess cleanup failed:', err && err.message);
    return { error: true };
  }
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
  projectsChanged(out.id);
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
  const after = await Project.findOneAndUpdate({ id: req.params.id }, out, { returnDocument: 'after' }).lean();
  projectsChanged(req.params.id);
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
  projectsChanged(id);
  // RT-06: its Scene Guess island goes too — the switch, the stills (rows +
  // Cloudinary images, as the still delete does) and the scoreboard.
  const scenes = await deleteProjectScenes(id);
  logAudit(req, 'contentEdit', { type: 'project', id }, { action: 'delete', unlinked: linked.map(p => p.id), scenes });
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
router.put('/content/projects/bulk/positions', async (req, res) => {
  const body = req.body || {};
  // --- shape validation (server/admin-sanitize.js parsePositions) ---------
  const parsed = parsePositions(body.positions);
  if (parsed.error) return badRequest(res, parsed.error, parsed.fields);
  const wanted = parsed.wanted; // id -> { gridX, gridY }

  // --- merge against current DB state -------------------------------------
  await ensureProjectsSeeded();
  const all = await Project.find({}).select('id gridX gridY').lean();
  const known = new Set(all.map(p => p.id));
  const unknown = [...wanted.keys()].filter(id => !known.has(id));
  if (unknown.length) return badRequest(res, 'Unknown project id(s)', { ids: unknown });

  // --- collision check on the MERGED state (planPositions) ----------------
  const { changes, conflicts } = planPositions(all, wanted);
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
  projectsChanged(null);   // RT-06: the socket's island grid moved

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

router.get('/content/characters', async (req, res) => {
  const items = await Character.find({}).sort({ name: 1 }).lean();
  if (items.length) return res.json({ source: 'db', items });
  // Empty collection: show what the site serves (characters.js), like projects.
  const fallback = (contentLoader.get('characters') || []).slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  res.json({ source: 'fallback', items: fallback });
});

router.post('/content/characters', async (req, res) => {
  const { out, errors } = sanitizeCharacter(req.body || {}, true);
  if (Object.keys(errors).length) return badRequest(res, 'Validation failed', errors);
  await ensureCharactersSeeded();
  const exists = await Character.exists({ id: out.id });
  if (exists) return badRequest(res, 'A character with that id already exists', { id: 'duplicate' });
  await Character.create(out);
  contentChanged('characters');
  logAudit(req, 'contentEdit', { type: 'character', id: out.id }, { action: 'create' });
  res.json(out);
});

router.put('/content/characters/:id', async (req, res) => {
  const { out, errors } = sanitizeCharacter(req.body || {}, false);
  if (Object.keys(errors).length) return badRequest(res, 'Validation failed', errors);
  await ensureCharactersSeeded();
  const after = await Character.findOneAndUpdate({ id: req.params.id }, out, { returnDocument: 'after' }).lean();
  if (!after) return res.status(404).json({ error: 'Not found' });
  contentChanged('characters');
  logAudit(req, 'contentEdit', { type: 'character', id: req.params.id }, { action: 'update' });
  res.json(after);
});

router.delete('/content/characters/:id', async (req, res) => {
  await ensureCharactersSeeded();
  const r = await Character.deleteOne({ id: req.params.id });
  if (r.deletedCount === 0) return res.status(404).json({ error: 'Not found' });
  contentChanged('characters');
  logAudit(req, 'contentEdit', { type: 'character', id: req.params.id }, { action: 'delete' });
  res.json({ message: 'Deleted' });
});

// ---------- Locations ----------

router.get('/content/locations', async (req, res) => {
  const items = await Location.find({}).sort({ region: 1, label: 1 }).lean();
  if (items.length) return res.json({ source: 'db', items });
  // Empty collection: show what the site serves (locations.js), like projects.
  const fallback = (contentLoader.get('locations') || []).slice()
    .sort((a, b) => String(a.region || '').localeCompare(String(b.region || '')) || String(a.label || '').localeCompare(String(b.label || '')));
  res.json({ source: 'fallback', items: fallback });
});

router.post('/content/locations', async (req, res) => {
  const { out, errors } = sanitizeLocation(req.body || {}, true);
  if (Object.keys(errors).length) return badRequest(res, 'Validation failed', errors);
  await ensureLocationsSeeded();
  const exists = await Location.exists({ id: out.id });
  if (exists) return badRequest(res, 'A location with that id already exists', { id: 'duplicate' });
  await Location.create(out);
  contentChanged('locations');
  logAudit(req, 'contentEdit', { type: 'location', id: out.id }, { action: 'create' });
  res.json(out);
});

router.put('/content/locations/:id', async (req, res) => {
  // Numeric fields left out of the body are left out of `out` too, so this
  // $set keeps their stored values (ADM-11).
  const { out, errors } = sanitizeLocation(req.body || {}, false);
  if (Object.keys(errors).length) return badRequest(res, 'Validation failed', errors);
  await ensureLocationsSeeded();
  const after = await Location.findOneAndUpdate({ id: req.params.id }, out, { returnDocument: 'after' }).lean();
  if (!after) return res.status(404).json({ error: 'Not found' });
  contentChanged('locations');
  logAudit(req, 'contentEdit', { type: 'location', id: req.params.id }, { action: 'update' });
  res.json(after);
});

router.delete('/content/locations/:id', async (req, res) => {
  await ensureLocationsSeeded();
  const r = await Location.deleteOne({ id: req.params.id });
  if (r.deletedCount === 0) return res.status(404).json({ error: 'Not found' });
  contentChanged('locations');
  logAudit(req, 'contentEdit', { type: 'location', id: req.params.id }, { action: 'delete' });
  res.json({ message: 'Deleted' });
});

// ---------- Dialogues (singleton document) ----------

// Pair keys / line rules: sanitizePairs + sanitizeVillainLines in
// server/admin-sanitize.js (DIALOG_LINES_MAX / DIALOG_LINE_MAX live there).

router.get('/content/dialogues', async (req, res) => {
  const doc = await Dialogue.findOne({}).lean();
  // Same rule as the public /api/content/dialogues: no doc, or one with no
  // pairs, means the site serves js/walker-dialogues.js — so the editor
  // starts from that instead of a blank page (ADM-09).
  if (doc && doc.pairs && Object.keys(doc.pairs).length) return res.json({ ...doc, source: 'db' });
  const d = contentLoader.get('dialogues') || {};
  res.json({
    pairs: d.pairs || {},
    villainDefeatLines: d.villainDefeatLines || {},
    villainVictoryLines: d.villainVictoryLines || {},
    source: 'fallback'
  });
});

// The dialogue save sends the whole document, so it gets a 512 KB parser
// instead of the global 64 KB one (server.js skips this path via its
// express.json `type` predicate). It lives here, not in server.js, so it
// only ever runs after adminLimiter + requireAdmin (server.js mounts this
// router behind both): an unauthenticated request is turned away before a
// byte of its body is read. Must stay ahead of the PUT below.
router.use('/content/dialogues', express.json({ limit: '512kb' }));

router.put('/content/dialogues', async (req, res) => {
  const body = req.body || {};
  // ADM-07: too many lines / an over-long line is a 400 now, not a silent cut.
  const pairs = sanitizePairs(body.pairs);
  const defeat = sanitizeVillainLines(body.villainDefeatLines, 'villainDefeatLines');
  const victory = sanitizeVillainLines(body.villainVictoryLines, 'villainVictoryLines');
  const fields = { ...pairs.errors, ...defeat.errors, ...victory.errors };
  if (Object.keys(fields).length) return badRequest(res, 'Validation failed', fields);
  const update = {
    pairs: pairs.out,
    villainDefeatLines: defeat.out,
    villainVictoryLines: victory.out
  };
  // ADM-09: the first write on an empty DB starts from the built-in set, and
  // only the maps the body sends are replaced (a partial save keeps the rest).
  await ensureDialoguesSeeded();
  for (const k of Object.keys(update)) if (body[k] === undefined) delete update[k];
  if (!Object.keys(update).length) return badRequest(res, 'No editable fields provided');
  const after = await Dialogue.findOneAndUpdate(
    {},
    { $set: update },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  ).lean();
  contentChanged('dialogues');
  logAudit(req, 'contentEdit', { type: 'dialogues' }, {
    action: 'update',
    pairCount: Object.keys(update.pairs || {}).length,
    defeatCount: Object.keys(update.villainDefeatLines || {}).length,
    victoryCount: Object.keys(update.villainVictoryLines || {}).length
  });
  res.json(after);
});

// Scene Guess stills + island boards (routes/admin-scenes.js). The audit
// writer and the Cloudinary URL parser stay private to this file and are
// handed over rather than moved.
router.use('/scenes', require('./admin-scenes')({ logAudit, parseCloudinary }));

module.exports = router;
