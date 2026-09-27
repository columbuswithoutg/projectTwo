const express = require('express');
const router = express.Router();
const User = require('../models/user');
const auth = require('../middleware/auth');
const feed = require('../server/feed');
const watchRules = require('../server/watchRules');
const watchTags = require('../server/watchTags');

// Load progress
router.get('/load', auth, async (req, res) => {
  const user = await User.findById(req.user.id, SESSION_PROJECTION).lean();
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(sessionPayload(user));
});

// Strip incoming watched-project entries to known-safe primitives so a
// malicious client can't cram arbitrary nested objects, other users'
// usernames, or unbounded memory lists into a doc.
const MAX_WATCHED_PROJECTS = 200;
const MAX_MEMORIES_PER_ENTRY = 40;

function sanitizeEntry(e) {
  if (!e || typeof e !== 'object') return null;
  if (typeof e.projectId !== 'string' || e.projectId.length === 0 || e.projectId.length > 80) return null;
  const count = Number.isFinite(e.count) ? Math.max(1, Math.min(Math.floor(e.count), 9999)) : 1;
  const watchedWith = Array.isArray(e.watchedWith)
    ? e.watchedWith.filter(v => typeof v === 'string' && v.length <= 40).slice(0, 20)
    : [];
  const memories = Array.isArray(e.memories)
    ? e.memories.map(sanitizeMemory).filter(Boolean).slice(0, MAX_MEMORIES_PER_ENTRY)
    : [];
  return { projectId: e.projectId, count, watchedWith, memories };
}

// Cloudinary-only URL check — shared with routes/feed.js (post editing).
const { sanitizeMemory } = require('../server/memory');

// Save full progress. The client still sends its whole list (watched-with
// tags, memories, un-watching), but it can no longer ADD a watch or raise a
// count this way: entries the server doesn't already have are dropped and
// counts are taken from the stored copy. Watches only come from finishing a
// timed session (POST /complete) — see server/watchRules.js.
//
// It can only REMOVE things from entries the server already has: drop a
// watched-with tag or a memory. It never deletes a whole entry (a stale tab
// whose list predates a just-finished watch would otherwise erase it — use
// POST /clear to wipe progress) and never adds tags (those come only from
// accepted co-watch requests), so it can't forge "watched with <anyone>".
// Writes go per-entry through arrayFilters, so a concurrent /complete $inc
// on the count is never overwritten.
router.post('/save', auth, async (req, res) => {
  const { watchedProjects } = req.body || {};
  if (!Array.isArray(watchedProjects)) return res.status(400).json({ error: 'watchedProjects must be an array' });
  const stored = await User.findById(req.user.id, { watchedProjects: 1 }).lean();
  if (!stored) return res.status(404).json({ error: 'User not found' });

  // Last copy of each projectId wins; duplicates can't be introduced.
  const incoming = new Map();
  for (const e of watchedProjects.slice(0, MAX_WATCHED_PROJECTS).map(sanitizeEntry)) {
    if (e) incoming.set(e.projectId, e);
  }

  const $set = {};
  const arrayFilters = [];
  const after = (stored.watchedProjects || []).map(entry => {
    const want = incoming.get(entry.projectId);
    if (!want) return entry;
    const keepNames = new Set(want.watchedWith);
    const keepUrls = new Set(want.memories.map(m => m.url));
    const watchedWith = (entry.watchedWith || []).filter(n => keepNames.has(n));
    const memories = (entry.memories || []).filter(m => keepUrls.has(m.url));
    if (watchedWith.length === (entry.watchedWith || []).length &&
        memories.length === (entry.memories || []).length) return entry;
    const f = `e${arrayFilters.length}`;
    arrayFilters.push({ [`${f}.projectId`]: entry.projectId });
    $set[`watchedProjects.$[${f}].watchedWith`] = watchedWith;
    $set[`watchedProjects.$[${f}].memories`] = memories;
    return { ...entry, watchedWith, memories };
  });

  if (arrayFilters.length) {
    await User.updateOne({ _id: req.user.id }, { $set }, { arrayFilters });
  }
  res.json({ message: 'Saved' });
  // The feed diffs what changed (e.g. a removed co-watcher). It runs after
  // the response and never blocks or fails the save.
  if (arrayFilters.length) feed.diffSave(req.user.id, stored.watchedProjects, after);
});

