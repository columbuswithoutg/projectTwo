// Shared memory (photo/video) validation for routes/progress.js and
// routes/feed.js.
//
// Memory URLs must be this app's own Cloudinary uploads (server/cloudinary-url.js
// isOurAssetUrl: our cloud, /image|video/upload/, our folder — not a fetch
// proxy or a transformation). An attacker who can POST a memory should not be
// able to embed arbitrary remote content into the viewer's page.
const { isOurAssetUrl } = require('./cloudinary-url');
const MAX_MEMORY_CAPTION_LEN = 280;

function sanitizeMemory(m) {
  if (!m || typeof m !== 'object') return null;
  if (!isOurAssetUrl(m.url)) return null;
  const type = (m.type === 'video' || m.type === 'image') ? m.type : 'image';
  const caption = typeof m.caption === 'string' ? m.caption.slice(0, MAX_MEMORY_CAPTION_LEN) : '';
  return { url: m.url, type, caption };
}

module.exports = { sanitizeMemory, MAX_MEMORY_CAPTION_LEN };
