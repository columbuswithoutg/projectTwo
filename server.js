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
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();

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
['/', '/map', '/login', '/profile', '/characters'].forEach(route => {
  app.get(route, (req, res) => res.sendFile(spaFile));
});

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
                    'projects.js', 'characters.js', 'locations.js'];
// Same caching policy as /js — one-day max-age keeps the network out of the
// critical path on repeat visits. HTML (spa.html, index.html) is served with
// no-cache so shell updates reach users immediately.
const HTML_FILES = new Set(['index.html', 'spa.html']);
ROOT_FILES.forEach(name => {
  app.get('/' + name, (req, res) => {
    if (HTML_FILES.has(name)) {
      res.set('Cache-Control', 'no-cache');
    } else {
      res.set('Cache-Control', 'public, max-age=86400');
    }
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
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/progress', apiLimiter, require('./routes/progress'));
app.use('/api/friends', apiLimiter, require('./routes/friends'));
app.use('/api/upload', uploadLimiter, require('./routes/upload'));
app.use('/api/profile', apiLimiter, require('./routes/profile'));

// Terminal error handler — Express 5 forwards async rejections here. Without
// this, unhandled errors in route handlers leak stack traces to the client.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: 'Server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
