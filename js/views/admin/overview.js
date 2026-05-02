/************************************************
 * ADMIN — OVERVIEW TAB
 * High-level counts + signups-over-time bar chart (inline SVG, no chart lib).
 ************************************************/
(function () {
  const esc = AdminView._escapeHtml;

  const Overview = {
    mount(container) {
      container.innerHTML = `
        <div class="admin-overview">
          <div id="admin-stats" class="admin-stats">Loading…</div>
          <h3 class="admin-h3">Signups (last 30 days)</h3>
          <div id="admin-signups" class="admin-signups">Loading…</div>
        </div>
      `;
      Overview.fetch();
    },

    async fetch() {
      const stats = document.getElementById('admin-stats');
      const signups = document.getElementById('admin-signups');
      try {
        const [overview, sig] = await Promise.all([
          AdminView.api('/analytics/overview'),
          AdminView.api('/users/stats/signups?days=30')
        ]);

        stats.innerHTML = `
          <div class="admin-stat-card"><span class="admin-stat-num">${overview.users}</span><span class="admin-stat-lab">Users</span></div>
          <div class="admin-stat-card"><span class="admin-stat-num">${overview.banned}</span><span class="admin-stat-lab">Banned</span></div>
          <div class="admin-stat-card"><span class="admin-stat-num">${overview.memories}</span><span class="admin-stat-lab">Memories</span></div>
        `;

        Overview.renderChart(sig.buckets);
      } catch (e) {
        stats.innerHTML = `<div class="admin-error">${esc(e.message)}</div>`;
        signups.innerHTML = '';
      }
    },

    renderChart(buckets) {
      const container = document.getElementById('admin-signups');
      if (!buckets || !buckets.length) {
        container.innerHTML = '<div class="admin-empty">No signups in this window.</div>';
        return;
      }
      const max = Math.max(1, ...buckets.map(b => b.count));
      const w = 600, h = 160, pad = 24;
      const barW = (w - pad * 2) / buckets.length;

      const bars = buckets.map((b, i) => {
        const bh = ((h - pad * 2) * b.count) / max;
        const x = pad + i * barW;
        const y = h - pad - bh;
        return `<g>
          <rect x="${x + 1}" y="${y}" width="${Math.max(1, barW - 2)}" height="${bh}" rx="2" fill="#4f8ef7">
            <title>${esc(b._id)}: ${b.count}</title>
          </rect>
        </g>`;
      }).join('');

      const xLabels = buckets.length <= 10
        ? buckets.map((b, i) => `<text x="${pad + i * barW + barW / 2}" y="${h - 6}" text-anchor="middle" font-size="9" fill="#888">${esc(b._id.slice(5))}</text>`).join('')
        : `<text x="${pad}" y="${h - 6}" font-size="9" fill="#888">${esc(buckets[0]._id)}</text>
           <text x="${w - pad}" y="${h - 6}" text-anchor="end" font-size="9" fill="#888">${esc(buckets[buckets.length - 1]._id)}</text>`;

      container.innerHTML = `
        <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" class="admin-signup-svg">
          <text x="${pad}" y="${pad - 6}" font-size="10" fill="#888">max ${max}/day</text>
          ${bars}
          ${xLabels}
        </svg>
      `;
    },

    unmount() {}
  };

  AdminView._tabs.overview = Overview;
})();
