/************************************************
 * WORLD NPC LOGIC — pure, dependency-free helpers
 *
 * The rules behind the Avengers NPC fights in /world: hit points per hero,
 * knock-out and get-up, out-of-combat healing, and "who is the hero angry
 * at". Shared by BOTH ends of the wire:
 *
 *   routes/world-socket.js   — the authoritative copy of every hero's state
 *                              (reducers below run on the server)
 *   js/playground3d.js       — renders from the server's broadcasts, and uses
 *                              the same tables for bars / clips / phases
 *
 * Every function is pure and takes `now` explicitly (server: Date.now();
 * client: whichever clock it converted the record to), so test/npc.test.js
 * can drive time by hand. Records are never mutated — reducers return copies.
 *
 * UMD-ish: attaches to window.WorldNpcLogic in the browser, exports via
 * module.exports under Node (same pattern as playground3d-physics.js).
 ************************************************/
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WorldNpcLogic = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // Ids are 'npc_' + Playground.CHARACTER_PRESETS[].id (js/views/world.js).
  const NPC_IDS = ['npc_ironman', 'npc_cap', 'npc_thor', 'npc_hulk', 'npc_widow', 'npc_hawkeye'];

  // One punch = one hit point. Ordered by how much the films let each of
  // them take: gamma-powered, Asgardian, armoured, super-soldier, then the
  // two unpowered humans.
  const NPC_STATS = {
    npc_hulk:    { maxHp: 5 },
    npc_thor:    { maxHp: 4 },
    npc_ironman: { maxHp: 3 },
    npc_cap:     { maxHp: 3 },
    npc_widow:   { maxHp: 2 },
    npc_hawkeye: { maxHp: 2 }
  };

  const C = {
    KO_MS: 8000,                  // lying knocked out after the last hit point
    KO_GETUP_MS: 1500,            // client-side get-up clip after KO_MS (Death01 reversed at 1.6×)
    AGGRO_MS: 6000,               // stays angry this long after the last hit
    HEAL_MS: 12000,               // back to full this long after the last hit (when calm)
    NPC_PUNCH_COOLDOWN_MS: 1400,  // floor between a hero's swings (server-enforced)
    NPC_FIRST_SWING_MS: 650,      // wind-up before the first counter-punch (flinch shows first)
    NPC_GRACE_MS: 900,            // after knocking its target down, lets them get up and swing first
    NPC_PUNCH_RANGE: 1.6,         // a little over the player's PUNCH.RANGE (1.4)
    NPC_PUNCH_ANIM_MS: 450,       // how long the swing overlay plays client-side
    HIT_MS: 380,                  // flinch overlay window client-side
    NPC_RETURN_SPEED: 2.2,        // walking back onto the patrol path, units/sec
    TICK_MS: 500                  // server timer cadence while anyone is fighting
  };

  function _rec(id) {
    const s = NPC_STATS[id];
    return {
      hp: s.maxHp, maxHp: s.maxHp,
      target: null,       // socket id the hero is squaring up to (most recent hitter)
      lastHitAt: 0,
      // The patrol is a pure function of the shared clock. While a hero is
      // held (fighting, out cold, getting up) its clock is PAUSED: stopAt is
      // the shared-clock ms it stopped at, and pathOffsetMs accumulates every
      // pause, so afterwards it resumes from the exact spot it stopped.
      // Clients evaluate the path at (stopAt || now) - pathOffsetMs.
      stopAt: 0,
      pathOffsetMs: 0,
      koUntil: 0,         // > now while knocked out (lying)
      getupUntil: 0,      // > now while getting back up after a KO
      aggroUntil: 0,      // > now while angry
      lastSwingAt: 0      // last accepted swing at its target
    };
  }

  // Un-pause the patrol clock: bank the time spent held.
  function _release(npc, now) {
    return {
      pathOffsetMs: (npc.pathOffsetMs || 0) + (npc.stopAt ? Math.max(0, now - npc.stopAt) : 0),
      stopAt: 0
    };
  }

  function initialNpcState() {
    const out = {};
    for (const id of NPC_IDS) out[id] = _rec(id);
    return out;
  }

  // Wire shape sent to clients (snapshot on join + per-update).
  function snapshot(state) {
    const out = {};
    for (const id of NPC_IDS) {
      const n = state[id];
      if (!n) continue;
      out[id] = {
        hp: n.hp, maxHp: n.maxHp, target: n.target, stopAt: n.stopAt, pathOffsetMs: n.pathOffsetMs || 0,
        koUntil: n.koUntil, getupUntil: n.getupUntil || 0, aggroUntil: n.aggroUntil
      };
    }
    return out;
  }

  // A punch landed. Returns { npc, event } — event null means the hit was
  // rejected (the hero is already out cold). The most recent hitter becomes
  // the target, so when players gang up the hero squares up to whoever hit
  // last (and swing authority moves to a client that's actually in reach).
  function applyHit(npc, bySocket, now) {
    if (npc.koUntil > now) return { npc, event: null };
    const next = Object.assign({}, npc);
    next.hp = Math.max(0, npc.hp - 1);
    next.lastHitAt = now;
    if (next.hp === 0) {
      next.koUntil = now + C.KO_MS;
      next.target = null;
      next.aggroUntil = 0;
      next.stopAt = npc.stopAt || now;   // falls where it stood
      return { npc: next, event: 'ko' };
    }
    next.target = bySocket || null;
    next.aggroUntil = now + C.AGGRO_MS;
    next.stopAt = npc.stopAt || now;     // first hit of the episode stamps the hold point
    return { npc: next, event: 'hit' };
  }

  // Time passing. Returns { npc, events } with zero or more of
  // 'getup' | 'resume' | 'aggro-expire' | 'heal'.
  function tickNpc(npc, now) {
    let next = npc;
    const events = [];
    if (npc.koUntil && now >= npc.koUntil) {
      // Back to full and standing up; the patrol stays paused until the
      // get-up clip has finished ('resume'), so it doesn't walk off mid-rise.
      next = Object.assign({}, next, { koUntil: 0, hp: next.maxHp, target: null, aggroUntil: 0, getupUntil: npc.koUntil + C.KO_GETUP_MS });
      events.push('getup');
    }
    if (next.getupUntil && now >= next.getupUntil) {
      next = Object.assign({}, next, { getupUntil: 0 }, next.target ? {} : _release(next, now));
      events.push('resume');
    }
    if (next.target && now >= next.aggroUntil) {
      next = Object.assign({}, next, { target: null, aggroUntil: 0 }, next.getupUntil ? {} : _release(next, now));
      events.push('aggro-expire');
    }
    if (next.hp < next.maxHp && !next.target && !next.koUntil && now - next.lastHitAt >= C.HEAL_MS) {
      next = Object.assign({}, next, { hp: next.maxHp });
      events.push('heal');
    }
    return { npc: next, events };
  }

  // The hero's target left (disconnect / retired socket).
  function releaseTarget(npc, socketId, now) {
    if (!npc.target || npc.target !== socketId) return { npc, changed: false };
    const rel = npc.getupUntil ? {} : _release(npc, now == null ? npc.stopAt : now);
    return { npc: Object.assign({}, npc, { target: null, aggroUntil: 0 }, rel), changed: true };
  }

  // May the hero swing at `socketId` right now? (Server gate for world:npc-punch.)
  function canNpcSwing(npc, socketId, now) {
    if (!npc || !socketId || npc.target !== socketId) return false;
    if (npc.koUntil > now) return false;
    if (now >= npc.aggroUntil) return false;
    return now - (npc.lastSwingAt || 0) >= C.NPC_PUNCH_COOLDOWN_MS;
  }

  function npcCombatPhase(npc, now) {
    if (npc.koUntil > now) return 'ko';
    if (npc.getupUntil > now) return 'getup';
    if (npc.target && now < npc.aggroUntil) return 'aggro';
    return 'patrol';
  }

  // Shared-clock SECONDS to evaluate the patrol path at: frozen at stopAt
  // while held, and always shifted back by the time spent held so far.
  function npcPathTime(npc, sharedNowMs) {
    return ((npc.stopAt || sharedNowMs) - (npc.pathOffsetMs || 0)) / 1000;
  }

  function isIdle(npc, now) {
    return npc.hp === npc.maxHp && !npc.target && npc.koUntil <= now && !npc.getupUntil && !npc.stopAt;
  }
  function allIdle(state, now) {
    for (const id of NPC_IDS) if (state[id] && !isIdle(state[id], now)) return false;
    return true;
  }

  // Bar colour class from remaining fraction.
  function healthClass(hp, max) {
    const r = max > 0 ? hp / max : 0;
    if (r >= 0.67) return 'good';
    if (r >= 0.34) return 'warn';
    return 'low';
  }

  // Alternate jab / cross so a brawl doesn't loop one clip; mostly body
  // shots with the occasional head snap.
  function swingClip(count) { return count % 2 ? 'Punch_Cross' : 'Punch_Jab'; }
  function hitClip(seq) { return seq % 3 === 2 ? 'Hit_Head' : 'Hit_Chest'; }

  return {
    NPC_IDS, NPC_STATS, C,
    initialNpcState, snapshot, applyHit, tickNpc, releaseTarget, canNpcSwing,
    npcCombatPhase, npcPathTime, isIdle, allIdle, healthClass, swingClip, hitClip
  };
});
