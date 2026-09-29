/************************************************
 * Unit tests for server/house.js — the helpers behind the /home room
 * editor (and the /world house routes).
 *
 * No Mongo: homeMaxPropsNow is exercised by stubbing AdminConfig.findOne
 * (mongoose.model() registers without connecting).
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const AdminConfig = require('../models/AdminConfig');
const H = require('../server/house');

test('housesForRooms: only rooms still in the layout, each normalised', () => {
  const map = {
    ironman1: { wallColor: 2, props: [{ kind: 'chair', gx: 3, gy: 3, rot: 0 }] },
    thor1: { wallColor: 5 }                                   // room no longer in the layout
  };
  const out = H.housesForRooms(map, [{ projectId: 'ironman1', gx: 0, gy: 0 }, { projectId: 'hulk1', gx: 1, gy: 0 }]);
  assert.deepEqual(Object.keys(out), ['ironman1']);
  assert.equal(out.ironman1.wallColor, 2);
  assert.equal(out.ironman1.props.length, 1);
});

test('housesForRooms: tolerates a missing map / layout', () => {
  assert.deepEqual(H.housesForRooms(undefined, [{ projectId: 'a' }]), {});
  assert.deepEqual(H.housesForRooms({ a: {} }, undefined), {});
});

test('portraitOk: empty is fine, anything off the app\'s Cloudinary is not', () => {
  assert.equal(H.portraitOk(''), true);
  assert.equal(H.portraitOk('https://evil.example/x.png'), false);
});

test('homeMaxPropsNow: the admin value, else the default', async (t) => {
  const orig = AdminConfig.findOne;
  t.after(() => { AdminConfig.findOne = orig; });
  const stub = (doc) => () => ({ select: () => ({ lean: async () => doc }) });
  AdminConfig.findOne = stub({ world: { homeMaxProps: 7 } });
  assert.equal(await H.homeMaxPropsNow(), 7);
  AdminConfig.findOne = stub(null);
  assert.equal(await H.homeMaxPropsNow(), AdminConfig.defaults().world.homeMaxProps);
});

test('pickRoof: just the roof fields, with defaults', () => {
  assert.deepEqual(H.pickRoof({ roofStyle: 'gable', roofColor: 3, roofDir: 1, chimney: true, wallColor: 2, props: [] }),
    { roofStyle: 'gable', roofColor: 3, roofDir: 1, chimney: true });
  assert.deepEqual(H.pickRoof(null), { roofStyle: 'flat', roofColor: null, roofDir: 0, chimney: false });
});

test('homeRoofFor: the stored roof wins', () => {
  const user = { homeRoof: { roofStyle: 'hip', roofColor: 4 }, homeHouses: { a: { roofStyle: 'gable' } } };
  const r = H.homeRoofFor(user, [{ projectId: 'a' }]);
  assert.equal(r.roofStyle, 'hip');
  assert.equal(r.roofColor, 4);
});

test('homeRoofFor: legacy homes take the first decorated room in layout order', () => {
  const user = { homeHouses: { b: { roofStyle: 'gable', roofDir: 1 }, c: { roofStyle: 'hip' } } };
  const r = H.homeRoofFor(user, [{ projectId: 'a' }, { projectId: 'b' }, { projectId: 'c' }]);
  assert.equal(r.roofStyle, 'gable');
  assert.equal(r.roofDir, 1);
  assert.equal(H.homeRoofFor({ homeHouses: {} }, [{ projectId: 'a' }]), null);
  assert.equal(H.homeRoofFor(null, []), null);
});

// ── effectiveLayout: what a home may show once the watch list shrinks ──

test('effectiveLayout: drops unwatched rooms and caps at floor(watched / 2)', () => {
  const rooms = [
    { projectId: 'a', gx: 0, gy: 0 }, { projectId: 'b', gx: 1, gy: 0 },
    { projectId: 'c', gx: 2, gy: 0 }, { projectId: 'd', gx: 3, gy: 0 }
  ];
  // 4 watched → 2 rooms allowed; 'b' unwatched is skipped, but then 'a' has
  // no neighbour left and stays alone (the kept set must be connected).
  assert.deepEqual(H.effectiveLayout({ rooms }, ['a', 'c', 'd', 'x']).rooms, [{ projectId: 'a', gx: 0, gy: 0 }]);
  // Everything watched, 6 watched → 3 rooms: grown from the entrance room.
  assert.deepEqual(H.effectiveLayout({ rooms }, ['a', 'b', 'c', 'd', 'e', 'f']).rooms.map(r => r.projectId), ['a', 'b', 'c']);
});

test('effectiveLayout: after Clear Progress nothing is shown; the stored layout is untouched', () => {
  const layout = { rooms: [{ projectId: 'a', gx: 0, gy: 0 }] };
  assert.deepEqual(H.effectiveLayout(layout, []), { rooms: [] });
  assert.equal(layout.rooms.length, 1, 'input not mutated');
  assert.deepEqual(H.effectiveLayout(null, ['a', 'b']), { rooms: [] });
  assert.deepEqual(H.effectiveLayout({ rooms: 'junk' }, new Set(['a', 'b'])), { rooms: [] });
});

test('effectiveLayout: a layout within its cap comes back unchanged', () => {
  const rooms = [{ projectId: 'a', gx: 0, gy: 0 }, { projectId: 'b', gx: 0, gy: 1 }];
  assert.deepEqual(H.effectiveLayout({ rooms }, ['a', 'b', 'c', 'd']).rooms, rooms);
});

test('watchedIdsOf: object and legacy string entries', () => {
  assert.deepEqual([...H.watchedIdsOf({ watchedProjects: ['a', { projectId: 'b' }, null] })], ['a', 'b']);
  assert.equal(H.watchedIdsOf(null).size, 0);
});
