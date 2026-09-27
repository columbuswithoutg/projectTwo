// Shared memory (photo/video) validation for routes/progress.js and
// routes/feed.js.
//
// Memory URLs must point at our own Cloudinary cloud — matches the profile
// picture whitelist. An attacker who can POST a memory should not be able to
// embed arbitrary tracker/phishing URLs into the viewer's page. A protocol-
// only check (https?://…) was not sufficient.
const MAX_URL_LEN = 512;
const MAX_MEMORY_CAPTION_LEN = 280;

function cloudinaryPrefix() {
  const name = process.env.CLOUDINARY_CLOUD_NAME || '';
  return name ? `https://res.cloudinary.com/${name}/` : '';
}

function sanitizeMemory(m) {
  if (!m || typeof m !== 'object') return null;
  if (typeof m.url !== 'string' || m.url.length === 0 || m.url.length > MAX_URL_LEN) return null;
  const prefix = cloudinaryPrefix();
  if (!prefix || !m.url.startsWith(prefix)) return null;
  // Real Cloudinary URLs never contain quotes, angle brackets or whitespace.
  if (/["'<>\s]/.test(m.url)) return null;
  const type = (m.type === 'video' || m.type === 'image') ? m.type : 'image';
  const caption = typeof m.caption === 'string' ? m.caption.slice(0, MAX_MEMORY_CAPTION_LEN) : '';
  return { url: m.url, type, caption };
}

module.exports = { sanitizeMemory, MAX_MEMORY_CAPTION_LEN };
