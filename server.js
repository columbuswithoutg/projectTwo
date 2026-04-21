require('dotenv').config();
// Force Google DNS for local dev — fixes SRV lookup issues on some networks
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
// CORS: if CLIENT_URL is set, lock to it. Otherwise in production block
// cross-origin entirely (SPA is served same-origin by this Express, so it
// still works); in dev reflect the request origin for localhost convenience.
const corsOrigin = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(',').map(s => s.trim()).filter(Boolean)
  : (process.env.NODE_ENV === 'production' ? false : true);
app.use(cors({
  origin: corsOrigin,
  credentials: true
}));
app.use(express.json());

// SPA routes — BEFORE static middleware so they take priority over index.html
const spaFile = path.join(__dirname, 'spa.html');
['/', '/login', '/profile', '/characters'].forEach(route => {
  app.get(route, (req, res) => res.sendFile(spaFile));
});

// Static serving — scoped allowlist. Previously `express.static('.')` exposed
// server.js, routes/, models/, middleware/, .env, package.json, etc. over HTTP.
// Now each public directory/file is mounted explicitly so backend source never
// leaves the server.
app.use('/assets', express.static(path.join(__dirname, 'assets'), { maxAge: '7d' }));
app.use('/js',     express.static(path.join(__dirname, 'js')));
// Root-level client files (HTML + top-level scripts + stylesheet) are served
// from an explicit allowlist. Anything else at the project root stays private.
const ROOT_FILES = ['index.html', 'spa.html', 'app.html', 'characters.html', 'profile.html',
                    'styles.css', 'auth.js', 'projects.js', 'characters.js',
                    'locations.js', 'characters-page.js'];
ROOT_FILES.forEach(name => {
  app.get('/' + name, (req, res) => res.sendFile(path.join(__dirname, name)));
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

app.listen(process.env.PORT, () => console.log(`Server running on port ${process.env.PORT}`));
