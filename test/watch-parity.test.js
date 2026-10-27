/************************************************
 * Client/server parity for the watch rules.
 *
 * server/watchRules.js decides; js/state.js (timers) and js/utils.js
 * (unlock rules) hand-mirror it so the board shows the same answers. This
 * runs both on one table of synthetic projects and watch states:
 *   - step / credits / required minutes and step counts,
 *   - remainingMs (client = server + CLOCK_SLACK_MS, by design),
 *   - phase gating and "can start now" (isAvailable vs isUnlocked),
 *     including a prerequisite that no longer exists.
 *
 * Client: js/config.js + js/state.js + js/utils.js in one vm context (as
 * test/friend-view-restore.test.js does), Date.now pinned in that context.
 * Server: the real module, its project cache filled through allProjects()
 * with Project.find stubbed (no Mongo).
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const Project = require('../models/Project');
const W = require('../server/watchRules');

// ---- synthetic catalogue ---------------------------------------------------
const PROJECTS = [
  { id: 'ironman1', title: 'Iron Man', phase: 'Phase 1', runtime: 126, prerequisites: [] },
  { id: 'avengers1', title: 'The Avengers', phase: 1, runtime: 143, prerequisites: ['ironman1'] },
  { id: 'noruntime', title: 'No runtime yet', phase: 'Phase 1', prerequisites: [] },
  { id: 'special', title: 'Short special', phase: 'Phase 1', runtime: 12, prerequisites: [] },
  { id: 'show', title: 'A series', phase: 'Phase 1', episodes: [50, 24, 15, 140, 0], prerequisites: [] },
  { id: 'emptyeps', title: 'Empty episode list', phase: 'Phase 1', episodes: [], runtime: 90, prerequisites: [] },
  { id: 'p2', title: 'Phase 2 opener', phase: 'Phase 2', runtime: 115, prerequisites: [] },
  { id: 'p2chain', title: 'Phase 2 with prereq', phase: 'Phase 2', runtime: 100, prerequisites: ['p2'] },
  { id: 'ageofultron', title: 'Age of Ultron', phase: 'Phase 2', runtime: 141, prerequisites: ['avengers1'] },
  { id: 'p3', title: 'Phase 3 opener', phase: 'Phase 3', runtime: 147, prerequisites: [] },
  { id: 'p7', title: 'Phase with no unlocker', phase: 'Phase 7', runtime: 120, prerequisites: [] },
  { id: 'ghostdep', title: 'Prereq was deleted', phase: 'Phase 1', runtime: 100, prerequisites: ['ghost', 'ironman1'] },
  { id: 'hidden', title: 'Hidden prereq', phase: 'Phase 1', runtime: 100, prerequisites: [], hiddenPrerequisites: ['special'] },
  { id: 'advisory', title: 'Recommended only', phase: 'Phase 1', runtime: 100, prerequisites: [], recommendedPrerequisites: ['show'] },
  { id: 'nophase', title: 'No phase field', runtime: 100, prerequisites: [] }
];
const clone = () => JSON.parse(JSON.stringify(PROJECTS));

const WATCH_STATES = {
  fresh: [],
  partial: ['ironman1', 'special', 'p2'],
  phase2: ['ironman1', 'avengers1', 'p2'],
  complete: PROJECTS.map(p => p.id)
};

// ---- client in a vm --------------------------------------------------------
const NOW = 1_800_000_000_000;
function loadClient() {
  const store = new Map();
  const ctx = {
    console, setTimeout, clearTimeout,
    window: { location: { origin: 'http://test', pathname: '/', search: '' } },
    location: { pathname: '/', search: '' },
    document: { querySelector: () => null, getElementById: () => null, addEventListener() {} },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    },
    toast: () => {}
  };
  vm.createContext(ctx);
  for (const f of ['config.js', 'state.js', 'utils.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  }
  vm.runInContext(`
    Date.now = () => ${NOW};
    this.__c = { state, isUnlocked, isPhaseUnlocked, allPrereqs, PHASE_UNLOCKERS };
  `, ctx);
  return ctx.__c;
}

// Client with the catalogue loaded and the given ids watched / sessions running.
function client(watched, sessions = []) {
  const c = loadClient();
  c.state.initProjects(clone());
  c.state._applyServer({
    watchedProjects: watched.map(projectId => ({ projectId, count: 1 })),
    watchSessions: sessions,
    serverNow: NOW
  });
  return c;
}

// Server with its project cache warm on the same catalogue.
async function warmServer() {
  Project.find = () => ({ select: () => ({ lean: async () => clone() }) });
  W.invalidate();
  await W.allProjects();
}

// ---- tests -----------------------------------------------------------------
test('PHASE_UNLOCKERS match (js/config.js vs server/watchRules.js)', () => {
  const c = loadClient();
  assert.deepEqual({ ...c.PHASE_UNLOCKERS }, { ...W.PHASE_UNLOCKERS });
});

test('parsePhase agrees on numbers, strings and junk', () => {
  const { state } = loadClient();
  for (const v of [1, 4, 'Phase 3', 'phase 6', 'Phase', '', null, undefined, 'Saga 2 / Phase 5']) {
    assert.equal(state.parsePhase(v), W.parsePhase(v), JSON.stringify(v));
  }
});

test('step count, step / credits / required minutes agree for every step', () => {
  const { state } = loadClient();
  for (const p of PROJECTS) {
    assert.equal(state.stepCount(p), W.stepCount(p), p.id + ' stepCount');
    assert.deepEqual(state.episodesOf(p), W.episodesOf(p), p.id + ' episodesOf');
    // One step past the end too: both must treat a missing episode as 0.
    for (let i = 0; i <= W.stepCount(p); i++) {
      for (const fn of ['stepMinutes', 'creditsMinutes', 'requiredMinutes']) {
        assert.equal(state[fn](p, i), W[fn](p, i), `${p.id} ${fn}(${i})`);
      }
    }
  }
});

test('remainingMs: client minus CLOCK_SLACK_MS is the server answer, in every watch state', () => {
  const MIN = 60000;
  const cases = [
    // [project, episode, startedAt offset from now (ms) or null]
    ['ironman1', 0, null],              // between steps / not started
    ['ironman1', 0, 0],                 // just started
    ['ironman1', 0, -60 * MIN],         // part way
    ['ironman1', 0, -116 * MIN + 3000], // inside the slack window
    ['ironman1', 0, -200 * MIN],        // long finished
    ['noruntime', 0, -1000],            // no runtime: ready at once
    ['special', 0, -5 * MIN],
    ['show', 0, -10 * MIN],
    ['show', 1, -20 * MIN],
    ['show', 3, -129 * MIN],
    ['show', 4, 0],                     // zero-length episode
    ['show', 9, 0]                      // episode index past the list
  ];
  for (const [id, episode, off] of cases) {
    const startedAt = off === null ? null : new Date(NOW + off).toISOString();
    const c = client([], [{ projectId: id, episode, startedAt }]);
    const p = PROJECTS.find(x => x.id === id);
    const cl = c.state.remainingMs(id);
    const sv = W.remainingMs(p, { episode, startedAt }, NOW);
    const label = `${id} ep${episode} @${off}`;
    if (off === null) {
      assert.equal(cl, Infinity, label);
      assert.equal(sv, Infinity, label);
    } else {
      assert.equal(sv, Math.max(0, cl - W.CLOCK_SLACK_MS), label);
    }
  }
  // No session at all: both say "no timer".
  assert.equal(client([]).state.remainingMs('ironman1'), Infinity);
  assert.equal(W.remainingMs(PROJECTS[0], null, NOW), Infinity);
});

test('phase gating agrees (projects with no prerequisites)', async () => {
  await warmServer();
  const gated = PROJECTS.filter(p => !(p.prerequisites || []).length && !(p.hiddenPrerequisites || []).length);
  for (const [name, watched] of Object.entries(WATCH_STATES)) {
    const c = client(watched);
    const set = new Set(watched);
    for (const p of gated) {
      const cp = c.state.byId.get(p.id);
      assert.equal(!!c.isPhaseUnlocked(cp), W.isAvailable(p, set), `${name}: ${p.id}`);
    }
  }
});

test('"can start now" agrees: client isUnlocked === server isAvailable', async () => {
  await warmServer();
  for (const [name, watched] of Object.entries(WATCH_STATES)) {
    const c = client(watched);
    const set = new Set(watched);
    for (const p of PROJECTS) {
      assert.equal(c.isUnlocked(c.state.byId.get(p.id)), W.isAvailable(p, set), `${name}: ${p.id}`);
    }
  }
});

test('spot checks: the table really exercises each rule', async () => {
  await warmServer();
  const fresh = new Set(), partial = new Set(WATCH_STATES.partial), all = new Set(WATCH_STATES.complete);
  const by = (id) => PROJECTS.find(p => p.id === id);
  assert.equal(W.isAvailable(by('p2'), fresh), false);              // phase 2 locked
  assert.equal(W.isAvailable(by('p2'), new Set(['avengers1'])), true);
  assert.equal(W.isAvailable(by('p7'), all), false);                // no unlocker ⇒ never
  assert.equal(W.isAvailable(by('ghostdep'), partial), true);       // deleted prereq ignored
  assert.equal(W.isAvailable(by('ghostdep'), fresh), false);        // live prereq still counts
  assert.equal(W.isAvailable(by('hidden'), fresh), false);          // hidden prereq locks
  assert.equal(W.isAvailable(by('hidden'), partial), true);
  assert.equal(W.isAvailable(by('advisory'), fresh), true);         // recommended never locks
  const c = client([]);
  assert.deepEqual([...c.allPrereqs(c.state.byId.get('ghostdep'))], ['ironman1']);
});
