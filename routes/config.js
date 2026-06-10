const express = require('express');
const router = express.Router();
const AdminConfig = require('../models/AdminConfig');
const auth = require('../middleware/auth');

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

// Voice-chat ICE config — STUN by default, optionally TURN if env vars set.
// Authed so anonymous traffic can't drain a paid TURN provider's quota.
// The client (js/voice-chat.js) fetches this once per voice session and
// merges the result into RTCPeerConnection config. When TURN_* env vars
// are absent, returns STUN-only — same behavior as the hardcoded fallback,
// so older deploys / misconfigured envs keep working unchanged.
router.get('/voice-turn', auth, (req, res) => {
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];
  const urls = (process.env.TURN_URLS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (urls.length && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
  }
  res.set('Cache-Control', 'private, max-age=300');
  res.json({ iceServers });
});

module.exports = router;
