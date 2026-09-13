/************************************************
 * Unit tests for js/world-npc-logic.js — the shared rules behind the
 * Avengers NPC fights in /world (HP, knock-out, healing, aggro).
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../js/world-npc-logic.js');

const T0 = 1_000_000;
const fresh = (id) => N.initialNpcState()[id];

test('NPC_STATS: the six OG Avengers with movie-durability hit points', () => {
  assert.deepEqual(N.NPC_IDS, ['npc_ironman', 'npc_cap', 'npc_thor', 'npc_hulk', 'npc_widow', 'npc_hawkeye']);
  const hp = Object.fromEntries(N.NPC_IDS.map(id => [id, N.NPC_STATS[id].maxHp]));
  assert.deepEqual(hp, { npc_hulk: 5, npc_thor: 4, npc_ironman: 3, npc_cap: 3, npc_widow: 2, npc_hawkeye: 2 });
  const s = N.initialNpcState();
  for (const id of N.NPC_IDS) {
    assert.equal(s[id].hp, s[id].maxHp);
    assert.equal(s[id].target, null);
    assert.equal(s[id].koUntil, 0);
    assert.equal(s[id].stopAt, 0);
  }
});

test('applyHit: one punch = one HP, sets target, stopAt and the aggro window', () => {
  const r = N.applyHit(fresh('npc_cap'), 'sockA', T0);
  assert.equal(r.event, 'hit');
  assert.equal(r.npc.hp, 2);
  assert.equal(r.npc.target, 'sockA');
  assert.equal(r.npc.stopAt, T0);
  assert.equal(r.npc.aggroUntil, T0 + N.C.AGGRO_MS);
  assert.equal(r.npc.lastHitAt, T0);
});

test('applyHit: stopAt is stamped on the first hit only; later hits keep it', () => {
  const a = N.applyHit(fresh('npc_hulk'), 'sockA', T0).npc;
  const b = N.applyHit(a, 'sockA', T0 + 900).npc;
  assert.equal(b.stopAt, T0);
  assert.equal(b.lastHitAt, T0 + 900);
  assert.equal(b.aggroUntil, T0 + 900 + N.C.AGGRO_MS, 'aggro window extends from the latest hit');
});

test('applyHit: the most recent hitter becomes the target', () => {
  const a = N.applyHit(fresh('npc_hulk'), 'sockA', T0).npc;
  const b = N.applyHit(a, 'sockB', T0 + 500).npc;
  assert.equal(b.target, 'sockB');
});

test('applyHit: the last hit point knocks the hero out and clears the target', () => {
  let n = fresh('npc_widow');
  n = N.applyHit(n, 'sockA', T0).npc;
  const r = N.applyHit(n, 'sockA', T0 + 700);
  assert.equal(r.event, 'ko');
  assert.equal(r.npc.hp, 0);
  assert.equal(r.npc.koUntil, T0 + 700 + N.C.KO_MS);
  assert.equal(r.npc.target, null);
  assert.equal(r.npc.aggroUntil, 0);
  assert.equal(r.npc.stopAt, T0, 'falls where it was already standing');
});

test('applyHit: rejected while knocked out; record untouched', () => {
  const ko = { ...fresh('npc_hawkeye'), hp: 0, koUntil: T0 + 5000 };
  const r = N.applyHit(ko, 'sockA', T0 + 100);
  assert.equal(r.event, null);
  assert.equal(r.npc, ko);
});

test('reducers are pure: inputs are never mutated', () => {
  const n = fresh('npc_thor');
  const before = JSON.stringify(n);
  N.applyHit(n, 'sockA', T0);
  N.tickNpc({ ...n, koUntil: T0 - 1, hp: 0 }, T0);
  N.releaseTarget({ ...n, target: 'x' }, 'x');
  assert.equal(JSON.stringify(n), before);
});

test('tickNpc: KO expires into a get-up at full HP; the patrol stays paused until the get-up ends', () => {
  let n = fresh('npc_widow');
  n = N.applyHit(n, 'a', T0).npc;
  n = N.applyHit(n, 'a', T0 + 1).npc;      // KO
  assert.deepEqual(N.tickNpc(n, n.koUntil - 1).events, []);
  const r = N.tickNpc(n, n.koUntil);
  assert.deepEqual(r.events, ['getup']);
  assert.equal(r.npc.hp, 2);
  assert.equal(r.npc.koUntil, 0);
  assert.equal(r.npc.getupUntil, n.koUntil + N.C.KO_GETUP_MS);
  assert.equal(r.npc.stopAt, T0, 'still held while standing up');
  // Get-up done → 'resume': stopAt cleared and the held time banked.
  const r2 = N.tickNpc(r.npc, r.npc.getupUntil);
  assert.deepEqual(r2.events, ['resume']);
  assert.equal(r2.npc.stopAt, 0);
  assert.equal(r2.npc.getupUntil, 0);
  assert.equal(r2.npc.pathOffsetMs, r.npc.getupUntil - T0);
});

test('tickNpc: aggro expires AGGRO_MS after the last hit → target cleared, patrol resumes from where it stopped', () => {
  const n = N.applyHit(fresh('npc_ironman'), 'a', T0).npc;
  assert.deepEqual(N.tickNpc(n, T0 + N.C.AGGRO_MS - 1).events, []);
  const r = N.tickNpc(n, T0 + N.C.AGGRO_MS);
  assert.deepEqual(r.events, ['aggro-expire']);
  assert.equal(r.npc.target, null);
  assert.equal(r.npc.stopAt, 0);
  assert.equal(r.npc.pathOffsetMs, N.C.AGGRO_MS, 'time held is banked');
  assert.equal(r.npc.hp, 2, 'still hurt');
});

test('npcPathTime: frozen at stopAt while held, shifted back by banked time afterwards', () => {
  const n = fresh('npc_cap');
  assert.equal(N.npcPathTime(n, T0), T0 / 1000);
  const held = N.applyHit(n, 'a', T0).npc;
  assert.equal(N.npcPathTime(held, T0 + 5000), T0 / 1000, 'held: path point does not move');
  const freed = N.tickNpc(held, T0 + N.C.AGGRO_MS).npc;
  assert.equal(N.npcPathTime(freed, T0 + N.C.AGGRO_MS), T0 / 1000, 'resumes from the exact hold point');
  assert.equal(N.npcPathTime(freed, T0 + N.C.AGGRO_MS + 1000), T0 / 1000 + 1);
  // A second episode stacks on the first.
  const held2 = N.applyHit(freed, 'b', T0 + 8000).npc;
  const freed2 = N.tickNpc(held2, T0 + 8000 + N.C.AGGRO_MS).npc;
  assert.equal(freed2.pathOffsetMs, 2 * N.C.AGGRO_MS);
});

test('tickNpc: heals to full HEAL_MS after the last hit, only once calm, never while KO’d', () => {
  const hurt = N.applyHit(fresh('npc_thor'), 'a', T0).npc;
  // Still angry at HEAL_MS? No — aggro expired at +6s, so at +12s both fire in one tick.
  const r = N.tickNpc(hurt, T0 + N.C.HEAL_MS);
  assert.deepEqual(r.events, ['aggro-expire', 'heal']);
  assert.equal(r.npc.hp, 4);
  // Calm but not yet HEAL_MS → no heal.
  const calm = N.tickNpc(hurt, T0 + N.C.AGGRO_MS).npc;
  assert.deepEqual(N.tickNpc(calm, T0 + N.C.HEAL_MS - 1).events, []);
  // Knocked out → the get-up restores HP, no separate heal.
  const ko = { ...fresh('npc_widow'), hp: 0, koUntil: T0 + N.C.KO_MS, lastHitAt: T0, stopAt: T0 };
  assert.deepEqual(N.tickNpc(ko, T0 + N.C.HEAL_MS).events, ['getup', 'resume']);
});

test('releaseTarget: clears only the matching socket and resumes the patrol', () => {
  const n = N.applyHit(fresh('npc_cap'), 'a', T0).npc;
  assert.equal(N.releaseTarget(n, 'b', T0 + 100).changed, false);
  const r = N.releaseTarget(n, 'a', T0 + 100);
  assert.equal(r.changed, true);
  assert.equal(r.npc.target, null);
  assert.equal(r.npc.stopAt, 0);
  assert.equal(r.npc.pathOffsetMs, 100);
});

test('canNpcSwing: needs the right target, not KO’d, aggro live, and the cooldown', () => {
  const n = N.applyHit(fresh('npc_cap'), 'a', T0).npc;
  assert.equal(N.canNpcSwing(n, 'a', T0 + 10), true);
  assert.equal(N.canNpcSwing(n, 'b', T0 + 10), false, 'not the target');
  assert.equal(N.canNpcSwing({ ...n, lastSwingAt: T0 }, 'a', T0 + N.C.NPC_PUNCH_COOLDOWN_MS - 1), false);
  assert.equal(N.canNpcSwing({ ...n, lastSwingAt: T0 }, 'a', T0 + N.C.NPC_PUNCH_COOLDOWN_MS), true);
  assert.equal(N.canNpcSwing({ ...n, koUntil: T0 + 100 }, 'a', T0 + 10), false, 'out cold');
  assert.equal(N.canNpcSwing(n, 'a', T0 + N.C.AGGRO_MS + 1), false, 'calmed down');
});

test('npcCombatPhase: patrol → aggro → ko → getup by time', () => {
  const calm = fresh('npc_hulk');
  assert.equal(N.npcCombatPhase(calm, T0), 'patrol');
  const angry = N.applyHit(calm, 'a', T0).npc;
  assert.equal(N.npcCombatPhase(angry, T0 + 10), 'aggro');
  assert.equal(N.npcCombatPhase(angry, T0 + N.C.AGGRO_MS), 'patrol');
  assert.equal(N.npcCombatPhase({ ...angry, koUntil: T0 + 100 }, T0 + 10), 'ko');
  assert.equal(N.npcCombatPhase({ ...calm, getupUntil: T0 + 100 }, T0 + 10), 'getup');
});

test('healthClass: thresholds across every roster maxHp', () => {
  assert.equal(N.healthClass(5, 5), 'good');
  assert.equal(N.healthClass(4, 5), 'good');
  assert.equal(N.healthClass(3, 5), 'warn');
  assert.equal(N.healthClass(2, 5), 'warn');
  assert.equal(N.healthClass(1, 5), 'low');
  assert.equal(N.healthClass(2, 3), 'warn');
  assert.equal(N.healthClass(1, 3), 'low');
  assert.equal(N.healthClass(1, 2), 'warn');
  assert.equal(N.healthClass(2, 2), 'good');
  assert.equal(N.healthClass(0, 2), 'low');
});

test('allIdle: true only when nobody is hurt, targeted or knocked out', () => {
  const s = N.initialNpcState();
  assert.equal(N.allIdle(s, T0), true);
  s.npc_cap = N.applyHit(s.npc_cap, 'a', T0).npc;
  assert.equal(N.allIdle(s, T0 + 10), false);
  assert.equal(N.isIdle({ ...fresh('npc_cap'), koUntil: T0 + 5 }, T0), false);
  assert.equal(N.isIdle({ ...fresh('npc_cap'), koUntil: T0 - 5 }, T0), true);
});

test('snapshot: wire shape carries hp/target/timers and nothing private', () => {
  const s = N.initialNpcState();
  s.npc_thor = { ...N.applyHit(s.npc_thor, 'a', T0).npc, lastSwingAt: 42 };
  const w = N.snapshot(s);
  assert.deepEqual(Object.keys(w.npc_thor).sort(), ['aggroUntil', 'getupUntil', 'hp', 'koUntil', 'maxHp', 'pathOffsetMs', 'stopAt', 'target']);
  assert.equal(w.npc_thor.hp, 3);
  assert.equal(w.npc_thor.target, 'a');
});

test('swingClip / hitClip alternate deterministically', () => {
  assert.deepEqual([0, 1, 2, 3].map(N.swingClip), ['Punch_Jab', 'Punch_Cross', 'Punch_Jab', 'Punch_Cross']);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(N.hitClip), ['Hit_Chest', 'Hit_Chest', 'Hit_Head', 'Hit_Chest', 'Hit_Chest', 'Hit_Head']);
});
