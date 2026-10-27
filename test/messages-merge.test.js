// MessagesView.newerMessages: the thread poll / send refresh appends only
// messages not on screen yet, so "Load earlier" history survives (CLI-01).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// A classic browser script (`const MessagesView = (() => …)()`): run it in
// a bare context and hand the value back. Nothing at load time touches the DOM.
const src = fs.readFileSync(path.join(__dirname, '../js/views/messages.js'), 'utf8');
const { newerMessages } = vm.runInNewContext(src + '\n;MessagesView', {});

const msg = (id, min) => ({ id, text: id, createdAt: new Date(Date.UTC(2026, 9, 27, 12, min)).toISOString() });

test('newerMessages: only unseen messages at/after the newest rendered one, in page order', () => {
  const seen = new Set(['a', 'b', 'c']);
  const page = [msg('b', 1), msg('c', 2), msg('d', 3), msg('e', 4)];
  const r = newerMessages(seen, msg('c', 2).createdAt, page, true);
  assert.deepEqual(r.fresh.map(m => m.id), ['d', 'e']);
  assert.equal(r.gap, false);                        // page overlaps what's shown
});

test('newerMessages: nothing new → nothing to append', () => {
  const page = [msg('a', 0), msg('b', 1)];
  const r = newerMessages(new Set(['a', 'b']), msg('b', 1).createdAt, page, false);
  assert.equal(r.fresh.length, 0);
  assert.equal(r.gap, false);
});

test('newerMessages: same-timestamp newcomer is kept; an unseen older one is not appended', () => {
  const seen = new Set(['b']);
  const page = [msg('x', 0), msg('b', 1), msg('c', 1)];
  assert.deepEqual(newerMessages(seen, msg('b', 1).createdAt, page, false).fresh.map(m => m.id), ['c']);
});

test('newerMessages: a full page sharing nothing with the log is a gap', () => {
  const r = newerMessages(new Set(['a']), msg('a', 0).createdAt, [msg('y', 5), msg('z', 6)], true);
  assert.equal(r.gap, true);
  // …but the whole thread (no older page) can't leave a hole.
  assert.equal(newerMessages(new Set(['a']), msg('a', 0).createdAt, [msg('y', 5)], false).gap, false);
});

test('newerMessages: ids compared as strings; malformed entries ignored', () => {
  const r = newerMessages(new Set(['1']), msg(1, 0).createdAt, [null, { text: 'no id' }, msg(1, 0), msg(2, 1)], false);
  assert.deepEqual(r.fresh.map(m => m.id), [2]);
  const empty = newerMessages(new Set(), null, undefined, false);
  assert.equal(empty.fresh.length, 0);
  assert.equal(empty.gap, false);
});
