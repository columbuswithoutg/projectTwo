/************************************************
 * server/boot-checks.js — what server.js checks before it starts.
 *
 * Pure decisions over an env object (process.env in server.js, a plain
 * object in test/boot-checks.test.js), so the rules are covered without
 * booting the server:
 *   - requiredMissing(): vars without which the process must not start.
 *     MONGO_URI + JWT_SECRET always; the three Cloudinary vars too in
 *     production, where a missing one silently breaks every upload and
 *     makes server/cloudinary-url.js reject every memory/profile/portrait
 *     URL as "must be uploaded through the app".
 *   - warnMissing(): the Cloudinary vars in development — dev and the QA
 *     recipes run with only MONGO_URI/JWT_SECRET, so they only get a warning.
 *   - usePublicDns(): whether to force Google DNS (the local-dev SRV lookup
 *     workaround). Off in production unless FORCE_PUBLIC_DNS=1.
 ************************************************/
const ALWAYS_REQUIRED = Object.freeze(['MONGO_URI', 'JWT_SECRET']);
const CLOUDINARY_VARS = Object.freeze(['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']);

function isProd(env) { return env.NODE_ENV === 'production'; }
function missing(env, keys) { return keys.filter(k => !env[k]); }

function requiredMissing(env) {
  return missing(env, isProd(env) ? [...ALWAYS_REQUIRED, ...CLOUDINARY_VARS] : ALWAYS_REQUIRED);
}
function warnMissing(env) {
  return isProd(env) ? [] : missing(env, CLOUDINARY_VARS);
}
function usePublicDns(env) {
  const flag = String(env.FORCE_PUBLIC_DNS || '').trim().toLowerCase();
  return !isProd(env) || flag === '1' || flag === 'true';
}

module.exports = { requiredMissing, warnMissing, usePublicDns };
