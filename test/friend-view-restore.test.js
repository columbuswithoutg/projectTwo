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
