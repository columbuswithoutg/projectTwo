/**
 * The CMS dialogues save sends the whole dialogue document, so it needs a
 * bigger body limit than the global 64 KB. The arrangement:
 *  - server.js keeps ONE global express.json({ limit: '64kb' }) but gives it
 *    a `type` predicate that returns false for /api/admin/content/dialogues.
 *    body-parser 2.x (lib/read.js) then calls next() without reading the
 *    stream ("skip parsing").
 *  - routes/admin.js mounts express.json({ limit: '512kb' }) on
 *    /content/dialogues INSIDE the router, which server.js mounts behind
 *    adminLimiter + requireAdmin — so the big parser only ever runs for an
 *    admin, and an unauthenticated request is refused with its body unread.
 * Pinned here with the real express.json on a throwaway app (same predicate,
 * same mount order), plus source-level checks on server.js / routes/admin.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');

const DIALOGUES_BODY_PATH = '/api/admin/content/dialogues';
function isDialoguesPath(req) {
  const p = String(req.path || '').toLowerCase();
  return p === DIALOGUES_BODY_PATH || p.startsWith(DIALOGUES_BODY_PATH + '/');
}

function makeApp(seen) {
  const app = express();
  app.use(express.json({ limit: '64kb', type: (req) => !isDialoguesPath(req) && Boolean(req.is('application/json')) }));
  // Stand-in for requireAdmin: records whether anything has started reading
  // the body by the time the gate runs, then refuses unless the test header
  // says "admin".
  const fakeRequireAdmin = (req, res, next) => {
    seen.push({
      path: req.originalUrl,
      dataListeners: req.listenerCount('data'),
      readableEnded: req.readableEnded,
      body: req.body
    });
    if (req.headers['x-test-admin'] !== '1') return res.status(403).json({ error: 'Admin access required' });
    next();
  };
  const router = express.Router();
  router.use('/content/dialogues', express.json({ limit: '512kb' }));
  router.put('/content/dialogues', (req, res) => res.json({ bytes: req.body.pad.length }));
  router.put('/other', (req, res) => res.json({ bytes: req.body.pad.length }));
  app.use('/api/admin', fakeRequireAdmin, router);
  app.put('/api/other', (req, res) => res.json({ bytes: req.body.pad.length }));
  app.use((err, req, res, next) => res.status(err.status || 500).json({ type: err.type }));
  return app;
}

function put(port, urlPath, size, headers) {
  const body = JSON.stringify({ pad: 'x'.repeat(size) });
  return new Promise((resolve, reject) => {
    const req = http.request({ port, path: urlPath, method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function withServer(fn) {
  const seen = [];
  const server = makeApp(seen).listen(0);
  try {
    await fn(server.address().port, seen);
  } finally {
    server.close();
  }
}

test('unauthenticated 200 KB to the dialogues path is refused before any body is read', async () => {
  await withServer(async (port, seen) => {
    for (const p of [DIALOGUES_BODY_PATH, '/API/Admin/Content/Dialogues', DIALOGUES_BODY_PATH + '/']) {
      seen.length = 0;
      const r = await put(port, p, 200 * 1024);
      assert.equal(r.status, 403, p + ' is refused by the gate, not 413');
      assert.equal(seen.length, 1);
      assert.equal(seen[0].dataListeners, 0, p + ': no parser attached to the stream before the gate');
      assert.equal(seen[0].readableEnded, false, p + ': body stream not consumed before the gate');
      assert.equal(seen[0].body, undefined, p + ': nothing parsed before the gate');
    }
  });
});

test('admin dialogues save takes 200 KB, rejects 600 KB; other paths still 413 past 64 KB', async () => {
  await withServer(async (port) => {
    const admin = { 'X-Test-Admin': '1' };
    const big = await put(port, DIALOGUES_BODY_PATH, 200 * 1024, admin);
    assert.equal(big.status, 200);
    assert.equal(big.json.bytes, 200 * 1024);
    const tooBig = await put(port, DIALOGUES_BODY_PATH, 600 * 1024, admin);
    assert.equal(tooBig.status, 413);
    assert.equal(tooBig.json.type, 'entity.too.large');
    // A sibling admin path is not widened: the global parser 413s it first.
    const adminOther = await put(port, '/api/admin/other', 100 * 1024, admin);
    assert.equal(adminOther.status, 413);
    const other = await put(port, '/api/other', 100 * 1024);
    assert.equal(other.status, 413);
    assert.equal(other.json.type, 'entity.too.large');
    const small = await put(port, '/api/other', 10 * 1024);
    assert.equal(small.status, 200, 'the type predicate still parses ordinary JSON');
    assert.equal(small.json.bytes, 10 * 1024);
  });
});

test('server.js skips the dialogues path in the global parser; routes/admin.js owns the 512 KB parser', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const admin = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
  assert.ok(server.includes("const DIALOGUES_BODY_PATH = '/api/admin/content/dialogues';"));
  assert.ok(server.includes("app.use(express.json({ limit: '64kb', type: (req) => !isDialoguesPath(req) && Boolean(req.is('application/json')) }));"),
    'global parser keeps 64 KB and skips the dialogues path');
  assert.ok(!/express\.json\(\{\s*limit:\s*'512kb'/.test(server), 'no 512 KB parser ahead of the admin gate');
  assert.ok(server.includes("app.use('/api/admin', adminLimiter, require('./middleware/requireAdmin'), require('./routes/admin'));"),
    'the admin router (and its parser) sits behind the limiter and requireAdmin');
  const parser = admin.indexOf("router.use('/content/dialogues', express.json({ limit: '512kb' }));");
  const putRoute = admin.indexOf("router.put('/content/dialogues'");
  assert.ok(parser > 0 && putRoute > 0, 'both are present in routes/admin.js');
  assert.ok(parser < putRoute, 'the parser runs before the dialogues PUT handler');
});
