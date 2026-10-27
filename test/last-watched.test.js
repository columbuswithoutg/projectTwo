/************************************************
 * WatchState.getLastWatchedId (js/state.js): /map centres on the most
 * recently watched title (lastWatchedAt, else newest memory), not the last
 * entry in the server's array order.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeState() {
  const ctx = { console, CONFIG: { START_NODE_ID: 'start' } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'state.js'), 'utf8') + '\n;globalThis.__s = state;', ctx);
  return ctx.__s;
}

test('getLastWatchedId: the newest lastWatchedAt wins over array order', () => {
  const s = makeState();
  s._applyServer({ watchedProjects: [
    { projectId: 'a', count: 1, lastWatchedAt: '2026-01-05T00:00:00Z' },
    { projectId: 'b', count: 2, lastWatchedAt: '2026-03-01T00:00:00Z' },   // rewatched most recently
    { projectId: 'c', count: 1, lastWatchedAt: '2026-02-01T00:00:00Z' }
  ], watchSessions: [] }, { notify: false });
  assert.equal(s.getLastWatchedId(), 'b');
});

test('getLastWatchedId: memory upload time counts when lastWatchedAt is missing', () => {
  const s = makeState();
  s._applyServer({ watchedProjects: [
    { projectId: 'a', count: 1, memories: [{ url: 'x', uploadedAt: '2026-05-01T00:00:00Z' }] },
    { projectId: 'b', count: 1, lastWatchedAt: '2026-04-01T00:00:00Z' },
    { projectId: 'c', count: 1 }
  ], watchSessions: [] }, { notify: false });
  assert.equal(s.getLastWatchedId(), 'a');
});

test('getLastWatchedId: no timestamps → last entry; nothing watched → START_NODE_ID', () => {
  const s = makeState();
  s._applyServer({ watchedProjects: [{ projectId: 'a', count: 1 }, { projectId: 'b', count: 1 }], watchSessions: [] }, { notify: false });
  assert.equal(s.getLastWatchedId(), 'b');
  const empty = makeState();
  assert.equal(empty.getLastWatchedId(), 'start');
});
