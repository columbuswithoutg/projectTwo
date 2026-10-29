/************************************************
 * Unit tests for js/quote-guess-logic.js — line validation (admin, import
 * and player suggestions), CSV / JSON import planning, export, the
 * playable rule, drawing a game's rounds, speed scoring and the game
 * reducers, plus what onlookers may see before each reveal.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../js/quote-guess-logic.js');

const MOVIE = { id: 'avengers1', title: 'The Avengers', runtime: 143 };
const SERIES = { id: 'wandavision', title: 'WandaVision', episodes: [29, 35, 33] };
const CHARACTERS = [{ id: 'ironman', name: 'Iron Man' }, { id: 'loki', name: 'Loki' }, { id: 'obadiah', name: 'Obadiah Stane / Iron Monger' }];
const T0 = 1_000_000;

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A bank of `n` lines over `speakers` people; every other line has a reply.
function bank(n, speakers, opts) {
  const o = opts || {};
  const names = Array.from({ length: speakers }, (_, i) => 'Person ' + String.fromCharCode(65 + i));
  return Array.from({ length: n }, (_, i) => {
    const sp = names[i % speakers];
    const rp = names[(i + 1) % speakers];
    const text = `Line number ${i} ${'x'.repeat(i % 7)}`;
    return {
      id: 'LID' + i,
      speaker: { name: sp, key: Q.norm(sp), characterId: null },
      text,
      textKey: Q.norm(text),
      reply: (o.noReplies || i % 2) ? null : { speaker: { name: rp, key: Q.norm(rp), characterId: null }, text: `Reply number ${i} ${'y'.repeat(i % 5)}` },
      note: 'scene ' + i,
      episode: null,
      decoys: { speakers: [], replies: [] },
      credit: i === 0 ? 'alex' : null
    };
  });
}

// ── text ──

test('norm folds case, accents, punctuation and curly apostrophes', () => {
  assert.equal(Q.norm('  I am Iron Man. '), 'i am iron man');
  assert.equal(Q.norm('I’m with you ’til the end'), 'im with you til the end');
  assert.equal(Q.norm("I'm with you 'til the end!"), 'im with you til the end');
  assert.equal(Q.norm('Café — déjà vu'), 'cafe deja vu');
  assert.equal(Q.cleanText('a\u0007 \n  b'), 'a b');
});

test('characterIndex links hero names, slash parts and civilian aliases', () => {
  const idx = Q.characterIndex(CHARACTERS);
  assert.equal(Q.linkCharacter('Iron Man', idx), 'ironman');
  assert.equal(Q.linkCharacter('Tony Stark', idx), 'ironman');
  assert.equal(Q.linkCharacter('Obadiah Stane', idx), 'obadiah');
  assert.equal(Q.linkCharacter('Iron Monger', idx), 'obadiah');
  assert.equal(Q.linkCharacter('Steve Rogers', idx), null);   // cap isn't in this list
  assert.equal(Q.linkCharacter('Nobody', idx), null);
});

// ── one line ──

test('validateLine accepts a full movie line and stores keys + portraits', () => {
  const idx = Q.characterIndex(CHARACTERS);
  const v = Q.validateLine({
    speaker: 'Loki', text: 'I have an army.', reply: { speaker: 'Tony Stark', text: 'We have a Hulk.' },
    note: 'to Tony · Stark Tower', time: '1:30:05', source: 'https://example.com/q'
  }, { project: MOVIE, mode: 'admin', characters: idx });
  assert.ok(v.ok, JSON.stringify(v.errors));
  assert.equal(v.line.projectId, 'avengers1');
  assert.deepEqual(v.line.speaker, { name: 'Loki', key: 'loki', characterId: 'loki' });
  assert.equal(v.line.reply.speaker.characterId, 'ironman');
  assert.equal(v.line.textKey, 'i have an army');
  assert.equal(v.line.timeSec, 5405);
  assert.equal(v.line.episode, null);
});

test('validateLine refuses missing, long and mismatched fields', () => {
  const bad = (raw, mode, project) => Q.validateLine(raw, { project: project || MOVIE, mode: mode || 'admin' }).errors;
  assert.ok(bad({ text: 'x' }).speaker);
  assert.ok(bad({ speaker: 'a' }).text);
  assert.ok(bad({ speaker: 'a', text: 'x'.repeat(Q.C.MAX_TEXT + 1) }).text);
  assert.ok(bad({ speaker: 'a', text: 'x', replyText: 'y' }).replySpeaker);
  assert.ok(bad({ speaker: 'a', text: 'x', replySpeaker: 'b' }).replyText);
  assert.ok(bad({ speaker: 'a', text: 'Same!', reply: { speaker: 'b', text: 'same' } }).replyText);
  assert.ok(bad({ speaker: 'a', text: 'x', episode: 1 }).episode, 'movies have no episodes');
  assert.ok(bad({ speaker: 'a', text: 'x', time: '1:2' }).time);
  assert.ok(bad({ speaker: 'a', text: 'x', time: '3:00:00' }).time, 'past the end of a 143-minute film');
  assert.ok(bad({ speaker: 'a', text: 'x', note: 'n'.repeat(Q.C.MAX_NOTE + 1) }).note);
  assert.ok(bad({ speaker: 'a', text: 'x', decoySpeakers: 'b|A' }).decoySpeakers, 'a decoy equal to the speaker');
  assert.ok(bad({ speaker: 'a', text: 'x', decoyReplies: 'z' }).decoyReplies, 'wrong replies need a reply');
});

test('validateLine on a series: episodes are 1-based in, 0-based stored, time within that episode', () => {
  const ok = Q.validateLine({ speaker: 'Wanda', text: 'What is grief, if not love persevering?', episode: 'E3', time: '20:00' }, { project: SERIES });
  assert.ok(ok.ok, JSON.stringify(ok.errors));
  assert.equal(ok.line.episode, 2);
  assert.equal(ok.line.timeSec, 1200);
  const past = Q.validateLine({ speaker: 'W', text: 'x', episode: 1, time: '31:00' }, { project: SERIES });
  assert.ok(past.errors.time, '29-minute episode + 59 s slack');
  const noEp = Q.validateLine({ speaker: 'W', text: 'x', time: '10:00' }, { project: SERIES });
  assert.ok(noEp.errors.episode);
  assert.ok(Q.validateLine({ speaker: 'W', text: 'x', episode: 4 }, { project: SERIES }).errors.episode);
});

test('suggest mode needs a time (and an episode on a series), refuses links, ignores source and decoys', () => {
  const noTime = Q.validateLine({ speaker: 'Tony', text: 'Hello' }, { project: MOVIE, mode: 'suggest' });
  assert.ok(noTime.errors.time);
  const noEp = Q.validateLine({ speaker: 'Wanda', text: 'Hello', time: '1:00' }, { project: SERIES, mode: 'suggest' });
  assert.ok(noEp.errors.episode);
  const link = Q.validateLine({ speaker: 'Tony', text: 'see www.spam.com', time: '1:00' }, { project: MOVIE, mode: 'suggest' });
  assert.ok(link.errors.text);
  const ok = Q.validateLine({ speaker: 'Tony', text: 'Hello', time: '1:00', source: 'https://x', decoySpeakers: 'Bob' }, { project: MOVIE, mode: 'suggest' });
  assert.ok(ok.ok);
  assert.equal(ok.line.source, '');
  assert.deepEqual(ok.line.decoys, { speakers: [], replies: [] });
  // Import/admin mode: no time is fine.
  assert.ok(Q.validateLine({ speaker: 'Tony', text: 'Hello' }, { project: MOVIE, mode: 'import' }).ok);
});

// ── import / export ──

test('parseCsv handles a BOM, CRLF, quoted commas, doubled quotes and newlines', () => {
  const csv = '﻿speaker,text\r\n"Stark, Tony","He said ""hi""\nthen left"\r\n\r\nLoki,Kneel\n';
  assert.deepEqual(Q.parseCsv(csv), [['speaker', 'text'], ['Stark, Tony', 'He said "hi"\nthen left'], ['Loki', 'Kneel']]);
});

test('rowsFromCsv maps header aliases; rowsFromJson takes seed files, lists and flat rows', () => {
  const c = Q.rowsFromCsv('Project,Speaker,Line,Reply Speaker,Reply,Episode\navengers1,Loki,I have an army.,Tony Stark,We have a Hulk.,\n');
  assert.equal(c.error, null);
  assert.deepEqual(c.rows[0], { projectId: 'avengers1', speaker: 'Loki', text: 'I have an army.', replySpeaker: 'Tony Stark', replyText: 'We have a Hulk.' });
  assert.ok(Q.rowsFromCsv('a,b\n1,2').error);
  const seed = Q.rowsFromJson(JSON.stringify({ projectId: 'avengers1', lines: [{ speaker: 'Loki', text: 'Kneel.' }] }));
  assert.deepEqual(seed.rows, [{ projectId: 'avengers1', speaker: 'Loki', text: 'Kneel.' }]);
  const many = Q.rowsFromJson([{ projectId: 'a', lines: [{ speaker: 'x', text: 'y' }] }, { projectId: 'b', speaker: 'p', text: 'q' }]);
  assert.deepEqual(many.rows.map(r => r.projectId), ['a', 'b']);
  assert.ok(Q.rowsFromJson('{nope').error);
});

test('planImport resolves projects by id or title, flags errors and duplicates', () => {
  const rows = [
    { projectId: 'avengers1', speaker: 'Loki', text: 'I have an army.' },
    { projectId: 'The Avengers', speaker: 'Loki', text: 'I have an ARMY!' },        // dupe in batch
    { projectId: 'avengers1', speaker: 'Thor', text: 'Already there.' },            // dupe in DB
    { projectId: 'nope', speaker: 'X', text: 'Y' },
    { projectId: 'wandavision', speaker: 'Wanda', text: 'Hi', episode: 9 }
  ];
  const plan = Q.planImport(rows, { projects: [MOVIE, SERIES], existingKeys: new Set(['avengers1|already there']), characters: CHARACTERS });
  assert.deepEqual(plan.rows.map(r => r.status), ['ok', 'dupe-batch', 'dupe-db', 'error', 'error']);
  assert.equal(plan.rows[0].line.speaker.characterId, 'loki');
  assert.ok(plan.rows[3].errors.projectId);
  assert.deepEqual(plan.counts, { ok: 1, dupe: 2, error: 2 });
  assert.deepEqual(plan.byProject.avengers1, { ok: 1, dupe: 2, error: 0 });
});

test('export round-trips through CSV and seed JSON; CSV defuses formulas', () => {
  const v = Q.validateLine({ speaker: 'Wanda', text: '=SUM(1)', reply: { speaker: 'Vision', text: 'Hm, "really"?' }, episode: 2, time: '5:00', decoySpeakers: 'Agnes|Pietro' }, { project: SERIES });
  assert.ok(v.ok, JSON.stringify(v.errors));
  const line = Object.assign({}, v.line, { projectId: 'wandavision' });
  const csv = Q.toCsv([line]);
  assert.match(csv, /'=SUM\(1\)/);
  const back = Q.rowsFromCsv(csv).rows[0];
  assert.equal(back.episode, '2');
  assert.equal(back.time, '5:00');
  assert.equal(back.replyText, 'Hm, "really"?');
  assert.equal(back.decoySpeakers, 'Agnes|Pietro');
  const json = Q.toSeedJson([line]);
  assert.equal(json[0].projectId, 'wandavision');
  const again = Q.planImport(Q.rowsFromJson(json).rows, { projects: [SERIES] });
  assert.equal(again.rows[0].status, 'ok');
  assert.equal(again.rows[0].line.episode, 1);
});

test('chunkRows keeps every request under the row and byte limits', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ text: 'x'.repeat(100), i }));
  const chunks = Q.chunkRows(rows);
  assert.equal(chunks.flat().length, 1000);
  for (const c of chunks) {
    assert.ok(c.length <= Q.C.COMMIT_ROWS);
    assert.ok(JSON.stringify(c).length <= Q.C.COMMIT_BYTES);
  }
});

// ── the pool ──

test('playable needs 10 lines and 4 speakers (reply speakers count)', () => {
  assert.equal(Q.playable(Q.poolStats(bank(10, 4))), true);
  assert.equal(Q.playable(Q.poolStats(bank(9, 4))), false);
  assert.equal(Q.playable(Q.poolStats(bank(12, 3))), false);
  assert.deepEqual(Q.needs(Q.poolStats(bank(7, 2))), { lines: 3, speakers: 2 });
  const s = Q.poolStats(bank(10, 4));
  assert.equal(s.replies, 5);
});

test('roundMsFrom clamps the admin round length', () => {
  assert.equal(Q.roundMsFrom(20), 20000);
  assert.equal(Q.roundMsFrom(2), 10000);
  assert.equal(Q.roundMsFrom(99), 30000);
  assert.equal(Q.roundMsFrom('x'), Q.C.ROUND_MS);
});

// ── drawing a game ──

test('buildRounds: 10 rounds, 4 distinct options, the answer present, ids are letters', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rounds = Q.buildRounds(bank(30, 6), seeded(seed));
    assert.equal(rounds.length, 10);
    const prompts = rounds.map(r => Q.norm(r.prompt.text));
    assert.equal(new Set(prompts).size, 10, 'no prompt twice');
    const replies = rounds.filter(r => r.type === 'reply');
    assert.ok(replies.length >= Q.C.REPLY_MIN && replies.length <= Q.C.REPLY_MAX, 'reply rounds ' + replies.length);
    for (const r of rounds) {
      assert.deepEqual(r.options.map(o => o.id), ['a', 'b', 'c', 'd']);
      assert.equal(new Set(r.options.map(o => Q.norm(o.label))).size, 4);
      assert.ok(['a', 'b', 'c', 'd'].includes(r.answer));
      if (r.type === 'who') assert.equal(r.prompt.speaker, null);
      if (r.type === 'reply') {
        assert.ok(r.prompt.speaker && r.prompt.speaker.name);
        for (const o of r.options) assert.ok(!prompts.includes(Q.norm(o.label)) || false, 'an option is never another round\'s prompt');
      }
    }
  }
});

test('buildRounds: right answers match the line; deterministic with a seed; null when unplayable', () => {
  const b = bank(20, 5);
  const byText = new Map(b.map(l => [l.text, l]));
  const rounds = Q.buildRounds(b, seeded(7));
  for (const r of rounds) {
    const line = byText.get(r.prompt.text);
    const right = r.options.find(o => o.id === r.answer).label;
    assert.equal(right, r.type === 'who' ? line.speaker.name : line.reply.text);
    assert.equal(r.lineId, line.id);
    assert.equal(r.reveal.note, line.note);
  }
  assert.deepEqual(Q.buildRounds(b, seeded(7)), rounds);
  assert.equal(Q.buildRounds(bank(9, 5), seeded(1)), null);
  assert.equal(Q.buildRounds(bank(20, 3), seeded(1)), null);
});

test('buildRounds: with no replies every round is "who"; admin decoys are used first', () => {
  const b = bank(12, 5, { noReplies: true });
  b.forEach(l => { l.decoys = { speakers: ['Decoy One', 'Decoy Two', 'Decoy Three'], replies: [] }; });
  const rounds = Q.buildRounds(b, seeded(3));
  assert.ok(rounds.every(r => r.type === 'who'));
  for (const r of rounds) {
    const wrong = r.options.filter(o => o.id !== r.answer).map(o => o.label).sort();
    assert.deepEqual(wrong, ['Decoy One', 'Decoy Three', 'Decoy Two']);
  }
});

test('buildRounds: a bank of exactly 10 lines always makes a game (playable means playable)', () => {
  // 10 lines, 4 speakers, only 2 with a reply: wrong replies must come
  // from somewhere even though every line is a prompt in the game.
  const ten = bank(10, 4);
  ten.forEach((l, i) => { if (i > 2) l.reply = null; });
  assert.equal(Q.playable(Q.poolStats(ten)), true);
  for (let seed = 1; seed <= 100; seed++) {
    const rounds = Q.buildRounds(ten, seeded(seed));
    assert.ok(rounds, 'seed ' + seed);
    for (const r of rounds) assert.equal(new Set(r.options.map(o => Q.norm(o.label))).size, 4);
  }
  // A reply that is also another line's text: still 10 rounds.
  const echo = bank(10, 4);
  echo[0].reply = { speaker: echo[1].speaker, text: echo[1].text };
  for (let seed = 1; seed <= 50; seed++) assert.ok(Q.buildRounds(echo, seeded(seed)), 'echo seed ' + seed);
});

test('buildRounds: wrong replies come from lines nearest in length', () => {
  const b = bank(20, 5);
  b.push({ id: 'long', speaker: b[0].speaker, text: 'z'.repeat(200), textKey: Q.norm('z'.repeat(200)), reply: null, note: '', episode: null, decoys: { speakers: [], replies: [] } });
  for (let seed = 1; seed <= 20; seed++) {
    for (const r of Q.buildRounds(b, seeded(seed)).filter(x => x.type === 'reply')) {
      assert.ok(r.options.every(o => o.label.length < 100), 'the 200-char line is never a near-length decoy');
    }
  }
});

// ── scoring ──

test('score: 1000 at once, 500 at the buzzer, linear between, 0 when wrong', () => {
  assert.equal(Q.score(true, 0, 20000), 1000);
  assert.equal(Q.score(true, 10000, 20000), 750);
  assert.equal(Q.score(true, 20000, 20000), 500);
  assert.equal(Q.score(true, 20400, 20000), 500);
  assert.equal(Q.score(false, 0, 20000), 0);
});

// ── the game ──

function playTo(state, now) {
  return Q.startRound(Q.begin(state, Q.buildRounds(bank(20, 5), seeded(11)), now), now + Q.C.READY_MS);
}

test('lobby: join, cap, host passes on, empty game is over', () => {
  let s = Q.createLobby({ projectId: 'avengers1', userId: 'u1', username: 'alex', now: T0 });
  for (let i = 2; i <= Q.C.MAX_PLAYERS; i++) s = Q.join(s, 'u' + i, 'p' + i).state;
  assert.equal(Q.join(s, 'u99', 'late').error, 'full');
  assert.equal(Q.join(s, 'u2', 'p2').state, s, 'joining twice is a no-op');
  s = Q.leave(s, 'u1');
  assert.equal(s.host, 'u2');
  for (let i = 2; i <= Q.C.MAX_PLAYERS; i++) s = Q.leave(s, 'u' + i);
  assert.equal(s.phase, 'over');
});

test('answer: once per round, right option scores by speed, late and junk refused, nothing mutated', () => {
  let s = Q.createLobby({ projectId: 'avengers1', userId: 'u1', username: 'alex', now: T0, roundMs: 20000 });
  s = Q.join(s, 'u2', 'sam').state;
  s = playTo(s, T0);
  const t = s.roundStartedAt;
  const rd = s.rounds[0];
  const wrong = rd.options.find(o => o.id !== rd.answer).id;
  const frozen = JSON.stringify(s);
  const a = Q.answer(s, 'u1', 0, rd.answer, t + 5000);
  assert.ok(a.ok);
  assert.equal(JSON.stringify(s), frozen);
  assert.deepEqual(a.state.players.u1.guesses[0], { choice: rd.answer, correct: true, points: 875, lockMs: 5000 });
  assert.equal(Q.answer(a.state, 'u1', 0, wrong, t + 6000).error, 'already');
  assert.equal(Q.answer(a.state, 'u2', 1, wrong, t + 6000).error, 'wrong-round');
  assert.equal(Q.answer(a.state, 'u2', 0, 'z', t + 6000).error, 'bad-guess');
  assert.equal(Q.answer(a.state, 'u2', 0, wrong, t + 20000 + Q.C.LATE_GRACE_MS + 1).error, 'too-late');
  const b = Q.answer(a.state, 'u2', 0, wrong, t + 1000);
  assert.equal(b.state.players.u2.guesses[0].points, 0);
  assert.equal(Q.allLocked(b.state), true);
  assert.equal(b.state.players.u1.total, 0, 'totals only move at the reveal');
  const r = Q.reveal(b.state, t + 6000);
  assert.equal(r.players.u1.total, 875);
  assert.equal(r.players.u2.total, 0);
});

test('a full game ends in results; ranking breaks ties by lock-in time; bestRound is the fastest right answer', () => {
  let s = Q.createLobby({ projectId: 'avengers1', userId: 'u1', username: 'alex', now: T0, roundMs: 20000 });
  s = Q.join(s, 'u2', 'sam').state;
  s = playTo(s, T0);
  for (let r = 0; r < Q.C.ROUNDS; r++) {
    const rd = s.rounds[r];
    const t = s.roundStartedAt;
    s = Q.answer(s, 'u1', r, rd.answer, t + (r === 4 ? 100 : 2000)).state;
    s = Q.answer(s, 'u2', r, rd.answer, t + 2000 + (r === 0 ? 1 : 0)).state;
    s = Q.reveal(s, t + 3000);
    s = Q.next(s, t + 3000 + Q.C.REVEAL_MS);
  }
  assert.equal(s.phase, 'results');
  const rank = Q.ranking(s);
  assert.equal(rank[0].username, 'alex');
  assert.equal(Q.bestRound(s.players.u1.guesses), 4);
  assert.equal(Q.bestRound([null, { correct: false, lockMs: 1 }]), 0);
  assert.equal(Q.newRecord({ score: rank[0].total }, rank), null, 'a tie keeps the old record');
  assert.equal(Q.newRecord({ score: rank[0].total - 1 }, rank).username, 'alex');
});

test('publicState never shows an answer, a pick or a line id before the reveal', () => {
  let s = Q.createLobby({ projectId: 'avengers1', userId: 'u1', username: 'alex', now: T0 });
  s = Q.join(s, 'u2', 'sam').state;
  const lobby = Q.publicState(s);
  assert.equal(lobby.current, null);
  s = Q.begin(s, Q.buildRounds(bank(20, 5), seeded(5)), T0);
  const ready = JSON.stringify(Q.publicState(s));
  for (const rd of s.rounds) {
    assert.ok(!ready.includes(rd.prompt.text), 'no prompt before its round');
  }
  s = Q.startRound(s, T0 + 3000);
  s = Q.answer(s, 'u1', 0, s.rounds[0].options[0].id, T0 + 4000).state;
  const pub = Q.publicState(s);
  const json = JSON.stringify(pub);
  assert.equal(pub.current.round, 0);
  assert.equal(pub.current.prompt.text, s.rounds[0].prompt.text);
  assert.ok(!('answer' in pub.current));
  assert.ok(!json.includes('"answer"'));
  assert.ok(!json.includes('lineId') && !json.includes('LID'), 'no line ids');
  assert.ok(!json.includes('"choice"'));
  assert.ok(!json.includes('u1') && !json.includes('u2'), 'no user ids');
  assert.ok(!json.includes(s.rounds[1].prompt.text), 'no future prompt');
  assert.deepEqual(pub.players.map(p => p.locked), [true, false]);
  const rv = Q.publicState(Q.reveal(s, T0 + 9000));
  assert.equal(rv.history.length, 1);
  assert.equal(rv.history[0].answer, s.rounds[0].answer);
  assert.equal(rv.history[0].picks[0].choice, s.rounds[0].options[0].id);
  assert.equal(rv.history[0].picks[1].choice, null);
  assert.equal(typeof rv.history[0].reveal.note, 'string');
});
