/************************************************
 * FriendView + WatchState (js/friend-view.js, js/state.js): opening a
 * friend's page while our own progress is still loading must not blank our
 * progress. enter() waits for our load before snapshotting, and a server
 * payload that lands while the friend's data is on screen goes into the
 * snapshot exit() restores, not over the friend's map.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');

function jwt(exp) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256' })}.${b64({ id: 'me', exp })}.sig`;
}

// Our /progress/load answers only when the test calls release().
function setup() {
  const store = new Map([['mcu_token', jwt(Math.floor(Date.now() / 1000) + 3600)], ['mcu_username', 'me']]);
  let release;
  const gate = new Promise(r => { release = r; });
  const ours = { watchedProjects: [{ projectId: 'ironman1', count: 2 }], watchSessions: [] };
  const ctx = {
    API: '/api', console, escape, setTimeout, clearTimeout,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    location: { pathname: '/', search: '' },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    },
    fetch: (url) => gate.then(() => ({ status: 200, ok: true, json: async () => ours })),
    toast: () => {},
    CONFIG: {},
    Friends: { getByUsername: async () => ({ username: 'pal', watchedProjects: [{ projectId: 'thor1', count: 1 }] }) }
  };
  vm.createContext(ctx);
  for (const f of ['auth.js', 'state.js', 'friend-view.js']) vm.runInContext(read(f), ctx);
  vm.runInContext('this.state = state; this.FriendView = FriendView;', ctx);
  return { ...ctx, release };
}
const keys = (m) => Array.from(m.keys());

test('enter() waits for our in-flight load, so exit() restores our progress', async () => {
  const { state, FriendView, release } = setup();
  const boot = state.ensureLoaded();             // boot-time load, still in flight
  const entering = FriendView.enter('pal');
  await new Promise(r => setTimeout(r, 5));
  assert.equal(FriendView.isActive(), false);    // not swapped before our data is in
  release();
  await boot; await entering;
  assert.deepEqual(keys(state.data), ['thor1']);
  assert.equal(state.readonly, true);
  FriendView.exit();
  assert.deepEqual(keys(state.data), ['ironman1']);
  assert.equal(state.readonly, false);
});

test('a server payload arriving in friend mode updates the saved snapshot, not the friend map', async () => {
  const { state, FriendView, release } = setup();
  release();
  await state.ensureLoaded();
  await FriendView.enter('pal');
  state._applyServer({ watchedProjects: [{ projectId: 'ironman1', count: 2 }, { projectId: 'hulk', count: 1 }], watchSessions: [{ projectId: 'thor2', episode: 0 }] });
  assert.deepEqual(keys(state.data), ['thor1']);
  assert.equal(state.sessions.size, 0);
  FriendView.exit();
  assert.deepEqual(keys(state.data), ['ironman1', 'hulk']);
  assert.deepEqual(keys(state.sessions), ['thor2']);
});

// ── public share pages (/s/<token>): FriendView.enterShared ──

// A visitor on /s/<token>. `token` is what localStorage holds (null = never
// signed in); `share` answers GET /api/share/public/<token>.
function setupShared({ token = null, pathname = '/s/abcDEF123_-x', share, api } = {}) {
  const store = new Map(token ? [['mcu_token', token], ['mcu_username', 'olduser']] : []);
  const gone = [];
  const fetches = [];
  const toasts = [];
  const ctx = {
    API: '/api', console, escape, setTimeout, clearTimeout, setInterval: () => 0,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    location: { pathname, search: '' },
    document: { querySelectorAll: () => [], addEventListener() {}, visibilityState: 'visible' },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    },
    fetch: async (url) => {
      fetches.push(url);
      if (url.startsWith('/api/share/public/')) return share ? share() : { status: 200, ok: true, json: async () => ({ username: 'elsid', profilePicture: '', watched: ['cap1'] }) };
      if (api) return api(url);
      return { status: 200, ok: true, json: async () => ({ watchedProjects: [], watchSessions: [], count: 0 }) };
    },
    toast: (msg) => toasts.push(String(msg)),
    CONFIG: {},
    Router: { go: (u) => gone.push(u), _debug: { isPublic: (p) => p === '/login' || p.startsWith('/s/') } }
  };
  vm.createContext(ctx);
  for (const f of ['auth.js', 'state.js', 'friend-view.js', 'messages.js']) vm.runInContext(read(f), ctx);
  vm.runInContext('this.state = state; this.FriendView = FriendView; this.MessagesBadge = MessagesBadge; this.Auth = Auth;', ctx);
  return { ...ctx, gone, fetches, toasts };
}
const settles = (p, ms = 100) => Promise.race([p.then(v => ({ v })), new Promise(r => setTimeout(() => r(null), ms))]);
const EXPIRED = () => jwt(Math.floor(Date.now() / 1000) - 86400);

test('expired token + /s/ link: the unread poll does not send the visitor to /login', async () => {
  const { Auth, MessagesBadge, gone } = setupShared({ token: EXPIRED() });
  assert.equal(Auth.isLoggedIn(), false);         // SharedView.topbar() runs this first
  assert.equal(Auth.sessionExpired(), true);
  await MessagesBadge.refresh();
  assert.deepEqual(gone, []);
});

test('expired token + /s/ link: enterShared settles with the sharer, no /login, no progress load', async () => {
  const { Auth, FriendView, gone, fetches } = setupShared({ token: EXPIRED() });
  Auth.isLoggedIn();
  const r = await settles(FriendView.enterShared('abcDEF123_-x'));
  assert.ok(r, 'enterShared never settled');
  assert.equal(r.v.username, 'elsid');
  assert.deepEqual(gone, []);
  assert.deepEqual(fetches, ['/api/share/public/abcDEF123_-x']);
});

test('expired token on a signed-in page still ends the session (→ /login?next=…)', async () => {
  const { MessagesBadge, gone } = setupShared({ token: EXPIRED(), pathname: '/profile' });
  await settles(MessagesBadge.refresh(), 20);
  assert.deepEqual(gone, ['/login?next=%2Fprofile']);
});

test('enterShared: only a 404 means "gone"; offline, 5xx and 429 are "unavailable"', async () => {
  const answer = (status, body) => () => ({ status, ok: status < 300, json: async () => body });
  const cases = [
    [answer(404, { error: 'This link is no longer shared' }), null],
    [answer(503, { error: 'busy' }), 'unavailable'],
    [answer(429, { error: 'Too many requests' }), 'unavailable'],
    [answer(200, null), 'unavailable'],
    [() => { throw new TypeError('Failed to fetch'); }, 'unavailable']
  ];
  for (const [share, want] of cases) {
    const { FriendView, state } = setupShared({ share });
    const r = await FriendView.enterShared('abcDEF123_-x');
    if (want === null) assert.equal(r, null);
    else assert.equal(r && r.error, want);
    assert.equal(FriendView.isActive(), false);
    assert.equal(state.readonly, false);
  }
  const { FriendView } = setupShared();
  const ok = await FriendView.enterShared('abcDEF123_-x');
  assert.equal(ok.username, 'elsid');
  assert.equal(FriendView.isActive(), true);
});

// CLI2-03b: the token is still valid client-side but the server revoked it
// ("log out everywhere", password change), so every signed-in call is a 401.
const FRESH = () => jwt(Math.floor(Date.now() / 1000) + 3600);
const revoked = () => ({ status: 401, ok: false, json: async () => ({ error: 'Session expired' }) });

test('revoked token + /s/ link: the owner\'s progress load and the unread poll stay on the page', async () => {
  const { Auth, FriendView, MessagesBadge, gone, fetches } = setupShared({ token: FRESH(), api: revoked });
  assert.equal(Auth.isLoggedIn(), true);
  const r = await settles(FriendView.enterShared('abcDEF123_-x'));
  assert.ok(r, 'enterShared never settled');
  assert.equal(r.v.username, 'elsid');
  assert.ok(fetches.includes('/api/progress/load'));   // it did try, and got the 401
  assert.deepEqual(gone, []);
  assert.equal(Auth.isLoggedIn(), false);               // token dropped quietly
  await settles(MessagesBadge.refresh(), 20);
  assert.deepEqual(gone, []);
});

test('revoked token on a signed-in page still ends the session (→ /login?next=…)', async () => {
  const { MessagesBadge, gone } = setupShared({ token: FRESH(), pathname: '/feed', api: revoked });
  await settles(MessagesBadge.refresh(), 20);
  assert.deepEqual(gone, ['/login?next=%2Ffeed']);
});

// CLI2-03c: the same revoked owner on their own /s/<token> page. The progress
// load's 401 now comes back quietly (Auth.fetch), and state.load must not turn
// it into "Couldn't load your progress" or block the board with loadFailed.
test('revoked token + /s/ link: the progress load 401 shows no banner and sets no loadFailed', async () => {
  const { FriendView, state, toasts } = setupShared({ token: FRESH(), api: revoked });
  const r = await settles(FriendView.enterShared('abcDEF123_-x'));
  assert.ok(r, 'enterShared never settled');
  assert.ok(!state.loadFailed, 'loadFailed set');
  assert.deepEqual(toasts, []);
  // Back on our own (signed-out) board there is no retry prompt either.
  FriendView.exit();
  assert.equal(await state.startWatching('cap1'), null);
  assert.deepEqual(toasts.filter(t => /didn.t load/.test(t)), []);
});

test('signed in on /s/, a progress load that fails for another reason still warns (control)', async () => {
  const down = () => ({ status: 503, ok: false, json: async () => ({ error: 'busy' }) });
  const { Auth, FriendView, state, toasts } = setupShared({ token: FRESH(), api: down });
  await settles(FriendView.enterShared('abcDEF123_-x'));
  assert.equal(Auth.isLoggedIn(), true);
  assert.equal(state.loadFailed, true);
  assert.ok(toasts.some(t => /Couldn't load your progress/.test(t)), JSON.stringify(toasts));
});
