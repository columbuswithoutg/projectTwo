const mongoose = require('mongoose');

const WatchEntrySchema = new mongoose.Schema({
  projectId: { type: String, required: true },
  count: { type: Number, default: 1 },
  watchedWith: [{ type: String, default: [] }], // stores usernames
  memories: [{
    url: { type: String },
    type: { type: String, enum: ['image', 'video'] },
    caption: { type: String, default: '' },
    uploadedAt: { type: Date, default: Date.now }
  }]
}, { _id: false });

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  watchedProjects: { type: [WatchEntrySchema], default: [] }
});

module.exports = mongoose.model('User', UserSchema);