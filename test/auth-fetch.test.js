/************************************************
 * Unit tests for Auth.fetch / Auth.endSession (js/auth.js): the one wrapper
 * every signed-in API call goes through. It must add a fresh Bearer token,
 * turn a missing/expired token or a 401 into ONE logout + /login?next=
 * redirect (never a storm, never an error for the caller to toast), and
 * leave every other response to the caller.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'auth.js'), 'utf8');

// base64url JWT with the given exp (seconds); signature is irrelevant client-side.
function jwt(exp) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256' })}.${b64({ id: 'u1', exp })}.sig`;
}
const FRESH = () => jwt(Math.floor(Date.now() / 1000) + 3600);
const EXPIRED = () => jwt(Math.floor(Date.now() / 1000) - 3600);

// Fresh sandbox per test: auth.js + stubbed localStorage / fetch / Router.
function load({ token = null, status = 200, path: here = '/board', search = '?x=1', withPublic = false } = {}) {
  const store = new Map();
  if (token) store.set('mcu_token', token);
  const calls = [], routes = [];
  const ctx = {
    API: '/api',
    console,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    escape,
    location: { pathname: here, search },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    },
    fetch: (url, opts) => {
      calls.push({ url, opts });
      return Promise.resolve({ status: typeof status === 'function' ? status(url) : status, ok: status === 200 });
    },
    Router: { go: (to) => routes.push(to) }
  };
  // The real router's public-route rule (js/router.js isPublic).
  if (withPublic) ctx.Router._debug = { isPublic: (p) => p === '/login' || p.startsWith('/s/') };
  const badge = [];
  ctx.MessagesBadge = { apply: (n) => badge.push(n) };
  vm.createContext(ctx);
  vm.runInContext(SRC + '\nthis.Auth = Auth;', ctx);
  return { Auth: ctx.Auth, calls, routes, store, badge };
}
// Settled within a few ticks, or 'pending'.
const settle = (p) => Promise.race([p.then(v => ({ v }), e => ({ e })), new Promise(r => setTimeout(() => r('pending'), 20))]);
const apiCalls = (calls) => calls.filter(c => !c.url.endsWith('/auth/logout'));

test('adds a fresh Bearer token and keeps the caller\'s headers and options', async () => {
  const t = FRESH();
  const { Auth, calls, routes } = load({ token: t });
  const res = await Auth.fetch('/api/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.keepalive, true);
  assert.equal(calls[0].opts.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer ' + t);
  assert.deepEqual(routes, []);
});

test('non-401 errors are handed back to the caller untouched', async () => {
  const { Auth, routes } = load({ token: FRESH(), status: 403 });
  const res = await Auth.fetch('/api/x');
  assert.equal(res.status, 403);
  assert.deepEqual(routes, []);
});

test('a 401 logs out once, to /login?next=<this page>, and never settles', async () => {
  const { Auth, routes, store } = load({ token: FRESH(), status: 401 });
  const out = await settle(Auth.fetch('/api/x'));
  assert.equal(out, 'pending');
  assert.deepEqual(routes, ['/login?next=' + encodeURIComponent('/board?x=1')]);
  assert.equal(store.has('mcu_token'), false);
});

test('parallel 401s redirect exactly once (storm guard)', async () => {
  const { Auth, routes } = load({ token: FRESH(), status: 401 });
  const all = Promise.all([1, 2, 3, 4, 5].map(i => Auth.fetch('/api/x' + i)));
  assert.equal(await settle(all), 'pending');
  assert.equal(routes.length, 1);
});

test('an expired token never reaches the network as "Bearer null"', async () => {
  const { Auth, calls, routes } = load({ token: EXPIRED() });
  assert.equal(await settle(Auth.fetch('/api/x')), 'pending');
  assert.equal(apiCalls(calls).length, 0);
  assert.equal(routes.length, 1);
  assert.match(routes[0], /^\/login\?next=/);
});

test('sessionExpired() tells an expiry apart from never signing in / logging out', () => {
  const a = load({ token: EXPIRED() });
  assert.equal(a.Auth.isLoggedIn(), false);
  assert.equal(a.Auth.sessionExpired(), true);
  const b = load({});
  assert.equal(b.Auth.isLoggedIn(), false);
  assert.equal(b.Auth.sessionExpired(), false);
  const c = load({ token: FRESH() });
  c.Auth.clearToken();
  assert.equal(c.Auth.sessionExpired(), false);
});

test('a new sign-in re-arms the guard; a stale 401 for the old token is not a logout', async () => {
  const { Auth, routes, store } = load({ token: FRESH(), status: 401 });
  await settle(Auth.fetch('/api/x'));
  assert.equal(routes.length, 1);
  Auth.setToken(FRESH());
  assert.equal(Auth._sessionEnding, false);
  // A request sent with the old token answers 401 after the new sign-in.
  const oldToken = jwt(Math.floor(Date.now() / 1000) + 7200);
  store.set('mcu_token', oldToken);
  const p = Auth.fetch('/api/y');
  store.set('mcu_token', FRESH() + 'new');
  const out = await settle(p);
  assert.equal(out.v.status, 401);
  assert.equal(routes.length, 1);
});

test('on /login itself the redirect carries no next', async () => {
  const { Auth, routes } = load({ token: FRESH(), status: 401, path: '/login', search: '' });
  await settle(Auth.fetch('/api/x'));
  assert.deepEqual(routes, ['/login']);
});

// CLI2-03b: a token that is still valid but revoked server-side answers 401.
// On a public /s/<token> page that must not replace the page with /login.
test('a 401 on a public /s/ page drops the token quietly, stays put, and hands back the response', async () => {
  const { Auth, routes, store, calls, badge } = load({ token: FRESH(), status: 401, path: '/s/abcDEF123_-x', search: '', withPublic: true });
  const out = await settle(Auth.fetch('/api/progress/load'));
  assert.notEqual(out, 'pending');
  assert.equal(out.v.status, 401);
  assert.deepEqual(routes, []);
  assert.equal(store.has('mcu_token'), false);
  assert.equal(Auth.isLoggedIn(), false);
  assert.equal(Auth.sessionExpired(), false);   // signed out, not "expired → /login"
  assert.deepEqual(badge, [0]);
  assert.equal(calls.filter(c => c.url.endsWith('/auth/logout')).length, 0);
  // A direct endSession() there (memory.js XHR, the badge) is quiet too.
  store.set('mcu_token', FRESH());
  Auth.endSession();
  assert.deepEqual(routes, []);
  assert.equal(store.has('mcu_token'), false);
});

test('no token on a public /s/ page: Auth.fetch rejects (settles) instead of redirecting', async () => {
  const { Auth, routes, calls } = load({ token: EXPIRED(), path: '/s/abc', search: '', withPublic: true });
  const out = await settle(Auth.fetch('/api/x'));
  assert.match(String(out.e && out.e.message), /Not signed in/);
  assert.deepEqual(routes, []);
  assert.equal(apiCalls(calls).length, 0);
});

test('signed-in pages and /login keep the full logout when the router knows public routes', async () => {
  const a = load({ token: FRESH(), status: 401, withPublic: true });
  assert.equal(await settle(a.Auth.fetch('/api/x')), 'pending');
  assert.deepEqual(a.routes, ['/login?next=' + encodeURIComponent('/board?x=1')]);
  const b = load({ token: FRESH(), status: 401, path: '/login', search: '', withPublic: true });
  await settle(b.Auth.fetch('/api/x'));
  assert.deepEqual(b.routes, ['/login']);
});
