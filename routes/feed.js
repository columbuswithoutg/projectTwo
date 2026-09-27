const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const FeedPost = require('../models/FeedPost');
const auth = require('../middleware/auth');
const User = require('../models/user');
const watchTags = require('../server/watchTags');
const watchRules = require('../server/watchRules');
const { sanitizeMemory, MAX_MEMORY_CAPTION_LEN } = require('../server/memory');

const PAGE_SIZE = 15;
const MAX_COMMENT_LEN = 500;
const MAX_CAPTION_LEN = 500;
const REACTION_TYPES = ['like', 'love', 'haha', 'wow', 'sad', 'angry'];

function validId(id) {
    return typeof id === 'string' && mongoose.isValidObjectId(id);
}

// Self + accepted friends, as strings (shared with /api/friends/stones).
const { getFriendIds: circleIds } = require('../server/friendship');

const canSee = (post, circle) => post.participants.some(p => circle.has(String(p)));

function shapeUser(u) {
    return u ? { id: String(u._id), username: u.username, profilePicture: u.profilePicture || '' } : null;
}

function shapeComment(c) {
    return {
        id: String(c._id),
        text: c.text,
        createdAt: c.createdAt,
        author: shapeUser(c.author)
    };
}

// Reactors list (populated), with the viewer's own reaction pulled out.
function shapeReactions(reactions, userId) {
    const list = (reactions || [])
        .filter(r => r.user && r.user.username)
        .map(r => ({ type: r.type, user: shapeUser(r.user) }));
    const mine = list.find(r => r.user.id === String(userId));
    return { reactions: list, myReaction: mine ? mine.type : null };
}

function shapePost(p, userId) {
    const author = shapeUser(p.author);
    return {
        id: String(p._id),
        kind: p.kind,
        caption: p.caption || '',
        ...shapeReactions(p.reactions, userId),
        projectId: p.projectId,
        count: p.count || 1,
        episode: p.episode || null,
        watchedWith: p.watchedWith || [],
        memories: (p.memories || []).map(m => ({ url: m.url, type: m.type, caption: m.caption || '' })),
        comments: (p.comments || []).filter(c => c.author).map(shapeComment),
        createdAt: p.createdAt,
        activityAt: p.activityAt || p.createdAt,
        author,
        mine: author ? author.id === String(userId) : false
    };
}

// GET /api/feed?before=<ISO date> — newest activity first, cursor-paged.
router.get('/', auth, async (req, res) => {
    const circle = await circleIds(req.user.id);
    const query = { participants: { $in: [...circle] } };
    const before = req.query.before ? new Date(String(req.query.before)) : null;
    if (before && !isNaN(before)) query.activityAt = { $lt: before };

    const posts = await FeedPost.find(query)
        .sort({ activityAt: -1 })
        .limit(PAGE_SIZE + 1)
        .populate('author', 'username profilePicture')
        .populate('comments.author', 'username profilePicture')
        .populate('reactions.user', 'username profilePicture')
        .lean();

    const page = posts.slice(0, PAGE_SIZE).filter(p => p.author);
    const hasMore = posts.length > PAGE_SIZE;
    res.json({
        posts: page.map(p => shapePost(p, req.user.id)),
        nextBefore: hasMore ? posts[PAGE_SIZE - 1].activityAt : null
    });
});

// POST /api/feed/:postId/comments { text }
router.post('/:postId/comments', auth, async (req, res) => {
    if (!validId(req.params.postId)) return res.status(400).json({ error: 'Invalid post' });
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) return res.status(400).json({ error: 'Comment is empty' });
    if (text.length > MAX_COMMENT_LEN) return res.status(400).json({ error: 'Comment is too long' });

    const post = await FeedPost.findById(req.params.postId).select('participants comments');
    if (!post) return res.status(404).json({ error: 'Post not found' });
    const circle = await circleIds(req.user.id);
    if (!canSee(post, circle)) return res.status(403).json({ error: 'Not allowed' });
    if (post.comments.length >= 300) return res.status(400).json({ error: 'Comment limit reached' });

    post.comments.push({ author: req.user.id, text });
    await post.save();
    await post.populate('comments.author', 'username profilePicture');
    res.json({ comment: shapeComment(post.comments[post.comments.length - 1]) });
});

