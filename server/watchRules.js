const Project = require('../models/Project');
const contentLoader = require('./contentLoader');

// Server-side rules for the Start watching → In progress → Mark as watched
// flow. The client shows the same timers, but only these checks decide:
// a project can be started only once it's available (phase + prerequisites
// watched), and a session can be completed only after the movie runtime —
// or the current episode's runtime, for a series — has elapsed since start.

// Mirrors PHASE_UNLOCKERS in js/config.js.
const PHASE_UNLOCKERS = { 2: 'avengers1', 3: 'ageofultron', 4: 'endgame', 5: 'loki1', 6: 'loki2' };

// A few seconds of slack so a client whose countdown hits 0:00 a hair before
// the server's clock does isn't bounced with "not finished yet".
const CLOCK_SLACK_MS = 5000;

const MAX_RUNTIME_MIN = 600;
const MAX_EPISODES = 60;

function parsePhase(phase) {
  if (typeof phase === 'number') return phase;
  const m = String(phase || '').match(/\d+/);
  return m ? +m[0] : 1;
}

// Non-empty episode list ⇒ series. Returns the list or null.
function episodesOf(p) {
  return Array.isArray(p && p.episodes) && p.episodes.length ? p.episodes : null;
}

// Minutes the given step takes: the movie runtime, or episode `idx`.
function stepMinutes(p, idx = 0) {
  const eps = episodesOf(p);
  const v = eps ? eps[idx] : p && p.runtime;
  return Number.isFinite(v) && v > 0 ? v : 0;
}

// End credits most people skip. "Mark as watched" unlocks this long before
// the listed runtime ends. Movies get a flat 10 minutes; an episode's credits
// are much shorter, so it's 10% of that episode (at least 2 min, at most 10).
// Neither allowance can be more than half the runtime (short specials).
// Mirrored in js/state.js creditsMinutes() — keep the two in step.
const MOVIE_CREDITS_MIN = 10;
const EPISODE_CREDITS_SHARE = 0.10;
const EPISODE_CREDITS_MIN = 2;
const EPISODE_CREDITS_MAX = 10;

function creditsMinutes(p, idx = 0) {
  const run = stepMinutes(p, idx);
  const credits = episodesOf(p)
    ? Math.min(EPISODE_CREDITS_MAX, Math.max(EPISODE_CREDITS_MIN, run * EPISODE_CREDITS_SHARE))
    : MOVIE_CREDITS_MIN;
  return Math.min(credits, run / 2);
}

// Minutes that must pass after Start before the step can be marked watched.
function requiredMinutes(p, idx = 0) {
  return Math.max(0, stepMinutes(p, idx) - creditsMinutes(p, idx));
}

function stepCount(p) {
  const eps = episodesOf(p);
  return eps ? eps.length : 1;
}

// Required + hidden prerequisites that still exist. A link to a deleted
// project can never be watched, so it would lock the title forever — it's
// ignored instead (the project cache is warm whenever these run: callers
// look the project up through getProject first).
function lockingPrereqs(p) {
  const ids = [...(p.prerequisites || []), ...(p.hiddenPrerequisites || [])];
  return _cache && _cache.size ? ids.filter(id => _cache.has(id)) : ids;
}

// watched: Set of project ids the user has watched.
// recommendedPrerequisites are advisory only and never gate availability.
function isAvailable(p, watched) {
  const phase = parsePhase(p.phase);
  if (phase !== 1) {
    const unlocker = PHASE_UNLOCKERS[phase];
    if (!unlocker || !watched.has(unlocker)) return false;
  }
  return lockingPrereqs(p).every(id => watched.has(id));
}

// Why a project isn't startable, for the error toast: names the phase
// unlocker or the first missing prerequisite by title.
function lockedReason(p, watched, titleOf = (id) => (_cache && _cache.get(id)?.title) || id) {
  const phase = parsePhase(p.phase);
  const unlocker = PHASE_UNLOCKERS[phase];
  if (phase !== 1 && unlocker && !watched.has(unlocker)) return `Watch ${titleOf(unlocker)} first to unlock Phase ${phase}`;
  const missing = lockingPrereqs(p).find(id => !watched.has(id));
  return missing ? `Watch ${titleOf(missing)} first` : 'Not available yet';
}

