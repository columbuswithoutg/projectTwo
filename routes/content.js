const express = require('express');
const router = express.Router();
const Project = require('../models/Project');
const Character = require('../models/Character');
const Location = require('../models/Location');
const Dialogue = require('../models/Dialogue');
const contentLoader = require('../server/contentLoader');

// Public, unauthed content endpoints. Strategy:
//   1. Try Mongo. If the collection has documents, return them.
//   2. If Mongo throws or the collection is empty, fall back to the
//      static JS files loaded by contentLoader at boot.
// This way the SPA always sees a working dataset, even on first deploy
// before the seed script runs, or during a Mongo outage. The fallback
// is server-side complexity; the client only knows about /api/content/*.

contentLoader.init();

router.get('/projects', async (req, res) => {
  try {
    const docs = await Project.find({}).select('-_id -__v -createdAt -updatedAt').lean();
    if (docs.length > 0) {
      res.set('Cache-Control', 'public, max-age=60');
      return res.json({ source: 'db', items: docs });
    }
  } catch (err) {
    console.error('content/projects: Mongo read failed, using fallback:', err.message);
  }
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ source: 'fallback', items: contentLoader.get('projects') });
});

router.get('/characters', async (req, res) => {
  try {
    const docs = await Character.find({}).select('-_id -__v -createdAt -updatedAt').lean();
    if (docs.length > 0) {
      res.set('Cache-Control', 'public, max-age=60');
      return res.json({ source: 'db', items: docs });
    }
  } catch (err) {
    console.error('content/characters: Mongo read failed, using fallback:', err.message);
  }
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ source: 'fallback', items: contentLoader.get('characters') });
});

router.get('/locations', async (req, res) => {
  try {
    const docs = await Location.find({}).select('-_id -__v -createdAt -updatedAt').lean();
    if (docs.length > 0) {
      res.set('Cache-Control', 'public, max-age=60');
      return res.json({ source: 'db', items: docs });
    }
  } catch (err) {
    console.error('content/locations: Mongo read failed, using fallback:', err.message);
  }
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ source: 'fallback', items: contentLoader.get('locations') });
});

router.get('/dialogues', async (req, res) => {
  try {
    const doc = await Dialogue.findOne({}).select('-_id -__v -createdAt -updatedAt').lean();
    // Treat a doc with empty maps as "not seeded yet" — fall back to
    // file content rather than serve an empty dialogue set that would
    // make walkers silent.
    if (doc && doc.pairs && Object.keys(doc.pairs).length > 0) {
      res.set('Cache-Control', 'public, max-age=60');
      return res.json({ source: 'db', data: {
        pairs: doc.pairs,
        villainDefeatLines: doc.villainDefeatLines || {},
        villainVictoryLines: doc.villainVictoryLines || {}
      }});
    }
  } catch (err) {
    console.error('content/dialogues: Mongo read failed, using fallback:', err.message);
  }
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ source: 'fallback', data: contentLoader.get('dialogues') });
});

module.exports = router;
