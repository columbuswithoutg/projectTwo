/************************************************
 * Unit tests for server/delete-user.js — the admin user-delete cascade.
 *
 * No Mongo: planUserDeletion() is pure, and deleteUser() runs against
 * stub models that record every call (same idea as the User stubs in
 * test/auth-middleware.test.js). Cloudinary, parseAsset and
 * assetStillReferenced are injected.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const { planUserDeletion, deleteUser, userAssetUrls, assetList } = require('../server/delete-user');

const ID = '0123456789abcdef01234567';
const NAME = 'kevin';

const byName = (plan) => Object.fromEntries(plan.map(s => [s.name, s]));

test('plan: ordered steps, assets collected first and destroyed after the user is gone', () => {
  const plan = planUserDeletion({ userId: ID, username: NAME });
  const names = plan.map(s => s.name);
  assert.deepEqual(names, [
    'collect-assets', 'feedposts-own', 'feedposts-others', 'messages', 'reports-snapshot',
    'watched-with', 'world-houses', 'user', 'friends', 'project-stays', 'scene-scores',
    'quote-scores', 'quote-suggestions', 'quote-credits',
    'destroy-assets', 'uploads'
  ]);
  assert.ok(names.indexOf('destroy-assets') > names.indexOf('user'));
  assert.ok(names.indexOf('destroy-assets') > names.indexOf('feedposts-own'));
});

test('plan: filters and pulls target the user id / username', () => {
  const s = byName(planUserDeletion({ userId: ID, username: NAME }));
  assert.deepEqual(s['feedposts-own'].filter, { author: ID });
  assert.deepEqual(s['feedposts-others'].filter.author, { $ne: ID });
  assert.deepEqual(s['feedposts-others'].update, { $pull: {
    participants: ID, comments: { author: ID }, reactions: { user: ID }, memories: { by: ID }, watchedWith: NAME
  } });
  assert.ok(s['feedposts-others'].filter.$or.some(c => c.watchedWith === NAME));
  assert.deepEqual(s.messages.filter, { $or: [{ sender: ID }, { recipient: ID }] });
  assert.deepEqual(s['reports-snapshot'], {
    name: 'reports-snapshot', model: 'Report', op: 'updateMany',
    filter: { user: ID, username: { $in: ['', null] } }, update: { $set: { username: NAME } }
  });
  assert.equal(s['watched-with'].model, 'User');
  assert.deepEqual(s['watched-with'].update, { $pull: { 'watchedProjects.$[].watchedWith': NAME } });
  assert.deepEqual(s['world-houses'].update, { $set: { editedBy: null } });
  assert.deepEqual(s.user.filter, { _id: ID });
  assert.deepEqual(s.friends.filter, { $or: [{ requester: ID }, { recipient: ID }] });
  assert.deepEqual(s['project-stays'].filter, { userId: ID });
  assert.deepEqual(s['scene-scores'].filter, { userId: ID });
  assert.deepEqual(s.uploads, { name: 'uploads', model: 'Upload', op: 'deleteMany', filter: { userId: ID } });
  // Reports are never deleted.
  assert.ok(!planUserDeletion({ userId: ID, username: NAME }).some(x => x.model === 'Report' && /delete/.test(x.op)));
});

test('plan: no username → name-based steps are skipped, never run with an empty name', () => {
  const plan = planUserDeletion({ userId: ID });
  const names = plan.map(s => s.name);
  assert.ok(!names.includes('watched-with'));
  assert.ok(!names.includes('reports-snapshot'));
  const others = byName(plan)['feedposts-others'];
  assert.ok(!('watchedWith' in others.update.$pull));
  assert.ok(!others.filter.$or.some(c => 'watchedWith' in c));
  assert.throws(() => planUserDeletion({}), /userId required/);
});

test('userAssetUrls / assetList: memories, profile picture, home portraits; dedupe by public_id', () => {
  const urls = userAssetUrls({
    watchedProjects: [{ memories: [{ url: 'u/a' }, { url: '' }] }, { memories: [{ url: 'u/b' }] }, {}],
    profilePicture: 'u/pp',
    homeHouses: { living: { portrait: 'u/h' }, kitchen: { portrait: '' }, junk: null }
  });
  assert.deepEqual(urls, ['u/a', 'u/b', 'u/pp', 'u/h']);
  assert.deepEqual(userAssetUrls(null), []);

  const parse = (u) => (u.startsWith('u/') ? { public_id: 'p/' + u.slice(2), resource_type: 'image' } : null);
  const list = assetList(
    [{ publicId: 'p/a', resourceType: 'video', url: 'u/a' }],
    ['u/a', 'u/pp', 'https://elsewhere/x.jpg'],
    parse
  );
  assert.deepEqual(list, [
    { publicId: 'p/a', resourceType: 'video', url: 'u/a' },     // the row wins (keeps its resource type)
    { publicId: 'p/pp', resourceType: 'image', url: 'u/pp' }    // foreign URL dropped
  ]);
});

// ---- deleteUser against recording stubs -------------------------------
function stubModels({ fail = {}, uploads = [], user = null } = {}) {
  const calls = [];
  const make = (model) => new Proxy({}, {
    get(_, op) {
      if (op === 'find') {
        return (filter) => ({ select: () => ({ lean: async () => { calls.push({ model, op, filter }); return uploads; } }) });
      }
      if (op === 'findById') {
        return (id) => ({ select: () => ({ lean: async () => { calls.push({ model, op, filter: id }); return user; } }) });
      }
      return async (filter, update) => {
        calls.push({ model, op, filter, update });
        if (fail[`${model}.${op}`]) throw new Error('boom');
        return op.startsWith('delete') ? { deletedCount: 1 } : { modifiedCount: 2 };
      };
    }
  });
  const models = {};
  for (const m of ['User', 'Friend', 'ProjectStay', 'SceneScore', 'QuoteScore', 'QuoteLine', 'FeedPost', 'Message', 'Report', 'Upload', 'WorldHouse']) {
    models[m] = make(m);
  }
  return { models, calls };
}
const quietLog = { error() {} };
const parseAsset = (u) => (u.startsWith('u/') ? { public_id: 'p/' + u.slice(2), resource_type: 'image' } : null);

test('deleteUser: runs every step in plan order and reports counts', async () => {
  const { models, calls } = stubModels({
    uploads: [{ publicId: 'p/a', resourceType: 'image', url: 'u/a' }],
    user: { profilePicture: 'u/pp', watchedProjects: [] }
  });
  const destroyed = [];
  const cloudinary = { uploader: { destroy: async (id, opts) => { destroyed.push([id, opts.resource_type]); return { result: 'ok' }; } } };
  const out = await deleteUser(models, cloudinary, { userId: ID, username: NAME }, {
    parseAsset, assetStillReferenced: async (url) => url === 'u/pp', log: quietLog
  });
  assert.equal(out.ok, true);
  assert.deepEqual(out.steps.map(s => s.name), planUserDeletion({ userId: ID, username: NAME }).map(s => s.name));
  const r = Object.fromEntries(out.steps.map(s => [s.name, s.result]));
  assert.deepEqual(r['collect-assets'], { assets: 2 });
  assert.deepEqual(r['destroy-assets'], { destroyed: 1, kept: 1, failed: 0 });   // the still-shown profile picture is kept
  assert.deepEqual(r.user, { deleted: 1 });
  assert.deepEqual(r['watched-with'], { modified: 2 });
  assert.deepEqual(destroyed, [['p/a', 'image']]);
  // Quote Guess: pending / rejected suggestions go, approved lines lose the credit.
  const q = calls.filter(c => c.model === 'QuoteLine');
  assert.deepEqual(q.map(c => c.op), ['deleteMany', 'updateMany']);
  assert.deepEqual(q[0].filter, { suggestedBy: ID, status: { $ne: 'approved' } });
  assert.deepEqual(q[1].update, { $set: { suggestedBy: null, suggestedByName: '' } });
  // The User doc is deleted before any Cloudinary destroy.
  const writes = calls.filter(c => c.op !== 'find' && c.op !== 'findById').map(c => `${c.model}.${c.op}`);
  assert.equal(writes[writes.length - 1], 'Upload.deleteMany');
  assert.ok(writes.includes('User.deleteOne'));
});

test('deleteUser: one failing step is reported and the rest still run', async () => {
  const { models, calls } = stubModels({ fail: { 'Message.deleteMany': true } });
  const cloudinary = { uploader: { destroy: async () => ({ result: 'ok' }) } };
  const out = await deleteUser(models, cloudinary, { userId: ID, username: NAME }, {
    parseAsset, assetStillReferenced: async () => false, log: quietLog
  });
  assert.equal(out.ok, false);
  const msg = out.steps.find(s => s.name === 'messages');
  assert.equal(msg.error, 'boom');
  assert.ok(!('result' in msg));
  assert.ok(out.steps.find(s => s.name === 'user').result);
  assert.ok(calls.some(c => c.model === 'SceneScore' && c.op === 'deleteMany'));
  assert.ok(calls.some(c => c.model === 'Upload' && c.op === 'deleteMany'));
});

test('deleteUser: a Cloudinary failure is counted, not thrown; a missing model is a step error', async () => {
  const { models } = stubModels({ uploads: [
    { publicId: 'p/a', resourceType: 'image', url: 'u/a' },
    { publicId: 'p/b', resourceType: 'video', url: 'u/b' }
  ] });
  delete models.WorldHouse;
  const cloudinary = { uploader: { destroy: async (id) => { if (id === 'p/a') throw new Error('rate'); return { result: 'ok' }; } } };
  const out = await deleteUser(models, cloudinary, { userId: ID, username: NAME }, {
    parseAsset, assetStillReferenced: async () => false, log: quietLog
  });
  const r = Object.fromEntries(out.steps.map(s => [s.name, s]));
  assert.deepEqual(r['destroy-assets'].result, { destroyed: 1, kept: 0, failed: 1 });
  assert.match(r['world-houses'].error, /WorldHouse not provided/);
  assert.equal(out.ok, false);
  assert.ok(r.uploads.result);
});
