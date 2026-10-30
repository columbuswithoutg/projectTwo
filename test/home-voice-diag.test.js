/************************************************
 * js/views/home.js and js/views/friend-home.js: on a voice connection
 * FAILURE, VoiceManager tears the peer down before it calls
 * onPeerStateChange, so `_diag().peers` no longer has it. The views must log
 * from the snapshot handed over as `st.diag` (as world.js does), or the
 * "[Voice] peer disconnected" line never prints (NET2-06b). Routine
 * teardowns (left, stop, rebuild) also carry a diag and must stay quiet.
 *
 * The real onPeerStateChange arrow is cut out of each view's source and run
 * in a vm with stubbed Playground3D, voice handle and console.
 *
 * Run: npm test  (node --test)
 ************************************************/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Cut `onPeerStateChange: (peerId, st) => { ... }` out by brace matching.
function extractHandler(file) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'views', file), 'utf8');
  const head = 'onPeerStateChange: (peerId, st) => {';
  const at = src.indexOf(head);
  assert.ok(at >= 0, file + ': onPeerStateChange handler not found');
  const open = at + head.length - 1;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at + 'onPeerStateChange: '.length, i + 1);
  }
  throw new Error(file + ': unbalanced handler');
}

const SNAP = { id: 'sock-b', username: 'bob', connectionState: 'failed',
  iceConnectionState: 'failed', bytesReceived: 0, iceCandidateTypes: ['host'] };

function run(file, livePeers, st) {
  const warns = [];
  const voice = { _diag: () => ({ peers: livePeers }) };
  const ctx = vm.createContext({
    Playground3D: { setRemotePlayerSpeaking() {} },
    HomeView: { _voice: voice },     // home.js reads HomeView._voice
    _voice: voice,                   // friend-home.js reads its module _voice
    console: { warn: (...a) => warns.push(a.join(' ')) },
  });
  const fn = vm.runInContext('(' + extractHandler(file) + ')', ctx);
  fn('sock-b', st);
  return warns;
}

for (const file of ['home.js', 'friend-home.js']) {
  test(`${file}: a 'failed' teardown logs the snapshot it was handed`, () => {
    const warns = run(file, [], { connected: false, speaking: false, reason: 'failed', diag: SNAP });
    assert.equal(warns.length, 1);
    assert.match(warns[0], /\[Voice\] peer disconnected: bob connState=failed iceState=failed rxBytes=0 iceTypes=host/);
  });

  test(`${file}: routine teardowns (left, stop, rebuild) stay quiet even with a diag`, () => {
    for (const reason of ['left', 'stop', 'rebuild', 'reconnect']) {
      assert.deepEqual(run(file, [], { connected: false, reason, diag: SNAP }), [], reason);
    }
  });

  test(`${file}: a live 'disconnected' peer still logs from _diag()`, () => {
    const live = Object.assign({}, SNAP, { connectionState: 'disconnected' });
    const warns = run(file, [live], { connected: false, speaking: false, reason: 'disconnected' });
    assert.equal(warns.length, 1);
    assert.match(warns[0], /connState=disconnected/);
  });

  test(`${file}: a snapshot for another peer id is not used`, () => {
    const other = Object.assign({}, SNAP, { id: 'sock-z' });
    assert.deepEqual(run(file, [], { connected: false, reason: 'failed', diag: other }), []);
  });
}
