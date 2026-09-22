const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const FeedPost = require('../models/FeedPost');
const auth = require('../middleware/auth');

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

// DELETE /api/feed/:postId/comments/:commentId — comment author or post author.
router.delete('/:postId/comments/:commentId', auth, async (req, res) => {
    const { postId, commentId } = req.params;
    if (!validId(postId) || !validId(commentId)) return res.status(400).json({ error: 'Invalid id' });
    const result = await FeedPost.updateOne(
        {
            _id: postId,
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
