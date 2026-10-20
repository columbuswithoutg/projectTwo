const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../server/upload-policy');

test('classifyUpload: every listed type by mime, HEIC by extension when the mime is missing, junk refused', () => {
  for (const t of P.UPLOAD_TYPES) {
    assert.equal(P.classifyUpload({ mimetype: t.mime, originalname: 'x.' + t.exts[0] }), t, t.mime);
    for (const a of t.aliases) assert.equal(P.classifyUpload({ mimetype: a, originalname: 'x' }), t, a);
  }
  assert.equal(P.classifyUpload({ mimetype: '', originalname: 'IMG_0001.HEIC' }).mime, 'image/heic');
  assert.equal(P.classifyUpload({ mimetype: 'application/octet-stream', originalname: 'clip.MOV' }).mime, 'video/quicktime');
  assert.equal(P.classifyUpload({ mimetype: 'image/jpeg; charset=binary', originalname: 'a.jpg' }).mime, 'image/jpeg');
  assert.equal(P.classifyUpload({ mimetype: 'image/svg+xml', originalname: 'a.svg' }), null);
  assert.equal(P.classifyUpload({ mimetype: 'text/html', originalname: 'a.html' }), null);
  assert.equal(P.classifyUpload({ mimetype: 'application/octet-stream', originalname: 'a.exe' }), null);
  assert.equal(P.classifyUpload({ mimetype: 'application/octet-stream', originalname: 'noext' }), null);
  assert.equal(P.classifyUpload({ mimetype: 'image/png', originalname: 'evil.exe' }).mime, 'image/png');   // mime wins
  assert.equal(P.classifyUpload(null), null);
});

test('cloudinaryParams: folder, resource type, HEIC → jpg, uploader tag, portrait transformation', () => {
  const heic = P.UPLOAD_TYPES.find(t => t.mime === 'image/heic');
  const p = P.cloudinaryParams(heic, '507f1f77bcf86cd799439011', 'memory');
  assert.equal(p.folder, 'mcu-memories');
  assert.equal(p.resource_type, 'image');
  assert.equal(p.format, 'jpg');
  assert.deepEqual(p.tags, ['u_507f1f77bcf86cd799439011']);
  assert.equal(p.context.uid, '507f1f77bcf86cd799439011');
  assert.ok(p.allowed_formats.includes('heic') && p.allowed_formats.includes('mp4'));
  assert.equal(p.transformation, undefined);
  const mov = P.UPLOAD_TYPES.find(t => t.mime === 'video/quicktime');
  assert.equal(P.cloudinaryParams(mov, 'u', 'memory').resource_type, 'video');
  assert.equal(P.cloudinaryParams(mov, 'u', 'memory').format, undefined);
  const png = P.UPLOAD_TYPES.find(t => t.mime === 'image/png');
  assert.deepEqual(P.cloudinaryParams(png, 'u', 'portrait').transformation, [{ width: 512, height: 512, crop: 'limit' }]);
  assert.equal(P.purposeOf('portrait'), 'portrait');
  assert.equal(P.purposeOf('anything'), 'memory');
  assert.equal(P.purposeOf(undefined), 'memory');
});

test('quotaDecision boundaries', () => {
  const L = P.LIMITS;
  assert.deepEqual(P.quotaDecision({ count: L.DAILY_COUNT - 1, bytes: 0, inflight: 0 }), { ok: true });
  assert.equal(P.quotaDecision({ count: L.DAILY_COUNT, bytes: 0, inflight: 0 }).status, 429);
  assert.equal(P.quotaDecision({ count: 0, bytes: L.DAILY_BYTES, inflight: 0 }).status, 429);
  assert.deepEqual(P.quotaDecision({ count: 0, bytes: L.DAILY_BYTES - 1, inflight: L.MAX_INFLIGHT - 1 }), { ok: true });
  assert.equal(P.quotaDecision({ count: 0, bytes: 0, inflight: L.MAX_INFLIGHT }).status, 429);
  assert.deepEqual(P.quotaDecision({}), { ok: true });
});

test('uploadErrorResponse: fixed messages, never the raw error text', () => {
  const secret = 'ENOENT /srv/private/path cloudinary api_key=abc';
  const cases = [
    [{ code: 'LIMIT_FILE_SIZE', message: secret }, 413],
    [{ code: 'UPLOAD_TYPE', message: secret }, 415],
    [{ code: 'LIMIT_UNEXPECTED_FILE', message: secret }, 400],
    [{ code: 'LIMIT_FILE_COUNT', message: secret }, 400],
    [{ http_code: 400, message: secret }, 415],
    [{ http_code: 401, message: secret }, 502],
    [{ http_code: 500, message: secret }, 502],
    [{ code: 'ECONNRESET', message: secret }, 502],
    [new Error(secret), 400],
    [null, 400]
  ];
  for (const [err, status] of cases) {
    const r = P.uploadErrorResponse(err);
    assert.equal(r.status, status, JSON.stringify(err));
    assert.ok(typeof r.error === 'string' && !r.error.includes('api_key') && !r.error.includes('/srv/'), r.error);
  }
});

test('ACCEPT_ATTR covers every mime and extension', () => {
  for (const t of P.UPLOAD_TYPES) {
    assert.ok(P.ACCEPT_ATTR.includes(t.mime));
    for (const e of t.exts) assert.ok(P.ACCEPT_ATTR.includes('.' + e));
  }
});
