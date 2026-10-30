/************************************************
 * js/post-composer.js: both signed-in calls (the avatar's GET /api/profile
 * and the edit-post PUT /api/feed/:id) go through Auth.fetch, so a revoked
 * session is ONE logout + /login?next= instead of a raw 401 toast and a lost
 * edit, and an expired token never goes out as "Bearer null" (CLI2-07).
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'post-composer.js'), 'utf8');

test('post-composer builds no Authorization header of its own', () => {
  assert.doesNotMatch(SRC, /Authorization\s*:/);
  assert.doesNotMatch(SRC, /Auth\.getToken\(\)/);
});

test('the profile GET and the edit-post PUT use Auth.fetch', () => {
  assert.match(SRC, /Auth\.fetch\(`\$\{API\}\/profile`/);
  assert.match(SRC, /Auth\.fetch\(`\$\{API\}\/feed\/\$\{opts\.post\.id\}`,\s*\{\s*method: 'PUT'/);
  // No bare fetch( left for either endpoint.
  assert.doesNotMatch(SRC, /(^|[^.\w])fetch\(`\$\{API\}\/(profile|feed)/m);
});
