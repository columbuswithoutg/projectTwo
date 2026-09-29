const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const User = require('../models/user');
const Friend = require('../models/Friend');
const { friendFilter, getFriendIds } = require('../server/friendship');
const auth = require('../middleware/auth');
const feed = require('../server/feed');
const watchRules = require('../server/watchRules');
const { housesForRooms, homeRoofFor, effectiveLayout, watchedIdsOf } = require('../server/house');

// Escape regex metacharacters so a user can't pass ".*" to dump everyone
// or "(a+)+$" to hang the DB with catastrophic backtracking (ReDoS).
function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const FRIEND_RETRY_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
// Friend-request docs only (watch-party requests share the collection).
const FRIEND_ONLY = { $or: [{ type: 'friend' }, { type: { $exists: false } }, { type: null }] };

// Reject non-ObjectId params up-front so Mongoose can't be tricked by
// `{ $ne: null }` / operator-injection and doesn't throw on malformed IDs.
function validId(id) {
    return typeof id === 'string' && mongoose.isValidObjectId(id);
}

// Tag a co-watcher on a user's existing watch of a project. This only adds
// the name — it never creates a watch or bumps the count, because watches
// come solely from finishing a timed session (POST /api/progress/complete).
// A user who hasn't watched the project yet simply isn't tagged.
async function applyCoWatch(userId, projectId, coWatcherUsername) {
    await User.updateOne(
        { _id: userId, 'watchedProjects.projectId': projectId },
        { $addToSet: { 'watchedProjects.$.watchedWith': coWatcherUsername } }
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
    const { recipientId } = req.body || {};
    if (!validId(recipientId))
        return res.status(400).json({ error: 'Invalid recipient' });
    if (recipientId === req.user.id)
        return res.status(400).json({ error: "You can't add yourself" });
    const recipientExists = await User.exists({ _id: recipientId });
    if (!recipientExists)
        return res.status(404).json({ error: 'User not found' });

    // A rejected request doesn't count — otherwise one "no" blocks the pair forever.
    const existing = await Friend.findOne({
        ...friendFilter(req.user.id, recipientId, { accepted: false }),
        status: { $ne: 'rejected' }
    });
    if (existing) return res.status(400).json({ error: 'Request already exists' });

    // Cooldown after a "no": the same person can't re-ask for a week, so a
    // declined request can't be resent over and over. (Only requests THIS
    // user sent count — the other side can still add them any time.)
    const declined = await Friend.findOne({
        requester: req.user.id, recipient: recipientId, status: 'rejected',
        updatedAt: { $gte: new Date(Date.now() - FRIEND_RETRY_COOLDOWN_MS) },
        ...FRIEND_ONLY
    }).sort({ updatedAt: -1 }).select('updatedAt').lean();
    if (declined) {
        const days = Math.ceil((declined.updatedAt.getTime() + FRIEND_RETRY_COOLDOWN_MS - Date.now()) / 86400000);
        return res.status(429).json({ error: `They declined your last request — you can ask again in ${days} day${days !== 1 ? 's' : ''}` });
    }

    const request = await Friend.create({ requester: req.user.id, recipient: recipientId });

    // The check above races with a double-click / second tab / the other
    // user sending at the same moment, and there's no unique index for
    // friend docs. Settle it after the fact: keep the oldest live doc for the
    // pair (an accepted friendship beats any pending one) and drop the rest.
    const live = await Friend.find({
        ...friendFilter(req.user.id, recipientId, { accepted: false }),
        status: { $ne: 'rejected' }
    }).sort({ status: 1, _id: 1 }).select('_id status').lean(); // 'accepted' < 'pending'
    if (live.length > 1) {
        await Friend.deleteMany({ _id: { $in: live.slice(1).map(d => d._id) } });
        if (String(live[0]._id) !== String(request._id)) {
            return res.status(400).json({ error: 'Request already exists' });
        }
    }
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
    const { requestId, action } = req.body || {};
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
        const requesterUsername = request.requester.username;
        const recipient = await User.findById(req.user.id).select('username watchedProjects.projectId').lean();
        if (!recipient) return res.status(404).json({ error: 'User not found' });
        const recipientUsername = recipient.username;
        const projectId = request.projectId;

        // Delete the watch request entirely instead of keeping it as accepted.
        // This prevents it from ever showing in friend lists.
        await Friend.findByIdAndDelete(request._id);

        // "Watched with" is only true if BOTH have watched it. If the
        // recipient hasn't finished it yet, tag nobody (and post nothing) —
        // otherwise the requester's post would claim a co-watch that never
        // happened. Watches themselves only come from the timed flow.
        // ...and only between people who are still friends (the pair may have
        // unfriended since the request was sent).
        const stillFriends = await Friend.exists(friendFilter(req.user.id, request.requester._id));
        const recipientWatched = !!stillFriends &&
            (recipient.watchedProjects || []).some(e => e.projectId === projectId);

        // Tag from the post composer: accepting IS the recipient confirming
        // "we watched this together", so the tag goes on that exact post
        // (a single episode, possibly) even before they've finished the whole
        // project themselves. Their own progress still needs the timed flow;
        // the requester's project entry gets the co-watcher name too, and the
        // recipient's only once they've watched it.
        if (request.postId) {
            let tagged = false;
            if (stillFriends) {
                tagged = await feed.tagPost(request.postId, { _id: recipient._id, username: recipientUsername })
                    .catch(err => { console.error('[friends] tagPost failed:', err && err.message); return false; });
                if (tagged) {
                    await applyCoWatch(request.requester._id, projectId, recipientUsername);
                    if (recipientWatched) await applyCoWatch(req.user.id, projectId, requesterUsername);
                }
            }
            return res.json({ ...request.toObject(), tagged: tagged && recipientWatched, taggedOnPost: tagged });
        }

        if (recipientWatched) {
            await Promise.all([
                applyCoWatch(req.user.id, projectId, requesterUsername),
                applyCoWatch(request.requester._id, projectId, recipientUsername)
            ]);
            await feed.recordCoWatch(
                { _id: request.requester._id, username: requesterUsername },
                { _id: recipient._id, username: recipientUsername },
                projectId
            );
        }
        return res.json({ ...request.toObject(), tagged: recipientWatched });
    }

    res.json(request);
});

