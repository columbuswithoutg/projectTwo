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

// The user watched `projectId` (new entry or count went up), optionally with
// co-watcher usernames recorded client-side.
async function recordWatch(userId, projectId, count, watchedWith = []) {
    const post = await findSession(userId, projectId);
    if (post) {
        if (String(post.author) === String(userId)) {
            post.count = Math.max(post.count || 1, count || 1);
            const fresh = watchedWith.filter(n => !post.watchedWith.includes(n));
            if (fresh.length) {
                post.watchedWith.push(...fresh);
                post.activityAt = new Date();
            }
            post.kind = 'watch';
            await post.save();
        }
        return;
    }
    await FeedPost.create({
        author: userId,
        participants: [userId],
        projectId,
        kind: 'watch',
        count: count || 1,
        watchedWith
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
    await post.save();
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
    diffSave: safe(diffSave),
    recordWatch: safe(recordWatch),
    recordCoWatch: safe(recordCoWatch),
    recordMemory: safe(recordMemory),
    removeMemory: safe(removeMemory)
};
