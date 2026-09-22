/************************************************
 * Unit tests for js/messaging-logic.js — Messages inbox + bug/suggestion
 * report validation shared by the server routes and the client views.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/messaging-logic.js');

test('pairKey is symmetric and order-independent', () => {
  assert.equal(L.pairKey('abc', 'xyz'), 'abc:xyz');
  assert.equal(L.pairKey('xyz', 'abc'), 'abc:xyz');
  assert.equal(L.pairKey({ toString: () => 'b' }, 'a'), 'a:b');
  assert.equal(L.adminPairKey('u1'), 'admin:u1');
});

test('normalizeDm trims, requires a target and text, caps length', () => {
  assert.deepEqual(L.normalizeDm({ to: ' Tony ', text: '  hi  ' }), { ok: true, to: 'Tony', text: 'hi' });
  assert.deepEqual(L.normalizeDm({ text: 'hi' }), { ok: false, error: 'no-target' });
  assert.deepEqual(L.normalizeDm({ to: 'Tony', text: '   ' }), { ok: false, error: 'empty' });
  assert.deepEqual(L.normalizeDm({ to: 'Tony', text: 'a'.repeat(L.C.DM_MAX_LEN + 1) }), { ok: false, error: 'too-long' });
  assert.equal(L.normalizeDm({ to: 'a'.repeat(100), text: 'x' }).to.length, L.C.USERNAME_MAX);
  assert.deepEqual(L.normalizeDm(null), { ok: false, error: 'no-target' });
  assert.deepEqual(L.normalizeDm({ to: 42, text: 7 }), { ok: false, error: 'no-target' });
  assert.deepEqual(L.normalizeDm({ to: 'Tony', text: ['hi'] }), { ok: false, error: 'empty' });
});

test('validateReport accepts a good report and shapes it', () => {
  const r = L.validateReport({
    kind: 'Bug', title: ' Crash ', description: ' it broke ',
    page: '/world', userAgent: 'UA', extra: 'ignored'
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.report, { kind: 'bug', title: 'Crash', description: 'it broke', page: '/world', userAgent: 'UA' });
});

test('validateReport rejects bad kind / missing fields / oversize', () => {
  assert.deepEqual(L.validateReport({ kind: 'rant', title: 'x', description: 'y' }), { ok: false, error: 'bad-kind', field: 'kind' });
  assert.deepEqual(L.validateReport({ kind: 'bug', description: 'y' }), { ok: false, error: 'no-title', field: 'title' });
  assert.deepEqual(L.validateReport({ kind: 'bug', title: 'x' }), { ok: false, error: 'no-description', field: 'description' });
  assert.equal(L.validateReport({ kind: 'bug', title: 'a'.repeat(L.C.TITLE_MAX + 1), description: 'y' }).error, 'title-too-long');
  assert.equal(L.validateReport({ kind: 'suggestion', title: 'x', description: 'a'.repeat(L.C.DESC_MAX + 1) }).error, 'description-too-long');
});

test('validateReport never throws on junk and clips meta fields', () => {
  assert.equal(L.validateReport(null).ok, false);
  assert.equal(L.validateReport('string').ok, false);
  assert.equal(L.validateReport({ kind: ['bug'], title: {}, description: 5 }).ok, false);
  const r = L.validateReport({ kind: 'bug', title: 't', description: 'd', page: 'p'.repeat(999), userAgent: 'u'.repeat(999) });
  assert.equal(r.report.page.length, L.C.PAGE_MAX);
  assert.equal(r.report.userAgent.length, L.C.UA_MAX);
});

test('validateReply trims and caps', () => {
  assert.deepEqual(L.validateReply({ text: ' ok ' }), { ok: true, text: 'ok' });
  assert.deepEqual(L.validateReply({ text: '' }), { ok: false, error: 'empty' });
  assert.deepEqual(L.validateReply(undefined), { ok: false, error: 'empty' });
  assert.deepEqual(L.validateReply({ text: 'a'.repeat(L.C.REPLY_MAX + 1) }), { ok: false, error: 'too-long' });
});

test('preview flattens whitespace and truncates with an ellipsis', () => {
  assert.equal(L.preview('hello\n\n  world'), 'hello world');
  const long = L.preview('word '.repeat(40), 20);
  assert.equal(long.length <= 20, true);
  assert.ok(long.endsWith('…'));
  assert.equal(L.preview(null), '');
});

test('status / kind guards and errorText cover every code', () => {
  assert.ok(L.isKind('bug') && L.isKind('suggestion') && !L.isKind('BUG'));
  for (const s of L.REPORT_STATUSES) assert.ok(L.isStatus(s));
  assert.ok(!L.isStatus('done'));
  for (const e of ['no-target', 'empty', 'too-long', 'bad-kind', 'no-title', 'title-too-long',
                   'no-description', 'description-too-long', 'weird']) {
    assert.ok(L.errorText(e).length > 0);
  }
});
