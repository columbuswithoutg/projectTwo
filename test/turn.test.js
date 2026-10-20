const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const T = require('../server/turn');

test('nothing configured → STUN only; URLs split and trimmed', () => {
  const list = T.iceServers({}, 'u1', 0);
  assert.equal(list.length, 2);
  assert.ok(list.every(s => s.urls.startsWith('stun:')));
  assert.deepEqual(T.turnUrls({ TURN_URLS: ' turn:a:80 , turn:b:443?transport=tcp,, ' }), ['turn:a:80', 'turn:b:443?transport=tcp']);
  // URLs without any credential are not handed out.
  assert.equal(T.iceServers({ TURN_URLS: 'turn:a:80' }, 'u1', 0).length, 2);
});

test('static credentials are passed through unchanged', () => {
  const list = T.iceServers({ TURN_URLS: 'turn:a:80', TURN_USERNAME: 'me', TURN_CREDENTIAL: 'pw' }, 'u1', 0);
  assert.deepEqual(list[2], { urls: ['turn:a:80'], username: 'me', credential: 'pw' });
});

test('TURN_SECRET → time-limited HMAC credentials (coturn use-auth-secret)', () => {
  const env = { TURN_URLS: 'turn:a:80', TURN_SECRET: 's3cret', TURN_TTL_SEC: '600', TURN_USERNAME: 'ignored', TURN_CREDENTIAL: 'ignored' };
  const now = 1_700_000_000_000;
  const list = T.iceServers(env, 'abc', now);
  const t = list[2];
  assert.deepEqual(t.urls, ['turn:a:80']);
  assert.equal(t.username, `${Math.floor(now / 1000) + 600}:abc`);
  assert.equal(t.credential, crypto.createHmac('sha1', 's3cret').update(t.username).digest('base64'));
  // Default TTL when unset / junk.
  assert.equal(T.iceServers({ TURN_URLS: 'turn:a:80', TURN_SECRET: 'x' }, 'u', now)[2].username, `${Math.floor(now / 1000) + T.DEFAULT_TTL_SEC}:u`);
  assert.equal(T.iceServers({ TURN_URLS: 'turn:a:80', TURN_SECRET: 'x', TURN_TTL_SEC: 'soon' }, 'u', now)[2].username, `${Math.floor(now / 1000) + T.DEFAULT_TTL_SEC}:u`);
});