// ms left before the running step may be completed (0 = ready now).
function remainingMs(p, session, now = Date.now()) {
  if (!session || !session.startedAt) return Infinity;
  const need = requiredMinutes(p, session.episode || 0) * 60000;
  const elapsed = now - new Date(session.startedAt).getTime();
  return Math.max(0, need - elapsed - CLOCK_SLACK_MS);
}

// Admin-form sanitising for the two runtime fields.
function sanitizeRuntime(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_RUNTIME_MIN) : 0;
}

function sanitizeEpisodes(v) {
  if (!Array.isArray(v)) return [];
  return v.map(sanitizeRuntime).filter(n => n > 0).slice(0, MAX_EPISODES);
}

// Project lookup: same source as /api/content/projects (Mongo first, the
// static projects.js as fallback), cached briefly — start/complete are hot.
let _cache = null;
let _cacheAt = 0;
const CACHE_MS = 30000;

async function allProjects() {
  if (_cache && Date.now() - _cacheAt < CACHE_MS) return _cache;
  let items = null;
  try {
    const docs = await Project.find({}).select('-_id -__v -createdAt -updatedAt').lean();
    if (docs.length) items = docs;
  } catch (err) {
    console.error('watchRules: Mongo read failed, using fallback:', err.message);
  }
  _cache = new Map((items || contentLoader.get('projects')).map(p => [p.id, p]));
  _cacheAt = Date.now();
  return _cache;
}

async function getProject(id) {
  return (await allProjects()).get(id) || null;
}

function invalidate() { _cache = null; }

// One-time fill for the DB copy: projects created by the seed script before
// runtimes existed get theirs from projects.js. Only touches docs with no
// runtime AND no episodes, so an admin's edits are never overwritten.
async function backfillRuntimes() {
  try {
    const missing = await Project.find({
      $and: [
        { $or: [{ runtime: { $exists: false } }, { runtime: 0 }, { runtime: null }] },
        { $or: [{ episodes: { $exists: false } }, { episodes: { $size: 0 } }] }
      ]
    }).select('id').lean();
    const src = new Map(contentLoader.get('projects').map(p => [p.id, p]));
    const ops = [];
    for (const { id } of missing) {
      const p = src.get(id);
      if (!p) continue;
      const eps = episodesOf(p);
      if (eps) ops.push({ updateOne: { filter: { id }, update: { $set: { episodes: eps } } } });
      else if (p.runtime) ops.push({ updateOne: { filter: { id }, update: { $set: { runtime: p.runtime } } } });
    }
    if (ops.length) {
      await Project.bulkWrite(ops);
      invalidate();
      console.log(`watchRules: backfilled runtimes on ${ops.length} project(s)`);
    }
  } catch (err) {
    console.error('watchRules: runtime backfill failed:', err.message);
  }
  // hiddenPrerequisites predate the schema field, so the seeded DB copy lost
  // them — restore from projects.js wherever the doc has none.
  try {
    const src = contentLoader.get('projects').filter(p => Array.isArray(p.hiddenPrerequisites) && p.hiddenPrerequisites.length);
    const ops = src.map(p => ({
      updateOne: {
        filter: { id: p.id, $or: [{ hiddenPrerequisites: { $exists: false } }, { hiddenPrerequisites: { $size: 0 } }] },
        update: { $set: { hiddenPrerequisites: p.hiddenPrerequisites } }
      }
    }));
    if (ops.length) {
      const r = await Project.bulkWrite(ops);
      if (r.modifiedCount) {
        invalidate();
        console.log(`watchRules: restored hiddenPrerequisites on ${r.modifiedCount} project(s)`);
      }
    }
  } catch (err) {
    console.error('watchRules: hiddenPrerequisites restore failed:', err.message);
  }
}

module.exports = {
  PHASE_UNLOCKERS, CLOCK_SLACK_MS,
  parsePhase, episodesOf, stepMinutes, creditsMinutes, requiredMinutes, stepCount, isAvailable, lockedReason, remainingMs,
  sanitizeRuntime, sanitizeEpisodes,
  getProject, invalidate, backfillRuntimes
};
