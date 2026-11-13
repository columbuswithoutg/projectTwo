/************************************************
 * PUT /api/feed/:postId — editing a post must never drop photos the author
 * did not remove. A post can hold more than the 20-photo cap (memories added
 * from the project popup land on the same session post); the edit used to cut
 * the list at 20, read the rest as "removed" and pull them from the project's
 * Memories too.
 *
 * The real router on a throwaway express app, a stand-in auth middleware and
 * FeedPost / User stubbed (no Mongo).
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const ME = '65a000000000000000000001';
const POST = '65b000000000000000000001';
const authPath = require.resolve('../middleware/auth');
require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: (req, res, next) => { req.user = { id: ME }; next(); } };
const memPath = require.resolve('../server/memory');
require.cache[memPath] = { id: memPath, filename: memPath, loaded: true, exports: {
  MAX_MEMORY_CAPTION_LEN: 280,
  sanitizeMemory: (m) => (m && /^https:\/\/ours\//.test(m.url) ? { url: m.url, type: 'image', caption: '' } : null)
} };

const FeedPost = require('../models/FeedPost');
const User = require('../models/user');

let post, userWrites;
const mem = (i) => ({ url: 'https://ours/' + i, type: 'image', caption: '', toObject() { return { url: this.url, type: this.type, caption: this.caption }; } });
function reset(count) {
  userWrites = [];
  post = {
    _id: POST, author: ME, projectId: 'ironman1', kind: 'watch', caption: 'old', watchedWith: [], participants: [ME],
    memories: Array.from({ length: count }, (_, i) => mem(i)),
    async save() {}
  };
}
FeedPost.findOne = async () => post;
FeedPost.findById = () => {
  const q = { populate: () => q, lean: async () => ({ _id: POST, author: { _id: ME, username: 'me' }, projectId: post.projectId, kind: post.kind,
    caption: post.caption, memories: post.memories.map(m => ({ url: m.url, type: m.type, caption: m.caption })), watchedWith: [], participants: [ME],
    comments: [], reactions: [], createdAt: new Date(), updatedAt: new Date() }) };
  return q;
};
User.updateOne = (filter, update) => { userWrites.push(update); return Promise.resolve({}); };

let server, base;
test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/feed', require('../routes/feed'));
  server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => server.close());

const put = async (body) => {
  const res = await fetch(`${base}/api/feed/${POST}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const sent = () => post.memories.map(m => ({ url: m.url, type: m.type, caption: m.caption }));

test('a caption-only edit of a post with 25 photos keeps all 25 and touches no Memories', async () => {
  reset(25);
  const r = await put({ caption: 'new', memories: sent() });
  assert.equal(r.status, 200);
  assert.equal(post.memories.length, 25);
  assert.equal(post.caption, 'new');
  assert.deepEqual(userWrites, [], 'nothing pulled from the project entry');
});

test('removing one photo removes exactly that one', async () => {
  reset(25);
  const r = await put({ memories: sent().filter(m => m.url !== 'https://ours/24') });
  assert.equal(r.status, 200);
  assert.equal(post.memories.length, 24);
  assert.deepEqual(userWrites.map(u => u.$pull['watchedProjects.$.memories'].url.$in), [['https://ours/24']]);
});

test('the cap still limits new photos: none past 20, and nothing is lost on the refusal', async () => {
  reset(19);
  let r = await put({ memories: [...sent(), { url: 'https://ours/new1' }] });
  assert.equal(r.status, 200);
  assert.equal(post.memories.length, 20);
  reset(20);
  r = await put({ memories: [...sent(), { url: 'https://ours/new2' }] });
  assert.equal(r.status, 400);
  assert.equal(post.memories.length, 20);
  assert.deepEqual(userWrites, []);
  reset(2);
  r = await put({ memories: Array.from({ length: 30 }, (_, i) => ({ url: 'https://ours/x' + i })) });
  assert.equal(r.status, 400);
});
