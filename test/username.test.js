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

// Like stubFind, but honours select() the way Mongo does: only the projected
// fields (plus _id) come back. This is what made exists() heal with ''.
function stubFindProjected(docsByQuery) {
  const selects = [];
  User.findOne = (q) => {
    const full = docsByQuery[Object.keys(q)[0]] || null;
    let fields = null;
    const chain = {
      select: (s) => { fields = s.split(/\s+/).filter(Boolean); selects.push(s); return chain; },
      lean: async () => {
        if (!full || !fields) return full;
        const out = { _id: full._id };
        for (const f of fields) if (f in full) out[f] = full[f];
        return out;
      }
    };
    return chain;
  };
  return selects;
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
  assert.deepEqual(updates[0].filter, { _id: '2', usernameLower: { $in: [null, ''] } });
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

test('exists() on a legacy account heals with the real lowercase name, never "" (SRV-01)', async () => {
  U.setReady(false);
  const updates = [];
  User.updateOne = (filter, update) => { updates.push({ filter, update }); return { catch() {} }; };

  // Legacy "Bob" (no usernameLower) found by the regex fallback on register("bob").
  const selects = stubFindProjected({ username: { _id: '7', username: 'Bob', password: 'h' } });
  assert.equal(await U.exists('bob'), true);
  assert.ok(selects[0].split(/\s+/).includes('username'), 'username must be projected');
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].update, { $set: { usernameLower: 'bob' } });

  // Same through findByUsername with a narrow select.
  updates.length = 0;
  stubFindProjected({ username: { _id: '8', username: 'Tony' } });
  await U.findByUsername('Tony', '_id');
  assert.deepEqual(updates[0].update, { $set: { usernameLower: 'tony' } });

  // A doc already stuck on '' (older build) is healed too, not treated as done.
  updates.length = 0;
  stubFindProjected({ username: { _id: '9', username: 'Ann', usernameLower: '' } });
  await U.findByUsername('Ann', '_id');
  assert.deepEqual(updates[0].update, { $set: { usernameLower: 'ann' } });
});

test('heal() never writes when the doc has no usable username', () => {
  const updates = [];
  User.updateOne = (filter, update) => { updates.push({ filter, update }); return { catch() {} }; };
  const warn = console.warn; console.warn = () => {};
  try {
    U.heal({ _id: '1' });
    U.heal({ _id: '2', username: '   ' });
    U.heal({ _id: '3', username: 42 });
  } finally { console.warn = warn; }
  assert.equal(updates.length, 0);
});

test('refreshReady counts an empty usernameLower as NOT backfilled', async () => {
  U.setReady(false);
  let filter;
  User.exists = async (f) => { filter = f; return null; };
  await U.refreshReady();
  assert.deepEqual(filter.usernameLower, { $in: [null, ''] });
  assert.deepEqual(filter.usernameLowerConflict, { $ne: true });
  U.setReady(false);
});
