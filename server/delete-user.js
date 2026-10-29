/************************************************
 * server/delete-user.js — everything an admin "Delete user" removes.
 *
 * Before: DELETE /api/admin/users/:id removed the User, Friend, ProjectStay
 * and SceneScore rows only. The user's feed posts stayed (the feed hides
 * author-less posts, so pages came up short), their DMs / whispers stayed
 * in other people's inboxes with a null sender, their Upload rows and
 * Cloudinary photos were never destroyed (a storage leak), and their
 * username stayed in other users' watchedWith lists and posts — so a later
 * account that took the same name inherited all of it.
 *
 * planUserDeletion() is pure: it returns the ordered steps as data (model,
 * op, filter, update) so the cascade is unit-tested without Mongo
 * (test/delete-user.test.js). deleteUser() runs the plan. Every step is in
 * its own try/catch — one failed step is logged and reported, never stops
 * the rest — and the summary `{ ok, steps: [{ name, result | error }] }`
 * goes back to the admin.
 *
 * Order matters in two places:
 *   - 'collect-assets' runs FIRST: it reads the photo URLs off the User doc
 *     (memories, profile picture, /home room portraits) before that doc is
 *     deleted, plus the user's Upload rows.
 *   - 'destroy-assets' runs AFTER the User doc and the posts are gone,
 *     because it asks UploadPolicy.assetStillReferenced() whether anything
 *     still shows each photo — while the user's own records exist the
 *     answer would always be "yes". A photo someone else still shows (a
 *     re-posted URL, a /world house portrait) is kept, the same rule the
 *     admin memory delete uses. If the User delete failed, the check keeps
 *     everything, which is the safe way to fail.
 *
 * Reports are deliberately KEPT: they are the moderation record (a bug
 * report or a complaint thread can be evidence), Report.username is
 * already a denormalised snapshot for exactly this case, and the admin
 * report routes already check User.exists before messaging the author.
 * `user` is required on the schema, so it is left as the dangling id
 * rather than nulled (nulling it would make every later doc.save() on the
 * report — an admin reply — fail validation). The only write is filling
 * an empty username snapshot on old rows.
 ************************************************/

// Ordered, side-effect-free description of the cascade for one user.
// `userId` is the id string; `username` the exact stored name (watchedWith
// arrays store usernames, not ids). Missing username → the name-based
// steps are skipped rather than run with an empty filter.
function planUserDeletion({ userId, username } = {}) {
  const id = String(userId || '');
  if (!id) throw new Error('planUserDeletion: userId required');
  const name = typeof username === 'string' && username ? username : null;

  const steps = [];
  steps.push({ name: 'collect-assets', model: 'Upload', op: 'collectAssets', filter: { userId: id } });

  // Their own posts go entirely (comments and reactions on them with it).
  steps.push({ name: 'feedposts-own', model: 'FeedPost', op: 'deleteMany', filter: { author: id } });

  // Other people's posts: drop them as a co-watcher (id in participants,
  // name in watchedWith) and drop what they added there — comments,
  // reactions and memories they put on a shared session.
  const touches = [
    { participants: id },
    { 'comments.author': id },
    { 'reactions.user': id },
    { 'memories.by': id }
  ];
  const pull = {
    participants: id,
    comments: { author: id },
    reactions: { user: id },
    memories: { by: id }
  };
  if (name) { touches.push({ watchedWith: name }); pull.watchedWith = name; }
  steps.push({
    name: 'feedposts-others', model: 'FeedPost', op: 'updateMany',
    filter: { author: { $ne: id }, $or: touches },
    update: { $pull: pull }
  });

  // Every inbox row they sent or received. pairKey is derived from the two
  // ids (js/messaging-logic.js), so sender/recipient covers whispers, DMs
  // and the admin-notice / report-reply rows (sender null, recipient them).
  steps.push({
    name: 'messages', model: 'Message', op: 'deleteMany',
    filter: { $or: [{ sender: id }, { recipient: id }] }
  });

  // Reports are kept (see the header); just make sure each one still says
  // who filed it once the User doc is gone.
  if (name) {
    steps.push({
      name: 'reports-snapshot', model: 'Report', op: 'updateMany',
      filter: { user: id, username: { $in: ['', null] } },
      update: { $set: { username: name } }
    });
  }

  // Other users' watch history lists co-watchers by username.
  if (name) {
    steps.push({
      name: 'watched-with', model: 'User', op: 'updateMany',
      filter: { _id: { $ne: id }, 'watchedProjects.watchedWith': name },
      update: { $pull: { 'watchedProjects.$[].watchedWith': name } }
    });
  }

  // A /world house is global decoration; it stays. Only the "last edited
  // by" pointer is cleared. (Keepership comes from ProjectStay, below.)
  steps.push({
    name: 'world-houses', model: 'WorldHouse', op: 'updateMany',
    filter: { editedBy: id },
    update: { $set: { editedBy: null } }
  });

  steps.push({ name: 'user', model: 'User', op: 'deleteOne', filter: { _id: id } });
  steps.push({
    name: 'friends', model: 'Friend', op: 'deleteMany',
    filter: { $or: [{ requester: id }, { recipient: id }] }
  });
  // Island stay time — otherwise a deleted user stays "keeper" of a house
  // and nobody can edit it until someone out-stays them.
  steps.push({ name: 'project-stays', model: 'ProjectStay', op: 'deleteMany', filter: { userId: id } });
  // Scene Guess bests — same reason: a deleted user's record (and crown)
  // would otherwise sit on the island forever.
  steps.push({ name: 'scene-scores', model: 'SceneScore', op: 'deleteMany', filter: { userId: id } });
  // Quote Guess: the same for their bests; their suggestions still waiting
  // (or turned down) go; lines of theirs already in the game stay, without
  // the credit ("Suggested by @…").
  steps.push({ name: 'quote-scores', model: 'QuoteScore', op: 'deleteMany', filter: { userId: id } });
  steps.push({ name: 'quote-suggestions', model: 'QuoteLine', op: 'deleteMany', filter: { suggestedBy: id, status: { $ne: 'approved' } } });
  steps.push({
    name: 'quote-credits', model: 'QuoteLine', op: 'updateMany',
    filter: { suggestedBy: id },
    update: { $set: { suggestedBy: null, suggestedByName: '' } }
  });

  steps.push({ name: 'destroy-assets', model: 'Upload', op: 'destroyAssets', filter: { userId: id } });
  steps.push({ name: 'uploads', model: 'Upload', op: 'deleteMany', filter: { userId: id } });
  return steps;
}

