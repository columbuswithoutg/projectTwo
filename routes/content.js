const express = require('express');
const router = express.Router();
const Character = require('../models/Character');
const Location = require('../models/Location');
const Dialogue = require('../models/Dialogue');
const contentLoader = require('../server/contentLoader');
const watchRules = require('../server/watchRules');
const { ttlCache } = require('../server/ttl-cache');

// Public, unauthed content endpoints. Strategy:
//   1. Try Mongo. If the collection has documents, return them.
//   2. If Mongo throws or the collection is empty, fall back to the
//      static JS files loaded by contentLoader at boot.
// This way the SPA always sees a working dataset, even on first deploy
// before the seed script runs, or during a Mongo outage. The fallback
// is server-side complexity; the client only knows about /api/content/*.

contentLoader.init();

// These endpoints are unauthenticated and every page load hits them, so the
// response body is computed at most once per CONTENT_TTL_MS per process
// instead of a full collection read per request. Projects come from
// server/watchRules.js (its own 30 s cache, same projection, dropped by every
// admin project write). Characters / locations / dialogues are dropped by
// `invalidate(kind)` below, which every CMS write in routes/admin.js calls
// (contentChanged); the short TTL covers a write from another process.
const CONTENT_TTL_MS = 30 * 1000;

// One payload builder per collection: { source, items } or { source, data }.
// A Mongo error is logged and served as the fallback (and cached like any
// other answer for the TTL, so an outage isn't a read storm either).
function listPayload(Model, kind) {
  return ttlCache(async () => {
    try {
      const docs = await Model.find({}).select('-_id -__v -createdAt -updatedAt').lean();
      if (docs.length > 0) return { source: 'db', items: docs };
    } catch (err) {
      console.error(`content/${kind}: Mongo read failed, using fallback:`, err.message);
    }
    return { source: 'fallback', items: contentLoader.get(kind) };
  }, CONTENT_TTL_MS);
}

const characters = listPayload(Character, 'characters');
const locations = listPayload(Location, 'locations');
const dialogues = ttlCache(async () => {
  try {
    const doc = await Dialogue.findOne({}).select('-_id -__v -createdAt -updatedAt').lean();
    // Treat a doc with empty maps as "not seeded yet" — fall back to
    // file content rather than serve an empty dialogue set that would
    // make walkers silent.
    if (doc && doc.pairs && Object.keys(doc.pairs).length > 0) {
      return { source: 'db', data: {
        pairs: doc.pairs,
        villainDefeatLines: doc.villainDefeatLines || {},
        villainVictoryLines: doc.villainVictoryLines || {}
      }};
    }
  } catch (err) {
    console.error('content/dialogues: Mongo read failed, using fallback:', err.message);
  }
  return { source: 'fallback', data: contentLoader.get('dialogues') };
}, CONTENT_TTL_MS);

// watchRules falls back to projects.js itself (and logs a Mongo failure);
// its Map holds the very objects contentLoader returned in that case, which
// is how `source` — read by the admin CMS (js/views/admin/cms-projects.js) —
// is told apart.
function projectsPayload(map) {
  const items = [...map.values()];
  const fallback = contentLoader.get('projects') || [];
  const isFallback = !items.length || (fallback.length > 0 && items[0] === fallback[0]);
  return { source: isFallback ? 'fallback' : 'db', items };
}

function send(res, payload) {
  res.set('Cache-Control', 'public, max-age=60');
  res.json(payload);
}

router.get('/projects', async (req, res) => {
  send(res, projectsPayload(await watchRules.allProjects()));
});

router.get('/characters', async (req, res) => {
  send(res, await characters.get());
});

router.get('/locations', async (req, res) => {
  send(res, await locations.get());
});

router.get('/dialogues', async (req, res) => {
  send(res, await dialogues.get());
});

// Drop the cached characters / locations / dialogues payloads (all three, or
// one kind) so the next request reads Mongo again.
function invalidate(kind) {
  if (!kind || kind === 'characters') characters.invalidate();
  if (!kind || kind === 'locations') locations.invalidate();
  if (!kind || kind === 'dialogues') dialogues.invalidate();
}

module.exports = router;
module.exports.invalidate = invalidate;
module.exports.projectsPayload = projectsPayload;   // tests
