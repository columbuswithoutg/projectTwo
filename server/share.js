// Doomsday story share — the server half (the client half is js/share.js and
// js/views/shared.js; the rules both sides use are js/share-logic.js).
//
// A user who shares gets a secret token; /s/<token> is a public page showing
// their Doomsday checklist and a read-only watch order. Nothing else about
// the account is exposed: username, profile picture and the ids of what they
// have watched. Turning the link off deletes the token.
//
//   findSharer(token)            the live, non-banned owner of a token (lean) or null
//   doomsdayFor(user)            { met, total } on Marvel's list for that user
//   publicPayload(user)          the JSON the share page reads
//   creditReferral(newId, token) "Start your own" sign-up: friend request to the sharer + count
//   injectMeta(html, meta)       spa.html with the link-preview tags for one share
//   sharePage(spaFile)           Express handler for GET /s/<token>[/map]
const fs = require('fs');
const User = require('../models/user');
const Friend = require('../models/Friend');
const watchRules = require('./watchRules');
const ShareLogic = require('../js/share-logic');

const SHARER_FIELDS = '_id username profilePicture watchedProjects.projectId';

async function findSharer(token) {
  if (!ShareLogic.isToken(token)) return null;
  return User.findOne({ shareToken: token, banned: { $ne: true } }).select(SHARER_FIELDS).lean();
}

function watchedIds(user) {
  return ((user && user.watchedProjects) || [])
    .map(e => (typeof e === 'string' ? e : e && e.projectId))
    .filter(id => typeof id === 'string');
}

async function doomsdayFor(user) {
  const all = await watchRules.allProjects();
  const p = ShareLogic.doomsdayProgress(watchedIds(user), id => all.has(id));
  return { met: p.met, total: p.total };
}

function publicPayload(user) {
  return {
    username: user.username,
    profilePicture: user.profilePicture || '',
    watched: [...new Set(watchedIds(user))]
  };
}

// The new account asks the sharer to be friends (the sharer decides — they
// shared a link, they didn't agree to befriend whoever signs up from it) and
// the sharer's join count goes up. A brand-new account has no friend docs,
// so there is nothing to de-duplicate. → the sharer's username, or null for
// a dead / unknown token (the sign-up itself has already succeeded).
async function creditReferral(newUserId, token) {
  const sharer = await findSharer(token);
  if (!sharer || String(sharer._id) === String(newUserId)) return null;
  await Friend.create({ requester: newUserId, recipient: sharer._id });
  await User.updateOne({ _id: sharer._id }, { $inc: { shareJoins: 1 } });
  return sharer.username;
}

function escAttr(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Swap spa.html's <title> for the share's title plus the Open Graph / Twitter
// tags that Facebook, Instagram DMs, iMessage etc. read for the link card.
// noindex: the link is secret, search engines have no business with it.
const TITLE_RE = /<title>[^<]*<\/title>/;
function injectMeta(html, meta) {
  const tags = [
    `<title>${escAttr(meta.title)}</title>`,
    `<meta name="description" content="${escAttr(meta.description)}" />`,
    '<meta name="robots" content="noindex, nofollow" />',
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="MCU Watch Order" />',
    `<meta property="og:title" content="${escAttr(meta.title)}" />`,
    `<meta property="og:description" content="${escAttr(meta.description)}" />`,
    `<meta property="og:url" content="${escAttr(meta.url)}" />`,
    `<meta property="og:image" content="${escAttr(meta.image)}" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    '<meta name="twitter:card" content="summary_large_image" />'
  ].join('\n  ');
  return TITLE_RE.test(html) ? html.replace(TITLE_RE, () => tags) : html.replace('</head>', () => tags + '\n</head>');
}

const OG_IMAGE = '/assets/share/og-doomsday.jpg';

function sharePage(spaFile) {
  // dist/spa.html, re-read only when a build rewrites it.
  let shell = null, shellMtime = 0;
  const readShell = () => {
    const mtime = fs.statSync(spaFile).mtimeMs;
    if (shell === null || mtime !== shellMtime) {
      shell = fs.readFileSync(spaFile, 'utf8');
      shellMtime = mtime;
    }
    return shell;
  };

  return async (req, res) => {
    const token = String(req.path.split('/')[2] || '');
    let user = null, progress = null;
    try {
      user = await findSharer(token);
      if (user) progress = await doomsdayFor(user);
    } catch (err) {
      console.error('[share] page lookup failed:', err && err.message);
    }
    const origin = `${req.protocol}://${req.get('host')}`;
    const text = ShareLogic.previewText(user, progress);
    // Live progress — never cached, so a crawler re-reading the link sees today's count.
    res.set('Cache-Control', 'no-store');
    res.type('html').send(injectMeta(readShell(), {
      ...text,
      url: `${origin}/s/${token}`,
      image: origin + OG_IMAGE
    }));
  };
}

module.exports = { findSharer, doomsdayFor, publicPayload, creditReferral, injectMeta, sharePage };
