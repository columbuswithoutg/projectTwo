/************************************************
 * server/turn.js — the ICE server list handed to the voice client
 * (routes/config.js GET /voice-turn).
 *
 * Three modes, by environment:
 *  - TURN_URLS + TURN_SECRET: time-limited credentials per request (the
 *    coturn `use-auth-secret` / "REST API" scheme: username = "<expiry>:<user>",
 *    credential = base64(HMAC-SHA1(secret, username))). A harvested pair
 *    stops working after TURN_TTL_SEC (default 12 h) instead of forever.
 *  - TURN_URLS + TURN_USERNAME + TURN_CREDENTIAL: the static pair, as before
 *    (providers that only offer long-lived credentials).
 *  - nothing set: Google STUN only.
 *
 * Pure: unit-tested in test/turn.test.js.
 ************************************************/
const crypto = require('crypto');

const STUN = Object.freeze([
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
]);
const DEFAULT_TTL_SEC = 12 * 60 * 60;

function turnUrls(env) {
  return String((env && env.TURN_URLS) || '').split(',').map(s => s.trim()).filter(Boolean);
}

function iceServers(env, userId, nowMs) {
  const e = env || {};
  const servers = STUN.map(s => ({ urls: s.urls }));
  const urls = turnUrls(e);
  if (!urls.length) return servers;
  if (e.TURN_SECRET) {
    const ttl = Number(e.TURN_TTL_SEC) > 0 ? Math.floor(Number(e.TURN_TTL_SEC)) : DEFAULT_TTL_SEC;
    const exp = Math.floor((Number.isFinite(nowMs) ? nowMs : Date.now()) / 1000) + ttl;
    const username = `${exp}:${String(userId)}`;
    const credential = crypto.createHmac('sha1', e.TURN_SECRET).update(username).digest('base64');
    servers.push({ urls, username, credential });
  } else if (e.TURN_USERNAME && e.TURN_CREDENTIAL) {
    servers.push({ urls, username: e.TURN_USERNAME, credential: e.TURN_CREDENTIAL });
  }
  return servers;
}

module.exports = { iceServers, turnUrls, STUN, DEFAULT_TTL_SEC };
