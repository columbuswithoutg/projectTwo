/************************************************
 * routes/admin-quotes.js (the Quote Guess admin API) and the player
 * suggestion route in routes/world-quotes.js, with Mongo stubbed.
 *
 * The real router is mounted on a throwaway express app behind a stand-in
 * admin gate (as in test/admin-users-route.test.js). QuoteLine / QuoteScore
 * / QuoteIsland / Character get a tiny in-memory store with the query
 * methods the routes use (equality, $or, $in, $ne, $gt(e); the unique
 * {projectId, textKey} index), and the project list is stubbed on
 * watchRules. Covers: add / edit / hide / delete, duplicates, per-field
 * errors, the suggestion queue (approve with edits, reject), the importer's
 * commit (new / duplicate / error rows, skip vs update, limits, undo) and
 * the island switches. Suggestions: the switches, "watched it first",
 * the required time, the per-player limits, duplicates and the credit.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const mongoose = require('mongoose');
const QuoteLine = require('../models/QuoteLine');
const QuoteScore = require('../models/QuoteScore');
const QuoteIsland = require('../models/QuoteIsland');
const Character = require('../models/Character');
const watchRules = require('../server/watchRules');
const User = require('../models/user');

// routes/world-quotes.js sits behind the JWT middleware; this stand-in
// signs everyone in as `currentUser`.
let currentUser = 'u1';
const authPath = require.resolve('../middleware/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: (req, res, next) => { req.user = { id: currentUser }; next(); } };

const PROJECTS = new Map([
  ['avengers1', { id: 'avengers1', title: 'The Avengers', runtime: 143, release: '2012-05-04', gridX: 0, gridY: 0 }],
  ['wandavision', { id: 'wandavision', title: 'WandaVision', episodes: [29, 35, 33], release: '2021-01-15', gridX: 1, gridY: 0 }]
]);
watchRules.getProject = async (id) => PROJECTS.get(id) || null;
watchRules.allProjects = async () => PROJECTS;

// ── a tiny in-memory collection ──

function matches(doc, filter) {
  return Object.entries(filter || {}).every(([k, want]) => {
    if (k === '$or') return want.some(f => matches(doc, f));
    const have = k.split('.').reduce((o, p) => (o == null ? o : o[p]), doc);
    if (want && typeof want === 'object' && !(want instanceof Date) && !mongoose.isValidObjectId(want)) {
      if ('$in' in want) return want.$in.map(String).includes(String(have));
      if ('$ne' in want) return String(have) !== String(want.$ne);
      if ('$gt' in want) return have > want.$gt;
      if ('$gte' in want) return have >= want.$gte;
      if ('$lt' in want) return have < want.$lt;
    }
    return String(have) === String(want);
  });
}
function chain(run) {
  const q = { select: () => q, sort: () => q, limit: () => q, populate: () => q, lean: () => Promise.resolve().then(run), then: (a, b) => q.lean().then(a, b) };
  return q;
}
function fakeModel(model, unique) {
  const rows = [];
  const clone = (d) => (d ? JSON.parse(JSON.stringify(d)) : d);
  const dupe = (doc, self) => unique && rows.some(r => r !== self && unique.every(k => String(r[k]) === String(doc[k])));
  const err11000 = () => Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
  const insert = (data) => {
    const doc = Object.assign({ _id: new mongoose.Types.ObjectId().toString(), createdAt: new Date(Date.now() + rows.length), updatedAt: new Date() }, clone(data));
    if (dupe(doc)) throw err11000();
    rows.push(doc);
    return doc;
  };
  const apply = (doc, update) => {
    const next = Object.assign({}, doc, clone(update.$set || {}));
    if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) next[k] = (next[k] || 0) + v;
    if (dupe(next, doc)) throw err11000();
    Object.assign(doc, next);
  };
  Object.assign(model, {
    _rows: rows,
    find: (f) => chain(() => rows.filter(r => matches(r, f)).map(clone)),
    findOne: (f) => chain(() => clone(rows.find(r => matches(r, f)) || null)),
    findById: (id) => chain(() => clone(rows.find(r => r._id === String(id)) || null)),
    countDocuments: async (f) => rows.filter(r => matches(r, f)).length,
    create: async (data) => { const d = insert(data); return { ...clone(d), toObject: () => clone(d) }; },
    insertMany: async (list) => {
      const out = [];
      let failed = false;
      for (const d of list) { try { out.push(insert(d)); } catch (e) { failed = true; } }
      if (failed) throw Object.assign(err11000(), { insertedDocs: out, writeErrors: [{ code: 11000 }] });
      return out;
    },
    updateOne: async (f, u) => { const d = rows.find(r => matches(r, f)); if (!d) return { matchedCount: 0, modifiedCount: 0 }; apply(d, u); return { matchedCount: 1, modifiedCount: 1 }; },
    updateMany: async (f, u) => { const ds = rows.filter(r => matches(r, f)); ds.forEach(d => apply(d, u)); return { modifiedCount: ds.length }; },
    findByIdAndUpdate: (id, u) => chain(() => { const d = rows.find(r => r._id === String(id)); if (!d) return null; apply(d, u); return clone(d); }),
    findOneAndUpdate: (f, u) => chain(() => {
      let d = rows.find(r => matches(r, f));
      if (!d) d = insert(Object.assign({}, f, { acceptSuggestions: true, enabled: false }));
      apply(d, u);
      return clone(d);
    }),
    findOneAndDelete: (f) => chain(() => { const i = rows.findIndex(r => matches(r, f)); return i < 0 ? null : rows.splice(i, 1)[0]; }),
    deleteOne: async (f) => { const i = rows.findIndex(r => matches(r, f)); if (i >= 0) rows.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; },
    deleteMany: async (f) => { let n = 0; for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], f)) { rows.splice(i, 1); n++; } return { deletedCount: n }; },
    aggregate: async () => []
  });
  return model;
}
fakeModel(QuoteLine, ['projectId', 'textKey']);
fakeModel(QuoteScore);
fakeModel(QuoteIsland, ['projectId']);
fakeModel(Character);
fakeModel(User);
// The global switches (server/quote-guess-data.js); flipped per test.
const flags = { quoteGuessEnabled: true, quoteSuggestEnabled: false };
require('../models/AdminConfig').findOne = () => chain(() => ({ flags: Object.assign({}, flags), world: { quoteRoundSec: 20 } }));
const QuoteData = require('../server/quote-guess-data');
Character._rows.push({ id: 'loki', name: 'Loki' }, { id: 'ironman', name: 'Iron Man' });

const audits = [];
const app = express();
app.use(express.json({ limit: '64kb' }));
app.use('/api/admin/quotes', (req, res, next) => { req.adminUser = { id: 'a1', username: 'kevin' }; next(); },
  require('../routes/admin-quotes')({ logAudit: (req, action, target, meta) => audits.push({ action, target, meta }) }));
app.use('/api/world', require('../routes/world-quotes'));

let server;
test.before(() => new Promise((resolve) => { server = app.listen(0, resolve); }));
test.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
test.beforeEach(() => {
  QuoteLine._rows.length = 0; QuoteScore._rows.length = 0; QuoteIsland._rows.length = 0; User._rows.length = 0; audits.length = 0;
  flags.quoteGuessEnabled = true; flags.quoteSuggestEnabled = false;
  currentUser = 'u1';
  QuoteData.invalidate('settings'); QuoteData.invalidate('islands');
});

function call(method, path, body, base) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ port: server.address().port, method, path: (base || '/api/admin/quotes') + path, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const LINE = { speaker: 'Loki', text: 'I have an army.', replySpeaker: 'Tony Stark', replyText: 'We have a Hulk.', note: 'to Tony · Stark Tower' };

test('add a line: stored approved with keys and portraits; a duplicate is 409; bad fields are 400 per field', async () => {
  const a = await call('POST', '/avengers1', LINE);
  assert.equal(a.status, 201);
  assert.equal(a.body.status, 'approved');
  assert.equal(a.body.origin, 'admin');
  assert.deepEqual(a.body.speaker, { name: 'Loki', key: 'loki', characterId: 'loki' });
  assert.equal(a.body.reply.speaker.characterId, 'ironman');
  assert.equal(QuoteLine._rows[0].textKey, 'i have an army');
  assert.equal(audits[0].action, 'contentEdit');

  const dupe = await call('POST', '/avengers1', Object.assign({}, LINE, { text: 'I have an ARMY!' }));
  assert.equal(dupe.status, 409);
  assert.ok(dupe.body.fields.text);

  const bad = await call('POST', '/avengers1', { speaker: '', text: 'x', episode: 2 });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.fields.speaker && bad.body.fields.episode);
  assert.equal((await call('POST', '/nope', LINE)).status, 404);
});

test('edit, hide and delete a line; an edit onto another line\'s text is 409; delete clears a featured pick', async () => {
  const a = (await call('POST', '/avengers1', LINE)).body;
  const b = (await call('POST', '/avengers1', { speaker: 'Thor', text: 'Another.' })).body;
  const e = await call('PATCH', '/line/' + a.id, { note: 'new note', time: '1:30:00' });
  assert.equal(e.status, 200);
  assert.equal(e.body.note, 'new note');
  assert.equal(e.body.timeSec, 5400);
  assert.equal(e.body.reply.text, 'We have a Hulk.', 'untouched fields kept');
  assert.equal((await call('PATCH', '/line/' + b.id, { text: 'I have an army' })).status, 409);
  const h = await call('PATCH', '/line/' + a.id, { active: false });
  assert.equal(h.body.active, false);
  assert.equal((await call('PATCH', '/line/' + a.id, { active: 'no' })).status, 400);
  QuoteScore._rows.push({ _id: 's1', projectId: 'avengers1', pick: a.id });
  assert.equal((await call('DELETE', '/line/' + a.id)).status, 200);
  assert.equal(QuoteLine._rows.length, 1);
  assert.equal(QuoteScore._rows[0].pick, null);
  assert.equal((await call('DELETE', '/line/nope')).status, 400);
});

test('renaming a speaker or replier drops the old portrait; a hand-picked one survives edits that keep the name', async () => {
  const a = (await call('POST', '/avengers1', LINE)).body;
  assert.equal(a.speaker.characterId, 'loki');
  assert.equal(a.reply.speaker.characterId, 'ironman');
  // The admin form sends every field, with the id only while the name is unchanged.
  const ren = await call('PATCH', '/line/' + a.id, { speaker: 'Steve Rogers', text: LINE.text, replySpeaker: 'Loki', replyText: LINE.replyText });
  assert.equal(ren.status, 200);
  assert.deepEqual(ren.body.speaker, { name: 'Steve Rogers', key: 'steve rogers', characterId: null });
  assert.equal(ren.body.reply.speaker.characterId, 'loki', 'the new replier links its own portrait');
  // A hand-picked portrait: kept by an edit that leaves the name (even re-cased) alone.
  QuoteLine._rows[0].speaker.characterId = 'ironman';
  const keep = await call('PATCH', '/line/' + a.id, { speaker: 'steve  rogers', note: 'n' });
  assert.equal(keep.body.speaker.characterId, 'ironman');
  assert.equal((await call('PATCH', '/line/' + a.id, { note: 'n2' })).body.speaker.characterId, 'ironman');
  // A body that picks an id for the new name wins.
  const pick = await call('PATCH', '/line/' + a.id, { speaker: 'Tony Stark', speakerCharacterId: 'ironman' });
  assert.equal(pick.body.speaker.characterId, 'ironman');
  // Edit & approve from the suggestions queue goes through the same merge.
  QuoteLine._rows.push({ _id: new mongoose.Types.ObjectId().toString(), projectId: 'avengers1', speaker: { name: 'Loki', key: 'loki', characterId: 'loki' }, text: 'Kneel before me.', textKey: 'kneel before me', reply: null, status: 'pending', active: true, origin: 'suggestion', suggestedByName: 'sam', timeSec: 60, createdAt: new Date(1), decoys: {} });
  const sug = QuoteLine._rows[1];
  const ap = await call('POST', `/line/${sug._id}/approve`, { edits: { speaker: 'Thor', text: 'Kneel before me.' } });
  assert.equal(ap.status, 200);
  assert.equal(ap.body.speaker.name, 'Thor');
  assert.equal(ap.body.speaker.characterId, null);
});

test('the queue lists pending suggestions oldest first with look-alikes; approve (with edits) and reject', async () => {
  await call('POST', '/avengers1', LINE);
  QuoteLine._rows.push(
    { _id: new mongoose.Types.ObjectId().toString(), projectId: 'avengers1', speaker: { name: 'Loki', key: 'loki' }, text: 'I have an army at my back.', textKey: 'i have an army at my back', reply: null, status: 'pending', active: true, origin: 'suggestion', suggestedByName: 'sam', timeSec: 5000, createdAt: new Date(1), decoys: {} },
    { _id: new mongoose.Types.ObjectId().toString(), projectId: 'wandavision', speaker: { name: 'Wanda', key: 'wanda' }, text: 'Something new.', textKey: 'something new', reply: null, status: 'pending', active: true, origin: 'suggestion', suggestedByName: 'alex', episode: 1, timeSec: 600, createdAt: new Date(2), decoys: {} }
  );
  const q = await call('GET', '/queue');
  assert.equal(q.status, 200);
  assert.equal(q.body.total, 2);
  assert.deepEqual(q.body.items.map(i => i.suggestedByName), ['sam', 'alex']);
  assert.equal(q.body.items[0].alike[0].text, 'I have an army.');
  assert.equal(q.body.items[1].projectTitle, 'WandaVision');

  const sam = q.body.items[0];
  const ok = await call('POST', `/line/${sam.id}/approve`, { edits: { note: 'checked', text: 'I have an army!!' } });
  assert.equal(ok.status, 409, 'edited onto an existing line');
  const ok2 = await call('POST', `/line/${sam.id}/approve`, { edits: { note: 'checked' } });
  assert.equal(ok2.status, 200);
  assert.equal(ok2.body.status, 'approved');
  assert.equal(ok2.body.note, 'checked');
  assert.equal(ok2.body.reviewedBy, 'kevin');
  assert.equal(ok2.body.suggestedByName, 'sam', 'credit kept');
  assert.equal((await call('POST', `/line/${sam.id}/approve`, {})).status, 400, 'already approved');

  const rej = await call('POST', `/line/${q.body.items[1].id}/reject`, { reason: 'Not in the show' });
  assert.equal(rej.body.status, 'rejected');
  assert.equal(rej.body.active, false);
  assert.equal(rej.body.rejectReason, 'Not in the show');
  assert.deepEqual(audits.filter(a => a.action === 'quoteModerate').map(a => a.meta.action), ['approve', 'reject']);
  assert.equal((await call('GET', '/queue')).body.total, 0);
});

test('import commit: new rows inserted, duplicates skipped or updated, bad rows reported; undo removes the import', async () => {
  await call('POST', '/avengers1', LINE);
  const rows = [
    { projectId: 'avengers1', speaker: 'Loki', text: 'I have an army.', note: 'updated note' },        // already there
    { projectId: 'The Avengers', speaker: 'Thor', text: 'He is adopted.' },                            // by title
    { projectId: 'wandavision', speaker: 'Vision', text: 'Grief line.', episode: 3, time: '20:00' },
    { projectId: 'wandavision', speaker: 'Vision', text: 'Bad ep.', episode: 9 },
    { projectId: 'avengers1', speaker: 'Thor', text: 'He is adopted!' }                                // dupe in batch
  ];
  const skip = await call('POST', '/import/commit', { rows, mode: 'skip', importId: 'imp-test-1', origin: 'seed' });
  assert.equal(skip.status, 200);
  assert.deepEqual({ ...skip.body, failed: skip.body.failed.length }, { inserted: 2, updated: 0, skipped: 2, failed: 1 });
  assert.ok(skip.body.failed[0].errors.episode);
  const thor = QuoteLine._rows.find(r => r.textKey === 'he is adopted');
  assert.equal(thor.origin, 'seed');
  assert.equal(thor.importId, 'imp-test-1');
  assert.equal(thor.addedBy, 'kevin');
  assert.equal(QuoteLine._rows.find(r => r.textKey === 'grief line').episode, 2);

  const upd = await call('POST', '/import/commit', { rows: rows.slice(0, 1), mode: 'update', importId: 'imp-test-2' });
  assert.equal(upd.body.updated, 1);
  assert.equal(QuoteLine._rows.find(r => r.textKey === 'i have an army').note, 'updated note');
  assert.equal(audits.filter(a => a.action === 'quoteImport').length, 2);

  assert.equal((await call('POST', '/import/commit', { rows, importId: 'BAD ID' })).status, 400);
  assert.equal((await call('POST', '/import/commit', { rows: [], importId: 'imp-x' })).status, 400);
  const many = Array.from({ length: 401 }, (_, i) => ({ projectId: 'avengers1', speaker: 'a', text: 't' + i }));
  assert.equal((await call('POST', '/import/commit', { rows: many, importId: 'imp-x' })).status, 400);

  const undo = await call('DELETE', '/import/imp-test-1');
  assert.equal(undo.body.removed, 2);
  assert.ok(!QuoteLine._rows.some(r => r.importId === 'imp-test-1'));
  assert.equal((await call('DELETE', '/import/imp-test-1')).status, 404);
});

test('island switches: enabled / acceptSuggestions validated and upserted; keys and export', async () => {
  const on = await call('PUT', '/avengers1/island', { enabled: true });
  assert.deepEqual(on.body, { enabled: true, acceptSuggestions: true });
  const off = await call('PUT', '/avengers1/island', { acceptSuggestions: false });
  assert.deepEqual(off.body, { enabled: true, acceptSuggestions: false });
  assert.equal((await call('PUT', '/avengers1/island', { enabled: 'yes' })).status, 400);
  assert.equal((await call('PUT', '/avengers1/island', {})).status, 400);

  await call('POST', '/avengers1', LINE);
  const keys = await call('GET', '/keys?projectIds=avengers1');
  assert.deepEqual(keys.body.keys, ['avengers1|i have an army']);
  const ex = await call('GET', '/export?projectId=avengers1&status=approved');
  assert.equal(ex.body.items.length, 1);
  assert.equal(ex.body.items[0].text, 'I have an army.');
  const detail = await call('GET', '/avengers1');
  assert.equal(detail.body.enabled, true);
  assert.equal(detail.body.acceptSuggestions, false);
  assert.deepEqual(detail.body.stats, { n: 1, speakers: 2, replies: 1 });
  assert.equal(detail.body.globalEnabled, true);
  assert.equal(detail.body.suggestEnabled, false);
});

// ── player suggestions (routes/world-quotes.js) ──

const suggest = (pid, body) => call('POST', '/quote/' + pid + '/suggest', body, '/api/world');
function player(id, name, watched) {
  User._rows.push({ _id: id, username: name, watchedProjects: watched.map(projectId => ({ projectId })) });
}

test('suggest: only while both switches are on and the island takes suggestions', async () => {
  player('u1', 'alex', ['avengers1']);
  const body = { speaker: 'Loki', text: 'Kneel before me.', time: '58:40', note: 'Stuttgart' };
  assert.equal((await suggest('avengers1', body)).status, 403, 'suggestions switched off');
  flags.quoteSuggestEnabled = true; QuoteData.invalidate('settings');
  QuoteIsland._rows.push({ _id: 'i1', projectId: 'avengers1', enabled: false, acceptSuggestions: false });
  QuoteData.invalidate('islands');
  assert.equal((await suggest('avengers1', body)).status, 403, 'this island is closed');
  QuoteIsland._rows[0].acceptSuggestions = true;
  QuoteData.invalidate('islands');
  const ok = await suggest('avengers1', body);
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.body, { status: 'pending' });
  const row = QuoteLine._rows[0];
  assert.equal(row.status, 'pending');
  assert.equal(row.origin, 'suggestion');
  assert.equal(row.suggestedBy, 'u1');
  assert.equal(row.suggestedByName, 'alex');
  assert.equal(row.timeSec, 3520);
  assert.equal(row.speaker.characterId, 'loki');
  flags.quoteGuessEnabled = false; QuoteData.invalidate('settings');
  assert.equal((await suggest('avengers1', Object.assign({}, body, { text: 'Another' }))).status, 403, 'the game itself is off');
});

test('suggest: watched it first, a rough time (and episode) required, no duplicates, no links', async () => {
  flags.quoteSuggestEnabled = true;
  player('u1', 'alex', ['avengers1', 'wandavision']);
  player('u2', 'sam', []);
  currentUser = 'u2';
  assert.equal((await suggest('avengers1', { speaker: 'Loki', text: 'Kneel.', time: '1:00' })).status, 403, 'not watched');
  currentUser = 'u1';
  assert.equal((await suggest('nope', { speaker: 'Loki', text: 'Kneel.', time: '1:00' })).status, 404);
  const noTime = await suggest('avengers1', { speaker: 'Loki', text: 'Kneel.' });
  assert.equal(noTime.status, 400);
  assert.ok(noTime.body.fields.time);
  const noEp = await suggest('wandavision', { speaker: 'Vision', text: 'Grief.', time: '10:00' });
  assert.ok(noEp.body.fields.episode);
  assert.ok((await suggest('avengers1', { speaker: 'Loki', text: 'go to www.x.com', time: '1:00' })).body.fields.text);
  assert.equal((await suggest('wandavision', { speaker: 'Vision', text: 'Grief.', episode: 2, time: '10:00' })).status, 201);
  const again = await suggest('wandavision', { speaker: 'Vision', text: 'grief!', episode: 2, time: '10:00' });
  assert.equal(again.status, 409);
  assert.ok(again.body.fields.text);
});

test('suggest: per-player limits (an hour, waiting for review)', async () => {
  flags.quoteSuggestEnabled = true;
  player('u1', 'alex', ['avengers1']);
  const { LIMITS } = require('../routes/world-quotes');
  for (let i = 0; i < LIMITS.hour; i++) {
    assert.equal((await suggest('avengers1', { speaker: 'Loki', text: 'Line ' + i, time: '1:00' })).status, 201);
  }
  const over = await suggest('avengers1', { speaker: 'Loki', text: 'One more', time: '1:00' });
  assert.equal(over.status, 429);
  // Older than a day but still pending: the pending cap still applies.
  QuoteLine._rows.forEach(r => { r.createdAt = new Date(Date.now() - 2 * 86400e3); });
  for (let i = 0; i < LIMITS.pending - LIMITS.hour; i++) {
    QuoteLine._rows.push({ _id: 'p' + i, projectId: 'avengers1', textKey: 'pending ' + i, status: 'pending', suggestedBy: 'u1', createdAt: new Date(0) });
  }
  const capped = await suggest('avengers1', { speaker: 'Loki', text: 'Yet another', time: '1:00' });
  assert.equal(capped.status, 429);
  assert.match(capped.body.error, /waiting for review/);
});

test('suggest: one in flight per player, so parallel requests cannot skip the limits (RT2-02)', async () => {
  flags.quoteSuggestEnabled = true;
  player('u1', 'alex', ['avengers1']);
  player('u2', 'sam', ['avengers1']);
  // Hold the first insert open until the second request has been answered.
  const create = QuoteLine.create;
  let release, entered;
  const gate = new Promise(r => { release = r; });
  const inCreate = new Promise(r => { entered = r; });
  QuoteLine.create = async (data) => { entered(); await gate; return create(data); };
  try {
    const first = suggest('avengers1', { speaker: 'Loki', text: 'First line', time: '1:00' });
    await inCreate;
    const second = await suggest('avengers1', { speaker: 'Loki', text: 'Second line', time: '1:00' });
    assert.equal(second.status, 429, 'refused while the first is still being saved');
    assert.match(second.body.error, /still being saved/);
    QuoteLine.create = create;
    // Another player is not blocked by u1's request.
    currentUser = 'u2';
    assert.equal((await suggest('avengers1', { speaker: 'Loki', text: 'Sam line', time: '1:00' })).status, 201);
    currentUser = 'u1';
    release();
    assert.equal((await first).status, 201);
  } finally {
    QuoteLine.create = create;
    release();
  }
  assert.deepEqual(QuoteLine._rows.map(r => r.textKey).sort(), ['first line', 'sam line']);
  // The slot is freed after a success and after a refusal (409, 400).
  assert.equal((await suggest('avengers1', { speaker: 'Loki', text: 'first line!', time: '1:00' })).status, 409);
  assert.equal((await suggest('avengers1', { speaker: 'Loki', text: 'No time' })).status, 400);
  assert.equal((await suggest('avengers1', { speaker: 'Loki', text: 'Third line', time: '1:00' })).status, 201);
});
