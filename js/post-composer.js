/************************************************
 * POST COMPOSER — "Create post" before Mark as watched, "Edit post" after
 *
 * Marking a movie (or any series episode) as watched opens this instead of
 * finishing instantly: an optional caption, photos/videos and friends to tag,
 * with a live preview of the exact feed card. "Post" always works — an empty
 * composer posts it as-is. The same composer edits a published post from the
 * feed (✎ Edit post).
 *
 * Desktop (≥ 900px): form on the left, live preview on the right.
 * Phone: full-screen sheet — header with ✕ / title / Post, form, then the
 * preview underneath.
 *
 *   PostComposer.open({ mode: 'complete', project })          → Promise<result|null>
 *   PostComposer.open({ mode: 'edit', post, project, onSaved }) → Promise<post|null>
 ************************************************/
const PostComposer = (() => {
  const CAPTION_MAX = 500;
  const MAX_FILES = { complete: 10, edit: 20 };
  const MAX_FILE_BYTES = 25 * 1024 * 1024; // matches routes/upload.js
  // Unsent composer content per project + episode, so closing and reopening
  // (e.g. to check something) doesn't lose the caption or finished uploads.
  const drafts = new Map();
  let _profilePic = null;
  let _open = null;

  function profilePicture() {
    if (_profilePic !== null) return Promise.resolve(_profilePic);
    return fetch(`${API}/profile`, { headers: { Authorization: `Bearer ${Auth.getToken()}` } })
      .then(r => (r.ok ? r.json() : {}))
      .then(d => { _profilePic = (d && d.profilePicture) || ''; return _profilePic; })
      .catch(() => '');
  }

  // "Episode 3 of 13" / "Season finale — all 13 episodes" / null for movies.
  function episodeInfo(project, episode) {
    const total = Array.isArray(project.episodes) ? project.episodes.length : 0;
    if (!episode || !total) return null;
    return { episode, total, label: episode >= total ? `Season finale · all ${total} episodes` : `Episode ${episode} of ${total}` };
  }

  function ordinal(n) {
    const v = n % 100;
    return n + ((v >= 11 && v <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));
  }

  function avatarHtml(username, pic) {
    return pic
      ? `<img class="pc-avatar" src="${esc(pic)}" alt="" />`
      : `<span class="pc-avatar" aria-hidden="true">${esc((username || '?')[0].toUpperCase())}</span>`;
  }

  function open(opts) {
    if (_open) _open.close(null);
    return new Promise((resolve) => build(opts, resolve));
  }

  function build(opts, resolve) {
    const mode = opts.mode === 'edit' ? 'edit' : 'complete';
    const project = opts.project || {};
    const me = Auth.getUsername() || '';

    // What this post is for.
    let episode = null;
    let count = 1;
    if (mode === 'complete') {
      const s = state.getSession(project.id);
      const eps = state.episodesOf(project);
      episode = eps && s ? s.episode + 1 : null;
      const finishing = !eps || (s && s.episode + 1 >= eps.length);
      count = finishing || (s && s.rewatch) ? state.getCount(project.id) + 1 : 1;
    } else {
      episode = opts.post.episode || null;
      count = opts.post.count || 1;
    }
    const ep = episodeInfo(project, episode);
    const draftKey = `${project.id}:${episode || 0}`;

    // ---- Composer state ----
    const draft = mode === 'complete' ? drafts.get(draftKey) : null;
    let caption = mode === 'edit' ? (opts.post.caption || '') : (draft ? draft.caption : '');
    // media: { key, url, type, local, status: 'uploading'|'done'|'error', progress, file, existing }
    let media = mode === 'edit'
      ? (opts.post.memories || []).map((m, i) => ({ key: 'e' + i, url: m.url, type: m.type, caption: m.caption || '', status: 'done', existing: true }))
      : (draft ? draft.media.filter(m => m.status === 'done') : []);
    const keptTags = mode === 'edit' ? [...(opts.post.watchedWith || [])] : [];
    let newTags = draft ? [...draft.newTags] : [];          // [{ id, username }]
    let friends = null;                                    // [{ id, username }] once loaded
    let showTagPanel = newTags.length > 0;
    let busy = false;
    let pic = _profilePic || '';
    let keySeq = 0;
    const originalCaption = caption;

    // ---- DOM ----
    const overlay = document.createElement('div');
    overlay.className = 'pc-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'pc-title');
    const title = mode === 'edit' ? 'Edit post' : 'Create post';
    const actionLabel = mode === 'edit' ? 'Save' : 'Post';
    const watchedLine = ep
      ? `${esc(project.title)} · ${esc(ep.label)}`
      : `${esc(project.title)}${count > 1 ? ` · ${ordinal(count)} watch` : ''}`;
    overlay.innerHTML = `
      <div class="pc-shell">
        <section class="pc-form" aria-label="${title}">
          <header class="pc-head">
            <button type="button" class="pc-close" aria-label="Close">✕</button>
            <h2 id="pc-title">${title}</h2>
            <button type="button" class="pc-post pc-post-top">${actionLabel}</button>
          </header>
          <div class="pc-scroll">
            <div class="pc-who">
              <span class="pc-avatar-slot">${avatarHtml(me, pic)}</span>
              <div class="pc-who-text">
                <strong>${esc(me)}</strong>
                <span class="pc-watched">${mode === 'edit' ? 'Posted' : 'Watched'} <b>${watchedLine}</b></span>
                <span class="pc-audience" title="Your friends see this in their feed">👥 Friends</span>
              </div>
            </div>
            <div class="pc-chips" role="toolbar" aria-label="Add to your post">
              <button type="button" class="pc-chip" data-act="tag" aria-pressed="false">👥 Tag friends</button>
              <button type="button" class="pc-chip" data-act="media">🖼 Photo / video</button>
            </div>
            <label class="pc-caption-wrap">
              <span class="pc-sr">Caption</span>
              <textarea class="pc-caption" maxlength="${CAPTION_MAX}" rows="3"
                placeholder="What did you think of ${esc(project.title)}${me ? `, ${esc(me)}` : ''}?"></textarea>
              <span class="pc-counter" aria-live="polite"></span>
            </label>
            <div class="pc-tags-slot"></div>
            <div class="pc-media">
              <div class="pc-thumbs"></div>
              <button type="button" class="pc-drop">
                <span class="pc-drop-icon" aria-hidden="true">＋</span>
                <span class="pc-drop-title">Add photos or videos</span>
                <span class="pc-drop-sub">or drag and drop · up to 25 MB each</span>
              </button>
              <input type="file" class="pc-file" accept="image/*,video/*" multiple hidden />
            </div>
            <section class="pc-preview-mobile" aria-label="Preview">
              <h3 class="pc-preview-title">Preview</h3>
              <div class="pc-preview-card"></div>
            </section>
          </div>
          <footer class="pc-foot">
            <p class="pc-hint"></p>
            <button type="button" class="pc-post pc-post-bottom">${actionLabel}</button>
          </footer>
        </section>
        <aside class="pc-preview" aria-label="Preview">
          <h3 class="pc-preview-title">Preview</h3>
          <div class="pc-preview-card"></div>
        </aside>
      </div>`;

    const $ = (sel) => overlay.querySelector(sel);
    const ta = $('.pc-caption');
    const counter = $('.pc-counter');
    const thumbs = $('.pc-thumbs');
    const fileInput = $('.pc-file');
    const drop = $('.pc-drop');
    const postBtns = overlay.querySelectorAll('.pc-post');
    const hint = $('.pc-hint');
    ta.value = caption;

    // ---- Rendering ----
    const uploading = () => media.some(m => m.status === 'uploading');
    const maxFiles = MAX_FILES[mode];

    function renderThumbs() {
      thumbs.innerHTML = media.map(m => `
        <div class="pc-thumb${m.status === 'error' ? ' pc-thumb-error' : ''}" data-key="${m.key}">
          ${m.type === 'video'
            ? `<video src="${esc(m.local || m.url)}" muted playsinline preload="metadata"></video><span class="pc-thumb-play" aria-hidden="true">▶</span>`
            : `<img src="${esc(m.local || m.url)}" alt="" />`}
          ${m.status === 'uploading' ? `<span class="pc-thumb-progress"><i style="width:${Math.round((m.progress || 0) * 100)}%"></i></span>` : ''}
          ${m.status === 'error' ? `<button type="button" class="pc-thumb-retry">Retry</button>` : ''}
          <button type="button" class="pc-thumb-remove" aria-label="Remove">✕</button>
        </div>`).join('');
      drop.hidden = media.length >= maxFiles;
      drop.classList.toggle('pc-drop-compact', media.length > 0);
      syncButtons();
    }

    function renderTags() {
      const slot = $('.pc-tags-slot');
      const chips = [
        ...keptTags.map(n => ({ name: n, kept: true })),
        ...newTags.map(t => ({ name: t.username, id: t.id }))
      ];
      const chipHtml = chips.length ? `
        <div class="pc-tag-chips">
          <span class="pc-tag-with">with</span>
          ${chips.map(c => `<span class="pc-tag${c.kept ? '' : ' pc-tag-pending'}" title="${c.kept ? 'Tagged' : 'Tag request — added once they accept'}">
            ${esc(c.name)}${c.kept ? '' : ' <em>pending</em>'}
            <button type="button" class="pc-tag-x" data-${c.kept ? 'kept' : 'id'}="${esc(c.kept ? c.name : c.id)}" aria-label="Remove ${esc(c.name)}">✕</button>
          </span>`).join('')}
        </div>` : '';
      let panel = '';
      if (showTagPanel) {
        const taken = new Set([...keptTags, ...newTags.map(t => t.username)]);
        const list = friends === null
          ? '<p class="pc-tag-empty">Loading friends…</p>'
          : !friends.length
            ? '<p class="pc-tag-empty">No friends yet — add some from the Friends panel.</p>'
            : friends.filter(f => !taken.has(f.username)).map(f => `
                <button type="button" class="pc-friend" data-id="${esc(f.id)}" data-name="${esc(f.username)}">
                  <span class="pc-friend-avatar" aria-hidden="true">${esc(f.username[0].toUpperCase())}</span>${esc(f.username)}
                </button>`).join('') || '<p class="pc-tag-empty">Everyone is tagged.</p>';
        panel = `
          <div class="pc-tag-panel">
            <input type="search" class="pc-tag-search" placeholder="Search friends" aria-label="Search friends" />
            <div class="pc-friend-list">${list}</div>
            <p class="pc-tag-note">They're added to the post once they accept.</p>
          </div>`;
      }
      slot.innerHTML = chipHtml + panel;
      $('[data-act="tag"]').setAttribute('aria-pressed', String(showTagPanel));
      $('.pc-tag-search')?.addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        overlay.querySelectorAll('.pc-friend').forEach(b => { b.hidden = !!q && !b.dataset.name.toLowerCase().includes(q); });
      });
    }

    let previewQueued = false;
    function renderPreview() {
      if (previewQueued) return;
      previewQueued = true;
      // setTimeout, not rAF: coalesces a burst of keystrokes the same way but
      // still runs when the page isn't painting (background tab, etc.).
      setTimeout(() => {
        previewQueued = false;
        const post = {
          id: 'preview',
          kind: 'watch',
          caption: ta.value.trim(),
          reactions: mode === 'edit' ? (opts.post.reactions || []) : [],
          myReaction: null,
          projectId: project.id,
          count,
          episode,
          watchedWith: [...keptTags, ...newTags.map(t => t.username)],
          memories: media.filter(m => m.status !== 'error').map(m => ({ url: m.local || m.url, type: m.type, caption: m.caption || '' })),
          comments: mode === 'edit' ? (opts.post.comments || []) : [],
          createdAt: mode === 'edit' ? opts.post.createdAt : new Date().toISOString(),
          author: { username: me, profilePicture: pic },
          mine: false
        };
        // asOthersSee: show your name (not "You") — it's how friends see it.
        const html = (typeof FeedView !== 'undefined' && FeedView.previewCardHtml)
          ? FeedView.previewCardHtml(post, { asOthersSee: true }) : '';
        overlay.querySelectorAll('.pc-preview-card').forEach(el => { el.innerHTML = html; });
      }, 0);
    }

    function syncButtons() {
      const up = uploading();
      postBtns.forEach(b => {
        b.disabled = busy || up;
        b.textContent = busy ? (mode === 'edit' ? 'Saving…' : 'Posting…') : up ? 'Uploading…' : actionLabel;
      });
      const pending = newTags.length;
      hint.textContent = mode === 'complete'
        ? (ep ? `Marks ${ep.label.toLowerCase().startsWith('season') ? 'the season' : `episode ${episode}`} as watched and posts it to your friends.` : 'Marks it as watched and posts it to your friends.')
          + (pending ? ` ${pending} tag request${pending > 1 ? 's' : ''} will be sent.` : '')
        : (pending ? `${pending} tag request${pending > 1 ? 's' : ''} will be sent.` : 'Changes show on the post right away.');
    }

    function syncCounter() {
      const left = CAPTION_MAX - ta.value.length;
      counter.textContent = left <= 80 ? `${left} left` : '';
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 320) + 'px';
    }

    // ---- Uploads ----
    function addFiles(fileList) {
      const files = [...fileList];
      const room = maxFiles - media.length;
      if (files.length > room) toast(`You can add up to ${maxFiles} photos or videos per post.`, 'info');
      for (const file of files.slice(0, Math.max(0, room))) {
        if (!/^(image|video)\//.test(file.type)) { toast(`${file.name} isn't a photo or video.`, 'error'); continue; }
        if (file.size > MAX_FILE_BYTES) { toast(`${file.name} is over 25 MB.`, 'error'); continue; }
        const item = {
          key: 'n' + (keySeq++), file, type: file.type.startsWith('video') ? 'video' : 'image',
          local: URL.createObjectURL(file), status: 'uploading', progress: 0
        };
        media.push(item);
        startUpload(item);
      }
      renderThumbs();
      renderPreview();
    }

    function startUpload(item) {
      item.status = 'uploading';
      item.progress = 0;
      uploadMemoryFile(item.file, {
        onProgress: (f) => {
          item.progress = f;
          const bar = thumbs.querySelector(`[data-key="${item.key}"] .pc-thumb-progress i`);
          if (bar) bar.style.width = Math.round(f * 100) + '%';
        }
      }).then(({ url, type }) => {
        item.url = url;
        item.type = type || item.type;
        item.status = 'done';
      }).catch((err) => {
        item.status = 'error';
        toast(err.message || 'Upload failed', 'error');
      }).finally(() => {
        if (!overlay.isConnected) return;
        renderThumbs();
        renderPreview();
      });
    }

    // ---- Events ----
    ta.addEventListener('input', () => { syncCounter(); renderPreview(); });
    $('[data-act="media"]').addEventListener('click', () => fileInput.click());
    drop.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
    const media$ = $('.pc-media');
    ['dragenter', 'dragover'].forEach(ev => media$.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('pc-drop-over'); }));
    ['dragleave', 'drop'].forEach(ev => media$.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('pc-drop-over'); }));
    media$.addEventListener('drop', (e) => { if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); });

    thumbs.addEventListener('click', (e) => {
      const el = e.target.closest('.pc-thumb');
      if (!el) return;
      const item = media.find(m => m.key === el.dataset.key);
      if (!item) return;
      if (e.target.closest('.pc-thumb-remove')) {
        media = media.filter(m => m !== item);
        if (item.local) URL.revokeObjectURL(item.local);
        renderThumbs();
        renderPreview();
      } else if (e.target.closest('.pc-thumb-retry')) {
        startUpload(item);
        renderThumbs();
      }
    });

    let friendsLoading = false;
    function loadFriends() {
      if (friends !== null || friendsLoading) return;
      friendsLoading = true;
      Friends.getList()
        .then(list => { friends = Array.isArray(list) ? list.map(f => ({ id: String(f.id), username: f.username })) : []; })
        .catch(() => { friends = []; })
        .finally(() => { friendsLoading = false; if (overlay.isConnected) renderTags(); });
    }
    $('[data-act="tag"]').addEventListener('click', () => {
      showTagPanel = !showTagPanel;
      renderTags();
      if (showTagPanel) { $('.pc-tag-search')?.focus(); loadFriends(); }
    });
    // A reopened draft with tags starts with the panel open — load now.
    if (showTagPanel) loadFriends();
    $('.pc-tags-slot').addEventListener('click', (e) => {
      const add = e.target.closest('.pc-friend');
      if (add) {
        newTags.push({ id: add.dataset.id, username: add.dataset.name });
        renderTags(); renderPreview(); syncButtons();
        return;
      }
      const x = e.target.closest('.pc-tag-x');
      if (!x) return;
      if (x.dataset.id) newTags = newTags.filter(t => t.id !== x.dataset.id);
      else {
        const i = keptTags.indexOf(x.dataset.kept);
        if (i >= 0) keptTags.splice(i, 1);
      }
      renderTags(); renderPreview(); syncButtons();
    });

    // ---- Submit ----
    async function submit() {
      if (busy || uploading()) return;
      busy = true;
      syncButtons();
      const memories = media.filter(m => m.status === 'done').map(m => ({ url: m.url, type: m.type, caption: m.caption || '' }));
      const tagFriendIds = newTags.map(t => t.id);
      let result = null;
      if (mode === 'complete') {
        result = await state.completeWatching(project.id, { caption: ta.value.trim(), memories, tagFriendIds });
        if (result) drafts.delete(draftKey);
      } else {
        try {
          const res = await fetch(`${API}/feed/${opts.post.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Auth.getToken()}` },
            body: JSON.stringify({ caption: ta.value.trim(), memories, watchedWith: keptTags, tagFriendIds })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "Couldn't save the post");
          result = data.post;
          if (data.tagsSent) toast(`Tag request${data.tagsSent > 1 ? 's' : ''} sent.`, 'success');
          opts.onSaved?.(data.post);
        } catch (err) {
          toast(err.message, 'error');
        }
      }
      busy = false;
      if (result) { close(result, { saved: true }); return; }
      if (overlay.isConnected) syncButtons();
    }
    postBtns.forEach(b => b.addEventListener('click', submit));

    // ---- Open / close ----
    const prevFocus = document.activeElement;
    function close(result = null, { saved = false } = {}) {
      if (!overlay.isConnected) return;
      if (!saved && mode === 'complete') {
        // Keep what they wrote for next time (finished uploads only).
        const kept = media.filter(m => m.status === 'done');
        if (ta.value.trim() || kept.length || newTags.length) {
          drafts.set(draftKey, { caption: ta.value, media: kept, newTags: [...newTags] });
        } else drafts.delete(draftKey);
      } else {
        media.forEach(m => { if (m.local && m.status !== 'done') URL.revokeObjectURL(m.local); });
      }
      window.removeEventListener('keydown', onKey, true);
      document.body.classList.remove('pc-open');
      overlay.remove();
      _open = null;
      if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus();
      resolve(result);
    }

    async function requestClose() {
      if (busy) return;
      const dirty = mode === 'edit' && (ta.value.trim() !== originalCaption.trim() || newTags.length
        || keptTags.length !== (opts.post.watchedWith || []).length
        || media.length !== (opts.post.memories || []).length || media.some(m => !m.existing));
      if (dirty) {
        const ok = await confirmDialog({ title: 'Discard changes?', message: "Your edits to this post won't be saved.", confirmLabel: 'Discard', danger: true });
        if (!ok) return;
      }
      if (uploading() && mode === 'complete') toast('Uploads still in progress were dropped — finished ones are kept for next time.', 'info');
      close(null);
    }

    // Capture on window so Escape closes only the composer, not a popup
    // (e.g. the project popup) that's still open underneath.
    function onKey(e) {
      if (e.key === 'Escape') {
        if (document.querySelector('.confirm-modal')) return; // the discard confirm handles its own Escape
        e.preventDefault();
        e.stopImmediatePropagation();
        requestClose();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submit();
      }
    }
    window.addEventListener('keydown', onKey, true);
    $('.pc-close').addEventListener('click', requestClose);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) requestClose(); });

    document.body.appendChild(overlay);
    document.body.classList.add('pc-open');
    _open = { close };
    syncCounter();
    renderThumbs();
    renderTags();
    renderPreview();
    requestAnimationFrame(() => ta.focus({ preventScroll: true }));
    if (!_profilePic) {
      profilePicture().then(p => {
        if (!p || !overlay.isConnected) return;
        pic = p;
        $('.pc-avatar-slot').innerHTML = avatarHtml(me, pic);
        renderPreview();
      });
    }
  }

  return { open };
})();
