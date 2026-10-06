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
 * The rules are the pure reducers in js/scene-guess-logic.js; this module
 * owns the clock (one timer per game), the sockets, the database writes and
 * the broadcasts. A still's answer never leaves the server before its reveal
 * (SceneGuessLogic.publicState is the only serializer).
 *
 * Players are keyed by userId. A refresh / dropped connection gets a new
 * socket: the player has RECONNECT_GRACE_MS to come back (world:join →
 * resume); stepping off the island gets ZONE_GRACE_MS. Away players never
 * hold up a round. Switching the game off (globally or for that island)
 * ends a running game within one tick.
 *
 * Events (all payloads typeof-checked; client → server ones are acked
 * { ok, error } and rate-limited by NetLogic.RATES sg*):
 *   C→S  world:sg-start / sg-join / sg-leave / sg-go / sg-guess / sg-pick / sg-sync
 *   S→island  world:sg-state (the whole public game) · sg-fanfare · sg-arrived
 *   S→world   world:sg-live · sg-islands · sg-records
 *
 * create(deps) builds an instance (test/scene-guess-server.test.js passes a
 * fake clock, io and models); the module exports one wired to the real ones.
 ************************************************/

function create(deps) {
  const L = deps.Logic;
  const data = deps.data;
  const now = deps.now || (() => Date.now());
  const setT = deps.setTimeout || setTimeout;
  const clearT = deps.clearTimeout || clearTimeout;
  const log = deps.log || ((...a) => console.error(...a));

  let io = null;
  let world = null;        // { players: Map(socketId → player), rateOk, touchStay, zoneOf }
  const games = new Map(); // projectId → { state, sockets: Map(userId → socketId|null), awayUntil: Map(userId → ms), timer, seq, beginning }
  const arrivals = new Map();   // "userId|projectId" → ms of the last arrival fanfare

  // ── lookups ──

  function gameOfUser(userId) {
    const id = String(userId);
    for (const g of games.values()) if (L.hasPlayer(g.state, id)) return g;
    return null;
  }
  function gameOfSocket(sid) {
    if (!sid) return null;
    for (const g of games.values()) {
      for (const [userId, s] of g.sockets) if (s === sid) return { g, userId };
    }
    return null;
  }
  function isPlaying(sid) { return !!gameOfSocket(sid); }
  function live(projectId) { return data.enabledSync() && data.isLiveSync(projectId); }

  // ── sending ──

  function islandSockets(projectId) {
    const out = [];
    for (const p of world.players.values()) if (p.projectId === projectId) out.push(p.socketId);
    return out;
  }
  // The island's sockets plus every player's (a player in their zone grace
  // or not yet re-zoned after a reconnect still gets their game).
  function targets(g) {
    const set = new Set(islandSockets(g.state.projectId));
    for (const sid of g.sockets.values()) if (sid) set.add(sid);
    return [...set];
  }
  function emitTo(sids, event, payload) {
    if (io && sids.length) io.to(sids).emit(event, payload);
  }
  function payload(g) {
    const out = L.publicState(g.state);
    out.away = g.state.order.filter(id => g.awayUntil.has(id)).map(id => g.state.players[id].username);
    out.serverTime = now();
    return out;
  }
  function broadcast(g) { emitTo(targets(g), 'world:sg-state', payload(g)); }
  function sendState(socket, g) { socket.emit('world:sg-state', payload(g)); }
  function idlePayload(projectId, reason) { return { projectId, phase: 'idle', reason: reason || null, serverTime: now() }; }
  function hostName(g) { const h = g.state.players[g.state.host]; return h ? h.username : null; }
  function announceLive(g, isLive) {
    if (io) io.to('world').emit('world:sg-live', { projectId: g.state.projectId, live: isLive, host: isLive ? hostName(g) : null });
  }

  // ── the clock ──

  // One timer per game, aimed at whichever comes first: this phase's end
  // (+ the late-guess grace during a round) or an away player's grace.
  function schedule(g) {
    if (g.timer) clearT(g.timer);
    const t = now();
    let at = g.state.deadline + (g.state.phase === 'round' ? L.C.LATE_GRACE_MS : 0);
    for (const until of g.awayUntil.values()) at = Math.min(at, until);
    const seq = ++g.seq;
    g.timer = setT(() => { if (seq === g.seq) safeTick(g); }, Math.max(0, at - t));
    if (g.timer && typeof g.timer.unref === 'function') g.timer.unref();
  }

  // A throw inside a timer would take the whole process down.
  function safeTick(g) {
    try { tick(g); } catch (e) { log('sceneGuess: tick failed:', e); end(g, 'error'); }
  }

  function tick(g) {
    if (games.get(g.state.projectId) !== g) return;
    const t = now();
    if (!live(g.state.projectId)) return end(g, 'disabled');
    let dropped = false;
    for (const [userId, until] of [...g.awayUntil]) {
      if (until > t) continue;
      g.awayUntil.delete(userId);
      g.sockets.delete(userId);
      g.state = L.leave(g.state, userId);
      dropped = true;
    }
    if (g.state.phase === 'over') return end(g, 'empty');
    const s = g.state;
    if (s.phase === 'lobby' && t >= s.deadline) return begin(g);
    if (s.phase === 'ready' && t >= s.deadline) { g.state = L.startRound(s, t); broadcast(g); return schedule(g); }
    if (s.phase === 'round' && t >= s.deadline + L.C.LATE_GRACE_MS) return reveal(g);
    if (s.phase === 'reveal' && t >= s.deadline) return advance(g);
    if (s.phase === 'results' && t >= s.deadline) return end(g, 'done');
    if (dropped && maybeEarlyReveal(g)) return;
    if (dropped) broadcast(g);
    schedule(g);
  }

  // Lobby → draw the stills (async) → "get ready".
  async function begin(g) {
    if (g.beginning || g.state.phase !== 'lobby') return;
    g.beginning = true;
    const projectId = g.state.projectId;
    try {
      const stills = await data.drawStills(projectId, g.state.timeline, deps.rng);
      if (games.get(projectId) !== g) return;
      if (!stills) return end(g, 'no-stills');
      g.state = L.begin(g.state, stills, now());
      broadcast(g);
      schedule(g);
    } catch (e) {
      log('sceneGuess: drawing stills failed:', e && e.message);
      if (games.get(projectId) === g) end(g, 'error');
    } finally {
      g.beginning = false;
    }
  }

  function reveal(g) {
    g.state = L.reveal(g.state, now());
    broadcast(g);
    schedule(g);
  }

  // Everyone still here has locked in → no need to wait for the buzzer.
  function maybeEarlyReveal(g) {
    const s = g.state;
    if (s.phase !== 'round') return false;
    const present = s.order.filter(id => !g.awayUntil.has(id));
    if (!present.length || !present.every(id => s.players[id].guesses[s.round])) return false;
    reveal(g);
    return true;
  }

  function advance(g) {
    g.state = L.next(g.state, now());
    if (g.state.phase === 'results') return finish(g);
    broadcast(g);
    schedule(g);
  }

  // Results: save every finisher's game, decide the record, then show it.
  async function finish(g) {
    schedule(g);
    const projectId = g.state.projectId;
    let record = null;
    try {
      record = await persist(g);
    } catch (e) {
      log('sceneGuess: saving scores failed:', e && e.message);
    }
    if (games.get(projectId) !== g) return;
    if (record) g.state = Object.assign({}, g.state, { record });
    broadcast(g);
    if (record) {
      emitTo(targets(g), 'world:sg-fanfare', { projectId, kind: 'record', username: record.username, score: record.score });
    }
  }

  async function persist(g) {
    const s = g.state, projectId = s.projectId, t = now();
    const rank = L.ranking(s);
    if (!rank.length) return null;
    const before = (await data.champions.get()).get(projectId) || null;
    const stillIds = s.stills.map(x => x.id);
    const { SceneScore, User } = deps.models;
    for (let i = 0; i < rank.length; i++) {
      const r = rank[i];
      // A user deleted mid-game (their grace still running) must not come back as a score row.
      if (!(await User.exists({ _id: r.userId }))) continue;
      // Staggered by rank so two equal totals keep this game's tie-break in the DB.
      const achievedAt = new Date(t + i);
      const pick = stillIds[L.bestRound(s.players[r.userId].guesses)] || null;
      const up = await SceneScore.updateOne(
        { userId: r.userId, projectId, best: { $lt: r.total } },
        { $set: { best: r.total, achievedAt, bestStills: stillIds, pick }, $inc: { plays: 1 } }
      );
      if (up && up.matchedCount) continue;
      try {
        await SceneScore.updateOne(
          { userId: r.userId, projectId },
          { $inc: { plays: 1 }, $setOnInsert: { best: r.total, achievedAt, bestStills: stillIds, pick } },
          { upsert: true }
        );
      } catch (e) {
        if (!e || e.code !== 11000) throw e;
        await SceneScore.updateOne({ userId: r.userId, projectId }, { $inc: { plays: 1 } });
      }
    }
    data.invalidate('board', projectId);
    const winner = L.newRecord(before ? { score: before.score } : null, rank);
    if (!winner) return null;
    return {
      username: winner.username,
      score: winner.total,
      previous: before ? before.score : null,
      previousHolder: before ? before.username : null
    };
  }

  function end(g, reason) {
    const projectId = g.state.projectId;
    if (games.get(projectId) !== g) return;
    games.delete(projectId);
    g.seq++;
    if (g.timer) clearT(g.timer);
    g.timer = null;
    emitTo(targets(g), 'world:sg-state', idlePayload(projectId, reason));
    announceLive(g, false);
  }

  // Someone leaves for good (Quit, or their grace ran out elsewhere).
  function dropPlayer(g, userId) {
    g.sockets.delete(userId);
    g.awayUntil.delete(userId);
    g.state = L.leave(g.state, userId);
    if (g.state.phase === 'over') return end(g, 'empty');
    if (maybeEarlyReveal(g)) return;
    broadcast(g);
    schedule(g);
  }

  // ── client events ──

  function check(socket, raw, reply, rateKey) {
    const p = world.players.get(socket.id);
    if (!p) { reply({ ok: false, error: 'not-joined' }); return null; }
    if (!data.enabledSync()) { reply({ ok: false, error: 'off' }); return null; }
    if (!world.rateOk(socket, rateKey)) { reply({ ok: false, error: 'slow-down' }); return null; }
    const projectId = raw && raw.projectId;
    if (typeof projectId !== 'string' || projectId.length > 80) { reply({ ok: false, error: 'bad' }); return null; }
    return { p, projectId };
  }

  function onStart(socket, raw, reply) {
    const c = check(socket, raw, reply, 'sgStart');
    if (!c) return;
    const { p, projectId } = c;
    if (world.zoneOf(socket, p) !== projectId) return reply({ ok: false, error: 'not-here' });
    if (!live(projectId)) return reply({ ok: false, error: 'not-live' });
    if (games.has(projectId)) return join(socket, p, projectId, reply);
    if (gameOfUser(p.userId)) return reply({ ok: false, error: 'busy' });
    const tl = L.timeline(data.projectSync(projectId));
    if (!tl) return reply({ ok: false, error: 'not-live' });
    const g = {
      state: L.createLobby({ projectId, userId: p.userId, username: p.username, now: now(), roundMs: L.roundMsFrom(data.roundSecSync()), timeline: tl }),
      sockets: new Map([[String(p.userId), socket.id]]),
      awayUntil: new Map(),
      timer: null,
      seq: 0,
      beginning: false
    };
    games.set(projectId, g);
    world.touchStay(p);
    reply({ ok: true });
    broadcast(g);
    announceLive(g, true);
    schedule(g);
  }

  function onJoin(socket, raw, reply) {
    const c = check(socket, raw, reply, 'sgJoin');
    if (!c) return;
    if (world.zoneOf(socket, c.p) !== c.projectId) return reply({ ok: false, error: 'not-here' });
    join(socket, c.p, c.projectId, reply);
  }

  function join(socket, p, projectId, reply) {
    const g = games.get(projectId);
    if (!g) return reply({ ok: false, error: 'no-game' });
    const userId = String(p.userId);
    if (L.hasPlayer(g.state, userId)) {
      g.sockets.set(userId, socket.id);
      g.awayUntil.delete(userId);
      reply({ ok: true });
      return broadcast(g);
    }
    if (gameOfUser(userId)) return reply({ ok: false, error: 'busy' });
    const r = L.join(g.state, userId, p.username);
    if (!r.ok) return reply({ ok: false, error: r.error });
    g.state = r.state;
    g.sockets.set(userId, socket.id);
    world.touchStay(p);
    reply({ ok: true });
    broadcast(g);
  }

  function onLeave(socket, raw, reply) {
    const hit = gameOfSocket(socket.id);
    if (!hit) return reply({ ok: false, error: 'not-playing' });
    reply({ ok: true });
    dropPlayer(hit.g, hit.userId);
  }

  function onGo(socket, raw, reply) {
    const hit = gameOfSocket(socket.id);
    if (!hit) return reply({ ok: false, error: 'not-playing' });
    if (hit.g.state.phase !== 'lobby') return reply({ ok: false, error: 'started' });
    if (hit.g.state.host !== hit.userId) return reply({ ok: false, error: 'not-host' });
    reply({ ok: true });
    begin(hit.g);
  }

  function onGuess(socket, raw, reply) {
    const hit = gameOfSocket(socket.id);
    if (!hit) return reply({ ok: false, error: 'not-playing' });
    if (!world.rateOk(socket, 'sgGuess')) return reply({ ok: false, error: 'slow-down' });
    const round = raw && raw.round, at = raw && raw.at;
    if (!Number.isInteger(round) || typeof at !== 'number') return reply({ ok: false, error: 'bad' });
    const r = L.guess(hit.g.state, hit.userId, round, at, now());
    if (!r.ok) return reply({ ok: false, error: r.error });
    hit.g.state = r.state;
    const p = world.players.get(socket.id);
    if (p) world.touchStay(p);
    reply({ ok: true });
    if (!maybeEarlyReveal(hit.g)) broadcast(hit.g);
  }

  // The champion picks which still of their record game the island screen
  // shows between games (an index into SceneScore.bestStills).
  async function onPick(socket, raw, reply) {
    const c = check(socket, raw, reply, 'sgMisc');
    if (!c) return;
    const index = raw.index;
    if (!Number.isInteger(index) || index < 0 || index >= L.C.ROUNDS) return reply({ ok: false, error: 'bad' });
    try {
      const champ = (await data.champions.get()).get(c.projectId);
      if (!champ || champ.userId !== String(c.p.userId)) return reply({ ok: false, error: 'not-champion' });
      const { SceneScore } = deps.models;
      const row = await SceneScore.findOne({ userId: c.p.userId, projectId: c.projectId }).select('bestStills').lean();
      const stillId = row && Array.isArray(row.bestStills) ? row.bestStills[index] : null;
      if (!stillId) return reply({ ok: false, error: 'bad' });
      await SceneScore.updateOne({ userId: c.p.userId, projectId: c.projectId }, { $set: { pick: stillId } });
      data.invalidate('board', c.projectId);
      reply({ ok: true });
    } catch (e) {
      log('sceneGuess: pick failed:', e && e.message);
      reply({ ok: false, error: 'error' });
    }
  }

  // The current game on an island (or idle) — after a reload / reconnect.
  function onSync(socket, raw, reply) {
    const c = check(socket, raw, reply, 'sgMisc');
    if (!c) return;
    const g = games.get(c.projectId);
    reply({ ok: true });
    socket.emit('world:sg-state', g ? payload(g) : idlePayload(c.projectId, null));
  }

  // ── hooks from routes/world-socket.js ──

  function attach(_io, _world) {
    io = _io;
    world = _world;
    data.prime();
    // Admin changes reach every client at once (debounced: a batch upload
    // fires one 'pool' event per still).
    let islandsTimer = null, recordsTimer = null;
    const soon = (fn, timer) => { if (timer) clearT(timer); const t = setT(fn, 300); if (t && t.unref) t.unref(); return t; };
    const onIslands = () => { islandsTimer = soon(() => { islandsTimer = null; broadcastIslands(); }, islandsTimer); };
    data.events.on('settings', onIslands);
    data.events.on('islands', onIslands);
    data.events.on('pool', onIslands);
    data.events.on('projects', onIslands);
    data.events.on('board', () => { recordsTimer = soon(() => { recordsTimer = null; broadcastRecords(); }, recordsTimer); });
  }

  async function broadcastIslands() {
    try {
      const s = await data.settings.get();
      const islands = s.enabled ? await data.liveIslands() : [];
      if (io) io.to('world').emit('world:sg-islands', { enabled: !!s.enabled, islands });
      for (const g of [...games.values()]) if (!s.enabled || !islands.includes(g.state.projectId)) end(g, 'disabled');
    } catch (e) { log('sceneGuess: islands broadcast failed:', e && e.message); }
  }

  async function broadcastRecords() {
    try {
      if (!io || !data.enabledSync()) return;
      const champs = await data.champions.get();
      const records = {};
      for (const [pid, c] of champs) records[pid] = data.publicRecord(c);
      io.to('world').emit('world:sg-records', { records });
    } catch (e) { log('sceneGuess: records broadcast failed:', e && e.message); }
  }

  function register(socket) {
    const on = (event, fn) => socket.on(event, (raw, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        const r = fn(socket, raw, reply);
        if (r && typeof r.catch === 'function') r.catch(e => { log('sceneGuess:', event, e); reply({ ok: false, error: 'error' }); });
      } catch (e) {
        log('sceneGuess:', event, e);
        reply({ ok: false, error: 'error' });
      }
    });
    on('world:sg-start', onStart);
    on('world:sg-join', onJoin);
    on('world:sg-leave', onLeave);
    on('world:sg-go', onGo);
    on('world:sg-guess', onGuess);
    on('world:sg-pick', onPick);
    on('world:sg-sync', onSync);
  }

  // A player's island changed (world:pos). Shows them the new island's game;
  // starts the zone grace for a player who walked out of theirs; the
  // island's champion gets their arrival fanfare.
  function onZone(socket, p, prev, next) {
    const t = now();
    const userId = String(p.userId);
    if (prev && prev !== next) {
      const g = games.get(prev);
      if (g && L.hasPlayer(g.state, userId) && g.sockets.get(userId) === socket.id) {
        g.awayUntil.set(userId, t + L.C.ZONE_GRACE_MS);
        broadcast(g);
        schedule(g);
      }
    }
    if (next) {
      const g = games.get(next);
      if (g) {
        if (L.hasPlayer(g.state, userId)) {
          g.sockets.set(userId, socket.id);
          if (g.awayUntil.delete(userId)) { broadcast(g); schedule(g); }
        }
        sendState(socket, g);
      }
      arrival(socket, p, next, t);
    }
  }

  function arrival(socket, p, projectId, t) {
    if (!live(projectId)) return;
    const champ = data.champions.peek().get(projectId);
    if (!champ || champ.userId !== String(p.userId)) return;
    const key = champ.userId + '|' + projectId;
    if (t - (arrivals.get(key) || -Infinity) < L.C.ARRIVE_COOLDOWN_MS) return;
    arrivals.set(key, t);
    if (arrivals.size > 1000) {
      for (const [k, at] of arrivals) if (t - at >= L.C.ARRIVE_COOLDOWN_MS) arrivals.delete(k);
    }
    emitTo(islandSockets(projectId), 'world:sg-arrived', { projectId, username: p.username, id: socket.id });
  }

  // Disconnect, or retired by a newer tab: keep the seat for the grace.
  function socketGone(sid) {
    const hit = gameOfSocket(sid);
    if (!hit) return;
    hit.g.sockets.set(hit.userId, null);
    hit.g.awayUntil.set(hit.userId, now() + L.C.RECONNECT_GRACE_MS);
    if (maybeEarlyReveal(hit.g)) return;
    broadcast(hit.g);
    schedule(hit.g);
  }

  // A newer tab took over this user's presence: the old tab's HUD closes.
  function retire(sid) {
    const hit = gameOfSocket(sid);
    if (!hit) return;
    if (io) io.to(sid).emit('world:sg-state', idlePayload(hit.g.state.projectId, 'moved'));
    socketGone(sid);
  }

  // world:join — the same user back on a new socket takes their seat again.
  function resume(socket) {
    const g = gameOfUser(socket.data.userId);
    if (!g) return;
    const userId = String(socket.data.userId);
    g.sockets.set(userId, socket.id);
    g.awayUntil.delete(userId);
    broadcast(g);
    sendState(socket, g);
    schedule(g);
  }

  // For REST (routes/world.js): islands with a game on → host username.
  function liveSnapshot() {
    const out = {};
    for (const [pid, g] of games) out[pid] = hostName(g);
    return out;
  }

  return {
    attach, register, onZone, socketGone, retire, resume,
    isPlaying, liveSnapshot,
    // tests / debugging
    _games: games, _broadcastIslands: broadcastIslands, _broadcastRecords: broadcastRecords
  };
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
