/************************************************
 * routes/world-socket.js pieces the admin + stay paths rely on:
 *   unappliedOps()           which stay credits a failed bulkWrite did NOT
 *                            write (RT-08 — only those are re-queued)
 *   invalidateProjectGrid()  exported for the admin project routes (RT-06)
 *   world:chat               a rejected send spends no chat floor (RT-10)
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { MongoBulkWriteError } = require('mongodb');
const WS = require('../routes/world-socket.js');

const op = (u, p, ms) => ({ updateOne: { filter: { userId: u, projectId: p }, update: { $inc: { ms } }, upsert: true } });
const OPS = [op('u1', 'a', 1000), op('u2', 'a', 2000), op('u3', 'b', 3000)];

test('unappliedOps: a partial MongoBulkWriteError → only the ops in writeErrors', () => {
  const err = new MongoBulkWriteError(
    { message: 'E11000', code: 11000, writeErrors: [{ index: 1, code: 11000, errmsg: 'dup' }] },
    { insertedCount: 0, matchedCount: 1, modifiedCount: 1, upsertedCount: 1 }
  );
  assert.ok(err.result);
  assert.deepEqual(WS.unappliedOps(OPS, err), [OPS[1]]);
});

test('unappliedOps: driver WriteError objects (index getter over .err) work too', () => {
  const err = { result: {}, writeErrors: [{ err: { index: 0 } }, { err: { index: 2 } }] };
  assert.deepEqual(WS.unappliedOps(OPS, err), [OPS[0], OPS[2]]);
});

test('unappliedOps: no result (network error / timeout) → every op', () => {
  assert.deepEqual(WS.unappliedOps(OPS, new Error('connection reset')), OPS);
  assert.deepEqual(WS.unappliedOps(OPS, null), OPS);
});

test('unappliedOps: a result with no write errors (write concern) → none', () => {
  assert.deepEqual(WS.unappliedOps(OPS, { result: {}, writeErrors: [] }), []);
});

test('unappliedOps: Mongoose-mapped results use OUR indexes; cast errors are not retried', () => {
  // Mongoose dropped op 0 (cast error) before sending, so the driver's index 0
  // was our op 1 — err.mongoose.results is already mapped back.
  const err = { result: {}, writeErrors: [{ index: 0 }], mongoose: { results: [new Error('Cast to ObjectId failed'), { err: { index: 0 } }, null] } };
  assert.deepEqual(WS.unappliedOps(OPS, err), [OPS[1]]);
});

test('invalidateProjectGrid is exported for routes/admin.js', () => {
  assert.equal(typeof WS.invalidateProjectGrid, 'function');
  assert.doesNotThrow(() => WS.invalidateProjectGrid());
});

test('world:chat marks the floor only after the no-project check; whispers only when sent', () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/world-socket.js'), 'utf8');
  const handler = src.slice(src.indexOf("socket.on('world:chat'"), src.indexOf("socket.on('world:emote'"));
  assert.ok(handler.length > 0);
  // The only anyChat mark is inside accept(), and the project branch calls it after its refusal.
  assert.equal((handler.match(/markFloor\(socket, 'anyChat'/g) || []).length, 1);
  assert.match(handler, /const accept = \(\) => \{ touchStay\(p, now\); markFloor\(socket, 'anyChat', now\); \};/);
  assert.ok(handler.indexOf("error: 'no-project'") < handler.indexOf('accept();', handler.indexOf("m.channel === 'project'")));
  assert.match(handler, /handleWhisper\(io, socket, p, m, out, reply, accept\)/);
  const whisper = src.slice(src.indexOf('async function handleWhisper'), src.indexOf('// /home chat keeps'));
  // onSent runs right before each successful delivery, after every refusal.
  const sends = [...whisper.matchAll(/onSent\(\);/g)].map(m => m.index);
  assert.equal(sends.length, 2);
  assert.ok(whisper.indexOf("error: 'not-found'") < sends[1]);
});
