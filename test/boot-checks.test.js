const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../server/boot-checks');

const core = { MONGO_URI: 'mongodb://x', JWT_SECRET: 'y'.repeat(32) };
const cloud = { CLOUDINARY_CLOUD_NAME: 'c', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 's' };

test('requiredMissing: MONGO_URI and JWT_SECRET are always required', () => {
  assert.deepEqual(B.requiredMissing({}), ['MONGO_URI', 'JWT_SECRET']);
  assert.deepEqual(B.requiredMissing({ ...core }), []);
  assert.deepEqual(B.requiredMissing({ NODE_ENV: 'production', ...cloud }), ['MONGO_URI', 'JWT_SECRET']);
});

test('Cloudinary vars: fatal in production, a warning in development', () => {
  const prod = { NODE_ENV: 'production', ...core, CLOUDINARY_CLOUD_NAME: 'c' };
  assert.deepEqual(B.requiredMissing(prod), ['CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']);
  assert.deepEqual(B.warnMissing(prod), []);
  assert.deepEqual(B.requiredMissing({ NODE_ENV: 'production', ...core, ...cloud }), []);

  const dev = { ...core };   // the QA recipes boot with only these two
  assert.deepEqual(B.requiredMissing(dev), []);
  assert.deepEqual(B.warnMissing(dev), ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']);
  assert.deepEqual(B.warnMissing({ ...dev, ...cloud }), []);
  assert.deepEqual(B.warnMissing({ ...dev, ...cloud, CLOUDINARY_API_SECRET: '' }), ['CLOUDINARY_API_SECRET']);
});

test('usePublicDns: on in dev, off in production unless FORCE_PUBLIC_DNS opts in', () => {
  assert.equal(B.usePublicDns({}), true);
  assert.equal(B.usePublicDns({ NODE_ENV: 'development' }), true);
  assert.equal(B.usePublicDns({ NODE_ENV: 'production' }), false);
  assert.equal(B.usePublicDns({ NODE_ENV: 'production', FORCE_PUBLIC_DNS: '0' }), false);
  assert.equal(B.usePublicDns({ NODE_ENV: 'production', FORCE_PUBLIC_DNS: '1' }), true);
  assert.equal(B.usePublicDns({ NODE_ENV: 'production', FORCE_PUBLIC_DNS: 'true' }), true);
});
