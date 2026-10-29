require('dotenv').config();

// Fail fast at boot if critical env is missing — otherwise jwt.sign throws
// mid-request and the user gets an opaque 500 on their first login attempt.
// In production the Cloudinary vars are required too: without them every
// upload 502s and server/cloudinary-url.js rejects every memory/profile/
// portrait URL as "must be uploaded through the app", with nothing saying
// why. Dev (and the QA recipes, which run with only MONGO_URI/JWT_SECRET)
// just gets a warning. The rules live in server/boot-checks.js (unit-tested).
const BootChecks = require('./server/boot-checks');
BootChecks.requiredMissing(process.env).forEach(key => {
  console.error(`FATAL: ${key} is not set in environment. Aborting.`);
  process.exit(1);
});
const cloudinaryMissing = BootChecks.warnMissing(process.env);
if (cloudinaryMissing.length) {
  console.warn(`WARNING: ${cloudinaryMissing.join(', ')} not set — uploads will fail and every ` +
    'memory/profile/portrait URL will be rejected until Cloudinary is configured.');
}
// A guessable JWT_SECRET lets anyone mint valid session tokens. Require
// real entropy. Generate one with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
if (process.env.JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be at least 32 characters. Aborting.');
  process.exit(1);
}

// Force Google DNS for local dev — fixes SRV lookup issues on some networks.
// Production keeps the host's resolver (Render's, for the mongodb+srv
// SRV/TXT lookup) unless FORCE_PUBLIC_DNS=1 opts back in.
const dns = require('dns');
if (BootChecks.usePublicDns(process.env)) dns.setServers(['8.8.8.8', '8.8.4.4']);
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { Server: SocketIOServer } = require('socket.io');
const fs = require('fs');

// The client is served from dist/ — hashed, minified chunks plus the
// generated spa.html and sw.js written by scripts/build.mjs. `npm install`
// builds it (postinstall) and `npm run dev` builds + watches. Refuse to start
// without it rather than 404 the whole app.
const DIST = path.join(__dirname, 'dist');
if (!fs.existsSync(path.join(DIST, 'spa.html'))) {
  console.error('FATAL: dist/spa.html not found. Run `npm run build` (or `npm run dev`) first.');
  process.exit(1);
}

const app = express();

// Render terminates TLS at a single proxy hop and forwards the client
// address in X-Forwarded-For. Without this, req.ip is the proxy address, so
// every rate limiter below collapses into ONE shared bucket for all users
// (20 login attempts per 15 min for the whole site) and AuditLog.ip records
// the proxy. 1 = trust exactly one hop; express-rate-limit v8 refuses the
// permissive true. Raise the hop count if another proxy (e.g. Cloudflare)
// is ever put in front of Render — set TRUST_PROXY=<hops> (0–10) in the
// environment; unset or invalid falls back to 1. The socket.io handshake
// reads the same value to find the client address for its IP limit.
const { parseTrustProxy } = require('./server/socket-guard');
const TRUST_PROXY_HOPS = parseTrustProxy(process.env.TRUST_PROXY);
app.set('trust proxy', TRUST_PROXY_HOPS);

// Compress JSON + HTML responses. Cuts response sizes ~70% on text payloads.
// Already-compressed binaries in /assets are skipped automatically by content-type.
app.use(compression());

