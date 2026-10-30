/************************************************
 * server/quote-guess-data.js drawLines + the champions cache (RT2-01):
 * the champion's featured line is shown with its speaker on the island
 * screen, so it must not come up in a game — unless leaving it out would
 * make the bank unplayable, when the full bank is drawn instead.
 *
 * No Mongo: QuoteScore.aggregate, User.find and QuoteLine.find are stubbed
 * on the models (mongoose.model() registers without connecting).
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const QuoteLine = require('../models/QuoteLine');
const QuoteScore = require('../models/QuoteScore');
const User = require('../models/user');
const QuoteData = require('../server/quote-guess-data');

const PID = 'avengers1';
const CHAMP = '0000000000000000000000c1';
const SPEAKERS = ['Tony Stark', 'Steve Rogers', 'Thor', 'Natasha Romanoff', 'Loki'];
let lines = [];
let pick = null;   // the champion's QuoteScore.pick (a line id) or null = no champion

function bank(n) {
  lines = [];
  for (let i = 0; i < n; i++) {
    const name = SPEAKERS[i % SPEAKERS.length];
    lines.push({
      _id: 'line' + String(i).padStart(2, '0'), projectId: PID, status: 'approved', active: true,
      speaker: { name, key: name.toLowerCase(), characterId: null },
      text: 'Line number ' + i, textKey: 'line number ' + i
    });
  }
}

const lean = (v) => ({ select: () => lean(v), lean: async () => v });
QuoteScore.aggregate = async () => (pick ? [{ _id: PID, userId: CHAMP, best: 5000, achievedAt: new Date(0), pick }] : []);
User.find = () => lean([{ _id: CHAMP, username: 'cap' }]);
QuoteLine.find = (f) => {
  if (f._id && f._id.$in) return lean(lines.filter(l => f._id.$in.map(String).includes(l._id)));
  return lean(lines.filter(l => l.projectId === f.projectId));
};

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

test.beforeEach(() => { QuoteData.invalidate('board', PID); });

test('champions cache keeps the featured line id server-side only', async () => {
  bank(12);
  pick = 'line03';
  const c = (await QuoteData.champions.get()).get(PID);
  assert.equal(c.pickId, 'line03');
  assert.deepEqual(c.pick, { text: 'Line number 3', speaker: 'Natasha Romanoff' });
  assert.equal('pickId' in QuoteData.publicRecord(c), false);
});

test('drawLines never draws the champion\'s featured line when the rest is playable (RT2-01)', async () => {
  bank(12);
  pick = 'line03';
  for (let seed = 1; seed <= 40; seed++) {
    const rounds = await QuoteData.drawLines(PID, seeded(seed));
    assert.equal(rounds.length, 10);
    assert.equal(rounds.some(r => r.lineId === 'line03'), false, 'seed ' + seed);
  }
});

test('drawLines falls back to the full bank when leaving the featured line out would make it unplayable', async () => {
  bank(10);                      // exactly MIN_POOL: without line03 only 9 remain
  pick = 'line03';
  const rounds = await QuoteData.drawLines(PID, seeded(7));
  assert.equal(rounds.length, 10);
  assert.equal(rounds.some(r => r.lineId === 'line03'), true);
});

test('drawLines with no champion (or a pick no longer in the bank) draws from the whole bank', async () => {
  bank(10);
  pick = null;
  assert.equal((await QuoteData.drawLines(PID, seeded(3))).length, 10);
  QuoteData.invalidate('board', PID);
  pick = 'gone';                 // hidden / deleted line: no featured text, nothing excluded
  const c = (await QuoteData.champions.get()).get(PID);
  assert.equal(c.pick, null);
  assert.equal(c.pickId, null);
  assert.equal((await QuoteData.drawLines(PID, seeded(3))).length, 10);
});
