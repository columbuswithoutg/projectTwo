/************************************************
 * QUOTE GUESS LOGIC — pure, dependency-free helpers
 *
 * The rules of the /world "Quote Guess" minigame: every round shows a line
 * from the island's project and four choices — either "Who said it?" (pick
 * the speaker) or "What's the reply?" (pick the line said back). A right
 * answer scores more the faster it's locked in. Shared by:
 *
 *   server/quote-guess.js            — the authoritative game (reducers run here)
 *   server/quote-guess-data.js       — draws a game's rounds from the bank
 *   routes/admin-quotes.js           — validates lines, imports, exports
 *   routes/world-quotes.js           — validates player suggestions
 *   js/views/admin/cms-quotes*.js    — the admin editor and importer
 *
 * Lines live in Mongo (models/QuoteLine.js); nothing here holds content.
 * Times reuse Scene Guess's parsing and movie/series line
 * (SceneGuessLogic.parseTime / timeline), so a suggestion's "1:02:13" or
 * "E3 · 12:34" is checked against the same runtime as a still's.
 *
 * Every function is pure and takes `now` explicitly. Game records are never
 * mutated — reducers return copies (test/quote-guess.test.js checks).
 *
 * UMD-ish: window.QuoteGuessLogic in the browser (after scene-guess-logic.js
 * in the core chunk), module.exports under Node.
 ************************************************/
