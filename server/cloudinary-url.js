/************************************************
 * server/cloudinary-url.js — "is this one of OUR uploads?"
 *
 * User-supplied media URLs (memories, profile pictures, house portraits)
 * used to pass with a prefix check: anything starting with
 * https://res.cloudinary.com/<cloud>/ was accepted. Cloudinary serves more
 * than uploads under that prefix — `/image/fetch/https://evil/x.png` proxies
 * any remote image, and transformation segments (`l_text:…`) render text —
 * so a prefix match let a user show arbitrary remote content as "their
 * photo" and spend the account's transformation quota doing it.
 *
 * isOurAssetUrl() accepts only a plain upload URL in one of our folders:
 *   https://res.cloudinary.com/<cloud>/(image|video)/upload/[v<n>/]<folder>/<id>.<ext>
 * parseAsset() reads resource_type + public_id back out of any upload URL on
 * our cloud (admin delete, scene stills — those live in their own folder).
 *
 * The cloud name is read per call (not at load) so tests and late dotenv
 * loads see it. Unit-tested in test/cloudinary-url.test.js.
 ************************************************/
const MAX_URL_LEN = 512;
const DEFAULT_FOLDERS = Object.freeze(['mcu-memories']);

function cloudName() {
  return process.env.CLOUDINARY_CLOUD_NAME || '';
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isOurAssetUrl(url, opts) {
  const folders = (opts && opts.folders) || DEFAULT_FOLDERS;
  const cloud = cloudName();
  if (!cloud) return false;
  if (typeof url !== 'string' || !url || url.length > MAX_URL_LEN) return false;
  // Real upload URLs never carry quotes, brackets, whitespace, a query or a
  // fragment, and never a ".." or a doubled slash after the host.
  if (/["'<>\s?#]/.test(url) || url.includes('..') || url.indexOf('//', 8) !== -1) return false;
  const re = new RegExp(
    '^https://res\\.cloudinary\\.com/' + escapeRegex(cloud) +
    '/(image|video)/upload/(v\\d+/)?(' + folders.map(escapeRegex).join('|') + ')/[A-Za-z0-9_\\-/]+\\.[A-Za-z0-9]{2,5}$'
  );
  return re.test(url);
}

// { resource_type, public_id } for any versioned upload URL on OUR cloud
// (the shape CloudinaryStorage / upload_stream return), else null. Folders
// are not restricted here: scene stills and memories both pass.
function parseAsset(url) {
  const cloud = cloudName();
  if (!cloud || typeof url !== 'string' || url.length > MAX_URL_LEN) return null;
  const m = url.match(new RegExp(
    '^https://res\\.cloudinary\\.com/' + escapeRegex(cloud) + '/(image|video|raw)/upload/(?:[^/]+/)*v\\d+/(.+?)\\.[^./]+$'
  ));
  if (!m) return null;
  return { resource_type: m[1], public_id: m[2] };
}

module.exports = { isOurAssetUrl, parseAsset };
