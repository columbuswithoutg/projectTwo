// Single source of truth for "are these two users friends?" queries.
//
// Friend docs carry a `type` of 'friend' or 'watch' (a watch-party request
// reuses the same collection). Docs created before `type` existed have no
// field at all, so a friendship match must accept 'friend', missing, or
// null. That three-way clause used to be copy-pasted seven times across
// routes/friends.js and routes/feed.js; keep it here and nowhere else.
const Friend = require('../models/Friend');

const FRIEND_TYPE = Object.freeze({
    $or: [{ type: 'friend' }, { type: { $exists: false } }, { type: null }]
});

// Build the Mongo filter for a friendship.
//   friendFilter(me)            -> every friendship `me` is part of
//   friendFilter(me, other)     -> the single friendship between the pair
// Both forms require status:'accepted' unless { accepted: false } is passed
// (used by "does a request already exist?" and "remove friend", which must
// also match pending / rejected docs).
function friendFilter(userId, otherId, { accepted = true } = {}) {
    if (userId == null) throw new TypeError('friendFilter: userId is required');
    const sides = otherId == null
        ? { $or: [{ requester: userId }, { recipient: userId }] }
        : { $or: [
            { requester: userId, recipient: otherId },
            { requester: otherId, recipient: userId }
        ] };
    const and = [sides];
    if (accepted) and.push({ status: 'accepted' });
    and.push(FRIEND_TYPE);
    return { $and: and };
}

// Ids (as strings) of `userId` plus every accepted friend. Used by the feed
// (who can see a post) and the /stones leaderboard (who is ranked).
async function getFriendIds(userId) {
    const docs = await Friend.find(friendFilter(userId))
        .select('requester recipient')
        .lean();
    const ids = new Set([String(userId)]);
    for (const f of docs) {
        ids.add(String(f.requester));
        ids.add(String(f.recipient));
    }
    return ids;
}

module.exports = { FRIEND_TYPE, friendFilter, getFriendIds };