// PUT /api/feed/:postId/reaction { type } — set/replace the viewer's reaction;
// type null removes it. Pull-then-push keeps one reaction per user.
router.put('/:postId/reaction', auth, async (req, res) => {
    if (!validId(req.params.postId)) return res.status(400).json({ error: 'Invalid post' });
    const type = req.body?.type ?? null;
    if (type !== null && !REACTION_TYPES.includes(type)) {
        return res.status(400).json({ error: 'Invalid reaction' });
    }

    const post = await FeedPost.findById(req.params.postId).select('participants');
    if (!post) return res.status(404).json({ error: 'Post not found' });
    const circle = await circleIds(req.user.id);
    if (!canSee(post, circle)) return res.status(403).json({ error: 'Not allowed' });

    await FeedPost.updateOne({ _id: post._id }, { $pull: { reactions: { user: req.user.id } } });
    if (type) {
        await FeedPost.updateOne(
            { _id: post._id, 'reactions.user': { $ne: req.user.id } },
            { $push: { reactions: { user: req.user.id, type } } }
        );
    }
    const fresh = await FeedPost.findById(post._id)
        .select('reactions')
        .populate('reactions.user', 'username profilePicture')
        .lean();
    res.json(shapeReactions(fresh.reactions, req.user.id));
});

// PUT /api/feed/:postId/caption { caption } — author only; '' clears it.
router.put('/:postId/caption', auth, async (req, res) => {
    if (!validId(req.params.postId)) return res.status(400).json({ error: 'Invalid post' });
    if (typeof req.body?.caption !== 'string') return res.status(400).json({ error: 'Invalid caption' });
    const caption = req.body.caption.trim();
    if (caption.length > MAX_CAPTION_LEN) return res.status(400).json({ error: 'Caption is too long' });

    const result = await FeedPost.updateOne(
        { _id: req.params.postId, author: req.user.id },
        { $set: { caption } }
    );
    if (!result.matchedCount) return res.status(404).json({ error: 'Post not found' });
    res.json({ caption });
});

