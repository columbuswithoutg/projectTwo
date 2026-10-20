const express = require('express');
const router = express.Router();
const AdminConfig = require('../models/AdminConfig');
const auth = require('../middleware/auth');
const { iceServers } = require('../server/turn');

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
          world:     {
            npcBodyTypes: { ...defaults.world.npcBodyTypes, ...((doc.world && doc.world.npcBodyTypes) || {}) },
            maxProps: (doc.world && Number.isFinite(doc.world.maxProps)) ? doc.world.maxProps : defaults.world.maxProps,
            homeMaxProps: (doc.world && Number.isFinite(doc.world.homeMaxProps)) ? doc.world.homeMaxProps : defaults.world.homeMaxProps,
            sceneRoundSec: (doc.world && Number.isFinite(doc.world.sceneRoundSec)) ? doc.world.sceneRoundSec : defaults.world.sceneRoundSec
          },
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

// Voice-chat ICE config — STUN by default, TURN when configured
// (server/turn.js: time-limited HMAC credentials with TURN_SECRET, or the
// static TURN_USERNAME / TURN_CREDENTIAL pair). Authed so anonymous traffic
// can't drain a paid TURN provider's quota. The client (js/voice-chat.js)
// fetches this once per voice session; the 5-minute cache is far below the
// credential TTL (12 h by default).
router.get('/voice-turn', auth, (req, res) => {
  res.set('Cache-Control', 'private, max-age=300');
  res.json({ iceServers: iceServers(process.env, req.user.id, Date.now()) });
});

module.exports = router;
