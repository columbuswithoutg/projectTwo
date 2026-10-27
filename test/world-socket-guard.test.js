/************************************************
 * routes/world-socket.js guard(): every socket.on handler is registered
 * through it, so a sync throw or a rejected promise is logged as
 * `[ws] <name> failed` and never escapes (RT-03 follow-up). Also checks the
 * connection handler wraps every registration.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { guard } = require('../routes/world-socket.js');

function captureErrors(fn) {
  const orig = console.error;
  const seen = [];
  console.error = (...a) => seen.push(a);
  try { return { ret: fn(), seen }; } finally { console.error = orig; }
}

test('guard: passes every argument (incl. the ack) through and returns nothing', () => {
  let got = null;
  const ack = () => {};
  const h = guard('world.chat', (raw, cb) => { got = [raw, cb]; return 42; });
  assert.equal(h({ text: 'hi' }, ack), undefined);
  assert.deepEqual(got, [{ text: 'hi' }, ack]);
});

test('guard: a sync throw is logged with the handler name, not thrown', () => {
  const { seen } = captureErrors(() => guard('world.pos', () => { throw new Error('boom'); })({}));
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], '[ws] world.pos failed:');
  assert.equal(seen[0][1].message, 'boom');
});

test('guard: a rejected promise is caught and logged', async () => {
  const orig = console.error;
  const seen = [];
  console.error = (...a) => seen.push(a);
  try {
    guard('home.join', async () => { throw new Error('db down'); })({});
    await new Promise(r => setImmediate(r));
  } finally { console.error = orig; }
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], '[ws] home.join failed:');
  assert.equal(seen[0][1].message, 'db down');
});

test('every socket.on in routes/world-socket.js goes through guard()', () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/world-socket.js'), 'utf8');
  const all = src.match(/socket\.on\('[^']+',/g) || [];
  const guarded = src.match(/socket\.on\('[^']+', guard\('/g) || [];
  assert.ok(all.length >= 17, 'found ' + all.length + ' registrations');
  assert.equal(guarded.length, all.length);
});
