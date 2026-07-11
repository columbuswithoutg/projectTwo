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

// Atomically add a co-watch for a user on a project. Two writes:
//   1. Try to increment an existing entry and $addToSet the co-watcher name.
//   2. If no entry existed, $push a new one, guarding with $ne so a
//      concurrent /watch click can't leave us with duplicate entries.
// Both writes are single commands, so they can't interleave the way the
// previous findById-mutate-save flow did.
async function applyCoWatch(userId, projectId, coWatcherUsername) {
    const incremented = await User.updateOne(
        { _id: userId, 'watchedProjects.projectId': projectId },
        {
            $inc: { 'watchedProjects.$.count': 1 },
            $addToSet: { 'watchedProjects.$.watchedWith': coWatcherUsername }
        }
    );
    if (incremented.modifiedCount > 0) return;

    await User.updateOne(
        { _id: userId, 'watchedProjects.projectId': { $ne: projectId } },
        {
            $push: {
                watchedProjects: {
                    projectId,
                    count: 1,
                    watchedWith: [coWatcherUsername],
                    memories: []
                }
            }
        }
    );
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
        // Both sides need the other user's username for the watchedWith array.
        // Look them up once, then apply all mutations atomically via $inc /
        // $push / $addToSet so concurrent regular /watch clicks can't lose
        // the increment (the previous find-mutate-save pattern did).
        const requesterUsername = request.requester.username;
        const recipient = await User.findById(req.user.id).select('username');
        if (!recipient) return res.status(404).json({ error: 'User not found' });
        const recipientUsername = recipient.username;
        const projectId = request.projectId;

        await Promise.all([
            applyCoWatch(req.user.id, projectId, requesterUsername),
            applyCoWatch(request.requester._id, projectId, recipientUsername)
        ]);

        // Delete the watch request entirely instead of keeping it as accepted.
        // This prevents it from ever showing in friend lists.
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

// Infinity Stone SNAP leaderboard — self + accepted friends ranked by
// lifetime snaps performed in the shared /world contest. One Friend query
// + one User projection query.
router.get('/stones', auth, async (req, res) => {
    const friendDocs = await Friend.find({
        $and: [
            { $or: [{ requester: req.user.id }, { recipient: req.user.id }] },
            { status: 'accepted' },
            { $or: [{ type: 'friend' }, { type: { $exists: false } }, { type: null }] }
        ]
    }).select('requester recipient');

    const ids = new Set([req.user.id]);
    for (const f of friendDocs) {
        ids.add(String(f.requester));
        ids.add(String(f.recipient));
    }

    const users = await User.find({ _id: { $in: [...ids] } })
        .select('username stoneSnaps');

    const rows = users.map(u => ({
        username: u.username,
        you: String(u._id) === req.user.id,
        snaps: Number.isFinite(u.stoneSnaps) ? u.stoneSnaps : 0
    }));
    rows.sort((a, b) => b.snaps - a.snaps || a.username.localeCompare(b.username));
    res.json(rows);
});

// View a friend's progress
// Username-keyed lookup used by the dedicated /friend/:username SPA routes.
// Resolves the username to an _id, verifies friendship, and returns the
// same payload as /progress/:friendId (plus profilePicture so the friend
// profile tab can show their avatar). 404 for unknown user, 403 for not-
// friends — the SPA treats both as a generic 404 visit page.
router.get('/by-username/:username', auth, async (req, res) => {
    const username = String(req.params.username || '').trim();
    if (!username || username.length > 40) {
        return res.status(404).json({ error: 'User not found' });
    }
    try {
        const friend = await User.findOne({ username })
            .select('_id username profilePicture watchedProjects walkers homeLayout homeCharacter');
        if (!friend) return res.status(404).json({ error: 'User not found' });

        const friendship = await Friend.findOne({
            $and: [
                { $or: [
                    { requester: req.user.id, recipient: friend._id },
                    { requester: friend._id, recipient: req.user.id }
                ] },
                { status: 'accepted' },
                { $or: [
                    { type: 'friend' },
                    { type: { $exists: false } },
                    { type: null }
                ] }
            ]
        });
        if (!friendship) return res.status(403).json({ error: 'Not friends' });

        const watchedProjects = (friend.watchedProjects || []).map(entry => {
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

        res.json({
            id: friend._id,
            username: friend.username,
            profilePicture: friend.profilePicture || '',
            watchedProjects,
            walkers: friend.walkers || [],
            homeLayout: friend.homeLayout || { rooms: [] },
            homeCharacter: friend.homeCharacter || null
        });
    } catch (err) {
        console.error('by-username error', err);
        res.status(500).json({ error: 'Server error' });
    }
});

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
            .select('username watchedProjects walkers homeLayout homeCharacter');
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

        res.json({
            username: friend.username,
            watchedProjects,
            walkers: friend.walkers || [],
            homeLayout: friend.homeLayout || { rooms: [] },
            homeCharacter: friend.homeCharacter || null
        });
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

    try {
        await Friend.create({
            requester: req.user.id,
            recipient: recipientId,
            status: 'pending',
            type: 'watch',
            projectId,
            projectTitle
        });
    } catch (e) {
        // Partial unique index races with rapid double-clicks — the findOne
        // above can miss a concurrent insert. Treat the duplicate as success
        // from the client's perspective: their intent is already persisted.
        if (e && e.code === 11000) return res.status(400).json({ error: 'Already sent' });
        throw e;
    }

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