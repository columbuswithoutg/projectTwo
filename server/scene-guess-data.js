/************************************************
 * SCENE GUESS DATA — cached Mongo reads for the /world minigame
 *
 * Shared by routes/admin-scenes.js (writes → invalidate), routes/world.js
 * (REST) and server/scene-guess.js (the live games). Small caches:
 *
 *   settings   — the global switch + round length (AdminConfig)
 *   islands    — projects whose game the admin switched on (SceneIsland)
 *   pool       — active stills per project
 *   projects   — runtime / episodes / title per project (the guessing line)
 *   champions  — the top SceneScore per project → crowns, roof labels,
 *                the idle screen's "champion's pick", profile badges
 *
 * An island is LIVE when the global switch is on, its own switch is on and
 * it has MIN_POOL active stills — nothing shows anywhere otherwise.
 *
 * The socket layer reads these synchronously (`peek`: last known value,
 * refreshed in the background once stale — the stonesEventEnabled()
 * pattern in routes/world-socket.js); REST awaits a fresh copy (`get`).
 * `events` fires 'settings' / 'islands' / 'pool' / 'board' after admin
 * writes so the game server can push the change to clients.
 ************************************************/
const EventEmitter = require('events');
const cloudinary = require('cloudinary').v2;
const SceneStill = require('../models/SceneStill');
const SceneScore = require('../models/SceneScore');
const SceneIsland = require('../models/SceneIsland');
const AdminConfig = require('../models/AdminConfig');
const Project = require('../models/Project');
const User = require('../models/user');
const contentLoader = require('./contentLoader');
const Logic = require('../js/scene-guess-logic');

const TTL_MS = 15000;
const events = new EventEmitter();
events.setMaxListeners(20);

// A value loaded from Mongo, cached for TTL_MS. An invalidate during a load
// makes that load's result count as stale, so the next read loads again.
function cached(name, loadFn, initial) {
  let value = initial, at = 0, gen = 0, inflight = null, inflightGen = -1;
  const stale = () => !at || Date.now() - at > TTL_MS;
  function refresh() {
    if (inflight && inflightGen === gen) return inflight;
    const g = gen;
    const p = Promise.resolve()
      .then(loadFn)
      .then(v => {
        if (g === gen) { value = v; at = Date.now(); return v; }
        return value;
      }, err => {
        console.error(`sceneGuess: ${name} read failed:`, err && err.message);
        return value;
      })
      .finally(() => { if (inflight === p) inflight = null; });
    inflight = p;
    inflightGen = g;
    return p;
  }
  return {
    async get() { return stale() ? refresh() : value; },
    peek() { if (stale()) refresh(); return value; },
    invalidate() { gen++; at = 0; }
  };
}

// ── delivery URLs ──

// What players load. Rebuilt from the public_id rather than using the stored
// secure_url, which carries the upload time (v<unix seconds>): an admin who
// uploads while watching uploads in film order, so that number would rank
// the stills. cloudinary.url() writes a constant "v1" instead. Capped at
// 1600 px wide, auto quality/format. Stills without a public_id (seeded test
// data on /assets) are served as stored.
function stillUrl(doc) {
  if (!doc) return null;
  if (doc.publicId && process.env.CLOUDINARY_CLOUD_NAME) {
    return cloudinary.url(doc.publicId, {
      secure: true,
      transformation: [{ width: 1600, crop: 'limit', quality: 'auto', fetch_format: 'auto' }]
    });
  }
  return doc.imageUrl || null;
}

// ── settings (AdminConfig) ──

// Off until the first read resolves: a fresh server never flashes the
// feature on before it knows the admin's choice.
const settings = cached('settings', async () => {
  const doc = await AdminConfig.findOne({}).select('flags.sceneGuessEnabled world.sceneRoundSec').lean();
  const d = AdminConfig.defaults();
  return {
    enabled: (doc && doc.flags && typeof doc.flags.sceneGuessEnabled === 'boolean') ? doc.flags.sceneGuessEnabled : d.flags.sceneGuessEnabled,
    roundSec: (doc && doc.world && Number.isFinite(doc.world.sceneRoundSec)) ? doc.world.sceneRoundSec : d.world.sceneRoundSec
  };
}, { enabled: false, roundSec: 30 });

function enabledSync() { return settings.peek().enabled === true; }
function roundSecSync() { return settings.peek().roundSec; }

// ── islands (per-project switch) ──

const islands = cached('islands', async () => {
  const rows = await SceneIsland.find({ enabled: true }).select('projectId').lean();
  return new Set(rows.map(r => r.projectId));
}, new Set());

// ── projects (the guessing line) ──

