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
