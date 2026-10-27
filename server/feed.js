// Feed post bookkeeping. Called from routes/progress.js and routes/friends.js
// AFTER the progress write has succeeded. Every export swallows its own
// errors: the feed is a side effect and must never fail (or slow down) a
// progress save — callers fire these without awaiting the response path.
const FeedPost = require('../models/FeedPost');
const User = require('../models/user');

// Activity on the same project within this window counts as one "session"
// and updates the existing post instead of creating a new one.
const SESSION_WINDOW_MS = 12 * 60 * 60 * 1000;

const sinceWindow = () => new Date(Date.now() - SESSION_WINDOW_MS);

function findSession(userId, projectId) {
    return FeedPost.findOne({
        participants: userId,
        projectId,
        createdAt: { $gte: sinceWindow() }
    }).sort({ createdAt: -1 });
}

function safe(fn) {
    return async (...args) => {
        try { await fn(...args); } catch (err) { console.error('[feed]', err); }
    };
}

const byCreatedAt = (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0);

// Pure: fold duplicate posts into `target` (all plain objects with comments /
// reactions / memories arrays). Comments from every post, ordered by
// createdAt (stable: ties keep target-first order; no de-dup). One reaction
// per user and one memory per url — what the target already has wins, then
// the earliest dupe. Inputs are not mutated. removedIds = the dupes' _ids,
// i.e. exactly the posts the caller deletes once the target is saved.
function mergeInto(target, dupes) {
    let comments = [...(target.comments || [])];
    const reactions = [...(target.reactions || [])];
    const memories = [...(target.memories || [])];
    for (const d of dupes) {
        comments = [...comments, ...(d.comments || [])].sort(byCreatedAt);
        for (const r of d.reactions || []) {
            if (!reactions.some(x => String(x.user) === String(r.user))) reactions.push(r);
        }
        for (const m of d.memories || []) {
            if (!memories.some(x => x.url === m.url)) memories.push(m);
        }
    }
    return { comments, reactions, memories, removedIds: dupes.map(d => d._id) };
}

// Pure: `list` plus each of `ids` not already in it (compared as strings).
function unionIds(list, ids) {
    const out = [...list];
    for (const id of ids) if (!out.some(p => String(p) === String(id))) out.push(id);
    return out;
}

// Apply mergeInto() to a FeedPost document. Plain copies — subdocuments
// belong to their own parent document. Returns the ids to delete AFTER
// post.save() has succeeded.
function foldDupes(post, dupes) {
    if (!dupes.length) return [];
    const plain = (doc) => ({
        _id: doc._id,
        comments: doc.comments.map(c => c.toObject()),
        reactions: doc.reactions.map(r => r.toObject()),
        memories: doc.memories.map(m => m.toObject())
    });
    const m = mergeInto(plain(post), dupes.map(plain));
    post.comments = m.comments;
    post.reactions = m.reactions;
    post.memories = m.memories;
    return m.removedIds;
}

// The post for one finished step (movie, or one series episode), exactly as
// written in the post composer. A recent memory-only post for the same
// project is folded in, so "added a memory" + "watched" don't sit side by
// side. Returns the created/updated post (awaited: the client gets its id
// back so it can offer "Edit post").
async function createWatchPost(userId, projectId, { count = 1, episode = null, caption = '', memories = [] } = {}) {
    const mems = memories.map(m => ({ url: m.url, type: m.type, caption: m.caption || '', by: userId }));
    const memoryPost = await FeedPost.findOne({
        author: userId, projectId, kind: 'memory', createdAt: { $gte: sinceWindow() }
    }).sort({ createdAt: -1 });
    if (memoryPost) {
        memoryPost.set({ kind: 'watch', count, episode, caption, activityAt: new Date() });
        for (const m of mems) if (!memoryPost.memories.some(x => x.url === m.url)) memoryPost.memories.push(m);
        return memoryPost.save();
    }
    return FeedPost.create({
        author: userId,
        participants: [userId],
        projectId,
        kind: 'watch',
        count,
        episode,
        caption,
        memories: mems
    });
}