// Baseline security headers. CSP is ENFORCED: the allowlist below covers
// everything the SPA loads (inline importmap + module shim, unpkg.com for
// Three.js, Cloudinary memories, Google Fonts, websockets, canvas data-URL
// thumbnails). Verified violation-free across login/map/watch-order/world/
// home/customize before enforcement (2026-07-07). If a new external source
// is ever added, extend the allowlist FIRST or first paint will brick.
// COEP is disabled and CORP set to cross-origin so Cloudinary memories and
// /assets still load in friend-views.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    reportOnly: false,
    directives: {
      'default-src': ["'self'"],
      // 'unsafe-inline' covers the importmap + inline module shim in
      // spa.html. Tightening to a hash/nonce is the batch-2 follow-up.
      'script-src': ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com'],
      'media-src': ["'self'", 'blob:', 'https://res.cloudinary.com'],
      // blob: — Three's GLTFLoader decodes textures embedded in .glb character
      // models (assets/models/humanoid) by fetch()ing blob: URLs in Chrome.
      'connect-src': ["'self'", 'ws:', 'wss:', 'https://unpkg.com', 'blob:'],
      'worker-src': ["'self'"],
      'upgrade-insecure-requests': null
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// CORS: explicit allowlist only. Previously a NODE_ENV=development fallback
// reflected any origin, which silently opened up any environment where that
// flag leaked. If CLIENT_URL isn't set we disable cross-origin entirely —
// same-origin requests (the SPA served from this app) are unaffected.
const corsOrigin = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(',').map(s => s.trim()).filter(Boolean)
  : false;
app.use(cors({
  origin: corsOrigin,
  credentials: true
}));
// Cap body size — progress payloads are small; the upload route uses multer
// and is not affected by this limit.
// Exception: the CMS dialogues save (PUT /api/admin/content/dialogues in
// routes/admin.js) sends the WHOLE dialogue document — ~20 KB today, so a
// few rounds of writing would hit 64 KB and every save would 413. That path
// gets a 512 KB parser, but it is mounted INSIDE routes/admin.js, i.e. after
// adminLimiter and requireAdmin, so an unauthenticated client can never make
// the server read more than it would on any other path (and, because the
// gate answers first, not even that). For it to work the global parser here
// must leave the dialogues body alone: express.json's `type` option may be a
// function, and body-parser 2.x (lib/read.js) calls next() WITHOUT touching
// the stream when it returns false ("skip parsing"). So the predicate below
// keeps the default application/json check for every other path and says
// "not mine" for the dialogues path. It mirrors how the router's
// router.use('/content/dialogues') matches: case-insensitive, the path itself
// or anything under it (req.path here is the full path, no query string).
// (test/body-limit.test.js pins the mechanism and both mount points.)
const DIALOGUES_BODY_PATH = '/api/admin/content/dialogues';
function isDialoguesPath(req) {
  const p = String(req.path || '').toLowerCase();
  return p === DIALOGUES_BODY_PATH || p.startsWith(DIALOGUES_BODY_PATH + '/');
}
app.use(express.json({ limit: '64kb', type: (req) => !isDialoguesPath(req) && Boolean(req.is('application/json')) }));

// SPA routes — BEFORE static middleware so they take priority over index.html
const spaFile = path.join(DIST, 'spa.html');
// '/spa.html' itself is the service worker's precached offline fallback.
['/', '/spa.html', '/map', '/login', '/profile', '/characters', '/home', '/customize', '/admin', '/world', '/board', '/feed', '/messages', '/reports'].forEach(route => {
  app.get(route, (req, res) => res.sendFile(spaFile));
});
// Parameterized SPA routes — `/friend/:username` and its sub-tabs all
// serve spa.html so the client-side router resolves the username.
app.get(/^\/friend\/[^/]+(\/(map|home|profile))?$/, (req, res) => res.sendFile(spaFile));
// /home/edit also goes through the SPA shell.
app.get('/home/edit', (req, res) => res.sendFile(spaFile));

// Static serving — scoped allowlist. Previously `express.static('.')` exposed
// server.js, routes/, models/, middleware/, .env, package.json, etc. over HTTP.
// Now each public directory/file is mounted explicitly so backend source never
// leaves the server.
// Long-lived caching only in production (Render sets NODE_ENV=production).
// In dev, everything revalidates (no-cache) so edits show up on plain reload
// instead of hiding behind the browser HTTP cache for a day.
const IS_PROD = process.env.NODE_ENV === 'production';
// The character models live in a versioned folder (assets/models/humanoid/vN,
// written by scripts/build-humanoid-assets.mjs): a changed model means a new
// folder, so a given URL never changes → cache it for good in production.
app.use('/assets/models/humanoid', express.static(path.join(__dirname, 'assets', 'models', 'humanoid'),
  IS_PROD ? { immutable: true, maxAge: '1y', index: false } : { maxAge: 0, index: false }));
// Everything else under /assets keeps its name when it changes —
// scripts/optimize-images.mjs rewrites files in place — so the browser cache
// may hold a copy for at most a day in production (it was 30 days, so an
// updated poster could stay stale for a month). The pieces together:
//   - URLs built with assetUrl() (js/config.js) carry ?v=ASSET_VERSION; bump
//     it and every client fetches a new URL at once, cache or no cache.
//   - Everything else (CSS backgrounds, manifest icons, unversioned srcs) is
//     at most 1 day stale in the HTTP cache.
//   - The service worker (sw.js) serves /assets stale-while-revalidate and
//     revalidates with cache: 'no-cache', i.e. a conditional request that
//     skips this max-age, so an installed PWA is at most one load behind.
app.use('/assets', express.static(path.join(__dirname, 'assets'), { maxAge: IS_PROD ? '1d' : 0 }));
// Built client. Every file under dist/static carries a content hash in its
// name (core.a1b2c3d4.js, styles.<hash>.css …), so it is cached forever: a
// new build produces new names and the generated spa.html points at them.
// Source files under js/ are no longer served.
app.use('/dist', express.static(path.join(DIST, 'static'), { immutable: true, maxAge: '1y', index: false }));
// Root-level client files (HTML + top-level scripts + stylesheet) are served
// from an explicit allowlist. The pre-SPA orphan pages (app.html,
// characters.html, profile.html) and their scripts are deliberately omitted
// so old links can't resurrect the broken flow.
// Only the PWA manifest still comes from the repo root. spa.html and sw.js
// are the generated ones in dist/ (below); projects.js / characters.js /
// locations.js are bundled into the core chunk, and the stylesheet is built
// from styles/. The pre-SPA login page (index.html + auth.js + the raw
// stylesheet) is gone — old links land on the SPA's /login.
app.get('/index.html', (req, res) => res.redirect(301, '/login'));
const ROOT_FILES = ['manifest.json'];
ROOT_FILES.forEach(name => {
  app.get('/' + name, (req, res) => {
    if (!IS_PROD) {
      res.set('Cache-Control', 'no-cache');
    } else {
      res.set('Cache-Control', 'public, max-age=86400');
    }
    res.sendFile(path.join(__dirname, name));
  });
});
// Generated service worker (dist/sw.js). no-cache so a new build can't be
// pinned by the HTTP cache; Service-Worker-Allowed lets it control the whole
// origin on hosting setups that would otherwise narrow the scope.
app.get('/sw.js', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.set('Service-Worker-Allowed', '/');
  res.sendFile(path.join(DIST, 'sw.js'));
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('MongoDB connected');
    // Give seeded projects their watch runtimes (never overwrites admin edits).
    require('./server/watchRules').backfillRuntimes();
    // usernameLower readiness: once every account has the field the
    // case-insensitive regex fallback switches off (server/username.js).
    require('./server/username').startReadinessPoll();
  })
  // Mongoose never retries a failed INITIAL connect: the process would stay
  // up with no database — every DB request hanging to the buffer timeout,
  // /api/health 503 forever, the backfill and readiness poll never run.
  // Exit instead so Render restarts us (same fail-fast as the env checks).
  .catch(err => {
    console.error('FATAL: initial MongoDB connection failed. Exiting so the platform restarts the process.', err);
    process.exit(1);
  });

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts, try again in 15 minutes' },
  // Logging out is authed and harmless; don't let it eat the login budget.
  skip: (req) => req.path === '/logout',
});
// Moderate limit for authenticated mutating endpoints — prevents spam of
// progress writes, memory uploads, friend requests, etc.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, slow down and try again.' },
});
// Tighter limit on upload endpoint — Cloudinary quota protection.
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many uploads, try again in a minute.' },
});
// Tighter limit on the admin surface — admin actions are bursty but never
// that bursty, and a stolen admin token shouldn't be able to nuke users at
// line-rate. requireAdmin (mounted inside the router) is the actual gate.
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin requests, slow down.' },
});
// Public unauthed surface (currently just /api/config/public for walker
// physics). Modest IP-keyed limit prevents a misbehaving client from
// hammering the boot-time fetch.
const publicConfigLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many config requests.' },
});
// Liveness + readiness. Point Render's Health Check Path at /api/health so a
// process whose Mongo connection is down (readyState !== 1) fails the check
// and gets recycled instead of serving 500s. No rate limiter: health probes
// are frequent and the handler does no I/O.
app.get('/api/health', (req, res) => {
  const dbUp = mongoose.connection.readyState === 1;
  res.set('Cache-Control', 'no-store');
  res.status(dbUp ? 200 : 503).json({
    ok: dbUp,
    db: dbUp ? 'connected' : 'disconnected',
    uptime: Math.round(process.uptime())
  });
});
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/progress', apiLimiter, require('./routes/progress'));
app.use('/api/friends', apiLimiter, require('./routes/friends'));
app.use('/api/feed', apiLimiter, require('./routes/feed'));
app.use('/api/upload', uploadLimiter, require('./routes/upload'));
app.use('/api/profile', apiLimiter, require('./routes/profile'));
// Messages inbox (persisted whispers / DMs / admin replies) and bug &
// suggestion reports (user side; the admin side is under /api/admin).
app.use('/api/messages', apiLimiter, require('./routes/messages'));
app.use('/api/reports', apiLimiter, require('./routes/reports'));
// Keeper-editable /world houses (GET all + keepers, PUT by the island keeper).
app.use('/api/world', apiLimiter, require('./routes/world'));
app.use('/api/admin', adminLimiter, require('./middleware/requireAdmin'), require('./routes/admin'));
app.use('/api/config', publicConfigLimiter, require('./routes/config'));
// Public content (projects, characters, locations, dialogues). Reuses the
// same modest IP limiter as /api/config since both are cached and called
// once at boot per client.
app.use('/api/content', publicConfigLimiter, require('./routes/content'));
// Unknown /api/* paths answer JSON, not Express's "Cannot GET …" HTML page —
// a stale client calling a removed route would otherwise throw in res.json().
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Terminal error handler — Express 5 forwards async rejections here. Without
// this, unhandled errors in route handlers leak stack traces to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  // Client mistakes from the body parser: answer plainly and don't log the
  // error object — it carries the raw body, which for a truncated login
  // request would put a plaintext password in the server log.
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request body' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large' });
  console.error(err);
  res.status(err.status || 500).json({ error: 'Server error' });
});

