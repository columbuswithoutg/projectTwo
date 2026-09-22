/************************************************
 * MESSAGES API + UNREAD BADGE
 *
 * Fetch wrappers for /api/messages (the persisted-whisper inbox) and the
 * app-wide unread counter that the nav drawers show next to "Messages".
 * The badge polls one cheap endpoint on a timer — the realtime socket only
 * exists while a 3D view is mounted, so HTTP is the one channel every
 * page has.
 ************************************************/
const Messages = (() => {
  const headers = (json) => ({
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    Authorization: `Bearer ${Auth.getToken()}`
  });

  // Parse JSON and throw the server's `error` on a non-2xx — every caller
  // wants the message for a toast, not a status code.
  async function call(path, opts = {}) {
    const res = await fetch(`${API}/messages${path}`, opts);
    let body = null;
    try { body = await res.json(); } catch (_) {}
    if (res.status === 401) { Auth.logout(); throw new Error('Session expired'); }
    if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`);
    return body;
  }

  return {
    unreadCount: () => call('/unread-count', { headers: headers() }),
    conversations: () => call('/', { headers: headers() }),
    thread: (username, before) =>
      call(`/with/${encodeURIComponent(username)}${before ? '?before=' + encodeURIComponent(before) : ''}`, { headers: headers() }),
    systemThread: (before) =>
      call(`/system${before ? '?before=' + encodeURIComponent(before) : ''}`, { headers: headers() }),
    send: (to, text) => call('/', { method: 'POST', headers: headers(true), body: JSON.stringify({ to, text }) })
  };
})();

const MessagesBadge = (() => {
  let _count = 0;
  let _timer = null;

  // Paint the cached count into every badge currently in the DOM. Views
  // re-render their drawer on mount, so they call this after wiring it.
  function apply(count) {
    if (typeof count === 'number') _count = count;
    document.querySelectorAll('[data-unread-badge]').forEach(el => {
      el.textContent = _count > 99 ? '99+' : String(_count);
      el.hidden = _count <= 0;
    });
  }

  async function refresh() {
    if (typeof Auth === 'undefined' || !Auth.isLoggedIn()) { apply(0); return; }
    try {
      const data = await Messages.unreadCount();
      apply(typeof data.count === 'number' ? data.count : 0);
    } catch (_) { /* keep the last known count */ }
  }

  function start() {
    if (_timer) return;
    const ms = (typeof MessagingLogic !== 'undefined' && MessagingLogic.C.POLL_MS) || 45000;
    _timer = setInterval(refresh, ms);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refresh();
    });
    refresh();
  }

  function stop() {
    if (_timer) clearInterval(_timer);
    _timer = null;
  }

  return { start, stop, refresh, apply, count: () => _count };
})();