// Get accepted friends list
router.get('/list', auth, async (req, res) => {
    const friends = await Friend.find(friendFilter(req.user.id))
        .populate('requester recipient', 'username');

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
    const ids = await getFriendIds(req.user.id);

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
            .select('_id username profilePicture watchedProjects walkers homeLayout homeCharacter homeHouses homeRoof');
        if (!friend) return res.status(404).json({ error: 'User not found' });

        const friendship = await Friend.findOne(friendFilter(req.user.id, friend._id));
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

        // The home as it may be shown today (watched rooms within the cap).
        const shownLayout = effectiveLayout(friend.homeLayout, watchedIdsOf(friend));
        res.json({
            id: friend._id,
            username: friend.username,
            profilePicture: friend.profilePicture || '',
            watchedProjects,
            walkers: friend.walkers || [],
            homeLayout: shownLayout,
            homeCharacter: friend.homeCharacter || null,
            // Read-only here: only the owner can save a room (routes/profile.js).
            homeHouses: housesForRooms(friend.homeHouses, shownLayout.rooms),
            homeRoof: homeRoofFor(friend, shownLayout.rooms)
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
        const friendship = await Friend.findOne(friendFilter(req.user.id, req.params.friendId));
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
            homeLayout: effectiveLayout(friend.homeLayout, watchedIdsOf(friend)),
            homeCharacter: friend.homeCharacter || null
        });
    } catch (e) {
        console.error('Progress route error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// Send a "watched with friend" request
router.post('/watch-request', auth, async (req, res) => {
    const { recipientId, projectId } = req.body || {};
    if (!validId(recipientId))
        return res.status(400).json({ error: 'Invalid recipient' });
    if (typeof projectId !== 'string' || !projectId.trim() || projectId.length > 80)
        return res.status(400).json({ error: 'Invalid project id' });
    // Title comes from our own content, not the client — it's shown to the
    // recipient ("wants to watch <title> together").
    const project = await watchRules.getProject(projectId);
    if (!project) return res.status(404).json({ error: 'Unknown project' });
    const projectTitle = String(project.title || projectId).slice(0, 200);

    const friendship = await Friend.findOne(friendFilter(req.user.id, recipientId));

    if (!friendship) return res.status(403).json({ error: 'Not friends' });

    // "Watched with a friend" tags a finished watch — it can't stand in for
    // the Start watching → Mark as watched timer.
    const watchedIt = await User.exists({ _id: req.user.id, 'watchedProjects.projectId': projectId });
    if (!watchedIt) return res.status(400).json({ error: 'Finish watching it first' });

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
        // Accepted friendships only — a leftover rejected request between the
        // pair used to be deleted instead, while reporting "Friend removed".
        // deleteMany also clears any duplicate friendship docs in one go, and
        // pending watch-party requests between the pair go with it (they
        // could otherwise still be accepted after unfriending).
        const result = await Friend.deleteMany(friendFilter(req.user.id, req.params.friendId));
        if (!result.deletedCount) return res.status(404).json({ error: 'Friendship not found' });
        await Friend.deleteMany({
            status: 'pending', type: 'watch',
            $or: [
                { requester: req.user.id, recipient: req.params.friendId },
                { requester: req.params.friendId, recipient: req.user.id }
            ]
        });
        res.json({ message: 'Friend removed' });
    } catch (e) {
        console.error('Remove friend error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;