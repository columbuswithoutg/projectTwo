const express = require('express');
const router = express.Router();
const User = require('../models/user');
const auth = require('../middleware/auth');
const feed = require('../server/feed');
const watchRules = require('../server/watchRules');
const watchTags = require('../server/watchTags');
const { sanitizeWalkers } = require('../server/walkers');

// Load progress
router.get('/load', auth, async (req, res) => {
  const user = await User.findById(req.user.id, SESSION_PROJECTION).lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(sessionPayload(user));
});

// Caps on a user's watched list and on the memories kept per entry.
const MAX_WATCHED_PROJECTS = 200;
const MAX_MEMORIES_PER_ENTRY = 40;

// Cloudinary-only URL check — shared with routes/feed.js (post editing).
const { sanitizeMemory } = require('../server/memory');

const MAX_SESSIONS = 50;
// Timers that may tick at the same time (a movie + a series episode, say).
// Without a cap you could start every available title and mark them all
// watched ~2 h later. Series waiting between episodes don't count.
// Mirrored in js/state.js (MAX_RUNNING_TIMERS).
const MAX_RUNNING = 2;
// Mongo expression: fewer than MAX_RUNNING sessions with a running timer.
// Part of the update filter, so two parallel starts can't both slip in.
const RUNNING_UNDER_CAP = {
  $lt: [{
    $size: { $filter: { input: { $ifNull: ['$watchSessions', []] }, as: 's', cond: { $ne: [{ $ifNull: ['$$s.startedAt', null] }, null] } } }
  }, MAX_RUNNING]
};
const RUNNING_CAP_ERROR = `You can have ${MAX_RUNNING} timers running at once — finish or cancel one first`;

function validProjectId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 80;
}

function sessionPayload(u) {
  return {
    watchedProjects: u.watchedProjects || [],
    watchSessions: u.watchSessions || [],
    serverNow: Date.now()
  };
}

const SESSION_PROJECTION = { watchedProjects: 1, watchSessions: 1 };

// Start watching: Not started → In progress (or Done → In progress for a
// rewatch). For a series already in progress this starts the next episode's
// timer. Idempotent while a timer is already running.
router.post('/start', auth, async (req, res) => {
  const { projectId } = req.body || {};
  if (!validProjectId(projectId)) return res.status(400).json({ error: 'Invalid projectId' });
  const project = await watchRules.getProject(projectId);
  if (!project) return res.status(404).json({ error: 'Unknown project' });

  const user = await User.findById(req.user.id, SESSION_PROJECTION).lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  const watched = new Set((user.watchedProjects || []).map(e => e.projectId));
  const session = (user.watchSessions || []).find(s => s.projectId === projectId);

  if (session && session.startedAt) return res.json(sessionPayload(user));

  let updated;
  if (session) {
    // Between episodes — start the next one.
    updated = await User.findOneAndUpdate(
      { _id: req.user.id, watchSessions: { $elemMatch: { projectId, startedAt: null } }, $expr: RUNNING_UNDER_CAP },
      { $set: { 'watchSessions.$.startedAt': new Date() } },
      { returnDocument: 'after', projection: SESSION_PROJECTION }
    ).lean();
  } else {
    if (!watched.has(projectId) && !watchRules.isAvailable(project, watched)) {
      return res.status(403).json({ error: watchRules.lockedReason(project, watched) });
    }
    updated = await User.findOneAndUpdate(
      {
        _id: req.user.id,
        'watchSessions.projectId': { $ne: projectId },
        $expr: { $and: [
          { $lt: [{ $size: { $ifNull: ['$watchSessions', []] } }, MAX_SESSIONS] },
          RUNNING_UNDER_CAP
        ] }
      },
      { $push: { watchSessions: { projectId, episode: 0, startedAt: new Date(), rewatch: watched.has(projectId) } } },
      { returnDocument: 'after', projection: SESSION_PROJECTION }
    ).lean();
  }
  if (updated) return res.json(sessionPayload(updated));

  // Hit a cap, or lost a race with another tab — return the current state so
  // the client can reconcile, with an error naming the limit that applied.
  const now = await User.findById(req.user.id, SESSION_PROJECTION).lean();
  if (!now) return res.status(404).json({ error: 'User not found' });
  const sessions = now.watchSessions || [];
  const mine = sessions.find(s => s.projectId === projectId);
  if (mine && mine.startedAt) return res.json(sessionPayload(now));
  const running = sessions.filter(s => s.startedAt).length;
  const error = running >= MAX_RUNNING ? RUNNING_CAP_ERROR : `You can have up to ${MAX_SESSIONS} things in progress`;
  res.status(409).json({ error, ...sessionPayload(now) });
});

