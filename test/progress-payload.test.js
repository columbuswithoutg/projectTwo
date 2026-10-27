const test = require('node:test');
const assert = require('node:assert');
const { readPostPayload } = require('../routes/progress');

test('"Don\'t post" (skipPost) means no post, whatever else is in the body', () => {
  assert.deepStrictEqual(readPostPayload({ skipPost: true }), { post: null });
  assert.deepStrictEqual(
    readPostPayload({ skipPost: true, caption: 'x'.repeat(9999), memories: 'junk', tagFriendIds: ['a'] }),
    { post: null }
  );
});

test('only a literal true skips the post', () => {
  assert.ok(readPostPayload({ skipPost: 'true' }).post);
  assert.ok(readPostPayload({ skipPost: 1 }).post);
});

test('an empty composer still posts as-is', () => {
  assert.deepStrictEqual(readPostPayload({}, 'u1'), { post: { caption: '', memories: [], tagIds: [] } });
  assert.deepStrictEqual(readPostPayload(undefined, 'u1').post.caption, '');
});

test('composer validation still applies when posting', () => {
  assert.ok(readPostPayload({ caption: 5 }).error);
  assert.ok(readPostPayload({ caption: 'x'.repeat(501) }).error);
  assert.ok(readPostPayload({ memories: [{ url: 'https://evil.example/x.jpg', type: 'image' }] }).error);
});
