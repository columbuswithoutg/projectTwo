const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../js/ux-logic');

test('safeNextUrl: in-app paths pass, anything that could leave the site or loop is null', () => {
  assert.equal(U.safeNextUrl('/world'), '/world');
  assert.equal(U.safeNextUrl('/friend/kev%20in/map?x=1#h'), '/friend/kev%20in/map?x=1#h');
  assert.equal(U.safeNextUrl('/messages?with=a'), '/messages?with=a');
  assert.equal(U.safeNextUrl('/'), '/');
  for (const bad of [null, undefined, '', 42, '//evil.com', '/\\evil.com', 'https://x', 'javascript:alert(1)',
    ' /world', '/world\n', '/%0d%0aSet-Cookie', '/%2F%2Fevil', '/login', '/login?next=%2Fworld', '/login/x',
    '/' + 'a'.repeat(600), '/%E0%A4%A']) {
    assert.equal(U.safeNextUrl(bad), null, JSON.stringify(bad));
  }
});

test('rankFriendSearch: exact → prefix → position → shorter → alphabetical; statuses; duplicates dropped', () => {
  const results = [
    { _id: '1', username: 'Stanton' },
    { _id: '2', username: 'tony' },
    { _id: '3', username: 'Tony' },
    { _id: '4', username: 'antony' },
    { _id: '5', username: 'tonystark' },
    { _id: '2', username: 'tony' },          // duplicate id
    { _id: '6' },                            // malformed
    { username: 'noid' }
  ];
  const r = U.rankFriendSearch(results, ' Tony ', { friends: new Set(['tonystark']), pending: new Set(['antony']) });
  assert.deepEqual(r.items.map(i => i.username), ['tony', 'Tony', 'tonystark', 'antony', 'Stanton']);
  assert.deepEqual(r.exact.map(i => i._id), ['2', '3']);           // two case-twins → Enter must not auto-send
  assert.equal(r.items.find(i => i.username === 'tonystark').status, 'friend');
  assert.equal(r.items.find(i => i.username === 'antony').status, 'pending');
  assert.equal(r.items.find(i => i.username === 'tony').status, 'none');
  assert.equal(r.items.find(i => i.username === 'Stanton').match, null);   // no 'tony' inside → sorted last
  assert.deepEqual(r.items.find(i => i.username === 'antony').match, [2, 6]);
  assert.deepEqual(U.rankFriendSearch(results, '   '), { items: [], exact: [] });
  assert.deepEqual(U.rankFriendSearch(null, 'x'), { items: [], exact: [] });
  const one = U.rankFriendSearch([{ _id: '9', username: 'Bob' }], 'bob');
  assert.equal(one.exact.length, 1);
  assert.ok(!('_at' in one.items[0]) && !('_exact' in one.items[0]));
});

test('friendlyAuthError: one line of copy per failure', () => {
  assert.match(U.friendlyAuthError(null, 0), /reach the server/);
  assert.match(U.friendlyAuthError({ error: 'Invalid credentials' }, 401), /don’t match/);
  assert.match(U.friendlyAuthError({ error: 'Username already exists' }, 400), /taken/);
  assert.match(U.friendlyAuthError({ error: 'Too many auth attempts, try again in 15 minutes' }, 429), /Too many tries/);
  assert.equal(U.friendlyAuthError({ error: 'Account suspended', reason: 'spam' }, 403), 'This account is suspended: spam');
  assert.equal(U.friendlyAuthError({ error: 'Account suspended', reason: '' }, 403), 'This account is suspended.');
  assert.match(U.friendlyAuthError({ error: 'Server error' }, 500), /server had a problem/);
  assert.equal(U.friendlyAuthError({ error: 'Password must be at least 8 characters' }, 400), 'Password must be at least 8 characters');
  assert.match(U.friendlyAuthError({}, 400), /Something went wrong/);
});
