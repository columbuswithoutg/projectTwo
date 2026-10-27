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
function load({ token = null, status = 200, path: here = '/board', search = '?x=1' } = {}) {
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
  vm.createContext(ctx);
  vm.runInContext(SRC + '\nthis.Auth = Auth;', ctx);
  return { Auth: ctx.Auth, calls, routes, store };
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
