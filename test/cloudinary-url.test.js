const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../server/cloudinary-url');

process.env.CLOUDINARY_CLOUD_NAME = 'testcloud';
const base = 'https://res.cloudinary.com/testcloud';

test('isOurAssetUrl: plain uploads in our folder, with or without a version', () => {
  assert.equal(U.isOurAssetUrl(`${base}/image/upload/v1/mcu-memories/x.jpg`), true);
  assert.equal(U.isOurAssetUrl(`${base}/image/upload/mcu-memories/x.jpg`), true);
  assert.equal(U.isOurAssetUrl(`${base}/video/upload/v1712345678/mcu-memories/abc_DEF-9.mp4`), true);
  assert.equal(U.isOurAssetUrl(`${base}/image/upload/v1/mcu-scenes/x.jpg`, { folders: ['mcu-scenes'] }), true);
});

test('isOurAssetUrl: everything else is refused', () => {
  const bad = [
    `https://res.cloudinary.com/other/image/upload/v1/mcu-memories/x.jpg`,     // another cloud
    `https://res.cloudinary.com/testcloud.evil.com/image/upload/v1/mcu-memories/x.jpg`,
    `https://res.cloudinary.com/testcloudX/image/upload/v1/mcu-memories/x.jpg`,
    `${base}/raw/upload/v1/mcu-memories/x.txt`,                                  // raw
    `${base}/image/fetch/https://evil.example/x.png`,                            // remote fetch
    `${base}/image/upload/l_text:Arial_40:hi/v1/mcu-memories/x.jpg`,             // transformation
    `${base}/image/upload/c_fill,w_200/v1/mcu-memories/x.jpg`,
    `${base}/image/upload/v1/other-folder/x.jpg`,                                // other folder
    `${base}/image/upload/v1/mcu-memories/../x.jpg`,
    `${base}/image/upload/v1/mcu-memories//x.jpg`,
    `${base}/image/upload/v1/mcu-memories/x.jpg?x=1`,
    `${base}/image/upload/v1/mcu-memories/x.jpg#f`,
    `${base}/image/upload/v1/mcu-memories/x".jpg`,
    `${base}/image/upload/v1/mcu-memories/x.jpg `,
    `http://res.cloudinary.com/testcloud/image/upload/v1/mcu-memories/x.jpg`,     // http
    `${base}/image/upload/v1/mcu-memories/x`,                                     // no extension
    `${base}/image/upload/v1/mcu-memories/` + 'a'.repeat(520) + '.jpg',           // too long
    'javascript:alert(1)', '', null, 42
  ];
  for (const u of bad) assert.equal(U.isOurAssetUrl(u), false, String(u).slice(0, 90));
  const saved = process.env.CLOUDINARY_CLOUD_NAME;
  process.env.CLOUDINARY_CLOUD_NAME = '';
  assert.equal(U.isOurAssetUrl(`${base}/image/upload/v1/mcu-memories/x.jpg`), false, 'no cloud configured');
  process.env.CLOUDINARY_CLOUD_NAME = saved;
});

test('parseAsset: resource type + public id from any versioned upload on our cloud', () => {
  assert.deepEqual(U.parseAsset(`${base}/image/upload/v1/mcu-memories/x.jpg`), { resource_type: 'image', public_id: 'mcu-memories/x' });
  assert.deepEqual(U.parseAsset(`${base}/video/upload/v99/mcu-scenes/a/b.mp4`), { resource_type: 'video', public_id: 'mcu-scenes/a/b' });
  assert.deepEqual(U.parseAsset(`${base}/image/upload/c_fill/v1/mcu-memories/x.jpg`), { resource_type: 'image', public_id: 'mcu-memories/x' });
  assert.equal(U.parseAsset(`https://res.cloudinary.com/other/image/upload/v1/mcu-memories/x.jpg`), null);
  assert.equal(U.parseAsset(`${base}/image/upload/mcu-memories/x.jpg`), null);   // unversioned: not what Cloudinary returns
  assert.equal(U.parseAsset('nope'), null);
  assert.equal(U.parseAsset(null), null);
});
