/************************************************
 * server/username.js — lookup query order, search filter, self-healing.
 * No Mongo: User.findOne / exists / updateOne are stubbed on the model.
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const User = require('../models/user');
const U = require('../server/username');

test('lowerName trims and lowercases; escapeRegex neutralises metacharacters', () => {
  assert.equal(U.lowerName('  Tony '), 'tony');
  assert.equal(U.lowerName(null), '');
  assert.equal(U.escapeRegex('a.b*c'), 'a\\.b\\*c');
  assert.equal(new RegExp('^' + U.escapeRegex('a.b') + '$').test('axb'), false);
});

test('lookupQueries: usernameLower → exact → regex only while not ready', () => {
  const q = U.lookupQueries(' Tony ', false);
  assert.deepEqual(q[0], { usernameLower: 'tony' });
  assert.deepEqual(q[1], { username: 'Tony' });
  assert.deepEqual(q[2], { username: { $regex: '^Tony$', $options: 'i' } });
  assert.equal(U.lookupQueries('Tony', true).length, 2);
  assert.deepEqual(U.lookupQueries('', false), []);
  assert.deepEqual(U.lookupQueries('x'.repeat(41), false), []);
  assert.equal(U.lookupQueries('a.b', false)[2].username.$regex, '^a\\.b$');
});

test('searchFilter: min 2 chars, anchored, index field once ready', () => {
  assert.equal(U.searchFilter('a', true), null);
  assert.equal(U.searchFilter('  ', true), null);
  assert.deepEqual(U.searchFilter('To', true, 'me'), { usernameLower: { $regex: '^to' }, _id: { $ne: 'me' } });
  assert.deepEqual(U.searchFilter('To', false), { username: { $regex: '^To', $options: 'i' } });
  assert.equal(U.searchFilter('a.*', true).usernameLower.$regex, '^a\\.\\*');
});

// ---- findByUsername against a stubbed model ----------------------------
function stubFind(docsByQuery) {
  const calls = [];
  User.findOne = (q) => {
    calls.push(q);
    const key = Object.keys(q)[0];
    const doc = docsByQuery[key] || null;
    const chain = { select: () => chain, lean: async () => doc };
    return chain;
  };
  return calls;
}

test('findByUsername: stops at the first hit; heals a legacy doc found by fallback', async () => {
  U.setReady(false);
  const updates = [];
  User.updateOne = (filter, update) => { updates.push({ filter, update }); return { catch() {} }; };

  // Found via usernameLower: no heal.
  let calls = stubFind({ usernameLower: { _id: '1', username: 'Tony', usernameLower: 'tony' } });
  let doc = await U.findByUsername('tony', '_id username');
  assert.equal(doc._id, '1');
  assert.equal(calls.length, 1);
  assert.equal(updates.length, 0);

  // Found via the exact query: healed.
  calls = stubFind({ username: { _id: '2', username: 'Bob' } });
  doc = await U.findByUsername('Bob');
  assert.equal(doc._id, '2');
  assert.equal(calls.length, 2);
  assert.deepEqual(updates[0].filter, { _id: '2', usernameLower: { $exists: false } });
  assert.deepEqual(updates[0].update, { $set: { usernameLower: 'bob' } });

  // Nothing matches: every query tried, null.
  calls = stubFind({});
  assert.equal(await U.findByUsername('nobody'), null);
  assert.equal(calls.length, 3);

  // Ready: the regex is never tried.
  U.setReady(true);
  calls = stubFind({});
  assert.equal(await U.findByUsername('nobody'), null);
  assert.equal(calls.length, 2);
  U.setReady(false);
});

test('refreshReady flips to true only when no user is missing the field', async () => {
  U.setReady(false);
  User.exists = async () => ({ _id: 'x' });
  await U.refreshReady();
  assert.equal(U.isReady(), false);
  User.exists = async () => null;
  await U.refreshReady();
  assert.equal(U.isReady(), true);
  U.setReady(false);
});
