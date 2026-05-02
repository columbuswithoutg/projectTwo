/************************************************
 * ADMIN — MODERATION TAB
 * Memories grid + pending friend-requests list.
 ************************************************/
(function () {
  const esc = AdminView._escapeHtml;

  const Moderation = {
    _state: { sub: 'memories', page: 1, total: 0, items: [] },

    mount(container) {
      container.innerHTML = `
        <div class="admin-mod">
          <div class="admin-subtabs">
            <button class="admin-subtab active" data-sub="memories">Memories</button>
            <button class="admin-subtab" data-sub="friends">Pending Friend Requests</button>
          </div>
          <div id="admin-mod-host"></div>
        </div>
      `;
      container.querySelectorAll('.admin-subtab').forEach(btn => {
        btn.addEventListener('click', () => {
          container.querySelectorAll('.admin-subtab').forEach(b => b.classList.toggle('active', b === btn));
          Moderation._state.sub = btn.dataset.sub;
          Moderation._state.page = 1;
          Moderation.fetch();
        });
      });
      Moderation.fetch();
    },

    async fetch() {
      const host = document.getElementById('admin-mod-host');
      host.innerHTML = 'Loading…';
      try {
        if (Moderation._state.sub === 'memories') {
          const data = await AdminView.api(`/memories?page=${Moderation._state.page}&limit=24`);
          Moderation._state.total = data.total;
          Moderation._state.items = data.items;
          Moderation.renderMemories();
        } else {
          const data = await AdminView.api(`/friends/pending?page=${Moderation._state.page}&limit=25`);
          Moderation._state.total = data.total;
          Moderation._state.items = data.items;
          Moderation.renderFriends();
        }
      } catch (e) {
        host.innerHTML = `<div class="admin-error">${esc(e.message)}</div>`;
      }
    },

    renderMemories() {
      const host = document.getElementById('admin-mod-host');
      const last = Math.max(1, Math.ceil(Moderation._state.total / 24));
      host.innerHTML = `
        <div class="admin-meta-row">${Moderation._state.total} memories total</div>
        <div class="admin-mem-grid">
          ${Moderation._state.items.length ? Moderation._state.items.map(m => `
            <figure class="admin-mem-cell" data-url="${esc(m.url)}" data-uid="${esc(m.userId)}" data-pid="${esc(m.projectId)}">
              ${m.type === 'video'
                ? `<video src="${esc(m.url)}" muted preload="metadata"></video>`
                : `<img src="${esc(m.url)}" alt="" loading="lazy" />`}
              <figcaption>
                <span class="admin-mem-user">${esc(m.username || m.userId)}</span>
                <span class="admin-mem-proj">${esc(m.projectId)}</span>
                <span class="admin-mem-date">${AdminView.formatDate(m.uploadedAt)}</span>
                ${m.caption ? `<span class="admin-mem-cap">${esc(m.caption)}</span>` : ''}
              </figcaption>
              <button class="admin-btn admin-btn-danger admin-mem-del">Delete</button>
            </figure>
          `).join('') : '<div class="admin-empty">No memories.</div>'}
        </div>
        <div class="admin-pager">
          <button class="admin-btn" id="admin-mod-prev">‹ Prev</button>
          <span>Page ${Moderation._state.page} / ${last}</span>
          <button class="admin-btn" id="admin-mod-next">Next ›</button>
        </div>
      `;

      host.querySelectorAll('.admin-mem-del').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const cell = e.target.closest('.admin-mem-cell');
          Moderation.deleteMemory(cell.dataset.uid, cell.dataset.pid, cell.dataset.url);
        });
      });
      document.getElementById('admin-mod-prev').addEventListener('click', () => {
        if (Moderation._state.page > 1) { Moderation._state.page--; Moderation.fetch(); }
      });
      document.getElementById('admin-mod-next').addEventListener('click', () => {
        if (Moderation._state.page < last) { Moderation._state.page++; Moderation.fetch(); }
      });
    },

    async deleteMemory(userId, projectId, url) {
      if (!window.confirm('Permanently delete this memory? It will also be removed from Cloudinary.')) return;
      try {
        await AdminView.api('/memories', {
          method: 'DELETE',
          body: JSON.stringify({ userId, projectId, url })
        });
        AdminView.toast('Memory deleted', 'success');
        Moderation.fetch();
      } catch (e) {
        AdminView.toast(e.message, 'error');
      }
    },

    renderFriends() {
      const host = document.getElementById('admin-mod-host');
      const last = Math.max(1, Math.ceil(Moderation._state.total / 25));
      host.innerHTML = `
        <div class="admin-meta-row">${Moderation._state.total} pending requests</div>
        <div class="admin-list">
          ${Moderation._state.items.length ? Moderation._state.items.map(f => `
            <div class="admin-row" data-id="${f._id}">
              <div class="admin-row-main">
                <span><b>${esc(f.requester?.username || '?')}</b> → <b>${esc(f.recipient?.username || '?')}</b></span>
                <span class="admin-row-meta">
                  ${esc(f.type)}${f.projectTitle ? ' · ' + esc(f.projectTitle) : ''} · sent ${AdminView.formatDate(f.createdAt)}
                </span>
              </div>
              <button class="admin-btn admin-btn-danger admin-friend-del" data-id="${f._id}">Delete</button>
            </div>
          `).join('') : '<div class="admin-empty">No pending requests.</div>'}
        </div>
        <div class="admin-pager">
          <button class="admin-btn" id="admin-mod-prev">‹ Prev</button>
          <span>Page ${Moderation._state.page} / ${last}</span>
          <button class="admin-btn" id="admin-mod-next">Next ›</button>
        </div>
      `;
      host.querySelectorAll('.admin-friend-del').forEach(btn => {
        btn.addEventListener('click', () => Moderation.deleteFriend(btn.dataset.id));
      });
      document.getElementById('admin-mod-prev').addEventListener('click', () => {
        if (Moderation._state.page > 1) { Moderation._state.page--; Moderation.fetch(); }
      });
      document.getElementById('admin-mod-next').addEventListener('click', () => {
        if (Moderation._state.page < last) { Moderation._state.page++; Moderation.fetch(); }
      });
    },

    async deleteFriend(id) {
      if (!window.confirm('Delete this friend/watch request?')) return;
      try {
        await AdminView.api('/friends/' + id, { method: 'DELETE' });
        AdminView.toast('Request deleted', 'success');
        Moderation.fetch();
      } catch (e) {
        AdminView.toast(e.message, 'error');
      }
    },

    unmount() {}
  };

  AdminView._tabs.moderation = Moderation;
})();
