/************************************************
 * FEED VIEW — /feed
 *
 * Facebook-style activity feed: a card whenever you or a friend watches a
 * project, who they watched it with, any memories they added, and a comment
 * thread friends can post into. Posts are created server-side from progress
 * activity (server/feed.js) — this view only reads + comments.
 ************************************************/
const FeedView = (() => {
  let _root = null;
  let _nextBefore = null;
  let _loading = false;
  let _friendNames = new Set();
  let _seq = 0;
  // Collapsed threads show only the latest few comments.
  const COLLAPSED_COMMENTS = 2;
  // Keys mirror REACTION_TYPES in routes/feed.js + the FeedPost enum.
  const REACTIONS = [
    // Mid-tone label colors so the text stays readable on light AND dark cards.
    { type: 'like',  emoji: '👍', label: 'Like',  color: '#2f7ff0' },
    { type: 'love',  emoji: '❤️', label: 'Love',  color: '#e8334f' },
    { type: 'haha',  emoji: '😂', label: 'Haha',  color: '#c98a00' },
    { type: 'wow',   emoji: '😮', label: 'Wow',   color: '#c98a00' },
    { type: 'sad',   emoji: '😢', label: 'Sad',   color: '#c98a00' },
    { type: 'angry', emoji: '😡', label: 'Angry', color: '#dd6a10' }
  ];
  const HOVER_OPEN_MS = 450;
  const LONG_PRESS_MS = 450;

  const authHeaders = (json) => ({
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    Authorization: `Bearer ${Auth.getToken()}`
  });

  function timeAgo(date) {
    const s = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
    if (s < 60) return 'Just now';
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
    return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function ordinal(n) {
    const v = n % 100;
    const suf = (v >= 11 && v <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
    return n + suf;
  }

  const projectFor = (id) => (window.projects || []).find(p => p.id === id) || { id, title: id };

  function avatar(user, size) {
    const name = user?.username || '?';
    const cls = `feed-avatar feed-avatar-${size}`;
    return user?.profilePicture
      ? `<img class="${cls}" src="${esc(user.profilePicture)}" alt="" loading="lazy" />`
      : `<span class="${cls}" aria-hidden="true">${esc(name[0].toUpperCase())}</span>`;
  }

  // Names link to the friend's pages only when the viewer is actually their
  // friend (or it's the viewer) — a co-watcher outside your circle would 403.
  function nameLink(username, { capital = false } = {}) {
    const me = Auth.getUsername();
    if (username === me) return `<a href="/profile" data-link class="feed-name">${capital ? 'You' : 'you'}</a>`;
    if (_friendNames.has(username)) {
      return `<a href="/friend/${encodeURIComponent(username)}" data-link class="feed-name">${esc(username)}</a>`;
    }
    return `<span class="feed-name">${esc(username)}</span>`;
  }

  function withList(names) {
    if (!names.length) return '';
    const links = names.map(nameLink);
    if (links.length === 1) return ` with ${links[0]}`;
    if (links.length === 2) return ` with ${links[0]} and ${links[1]}`;
    return ` with ${links[0]}, ${links[1]} and ${links.length - 2} other${links.length - 2 > 1 ? 's' : ''}`;
  }

  function headline(post, project) {
    const who = nameLink(post.author.username, { capital: true });
    const title = `<strong class="feed-title">${esc(project.title)}</strong>`;
    if (post.kind === 'memory') {
      const n = post.memories.length;
      return `${who} added ${n > 1 ? n + ' memories' : 'a memory'} from ${title}`;
    }
    return `${who} watched ${title}${withList(post.watchedWith)}`;
  }

  function memoriesHtml(post) {
    const m = post.memories;
    if (!m.length) return '';
    const shown = m.slice(0, 4);
    const extra = m.length - shown.length;
    return `
      <div class="feed-memories feed-memories-${shown.length}">
        ${shown.map((mem, i) => `
          <button type="button" class="feed-memory" data-index="${i}" aria-label="Open memory ${i + 1}">
            ${mem.type === 'video'
              ? `<video src="${esc(mem.url)}" muted playsinline preload="metadata"></video><span class="feed-memory-play" aria-hidden="true">▶</span>`
              : `<img src="${esc(mem.url)}" alt="${esc(mem.caption)}" loading="lazy" />`}
            ${i === shown.length - 1 && extra > 0 ? `<span class="feed-memory-more">+${extra}</span>` : ''}
          </button>
        `).join('')}
      </div>
      ${m.length === 1 && m[0].caption ? `<p class="feed-caption">“${esc(m[0].caption)}”</p>` : ''}
    `;
  }

  function projectStrip(project) {
    const year = project.release ? String(project.release).slice(0, 4) : '';
    const sub = [project.phase, year].filter(Boolean).join(' · ');
    return `
      <div class="feed-project">
        ${project.image
          ? `<img class="feed-poster" src="${assetUrl(CONFIG.IMAGE_BASE + project.image)}" alt="" loading="lazy" />`
          : '<span class="feed-poster feed-poster-blank" aria-hidden="true">🎬</span>'}
        <div class="feed-project-text">
          <span class="feed-project-title">${esc(project.title)}</span>
          ${sub ? `<span class="feed-project-sub">${esc(sub)}</span>` : ''}
        </div>
      </div>
    `;
  }

  function commentHtml(c, post) {
    const me = Auth.getUsername();
    const canDelete = post.mine || c.author?.username === me;
    return `
      <li class="feed-comment" data-comment-id="${esc(c.id)}">
        ${avatar(c.author, 'sm')}
        <div class="feed-comment-body">
          <div class="feed-comment-bubble">
            ${nameLink(c.author.username, { capital: true })}
            <p>${esc(c.text)}</p>
          </div>
          <div class="feed-comment-meta">
            <span>${timeAgo(c.createdAt)}</span>
            ${canDelete ? `<button type="button" class="feed-comment-delete">Delete</button>` : ''}
          </div>
        </div>
      </li>
    `;
  }

  function commentsListHtml(post, expanded) {
    const all = post.comments;
    const hidden = expanded ? 0 : Math.max(0, all.length - COLLAPSED_COMMENTS);
    return `
      ${hidden ? `<button type="button" class="feed-comments-more">View ${hidden} earlier comment${hidden > 1 ? 's' : ''}</button>` : ''}
      <ul class="feed-comment-list">${all.slice(hidden).map(c => commentHtml(c, post)).join('')}</ul>
    `;
  }

  /* ---------- Caption ---------- */

  function captionHtml(post) {
    if (post.caption) {
      return `<p class="feed-post-caption">${esc(post.caption)}</p>`;
    }
    return post.mine
      ? `<button type="button" class="feed-caption-add">Add a caption…</button>`
      : '';
  }

  /* ---------- Reactions ---------- */

  const reactionMeta = (type) => REACTIONS.find(r => r.type === type) || REACTIONS[0];

  // "You and 3 others" / "elsid and 2 others" / "elsid" — plus the top three
  // reaction emoji, most-used first.
  function reactionSummaryHtml(post) {
    const list = post.reactions;
    if (!list.length) return '';
    const counts = {};
    list.forEach(r => { counts[r.type] = (counts[r.type] || 0) + 1; });
    const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 3);
    const me = Auth.getUsername();
    const lead = post.myReaction ? 'You' : esc(list[0].user.username);
    const others = list.length - 1;
    const text = others > 0 ? `${lead} and ${others} other${others > 1 ? 's' : ''}` : lead;
    const label = list.map(r => `${r.user.username === me ? 'You' : r.user.username} (${reactionMeta(r.type).label})`).join(', ');
    return `
      <button type="button" class="feed-reaction-summary" aria-label="Reactions: ${esc(label)}">
        <span class="feed-reaction-stack" aria-hidden="true">
          ${top.map(t => `<span class="feed-reaction-bubble">${reactionMeta(t).emoji}</span>`).join('')}
        </span>
        <span>${text}</span>
      </button>
    `;
  }

  function summaryRowHtml(post) {
    const n = post.comments.length;
    if (!post.reactions.length && !n) return '';
    return `
      ${reactionSummaryHtml(post) || '<span></span>'}
      ${n ? `<button type="button" class="feed-comment-count">${n} comment${n > 1 ? 's' : ''}</button>` : ''}
    `;
  }

  function reactButtonHtml(post) {
    if (!post.myReaction) {
      return `<span class="feed-react-emoji" aria-hidden="true">👍</span><span>Like</span>`;
    }
    const m = reactionMeta(post.myReaction);
    return `<span class="feed-react-emoji" aria-hidden="true">${m.emoji}</span><span style="color:${m.color}">${m.label}</span>`;
  }

  function showReactorsModal(post) {
    const me = Auth.getUsername();
    const types = REACTIONS.filter(r => post.reactions.some(x => x.type === r.type));
    let filter = 'all';
    const modal = document.createElement('div');
    modal.className = 'auth-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Reactions');

    const render = () => {
      const rows = post.reactions.filter(r => filter === 'all' || r.type === filter);
      modal.innerHTML = `
        <div class="auth-box feed-reactors-box">
          <button class="popup-close" aria-label="Close">✕</button>
          <div class="feed-reactors-tabs" role="tablist">
            <button type="button" role="tab" data-filter="all" aria-selected="${filter === 'all'}">All ${post.reactions.length}</button>
            ${types.map(t => `
              <button type="button" role="tab" data-filter="${t.type}" aria-selected="${filter === t.type}" aria-label="${t.label}">
                ${t.emoji} ${post.reactions.filter(r => r.type === t.type).length}
              </button>`).join('')}
          </div>
          <ul class="feed-reactors-list">
            ${rows.map(r => `
              <li>
                <span class="feed-reactor-avatar">
                  ${avatar(r.user, 'md')}
                  <span class="feed-reactor-badge" aria-label="${reactionMeta(r.type).label}">${reactionMeta(r.type).emoji}</span>
                </span>
                ${r.user.username === me ? '<span class="feed-name">You</span>' : nameLink(r.user.username)}
              </li>`).join('')}
          </ul>
        </div>
      `;
      modal.querySelector('.popup-close').onclick = () => close();
      modal.querySelectorAll('[data-filter]').forEach(b => {
        b.onclick = () => { filter = b.dataset.filter; render(); modal.querySelector(`[data-filter="${filter}"]`)?.focus(); };
      });
      // Name links navigate away — close first so the overlay doesn't linger.
      modal.querySelectorAll('a[data-link]').forEach(a => a.addEventListener('click', () => close()));
    };
    render();
    document.body.appendChild(modal);
    const close = wireModalDismiss(modal, () => modal.remove(), {
      initialFocus: modal.querySelector('.popup-close')
    });
  }

  function cardHtml(post) {
    const project = projectFor(post.projectId);
    const rewatch = post.kind === 'watch' && post.count > 1 ? ` · ${ordinal(post.count)} watch` : '';
    const memoryBadge = post.kind === 'watch' && post.memories.length
      ? ` · 📸 ${post.memories.length} ${post.memories.length > 1 ? 'memories' : 'memory'}` : '';
    const n = post.comments.length;
    return `
      <article class="feed-card" data-post-id="${esc(post.id)}">
        <header class="feed-card-head">
          ${avatar(post.author, 'md')}
          <div class="feed-card-headtext">
            <p class="feed-line">${headline(post, project)}</p>
            <p class="feed-meta">${timeAgo(post.createdAt)}${rewatch}${memoryBadge}</p>
          </div>
          ${post.mine ? `<button type="button" class="feed-caption-edit" title="Edit caption" aria-label="Edit caption">✎</button>` : ''}
        </header>
        <div class="feed-caption-slot">${captionHtml(post)}</div>
        ${memoriesHtml(post)}
        ${projectStrip(project)}
        <div class="feed-summary">${summaryRowHtml(post)}</div>
        <div class="feed-actions">
          <div class="feed-react-wrap">
            <button type="button" class="feed-react-btn${post.myReaction ? ' reacted' : ''}"
                    aria-haspopup="true" aria-pressed="${!!post.myReaction}"
                    title="Hold or hover for more reactions">${reactButtonHtml(post)}</button>
            <div class="feed-reaction-picker" role="menu" aria-label="Reactions" hidden>
              ${REACTIONS.map(r => `
                <button type="button" role="menuitem" class="feed-reaction-option" data-type="${r.type}" aria-label="${r.label}">
                  <span class="feed-reaction-option-emoji">${r.emoji}</span>
                  <span class="feed-reaction-option-label">${r.label}</span>
                </button>`).join('')}
            </div>
          </div>
          <button type="button" class="feed-comment-toggle" aria-expanded="${n ? 'true' : 'false'}">
            Comment
          </button>
        </div>
        <section class="feed-comments" ${n ? '' : 'hidden'}>
          <div class="feed-comments-inner">${commentsListHtml(post, false)}</div>
          <form class="feed-comment-form">
            ${avatar({ username: Auth.getUsername() || '?' }, 'sm')}
            <input type="text" class="feed-comment-input" maxlength="500"
                   placeholder="Write a comment…" aria-label="Write a comment" autocomplete="off" />
            <button type="submit" class="feed-comment-send" disabled aria-label="Post comment">➤</button>
          </form>
        </section>
      </article>
    `;
  }

  // Tap = Like / un-react. Hover (mouse) or long-press (touch) opens the
  // six-reaction picker; ArrowUp opens it from the keyboard. Updates are
  // optimistic and reconciled with the server's list.
  function wireReactions(card, post, onChange) {
    const wrap = card.querySelector('.feed-react-wrap');
    const btn = card.querySelector('.feed-react-btn');
    const picker = card.querySelector('.feed-reaction-picker');
    const options = [...picker.querySelectorAll('.feed-reaction-option')];
    let hoverTimer = null;
    let closeTimer = null;
    let pressTimer = null;
    let suppressClick = false;
    let requestSeq = 0;

    const paint = () => {
      btn.innerHTML = reactButtonHtml(post);
      btn.classList.toggle('reacted', !!post.myReaction);
      btn.setAttribute('aria-pressed', String(!!post.myReaction));
      onChange();
    };

    function onOutside(e) { if (!wrap.contains(e.target)) closePicker(); }
    function openPicker() {
      clearTimeout(closeTimer);
      if (!picker.hidden) return;
      picker.hidden = false;
      document.addEventListener('pointerdown', onOutside, true);
    }
    function closePicker() {
      clearTimeout(hoverTimer);
      clearTimeout(closeTimer);
      picker.hidden = true;
      document.removeEventListener('pointerdown', onOutside, true);
    }

    async function setReaction(type) {
      closePicker();
      const prev = { myReaction: post.myReaction, reactions: post.reactions };
      const me = Auth.getUsername();
      const others = post.reactions.filter(r => r.user.username !== me);
      post.myReaction = type;
      post.reactions = type
        ? [...others, { type, user: { id: 'me', username: me, profilePicture: '' } }]
        : others;
      paint();
      const seq = ++requestSeq;
      try {
        const res = await fetch(`${API}/feed/${post.id}/reaction`, {
          method: 'PUT',
          headers: authHeaders(true),
          body: JSON.stringify({ type })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        if (seq !== requestSeq) return;   // a newer tap already superseded this
        post.reactions = data.reactions;
        post.myReaction = data.myReaction;
        paint();
      } catch (_) {
        if (seq !== requestSeq) return;
        Object.assign(post, prev);
        paint();
        toast("Couldn't save your reaction", 'error');
      }
    }

    btn.addEventListener('click', () => {
      if (suppressClick) { suppressClick = false; return; }
      setReaction(post.myReaction ? null : 'like');
    });

    // Mouse: hover to open, leave the whole wrap to close (with grace time
    // so the pointer can travel from the button up into the picker).
    btn.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(closeTimer);
      hoverTimer = setTimeout(openPicker, HOVER_OPEN_MS);
    });
    wrap.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(hoverTimer);
      closeTimer = setTimeout(closePicker, 350);
    });
    picker.addEventListener('pointerenter', () => clearTimeout(closeTimer));

    // Touch: long-press opens; the click that follows the press is eaten.
    btn.addEventListener('pointerdown', (e) => {
      suppressClick = false;
      if (e.pointerType === 'mouse') return;
      pressTimer = setTimeout(() => {
        suppressClick = true;
        openPicker();
        navigator.vibrate?.(10);
      }, LONG_PRESS_MS);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
      btn.addEventListener(ev, () => clearTimeout(pressTimer)));
    btn.addEventListener('contextmenu', (e) => e.preventDefault());

    // Keyboard.
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        openPicker();
        options[Math.max(0, REACTIONS.findIndex(r => r.type === post.myReaction))].focus();
      }
    });
    picker.addEventListener('keydown', (e) => {
      const i = options.indexOf(document.activeElement);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
        options[next].focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closePicker();
        btn.focus();
      }
    });

    options.forEach(opt => opt.addEventListener('click', () => {
      setReaction(opt.dataset.type);
      btn.focus({ preventScroll: true });
    }));
  }

  // Author-only caption: inline editor in place of the caption text.
  // Enter saves, Shift+Enter adds a line, Escape cancels.
  function wireCaption(card, post) {
    if (!post.mine) return;
    const slot = card.querySelector('.feed-caption-slot');
    const editBtn = card.querySelector('.feed-caption-edit');

    function show() {
      slot.innerHTML = captionHtml(post);
      slot.querySelector('.feed-caption-add')?.addEventListener('click', edit);
    }

    function edit() {
      const existing = slot.querySelector('.feed-caption-input');
      if (existing) { existing.focus(); return; }
      slot.innerHTML = `
        <form class="feed-caption-form">
          <textarea class="feed-caption-input" maxlength="500" rows="2"
                    placeholder="Say something about this…" aria-label="Caption"></textarea>
          <div class="feed-caption-actions">
            <span class="feed-caption-counter" aria-live="polite"></span>
            <button type="button" class="feed-caption-cancel">Cancel</button>
            <button type="submit" class="feed-caption-save">Save</button>
          </div>
        </form>
      `;
      const form = slot.querySelector('form');
      const ta = slot.querySelector('textarea');
      const counter = slot.querySelector('.feed-caption-counter');
      const save = slot.querySelector('.feed-caption-save');
      const sync = () => {
        ta.style.height = 'auto';
        ta.style.height = ta.scrollHeight + 'px';
        const left = 500 - ta.value.length;
        counter.textContent = left <= 60 ? `${left} left` : '';
        save.disabled = ta.value.trim() === post.caption;
      };
      ta.value = post.caption;
      sync();
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);

      ta.addEventListener('input', sync);
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); show(); editBtn.focus(); }
        else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
      });
      slot.querySelector('.feed-caption-cancel').addEventListener('click', () => { show(); editBtn.focus(); });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (save.disabled) return;
        save.disabled = true;
        ta.disabled = true;
        save.textContent = 'Saving…';
        try {
          const res = await fetch(`${API}/feed/${post.id}/caption`, {
            method: 'PUT',
            headers: authHeaders(true),
            body: JSON.stringify({ caption: ta.value })
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          post.caption = data.caption;
          show();
        } catch (err) {
          toast(err.message || "Couldn't save caption", 'error');
          ta.disabled = false;
          save.textContent = 'Save';
          sync();
          ta.focus();
        }
      });
    }

    editBtn.addEventListener('click', edit);
    show();
  }

  function wireCard(card, post) {
    let expanded = false;
    const section = card.querySelector('.feed-comments');
    const inner = card.querySelector('.feed-comments-inner');
    const input = card.querySelector('.feed-comment-input');
    const send = card.querySelector('.feed-comment-send');
    const toggle = card.querySelector('.feed-comment-toggle');
    const summary = card.querySelector('.feed-summary');

    const refreshSummary = () => { summary.innerHTML = summaryRowHtml(post); };
    const rerender = () => { inner.innerHTML = commentsListHtml(post, expanded); refreshSummary(); };

    const openComments = () => {
      section.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      input.focus();
    };
    toggle.addEventListener('click', openComments);
    summary.addEventListener('click', (e) => {
      if (e.target.closest('.feed-comment-count')) openComments();
      else if (e.target.closest('.feed-reaction-summary')) showReactorsModal(post);
    });

    wireReactions(card, post, refreshSummary);
    wireCaption(card, post);

    card.querySelectorAll('.feed-memory').forEach(btn => {
      btn.addEventListener('click', () => {
        showMemoryLightbox(post.memories, Number(btn.dataset.index), projectFor(post.projectId));
      });
    });

    inner.addEventListener('click', async (e) => {
      if (e.target.closest('.feed-comments-more')) {
        expanded = true;
        rerender();
        return;
      }
      const del = e.target.closest('.feed-comment-delete');
      if (!del) return;
      const li = del.closest('.feed-comment');
      const id = li.dataset.commentId;
      const idx = post.comments.findIndex(c => c.id === id);
      if (idx === -1) return;
      // Optimistic remove; restore on failure.
      const [removed] = post.comments.splice(idx, 1);
      rerender();
      try {
        const res = await fetch(`${API}/feed/${post.id}/comments/${id}`, { method: 'DELETE', headers: authHeaders() });
        if (!res.ok) throw new Error();
      } catch (_) {
        post.comments.splice(idx, 0, removed);
        rerender();
        toast("Couldn't delete comment", 'error');
      }
    });

    input.addEventListener('input', () => { send.disabled = !input.value.trim(); });

    card.querySelector('.feed-comment-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || send.disabled) return;
      send.disabled = true;
      input.disabled = true;
      try {
        const res = await fetch(`${API}/feed/${post.id}/comments`, {
          method: 'POST',
          headers: authHeaders(true),
          body: JSON.stringify({ text })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        post.comments.push(data.comment);
        input.value = '';
        rerender();
      } catch (err) {
        toast(err.message && err.message !== 'Failed' ? err.message : "Couldn't post comment", 'error');
      } finally {
        input.disabled = false;
        send.disabled = !input.value.trim();
        input.focus();
      }
    });
  }

  function appendPosts(posts) {
    const list = _root.querySelector('.feed-list');
    for (const post of posts) {
      const tmp = document.createElement('div');
      tmp.innerHTML = cardHtml(post);
      const card = tmp.firstElementChild;
      list.appendChild(card);
      wireCard(card, post);
    }
  }

  function renderEmpty() {
    const hasFriends = _friendNames.size > 0;
    _root.querySelector('.feed-list').innerHTML = `
      <div class="feed-empty">
        <div class="feed-empty-icon" aria-hidden="true">🍿</div>
        <h2>Your feed is quiet</h2>
        <p>${hasFriends
          ? "When you or your friends watch something, it'll show up here."
          : 'Add friends to see what they watch, who they watch with, and the memories they share.'}</p>
        ${hasFriends
          ? '<a class="feed-empty-cta" href="/" data-link>Go to Watch Order</a>'
          : '<button type="button" class="feed-empty-cta" id="feed-find-friends">Find friends</button>'}
      </div>
    `;
    _root.querySelector('#feed-find-friends')?.addEventListener('click', () => showFriendsPanel());
  }

  function skeleton() {
    return Array.from({ length: 3 }, () => `
      <div class="feed-card feed-skeleton" aria-hidden="true">
        <div class="feed-card-head"><span class="feed-avatar feed-avatar-md"></span>
          <div class="feed-card-headtext"><span class="sk-line"></span><span class="sk-line short"></span></div>
        </div>
        <div class="sk-block"></div>
      </div>`).join('');
  }

  async function loadPage(first) {
    if (_loading) return;
    _loading = true;
    const seq = _seq;
    const more = _root.querySelector('.feed-more');
    more.hidden = true;
    const url = `${API}/feed${_nextBefore ? `?before=${encodeURIComponent(_nextBefore)}` : ''}`;
    try {
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (seq !== _seq) return;
      const list = _root.querySelector('.feed-list');
      if (first) list.innerHTML = '';
      if (first && !data.posts.length) {
        renderEmpty();
      } else {
        appendPosts(data.posts);
      }
      _nextBefore = data.nextBefore;
      more.hidden = !_nextBefore;
    } catch (_) {
      if (seq !== _seq) return;
      if (first) {
        _root.querySelector('.feed-list').innerHTML = `
          <div class="feed-empty">
            <h2>Couldn't load your feed</h2>
            <button type="button" class="feed-empty-cta" id="feed-retry">Retry</button>
          </div>`;
        _root.querySelector('#feed-retry').addEventListener('click', () => {
          _root.querySelector('.feed-list').innerHTML = skeleton();
          loadPage(true);
        });
      } else {
        more.hidden = false;
        toast("Couldn't load more posts", 'error');
      }
    } finally {
      if (seq === _seq) _loading = false;
    }
  }

  async function mount(container) {
    if (!Auth.isLoggedIn()) { Router.go('/login'); return; }
    const seq = ++_seq;
    _root = container;
    _nextBefore = null;
    _loading = false;

    container.innerHTML = `
      <header id="header">
        <button id="feed-friends-btn" class="feed-header-btn" title="Friends" aria-label="Friends">👥</button>
        <div class="view-tabs" role="tablist" aria-label="View mode">
          <button class="view-tab" data-route="/" role="tab" aria-selected="false">Watch Order</button>
          <button class="view-tab active" data-route="/feed" role="tab" aria-selected="true">Feed</button>
          <button class="view-tab" data-route="/world" role="tab" aria-selected="false">World</button>
        </div>
        <button id="header-profile-btn" title="Profile">
          <img id="header-avatar" src="" alt="" style="display:none" />
          <span id="header-avatar-initials">👤</span>
        </button>
      </header>
      <main id="feed-wrapper">
        <div class="feed-column">
          <div class="feed-list">${skeleton()}</div>
          <button type="button" class="feed-more" hidden>Load more</button>
        </div>
      </main>
    `;

    container.querySelectorAll('.view-tab').forEach(tab => {
      tab.addEventListener('click', () => Router.go(tab.dataset.route));
    });
    container.querySelector('#header-profile-btn').addEventListener('click', () => Router.go('/profile'));
    container.querySelector('#feed-friends-btn').addEventListener('click', () => showFriendsPanel());
    container.querySelector('.feed-more').addEventListener('click', () => loadPage(false));
    initHeaderAvatar();

    // The friends panel can accept watch-party requests, which save the
    // viewer's progress — make sure it's loaded first so that save can't
    // overwrite the account with a near-empty list.
    const stateReady = (WatchOrderView._initialized || AppView._initialized)
      ? Promise.resolve()
      : state.load().then(() => { WatchOrderView._initialized = true; AppView._initialized = true; });

    const friendsReady = Friends.getList()
      .then(list => { if (Array.isArray(list)) _friendNames = new Set(list.map(f => f.username)); })
      .catch(() => {});

    await Promise.all([stateReady, friendsReady]);
    if (seq !== _seq) return;
    loadPage(true);
  }

  function unmount() {
    _seq++;
    _root = null;
  }

  return { title: 'Feed — MCU Tracker', mount, unmount };
})();
