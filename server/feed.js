// Feed post bookkeeping. Called from routes/progress.js and routes/friends.js
// AFTER the progress write has succeeded. Every export swallows its own
// errors: the feed is a side effect and must never fail (or slow down) a
// progress save — callers fire these without awaiting the response path.
const FeedPost = require('../models/FeedPost');
const User = require('../models/user');

// Activity on the same project within this window counts as one "session"
// and updates the existing post instead of creating a new one. Also absorbs
// watched → undo → watched flurries.
const SESSION_WINDOW_MS = 12 * 60 * 60 * 1000;
// A single save that adds more than this many projects is a bulk import /
// restore, not a watch — don't flood friends' feeds with it.
const MAX_POSTS_PER_SAVE = 3;

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

// The user finished a timed watch of `projectId` (count = their new total).
// Every finished watch is a real, runtime-long event (POST /progress/complete),
// so it gets its own post — a rewatch within the session window used to just
// bump the old post's count silently, never resurfacing, and kept the first
// watch's co-watchers as if they'd been at the rewatch too.
// Only the user's OWN recent post is reused, and only when it doesn't already
// cover this watch (e.g. a memory-only post made moments before finishing).
async function recordWatch(userId, projectId, count, watchedWith = []) {
    const post = await FeedPost.findOne({
        author: userId,
        projectId,
        createdAt: { $gte: sinceWindow() }
    }).sort({ createdAt: -1 });
    if (post && post.kind === 'memory') {
        post.kind = 'watch';
        post.count = count || 1;
        post.activityAt = new Date();
        await post.save();
        return;
    }
    if (post && (post.count || 1) >= (count || 1)) return; // already posted
    await FeedPost.create({
        author: userId,
        participants: [userId],
        projectId,
        kind: 'watch',
        count: count || 1,
        watchedWith
    });
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

// Diff a /progress/save payload against the previous document.
async function diffSave(userId, before, after) {
    const prev = new Map((before || []).map(e => [e.projectId, e]));
    const next = new Map(after.map(e => [e.projectId, e]));

    const watched = [];
    for (const e of after) {
        const old = prev.get(e.projectId);
        const oldWith = old ? (old.watchedWith || []) : [];
        const newNames = (e.watchedWith || []).filter(n => !oldWith.includes(n));
        if (!old || e.count > (old.count || 1) || newNames.length) watched.push(e);
    }
    if (watched.length <= MAX_POSTS_PER_SAVE) {
        for (const e of watched) {
            await recordWatch(userId, e.projectId, e.count, e.watchedWith || []);
        }
    }

    // Un-watched: retract a fresh post nobody has engaged with yet (the
    // "oops, wrong movie" case). Posts with comments/memories stay.
    const removed = [...prev.keys()].filter(id => !next.has(id));
    if (removed.length) {
        await FeedPost.deleteMany({
            author: userId,
            projectId: { $in: removed },
            createdAt: { $gte: sinceWindow() },
            'comments.0': { $exists: false },
            'memories.0': { $exists: false }
        });
    }
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
    for (const id of [requester._id, recipient._id]) {
        if (!post.participants.some(p => String(p) === String(id))) post.participants.push(id);
    }
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
    for (const d of dupes) {
        // Plain copies — subdocuments belong to their own parent document.
        const merged = [...post.comments.map(c => c.toObject()), ...d.comments.map(c => c.toObject())]
            .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
        post.comments = merged;
        for (const r of d.reactions) {
            if (!post.reactions.some(x => String(x.user) === String(r.user))) post.reactions.push(r.toObject());
        }
        for (const m of d.memories) {
            if (!post.memories.some(x => x.url === m.url)) post.memories.push(m.toObject());
        }
    }
    await post.save();
    if (dupes.length) await FeedPost.deleteMany({ _id: { $in: dupes.map(d => d._id) } });
}

// A tag request from the post composer was accepted: add the friend to that
// exact post. Their own recent post for the same project + episode is
// folded in (comments, reactions, memories move over) so the party shows
// once. Returns true if the post still exists and was tagged.
async function tagPost(postId, friend) {
    // friend: { _id, username }
    const post = await FeedPost.findById(postId);
    if (!post) return false;
    if (!post.participants.some(p => String(p) === String(friend._id))) post.participants.push(friend._id);
    if (!post.watchedWith.includes(friend.username)) post.watchedWith.push(friend.username);
    post.activityAt = new Date();
    const dupes = await FeedPost.find({
        _id: { $ne: post._id },
        author: friend._id,
        projectId: post.projectId,
        episode: post.episode ?? null,
        createdAt: { $gte: sinceWindow() }
    });
    for (const d of dupes) {
        post.comments = [...post.comments.map(c => c.toObject()), ...d.comments.map(c => c.toObject())]
            .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
        for (const r of d.reactions) {
            if (!post.reactions.some(x => String(x.user) === String(r.user))) post.reactions.push(r.toObject());
        }
        for (const m of d.memories) {
            if (!post.memories.some(x => x.url === m.url)) post.memories.push(m.toObject());
        }
    }
    await post.save();
    if (dupes.length) await FeedPost.deleteMany({ _id: { $in: dupes.map(d => d._id) } });
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
    diffSave: safe(diffSave),
    recordWatch: safe(recordWatch),
    recordCoWatch: safe(recordCoWatch),
    recordMemory: safe(recordMemory),
    removeMemory: safe(removeMemory)
};