// The post composer's payload (js/post-composer.js): an optional caption,
// photos/videos (Cloudinary URLs from /api/upload) and friends to tag.
// `skipPost: true` is its "Don't post" button: the step still counts, but no
// feed post is made and nothing else in the body is used.
// Returns { post: { caption, memories, tagIds } }, { post: null } or { error }.
const MAX_POST_MEMORIES = 10;
const POST_CAPTION_MAX = 500; // same as FeedPost.caption / PUT /api/feed/:id
function readPostPayload(body, userId) {
  const b = body || {};
  if (b.skipPost === true) return { post: null };
  if (b.caption != null && typeof b.caption !== 'string') return { error: 'Invalid caption' };
  const caption = (b.caption || '').trim();
  if (caption.length > POST_CAPTION_MAX) return { error: `Caption is too long (max ${POST_CAPTION_MAX} characters)` };
  if (b.memories != null && !Array.isArray(b.memories)) return { error: 'Invalid memories' };
  const raw = (b.memories || []).slice(0, MAX_POST_MEMORIES);
  const memories = raw.map(sanitizeMemory).filter(Boolean);
  if (memories.length !== raw.length) return { error: 'Photos and videos must be uploaded through the app' };
  return { post: { caption, memories, tagIds: watchTags.cleanFriendIds(b.tagFriendIds, userId) } };
}

// Create the feed post for a finished step and send its tag requests.
// Never fails the watch: a feed error just means no post.
async function publishWatchPost({ userId, project, count, episode, post }) {
  try {
    const doc = await feed.createWatchPost(userId, project.id, {
      count, episode, caption: post.caption, memories: post.memories
    });
    if (doc && post.tagIds.length) {
      await watchTags.sendTags({
        userId, projectId: project.id, projectTitle: String(project.title || project.id).slice(0, 200),
        postId: doc._id, episode, friendIds: post.tagIds
      });
    }
    return doc ? { id: String(doc._id) } : null;
  } catch (err) {
    console.error('[complete] post failed:', err && err.message);
    return null;
  }
}

