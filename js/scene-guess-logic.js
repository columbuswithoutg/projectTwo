/************************************************
 * SCENE GUESS LOGIC — pure, dependency-free helpers
 *
 * The rules of the /world "Scene Guess" minigame: a still from the island's
 * project is shown, every player marks on a timeline when they think it
 * happens, and scores by how close they land. Shared by:
 *
 *   server/scene-guess.js          — the authoritative game (reducers run here)
 *   routes/admin-scenes.js         — validates the admin's still times
 *   js/scene-guess.js              — the HUD (timeline maths, formatting)
 *   js/views/admin/cms-scenes.js   — the admin editor (time parsing/validation)
 *
 * Times on the wire are GLOBAL seconds along the guessing line: a movie's
 * line is its runtime; a series lays its episodes end to end (E1 | E2 | …),
 * so one number picks both the episode and the moment.
 *
 * Every function is pure and takes `now` explicitly. Game records are never
 * mutated — reducers return copies (test/scene-guess.test.js checks).
 *
 * UMD-ish: window.SceneGuessLogic in the browser, module.exports under Node
 * (same pattern as world-stay-logic.js).
 ************************************************/
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SceneGuessLogic = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const C = {
    ROUNDS: 10,                 // stills per game
    MIN_POOL: 10,               // an island is playable once it has this many active stills
    MAX_PLAYERS: 6,
    MAX_POINTS: 1000,           // per still
    PERFECT_S: 10,              // within this many seconds = full marks (absorbs version offsets)
    DECAY_S: 600,               // beyond that, points fall by e^-1 every 10 minutes
    LOBBY_MS: 15000,            // join window after someone presses Play
    READY_MS: 3000,             // "get ready" — every client preloads the 10 stills
    ROUND_MS: 30000,            // default round length; admin config world.sceneRoundSec overrides
    ROUND_SEC_MIN: 15,
    ROUND_SEC_MAX: 60,
    REVEAL_MS: 5000,
    RESULTS_MS: 10000,
    LATE_GRACE_MS: 500,         // a guess this far past the buzzer still counts (latency)
    AUTO_LOCK_LEAD_MS: 300,     // the HUD sends a placed marker this long before the buzzer
    RECONNECT_GRACE_MS: 20000,  // a dropped player may come back this long
    ZONE_GRACE_MS: 5000,        // …and someone who steps off the island this long (edge jitter)
    ARRIVE_COOLDOWN_MS: 10 * 60 * 1000,   // "the champion has arrived" at most this often per island
    TIME_SLACK_S: 59,           // runtimes are whole minutes, so a still may sit ≤ 59 s past the listed end
    TICK_S: 15 * 60             // movie timeline tick spacing
  };

  const PHASES = ['lobby', 'ready', 'round', 'reveal', 'results', 'over'];

  // ── time ──────────────────────────────────────────────────────────────

  // "1:02:13" (h:mm:ss) | "62:13" (m:ss) | "3733" (seconds) → whole seconds,
  // or null. Minutes/seconds after the first part must be two digits so a
  // typo like "1:2" is refused rather than guessed at.
  function parseTime(input) {
    if (typeof input === 'number') return Number.isFinite(input) && input >= 0 ? Math.floor(input) : null;
    if (typeof input !== 'string') return null;
    const s = input.trim();
    if (!s) return null;
    if (/^\d{1,6}$/.test(s)) return parseInt(s, 10);
    const m = /^(\d{1,3}):([0-5]\d)(?::([0-5]\d))?$/.exec(s);
    if (!m) return null;
    if (m[3] != null) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
    return (+m[1]) * 60 + (+m[2]);
  }

  // 3733 → "1:02:13"; 754 → "12:34".
  function formatTime(sec) {
    const t = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    const ss = String(s).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  }

  // ── the guessing line ─────────────────────────────────────────────────

  // { kind: 'movie'|'series', total, segments: [{ start, len, label }] } in
  // seconds, from a project record (runtime minutes, or episodes[] minutes).
  // null when the project has no usable length.
  function timeline(project) {
    if (!project) return null;
    const eps = Array.isArray(project.episodes) && project.episodes.length ? project.episodes : null;
    if (eps) {
      if (!eps.every(n => Number.isFinite(+n) && +n > 0)) return null;
      let start = 0;
      const segments = eps.map((min, i) => {
        const len = Math.round(+min) * 60;
        const seg = { start, len, label: 'E' + (i + 1) };
        start += len;
        return seg;
      });
      return { kind: 'series', total: start, segments };
    }
    const rt = Math.round(+project.runtime);
    if (!(rt > 0)) return null;
    return { kind: 'movie', total: rt * 60, segments: [{ start: 0, len: rt * 60, label: '' }] };
  }

  // A still's (episode, time-within-episode) → global seconds on the line.
  // Times past the segment end (the ≤ 59 s rounding slack) clamp to it.
  function toGlobal(tl, episode, t) {
    if (!tl) return null;
    const seg = tl.kind === 'series' ? tl.segments[episode] : tl.segments[0];
    if (!seg) return null;
    const x = Number(t);
    if (!Number.isFinite(x)) return null;
    return seg.start + Math.max(0, Math.min(seg.len, x));
  }

  // Global seconds → { episode (null for a movie), t }.
  function fromGlobal(tl, g) {
    const x = Math.max(0, Math.min(tl.total, Number(g) || 0));
    const segs = tl.segments;
    for (let i = 0; i < segs.length; i++) {
      if (x < segs[i].start + segs[i].len || i === segs.length - 1) {
        return { episode: tl.kind === 'series' ? i : null, t: x - segs[i].start };
      }
    }
    return { episode: null, t: x };
  }

  // "E3 · 12:34" on a series line, "1:02:13" on a movie line.
  function formatGuess(tl, g) {
    const p = fromGlobal(tl, g);
    return tl.kind === 'series' ? `${tl.segments[p.episode].label} · ${formatTime(p.t)}` : formatTime(p.t);
  }

  // Move a marker by `deltaSec`, clamped to the line.
  function nudge(tl, g, deltaSec) {
    return Math.max(0, Math.min(tl.total, (Number(g) || 0) + deltaSec));
  }

  // PgUp/PgDn on a series: the same moment in the next/previous episode
  // (clamped to that episode's length). A movie line doesn't move.
  function stepEpisode(tl, g, dir) {
    if (tl.kind !== 'series') return g;
    const p = fromGlobal(tl, g);
    const i = Math.max(0, Math.min(tl.segments.length - 1, p.episode + (dir < 0 ? -1 : 1)));
    const seg = tl.segments[i];
    return seg.start + Math.min(seg.len, p.t);
  }

  // Tick marks under the line: every 15 min on a movie, episode starts on a series.
  function ticks(tl) {
    if (tl.kind === 'series') return tl.segments.map(s => ({ at: s.start, label: s.label }));
    const out = [];
    for (let at = 0; at <= tl.total; at += C.TICK_S) out.push({ at, label: formatTime(at) });
    return out;
  }

  // Admin check for one still: { ok } or { ok:false, error }.
  function validStill(tl, still) {
    if (!tl) return { ok: false, error: 'This project has no runtime yet — set it in CMS → Projects first.' };
    const t = still ? still.timeSec : null;
    if (!Number.isInteger(t) || t < 0) return { ok: false, error: 'Enter the time as h:mm:ss, m:ss or seconds.' };
    let seg;
    if (tl.kind === 'series') {
      const ep = still.episode;
      if (!Number.isInteger(ep) || ep < 0 || ep >= tl.segments.length) {
        return { ok: false, error: `Pick an episode (1–${tl.segments.length}).` };
      }
      seg = tl.segments[ep];
    } else {
      if (still.episode != null) return { ok: false, error: 'Movies have no episodes.' };
      seg = tl.segments[0];
    }
    if (t > seg.len + C.TIME_SLACK_S) {
      return { ok: false, error: `That's past the end (${formatTime(seg.len)}).` };
    }
    return { ok: true };
  }

  // ── scoring ───────────────────────────────────────────────────────────

  // Points for a guess `errSec` seconds off: full marks inside PERFECT_S,
  // then an exponential fall-off (1 min ≈ 920, 5 min ≈ 620, 10 min ≈ 370).
  function score(errSec) {
    const e = Math.abs(Number(errSec));
    if (!Number.isFinite(e)) return 0;
    if (e <= C.PERFECT_S) return C.MAX_POINTS;
    return Math.round(C.MAX_POINTS * Math.exp(-(e - C.PERFECT_S) / C.DECAY_S));
  }

  // `n` distinct items from `pool` (Fisher–Yates on a copy); null when the
  // pool is too small. `rng` defaults to Math.random (tests pass a seeded one).
  function pickStills(pool, n, rng) {
    const r = typeof rng === 'function' ? rng : Math.random;
    if (!Array.isArray(pool) || pool.length < n) return null;
    const a = pool.slice();
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(r() * (a.length - i));
      const tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a.slice(0, n);
  }

  // Clamp an admin round length (seconds) → ms.
  function roundMsFrom(sec) {
    const s = Math.round(Number(sec));
    if (!Number.isFinite(s)) return C.ROUND_MS;
    return Math.max(C.ROUND_SEC_MIN, Math.min(C.ROUND_SEC_MAX, s)) * 1000;
  }

  // ── the game (server-authoritative reducers) ──────────────────────────
  //
  // state = {
  //   projectId, phase, host (userId), deadline (ms, end of this phase),
  //   roundMs, timeline, round (-1 before the first), roundStartedAt,
  //   stills: [{ id, url, answer (global s) }] — answers never leave the server
  //   order: [userId…] (join order), players: { userId: {
  //     username, guesses: [{ at, points, lockMs } | null] × ROUNDS, total, lockMs } },
  //   record: { username, score, previous } | null (set by the server at results)
  // }

  function _copy(state, patch) { return Object.assign({}, state, patch); }
  function _copyPlayers(state) {
    const out = {};
    for (const id of Object.keys(state.players)) out[id] = Object.assign({}, state.players[id]);
    return out;
  }
  function _newPlayer(username) {
    return { username, guesses: new Array(C.ROUNDS).fill(null), total: 0, lockMs: 0 };
  }

  // Someone pressed Play: a lobby with them as host.
  function createLobby(o) {
    const host = String(o.userId);
    return {
      projectId: o.projectId,
      phase: 'lobby',
      host,
      createdAt: o.now,
      deadline: o.now + C.LOBBY_MS,
      roundMs: o.roundMs || C.ROUND_MS,
      timeline: o.timeline,
      round: -1,
      roundStartedAt: 0,
      stills: [],
      order: [host],
      players: { [host]: _newPlayer(o.username) },
      record: null
    };
  }

  function playerCount(state) { return state.order.length; }
  function hasPlayer(state, userId) { return Object.prototype.hasOwnProperty.call(state.players, String(userId)); }

  // Join during the lobby. Idempotent for someone already in.
  function join(state, userId, username) {
    const id = String(userId);
    if (state.phase !== 'lobby') return { ok: false, error: 'started' };
    if (hasPlayer(state, id)) return { ok: true, state };
    if (playerCount(state) >= C.MAX_PLAYERS) return { ok: false, error: 'full' };
    const players = _copyPlayers(state);
    players[id] = _newPlayer(username);
    return { ok: true, state: _copy(state, { players, order: state.order.concat(id) }) };
  }

  // A player quits / drops for good. The host role passes on in join order;
  // with nobody left the game is over.
  function leave(state, userId) {
    const id = String(userId);
    if (!hasPlayer(state, id)) return state;
    const players = _copyPlayers(state);
    delete players[id];
    const order = state.order.filter(x => x !== id);
    const patch = { players, order };
    if (state.host === id && order.length) patch.host = order[0];
    if (!order.length) patch.phase = 'over';
    return _copy(state, patch);
  }

  // Lobby → "get ready" with the drawn stills ({ id, url, answer }).
  function begin(state, stills, now) {
    if (state.phase !== 'lobby') return state;
    return _copy(state, {
      phase: 'ready',
      stills: stills.map(s => ({ id: s.id, url: s.url, answer: s.answer })),
      deadline: now + C.READY_MS
    });
  }

  // "get ready" / reveal → the next round.
  function startRound(state, now) {
    if (state.phase !== 'ready' && state.phase !== 'reveal') return state;
    return _copy(state, {
      phase: 'round',
      round: state.round + 1,
      roundStartedAt: now,
      deadline: now + state.roundMs
    });
  }

  // A player locks in `at` (global seconds) for `round`. Points are worked
  // out now but only added to totals at the reveal, so a total jumping
  // mid-round can't tell onlookers how close someone was.
  function guess(state, userId, round, at, now) {
    const id = String(userId);
    if (state.phase !== 'round') return { ok: false, error: 'not-round' };
    if (round !== state.round) return { ok: false, error: 'wrong-round' };
    if (!hasPlayer(state, id)) return { ok: false, error: 'not-playing' };
    if (now > state.deadline + C.LATE_GRACE_MS) return { ok: false, error: 'too-late' };
    if (typeof at !== 'number' || !Number.isFinite(at) || at < 0 || at > state.timeline.total) {
      return { ok: false, error: 'bad-guess' };
    }
    const p = state.players[id];
    if (p.guesses[round]) return { ok: false, error: 'already' };
    const still = state.stills[round];
    const players = _copyPlayers(state);
    const guesses = p.guesses.slice();
    guesses[round] = {
      at: Math.round(at),
      points: score(at - still.answer),
      lockMs: Math.max(0, Math.min(state.roundMs, now - state.roundStartedAt))
    };
    players[id].guesses = guesses;
    return { ok: true, state: _copy(state, { players }) };
  }

  function allLocked(state) {
    if (state.phase !== 'round' || !state.order.length) return false;
    return state.order.every(id => !!state.players[id].guesses[state.round]);
  }

  // Round → reveal. A missing guess scores 0 and counts as the whole round
  // for the lock-in tie-break.
  function reveal(state, now) {
    if (state.phase !== 'round') return state;
    const players = _copyPlayers(state);
    for (const id of state.order) {
      const p = players[id];
      const guesses = p.guesses.slice();
      const g = guesses[state.round] || { at: null, points: 0, lockMs: state.roundMs };
      guesses[state.round] = g;
      p.guesses = guesses;
      p.total += g.points;
      p.lockMs += g.lockMs;
    }
    return _copy(state, { phase: 'reveal', players, deadline: now + C.REVEAL_MS });
  }

  // Reveal → next round, or the results after the last one.
  function next(state, now) {
    if (state.phase !== 'reveal') return state;
    if (state.round >= C.ROUNDS - 1) return _copy(state, { phase: 'results', deadline: now + C.RESULTS_MS });
    return startRound(state, now);
  }

  // Final standings: total ↓, then total lock-in time ↑, then join order.
  function ranking(state) {
    return state.order
      .map((id, i) => ({ userId: id, username: state.players[id].username, total: state.players[id].total, lockMs: state.players[id].lockMs, i }))
      .sort((a, b) => (b.total - a.total) || (a.lockMs - b.lockMs) || (a.i - b.i))
      .map(({ i, ...r }) => r);
  }

  // The round a player scored best in (first on ties) — their default
  // "champion's pick" still. 0 when nothing was guessed.
  function bestRound(guesses) {
    let best = 0, bestPts = -1;
    (guesses || []).forEach((g, i) => {
      const pts = g ? g.points : -1;
      if (pts > bestPts) { bestPts = pts; best = i; }
    });
    return best;
  }

  // Does this game's winner take the island record? `champion` is the
  // standing record ({ score } | null). Strictly greater wins — a tie keeps
  // the earlier record. Returns the new holder's ranking row, or null.
  function newRecord(champion, rank) {
    const top = rank && rank[0];
    if (!top || !(top.total > 0)) return null;
    const bar = champion && typeof champion.score === 'number' ? champion.score : 0;
    return top.total > bar ? top : null;
  }

  // What everyone on the island may see. Answers appear only for rounds
  // that have been revealed; usernames only, never userIds.
  function publicState(state) {
    const revealedUpTo = state.phase === 'round' ? state.round - 1
      : (state.phase === 'reveal' || state.phase === 'results' || state.phase === 'over') ? state.round : -1;
    const history = [];
    for (let r = 0; r <= revealedUpTo; r++) {
      const still = state.stills[r];
      if (!still) break;
      history.push({
        round: r,
        answer: still.answer,
        label: formatGuess(state.timeline, still.answer),
        guesses: state.order.map(id => {
          const g = state.players[id].guesses[r];
          return { username: state.players[id].username, at: g ? g.at : null, points: g ? g.points : 0 };
        })
      });
    }
    const out = {
      projectId: state.projectId,
      phase: state.phase,
      host: state.players[state.host] ? state.players[state.host].username : null,
      of: C.ROUNDS,
      round: state.round,
      deadline: state.deadline,
      roundMs: state.roundMs,
      max: C.MAX_PLAYERS,
      timeline: state.timeline,
      players: state.order.map(id => ({
        username: state.players[id].username,
        locked: state.phase === 'round' && !!state.players[id].guesses[state.round],
        total: state.players[id].total
      })),
      stills: state.phase === 'lobby' ? [] : state.stills.map(s => s.url),
      history
    };
    if (state.phase === 'results' || state.phase === 'over') {
      out.ranking = ranking(state).map(r => ({ username: r.username, total: r.total }));
      out.record = state.record || null;
    }
    return out;
  }

  return {
    C, PHASES,
    parseTime, formatTime,
    timeline, toGlobal, fromGlobal, formatGuess, nudge, stepEpisode, ticks, validStill,
    score, pickStills, roundMsFrom,
    createLobby, join, leave, begin, startRound, guess, allLocked, reveal, next,
    ranking, bestRound, newRecord, publicState, playerCount, hasPlayer
  };
});
