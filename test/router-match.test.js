const test = require('node:test');
const assert = require('node:assert/strict');
// router.js is a classic script; it only touches `document`/`history` inside
// init()/navigate(), so requiring it under Node is safe.
const Router = require('../js/router');
const { normalizePath, matchPatternIn } = Router._debug;

const routes = ['/friend/:username', '/friend/:username/map'].map(p => ({ pattern: p, view: p, parts: p.split('/') }));

test('matchPatternIn: captures and decodes params, picks the pattern with the right segment count', () => {
  const m = matchPatternIn(routes, '/friend/kev%20in');
  assert.equal(m.route.pattern, '/friend/:username');
  assert.deepEqual(m.params, { username: 'kev in' });
  const m2 = matchPatternIn(routes, '/friend/elsid/map');
  assert.equal(m2.route.pattern, '/friend/:username/map');
  assert.deepEqual(m2.params, { username: 'elsid' });
});

test('matchPatternIn: malformed escape, empty param or literal mismatch → no match (never throws)', () => {
  assert.doesNotThrow(() => matchPatternIn(routes, '/friend/%E0%A4%A'));
  assert.equal(matchPatternIn(routes, '/friend/%E0%A4%A'), null);
  assert.equal(matchPatternIn(routes, '/friend/%E0%A4%A/map'), null);
  assert.equal(matchPatternIn(routes, '/friend/'), null);
  assert.equal(matchPatternIn(routes, '/friends/kevin'), null);
  assert.equal(matchPatternIn(routes, '/friend/kevin/home'), null);
  assert.equal(matchPatternIn([], '/friend/kevin'), null);
});

test('normalizePath: trailing slashes, .html, /index and the root', () => {
  assert.deepEqual(normalizePath('/profile/'), { path: '/profile', search: '', hash: '' });
  assert.deepEqual(normalizePath('/profile///'), { path: '/profile', search: '', hash: '' });
  assert.equal(normalizePath('/').path, '/');
  assert.equal(normalizePath('').path, '/');
  assert.equal(normalizePath('/index').path, '/');
  assert.equal(normalizePath('/index.html').path, '/');
  assert.equal(normalizePath('/board.html').path, '/board');
});

test('normalizePath: query + hash are split off and kept; bare ? and # dropped', () => {
  assert.deepEqual(normalizePath('/messages?with=a#m1'), { path: '/messages', search: '?with=a', hash: '#m1' });
  assert.deepEqual(normalizePath('/reports/?focus=x'), { path: '/reports', search: '?focus=x', hash: '' });
  assert.deepEqual(normalizePath('/feed#top'), { path: '/feed', search: '', hash: '#top' });
  assert.deepEqual(normalizePath('/feed?#'), { path: '/feed', search: '', hash: '' });
  // A "?" inside the hash belongs to the hash.
  assert.deepEqual(normalizePath('/a#b?c'), { path: '/a', search: '', hash: '#b?c' });
});