// PUT /api/feed/:postId — author edits a post after publishing, from the same
// post composer used when marking as watched (js/post-composer.js).
//   caption       string, ≤ 500 chars
//   memories      the full list to keep: existing ones (by url) and/or new
//                 Cloudinary uploads; anything left out is removed
//   watchedWith   usernames to KEEP (untag only — tags need the friend's OK)
//   tagFriendIds  friends to send new tag requests to
// Memory changes are mirrored on the author's project entry so the project
// popup's Memories stay in step.
const MAX_POST_MEMORIES = 20;
router.put('/:postId', auth, async (req, res) => {
    if (!validId(req.params.postId)) return res.status(400).json({ error: 'Invalid post' });
    const b = req.body || {};
    const post = await FeedPost.findOne({ _id: req.params.postId, author: req.user.id });
    if (!post) return res.status(404).json({ error: 'Post not found' });

    if (b.caption !== undefined) {
        if (typeof b.caption !== 'string') return res.status(400).json({ error: 'Invalid caption' });
        const caption = b.caption.trim();
        if (caption.length > MAX_CAPTION_LEN) return res.status(400).json({ error: 'Caption is too long' });
        post.caption = caption;
    }

    let added = [];
    let removedUrls = [];
    if (b.memories !== undefined) {
        if (!Array.isArray(b.memories)) return res.status(400).json({ error: 'Invalid memories' });
        const existing = new Map(post.memories.map(m => [m.url, m]));
        const next = [];
        for (const raw of b.memories.slice(0, MAX_POST_MEMORIES)) {
            const url = raw && raw.url;
            if (existing.has(url)) {
                const m = existing.get(url).toObject();
                if (typeof raw.caption === 'string') m.caption = raw.caption.slice(0, MAX_MEMORY_CAPTION_LEN);
                next.push(m);
                continue;
            }
            const clean = sanitizeMemory(raw);
            if (!clean) return res.status(400).json({ error: 'Photos and videos must be uploaded through the app' });
            const m = { ...clean, by: req.user.id };
            next.push(m);
            added.push(m);
        }
        const keep = new Set(next.map(m => m.url));
        removedUrls = post.memories.filter(m => !keep.has(m.url)).map(m => m.url);
        post.memories = next;
    }

    if (b.watchedWith !== undefined) {
        if (!Array.isArray(b.watchedWith)) return res.status(400).json({ error: 'Invalid tags' });
        const keepNames = new Set(b.watchedWith.filter(n => typeof n === 'string'));
        const dropped = post.watchedWith.filter(n => !keepNames.has(n));
        if (dropped.length) {
            post.watchedWith = post.watchedWith.filter(n => keepNames.has(n));
            const droppedUsers = await User.find({ username: { $in: dropped } }).select('_id').lean();
            const droppedIds = new Set(droppedUsers.map(u => String(u._id)));
            post.participants = post.participants.filter(p => String(p) === String(post.author) || !droppedIds.has(String(p)));
        }
    }

    if (post.kind === 'memory' && !post.memories.length && !post.caption) {
        return res.status(400).json({ error: 'A memory post needs at least one photo or video' });
    }
    await post.save();

    // Keep the project entry's Memories in step (best effort).
    if (added.length || removedUrls.length) {
        if (removedUrls.length) {
            await User.updateOne(
                { _id: req.user.id, 'watchedProjects.projectId': post.projectId },
                { $pull: { 'watchedProjects.$.memories': { url: { $in: removedUrls } } } }
            ).catch(() => {});
        }
        if (added.length) {
            await User.updateOne(
                { _id: req.user.id, 'watchedProjects.projectId': post.projectId },
                { $push: { 'watchedProjects.$.memories': {
                    $each: added.map(m => ({ url: m.url, type: m.type, caption: m.caption, uploadedAt: new Date() })),
                    $slice: -40
                } } }
            ).catch(() => {});
        }
    }

    let tagsSent = 0;
    const tagIds = watchTags.cleanFriendIds(b.tagFriendIds, req.user.id);
    if (tagIds.length) {
        const project = await watchRules.getProject(post.projectId);
        const sent = await watchTags.sendTags({
            userId: req.user.id, projectId: post.projectId,
            projectTitle: String((project && project.title) || post.projectId).slice(0, 200),
            postId: post._id, episode: post.episode ?? null, friendIds: tagIds
        });
        tagsSent = sent.length;
    }

    const fresh = await FeedPost.findById(post._id)
        .populate('author', 'username profilePicture')
        .populate('comments.author', 'username profilePicture')
        .populate('reactions.user', 'username profilePicture')
        .lean();
    res.json({ post: shapePost(fresh, req.user.id), tagsSent });
});

// DELETE /api/feed/:postId/comments/:commentId — comment author or post author.
router.delete('/:postId/comments/:commentId', auth, async (req, res) => {
    const { postId, commentId } = req.params;
    if (!validId(postId) || !validId(commentId)) return res.status(400).json({ error: 'Invalid id' });
    const result = await FeedPost.updateOne(
        {
            _id: postId,
            // The comment must actually be on this post: schema timestamps bump
            // updatedAt on every update, so modifiedCount alone was never 0 and
            // a missing comment still answered "Deleted".
            'comments._id': commentId,
            $or: [
                { author: req.user.id },
                { comments: { $elemMatch: { _id: commentId, author: req.user.id } } }
            ]
        },
        { $pull: { comments: { _id: commentId } } }
    );
    if (!result.modifiedCount) return res.status(404).json({ error: 'Comment not found' });
    res.json({ message: 'Deleted' });
});

module.exports = router;
