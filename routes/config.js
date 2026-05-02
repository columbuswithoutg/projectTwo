const express = require('express');
const router = express.Router();
const AdminConfig = require('../models/AdminConfig');

// Public, unauthed endpoint — every connected client fetches this on boot
// to merge admin-set values over the hardcoded PHYSICS defaults in
// js/walkers.js. Walker physics is not sensitive (it's gameplay tuning,
// not user data). Mounted under a modest IP-keyed limiter in server.js.
//
// Returns the factory defaults when no admin doc exists yet, so the SPA
// always has something to merge against.
router.get('/public', async (req, res) => {
  try {
    const doc = await AdminConfig.findOne({}).lean();
    const defaults = AdminConfig.defaults();
    const cfg = doc
      ? {
          walker:    { ...defaults.walker,    ...(doc.walker || {}) },
          encounter: { ...defaults.encounter, ...(doc.encounter || {}) },
          fight:     { ...defaults.fight,     ...(doc.fight || {}) },
          flags:     { ...defaults.flags,     ...(doc.flags || {}) },
          version:   doc.version || 1
        }
      : { ...defaults, version: 0 };
    res.set('Cache-Control', 'public, max-age=30');
    res.json(cfg);
  } catch (err) {
    console.error('public config read failed:', err && err.message);
    // On error, fall back to the factory defaults so client boot never
    // blocks on a transient Mongo issue.
    res.json({ ...AdminConfig.defaults(), version: 0 });
  }
});

module.exports = router;
