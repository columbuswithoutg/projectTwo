require('dotenv').config();

// Fail fast at boot if critical env is missing — otherwise jwt.sign throws
// mid-request and the user gets an opaque 500 on their first login attempt.
['MONGO_URI', 'JWT_SECRET'].forEach(key => {
  if (!process.env[key]) {
    console.error(`FATAL: ${key} is not set in environment. Aborting.`);
    process.exit(1);
  }
});

// Force Google DNS for local dev — fixes SRV lookup issues on some networks
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { Server: SocketIOServer } = require('socket.io');

const app = express();

// Compress JSON + HTML responses. Cuts response sizes ~70% on text payloads.
// Already-compressed binaries in /assets are skipped automatically by content-type.
app.use(compression());

// Baseline security headers. CSP is disabled for now because the SPA uses an
// inline importmap, a CDN script (unpkg.com for Three.js), Cloudinary images,
// and Google Fonts — a strict default-src 'self' would brick first paint.
// COEP is disabled and CORP set to cross-origin so Cloudinary memories and
// /assets still load in friend-views.
app.use(helmet({
  contentSecurityPolicy: false,
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
app.use(express.json({ limit: '64kb' }));

// SPA routes — BEFORE static middleware so they take priority over index.html
const spaFile = path.join(__dirname, 'spa.html');
['/', '/map', '/login', '/profile', '/characters', '/home', '/customize', '/admin', '/world'].forEach(route => {
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
app.use('/assets', express.static(path.join(__dirname, 'assets'), { maxAge: '30d' }));
// /js is the biggest chunk of per-request bytes and the content is static
// between deploys — cache it for a day. Browsers still revalidate via ETag
// when the file changes, and a hard refresh bypasses this entirely, so a
// stale bundle after deploy resolves itself within one day without manual
// intervention. For shorter invalidation, adopt hashed filenames.
app.use('/js', express.static(path.join(__dirname, 'js'), { maxAge: '1d', etag: true }));
// Root-level client files (HTML + top-level scripts + stylesheet) are served
// from an explicit allowlist. The pre-SPA orphan pages (app.html,
// characters.html, profile.html) and their scripts are deliberately omitted
// so old links can't resurrect the broken flow.
const ROOT_FILES = ['index.html', 'spa.html', 'styles.css', 'auth.js',
                    'projects.js', 'characters.js', 'locations.js',
                    'manifest.json', 'sw.js'];
// Same caching policy as /js — one-day max-age keeps the network out of the
// critical path on repeat visits. HTML (spa.html, index.html) is served with
// no-cache so shell updates reach users immediately. sw.js is also served
// no-cache so service-worker updates can't be pinned by the HTTP cache.
const HTML_FILES = new Set(['index.html', 'spa.html']);
const NO_CACHE_FILES = new Set(['sw.js']);
ROOT_FILES.forEach(name => {
  app.get('/' + name, (req, res) => {
    if (HTML_FILES.has(name) || NO_CACHE_FILES.has(name)) {
      res.set('Cache-Control', 'no-cache');
    } else {
      res.set('Cache-Control', 'public, max-age=86400');
    }
    // The service worker must be allowed to control the whole origin even
    // though it sits at root — defensive header for hosting setups that
    // otherwise narrow scope.
    if (name === 'sw.js') res.set('Service-Worker-Allowed', '/');
    res.sendFile(path.join(__dirname, name));
  });
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error(err));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts, try again in 15 minutes' },
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
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/progress', apiLimiter, require('./routes/progress'));
app.use('/api/friends', apiLimiter, require('./routes/friends'));
app.use('/api/upload', uploadLimiter, require('./routes/upload'));
app.use('/api/profile', apiLimiter, require('./routes/profile'));
app.use('/api/admin', adminLimiter, require('./middleware/requireAdmin'), require('./routes/admin'));
app.use('/api/config', publicConfigLimiter, require('./routes/config'));
// Public content (projects, characters, locations, dialogues). Reuses the
// same modest IP limiter as /api/config since both are cached and called
// once at boot per client.
app.use('/api/content', publicConfigLimiter, require('./routes/content'));

// Terminal error handler — Express 5 forwards async rejections here. Without
// this, unhandled errors in route handlers leak stack traces to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: 'Server error' });
});

// Wrap the Express app in a Node HTTP server so Socket.IO can share the
// same listener. /world's real-time presence + chat + emotes ride on this.
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  // Same-origin only; /world is auth-gated and never expected to be
  // embedded by another site. CORS would only matter for cross-origin.
  cors: { origin: false }
});
require('./routes/world-socket')(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
