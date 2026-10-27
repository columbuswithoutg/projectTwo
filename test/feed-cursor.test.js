/************************************************
 * Unit tests for the /api/feed page cursor (routes/feed.js):
 * "<activityAt ms>_<post _id>", with the old plain-date cursor still
 * accepted. Pure helpers — no Mongo.
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { encodeFeedCursor, decodeFeedCursor, feedCursorFilter } = require('../routes/feed');

const ID = '65a1b2c3d4e5f60718293a4b';
const T = Date.UTC(2026, 9, 27, 12, 0, 0);

test('encode → decode round-trips the timestamp and id', () => {
  const c = encodeFeedCursor({ _id: new mongoose.Types.ObjectId(ID), activityAt: new Date(T) });
  assert.equal(c, `${T}_${ID}`);
  const d = decodeFeedCursor(c);
  assert.equal(d.t.getTime(), T);
  assert.equal(d.id, ID);
});

test('encode: no usable activityAt → null (no next page link, as before)', () => {
  assert.equal(encodeFeedCursor({ _id: ID }), null);
  assert.equal(encodeFeedCursor({ _id: ID, activityAt: 'nope' }), null);
  assert.equal(encodeFeedCursor(null), null);
});

test('decode: older plain-date cursors still work, timestamp only', () => {
  const iso = decodeFeedCursor(new Date(T).toISOString());
  assert.equal(iso.t.getTime(), T);
  assert.equal(iso.id, null);
  assert.equal(decodeFeedCursor(String(T)).t.getTime(), T);
});

test('decode: junk and empty → null', () => {
  for (const bad of [undefined, null, '', 'garbage', `${T}_nothex`, { $gt: 1 }, ['x']]) {
    assert.equal(decodeFeedCursor(bad), null, JSON.stringify(bad));
  }
});

test('filter: ties on activityAt are broken by _id, so nothing at a boundary is skipped', () => {
  const f = feedCursorFilter(decodeFeedCursor(`${T}_${ID}`));
  assert.equal(f.$or.length, 2);
  assert.equal(f.$or[0].activityAt.$lt.getTime(), T);
  assert.equal(f.$or[1].activityAt.getTime(), T);
  assert.equal(String(f.$or[1]._id.$lt), ID);
});

test('filter: an old cursor keeps the old timestamp-only meaning; no cursor → no filter', () => {
  const f = feedCursorFilter(decodeFeedCursor(new Date(T).toISOString()));
  assert.equal(f.activityAt.$lt.getTime(), T);
  assert.equal(f.$or, undefined);
  assert.equal(feedCursorFilter(null), null);
});
