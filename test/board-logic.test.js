/************************************************
 * js/views/board.js: the Board's pure rules (CLI2-10b / CLI-10): which drag
 * moves between Not started / In progress / Done are allowed (and the
 * message when not), and the Not started / Done column filters.
 *
 * Runs the real state.js, watch-controls.js and board.js in a vm and reaches
 * the rules through BoardView._debug.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');

const MOVIE = { id: 'm1', title: 'Movie', runtime: 120, release: '2010-01-01', phase: 'Phase 1' };
const SERIES = { id: 's1', title: 'Series', episodes: [50, 50, 50], release: '2021-01-01', phase: 'Phase 4' };

function setup() {
  const store = new Map();
  const ctx = {
    console, Date, Math,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    }
  };
  vm.createContext(ctx);
  for (const f of ['state.js', 'watch-controls.js', 'views/board.js']) vm.runInContext(read(f), ctx);
  vm.runInContext('this.state = state; this.WatchState = WatchState; this.B = BoardView._debug;', ctx);
  // remainingMs() reads the runtime from state.byId.
  ctx.state.byId = new Map([[MOVIE.id, MOVIE], [SERIES.id, SERIES]]);
  return ctx;
}

const MIN = 60000;
const plain = (v) => JSON.parse(JSON.stringify(v));

test('transition: dropping on its own column does nothing', () => {
  const { B } = setup();
  for (const c of ['todo', 'progress', 'done']) assert.equal(B.transition(MOVIE, c, c), null);
});

test('transition: anything → In progress starts (or rewatches) unless both timers run', () => {
  const { B, state } = setup();
  assert.deepEqual(plain(B.transition(MOVIE, 'todo', 'progress')), { action: 'start' });
  assert.deepEqual(plain(B.transition(MOVIE, 'done', 'progress')), { action: 'start' }, 'a rewatch');
  const now = Date.now();
  state.sessions.set('x1', { episode: 0, startedAt: now, rewatch: false });
  state.sessions.set('x2', { episode: 0, startedAt: now, rewatch: false });
  const t = B.transition(MOVIE, 'todo', 'progress');
  assert.match(t.error, /^2 timers are already running/);
  // A series waiting between episodes holds no timer.
  state.sessions.set('x2', { episode: 1, startedAt: null, rewatch: false });
  assert.deepEqual(plain(B.transition(MOVIE, 'todo', 'progress')), { action: 'start' });
});

test('transition: In progress → Done completes only once the timer allows it', () => {
  const { B, state } = setup();
  // Movie: 120 min minus 10 min of credits = 110 min.
  state.sessions.set('m1', { episode: 0, startedAt: Date.now() - 30 * MIN, rewatch: false });
  const early = B.transition(MOVIE, 'progress', 'done');
  assert.match(early.error, /^Mark as watched unlocks in 1:20:00\.$|^Mark as watched unlocks in 1:19:59\.$/);
  state.sessions.set('m1', { episode: 0, startedAt: Date.now() - 111 * MIN, rewatch: false });
  assert.deepEqual(plain(B.transition(MOVIE, 'progress', 'done')), { action: 'complete' });
});

test('transition: a series reaches Done from its card, not by dragging mid-way', () => {
  const { B, state } = setup();
  state.sessions.set('s1', { episode: 1, startedAt: null, rewatch: false });
  assert.equal(B.transition(SERIES, 'progress', 'done').error, 'Start episode 2 first.');
  state.sessions.set('s1', { episode: 1, startedAt: Date.now() - 60 * MIN, rewatch: false });
  assert.equal(B.transition(SERIES, 'progress', 'done').error, 'Finish all 3 episodes first — mark this one from the card.');
  state.sessions.set('s1', { episode: 2, startedAt: Date.now() - 60 * MIN, rewatch: false });
  assert.deepEqual(plain(B.transition(SERIES, 'progress', 'done')), { action: 'complete' }, 'the last episode');
});

test('transition: In progress → Not started cancels, but a rewatch goes back via Cancel only', () => {
  const { B, state } = setup();
  state.sessions.set('m1', { episode: 0, startedAt: Date.now(), rewatch: false });
  assert.deepEqual(plain(B.transition(MOVIE, 'progress', 'todo')), { action: 'cancel' });
  state.sessions.set('m1', { episode: 0, startedAt: Date.now(), rewatch: true });
  assert.equal(B.transition(MOVIE, 'progress', 'todo').error, 'This is a rewatch — use Cancel to put it back in Done.');
});

test('transition: Not started ↔ Done is refused with a reason', () => {
  const { B } = setup();
  assert.equal(B.transition(MOVIE, 'todo', 'done').error, 'Start watching it first.');
  assert.equal(B.transition(MOVIE, 'done', 'todo').error, 'Watched projects stay in Done — drag to In progress to rewatch.');
  assert.equal(B.transition(MOVIE, 'locked', 'done').error, "Can't move it there.");
});

test('transition: a card whose session vanished mid-drag gets a plain message, not a NaN clock', () => {
  const { B } = setup();
  // `from` is captured on pointerdown; the session can be gone by the drop.
  const t = B.transition(MOVIE, 'progress', 'done');
  assert.ok(t.error, 'refused');
  assert.doesNotMatch(t.error, /NaN|Infinity/);
});

test('Not started filter: options only offer choices with something in them', () => {
  const { B } = setup();
  const p1 = Object.assign({}, MOVIE, { id: 'a' });
  const p2 = Object.assign({}, MOVIE, { id: 'b', phase: 'Phase 10' });
  const p3 = Object.assign({}, SERIES, { id: 'c', phase: 'Phase 2' });
  assert.deepEqual(plain(B.todoOptions([p1])), [{ value: 'all', label: 'All unlocked (1)' }]);
  assert.deepEqual(plain(B.todoOptions([p1, p2, p3])), [
    { value: 'all', label: 'All unlocked (3)' },
    { value: 'movies', label: 'Movies (2)' },
    { value: 'series', label: 'Series (1)' },
    { value: 'phase:Phase 1', label: 'Phase 1 (1)' },
    { value: 'phase:Phase 2', label: 'Phase 2 (1)' },          // numeric order: 2 before 10
    { value: 'phase:Phase 10', label: 'Phase 10 (1)' }
  ]);
  const list = [p1, p2, p3];
  assert.deepEqual(B.filterTodo(list, 'all').map(p => p.id), ['a', 'b', 'c']);
  assert.deepEqual(B.filterTodo(list, 'movies').map(p => p.id), ['a', 'b']);
  assert.deepEqual(B.filterTodo(list, 'series').map(p => p.id), ['c']);
  assert.deepEqual(B.filterTodo(list, 'phase:Phase 10').map(p => p.id), ['b']);
  assert.deepEqual(B.filterTodo(list, 'phase:Phase 9').map(p => p.id), []);
});

test('Done filter: last N watched (newest first) or everything in release order', () => {
  const { B, state } = setup();
  const mk = (id, release) => ({ id, title: id, release });
  const list = [mk('old', '2008-01-01'), mk('mid', '2012-01-01'), mk('new', '2019-01-01'), mk('undated', '2015-01-01'), mk('undated2', '2016-01-01')];
  state.data.set('old', { count: 1, lastWatchedAt: 3000 });
  state.data.set('mid', { count: 1, lastWatchedAt: 1000 });
  state.data.set('new', { count: 1, lastWatchedAt: 2000 });
  state.data.set('undated', { count: 1 });
  // A memory upload stands in for a missing watch time.
  state.data.set('undated2', { count: 1, memories: [{ uploadedAt: '1970-01-01T00:00:00.500Z' }] });

  assert.deepEqual(plain(B.doneOptions(list)), [
    { value: 'last1', label: 'Last watched' },
    { value: 'all', label: 'All done (5)' }
  ], '"Last 5" needs more than 5 done');
  const many = Array.from({ length: 12 }, (_, i) => mk('p' + i, '2010-01-' + String(i + 1).padStart(2, '0')));
  assert.deepEqual(plain(B.doneOptions(many)).map(o => o.value), ['last1', 'last5', 'last10', 'all']);

  assert.deepEqual(B.filterDone(list, 'all').map(p => p.id), ['old', 'mid', 'undated', 'undated2', 'new']);
  assert.deepEqual(B.filterDone(list, 'last1').map(p => p.id), ['old']);
  assert.deepEqual(B.filterDone(list, 'last5').map(p => p.id), ['old', 'new', 'mid', 'undated2', 'undated'],
    'newest watch first; no time at all goes last');
  assert.deepEqual(list.map(p => p.id), ['old', 'mid', 'new', 'undated', 'undated2'], 'the input is not reordered');
});
