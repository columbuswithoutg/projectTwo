/************************************************
 * server/feed.js — the duplicate-post merge behind watch parties and tags.
 *
 * mergeInto() / unionIds() are pure. recordCoWatch() and tagPost() run
 * against the real FeedPost model with its statics and prototype.save
 * stubbed (no Mongo): every find / findOne / save / deleteMany is recorded,
 * so the tests can assert the dupes are only deleted after the merged post
 * was saved.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const FeedPost = require('../models/FeedPost');
const User = require('../models/user');
const feed = require('../server/feed');

const oid = () => new mongoose.Types.ObjectId();
const at = (s) => new Date(Date.UTC(2026, 9, 1, 12, 0, s));

// ---- stub harness -------------------------------------------------------
const real = {
  findOne: FeedPost.findOne, find: FeedPost.find, findById: FeedPost.findById,
  deleteMany: FeedPost.deleteMany, save: FeedPost.prototype.save, userFindOne: User.findOne
};
function restore() {
  FeedPost.findOne = real.findOne; FeedPost.find = real.find; FeedPost.findById = real.findById;
  FeedPost.deleteMany = real.deleteMany; FeedPost.prototype.save = real.save; User.findOne = real.userFindOne;
}

// { session: doc|null, dupes: [doc], byId: doc|null, watched: {count}|null, saveFails }
function stub({ session = null, dupes = [], byId = null, watched = null, saveFails = false } = {}) {
  const log = [];
  FeedPost.findOne = (q) => {
    log.push(['findOne', q]);
    return { sort: async () => session };
  };
  FeedPost.find = async (q) => { log.push(['find', q]); return dupes; };
  FeedPost.findById = async (id) => { log.push(['findById', id]); return byId; };
  FeedPost.deleteMany = async (q) => { log.push(['deleteMany', q]); return { deletedCount: q._id.$in.length }; };
  FeedPost.prototype.save = async function () {
    log.push(['save', this.toObject()]);
    if (saveFails) throw new Error('write conflict');
    return this;
  };
  User.findOne = (q, proj) => {
    log.push(['User.findOne', q, proj]);
    return { lean: async () => (watched ? { watchedProjects: [watched] } : null) };
  };
  return log;
}
const ops = (log) => log.map(e => e[0]);
const saved = (log) => log.find(e => e[0] === 'save')[1];

// A stored post (isNew false), as findOne / find would return it.
function stored(fields) {
  return FeedPost.hydrate({
    _id: oid(), kind: 'watch', count: 1, episode: null, watchedWith: [], memories: [],
    comments: [], reactions: [], caption: '', createdAt: at(0), activityAt: at(0), ...fields
  });
}
const comment = (author, text, s) => ({ _id: oid(), author, text, createdAt: at(s), updatedAt: at(s) });

// ---- pure merge ----------------------------------------------------------
test('mergeInto: comments from every dupe end up ordered by createdAt (missing dates first)', () => {
  const a = oid(), b = oid();
  const t = { comments: [{ _id: 1, author: a, createdAt: at(10) }, { _id: 2, author: a, createdAt: at(30) }], reactions: [], memories: [] };
  const d1 = { _id: 'd1', comments: [{ _id: 3, author: b, createdAt: at(20) }], reactions: [], memories: [] };
  const d2 = { _id: 'd2', comments: [{ _id: 4, author: b, createdAt: at(5) }, { _id: 5, author: b }], reactions: [], memories: [] };
  const m = feed.mergeInto(t, [d1, d2]);
  assert.deepEqual(m.comments.map(c => c._id), [5, 4, 1, 3, 2]);
  // Pure: inputs untouched.
  assert.deepEqual(t.comments.map(c => c._id), [1, 2]);
});

test('mergeInto: comments are NOT de-duplicated by _id (current behaviour) and ties keep target-first order', () => {
  const t = { comments: [{ _id: 'x', createdAt: at(1) }], reactions: [], memories: [] };
  const d = { _id: 'd', comments: [{ _id: 'x', createdAt: at(1) }, { _id: 'y', createdAt: at(1) }], reactions: [], memories: [] };
  const m = feed.mergeInto(t, [d]);
  assert.deepEqual(m.comments.map(c => c._id), ['x', 'x', 'y']);
  assert.equal(m.comments[0], t.comments[0]);
});

test('mergeInto: one reaction per user — target wins, then the first dupe that had one', () => {
  const u1 = oid(), u2 = oid(), u3 = oid();
  const t = { comments: [], reactions: [{ user: u1, type: 'love' }], memories: [] };
  const d1 = { _id: 'd1', comments: [], memories: [], reactions: [{ user: new mongoose.Types.ObjectId(String(u1)), type: 'haha' }, { user: u2, type: 'wow' }] };
  const d2 = { _id: 'd2', comments: [], memories: [], reactions: [{ user: String(u2), type: 'sad' }, { user: u3, type: 'like' }] };
  const m = feed.mergeInto(t, [d1, d2]);
  assert.deepEqual(m.reactions.map(r => [String(r.user), r.type]),
    [[String(u1), 'love'], [String(u2), 'wow'], [String(u3), 'like']]);
});

test('mergeInto: memories de-duplicated by url, first one kept', () => {
  const t = { comments: [], reactions: [], memories: [{ url: 'a.jpg', caption: 'mine' }] };
  const d1 = { _id: 'd1', comments: [], reactions: [], memories: [{ url: 'a.jpg', caption: 'theirs' }, { url: 'b.jpg' }] };
  const d2 = { _id: 'd2', comments: [], reactions: [], memories: [{ url: 'b.jpg', caption: 'again' }, { url: 'c.mp4' }] };
  const m = feed.mergeInto(t, [d1, d2]);
  assert.deepEqual(m.memories.map(x => x.url), ['a.jpg', 'b.jpg', 'c.mp4']);
  assert.equal(m.memories[0].caption, 'mine');
  assert.equal(m.memories[1].caption, undefined);
});

test('mergeInto: removedIds are exactly the dupes, in order; no dupes → target unchanged', () => {
  const t = { comments: [{ _id: 1, createdAt: at(9) }, { _id: 2, createdAt: at(1) }], reactions: [], memories: [] };
  const m = feed.mergeInto(t, [{ _id: 'd1' }, { _id: 'd2' }]);
  assert.deepEqual(m.removedIds, ['d1', 'd2']);
  const none = feed.mergeInto(t, []);
  assert.deepEqual(none.removedIds, []);
  // Without dupes the comments are not re-sorted (the caller leaves the post alone).
  assert.deepEqual(none.comments.map(c => c._id), [1, 2]);
});

test('unionIds: appends missing ids once, compares as strings, keeps order', () => {
  const a = oid(), b = oid();
  const out = feed.unionIds([a], [String(a), b, new mongoose.Types.ObjectId(String(b))]);
  assert.equal(out.length, 2);
  assert.equal(out[0], a);
  assert.equal(String(out[1]), String(b));
  assert.deepEqual(feed.unionIds([], [a, a]).map(String), [String(a)]);
});

// ---- recordCoWatch end-to-end ---------------------------------------------
test('recordCoWatch: folds the other person\'s post in, saves, THEN deletes exactly the dupes', async (t) => {
  t.after(restore);
  const req = { _id: oid(), username: 'kevin' }, rec = { _id: oid(), username: 'elsid' };
  const u3 = oid();
  const post = stored({
    author: req._id, participants: [req._id], projectId: 'iron-man',
    comments: [comment(u3, 'first', 10), comment(u3, 'third', 30)],
    reactions: [{ user: rec._id, type: 'love' }],
    memories: [{ url: 'a.jpg', type: 'image', caption: '', by: req._id }]
  });
  const dupe = stored({
    author: rec._id, participants: [rec._id], projectId: 'iron-man',
    comments: [comment(u3, 'second', 20)],
    reactions: [{ user: rec._id, type: 'haha' }, { user: u3, type: 'wow' }],
    memories: [{ url: 'a.jpg', type: 'image', caption: 'dup', by: rec._id }, { url: 'b.mp4', type: 'video', caption: '', by: rec._id }]
  });
  const log = stub({ session: post, dupes: [dupe] });

  await feed.recordCoWatch(req, rec, 'iron-man');

  assert.deepEqual(ops(log), ['findOne', 'find', 'save', 'deleteMany']);
  const [, findQ] = log[1];
  assert.equal(String(findQ.author), String(rec._id));
  assert.equal(String(findQ._id.$ne), String(post._id));
  assert.equal(findQ.projectId, 'iron-man');

  const s = saved(log);
  assert.deepEqual(s.participants.map(String), [String(req._id), String(rec._id)]);
  assert.deepEqual(s.watchedWith, ['elsid']);
  assert.equal(s.kind, 'watch');
  assert.deepEqual(s.comments.map(c => c.text), ['first', 'second', 'third']);
  assert.deepEqual(s.reactions.map(r => [String(r.user), r.type]), [[String(rec._id), 'love'], [String(u3), 'wow']]);
  assert.deepEqual(s.memories.map(m => [m.url, m.caption]), [['a.jpg', ''], ['b.mp4', '']]);

  const del = log[3][1];
  assert.deepEqual(del._id.$in.map(String), [String(dupe._id)]);
});

test('recordCoWatch: recipient authored the session → requester listed in watchedWith, author never', async (t) => {
  t.after(restore);
  const req = { _id: oid(), username: 'kevin' }, rec = { _id: oid(), username: 'elsid' };
  const post = stored({ author: rec._id, participants: [rec._id], projectId: 'p', watchedWith: ['elsid', 'tony'] });
  const log = stub({ session: post, dupes: [] });
  await feed.recordCoWatch(req, rec, 'p');
  assert.equal(String(log[1][1].author), String(req._id));   // dupes looked up for the requester
  const s = saved(log);
  assert.deepEqual(s.watchedWith, ['tony', 'kevin']);
  assert.deepEqual(s.participants.map(String), [String(rec._id), String(req._id)]);
  assert.ok(!ops(log).includes('deleteMany'));
});

test('recordCoWatch: no recent post → new post with the requester\'s watch count, no dupe lookup', async (t) => {
  t.after(restore);
  const req = { _id: oid(), username: 'kevin' }, rec = { _id: oid(), username: 'elsid' };
  const log = stub({ session: null, watched: { count: 3 } });
  await feed.recordCoWatch(req, rec, 'p');
  assert.deepEqual(ops(log), ['findOne', 'User.findOne', 'save']);
  const s = saved(log);
  assert.equal(String(s.author), String(req._id));
  assert.equal(s.count, 3);
  assert.deepEqual(s.participants.map(String), [String(req._id), String(rec._id)]);
  assert.deepEqual(s.watchedWith, ['elsid']);
});

test('recordCoWatch: a failed save keeps the dupes (no deleteMany) and the wrapper logs instead of throwing', async (t) => {
  t.after(restore);
  const errs = [];
  const origErr = console.error;
  console.error = (...a) => errs.push(a);
  t.after(() => { console.error = origErr; });
  const req = { _id: oid(), username: 'kevin' }, rec = { _id: oid(), username: 'elsid' };
  const post = stored({ author: req._id, participants: [req._id], projectId: 'p' });
  const log = stub({ session: post, dupes: [stored({ author: rec._id, projectId: 'p' })], saveFails: true });
  const r = await feed.recordCoWatch(req, rec, 'p');
  assert.equal(r, undefined);
  assert.ok(!ops(log).includes('deleteMany'));
  assert.equal(errs.length, 1);
  assert.equal(errs[0][0], '[feed]');
  assert.match(errs[0][1].message, /write conflict/);
});

// ---- tagPost end-to-end ----------------------------------------------------
test('tagPost: tags the friend, folds their same-episode post in, saves, THEN deletes it', async (t) => {
  t.after(restore);
  const author = oid(), friend = { _id: oid(), username: 'elsid' };
  const post = stored({
    author, participants: [author], projectId: 'loki', episode: 2,
    comments: [comment(author, 'late', 50)], reactions: [{ user: friend._id, type: 'like' }]
  });
  const d1 = stored({ author: friend._id, projectId: 'loki', episode: 2, comments: [comment(friend._id, 'early', 5)],
    reactions: [{ user: friend._id, type: 'sad' }], memories: [{ url: 'x.jpg', type: 'image', caption: '', by: friend._id }] });
  const d2 = stored({ author: friend._id, projectId: 'loki', episode: 2, memories: [{ url: 'x.jpg', type: 'image', caption: 'dup', by: friend._id }] });
  const log = stub({ byId: post, dupes: [d1, d2] });

  assert.equal(await feed.tagPost(post._id, friend), true);
  assert.deepEqual(ops(log), ['findById', 'find', 'save', 'deleteMany']);
  const q = log[1][1];
  assert.equal(String(q.author), String(friend._id));
  assert.equal(q.projectId, 'loki');
  assert.equal(q.episode, 2);
  const s = saved(log);
  assert.deepEqual(s.participants.map(String), [String(author), String(friend._id)]);
  assert.deepEqual(s.watchedWith, ['elsid']);
  assert.deepEqual(s.comments.map(c => c.text), ['early', 'late']);
  assert.deepEqual(s.reactions.map(r => r.type), ['like']);
  assert.deepEqual(s.memories.map(m => [m.url, m.caption]), [['x.jpg', '']]);
  assert.deepEqual(log[3][1]._id.$in.map(String), [String(d1._id), String(d2._id)]);
});

test('tagPost: movie post looks up episode null; no dupes → saved, nothing deleted; gone post → false', async (t) => {
  t.after(restore);
  const author = oid(), friend = { _id: oid(), username: 'elsid' };
  const post = stored({ author, participants: [author, friend._id], projectId: 'p', episode: null, watchedWith: ['elsid'] });
  let log = stub({ byId: post, dupes: [] });
  assert.equal(await feed.tagPost(post._id, friend), true);
  assert.equal(log[1][1].episode, null);
  assert.deepEqual(ops(log), ['findById', 'find', 'save']);
  const s = saved(log);
  assert.equal(s.participants.length, 2);
  assert.deepEqual(s.watchedWith, ['elsid']);

  log = stub({ byId: null });
  assert.equal(await feed.tagPost(oid(), friend), false);
  assert.deepEqual(ops(log), ['findById']);
});

test('tagPost: a failed save rejects (caller catches) and deletes nothing', async (t) => {
  t.after(restore);
  const author = oid(), friend = { _id: oid(), username: 'elsid' };
  const post = stored({ author, participants: [author], projectId: 'p' });
  const log = stub({ byId: post, dupes: [stored({ author: friend._id, projectId: 'p' })], saveFails: true });
  await assert.rejects(feed.tagPost(post._id, friend), /write conflict/);
  assert.ok(!ops(log).includes('deleteMany'));
});

// ---- safe() -----------------------------------------------------------------
test('safe: swallows a rejection, logs it under [feed], resolves undefined; passes args through', async (t) => {
  const errs = [];
  const origErr = console.error;
  console.error = (...a) => errs.push(a);
  t.after(() => { console.error = origErr; });
  const boom = new Error('boom');
  const seen = [];
  const wrapped = feed.safe(async (...a) => { seen.push(a); throw boom; });
  assert.equal(await wrapped(1, 'two'), undefined);
  assert.deepEqual(seen, [[1, 'two']]);
  assert.deepEqual(errs, [['[feed]', boom]]);
  // A synchronous throw is caught too.
  assert.equal(await feed.safe(() => { throw boom; })(), undefined);
  assert.equal(errs.length, 2);
  // Success: nothing logged, return value dropped (fire-and-forget).
  assert.equal(await feed.safe(async () => 42)(), undefined);
  assert.equal(errs.length, 2);
});