// A watch-party request was accepted: merge both users into one post.
async function recordCoWatch(requester, recipient, projectId) {
    // requester / recipient: { _id, username }
    let post = await FeedPost.findOne({
        participants: { $in: [requester._id, recipient._id] },
        projectId,
        createdAt: { $gte: sinceWindow() }
    }).sort({ createdAt: -1 });

    if (!post) {
        const u = await User.findOne(
            { _id: requester._id, 'watchedProjects.projectId': projectId },
            { 'watchedProjects.$': 1 }
        ).lean();
        post = new FeedPost({
            author: requester._id,
            participants: [requester._id],
            projectId,
            kind: 'watch',
            count: u?.watchedProjects?.[0]?.count || 1
        });
    }
    const authorIsRequester = String(post.author) === String(requester._id);
    const other = authorIsRequester ? recipient : requester;
    const author = authorIsRequester ? requester : recipient;
    post.participants = unionIds(post.participants, [requester._id, recipient._id]);
    if (!post.watchedWith.includes(other.username)) post.watchedWith.push(other.username);
    post.watchedWith = post.watchedWith.filter(n => n !== author.username);
    post.kind = 'watch';
    post.activityAt = new Date();

    // One watch party = one post. The other person's own recent post for the
    // same project is folded in (its comments, reactions and memories move
    // over) and removed, so friends of both don't see the party twice.
    const dupes = post.isNew ? [] : await FeedPost.find({
        _id: { $ne: post._id },
        author: other._id,
        projectId,
        createdAt: { $gte: sinceWindow() }
    });
    const removedIds = foldDupes(post, dupes);
    await post.save();
    if (removedIds.length) await FeedPost.deleteMany({ _id: { $in: removedIds } });
}

// A tag request from the post composer was accepted: add the friend to that
// exact post. Their own recent post for the same project + episode is
// folded in (comments, reactions, memories move over) so the party shows
// once. Returns true if the post still exists and was tagged.
async function tagPost(postId, friend) {
    // friend: { _id, username }
    const post = await FeedPost.findById(postId);
    if (!post) return false;
    post.participants = unionIds(post.participants, [friend._id]);
    if (!post.watchedWith.includes(friend.username)) post.watchedWith.push(friend.username);
    post.activityAt = new Date();
    const dupes = await FeedPost.find({
        _id: { $ne: post._id },
        author: friend._id,
        projectId: post.projectId,
        episode: post.episode ?? null,
        createdAt: { $gte: sinceWindow() }
    });
    const removedIds = foldDupes(post, dupes);
    await post.save();
    if (removedIds.length) await FeedPost.deleteMany({ _id: { $in: removedIds } });
    return true;
}

async function recordMemory(userId, projectId, memory) {
    const entry = { url: memory.url, type: memory.type, caption: memory.caption || '', by: userId };
    const post = await findSession(userId, projectId);
    if (post) {
        post.memories.push(entry);
        post.activityAt = new Date();
        await post.save();
        return;
    }
    await FeedPost.create({
        author: userId,
        participants: [userId],
        projectId,
        kind: 'memory',
        memories: [entry]
    });
}

async function removeMemory(userId, projectId, url) {
    await FeedPost.updateMany(
        { participants: userId, projectId, 'memories.url': url },
        { $pull: { memories: { url, by: userId } } }
    );
    // A memory-only post with nothing left and no conversation is empty.
    await FeedPost.deleteMany({
        author: userId,
        projectId,
        kind: 'memory',
        'memories.0': { $exists: false },
        'comments.0': { $exists: false }
    });
}

module.exports = {
    createWatchPost,   // not wrapped: the caller needs the post back (and catches)
    tagPost,           // same
    recordCoWatch: safe(recordCoWatch),
    recordMemory: safe(recordMemory),
    removeMemory: safe(removeMemory),
    // Pure pieces, exported for test/feed.test.js.
    mergeInto,
    unionIds,
    safe
};