// Clear Progress: wipe every watch and in-progress session. The only way to
// remove watches wholesale — /save deliberately can't.
router.post('/clear', auth, async (req, res) => {
  const before = await User.findByIdAndUpdate(
    req.user.id,
    { $set: { watchedProjects: [], watchSessions: [] } },
    { projection: { watchedProjects: 1 } }
  ).lean();
  if (!before) return res.status(404).json({ error: 'User not found' });
  res.json({ watchedProjects: [], watchSessions: [], serverNow: Date.now() });
  feed.diffSave(req.user.id, before.watchedProjects, []);
});

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
      { new: true, projection: SESSION_PROJECTION }
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
      { new: true, projection: SESSION_PROJECTION }
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
// Returns { post: { caption, memories, tagIds } } or { error }.
const MAX_POST_MEMORIES = 10;
const POST_CAPTION_MAX = 500; // same as FeedPost.caption / PUT /api/feed/:id
function readPostPayload(body, userId) {
  const b = body || {};
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
// wrote in the composer (an empty composer posts it as-is).
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
  const opts = { new: true, projection: SESSION_PROJECTION };

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
    const post = await publishWatchPost({
      userId: req.user.id, project, episode: episodeNo,
      count: session.rewatch ? priorCount + 1 : 1, post: payload.post
    });
    return res.json({ ...sessionPayload(updated), finished: false, post });
  }

  // Finished: count the watch and keep the composer's photos/videos on the
  // project too (they show in the project popup's Memories).
  const mems = payload.post.memories.map(m => ({ ...m, uploadedAt: new Date() }));
  const pull = { $pull: { watchSessions: { projectId } } };
  let updated = await User.findOneAndUpdate(
    { _id: req.user.id, watchSessions: sessionMatch, 'watchedProjects.projectId': projectId },
    {
      ...pull,
      $inc: { 'watchedProjects.$[w].count': 1 },
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
      { ...pull, $push: { watchedProjects: { projectId, count: 1, watchedWith: [], memories: mems } } },
      opts
    ).lean();
  }
  if (!updated) {
    const now = await User.findById(req.user.id, SESSION_PROJECTION).lean();
    return res.status(409).json({ error: 'Already completed', ...sessionPayload(now || {}) });
  }
  const e = updated.watchedProjects.find(w => w.projectId === projectId);
  const post = await publishWatchPost({
    userId: req.user.id, project, episode: episodeNo, count: e ? e.count : 1, post: payload.post
  });
  res.json({ ...sessionPayload(updated), finished: true, post });
});

// Cancel: In progress → back where it came from (Not started, or Done for a
// rewatch). Resets the timer and any episode progress. `all: true` clears
// every session (used by Clear Progress).
router.post('/cancel', auth, async (req, res) => {
  const { projectId, all } = req.body || {};
  if (all !== true && !validProjectId(projectId)) return res.status(400).json({ error: 'Invalid projectId' });
  const update = all === true ? { $set: { watchSessions: [] } } : { $pull: { watchSessions: { projectId } } };
  const updated = await User.findByIdAndUpdate(req.user.id, update,
    { new: true, projection: SESSION_PROJECTION }).lean();
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
  const user = await User.findById(req.user.id);
  const entry = user.watchedProjects.find(e => e.projectId === projectId);
  if (!entry) return res.status(404).json({ error: 'Project not watched yet' });
  if (entry.memories.length >= MAX_MEMORIES_PER_ENTRY) {
    return res.status(400).json({ error: 'Memory cap reached for this project' });
  }
  entry.memories.push(memory);
  await user.save();
  res.json({ memories: entry.memories });
  feed.recordMemory(req.user.id, projectId, memory);
});

// Delete a memory
router.delete('/memory', auth, async (req, res) => {
  const { projectId, url } = req.body || {};
  const user = await User.findById(req.user.id);
  const entry = user.watchedProjects.find(e => e.projectId === projectId);
  if (!entry) return res.status(404).json({ error: 'Not found' });
  entry.memories = entry.memories.filter(m => m.url !== url);
  await user.save();
  res.json({ message: 'Deleted' });
  if (typeof url === 'string') feed.removeMemory(req.user.id, projectId, url);
});

// Load walker selections
router.get('/walkers', auth, async (req, res) => {
  const user = await User.findById(req.user.id);
  res.json({ walkers: user.walkers || [] });
});

// Save walker selections
router.post('/walkers', auth, async (req, res) => {
  const { walkers } = req.body || {};
  if (!Array.isArray(walkers)) return res.status(400).json({ error: 'walkers must be an array' });
  // Cap at 200 entries, accept strings or { id, stage } objects
  const clean = walkers.slice(0, 200).filter(w =>
    typeof w === 'string' || (w && typeof w.id === 'string')
  );
  await User.findByIdAndUpdate(req.user.id, { walkers: clean });
  res.json({ message: 'Saved' });
});

// NOTE: the Infinity Stone hunt is no longer a daily per-player REST feature.
// It's now a live shared PvP contest in the 'world' socket room — stone
// ownership + the snap live in routes/world-socket.js, and the lifetime
// snap-count leaderboard is served by GET /api/friends/stones.

module.exports = router;