/************************************************
 * SCENE GUESS — the live games (server-authoritative)
 *
 * At most one game per island. Someone on a LIVE island (see
 * server/scene-guess-data.js) presses Play → a lobby anyone on that island
 * may join (C.LOBBY_MS, max C.MAX_PLAYERS) → "get ready" (every client
 * preloads the 10 stills) → 10 rounds of guess / reveal → results (scores
 * saved, record decided) → the island is free again. Everyone else on the
 * island watches: every state change goes to the island's sockets too.
 *
 * The flow, clock, graces, saving and broadcasts are the shared island-game
 * engine (server/island-game.js); this adapter adds what is Scene Guess's
 * own: the guessing line (a project's runtime / episodes) on every lobby,
 * the still draw, and the { round, at } guess. A still's answer never
 * leaves the server before its reveal (SceneGuessLogic.publicState is the
 * only serializer).
 *
 * Events (all payloads typeof-checked; client → server ones are acked
 * { ok, error } and rate-limited by NetLogic.RATES sg*):
 *   C→S  world:sg-start / sg-join / sg-leave / sg-go / sg-guess / sg-pick
 *   S→island  world:sg-state (the whole public game) · sg-fanfare · sg-arrived
 *   S→world   world:sg-live · sg-islands · sg-records
 *
 * create(deps) builds an instance (test/scene-guess-server.test.js passes a
 * fake clock, io and models); the module exports one wired to the real ones.
 ************************************************/
const { createCore } = require('./island-game');

function create(deps) {
  const L = deps.Logic;
  const data = deps.data;

  const core = createCore({
    kind: 'scene',
    label: 'sceneGuess',
    Logic: L,
    data,
    models: { Score: deps.models.SceneScore, User: deps.models.User },
    emits: {
      state: 'world:sg-state',
      live: 'world:sg-live',
      islands: 'world:sg-islands',
      records: 'world:sg-records',
      fanfare: 'world:sg-fanfare',
      arrived: 'world:sg-arrived'
    },
    rates: { start: 'sgStart', join: 'sgJoin', act: 'sgGuess', misc: 'sgMisc' },
    // Every game carries its project's guessing line; no runtime = not playable.
    lobbyExtras(projectId) {
      const timeline = L.timeline(data.projectSync(projectId));
      return timeline ? { timeline } : null;
    },
    draw: (state, rng) => data.drawStills(state.projectId, state.timeline, rng),
    act(state, userId, raw, now) {
      const round = raw && raw.round, at = raw && raw.at;
      if (!Number.isInteger(round) || typeof at !== 'number') return { ok: false, error: 'bad' };
      return L.guess(state, userId, round, at, now);
    },
    itemIds: (state) => state.stills.map(x => x.id),
    bestField: 'bestStills',
    noItems: 'no-stills',
    now: deps.now,
    setTimeout: deps.setTimeout,
    clearTimeout: deps.clearTimeout,
    rng: deps.rng,
    log: deps.log
  });

  function register(socket) {
    const on = core.bind(socket);
    on('world:sg-start', core.onStart);
    on('world:sg-join', core.onJoin);
    on('world:sg-leave', core.onLeave);
    on('world:sg-go', core.onGo);
    on('world:sg-guess', core.onAct);
    on('world:sg-pick', core.onPick);
  }

  return Object.assign({}, core, { register });
}

// The real instance, wired to Mongo — built on first use, so tests can
// require this file for create() without loading any models.
let _instance = null;
function instance() {
  if (!_instance) {
    _instance = create({
      Logic: require('../js/scene-guess-logic'),
      data: require('./scene-guess-data'),
      models: { SceneScore: require('../models/SceneScore'), User: require('../models/user') }
    });
  }
  return _instance;
}

module.exports = { create, instance };