// Every photo URL a User doc points at: memories on each watched project,
// the profile picture and the /home room portraits (homeHouses is Mixed:
// { roomKey: { portrait, ... } }).
function userAssetUrls(user) {
  const urls = [];
  if (!user) return urls;
  for (const w of user.watchedProjects || []) {
    for (const m of (w && w.memories) || []) if (m && m.url) urls.push(m.url);
  }
  if (user.profilePicture) urls.push(user.profilePicture);
  const homes = user.homeHouses;
  if (homes && typeof homes === 'object') {
    for (const room of Object.values(homes)) {
      if (room && typeof room.portrait === 'string' && room.portrait) urls.push(room.portrait);
    }
  }
  return urls;
}

// Upload rows + User-doc URLs → one entry per Cloudinary public_id. Rows
// carry their own publicId / resourceType; bare URLs (memories from before
// Upload rows existed) are parsed, and anything not on our cloud is dropped.
function assetList(rows, urls, parseAsset) {
  const byId = new Map();
  for (const r of rows || []) {
    if (!r || !r.publicId) continue;
    byId.set(r.publicId, { publicId: r.publicId, resourceType: r.resourceType || 'image', url: r.url || '' });
  }
  for (const url of urls || []) {
    const p = parseAsset(url);
    if (!p || !p.public_id || byId.has(p.public_id)) continue;
    byId.set(p.public_id, { publicId: p.public_id, resourceType: p.resource_type || 'image', url });
  }
  return [...byId.values()];
}

const DESTROY_CONCURRENCY = 4;   // a gentle burst, not hundreds of calls at once

function countOf(r) {
  if (!r || typeof r !== 'object') return r;
  if ('deletedCount' in r) return { deleted: r.deletedCount };
  if ('modifiedCount' in r) return { modified: r.modifiedCount };
  return r;
}

// Run the plan. `models` maps the plan's model names to Mongoose models;
// `cloudinary` is the v2 SDK (uploader.destroy). `deps` is for tests —
// parseAsset / assetStillReferenced default to the real helpers.
async function deleteUser(models, cloudinary, { userId, username } = {}, deps = {}) {
  const parseAsset = deps.parseAsset || require('./cloudinary-url').parseAsset;
  const stillReferenced = deps.assetStillReferenced || require('./upload-policy').assetStillReferenced;
  const log = deps.log || console;

  const plan = planUserDeletion({ userId, username });
  const steps = [];
  let assets = [];

  for (const step of plan) {
    try {
      const Model = models[step.model];
      if (!Model) throw new Error(`model ${step.model} not provided`);
      let result;
      if (step.op === 'collectAssets') {
        const [rows, user] = await Promise.all([
          Model.find(step.filter).select('publicId resourceType url').lean(),
          models.User.findById(step.filter.userId).select('watchedProjects.memories.url profilePicture homeHouses').lean()
        ]);
        assets = assetList(rows, userAssetUrls(user), parseAsset);
        result = { assets: assets.length };
      } else if (step.op === 'destroyAssets') {
        result = await destroyAll(assets, cloudinary, stillReferenced, log);
      } else if (step.update) {
        result = countOf(await Model[step.op](step.filter, step.update));
      } else {
        result = countOf(await Model[step.op](step.filter));
      }
      steps.push({ name: step.name, result });
    } catch (err) {
      const msg = (err && err.message) || String(err);
      log.error(`[delete-user] ${step.name} failed for ${userId}:`, msg);
      steps.push({ name: step.name, error: msg });
    }
  }
  return { ok: steps.every(s => !s.error), steps };
}

// Destroy each asset nothing else shows any more. Per-asset failures are
// counted, not thrown, so one Cloudinary hiccup doesn't strand the rest.
async function destroyAll(assets, cloudinary, stillReferenced, log) {
  const out = { destroyed: 0, kept: 0, failed: 0 };
  for (let i = 0; i < assets.length; i += DESTROY_CONCURRENCY) {
    await Promise.all(assets.slice(i, i + DESTROY_CONCURRENCY).map(async (a) => {
      try {
        if (a.url && await stillReferenced(a.url)) { out.kept++; return; }
        await cloudinary.uploader.destroy(a.publicId, { resource_type: a.resourceType, invalidate: true });
        out.destroyed++;
      } catch (err) {
        out.failed++;
        log.error('[delete-user] Cloudinary destroy failed:', a.publicId, err && err.message);
      }
    }));
  }
  return out;
}

module.exports = { planUserDeletion, deleteUser, userAssetUrls, assetList };
