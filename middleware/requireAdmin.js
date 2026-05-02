const User = require('../models/user');
const auth = require('./auth');

// Composes the base auth middleware (which already validates the JWT,
// tokenVersion, and banned state) with a fresh DB read of isAdmin. We do
// not trust the JWT's isAdmin claim alone — an admin demoted in Mongo
// would otherwise retain admin powers for up to 7 days until their token
// expires.
function requireAdmin(req, res, next) {
  auth(req, res, async (err) => {
    if (err) return next(err);
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    let user;
    try {
      user = await User.findById(req.user.id).select('isAdmin username banned').lean();
    } catch {
      return res.status(500).json({ error: 'Server error' });
    }
    if (!user || !user.isAdmin || user.banned) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    req.adminUser = { id: req.user.id, username: user.username };
    next();
  });
}

module.exports = requireAdmin;
