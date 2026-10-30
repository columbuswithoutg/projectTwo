/************************************************
 * QUOTE GUESS — the /world HUD for the quote minigame
 *
 * The shared island-game HUD (js/island-game-hud.js: chip model, lobby,
 * panel, overlay frame, timer, results, watch mode) with Quote Guess's own
 * parts; talks to server/quote-guess.js over the world socket:
 *   - the round: a quote card ("Who said it?" — the line; "What's the
 *     reply?" — SPEAKER: the line) and four choices in a 2×2 grid. Tapping
 *     a choice locks it in; 1–4 / A–D on a keyboard. A speed bar drains from
 *     +1,000 to +500 (a right answer's points fall with time).
 *   - the reveal: the right choice in gold, a wrong pick in red, who picked
 *     what, the points and time, the scene note and "Suggested by @…"
 *   - suggesting a line (the panel, the chip on islands still filling up,
 *     the results): speaker, line, optional reply, the episode on a series
 *     and a rough time — an admin reviews every suggestion
 *   - the champion's featured line (results, the panel)
 * The island screen is painted by js/playground3d-quote.js (PG3DQuote).
 *
 * Only the current question and its options arrive before a reveal
 * (QuoteGuessLogic.publicState); the right answer is in `history` after.
 ************************************************/
