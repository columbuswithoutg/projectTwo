/************************************************
 * MESSAGES VIEW — /messages
 *
 * The inbox: one row per conversation (a player, or the reserved "Admin"
 * thread that bug-report replies land in), a thread screen with the full
 * persisted history, and a composer that sends to anyone by username.
 * Whispers sent in /world show up here too — the server stores every
 * whisper, and a whisper to someone who's offline waits here for them.
 * Deep link: /messages?with=<username>.
 ************************************************/
const MessagesView = (() => {
  let _root = null;
  let _seq = 0;
  let _screen = 'list';        // 'list' | 'thread'
  let _thread = null;          // { username } | { system: true }
  let _nextBefore = null;
  let _pollTimer = null;
  let _sending = false;

  const L = () => MessagingLogic;

  function timeAgo(date) {
    const s = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
    if (s < 60) return 'Just now';
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
    return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function stamp(date) {
    const d = new Date(date);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function avatar(user, system) {
    if (system) return `<span class="feed-avatar feed-avatar-md msg-avatar-system" aria-hidden="true">★</span>`;
    const name = user?.username || '?';
    return user?.profilePicture
      ? `<img class="feed-avatar feed-avatar-md" src="${esc(user.profilePicture)}" alt="" loading="lazy" />`
      : `<span class="feed-avatar feed-avatar-md" aria-hidden="true">${esc(name[0].toUpperCase())}</span>`;
  }

  const q = (sel) => _root && _root.querySelector(sel);

  // ── List screen ──
  async function showList() {
    const seq = ++_seq;
    stopPoll();
    _screen = 'list';
    _thread = null;
    const main = q('#messages-main');
    main.innerHTML = `
      <div class="msg-toolbar">
        <button type="button" class="msg-new-btn" id="msg-new-btn">＋ New message</button>
      </div>
      <form class="msg-compose" id="msg-compose" hidden>
        <input type="text" id="msg-compose-to" placeholder="Username" maxlength="${L().C.USERNAME_MAX}" autocomplete="off" />
        <textarea id="msg-compose-text" rows="3" placeholder="Write a message…" maxlength="${L().C.DM_MAX_LEN}"></textarea>
        <div class="msg-compose-actions">
          <button type="button" class="msg-btn msg-btn-ghost" id="msg-compose-cancel">Cancel</button>
          <button type="submit" class="msg-btn">Send</button>
        </div>
      </form>
      <div class="msg-list" id="msg-list"><div class="msg-empty">Loading…</div></div>
    `;

    const compose = q('#msg-compose');
    q('#msg-new-btn').addEventListener('click', () => {
      compose.hidden = !compose.hidden;
      if (!compose.hidden) q('#msg-compose-to').focus();
    });
    q('#msg-compose-cancel').addEventListener('click', () => { compose.hidden = true; });
    compose.addEventListener('submit', async (e) => {
      e.preventDefault();
      const to = q('#msg-compose-to').value.trim();
      const text = q('#msg-compose-text').value;
      const ok = await send(to, text);
      if (ok) openThread({ username: ok.to?.username || to });
    });

    try {
      const data = await Messages.conversations();
      if (seq !== _seq) return;
      renderList(data.conversations || []);
    } catch (err) {
      if (seq !== _seq) return;
      q('#msg-list').innerHTML = `<div class="msg-empty">${esc(err.message)}</div>`;
    }
  }

  function renderList(convs) {
    const list = q('#msg-list');
    if (!convs.length) {
      list.innerHTML = `<div class="msg-empty">No conversations yet. Whisper someone in the World, or start a new message.</div>`;
      return;
    }
    list.innerHTML = convs.map(c => {
      const system = !!c.system;
      const name = system ? 'Admin' : (c.other ? c.other.username : 'Deleted user');
      const target = system ? 'data-system="1"' : (c.other ? `data-user="${esc(c.other.username)}"` : '');
      const prefix = c.last.mine ? 'You: ' : '';
      return `
        <button type="button" class="msg-conv${c.unread ? ' unread' : ''}${system ? ' msg-conv-system' : ''}" ${target}${!system && !c.other ? ' disabled' : ''}>
          ${avatar(c.other, system)}
          <span class="msg-conv-body">
            <span class="msg-conv-top">
              <span class="msg-conv-name">${esc(name)}</span>
              <span class="msg-conv-time">${esc(timeAgo(c.last.createdAt))}</span>
            </span>
            <span class="msg-conv-preview">${esc(prefix + L().preview(c.last.text, 90))}</span>
          </span>
          ${c.unread ? `<span class="msg-unread" aria-label="${c.unread} unread">${c.unread > 99 ? '99+' : c.unread}</span>` : ''}
        </button>`;
    }).join('');
    list.querySelectorAll('.msg-conv').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.system) openThread({ system: true });
        else if (btn.dataset.user) openThread({ username: btn.dataset.user });
      });
    });
  }

  // ── Thread screen ──
  async function openThread(target) {
    _thread = target;
    _screen = 'thread';
    _nextBefore = null;
    const title = target.system ? 'Admin' : target.username;
    const main = q('#messages-main');
    main.innerHTML = `
      <div class="msg-thread">
        <div class="msg-thread-head">
          <button type="button" class="msg-back" id="msg-back" aria-label="Back to conversations">‹</button>
          <span class="msg-thread-name">${esc(title)}</span>
          ${target.system ? '<span class="msg-thread-sub">Replies to your bug reports &amp; suggestions</span>' : ''}
        </div>
        <button type="button" class="msg-btn msg-btn-ghost msg-earlier" id="msg-earlier" hidden>Load earlier</button>
        <div class="msg-log" id="msg-log"><div class="msg-empty">Loading…</div></div>
        ${target.system
          ? `<p class="msg-system-note">You can reply to the admin from the report itself on <a href="/reports" data-link>My reports</a>.</p>`
          : `<form class="msg-form" id="msg-form">
               <textarea id="msg-text" rows="2" placeholder="Message ${esc(title)}…" maxlength="${L().C.DM_MAX_LEN}"></textarea>
               <button type="submit" class="msg-btn">Send</button>
             </form>`}
      </div>
    `;
    q('#msg-back').addEventListener('click', showList);
    q('#msg-earlier').addEventListener('click', () => loadThread({ older: true }));
    const form = q('#msg-form');
    if (form) {
      const ta = q('#msg-text');
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const ok = await send(target.username, ta.value);
        if (ok) { ta.value = ''; loadThread({ silent: true }); }
      });
      ta.focus();
    }
    await loadThread({});
    startPoll();
  }

  async function loadThread({ older = false, silent = false } = {}) {
    if (!_thread) return;
    const seq = _seq;
    const log = q('#msg-log');
    if (!log) return;
    try {
      const before = older ? _nextBefore : null;
      const data = _thread.system ? await Messages.systemThread(before) : await Messages.thread(_thread.username, before);
      if (seq !== _seq || _screen !== 'thread') return;
      if (older) {
        _nextBefore = data.nextBefore;
        const prevHeight = log.scrollHeight;
        log.insertAdjacentHTML('afterbegin', bubbles(data.messages));
        log.scrollTop = log.scrollHeight - prevHeight;
      } else {
        _nextBefore = data.nextBefore;
        const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
        log.innerHTML = data.messages.length ? bubbles(data.messages) : `<div class="msg-empty">No messages yet — say hi.</div>`;
        if (!silent || atBottom) log.scrollTop = log.scrollHeight;
      }
      const earlier = q('#msg-earlier');
      if (earlier) earlier.hidden = !_nextBefore;
      // Opening the thread marked it read server-side; drop the badge now.
      MessagesBadge.refresh();
    } catch (err) {
      if (seq !== _seq) return;
      if (!silent) log.innerHTML = `<div class="msg-empty">${esc(err.message)}</div>`;
    }
  }

  function bubbles(msgs) {
    return msgs.map(m => `
      <div class="msg-bubble${m.mine ? ' mine' : ''}${m.system ? ' system' : ''}">
        <span class="msg-bubble-text">${esc(m.text)}</span>
        <span class="msg-bubble-meta">
          ${esc(stamp(m.createdAt))}
          ${m.kind === 'whisper' ? ' · whisper' : ''}
          ${m.reportId ? ` · <a href="/reports?report=${encodeURIComponent(m.reportId)}" data-link>View report</a>` : ''}
        </span>
      </div>`).join('');
  }

  async function send(to, text) {
    if (_sending) return null;
    const v = L().normalizeDm({ to, text });
    if (!v.ok) { toast(L().errorText(v.error), 'warn'); return null; }
    _sending = true;
    try {
      const res = await Messages.send(v.to, v.text);
      return res;
    } catch (err) {
      toast(err.message || 'Message not sent', 'error');
      return null;
    } finally {
      _sending = false;
    }
  }

  // Light polling while a thread is open so a reply appears without a
  // manual refresh (the socket isn't connected outside the 3D views).
  function startPoll() {
    stopPoll();
    _pollTimer = setInterval(() => { if (document.visibilityState === 'visible') loadThread({ silent: true }); }, 15000);
  }
  function stopPoll() {
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = null;
  }

  function mount(container) {
    if (!Auth.isLoggedIn()) { Router.go('/login'); return; }
    _seq++;
    _root = container;
    container.innerHTML = `
      <header id="header">
        <button id="back-btn">← Back</button>
        <h1>Messages</h1>
        <div style="width:48px"></div>
      </header>
      <main id="messages-wrapper"><div id="messages-main" class="msg-column"></div></main>
    `;
    container.querySelector('#back-btn').addEventListener('click', () => Router.go('/'));

    const params = new URLSearchParams(location.search);
    const withUser = params.get('with');
    if (withUser) openThread({ username: withUser });
    else if (params.get('admin') === '1') openThread({ system: true });
    else showList();
  }

  function unmount() {
    _seq++;
    stopPoll();
    _root = null;
    _thread = null;
    _screen = 'list';
  }

  return { title: 'Messages — MCU Tracker', mount, unmount };
})();