const projects = cached('projects', async () => {
  const docs = await Project.find({}).select('id title runtime episodes').lean();
  const list = docs.length ? docs : (contentLoader.get('projects') || []);
  return new Map(list.map(p => [p.id, { id: p.id, title: p.title, runtime: p.runtime, episodes: p.episodes }]));
}, new Map());

function projectSync(projectId) { return projects.peek().get(projectId) || null; }

// ── pool ──

const pool = cached('pool', async () => {
  const rows = await SceneStill.aggregate([
    { $match: { active: true } },
    { $group: { _id: '$projectId', n: { $sum: 1 } } }
  ]);
  return new Map(rows.map(r => [r._id, r.n]));
}, new Map());

function isPlayableSync(projectId) {
  return (pool.peek().get(projectId) || 0) >= Logic.C.MIN_POOL;
}

async function playableIds() {
  const counts = await pool.get();
  return [...counts].filter(([, n]) => n >= Logic.C.MIN_POOL).map(([id]) => id);
}

// Island switched on AND enough stills (the global switch is checked by the
// caller — it gates everything, not just which islands).
function isLiveSync(projectId) {
  return islands.peek().has(projectId) && isPlayableSync(projectId);
}
async function liveIslands() {
  const [on, counts] = await Promise.all([islands.get(), pool.get()]);
  return [...on].filter(id => (counts.get(id) || 0) >= Logic.C.MIN_POOL);
}

// Load everything once at startup so the first sync reads are warm.
function prime() {
  settings.get(); islands.get(); projects.get(); pool.get(); champions.get();
}

// ── champions ──

const champions = cached('champions', async () => {
  const rows = await SceneScore.aggregate([
    { $match: { best: { $gt: 0 } } },
    { $sort: { projectId: 1, best: -1, achievedAt: 1 } },
    { $group: {
      _id: '$projectId',
      userId: { $first: '$userId' },
      best: { $first: '$best' },
      achievedAt: { $first: '$achievedAt' },
      pick: { $first: '$pick' }
    } }
  ]);
  if (!rows.length) return new Map();
  const users = await User.find({ _id: { $in: rows.map(r => r.userId) } }).select('username').lean();
  const names = new Map(users.map(u => [String(u._id), u.username]));
  const pickIds = rows.map(r => r.pick).filter(Boolean);
  const picks = pickIds.length
    ? await SceneStill.find({ _id: { $in: pickIds }, active: true }).select('imageUrl publicId').lean()
    : [];
  const urls = new Map(picks.map(s => [String(s._id), stillUrl(s)]));
  const out = new Map();
  for (const r of rows) {
    const username = names.get(String(r.userId));
    if (!username) continue;
    out.set(r._id, {
      userId: String(r.userId),
      username,
      score: r.best,
      achievedAt: r.achievedAt,
      pickUrl: r.pick ? (urls.get(String(r.pick)) || null) : null
    });
  }
  return out;
}, new Map());

// Public shape of one island's record (no userId).
function publicRecord(c) {
  return c ? { username: c.username, score: c.score, achievedAt: c.achievedAt, pickUrl: c.pickUrl } : null;
}

// ── draws ──

// 10 random active stills for a game, as reducer input ({ id, url, answer }
// in global seconds). Stills that no longer fit the line (the admin shortened
// a runtime or dropped an episode) are skipped. null = not enough.
async function drawStills(projectId, tl, rng) {
  const rows = await SceneStill.find({ projectId, active: true }).select('_id episode timeSec imageUrl publicId').lean();
  const valid = rows.filter(s => Logic.validStill(tl, { timeSec: s.timeSec, episode: s.episode == null ? null : s.episode }).ok);
  const picked = Logic.pickStills(valid, Logic.C.ROUNDS, rng);
  if (!picked) return null;
  return picked.map(s => ({ id: String(s._id), url: stillUrl(s), answer: Logic.toGlobal(tl, s.episode, s.timeSec) }));
}

// After a write: drop that cache and tell the game server.
// kind: 'settings' | 'islands' | 'pool' | 'board' | 'projects'
function invalidate(kind, projectId) {
  if (kind === 'settings') settings.invalidate();
  if (kind === 'islands') islands.invalidate();
  if (kind === 'pool') pool.invalidate();
  if (kind === 'board') champions.invalidate();
  if (kind === 'projects') projects.invalidate();
  events.emit(kind, projectId);
}

module.exports = {
  TTL_MS, events, invalidate, stillUrl, prime,
  settings, enabledSync, roundSecSync,
  islands, isLiveSync, liveIslands,
  projects, projectSync,
  pool, isPlayableSync, playableIds,
  champions, publicRecord,
  drawStills
};
