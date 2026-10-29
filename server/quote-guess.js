/************************************************
 * QUOTE GUESS — the live games (server-authoritative)
 *
 * The shared island-game engine (server/island-game.js) with Quote Guess's
 * own parts: a game's 10 rounds are drawn from the island's approved bank
 * (server/quote-guess-data.js → QuoteGuessLogic.buildRounds, answers kept
 * server-side), and an answer is one of the round's option letters. Only
 * the current question and its options reach clients before its reveal
 * (QuoteGuessLogic.publicState).
 *
 * Shares islands with Scene Guess through the registry
 * (server/island-games.js): one game per island, one game per player.
 *
 * Events (all payloads typeof-checked; client → server ones are acked
 * { ok, error } and rate-limited by NetLogic.RATES qg*):
 *   C→S  world:qg-start / qg-join / qg-leave / qg-go / qg-answer / qg-pick
 *   S→island  world:qg-state (the whole public game) · qg-fanfare · qg-arrived
 *   S→world   world:qg-live · qg-islands · qg-records
 ************************************************/
const { createCore } = require('./island-game');

function create(deps) {
  const L = deps.Logic;
  const data = deps.data;

  const core = createCore({
    kind: 'quote',
    label: 'quoteGuess',
    Logic: L,
    data,
    models: { Score: deps.models.QuoteScore, User: deps.models.User },
    emits: {
      state: 'world:qg-state',
      live: 'world:qg-live',
      islands: 'world:qg-islands',
      records: 'world:qg-records',
      fanfare: 'world:qg-fanfare',
      arrived: 'world:qg-arrived'
    },
    rates: { start: 'qgStart', join: 'qgJoin', act: 'qgAnswer', misc: 'qgMisc' },
    lobbyExtras: () => ({}),
    draw: (state, rng) => data.drawLines(state.projectId, rng),
    act(state, userId, raw, now) {
      const round = raw && raw.round, choice = raw && raw.choice;
      if (!Number.isInteger(round) || typeof choice !== 'string' || !L.OPTION_IDS.includes(choice)) return { ok: false, error: 'bad' };
      return L.answer(state, userId, round, choice, now);
    },
    itemIds: (state) => state.rounds.map(r => r.lineId),
    bestField: 'bestLines',
    noItems: 'no-lines',
    // Clients also learn which islands take suggestions.
    islandsExtra: (s) => ({ suggest: !!(s.enabled && s.suggest) }),
    now: deps.now,
    setTimeout: deps.setTimeout,
    clearTimeout: deps.clearTimeout,
    rng: deps.rng,
    log: deps.log
  });

  function register(socket) {
    const on = core.bind(socket);
    on('world:qg-start', core.onStart);
    on('world:qg-join', core.onJoin);
    on('world:qg-leave', core.onLeave);
    on('world:qg-go', core.onGo);
    on('world:qg-answer', core.onAct);
    on('world:qg-pick', core.onPick);
  }

  return Object.assign({}, core, { register });
}

let _instance = null;
function instance() {
  if (!_instance) {
    _instance = create({
      Logic: require('../js/quote-guess-logic'),
      data: require('./quote-guess-data'),
      models: { QuoteScore: require('../models/QuoteScore'), User: require('../models/user') }
    });
  }
  return _instance;
}

module.exports = { create, instance };