(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const SG = isNode ? require('./scene-guess-logic.js') : root.SceneGuessLogic;
  const api = factory(SG);
  if (isNode) module.exports = api;
  if (root) root.QuoteGuessLogic = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function (SG) {

  const C = {
    ROUNDS: 10,                 // rounds per game
    MIN_POOL: 10,               // an island is playable with this many approved, active lines…
    MIN_SPEAKERS: 4,            // …spoken by at least this many people (3 wrong names + the right one)
    OPTIONS: 4,
    MAX_PLAYERS: 6,
    MAX_POINTS: 1000,           // a right answer locked in at once
    MIN_POINTS: 500,            // …or at the buzzer
    LOBBY_MS: 15000,
    READY_MS: 3000,
    ROUND_MS: 20000,            // default round length; admin config world.quoteRoundSec overrides
    ROUND_SEC_MIN: 10,
    ROUND_SEC_MAX: 30,
    REVEAL_MS: 4500,
    RESULTS_MS: 10000,
    LATE_GRACE_MS: 500,         // an answer this far past the buzzer still counts (latency)
    RECONNECT_GRACE_MS: 20000,
    ZONE_GRACE_MS: 5000,
    ARRIVE_COOLDOWN_MS: 10 * 60 * 1000,
    REPLY_MIN: 2,               // "What's the reply?" rounds per game, when the bank has enough replies
    REPLY_MAX: 5,
    LENGTH_POOL: 8,             // wrong replies come from the lines closest in length to the real one
    MAX_SPEAKER: 60,
    MAX_TEXT: 240,
    MAX_REPLY: 160,
    MAX_NOTE: 80,
    MAX_SOURCE: 300,
    MAX_DECOYS: 6,
    MAX_REASON: 200,
    IMPORT_MAX_ROWS: 5000,      // one import (the admin page splits the commit into chunks)
    COMMIT_ROWS: 400,           // rows per commit request — the JSON body limit is 64 KB
    COMMIT_BYTES: 55000,
    TIME_SLACK_S: SG.C.TIME_SLACK_S
  };

  const PHASES = ['lobby', 'ready', 'round', 'reveal', 'results', 'over'];
  const OPTION_IDS = ['a', 'b', 'c', 'd'];
  const ORIGINS = ['seed', 'admin', 'suggestion'];
  const STATUSES = ['pending', 'approved', 'rejected'];
  const CSV_COLUMNS = ['projectId', 'speaker', 'text', 'replySpeaker', 'replyText', 'note', 'episode', 'time', 'source', 'decoySpeakers', 'decoyReplies'];

  // Civilian / alternate names that should still find a character's
  // portrait (characters are named by hero name: "Iron Man", not "Tony
  // Stark"). Linking is best-effort; the admin can pick a character by hand.
  const ALIASES = {
    ironman: ['Tony Stark', 'Tony'], cap: ['Steve Rogers', 'Steve'], blackwidow: ['Natasha Romanoff', 'Natasha'],
    hulk: ['Bruce Banner', 'Banner'], hawkeye: ['Clint Barton', 'Clint'], nick_fury: ['Fury'], coulson: ['Phil Coulson'],
    rhodey: ['Rhodey', 'War Machine', 'James Rhodes'], obadiah: ['Obadiah Stane'], falcon: ['Falcon'],
    starlord: ['Peter Quill'], wanda_wv: ['Wanda', 'Scarlet Witch'], antman: ['Scott Lang'], spiderman: ['Peter Parker'],
    blackpanther: ["T'Challa"], zemo: ['Helmut Zemo', 'Zemo'], drstrange: ['Stephen Strange'], captainmarvel: ['Carol Danvers'],
    mysterio: ['Quentin Beck'], vulture: ['Adrian Toomes'], killmonger: ['Erik Killmonger', "N'Jadaka"], wenwu: ['Wenwu'],
    moonknight_mk: ['Marc Spector', 'Steven Grant'], msmarvel: ['Kamala Khan'], shehulk: ['Jennifer Walters', 'Jen Walters'],
    ironheart: ['Riri Williams'], kang: ['Kang'], mrcfantastic: ['Reed Richards'], invisiblewoman: ['Sue Storm'],
    humantorch: ['Johnny Storm'], thething: ['Ben Grimm'], daredevil: ['Matt Murdock'], punisher: ['Frank Castle'],
    ironfist: ['Danny Rand'], fisk: ['Kingpin', 'Fisk'], wolverine: ['Logan'], profx: ['Charles Xavier', 'Charles'],
    magneto: ['Erik Lehnsherr', 'Erik'], cyclops: ['Scott Summers'], storm: ['Ororo Munroe'], mystique: ['Raven'],
    beast: ['Hank McCoy'], laura: ['Laura'], deadpool: ['Wade Wilson'], echo: ['Maya Lopez'],
    grandmaster: ['The Grandmaster'], yondu: ['Yondu Udonta'], redguardian: ['Alexei Shostakov', 'Alexei'],
    shangchi: ['Shaun'], jeangrey: ['Jean'], quicksilver: ['Pietro Maximoff', 'Pietro'], wasp_hope: ['Hope van Dyne', 'Hope']
  };

  // ── text ──────────────────────────────────────────────────────────────

  // Trim, collapse runs of whitespace, drop control characters. Typographic
  // quotes and apostrophes are kept for display (norm() folds them).
  function cleanText(s) {
    if (s == null) return '';
    return String(s).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
  }

  // Comparison key: lower case, accents and punctuation gone, so
  // "I am Iron Man." and "i am iron man" are the same line.
  function norm(s) {
    return cleanText(s).toLowerCase()
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[‘’ʼ`]/g, "'")
      .replace(/[^a-z0-9' ]+/g, ' ')
      .replace(/'/g, '')
      .replace(/\s+/g, ' ').trim();
  }
  const normName = norm;

  function hasUrl(s) { return /(https?:\/\/|www\.)/i.test(String(s || '')); }
  // A line's `source` is only ever an http(s) link (it renders as an <a>).
  function isWebLink(s) { return /^https?:\/\//i.test(String(s || '')); }

  // "E3" for episode index 2.
  function episodeLabel(ep) { return Number.isInteger(ep) ? 'E' + (ep + 1) : ''; }

  // ── characters (portraits) ────────────────────────────────────────────

  // name key → character id, from the character list plus ALIASES.
  // "Obadiah Stane / Iron Monger" and "Ouroboros (OB)" give every part.
  function characterIndex(characters) {
    const out = new Map();
    const add = (name, id) => { const k = norm(name); if (k && !out.has(k)) out.set(k, id); };
    for (const c of Array.isArray(characters) ? characters : []) {
      if (!c || !c.id || !c.name) continue;
      add(c.name, c.id);
      String(c.name).split('/').forEach(part => add(part.replace(/\(.*?\)/g, ''), c.id));
      const paren = /\(([^)]+)\)/.exec(c.name);
      if (paren) add(paren[1], c.id);
    }
    const known = new Set((Array.isArray(characters) ? characters : []).map(c => c && c.id));
    for (const id of Object.keys(ALIASES)) {
      if (!known.has(id)) continue;
      ALIASES[id].forEach(n => add(n, id));
    }
    return out;
  }

  function linkCharacter(name, index) {
    if (!index) return null;
    return index.get(norm(name)) || null;
  }

  // ── one line ──────────────────────────────────────────────────────────

  // A row from a form, a CSV or a seed file → { ok, line, errors }.
  //   raw: { speaker, text, reply: { speaker, text } | replySpeaker/replyText,
  //          note, episode (1-based), time ("1:02:13" | seconds) | timeSec,
  //          source, decoys: { speakers, replies } | decoySpeakers/decoyReplies ("a|b") }
  //   opts: { project, mode: 'admin' | 'import' | 'suggest', characters (index from characterIndex) }
  // `line` is the stored shape (episode 0-based, keys filled in). Suggest
  // mode needs a time (so the admin can check it) and refuses links.
  function validateLine(raw, opts) {
    const o = opts || {};
    const mode = o.mode || 'admin';
    const project = o.project || null;
    const r = raw && typeof raw === 'object' ? raw : {};
    const errors = {};

    const speaker = cleanText(r.speaker);
    const text = cleanText(r.text);
    const rep = r.reply && typeof r.reply === 'object' ? r.reply : { speaker: r.replySpeaker, text: r.replyText, characterId: r.replyCharacterId };
    const replySpeaker = cleanText(rep && rep.speaker);
    const replyText = cleanText(rep && rep.text);
    const note = cleanText(r.note);
    const source = mode === 'suggest' ? '' : cleanText(r.source);

    if (!speaker) errors.speaker = 'Who says it?';
    else if (speaker.length > C.MAX_SPEAKER) errors.speaker = `Keep the name under ${C.MAX_SPEAKER} characters.`;
    if (!text) errors.text = 'Type the line.';
    else if (text.length > C.MAX_TEXT) errors.text = `Keep the line under ${C.MAX_TEXT} characters.`;
    if (replySpeaker || replyText) {
      if (!replySpeaker) errors.replySpeaker = 'Who replies?';
      else if (replySpeaker.length > C.MAX_SPEAKER) errors.replySpeaker = `Keep the name under ${C.MAX_SPEAKER} characters.`;
      if (!replyText) errors.replyText = 'Type the reply.';
      else if (replyText.length > C.MAX_REPLY) errors.replyText = `Keep the reply under ${C.MAX_REPLY} characters.`;
      else if (text && norm(replyText) === norm(text)) errors.replyText = "The reply can't be the same as the line.";
    }
    if (note.length > C.MAX_NOTE) errors.note = `Keep the note under ${C.MAX_NOTE} characters.`;
    if (source.length > C.MAX_SOURCE) errors.source = 'That link is too long.';
    else if (source && !isWebLink(source)) errors.source = 'Use a web link (http:// or https://).';
    // U+FFFD: a file saved in another encoding (Excel's cp1252) came in
    // garbled: the ’ in "I’m" turns into U+FFFD, and the line no longer
    // matches its stored key.
    if (mode === 'import') {
      for (const [k, v] of [['speaker', speaker], ['text', text], ['replySpeaker', replySpeaker], ['replyText', replyText], ['note', note]]) {
        if (!errors[k] && v.includes('\uFFFD')) errors[k] = 'Garbled characters: save the file as UTF-8 and import it again.';
      }
    }
    if (mode === 'suggest') {
      for (const [k, v] of [['speaker', speaker], ['text', text], ['replySpeaker', replySpeaker], ['replyText', replyText], ['note', note]]) {
        if (!errors[k] && hasUrl(v)) errors[k] = 'No links, please.';
      }
    }

    // Episode (1-based in, 0-based stored) and time within it.
    const tl = project ? SG.timeline(project) : null;
    const series = !!(tl && tl.kind === 'series');
    let episode = null;
    const epRaw = r.episode;
    if (epRaw != null && String(epRaw).trim() !== '') {
      const n = Number(String(epRaw).trim().replace(/^e/i, ''));
      if (!series) errors.episode = 'Movies have no episodes.';
      else if (!Number.isInteger(n) || n < 1 || n > tl.segments.length) errors.episode = `Pick an episode (1–${tl.segments.length}).`;
      else episode = n - 1;
    }
    let timeSec = null;
    const tRaw = r.timeSec != null && r.timeSec !== '' ? r.timeSec : r.time;
    if (tRaw != null && String(tRaw).trim() !== '') {
      timeSec = SG.parseTime(typeof tRaw === 'number' ? tRaw : String(tRaw));
      if (timeSec == null) errors.time = 'Enter the time as h:mm:ss, m:ss or seconds.';
    }
    if (mode === 'suggest') {
      if (series && episode == null && !errors.episode) errors.episode = 'Which episode?';
      if (timeSec == null && !errors.time) errors.time = 'Roughly when is it said? (e.g. 1:02:13)';
    }
    if (timeSec != null && !errors.time && tl) {
      if (series && episode == null) {
        if (!errors.episode) errors.episode = 'Pick the episode for that time.';
      } else if (!errors.episode) {
        const seg = series ? tl.segments[episode] : tl.segments[0];
        if (timeSec > seg.len + C.TIME_SLACK_S) errors.time = `That's past the end (${SG.formatTime(seg.len)}).`;
      }
    }

    // Wrong answers the admin wants used first.
    const d = r.decoys && typeof r.decoys === 'object' ? r.decoys : { speakers: r.decoySpeakers, replies: r.decoyReplies };
    const list = (v) => (Array.isArray(v) ? v : String(v == null ? '' : v).split('|')).map(cleanText).filter(Boolean);
    const decoySpeakers = mode === 'suggest' ? [] : uniqueBy(list(d && d.speakers), norm);
    const decoyReplies = mode === 'suggest' ? [] : uniqueBy(list(d && d.replies), norm);
    if (decoySpeakers.length > C.MAX_DECOYS || decoySpeakers.some(s => s.length > C.MAX_SPEAKER)) {
      errors.decoySpeakers = `Up to ${C.MAX_DECOYS} names, each under ${C.MAX_SPEAKER} characters.`;
    } else if (speaker && decoySpeakers.some(s => norm(s) === norm(speaker))) {
      errors.decoySpeakers = "A wrong name can't be the speaker.";
    }
    if (decoyReplies.length > C.MAX_DECOYS || decoyReplies.some(s => s.length > C.MAX_REPLY)) {
      errors.decoyReplies = `Up to ${C.MAX_DECOYS} replies, each under ${C.MAX_REPLY} characters.`;
    } else if (decoyReplies.length && !replyText) {
      errors.decoyReplies = 'Wrong replies need a reply.';
    } else if (replyText && decoyReplies.some(s => norm(s) === norm(replyText) || norm(s) === norm(text))) {
      errors.decoyReplies = "A wrong reply can't be the reply or the line.";
    }

    if (Object.keys(errors).length) return { ok: false, errors };
    const idx = o.characters || null;
    // A character picked by hand wins over the name match.
    const charId = (v) => { const c = cleanText(v); return /^[a-z0-9_-]{1,40}$/.test(c) ? c : null; };
    const who = (name, given) => ({ name, key: norm(name), characterId: charId(given) || linkCharacter(name, idx) });
    return {
      ok: true,
      errors: {},
      line: {
        projectId: project ? project.id : (cleanText(r.projectId) || null),
        episode,
        timeSec,
        speaker: who(speaker, r.speakerCharacterId || r.characterId),
        text,
        textKey: norm(text),
        reply: replyText ? { speaker: who(replySpeaker, rep.characterId), text: replyText } : null,
        note,
        source,
        decoys: { speakers: decoySpeakers, replies: decoyReplies }
      }
    };
  }

  function uniqueBy(arr, keyFn) {
    const seen = new Set();
    return arr.filter(x => { const k = keyFn(x); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  // ── import / export ───────────────────────────────────────────────────

  // RFC 4180 CSV → rows of strings. Handles a byte-order mark, CRLF / LF,
  // quoted fields with commas, doubled quotes and newlines. Blank lines go.
  function parseCsv(input) {
    const s = String(input == null ? '' : input).replace(/^﻿/, '');
    const rows = [];
    let row = [], field = '', i = 0, quoted = false;
    while (i < s.length) {
      const ch = s[i];
      if (quoted) {
        if (ch === '"') {
          if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
          quoted = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"' && field === '') { quoted = true; i++; continue; }
      if (ch === ',') { row.push(field); field = ''; i++; continue; }
      if (ch === '\r' || ch === '\n') {
        row.push(field); field = '';
        if (row.some(f => f !== '')) rows.push(row);
        row = [];
        i += (ch === '\r' && s[i + 1] === '\n') ? 2 : 1;
        continue;
      }
      field += ch; i++;
    }
    row.push(field);
    if (row.some(f => f !== '')) rows.push(row);
    return rows;
  }

  const HEADER_ALIASES = {
    projectid: 'projectId', project: 'projectId', island: 'projectId', title: 'projectId',
    speaker: 'speaker', who: 'speaker', character: 'speaker',
    text: 'text', line: 'text', quote: 'text',
    replyspeaker: 'replySpeaker', replier: 'replySpeaker',
    replytext: 'replyText', reply: 'replyText',
    note: 'note', scene: 'note', context: 'note',
    episode: 'episode', ep: 'episode',
    time: 'time', timestamp: 'time',
    source: 'source', url: 'source',
    decoyspeakers: 'decoySpeakers', wrongspeakers: 'decoySpeakers',
    decoyreplies: 'decoyReplies', wrongreplies: 'decoyReplies'
  };

  // CSV text → { rows: [{ projectId, speaker, … }], error }. The first row
  // is the header (any order; see HEADER_ALIASES).
  function rowsFromCsv(input) {
    const grid = parseCsv(input);
    if (!grid.length) return { rows: [], error: 'The file is empty.' };
    const keys = grid[0].map(h => HEADER_ALIASES[String(h).toLowerCase().replace(/[^a-z]/g, '')] || null);
    if (!keys.includes('text') || !keys.includes('speaker')) {
      return { rows: [], error: 'The first row must be a header with at least "speaker" and "text" (and "projectId").' };
    }
    // csvField's formula guard ("'=…") comes off again, so an export re-imports as it was.
    const unguard = (v) => (/^'[=+\-@]/.test(v) ? v.slice(1) : v);
    const rows = grid.slice(1).map(cells => {
      const o = {};
      keys.forEach((k, i) => { if (k && cells[i] != null && cells[i] !== '') o[k] = unguard(cells[i]); });
      return o;
    });
    if (rows.length > C.IMPORT_MAX_ROWS) return { rows: [], error: `Up to ${C.IMPORT_MAX_ROWS} lines per import.` };
    return { rows, error: null };
  }

  // JSON (a seed file { projectId, lines:[…] }, an array of those, or an
  // array of flat rows) → { rows, error }. Each row carries its projectId.
  function rowsFromJson(input) {
    let data = input;
    if (typeof input === 'string') {
      try { data = JSON.parse(input.replace(/^﻿/, '')); } catch (e) { return { rows: [], error: "That isn't valid JSON." }; }
    }
    const rows = [];
    const take = (item, pid) => {
      if (!item || typeof item !== 'object') return;
      if (Array.isArray(item.lines)) { item.lines.forEach(l => take(l, item.projectId || pid)); return; }
      const row = Object.assign({}, item);
      if (row.projectId == null && pid != null) row.projectId = pid;
      rows.push(row);
    };
    if (Array.isArray(data)) data.forEach(d => take(d, null));
    else if (data && typeof data === 'object') take(data, null);
    else return { rows: [], error: 'Expected { projectId, lines: [...] } or a list of lines.' };
    if (!rows.length) return { rows: [], error: 'No lines found.' };
    if (rows.length > C.IMPORT_MAX_ROWS) return { rows: [], error: `Up to ${C.IMPORT_MAX_ROWS} lines per import.` };
    return { rows, error: null };
  }

  // Check every row before anything is written.
  //   ctx: { projects: [project], existingKeys: Set("pid|textKey"), characters: [character] }
  // → { rows: [{ index, status: 'ok'|'dupe-db'|'dupe-batch'|'error', projectId, line, errors }],
  //     byProject: { pid: { ok, dupe, error } }, counts: { ok, dupe, error } }
  // A row names its project by id or by exact title (case-insensitive).
  function planImport(rows, ctx) {
    const c = ctx || {};
    const projects = Array.isArray(c.projects) ? c.projects : [];
    const byId = new Map(projects.map(p => [String(p.id), p]));
    const byTitle = new Map(projects.map(p => [norm(p.title), p]));
    const existing = c.existingKeys instanceof Set ? c.existingKeys : new Set(c.existingKeys || []);
    const idx = characterIndex(c.characters);
    const seen = new Set();
    const out = [];
    const byProject = {};
    const counts = { ok: 0, dupe: 0, error: 0 };
    (Array.isArray(rows) ? rows : []).forEach((row, index) => {
      const ref = cleanText(row && row.projectId);
      const project = byId.get(ref) || byTitle.get(norm(ref)) || null;
      let res;
      if (!project) res = { status: 'error', projectId: ref || null, line: null, errors: { projectId: ref ? `No project "${ref}".` : 'Which project?' } };
      else {
        const v = validateLine(row, { project, mode: 'import', characters: idx });
        if (!v.ok) res = { status: 'error', projectId: project.id, line: null, errors: v.errors };
        else {
          const key = project.id + '|' + v.line.textKey;
          const status = existing.has(key) ? 'dupe-db' : seen.has(key) ? 'dupe-batch' : 'ok';
          seen.add(key);
          res = { status, projectId: project.id, line: v.line, errors: {} };
        }
      }
      res.index = index;
      out.push(res);
      const pid = res.projectId || '?';
      const b = byProject[pid] || (byProject[pid] = { ok: 0, dupe: 0, error: 0 });
      const k = res.status === 'ok' ? 'ok' : res.status === 'error' ? 'error' : 'dupe';
      b[k]++; counts[k]++;
    });
    return { rows: out, byProject, counts };
  }

  // A stored line → a flat CSV/JSON row (episode back to 1-based).
  function lineToRow(l) {
    return {
      projectId: l.projectId,
      speaker: l.speaker ? l.speaker.name : '',
      text: l.text || '',
      replySpeaker: l.reply && l.reply.speaker ? l.reply.speaker.name : '',
      replyText: l.reply ? l.reply.text : '',
      note: l.note || '',
      episode: Number.isInteger(l.episode) ? l.episode + 1 : '',
      time: Number.isInteger(l.timeSec) ? SG.formatTime(l.timeSec) : '',
      source: l.source || '',
      decoySpeakers: (l.decoys && l.decoys.speakers || []).join('|'),
      decoyReplies: (l.decoys && l.decoys.replies || []).join('|')
    };
  }

  // lineToRow + the portrait links, for editing a stored line in place.
  function lineToForm(l) {
    return Object.assign(lineToRow(l), {
      speakerCharacterId: l.speaker && l.speaker.characterId || '',
      replyCharacterId: l.reply && l.reply.speaker && l.reply.speaker.characterId || ''
    });
  }

  // Seed-file shape, one entry per project: [{ projectId, lines: [...] }].
  function toSeedJson(lines) {
    const groups = new Map();
    for (const l of lines || []) {
      const r = lineToRow(l);
      if (!groups.has(r.projectId)) groups.set(r.projectId, []);
      groups.get(r.projectId).push({
        speaker: r.speaker, text: r.text,
        reply: r.replyText ? { speaker: r.replySpeaker, text: r.replyText } : null,
        note: r.note, episode: r.episode === '' ? null : r.episode, time: r.time, source: r.source,
        decoys: { speakers: l.decoys ? l.decoys.speakers || [] : [], replies: l.decoys ? l.decoys.replies || [] : [] }
      });
    }
    return [...groups].map(([projectId, ls]) => ({ projectId, lines: ls }));
  }

  function csvField(v) {
    const s = v == null ? '' : String(v);
    // A leading = + - @ would run as a formula in a spreadsheet.
    const safe = /^[=+\-@]/.test(s) ? "'" + s : s;
    return /[",\r\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
  }
  // Starts with a BOM so Excel reads it as UTF-8 ("I’m", not "Iâ€™m");
  // parseCsv drops it again.
  function toCsv(lines) {
    const head = CSV_COLUMNS.join(',');
    const body = (lines || []).map(l => { const r = lineToRow(l); return CSV_COLUMNS.map(k => csvField(r[k])).join(','); });
    return '\uFEFF' + [head].concat(body).join('\r\n') + '\r\n';
  }

  // UTF-8 bytes, which is what the server's 64 KB body limit counts (a
  // curly quote is 1 UTF-16 unit but 3 bytes).
  let encoder = null;
  function utf8Bytes(s) {
    if (typeof Buffer !== 'undefined' && Buffer.byteLength) return Buffer.byteLength(s, 'utf8');
    encoder = encoder || new TextEncoder();
    return encoder.encode(s).length;
  }

  // Split rows into commit requests under both limits.
  function chunkRows(rows, maxRows, maxBytes) {
    const mr = maxRows || C.COMMIT_ROWS, mb = maxBytes || C.COMMIT_BYTES;
    const out = [];
    let cur = [], bytes = 2;
    for (const r of rows || []) {
      const b = utf8Bytes(JSON.stringify(r)) + 1;
      if (cur.length && (cur.length >= mr || bytes + b > mb)) { out.push(cur); cur = []; bytes = 2; }
      cur.push(r); bytes += b;
    }
    if (cur.length) out.push(cur);
    return out;
  }

  // ── the pool ──────────────────────────────────────────────────────────

  // { n, speakers, replies } over approved, active lines (or any list the
  // caller already filtered). Speakers count the people who reply, too.
  function poolStats(lines) {
    const keys = new Set();
    let n = 0, replies = 0;
    for (const l of lines || []) {
      n++;
      if (l.speaker && l.speaker.key) keys.add(l.speaker.key);
      if (l.reply) { replies++; if (l.reply.speaker && l.reply.speaker.key) keys.add(l.reply.speaker.key); }
    }
    return { n, speakers: keys.size, replies };
  }
  function playable(stats) { return !!stats && stats.n >= C.MIN_POOL && stats.speakers >= C.MIN_SPEAKERS; }
  function needs(stats) {
    const s = stats || { n: 0, speakers: 0 };
    return { lines: Math.max(0, C.MIN_POOL - s.n), speakers: Math.max(0, C.MIN_SPEAKERS - s.speakers) };
  }

  function roundMsFrom(sec) {
    const s = Math.round(Number(sec));
    if (!Number.isFinite(s)) return C.ROUND_MS;
    return Math.max(C.ROUND_SEC_MIN, Math.min(C.ROUND_SEC_MAX, s)) * 1000;
  }

  // ── drawing a game ────────────────────────────────────────────────────

  function _rng(rng) { return typeof rng === 'function' ? rng : Math.random; }
  function shuffle(arr, rng) {
    const r = _rng(rng);
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // 10 rounds from an island's bank, or null when it isn't playable.
  //   bank: [{ id, speaker:{name,key,characterId}, text, textKey, reply, note, episode, decoys, credit }]
  // → [{ lineId, type: 'who'|'reply', prompt: { text, speaker|null, episode },
  //      options: [{ id: 'a'…'d', label, characterId|null }], answer: 'a'…'d',
  //      reveal: { speaker, characterId, note, episode, credit } }]
  // Reply rounds: each reply-capable line flips a coin, clamped to
  // REPLY_MIN…REPLY_MAX (and to what the bank has). No text is used twice in
  // a game, and option ids are positions — never database ids.
  function buildRounds(bank, rng) {
    const r = _rng(rng);
    const lines = (bank || []).filter(l => l && l.text && l.speaker && l.speaker.key);
    if (!playable(poolStats(lines)) || lines.length < C.ROUNDS) return null;

    // Display name + portrait per speaker key (first seen wins).
    const people = new Map();
    const meet = (s) => { if (s && s.key && !people.has(s.key)) people.set(s.key, { name: s.name, characterId: s.characterId || null, key: s.key }); };
    lines.forEach(l => { meet(l.speaker); if (l.reply) meet(l.reply.speaker); });

    let want = 0;
    for (let i = 0; i < C.ROUNDS; i++) if (r() < 0.5) want++;
    want = Math.max(C.REPLY_MIN, Math.min(C.REPLY_MAX, want));

    const order = shuffle(lines, r);
    // `replies` reply rounds first, then "who" rounds; no text twice.
    const select = (replies) => {
      const used = new Set();             // text keys already in this game
      const picked = [];
      for (const l of order) {
        if (picked.length >= replies) break;
        if (!(l.reply && l.reply.text)) continue;
        const rk = norm(l.reply.text);
        if (used.has(l.textKey) || used.has(rk)) continue;
        used.add(l.textKey); used.add(rk);
        picked.push({ line: l, type: 'reply' });
      }
      for (const l of order) {
        if (picked.length >= C.ROUNDS) break;
        if (used.has(l.textKey) || picked.some(p => p.line === l)) continue;
        used.add(l.textKey);
        picked.push({ line: l, type: 'who' });
      }
      return picked;
    };
    // A reply that is also another line's text uses up both; on a bank of
    // barely 10 that can leave too few, so then it's a "who"-only game (the
    // keys are unique per island, so that always fills 10).
    let picked = select(want);
    if (picked.length < C.ROUNDS) picked = select(0);
    if (picked.length < C.ROUNDS) return null;

    const prompts = new Set(picked.map(p => p.line.textKey));
    const rounds = shuffle(picked, r).map(({ line, type }) =>
      type === 'reply' ? _replyRound(line, lines, prompts, people, r) : _whoRound(line, lines, people, r));
    return rounds.every(Boolean) ? rounds : null;
  }

  function _finish(line, type, prompt, right, wrong, reveal, r) {
    const opts = shuffle([right].concat(wrong.slice(0, C.OPTIONS - 1)), r);
    if (opts.length < C.OPTIONS) return null;
    const options = opts.map((o, i) => ({ id: OPTION_IDS[i], label: o.label, characterId: o.characterId || null }));
    return {
      lineId: String(line.id),
      type,
      prompt,
      options,
      answer: OPTION_IDS[opts.indexOf(right)],
      reveal
    };
  }

  function _whoRound(line, lines, people, r) {
    const ans = people.get(line.speaker.key) || line.speaker;
    const right = { label: ans.name, characterId: ans.characterId || null };
    const taken = new Set([line.speaker.key]);
    const wrong = [];
    const push = (p) => { if (p && !taken.has(p.key)) { taken.add(p.key); wrong.push({ label: p.name, characterId: p.characterId || null }); } };
    // Admin decoys first, then people on this island (same episode first on a series).
    shuffle((line.decoys && line.decoys.speakers) || [], r).forEach(name => {
      const k = norm(name);
      push(people.get(k) || { key: k, name, characterId: null });
    });
    const others = shuffle([...people.values()].filter(p => !taken.has(p.key)), r);
    const sameEp = Number.isInteger(line.episode) ? new Set(_episodeSpeakers(line.episode, lines)) : null;
    if (sameEp) others.sort((a, b) => (sameEp.has(b.key) ? 1 : 0) - (sameEp.has(a.key) ? 1 : 0));
    others.forEach(push);
    return _finish(line, 'who',
      { text: line.text, speaker: null, episode: Number.isInteger(line.episode) ? line.episode : null },
      right, wrong,
      { speaker: ans.name, characterId: ans.characterId || null, note: line.note || '', episode: Number.isInteger(line.episode) ? line.episode : null, credit: line.credit || null },
      r);
  }

  function _episodeSpeakers(ep, lines) {
    const out = [];
    for (const l of lines || []) {
      if (l.episode !== ep) continue;
      out.push(l.speaker.key);
      if (l.reply && l.reply.speaker) out.push(l.reply.speaker.key);
    }
    return out;
  }

  function _replyRound(line, lines, prompts, people, r) {
    const answer = line.reply.text;
    const ak = norm(answer);
    const taken = new Set([ak, line.textKey]);
    const wrong = [];
    const push = (text) => { const k = norm(text); if (k && !taken.has(k)) { taken.add(k); wrong.push({ label: text, characterId: null }); } };
    shuffle((line.decoys && line.decoys.replies) || [], r).forEach(push);
    // Other replies and lines from the island, nearest in length to the real
    // reply — so "the longest one is right" gives nothing away. First
    // without this game's other prompts; a small bank (10 lines, few
    // replies) may need them too, or the island couldn't start a game.
    for (const skipPrompts of [true, false]) {
      if (wrong.length >= C.OPTIONS - 1) break;
      const pool = [];
      const seen = new Set(taken);
      for (const l of lines) {
        for (const t of [l.reply && l.reply.text, l.text]) {
          const k = norm(t);
          if (!k || seen.has(k) || (skipPrompts && prompts.has(k))) continue;
          seen.add(k);
          pool.push(t);
        }
      }
      const near = shuffle(pool, r)
        .sort((a, b) => Math.abs(a.length - answer.length) - Math.abs(b.length - answer.length))
        .slice(0, C.LENGTH_POOL);
      shuffle(near, r).forEach(push);
    }
    const sp = people.get(line.speaker.key) || line.speaker;
    const rp = people.get(line.reply.speaker.key) || line.reply.speaker;
    return _finish(line, 'reply',
      { text: line.text, speaker: { name: sp.name, characterId: sp.characterId || null }, episode: Number.isInteger(line.episode) ? line.episode : null },
      { label: answer, characterId: null }, wrong,
      { speaker: rp.name, characterId: rp.characterId || null, note: line.note || '', episode: Number.isInteger(line.episode) ? line.episode : null, credit: line.credit || null },
      r);
  }

  // ── scoring ───────────────────────────────────────────────────────────

  // A right answer: MAX_POINTS locked in at once, falling linearly to
  // MIN_POINTS at the buzzer (or later, in the late grace). Wrong = 0.
  function score(correct, lockMs, roundMs) {
    if (!correct) return 0;
    const len = Number(roundMs) > 0 ? Number(roundMs) : C.ROUND_MS;
    const f = Math.max(0, Math.min(1, (Number(lockMs) || 0) / len));
    return Math.round(C.MIN_POINTS + (C.MAX_POINTS - C.MIN_POINTS) * (1 - f));
  }

  // ── the game (server-authoritative reducers) ──────────────────────────
  //
  // state = {
  //   projectId, phase, host (userId), deadline, roundMs, round (-1 before the first), roundStartedAt,
  //   rounds: [buildRounds item] — answers never leave the server before their reveal
  //   order: [userId…], players: { userId: {
  //     username, guesses: [{ choice, correct, points, lockMs } | null] × ROUNDS, total, lockMs } },
  //   record: { username, score, previous } | null (set by the server at results)
  // }
  // Field names match SceneGuessLogic's, so the shared server code
  // (early reveal, ranking, saving) drives both games.

  function _copy(state, patch) { return Object.assign({}, state, patch); }
  function _copyPlayers(state) {
    const out = {};
    for (const id of Object.keys(state.players)) out[id] = Object.assign({}, state.players[id]);
    return out;
  }
  function _newPlayer(username) {
    return { username, guesses: new Array(C.ROUNDS).fill(null), total: 0, lockMs: 0 };
  }

  function createLobby(o) {
    const host = String(o.userId);
    return {
      projectId: o.projectId,
      phase: 'lobby',
      host,
      createdAt: o.now,
      deadline: o.now + C.LOBBY_MS,
      roundMs: o.roundMs || C.ROUND_MS,
      round: -1,
      roundStartedAt: 0,
      rounds: [],
      order: [host],
      players: { [host]: _newPlayer(o.username) },
      record: null
    };
  }

  function playerCount(state) { return state.order.length; }
  function hasPlayer(state, userId) { return Object.prototype.hasOwnProperty.call(state.players, String(userId)); }

  function join(state, userId, username) {
    const id = String(userId);
    if (state.phase !== 'lobby') return { ok: false, error: 'started' };
    if (hasPlayer(state, id)) return { ok: true, state };
    if (playerCount(state) >= C.MAX_PLAYERS) return { ok: false, error: 'full' };
    const players = _copyPlayers(state);
    players[id] = _newPlayer(username);
    return { ok: true, state: _copy(state, { players, order: state.order.concat(id) }) };
  }

  function leave(state, userId) {
    const id = String(userId);
    if (!hasPlayer(state, id)) return state;
    const players = _copyPlayers(state);
    delete players[id];
    const order = state.order.filter(x => x !== id);
    const patch = { players, order };
    if (state.host === id && order.length) patch.host = order[0];
    if (!order.length) patch.phase = 'over';
    return _copy(state, patch);
  }

  // Lobby → "get ready" with the drawn rounds.
  function begin(state, rounds, now) {
    if (state.phase !== 'lobby') return state;
    return _copy(state, { phase: 'ready', rounds: rounds.slice(), deadline: now + C.READY_MS });
  }

  function startRound(state, now) {
    if (state.phase !== 'ready' && state.phase !== 'reveal') return state;
    return _copy(state, { phase: 'round', round: state.round + 1, roundStartedAt: now, deadline: now + state.roundMs });
  }

  // A player locks in option `choice` for `round`. Points are worked out now
  // but only added to totals at the reveal.
  function answer(state, userId, round, choice, now) {
    const id = String(userId);
    if (state.phase !== 'round') return { ok: false, error: 'not-round' };
    if (round !== state.round) return { ok: false, error: 'wrong-round' };
    if (!hasPlayer(state, id)) return { ok: false, error: 'not-playing' };
    if (now > state.deadline + C.LATE_GRACE_MS) return { ok: false, error: 'too-late' };
    const rd = state.rounds[round];
    if (!rd || !rd.options.some(o => o.id === choice)) return { ok: false, error: 'bad-guess' };
    const p = state.players[id];
    if (p.guesses[round]) return { ok: false, error: 'already' };
    const lockMs = Math.max(0, Math.min(state.roundMs, now - state.roundStartedAt));
    const correct = choice === rd.answer;
    const players = _copyPlayers(state);
    const guesses = p.guesses.slice();
    guesses[round] = { choice, correct, points: score(correct, now - state.roundStartedAt, state.roundMs), lockMs };
    players[id].guesses = guesses;
    return { ok: true, state: _copy(state, { players }) };
  }

  function allLocked(state) {
    if (state.phase !== 'round' || !state.order.length) return false;
    return state.order.every(id => !!state.players[id].guesses[state.round]);
  }

  // Round → reveal. No answer scores 0 and counts as the whole round for the
  // lock-in tie-break.
  function reveal(state, now) {
    if (state.phase !== 'round') return state;
    const players = _copyPlayers(state);
    for (const id of state.order) {
      const p = players[id];
      const guesses = p.guesses.slice();
      const g = guesses[state.round] || { choice: null, correct: false, points: 0, lockMs: state.roundMs };
      guesses[state.round] = g;
      p.guesses = guesses;
      p.total += g.points;
      p.lockMs += g.lockMs;
    }
    return _copy(state, { phase: 'reveal', players, deadline: now + C.REVEAL_MS });
  }

  function next(state, now) {
    if (state.phase !== 'reveal') return state;
    if (state.round >= C.ROUNDS - 1) return _copy(state, { phase: 'results', deadline: now + C.RESULTS_MS });
    return startRound(state, now);
  }

  // Final standings: total ↓, then total lock-in time ↑, then join order.
  function ranking(state) {
    return state.order
      .map((id, i) => ({ userId: id, username: state.players[id].username, total: state.players[id].total, lockMs: state.players[id].lockMs, i }))
      .sort((a, b) => (b.total - a.total) || (a.lockMs - b.lockMs) || (a.i - b.i))
      .map(({ i, ...r }) => r);
  }

  // The round a player answered right fastest — their default featured
  // line. 0 when nothing was right.
  function bestRound(guesses) {
    let best = 0, bestMs = Infinity;
    (guesses || []).forEach((g, i) => {
      if (g && g.correct && g.lockMs < bestMs) { bestMs = g.lockMs; best = i; }
    });
    return best;
  }

  // Strictly greater wins; a tie keeps the earlier record.
  function newRecord(champion, rank) {
    const top = rank && rank[0];
    if (!top || !(top.total > 0)) return null;
    const bar = champion && typeof champion.score === 'number' ? champion.score : 0;
    return top.total > bar ? top : null;
  }

  function _publicRound(rd) {
    return {
      type: rd.type,
      prompt: { text: rd.prompt.text, speaker: rd.prompt.speaker ? { name: rd.prompt.speaker.name, characterId: rd.prompt.speaker.characterId || null } : null, episode: rd.prompt.episode },
      options: rd.options.map(o => ({ id: o.id, label: o.label, characterId: o.characterId || null }))
    };
  }

  // What everyone on the island may see. The current round's question and
  // options only; answers, picks and credits appear only for rounds that
  // have been revealed. Usernames only, never userIds or line ids.
  function publicState(state) {
    const revealedUpTo = state.phase === 'round' ? state.round - 1
      : (state.phase === 'reveal' || state.phase === 'results' || state.phase === 'over') ? state.round : -1;
    const history = [];
    for (let r = 0; r <= revealedUpTo; r++) {
      const rd = state.rounds[r];
      if (!rd) break;
      history.push(Object.assign(_publicRound(rd), {
        round: r,
        answer: rd.answer,
        reveal: { speaker: rd.reveal.speaker, characterId: rd.reveal.characterId || null, note: rd.reveal.note || '', episode: rd.reveal.episode, credit: rd.reveal.credit || null },
        picks: state.order.map(id => {
          const g = state.players[id].guesses[r];
          return { username: state.players[id].username, choice: g ? g.choice : null, points: g ? g.points : 0, ms: g ? g.lockMs : null };
        })
      }));
    }
    const live = (state.phase === 'round' || state.phase === 'reveal') && state.rounds[state.round];
    const out = {
      projectId: state.projectId,
      phase: state.phase,
      host: state.players[state.host] ? state.players[state.host].username : null,
      of: C.ROUNDS,
      round: state.round,
      deadline: state.deadline,
      roundMs: state.roundMs,
      max: C.MAX_PLAYERS,
      players: state.order.map(id => ({
        username: state.players[id].username,
        locked: state.phase === 'round' && !!state.players[id].guesses[state.round],
        total: state.players[id].total
      })),
      current: live ? Object.assign({ round: state.round }, _publicRound(state.rounds[state.round])) : null,
      history
    };
    if (state.phase === 'results' || state.phase === 'over') {
      out.ranking = ranking(state).map(r => ({ username: r.username, total: r.total }));
      out.record = state.record || null;
    }
    return out;
  }

  return {
    C, PHASES, OPTION_IDS, ORIGINS, STATUSES, CSV_COLUMNS, ALIASES,
    cleanText, norm, normName, hasUrl, isWebLink, episodeLabel,
    characterIndex, linkCharacter, validateLine,
    parseCsv, rowsFromCsv, rowsFromJson, planImport, lineToRow, lineToForm, toSeedJson, toCsv, chunkRows,
    poolStats, playable, needs, roundMsFrom,
    shuffle, buildRounds, score,
    createLobby, join, leave, begin, startRound, answer, allLocked, reveal, next,
    ranking, bestRound, newRecord, publicState, playerCount, hasPlayer
  };
});
