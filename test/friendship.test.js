/************************************************
 * Unit tests for server/friendship.js — the one place the
 * "accepted friend, legacy type-less docs included" filter is built.
 *
 * No Mongo: getFriendIds is exercised by stubbing Friend.find on the
 * model (mongoose.model() registers without connecting).
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const Friend = require('../models/Friend');
const F = require('../server/friendship');

const TYPE = { $or: [{ type: 'friend' }, { type: { $exists: false } }, { type: null }] };

test('friendFilter(me): either side, accepted, legacy type clause', () => {
  assert.deepEqual(F.friendFilter('u1'), {
    $and: [
      { $or: [{ requester: 'u1' }, { recipient: 'u1' }] },
      { status: 'accepted' },
      TYPE
    ]
  });
});

test('friendFilter(me, other): pair form in both directions', () => {
  assert.deepEqual(F.friendFilter('u1', 'u2'), {
    $and: [
      { $or: [
        { requester: 'u1', recipient: 'u2' },
        { requester: 'u2', recipient: 'u1' }
      ] },
      { status: 'accepted' },
      TYPE
    ]
  });
});

test('friendFilter accepted:false drops the status clause (request-exists / remove)', () => {
  const f = F.friendFilter('u1', 'u2', { accepted: false });
  assert.equal(f.$and.length, 2);
  assert.ok(!f.$and.some(c => c.status));
  assert.deepEqual(f.$and[1], TYPE);
});

test('friendFilter requires a user id', () => {
  assert.throws(() => F.friendFilter(), TypeError);
  assert.throws(() => F.friendFilter(null, 'u2'), TypeError);
});

test('FRIEND_TYPE is frozen so no caller can mutate the shared clause', () => {
  assert.ok(Object.isFrozen(F.FRIEND_TYPE));
  assert.deepEqual(F.FRIEND_TYPE, TYPE);
});

test('getFriendIds: self plus both sides of every accepted friendship, as strings', async () => {
  const orig = Friend.find;
  let seenFilter = null;
  Friend.find = (filter) => {
    seenFilter = filter;
    return {
      select: (fields) => {
        assert.equal(fields, 'requester recipient');
        return { lean: async () => [
          { requester: { toString: () => 'me' }, recipient: { toString: () => 'a' } },
          { requester: { toString: () => 'b' }, recipient: { toString: () => 'me' } }
        ] };
      }
    };
  };
  try {
    const ids = await F.getFriendIds('me');
    assert.deepEqual([...ids].sort(), ['a', 'b', 'me']);
    assert.deepEqual(seenFilter, F.friendFilter('me'));
  } finally {
    Friend.find = orig;
  }
});

test('getFriendIds: no friends still returns self', async () => {
  const orig = Friend.find;
  Friend.find = () => ({ select: () => ({ lean: async () => [] }) });
  try {
    assert.deepEqual([...await F.getFriendIds('solo')], ['solo']);
  } finally {
    Friend.find = orig;
  }
});
