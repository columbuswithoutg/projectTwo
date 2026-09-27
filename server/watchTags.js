// "Watched with" tags from the post composer (js/post-composer.js).
//
// Tagging a friend never writes their name straight onto the post: it sends
// them a watch-party request tied to that post, and the tag appears once they
// accept (routes/friends.js /respond). That keeps "watched with X" something
// X agreed to.
const mongoose = require('mongoose');
const Friend = require('../models/Friend');
const { friendFilter } = require('./friendship');

const MAX_TAGS = 10;

// Keep only valid, distinct ObjectId strings (not yourself), capped.
function cleanFriendIds(raw, selfId) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const v of raw) {
        if (typeof v !== 'string' || !mongoose.isValidObjectId(v) || v === String(selfId) || out.includes(v)) continue;
        out.push(v);
        if (out.length >= MAX_TAGS) break;
    }
    return out;
}

// Send (or re-point) a pending tag request to each friend. Non-friends are
// skipped. One pending request per (requester, recipient, project) is all
// the DB index allows, so a newer post takes over an older pending one.
// Returns the ids actually sent to.
async function sendTags({ userId, projectId, projectTitle, postId, episode = null, friendIds }) {
    const sent = [];
    for (const fid of friendIds) {
        const friends = await Friend.exists(friendFilter(userId, fid));
        if (!friends) continue;
        try {
            await Friend.findOneAndUpdate(
                { requester: userId, recipient: fid, type: 'watch', status: 'pending', projectId },
                { $set: { projectTitle, postId, episode } },
                { upsert: true, setDefaultsOnInsert: true }
            );
            sent.push(fid);
        } catch (e) {
            // Parallel upsert lost the unique-index race — the other one won.
            if (!(e && e.code === 11000)) throw e;
            sent.push(fid);
        }
    }
    return sent;
}

module.exports = { MAX_TAGS, cleanFriendIds, sendTags };
