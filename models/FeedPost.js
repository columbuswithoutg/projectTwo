const mongoose = require('mongoose');

// One social-feed post per "watch session" of a project. Created server-side
// (never by the client directly) from the progress + watch-party routes —
// see server/feed.js. A post collects everything that happened in that
// session: who watched it together (participants) and any memories added, so
// the feed reads "kevin watched Iron Man with elsid · 2 memories" instead of
// three separate posts.
const CommentSchema = new mongoose.Schema({
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, maxlength: 500 }
}, { timestamps: true });

const FeedPostSchema = new mongoose.Schema({
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Author + everyone they watched with (who has an account). The feed shows
    // a post to friends of ANY participant, so a watch party reaches both
    // friend circles.
    participants: { type: [mongoose.Schema.Types.ObjectId], ref: 'User', default: [] },
    projectId: { type: String, required: true, maxlength: 80 },
    // 'watch'  — started from a watch (optionally with memories added later
    //            in the same session).
    // 'memory' — a memory added outside any recent watch session.
    kind: { type: String, enum: ['watch', 'memory'], default: 'watch' },
    // The author's lifetime watch count for this project at post time —
    // drives "watched for the 3rd time".
    count: { type: Number, default: 1 },
    // Usernames, mirroring WatchEntry.watchedWith.
    watchedWith: { type: [String], default: [] },
    memories: {
        type: [{
            url: String,
            type: { type: String, enum: ['image', 'video'] },
            caption: { type: String, default: '' },
            // Uploader — a co-watcher can add a memory to the shared session.
            by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            _id: false
        }],
        default: []
    },
    comments: { type: [CommentSchema], default: [] },
    // Author-written text shown above the post ("Best one yet!"). Only the
    // author can set it — see PUT /api/feed/:id/caption.
    caption: { type: String, default: '', maxlength: 500 },
    // Facebook-style reactions, one per user. Keys mirror REACTION_TYPES in
    // routes/feed.js and js/views/feed.js.
    reactions: {
        type: [{
            user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
            type: { type: String, enum: ['like', 'love', 'haha', 'wow', 'sad', 'angry'], required: true },
            _id: false
        }],
        default: []
    },
    // Bumped whenever the post gains a memory or co-watcher, so an updated
    // session floats back up the feed.
    activityAt: { type: Date, default: Date.now }
}, { timestamps: true });

FeedPostSchema.index({ participants: 1, activityAt: -1 });
FeedPostSchema.index({ author: 1, projectId: 1, createdAt: -1 });

module.exports = mongoose.model('FeedPost', FeedPostSchema);
