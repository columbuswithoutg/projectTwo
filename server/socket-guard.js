/************************************************
 * server/socket-guard.js — small pure helpers for the HTTP + socket edge.
 *
 *  parseTrustProxy(env)      how many proxy hops to trust (TRUST_PROXY env)
 *  clientIp(xff, remote, n)  the client address behind n trusted hops, the
 *                            same answer Express gives req.ip, for the
 *                            socket.io handshake (which has no req.ip)
 *  homeEjections(map, a, b)  the home sockets that must leave when a and b
 *                            stop being friends
 *
 * Unit-tested in test/socket-guard.test.js.
 ************************************************/

// Render = one proxy hop. An integer 0–10 from TRUST_PROXY overrides it;
// anything else (unset, blank, junk) is the default 1.
function parseTrustProxy(raw) {
  if (raw == null || String(raw).trim() === '') return 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 10) return 1;
  return n;
}

// X-Forwarded-For is "client, proxy1, proxy2": the rightmost `hops` entries
// were appended by proxies we trust, so the client is the entry just left of
// them. With 0 hops (or no header) the socket's own address is the client.
function clientIp(xff, remoteAddr, hops) {
  const h = Number.isInteger(hops) ? hops : 1;
  const list = String(xff || '').split(',').map(s => s.trim()).filter(Boolean);
  let ip;
  if (h > 0 && list.length) ip = list[Math.max(0, list.length - h)];
  else ip = String(remoteAddr || '');
  return ip.replace(/^::ffff:/, '');
}

// homePlayers: Map<socketId, { userId, ownerId, ... }>. Returns
// [{ sid, ownerId }] for every socket of `a` inside b's home and of `b`
// inside a's home — never anyone else, never other homes.
function homeEjections(homePlayers, a, b) {
  const A = String(a), B = String(b);
  const out = [];
  if (!homePlayers || typeof homePlayers.entries !== 'function') return out;
  for (const [sid, p] of homePlayers.entries()) {
    if (!p) continue;
    const u = String(p.userId), o = String(p.ownerId);
    if ((u === A && o === B) || (u === B && o === A)) out.push({ sid, ownerId: o });
  }
  return out;
}

module.exports = { parseTrustProxy, clientIp, homeEjections };
