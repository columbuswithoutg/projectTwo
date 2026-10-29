/************************************************
 * ISLAND GAMES — every /world island minigame behind one interface
 *
 * routes/world-socket.js talks to this instead of each game: attach /
 * register / retire / resume / onZone / socketGone fan out to every game,
 * isPlaying is true when the socket is in ANY game (punch, NPC and snap
 * immunity), and endAll ends them all on shutdown.
 *
 * It is also each game's `peers`: one game per island across every kind
 * (a Scene Guess lobby refuses an island Quote Guess is using, and the
 * reverse), and one game per player.
 *
 * createRegistry(managers) is the pure fan-out (test/island-games.test.js);
 * the module itself is the registry of the real games, built on first use.
 ************************************************/

function createRegistry(managers) {
  const list = managers.slice();
  const others = (kind) => list.filter(m => m.kind !== kind);
  const reg = {
    managers: list,
    get(kind) { return list.find(m => m.kind === kind) || null; },
    islandBusy: (projectId, kind) => others(kind).some(m => m.hasGame(projectId)),
    userBusy: (userId, kind) => others(kind).some(m => m.userInGame(userId)),
    isPlaying: (sid) => list.some(m => m.isPlaying(sid)),
    attach(io, world) { list.forEach(m => m.attach(io, world)); },
    register(socket) { list.forEach(m => m.register(socket)); },
    retire(sid) { list.forEach(m => m.retire(sid)); },
    resume(socket) { list.forEach(m => m.resume(socket)); },
    onZone(socket, p, prev, next) { list.forEach(m => m.onZone(socket, p, prev, next)); },
    socketGone(sid) { list.forEach(m => m.socketGone(sid)); },
    endAll(reason) { return list.reduce((n, m) => n + m.endAll(reason), 0); }
  };
  list.forEach(m => m.setPeers(reg));
  return reg;
}

let _real = null;
function real() {
  if (!_real) {
    _real = createRegistry([
      require('./scene-guess').instance(),
      require('./quote-guess').instance()
    ]);
  }
  return _real;
}

// The real registry's methods, resolved on first call (so requiring this
// file loads no models).
const api = { createRegistry };
for (const k of ['get', 'islandBusy', 'userBusy', 'isPlaying', 'attach', 'register', 'retire', 'resume', 'onZone', 'socketGone', 'endAll']) {
  api[k] = (...args) => real()[k](...args);
}
module.exports = api;