const QuoteGuess = (() => {
  const Q = () => window.QuoteGuessLogic;
  const S = () => window.SceneGuessLogic;
  const H = IslandGameHud;
  const esc = H.esc, fmt = H.fmt;
  const KEYS = { 1: 'a', 2: 'b', 3: 'c', 4: 'd', a: 'a', b: 'b', c: 'c', d: 'd' };

  let _engine = null;
  let _sug = null;        // the open suggestion dialog { el, close, pid }

  // ── faces ──

  function charOf(id) {
    return id && typeof characters !== 'undefined' && Array.isArray(characters) ? characters.find(c => c && c.id === id) || null : null;
  }
  function face(name, characterId, size) {
    const c = charOf(characterId);
    const px = size || 32;
    if (c && c.image && typeof assetUrl === 'function') {
      return `<img class="qg-face" style="--s:${px}px" src="${esc(assetUrl('assets/characters/' + c.image))}" alt="" loading="lazy">`;
    }
    const ini = String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
    return `<span class="qg-face qg-face-ini" style="--s:${px}px" aria-hidden="true">${esc(ini)}</span>`;
  }

  function projectOf(pid) {
    const list = (typeof projects !== 'undefined' && Array.isArray(projects)) ? projects : [];
    return list.find(p => p && p.id === pid) || null;
  }
  function epLabel(ep) { return Number.isInteger(ep) ? 'E' + (ep + 1) : ''; }
  // Longer lines get a smaller size class (the card is the same box).
  function lenClass(text) {
    const n = String(text || '').length;
    return n <= 40 ? 'qg-len-s' : n <= 90 ? 'qg-len-m' : n <= 160 ? 'qg-len-l' : 'qg-len-xl';
  }

  // ── suggestions ──

  function canSuggest(pid, h) {
    const c = h.cfg();
    return !!(pid && c.enabled && c.suggest && !(c.noSuggest || []).includes(pid));
  }

  // ── the round ──

  const STAGE = `
    <div class="qg-stage">
      <div class="qg-ready" hidden></div>
      <div class="qg-card" hidden>
        <div class="qg-card-top"><span class="qg-type"></span><span class="qg-ep" hidden></span></div>
        <div class="qg-speaker" hidden></div>
        <blockquote class="qg-quote"></blockquote>
      </div>
      <div class="qg-speed" hidden aria-hidden="true"><i></i><span></span></div>
      <div class="qg-options" role="group" aria-label="Choices"></div>
      <div class="qg-reveal" aria-live="polite" hidden></div>
    </div>`;

  function refsOf(ov) {
    if (!ov.local.refs) {
      const root = ov.refs.stage;
      ov.local.refs = {
        ready: root.querySelector('.qg-ready'), card: root.querySelector('.qg-card'),
        type: root.querySelector('.qg-type'), ep: root.querySelector('.qg-ep'),
        speaker: root.querySelector('.qg-speaker'), quote: root.querySelector('.qg-quote'),
        speed: root.querySelector('.qg-speed'), speedBar: root.querySelector('.qg-speed i'), speedText: root.querySelector('.qg-speed span'),
        options: root.querySelector('.qg-options'), reveal: root.querySelector('.qg-reveal')
      };
    }
    return ov.local.refs;
  }

  // One optional part of a choice button (the ✓ / ★ / ✗ mark, the dots for
  // who picked it): added, changed or removed in place.
  function patchPart(btn, cls, content, isText) {
    let el = btn.querySelector('.' + cls);
    if (!content) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('span');
      el.className = cls;
      if (isText) el.setAttribute('aria-hidden', 'true');
      const who = cls === 'qg-mark' ? btn.querySelector('.qg-who') : null;
      if (who) btn.insertBefore(el, who); else btn.appendChild(el);
    }
    if (isText) { if (el.textContent !== content) el.textContent = content; }
    else if (el._qgHtml !== content) { el._qgHtml = content; el.innerHTML = content; }
  }

  // My answer for this round: { round, choice, sending, locked }.
  function mine(ov, st) {
    if (!ov.local.mine || ov.local.mine.round !== st.round) ov.local.mine = { round: st.round, choice: null, sending: false, locked: false };
    return ov.local.mine;
  }
  function canAnswer(ov, st, h) {
    if (!ov || ov.mode !== 'play' || ov.final || !st || st.phase !== 'round' || !h.amIn(st)) return false;
    const m = mine(ov, st);
    return !m.choice && !m.locked;
  }

  function initStage(ov, h) {
    const r = refsOf(ov);
    r.options.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-choice]');
      if (btn) answer(btn.dataset.choice, h);
    });
  }

  async function answer(choice, h) {
    const ov = h.overlay();
    const st = ov && (ov.final || h.state(ov.projectId));
    if (!canAnswer(ov, st, h)) return;
    const m = mine(ov, st);
    m.choice = choice;
    m.sending = true;
    h.renderOverlay();
    const r = await h.emit('world:qg-answer', { round: m.round, choice });
    m.sending = false;
    if (r.error === 'stopped') return;
    if (r.ok) m.locked = true;
    else if (['too-late', 'already', 'not-round', 'wrong-round'].includes(r.error)) { m.locked = true; h.warnErr(r.error); }
    else { m.choice = null; h.warnErr(r.error); }
    h.renderOverlay();
  }

  function renderStage(ov, st, h) {
    const r = refsOf(ov);
    const me = h.me();
    const ready = st.phase === 'ready';
    const cur = (st.phase === 'round' || st.phase === 'reveal') ? st.current : null;
    r.ready.hidden = !ready;
    if (ready) {
      const n = st.players.length;
      r.ready.innerHTML = `<b>Get ready</b><span>${n} player${n === 1 ? '' : 's'} · 10 lines · who said it, and what's the reply?</span>`;
    }
    r.card.hidden = !cur;
    r.options.hidden = !cur;
    r.speed.hidden = !(cur && st.phase === 'round');
    if (!cur) { r.reveal.hidden = true; r.options.innerHTML = ''; delete r.options.dataset.key; return; }

    const reply = cur.type === 'reply';
    const hist = st.phase === 'reveal' ? (st.history || [])[st.round] : null;
    const m = ov.mode === 'play' ? mine(ov, st) : null;

    // The card: the same until the next round.
    const cardKey = JSON.stringify([st.round, cur.type, cur.prompt.text]);
    if (r.card.dataset.key !== cardKey) {
      r.card.dataset.key = cardKey;
      r.card.className = 'qg-card ' + (reply ? 'is-reply' : 'is-who');
      r.type.textContent = reply ? "What's the reply?" : 'Who said it?';
      r.ep.hidden = !Number.isInteger(cur.prompt.episode);
      r.ep.textContent = epLabel(cur.prompt.episode);
      r.speaker.hidden = !reply;
      r.speaker.innerHTML = reply && cur.prompt.speaker ? `${face(cur.prompt.speaker.name, cur.prompt.speaker.characterId, 30)}<span>${esc(cur.prompt.speaker.name)}</span>` : '';
      r.quote.className = 'qg-quote ' + lenClass(cur.prompt.text);
      r.quote.textContent = cur.prompt.text;
    }

    // The four choices: built once per round, then patched in place
    // (NET2-02) — a rebuild on every broadcast dropped focus (the keys went
    // dead) and ate a click whose press spanned it.
    const can = canAnswer(ov, st, h);
    const picksBy = {};
    if (hist) for (const p of hist.picks || []) if (p.choice) (picksBy[p.choice] = picksBy[p.choice] || []).push(p.username);
    r.options.className = 'qg-options ' + (reply ? 'is-reply' : 'is-who') + (can ? ' is-open' : '');
    const optKey = JSON.stringify([cardKey, cur.options.map(o => [o.id, o.label, o.characterId || null])]);
    if (r.options.dataset.key !== optKey) {
      const act = document.activeElement;
      const hadFocus = !act || act === document.body || r.options.contains(act);
      r.options.dataset.key = optKey;
      r.options.innerHTML = cur.options.map((o, i) => `
        <button type="button" class="qg-opt" data-choice="${esc(o.id)}" ${i === 0 ? 'data-focus' : ''}
            aria-pressed="false" aria-label="${esc((i + 1) + '. ' + o.label)}">
          <kbd>${'ABCD'[i]}</kbd>
          ${reply ? '' : face(o.label, o.characterId, 36)}
          <span class="qg-opt-label">${esc(o.label)}</span>
        </button>`).join('');
      // A new round: focus that was on the old choices (or lost to <body>
      // when a click disabled them) moves to the new ones.
      const first = hadFocus && r.options.querySelector('[data-focus]');
      if (first) first.focus({ preventScroll: true });
    }
    for (const btn of r.options.querySelectorAll('button[data-choice]')) {
      const id = btn.dataset.choice;
      const chosen = !!(m && m.choice === id);
      const right = !!(hist && hist.answer === id);
      const wrong = !!(hist && chosen && !right);
      const cls = ['qg-opt', chosen ? 'is-chosen' : '', right ? 'is-right' : '', wrong ? 'is-wrong' : '', hist && !right && !chosen ? 'is-dim' : ''].join(' ');
      if (btn.className !== cls) btn.className = cls;
      if (btn.disabled !== !can) btn.disabled = !can;
      btn.setAttribute('aria-pressed', chosen ? 'true' : 'false');
      patchPart(btn, 'qg-mark', right ? '★' : wrong ? '✗' : chosen ? '✓' : '', true);
      patchPart(btn, 'qg-who', (picksBy[id] || []).map(u => `<i class="sg-chip-dot ${h.colorOf(st, u)}" title="${esc(u)}">${esc(H.initials(u))}</i>`).join(''), false);
    }

    // Under the choices: waiting / the reveal.
    r.reveal.hidden = !(hist || (m && m.choice));
    if (hist) {
      const mineH = (hist.picks || []).find(p => p.username === me);
      const rv = hist.reveal || {};
      const best = [...(hist.picks || [])].filter(p => p.points > 0).sort((a, b) => b.points - a.points)[0];
      let line;
      if (mineH && ov.mode === 'play') {
        line = mineH.choice == null ? '<span class="qg-res is-miss">No answer · +0</span>'
          : mineH.points > 0 ? `<span class="qg-res is-good">Right! <b>+${fmt(mineH.points)}</b> · ${(mineH.ms / 1000).toFixed(1)} s</span>`
            : '<span class="qg-res is-miss">Not this time · +0</span>';
      } else {
        line = best ? `<span class="qg-res">${esc(best.username)} was fastest · +${fmt(best.points)}</span>` : '<span class="qg-res is-miss">Nobody got it</span>';
      }
      r.reveal.innerHTML = `
        <div class="qg-said">${face(rv.speaker, rv.characterId, 28)}<span>${reply ? 'Replied by' : 'Said by'} <b>${esc(rv.speaker || '')}</b>${rv.note ? ` · ${esc(rv.note)}` : ''}${Number.isInteger(rv.episode) ? ` · ${epLabel(rv.episode)}` : ''}</span></div>
        ${line}
        ${rv.credit ? `<div class="qg-credit">💬 Line suggested by @${esc(rv.credit)}</div>` : ''}`;
    } else if (m && m.choice) {
      const waiting = st.players.filter(p => !p.locked && !(st.away || []).includes(p.username)).length;
      r.reveal.innerHTML = `<span class="qg-res">${m.sending ? 'Locking in…' : `Locked in ✓${waiting ? ` · waiting for ${waiting} more` : ''}`}</span>`;
    }
    tickStage(ov, st, h);
  }

  // 4 Hz: the speed bar (what a right answer is worth right now).
  function tickStage(ov, st, h) {
    const r = refsOf(ov);
    if (st.phase !== 'round' || !st.current) return;
    const C = Q().C;
    const left = Math.max(0, st.deadline - h.now());
    const frac = st.roundMs > 0 ? Math.min(1, left / st.roundMs) : 0;
    const m = ov.mode === 'play' ? mine(ov, st) : null;
    const worth = Math.round(C.MIN_POINTS + (C.MAX_POINTS - C.MIN_POINTS) * frac);
    r.speedBar.style.transform = `scaleX(${frac.toFixed(3)})`;
    r.speed.classList.toggle('is-low', left <= 5000);
    const text = m && m.choice ? 'Locked in'
      : left <= 0 ? "Time's up"
        : ov.mode === 'play' ? `A right answer now: +${fmt(worth)}` : `${Math.ceil(left / 1000)} s left`;
    if (r.speedText.textContent !== text) r.speedText.textContent = text;
  }

  function onKey(e, ov, st, h) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const choice = KEYS[String(e.key).toLowerCase()];
    if (!choice || !st.current) return;
    if (!st.current.options.some(o => o.id === choice)) return;
    e.preventDefault();
    answer(choice, h);
  }

  // ── panel extras: suggesting, the featured line ──

  function howHtml(pid, h) {
    const t = esc(h.title(pid));
    if (h.liveIsland(pid)) {
      return `10 lines from ${t}. Each round: <b>who said it</b> — or <b>what was said back</b>? Pick one of four;
        a right answer is worth up to 1,000, and more the faster you lock in. Everyone on the island can join in the first ${Math.round(Q().C.LOBBY_MS / 1000)} seconds.`;
    }
    const pr = (h.cfg().progress || {})[pid];
    const need = h.cfg().need || { lines: Q().C.MIN_POOL, speakers: Q().C.MIN_SPEAKERS };
    if (pr) {
      return `Quote Guess opens on ${t} once it has ${need.lines} lines from ${need.speakers} different people —
        <b>${Math.min(pr.lines, need.lines)}/${need.lines} lines · ${Math.min(pr.speakers, need.speakers)}/${need.speakers} speakers</b> so far. Know a great line? Suggest it below.`;
    }
    return `Quote Guess isn't on ${t} yet. Know a great line from it? Suggest it — an admin checks every one, and you get the credit when it comes up in a game.`;
  }

  function panelExtras(pid, ctx, h) {
    let out = '';
    if (canSuggest(pid, h)) out += '<button type="button" class="sg-btn" data-act="suggest">💬 Suggest a line</button>';
    if (ctx.champion && ctx.idle) out += '<button type="button" class="sg-btn" data-act="featured">Change featured line</button>';
    return out;
  }

  function onPanelAction(act, pid, box, h) {
    if (act === 'suggest') { h.closePanel(); return openSuggest(pid, h); }
    if (act === 'featured') return showFeatured(box, pid, h);
  }

  async function showFeatured(box, pid, h) {
    box.hidden = false;
    box.innerHTML = '<div class="sg-muted">Loading your record game…</div>';
    try {
      const res = await fetch(h.api(`/${encodeURIComponent(pid)}/picks`), { headers: h.authHeaders() });
      const data = await res.json();
      if (!res.ok) { box.innerHTML = `<div class="sg-muted">${esc(data.error || 'Not available.')}</div>`; return; }
      renderPickList(box, pid, (data.lines || []).map(l => l), data.pick, h);
    } catch (_) { box.innerHTML = '<div class="sg-muted">Could not load your lines.</div>'; }
  }

  // The champion's featured line: one of their record game's lines shows on
  // the island screen between games.
  function renderPickList(box, pid, lines, current, h) {
    box.innerHTML = `
      <div class="sg-pick-head">Pick the line your island screen shows between games</div>
      <div class="qg-pick-list">${lines.map((l, i) => l ? `
        <button type="button" class="qg-pick ${i === current ? 'is-on' : ''}" data-i="${i}" aria-pressed="${i === current}">
          <q>${esc(l.text)}</q><span>— ${esc(l.speaker)}</span>
        </button>` : '').join('')}
      </div>`;
    box.querySelectorAll('.qg-pick').forEach(b => b.addEventListener('click', async () => {
      const r = await h.send.pick(h.emit, pid, +b.dataset.i);
      if (!r.ok) return h.warnErr(r.error);
      box.querySelectorAll('.qg-pick').forEach(x => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      h.say('Your island screen will feature this line between games.', 'success');
    }));
  }

  // From the results: the record game's lines with who said them (revealed).
  function renderPicks(box, pid, st, h) {
    const lines = (st.history || []).map(hh => ({
      text: hh.prompt.text,
      speaker: hh.type === 'reply' ? (hh.prompt.speaker ? hh.prompt.speaker.name : '') : (hh.reveal ? hh.reveal.speaker : '')
    }));
    renderPickList(box, pid, lines, -1, h);
  }

  // ── the suggestion dialog ──

  function closeSuggest() {
    if (!_sug) return;
    const { el, close } = _sug;
    _sug = null;
    try { if (close) close(); } catch (_) {}
    el.remove();
    if (_engine && _engine.setInputSuspended) _engine.setInputSuspended(false, 'quote-suggest');
  }

  function openSuggest(pid, h) {
    closeSuggest();
    const p = projectOf(pid);
    if (!p) return;
    const series = Array.isArray(p.episodes) && p.episodes.length > 0;
    const C = Q().C;
    const names = [...new Set((typeof characters !== 'undefined' && Array.isArray(characters) ? characters : []).map(c => c.name))].sort();
    const el = document.createElement('div');
    el.className = 'world-lb qg-suggest';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Suggest a line');
    el.innerHTML = `
      <div class="world-lb-panel qg-suggest-box">
        <button class="popup-close" type="button" aria-label="Close">✕</button>
        <h3>💬 Suggest a line</h3>
        <p class="world-lb-sub">${esc(p.title)}</p>
        <form class="qg-sform" novalidate>
          <datalist id="qg-names">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
          <label class="qg-sf"><span>Who says it</span>
            <input name="speaker" list="qg-names" maxlength="${C.MAX_SPEAKER}" autocomplete="off" placeholder="e.g. Tony Stark" required>
            <em data-err="speaker"></em></label>
          <label class="qg-sf"><span>The line <i data-count="text"></i></span>
            <textarea name="text" rows="2" maxlength="${C.MAX_TEXT}" placeholder="As close to word-for-word as you can" required></textarea>
            <em data-err="text"></em></label>
          <div class="qg-sf-row">
            ${series ? `<label class="qg-sf"><span>Episode</span>
              <select name="episode" required><option value="">—</option>${p.episodes.map((_, i) => `<option value="${i + 1}">E${i + 1}</option>`).join('')}</select>
              <em data-err="episode"></em></label>` : ''}
            <label class="qg-sf qg-sf-time"><span>Roughly when?</span>
              <input name="time" inputmode="numeric" placeholder="${series ? '12:34' : '1:02:13'}" required>
              <em data-err="time"></em></label>
          </div>
          <p class="qg-hint">Roughly is fine — it lets the admin find the scene and check the line.</p>
          <details class="qg-sf-more">
            <summary>Add the reply (optional)</summary>
            <label class="qg-sf"><span>Who replies</span>
              <input name="replySpeaker" list="qg-names" maxlength="${C.MAX_SPEAKER}" autocomplete="off">
              <em data-err="replySpeaker"></em></label>
            <label class="qg-sf"><span>The reply <i data-count="replyText"></i></span>
              <textarea name="replyText" rows="2" maxlength="${C.MAX_REPLY}"></textarea>
              <em data-err="replyText"></em></label>
          </details>
          <label class="qg-sf"><span>Where in the scene (optional)</span>
            <input name="note" maxlength="${C.MAX_NOTE}" placeholder="e.g. to Loki · Stark Tower">
            <em data-err="note"></em></label>
          <p class="qg-hint">An admin checks every line before it goes into the game. If it's approved, you get the credit whenever it comes up.</p>
          <div class="qg-sactions">
            <span class="qg-smsg" role="status"></span>
            <button type="button" class="sg-btn" data-act="cancel">Cancel</button>
            <button type="submit" class="sg-btn sg-btn-primary">Send suggestion</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(el);
    const close = (typeof wireModalDismiss === 'function')
      ? wireModalDismiss(el, () => closeSuggest(), { initialFocus: el.querySelector('input[name="speaker"]') })
      : () => closeSuggest();
    _sug = { el, close, pid };
    if (_engine && _engine.setInputSuspended) _engine.setInputSuspended(true, 'quote-suggest');
    el.querySelector('.popup-close').addEventListener('click', close);
    el.querySelector('[data-act="cancel"]').addEventListener('click', close);
    const form = el.querySelector('form');
    const f = (n) => form.elements.namedItem(n);
    const counts = () => {
      for (const [k, max] of [['text', C.MAX_TEXT], ['replyText', C.MAX_REPLY]]) {
        const n = (f(k).value || '').length;
        el.querySelector(`[data-count="${k}"]`).textContent = n ? `${n}/${max}` : '';
      }
    };
    form.addEventListener('input', counts);
    const showErrors = (errs) => {
      el.querySelectorAll('[data-err]').forEach(s => { s.textContent = (errs && errs[s.dataset.err]) || ''; });
      form.querySelectorAll('input, textarea, select').forEach(i => i.classList.toggle('is-bad', !!(errs && errs[i.name])));
      if (errs && (errs.replySpeaker || errs.replyText)) el.querySelector('.qg-sf-more').open = true;
      const first = errs && form.querySelector('.is-bad');
      if (first) first.focus();
    };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const row = {};
      for (const k of ['speaker', 'text', 'replySpeaker', 'replyText', 'time', 'note']) row[k] = f(k) ? f(k).value : '';
      row.episode = f('episode') ? f('episode').value : '';
      const v = Q().validateLine(row, { project: p, mode: 'suggest' });
      if (!v.ok) return showErrors(v.errors);
      showErrors(null);
      const btn = form.querySelector('button[type="submit"]');
      const msg = el.querySelector('.qg-smsg');
      btn.disabled = true;
      msg.textContent = 'Sending…';
      try {
        const res = await fetch(h.api(`/${encodeURIComponent(pid)}/suggest`), {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, h.authHeaders()),
          body: JSON.stringify(row)
        });
        const data = await res.json().catch(() => ({}));
        if (!_sug || _sug.el !== el) return;
        if (res.ok) {
          el.querySelector('.qg-suggest-box').innerHTML = `
            <h3>💬 Thanks!</h3>
            <p class="qg-thanks">Your line from <b>${esc(p.title)}</b> is waiting for review. Once an admin approves it, it joins the game with your name on it.</p>
            <div class="qg-sactions">
              <button type="button" class="sg-btn" data-act="again">Suggest another</button>
              <button type="button" class="sg-btn sg-btn-primary" data-act="done">Done</button>
            </div>`;
          el.querySelector('[data-act="again"]').addEventListener('click', () => openSuggest(pid, h));
          el.querySelector('[data-act="done"]').addEventListener('click', close);
          el.querySelector('[data-act="done"]').focus();
          return;
        }
        msg.textContent = data.error || 'Could not send it — try again.';
        if (data.fields) showErrors(data.fields);
      } catch (_) {
        msg.textContent = 'Not connected — try again in a moment.';
      } finally {
        if (btn.isConnected) btn.disabled = false;
      }
    });
  }

  // ── the HUD ──

  const hud = H.create({
    kind: 'quote',
    name: 'Quote Guess',
    icon: '💬',
    blurb: 'Who said it?',
    chipTitle: "Quote Guess — who said it, and what's the reply?",
    crownWord: 'laurels',
    crownEmoji: '🌿',
    recordEmoji: '🏆',
    api: 'quote',
    cssClass: 'is-quote',
    Logic: () => window.QuoteGuessLogic,
    errors: {
      'not-live': "Quote Guess isn't available on this island.",
      'off': 'Quote Guess is switched off.',
      'too-late': "Time's up — that answer didn't count.",
      'not-round': "Time's up — that answer didn't count.",
      'wrong-round': "Time's up — that answer didn't count.",
      'already': 'Already locked in.',
      'bad-guess': "That isn't one of the choices — try again.",
      'bad': "That didn't work — reopen Quote Guess and try again."
    },
    idleNotes: { 'no-lines': "This island doesn't have enough lines yet." },
    listen(on, h) {
      on('world:qg-state', h.state);
      on('world:qg-live', h.live);
      on('world:qg-islands', h.islands);
      on('world:qg-records', h.records);
      on('world:qg-fanfare', h.fanfare);
      on('world:qg-arrived', h.arrived);
    },
    send: {
      start: (emit, pid) => emit('world:qg-start', { projectId: pid }),
      join: (emit, pid) => emit('world:qg-join', { projectId: pid }),
      leave: (emit) => emit('world:qg-leave', {}),
      go: (emit) => emit('world:qg-go', {}),
      pick: (emit, pid, index) => emit('world:qg-pick', { projectId: pid, index })
    },
    parseConfig: (d) => ({
      suggest: !!d.suggest,
      noSuggest: Array.isArray(d.noSuggest) ? d.noSuggest : [],
      progress: d.progress || {},
      need: d.need || null
    }),
    onIslands(p, h) { if ('suggest' in p) h.cfg().suggest = !!p.suggest; },
    register(engine) {
      if (!engine.registerScreenKind || typeof PG3DQuote === 'undefined') return;
      engine.registerScreenKind('quote', {
        painter: { draw: PG3DQuote.drawScreen, keyOf: PG3DQuote.keyOf },
        // Head-relative (PG3DScene.crownLayout): alone the wreath (inner radius
        // ≈ 0.18) rests on the head; with the crown it rings the crown's band.
        crown: { make: PG3DQuote.makeLaurel, y: 0, ring: 0.18, yStacked: -0.03, ringStacked: 0.16 }
      });
    },
    screenView(base, pid, h) {
      const rec = h.cfg().records[pid];
      return Object.assign(base, { pick: rec && rec.pick ? rec.pick : null });
    },
    // The panel (and the chip) also open on islands that are still filling
    // up, for suggestions.
    panelAllowed: (pid, h) => canSuggest(pid, h),
    extraChip(pid, h) {
      if (!canSuggest(pid, h)) return null;
      return { text: '💬 Suggest a quote', title: 'Suggest a line from this film or show for Quote Guess' };
    },
    howHtml,
    panelExtras,
    onPanelAction,
    stageHtml: STAGE,
    initStage,
    renderStage,
    tickStage,
    onKey,
    pointsOf: (hh, username) => { const p = (hh.picks || []).find(x => x.username === username); return p ? p.points : 0; },
    renderPicks,
    resultsActions: (st, h) => canSuggest(st.projectId, h) ? '<button type="button" class="sg-btn" data-act="suggest">💬 Suggest a line</button>' : '',
    onResultsAction(act, st, h) {
      if (act === 'suggest') { h.closeOverlay(); openSuggest(st.projectId, h); }
    },
    onStop() { closeSuggest(); }
  });

  return Object.assign({}, hud, {
    start(opts) { _engine = (opts && opts.engine) || null; hud.start(opts); },
    stop() { hud.stop(); _engine = null; }
  });
})();
