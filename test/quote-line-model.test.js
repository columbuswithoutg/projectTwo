/************************************************
 * models/QuoteLine.js: `importId` is left unset on lines that did not come
 * from a bulk import (RT2-07), so its sparse index really skips them (with
 * a null default every line was indexed and `sparse` did nothing).
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const QuoteLine = require('../models/QuoteLine');

const base = { projectId: 'avengers1', speaker: { name: 'Loki', key: 'loki' }, text: 'Kneel.', textKey: 'kneel' };

test('a line with no import has no importId field at all', () => {
  const doc = new QuoteLine(base);
  assert.equal(doc.importId, undefined);
  assert.ok(!('importId' in doc.toObject()), 'not stored as null');
  assert.equal(new QuoteLine(Object.assign({ importId: 'batch-1' }, base)).importId, 'batch-1');
});

test('the importId index is still the sparse one (same spec, no index change)', () => {
  const idx = QuoteLine.schema.indexes().find(([fields]) => Object.keys(fields).join() === 'importId');
  assert.ok(idx);
  assert.equal(idx[1].sparse, true);
});
