const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const User = require('../models/user');
const Friend = require('../models/Friend');
const auth = require('../middleware/auth');

// Escape regex metacharacters so a user can't pass ".*" to dump everyone
// or "(a+)+$" to hang the DB with catastrophic backtracking (ReDoS).
function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Reject non-ObjectId params up-front so Mongoose can't be tricked by
// `{ $ne: null }` / operator-injection and doesn't throw on malformed IDs.
function validId(id) {
    return typeof id === 'string' && mongoose.isValidObjectId(id);
}

// Search users by username
router.get('/search', auth, async (req, res) => {
    const { username } = req.query;
    if (!username || typeof username !== 'string') return res.json([]);
    const trimmed = username.trim();
    if (trimmed.length < 1 || trimmed.length > 40) return res.json([]);
    const users = await User.find({
        username: { $regex: escapeRegex(trimmed), $options: 'i' },
        _id: { $ne: req.user.id } // exclude self
    }).select('username _id').limit(10);
    res.json(users);
});

// Send friend request
router.post('/request', auth, async (req, res) => {
    const { recipientId } = req.body;
    if (!validId(recipientId))
        return res.status(400).json({ error: 'Invalid recipient' });
    if (recipientId === req.user.id)
        return res.status(400).json({ error: "You can't add yourself" });
    const recipientExists = await User.exists({ _id: recipientId });
    if (!recipientExists)
        return res.status(404).json({ error: 'User not found' });

    const existing = await Friend.findOne({
        $and: [
            {
                $or: [
                    { requester: req.user.id, recipient: recipientId },
                    { requester: recipientId, recipient: req.user.id }
                ]
            },
            {
                $or: [
                    { type: 'friend' },
                    { type: { $exists: false } },
                    { type: null }
                ]
            }
        ]
    });
    if (existing) return res.status(400).json({ error: 'Request already exists' });

    const request = await Friend.create({ requester: req.user.id, recipient: recipientId });
    res.json(request);
});

// Get pending incoming requests
router.get('/pending', auth, async (req, res) => {
    const requests = await Friend.find({
        recipient: req.user.id,
        status: 'pending'
    }).populate('requester', 'username').lean(); // .lean() returns plain objects with all fields
    res.json(requests);
});

// Accept or reject a request
router.post('/respond', auth, async (req, res) => {
    const { requestId, action } = req.body;
    if (!validId(requestId))
        return res.status(400).json({ error: 'Invalid request id' });
    if (action !== 'accepted' && action !== 'rejected')
        return res.status(400).json({ error: 'Invalid action' });
    const request = await Friend.findOneAndUpdate(
        { _id: requestId, recipient: req.user.id, status: 'pending' },
        { status: action },
        { new: true, runValidators: true }
    ).populate('requester', 'username');

    if (!request) return res.status(404).json({ error: 'Request not found' });

    if (request.type === 'watch' && action === 'accepted' && request.projectId) {
        const [recipient, requester] = await Promise.all([
            User.findById(req.user.id),
            User.findById(request.requester._id)
        ]);

        // Handle recipient's entry
        let recipientEntry = recipient.watchedProjects.find(e => e.projectId === request.projectId);
        if (!recipientEntry) {
            recipient.watchedProjects.push({
                projectId: request.projectId,
                count: 1,
                watchedWith: [request.requester.username],
                memories: []
            });
        } else {
            // Increment count for recipient
            recipientEntry.count += 1;
            if (!recipientEntry.watchedWith.includes(request.requester.username)) {
                recipientEntry.watchedWith.push(request.requester.username);
            }
        }

        // Handle requester's entry
        let requesterEntry = requester.watchedProjects.find(e => e.projectId === request.projectId);
        if (requesterEntry) {
            // Increment count for requester too
            requesterEntry.count += 1;
            if (!requesterEntry.watchedWith.includes(recipient.username)) {
                requesterEntry.watchedWith.push(recipient.username);
            }
        } else {
            requester.watchedProjects.push({
                projectId: request.projectId,
                count: 1,
                watchedWith: [recipient.username],
                memories: []
            });
        }

        await Promise.all([recipient.save(), requester.save()]);

        // Delete the watch request entirely instead of keeping it as accepted
        // This prevents it from ever showing in friend lists
        await Friend.findByIdAndDelete(request._id);
    }

    res.json(request);
});

