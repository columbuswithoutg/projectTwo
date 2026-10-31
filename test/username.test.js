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

// ---- reserved usernames (SRV3-01, js/messaging-logic.js usernameError) ----
const L = require('../js/messaging-logic');
const RESERVED = 'That username is reserved';

test('usernameError rejects reserved names and trivial variants', () => {
  for (const n of ['admin', 'Admin', 'ADMIN', 'Administrator', 'admin_', '_admin', 'Admin-1', 'a-d-m-i-n',
    'admin2', 'AdminTeam', 'Moderator', 'moderator_99', 'mod', 'MOD', 'm_o_d', 'mods', 'System', 'system_bot',
    'Staff', 'staff-1', 'Support', 'supportdesk', 'Official', 'official_mcu', 'mcutracker', 'MCU-Tracker', 'mcu_tracker_hq']) {
    assert.equal(L.usernameError(n), RESERVED, n);
    assert.equal(L.isReservedUsername(n), true, n);
  }
  // Whitespace is trimmed before the check, like the rest of the rule.
  assert.equal(L.usernameError('  admin  '), RESERVED);
});

test('usernameError still allows ordinary names near the reserved list', () => {
  // "mod" is exact-only, so words that merely start with it are fine;
  // "admiral" starts with "adm", not "admin"; reserved words in the middle
  // of a name ("theadmin", "tony_staff") are not caught (prefix-only, by design).
  for (const n of ['modern', 'Modest', 'model_t', 'admiral', 'Adam', 'theadmin', 'tony_staff', 'ironman1',
    'good_name-1', 'sys', 'supper', 'officer', 'mcu_fan']) {
    assert.equal(L.usernameError(n), null, n);
  }
});

test('reserved check is prefix-based: "Systemic" / "Supporter" are rejected (documented choice)', () => {
  assert.equal(L.usernameError('Systemic'), RESERVED);
  assert.equal(L.usernameError('Supporter'), RESERVED);
  assert.equal(L.usernameError('Staffordshire'), RESERVED);
});

test('format errors still win over the reserved check', () => {
  assert.equal(L.usernameError('ad'), 'Username must be 3–30 characters');
  assert.equal(L.usernameError('admin!'), 'Username can only contain letters, numbers, _ or -');
  assert.equal(L.usernameError(42), 'Username must be a string');
});

test('rename request to a reserved name gets its own error code and copy', () => {
  const v = L.validateRequest({ type: 'rename', newUsername: 'Admin_' });
  assert.deepEqual([v.ok, v.error, v.field], [false, 'reserved-username', 'newUsername']);
  assert.match(L.errorText('reserved-username'), /reserved/);
  assert.equal(L.validateRequest({ type: 'rename', newUsername: 'bad name' }).error, 'bad-username');
  assert.equal(L.validateRequest({ type: 'rename', newUsername: 'modern_tony' }).ok, true);
});