// Wrap the Express app in a Node HTTP server so Socket.IO can share the
// same listener. /world's real-time presence + chat + emotes ride on this.
//
// SINGLE INSTANCE ONLY. All realtime and cache state lives in this process:
// worldPlayers, Scene Guess games, pendingCredits (island stay), the rate
// buckets, the SceneData caches and the auth caches. Two Render instances —
// or a zero-downtime deploy where old and new overlap — split the world in
// two (players on one can't see the other, credits/games/limits diverge).
// Scaling out would need the socket.io Redis adapter plus shared caches.
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  // Same-origin only; /world is auth-gated and never expected to be
  // embedded by another site. CORS would only matter for cross-origin.
  cors: { origin: false },
  // Cap inbound socket frames well below the 1MB default. The only large
  // legitimate payloads are WebRTC SDP offers (a few KB); position/chat/
  // character frames are tiny. This blocks a client from parking a huge
  // "character" blob that the server re-broadcasts to every joiner.
  maxHttpBufferSize: 32 * 1024
});
const worldSocket = require('./routes/world-socket');
worldSocket(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Graceful shutdown. Render sends SIGTERM on every deploy; without this the
// process died mid-flight: up to one flush interval of queued island-stay
// credit per player was lost, live Scene Guess games just vanished and
// in-flight requests were cut. Runs once (a second signal is ignored), and a
// hard timeout exits anyway so a hung step can't hold the deploy. Order:
//   1. end live Scene Guess games with reason 'restart' (while sockets are up)
//   2. io.close() — disconnects every socket (their disconnect handlers bank
//      stay time), stops new connections and closes the HTTP server, which
//      waits for in-flight requests to finish
//   3. clear the stay timer and write every pending/live stay one last time
//   4. wait for the HTTP drain, then mongoose.disconnect(), then exit
const SHUTDOWN_TIMEOUT_MS = 8000;
let shuttingDown = false;
function shutdown(why, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${why}: shutting down (hard exit in ${SHUTDOWN_TIMEOUT_MS} ms)`);
  setTimeout(() => {
    console.error('[shutdown] timed out; exiting anyway');
    process.exit(exitCode || 1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
  (async () => {
    try {
      const ended = require('./server/island-games').endAll('restart');
      console.log(`[shutdown] ended ${ended} live island game(s)`);
    } catch (err) { console.error('[shutdown] island games:', err); }
    const httpClosed = io.close();
    console.log('[shutdown] sockets disconnected; no new connections');
    try {
      await worldSocket.shutdownStays();
      console.log('[shutdown] island stays flushed');
    } catch (err) { console.error('[shutdown] stay flush:', err); }
    await httpClosed;
    console.log('[shutdown] in-flight requests finished');
    try {
      await mongoose.disconnect();
      console.log('[shutdown] MongoDB disconnected');
    } catch (err) { console.error('[shutdown] MongoDB disconnect:', err); }
    process.exit(exitCode);
  })().catch(err => {
    console.error('[shutdown] failed:', err);
    process.exit(exitCode || 1);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// A stray rejection (e.g. a throw after an await in an async socket handler)
// would terminate the process on modern Node and drop all in-memory world
// state. The handlers are written carefully, so log it and keep serving.
process.on('unhandledRejection', (reason) => console.error('unhandledRejection', reason));
// A synchronous throw nobody caught leaves the process in an unknown state:
// log it, then take the graceful path (exit 1) so Render restarts us cleanly.
process.on('uncaughtException', (err) => {
  console.error('uncaughtException', err);
  shutdown('uncaughtException', 1);
});