// Get accepted friends list
router.get('/list', auth, async (req, res) => {
    const friends = await Friend.find({
        $and: [
            {
                $or: [{ requester: req.user.id }, { recipient: req.user.id }]
            },
            { status: 'accepted' },
            {
                $or: [
                    { type: 'friend' },
                    { type: { $exists: false } },
                    { type: null }
                ]
            }
        ]
    }).populate('requester recipient', 'username');

    const list = friends.map(f => {
        const friend = f.requester._id.toString() === req.user.id
            ? f.recipient
            : f.requester;
        return { id: friend._id, username: friend.username };
    });
    res.json(list);
});

// View a friend's progress
router.get('/progress/:friendId', auth, async (req, res) => {
    if (!validId(req.params.friendId))
        return res.status(400).json({ error: 'Invalid friend id' });
    try {
        const friendship = await Friend.findOne({
            $and: [
                {
                    $or: [
                        { requester: req.user.id, recipient: req.params.friendId },
                        { requester: req.params.friendId, recipient: req.user.id }
                    ]
                },
                { status: 'accepted' },
                {
                    $or: [
                        { type: 'friend' },
                        { type: { $exists: false } },
                        { type: null }
                    ]
                }
            ]
        });
        if (!friendship) return res.status(403).json({ error: 'Not friends' });

        const friend = await User.findById(req.params.friendId)
            .select('username watchedProjects walkers');
        if (!friend) return res.status(404).json({ error: 'User not found' });

        // Normalize data shape — handle both old string array and new object array
        const watchedProjects = friend.watchedProjects.map(entry => {
            if (typeof entry === 'string') {
                return { projectId: entry, count: 1, watchedWith: [], memories: [] };
            }
            return {
                projectId: entry.projectId,
                count: entry.count || 1,
                watchedWith: entry.watchedWith || [],
                memories: entry.memories || []
            };
        });

        res.json({ username: friend.username, watchedProjects, walkers: friend.walkers || [] });
    } catch (e) {
        console.error('Progress route error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// Send a "watched with friend" request
router.post('/watch-request', auth, async (req, res) => {
    const { recipientId, projectId, projectTitle } = req.body;
    if (!validId(recipientId))
        return res.status(400).json({ error: 'Invalid recipient' });
    if (typeof projectId !== 'string' || !projectId.trim())
        return res.status(400).json({ error: 'Invalid project id' });
    if (projectTitle != null && typeof projectTitle !== 'string')
        return res.status(400).json({ error: 'Invalid project title' });

    const friendship = await Friend.findOne({
        $and: [
            {
                $or: [
                    { requester: req.user.id, recipient: recipientId },
                    { requester: recipientId, recipient: req.user.id }
                ]
            },
            { status: 'accepted' },
            {
                $or: [
                    { type: 'friend' },
                    { type: { $exists: false } },
                    { type: null }
                ]
            }
        ]
    });

    if (!friendship) return res.status(403).json({ error: 'Not friends' });

    const existing = await Friend.findOne({
        requester: req.user.id,
        recipient: recipientId,
        status: 'pending',
        type: 'watch',
        projectId
    });
    if (existing) return res.status(400).json({ error: 'Already sent' });

    await Friend.create({
        requester: req.user.id,
        recipient: recipientId,
        status: 'pending',
        type: 'watch',
        projectId,
        projectTitle // ← store it
    });

    res.json({ message: 'Request sent' });
});

router.delete('/remove/:friendId', auth, async (req, res) => {
    if (!validId(req.params.friendId))
        return res.status(400).json({ error: 'Invalid friend id' });
    try {
        const result = await Friend.findOneAndDelete({
            $and: [
                {
                    $or: [
                        { requester: req.user.id, recipient: req.params.friendId },
                        { requester: req.params.friendId, recipient: req.user.id }
                    ]
                },
                {
                    $or: [
                        { type: 'friend' },
                        { type: { $exists: false } },
                        { type: null }
                    ]
                }
            ]
        });
        if (!result) return res.status(404).json({ error: 'Friendship not found' });
        res.json({ message: 'Friend removed' });
    } catch (e) {
        console.error('Remove friend error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;