// Mark as watched: allowed only once the running step's runtime has passed.
// A movie (or a series' last episode) moves to Done and counts as a watch;
// an earlier episode advances the series to the next one. Every finished
// step — each episode included — becomes a feed post with whatever the user
// wrote in the composer (an empty composer posts it as-is), unless they
// pressed "Don't post".
router.post('/complete', auth, async (req, res) => {
  const { projectId } = req.body || {};
  if (!validProjectId(projectId)) return res.status(400).json({ error: 'Invalid projectId' });
  const project = await watchRules.getProject(projectId);
  if (!project) return res.status(404).json({ error: 'Unknown project' });
  const payload = readPostPayload(req.body, req.user.id);
  if (payload.error) return res.status(400).json({ error: payload.error });

  const user = await User.findById(req.user.id, SESSION_PROJECTION).lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  const session = (user.watchSessions || []).find(s => s.projectId === projectId);
  if (!session || !session.startedAt) {
    const error = session ? `Start episode ${(session.episode || 0) + 1} first` : 'Press Start watching first';
    return res.status(409).json({ error, ...sessionPayload(user) });
  }

  const left = watchRules.remainingMs(project, session);
  if (left > 0) {
    return res.status(409).json({ error: 'Not finished yet', remainingMs: left, ...sessionPayload(user) });
  }

  const episode = session.episode || 0;
  const isSeries = !!watchRules.episodesOf(project);
  const episodeNo = isSeries ? episode + 1 : null;
  const priorCount = ((user.watchedProjects || []).find(e => e.projectId === projectId) || {}).count || 0;
  // Matching on the exact session guards against a double-click completing
  // the same step twice.
  const sessionMatch = { $elemMatch: { projectId, episode, startedAt: session.startedAt } };
  const opts = { returnDocument: 'after', projection: SESSION_PROJECTION };

  if (episode + 1 < watchRules.stepCount(project)) {
    const updated = await User.findOneAndUpdate(
      { _id: req.user.id, watchSessions: sessionMatch },
      { $set: { 'watchSessions.$.episode': episode + 1, 'watchSessions.$.startedAt': null } },
      opts
    ).lean();
    if (!updated) {
      const now = await User.findById(req.user.id, SESSION_PROJECTION).lean();
      return res.status(409).json({ error: 'Already marked', ...sessionPayload(now || {}), finished: false });
    }
    const post = payload.post ? await publishWatchPost({
      userId: req.user.id, project, episode: episodeNo,
      count: session.rewatch ? priorCount + 1 : 1, post: payload.post
    }) : null;
    return res.json({ ...sessionPayload(updated), finished: false, post });
  }

  // Finished: count the watch and keep the composer's photos/videos on the
  // project too (they show in the project popup's Memories).
  const finishedAt = new Date();
  const mems = (payload.post ? payload.post.memories : []).map(m => ({ ...m, uploadedAt: finishedAt }));
  const pull = { $pull: { watchSessions: { projectId } } };
  let updated = await User.findOneAndUpdate(
    { _id: req.user.id, watchSessions: sessionMatch, 'watchedProjects.projectId': projectId },
    {
      ...pull,
      $inc: { 'watchedProjects.$[w].count': 1 },
      $set: { 'watchedProjects.$[w].lastWatchedAt': finishedAt },
      ...(mems.length ? { $push: { 'watchedProjects.$[w].memories': { $each: mems, $slice: -MAX_MEMORIES_PER_ENTRY } } } : {})
    },
    { ...opts, arrayFilters: [{ 'w.projectId': projectId, 'w.count': { $lt: 9999 } }] }
  ).lean();
  if (!updated) {
    updated = await User.findOneAndUpdate(
      {
        _id: req.user.id,
        watchSessions: sessionMatch,
        'watchedProjects.projectId': { $ne: projectId },
        $expr: { $lt: [{ $size: { $ifNull: ['$watchedProjects', []] } }, MAX_WATCHED_PROJECTS] }
      },
      { ...pull, $push: { watchedProjects: { projectId, count: 1, watchedWith: [], memories: mems, lastWatchedAt: finishedAt } } },
      opts
    ).lean();
  }
  if (!updated) {
    const now = await User.findById(req.user.id, SESSION_PROJECTION).lean();
    return res.status(409).json({ error: 'Already completed', ...sessionPayload(now || {}) });
  }
  const e = updated.watchedProjects.find(w => w.projectId === projectId);
  const post = payload.post ? await publishWatchPost({
    userId: req.user.id, project, episode: episodeNo, count: e ? e.count : 1, post: payload.post
  }) : null;
  res.json({ ...sessionPayload(updated), finished: true, post });
});

// Cancel: In progress → back where it came from (Not started, or Done for a
// rewatch). Resets the timer and any episode progress.
router.post('/cancel', auth, async (req, res) => {
  const { projectId } = req.body || {};
  if (!validProjectId(projectId)) return res.status(400).json({ error: 'Invalid projectId' });
  const updated = await User.findByIdAndUpdate(req.user.id, { $pull: { watchSessions: { projectId } } },
    { returnDocument: 'after', projection: SESSION_PROJECTION }).lean();
  if (!updated) return res.status(404).json({ error: 'User not found' });
  res.json(sessionPayload(updated));
});

