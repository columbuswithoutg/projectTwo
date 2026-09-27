const test = require('node:test');
const assert = require('node:assert');

test('tag ids: valid, distinct, not yourself, capped', () => {
  const { cleanFriendIds, MAX_TAGS } = require('../server/watchTags');
  const me = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const a = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  assert.deepStrictEqual(cleanFriendIds([a, a, me, 'nope', 42, { $ne: 1 }], me), [a]);
  assert.deepStrictEqual(cleanFriendIds('x', me), []);
  const many = Array.from({ length: 20 }, (_, i) => i.toString(16).padStart(24, 'c'));
  assert.strictEqual(cleanFriendIds(many, me).length, MAX_TAGS);
});

test('memory URLs must be this app\'s Cloudinary uploads', () => {
  process.env.CLOUDINARY_CLOUD_NAME = 'testcloud';
  const { sanitizeMemory } = require('../server/memory');
  const ok = sanitizeMemory({ url: 'https://res.cloudinary.com/testcloud/image/upload/v1/a.jpg', type: 'video', caption: 'hi' });
  assert.deepStrictEqual(ok, { url: 'https://res.cloudinary.com/testcloud/image/upload/v1/a.jpg', type: 'video', caption: 'hi' });
  assert.strictEqual(sanitizeMemory({ url: 'https://res.cloudinary.com/other/image/upload/a.jpg' }), null);
  assert.strictEqual(sanitizeMemory({ url: 'javascript:alert(1)' }), null);
  assert.strictEqual(sanitizeMemory({ url: 'https://res.cloudinary.com/testcloud/a".jpg' }), null);
  assert.strictEqual(sanitizeMemory('x'), null);
});