// Add a memory to a project
router.post('/memory', auth, async (req, res) => {
  const { projectId } = req.body || {};
  if (typeof projectId !== 'string' || projectId.length === 0) {
    return res.status(400).json({ error: 'Invalid projectId' });
  }
  const memory = sanitizeMemory(req.body);
  if (!memory) return res.status(400).json({ error: 'Invalid memory payload (Cloudinary URL required)' });
  // One atomic $push, guarded by the cap: `memories.<cap-1>` not existing
  // means the entry has fewer than the cap. The old read → push → save()
  // rewrote the whole watchedProjects array, so a memory added (or deleted)
  // from another tab in between was silently undone.
  const updated = await User.findOneAndUpdate(
    {
      _id: req.user.id,
      watchedProjects: { $elemMatch: { projectId, [`memories.${MAX_MEMORIES_PER_ENTRY - 1}`]: { $exists: false } } }
    },
    { $push: { 'watchedProjects.$.memories': memory } },
    { returnDocument: 'after', projection: { 'watchedProjects.projectId': 1, 'watchedProjects.memories': 1 } }
  ).lean();
  if (!updated) {
    // Nothing pushed — say why, with the same answers as before.
    const user = await User.findById(req.user.id).select('watchedProjects.projectId').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });   // deleted mid-session
    const entry = (user.watchedProjects || []).find(e => e.projectId === projectId);
    if (!entry) return res.status(404).json({ error: 'Project not watched yet' });
    return res.status(400).json({ error: 'Memory cap reached for this project' });
  }
  const entry = (updated.watchedProjects || []).find(e => e.projectId === projectId);
  res.json({ memories: (entry && entry.memories) || [] });
  feed.recordMemory(req.user.id, projectId, memory);
});

// Delete a memory
router.delete('/memory', auth, async (req, res) => {
  const { projectId, url } = req.body || {};
  // Strings only: both go straight into the update filter below (an object
  // would be an operator), and a non-string url could never match anyway.
  if (typeof projectId !== 'string' || !projectId || typeof url !== 'string') {
    return res.status(400).json({ error: 'Invalid memory' });
  }
  // Atomic $pull of just that memory — rewriting the whole array (the old
  // read → filter → save()) could drop a memory added meanwhile.
  const r = await User.updateOne(
    { _id: req.user.id, 'watchedProjects.projectId': projectId },
    { $pull: { 'watchedProjects.$.memories': { url } } }
  );
  if (!r.matchedCount) {
    const user = await User.exists({ _id: req.user.id });
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.status(404).json({ error: 'Not found' });
  }
  res.json({ message: 'Deleted' });
  feed.removeMemory(req.user.id, projectId, url);
});

// Load walker selections
router.get('/walkers', auth, async (req, res) => {
  const user = await User.findById(req.user.id).select('walkers walkersSavedAt').lean();
  // Re-sanitised on the way out too, so anything stored before the rule
  // (server/walkers.js) never reaches a client.
  const walkers = sanitizeWalkers((user && user.walkers) || []);
  // `saved` tells "cleared on another device" ([] after a POST) from "never
  // saved" (the schema default []), so the client only lets an empty list
  // wipe its local picks in the first case (MAP2-09b). A non-empty list was
  // saved by definition, also on accounts from before walkersSavedAt.
  const saved = !!(user && user.walkersSavedAt) || walkers.length > 0;
  res.json({ walkers, saved });
});

// Save walker selections
router.post('/walkers', auth, async (req, res) => {
  const { walkers } = req.body || {};
  if (!Array.isArray(walkers)) return res.status(400).json({ error: 'walkers must be an array' });
  // Every entry rebuilt as { id, look } / { id, stage } — nothing else is stored (friends
  // download this list straight into their walker code).
  const clean = sanitizeWalkers(walkers);
  await User.updateOne({ _id: req.user.id }, { $set: { walkers: clean, walkersSavedAt: new Date() } });
  res.json({ message: 'Saved' });
});

// NOTE: the Infinity Stone hunt is no longer a daily per-player REST feature.
// It's now a live shared PvP contest in the 'world' socket room — stone
// ownership + the snap live in routes/world-socket.js, and the lifetime
// snap-count leaderboard is served by GET /api/friends/stones.

module.exports = router;
module.exports.readPostPayload = readPostPayload;   // test/progress-payload.test.js