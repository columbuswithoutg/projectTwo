/************************************************
 * ONBOARDING LOGIC (pure, unit-tested) — the first-run welcome's and the
 * first-visit feature tips' content and rules:
 *   TIPS             per page: the spotlight steps shown the first time a
 *                    user opens it (sel: the element each one points at)
 *   tipsKey          the per-user localStorage key listing the pages done
 *   tipsSeen/markTip read / update that stored list
 *   candidates       the titles the welcome's "already watched?" step offers
 *   nextUp           the first few titles a fresh path opens with
 *
 * UMD-ish like js/help-logic.js: `OnboardingLogic` in the browser,
 * module.exports under node. Loads in the core chunk before js/onboarding.js.
 ************************************************/
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.OnboardingLogic = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // Bump to show every page's tips again to everyone (after a redesign).
  const TIPS_VERSION = 1;

  // step: { sel, title, text }. sel may list fallbacks ("a, b"): the first
  // VISIBLE match is used, and a step with nothing visible is skipped.
  // help: the "?" guide section the last step's "Full guide" opens.
  const TIPS = {
    '/': { help: 'watch', steps: [
      { sel: '.flow-nodes .flow-cell', title: 'Your watch order',
        text: 'Every poster is a title, in story order. Tap one to open it, then press "Start watching" — when its runtime has passed, mark it watched to unlock what comes next.' },
      { sel: '.order-mode-toggle', title: 'Two paths',
        text: 'All Marvel shows every title. Doomsday shows only the must-watch list before Avengers: Doomsday.' },
      { sel: '.bottom-nav, .view-tabs', title: 'Board, Feed and World',
        text: 'Board lists the same titles as to-do columns, Feed shows what friends watch, and World is the 3D map you can walk around.' },
      { sel: '#nav-toggle', title: 'The menu',
        text: 'Friends, Messages, Goals, Characters and your Home are all in here.' },
      { sel: '.hdr-bell', title: 'Notifications',
        text: 'New messages and friend requests show up here with a red count.' },
      { sel: '.help-btn', title: 'Need a hand?',
        text: 'The ? opens the full guide for every feature, any time.' }
    ] },
    '/board': { help: 'board', steps: [
      { sel: '.kb-col, .kb-board', title: 'Three columns',
        text: 'Not started holds what you can watch now, In progress has your running timers, and Done keeps what you\'ve finished.' },
      { sel: '.kb-card', title: 'Move a card',
        text: 'Use the card\'s buttons, or drag it to the next column. The timer still has to run before a title counts as watched.' },
      { sel: '.kb-filter', title: 'Filter',
        text: 'Narrow a column to movies, series or a single phase.' }
    ] },
    '/feed': { help: 'feed', steps: [
      { sel: '.feed-card, .feed-list', title: 'Your feed',
        text: 'Finishing a title posts it here for your friends. React, comment, or tap a photo to see it bigger.' },
      { sel: '#feed-find-friends, #nav-toggle', title: 'Add friends',
        text: 'Find friends from the menu → Friends, so their watches show up here too.' }
    ] },
    '/world': { help: 'world', steps: [
      { sel: '#pg-stage', title: 'Walk around',
        text: 'WASD or the arrow keys walk (on a phone, the stick in the corner). Each island is a title you\'ve unlocked.' },
      { sel: '.world-chat-row', title: 'Chat and voice',
        text: 'Talk to everyone in the world, to the people on your island, or whisper to one player. The microphone button turns voice on.' },
      { sel: '#world-sg-slot, .world-header .help-btn', title: 'Minigames',
        text: 'Some islands run Scene Guess and Quote Guess rounds. The ? has the rules.' }
    ] },
    '/profile': { help: 'me', steps: [
      { sel: '#profile-hero', title: 'Your profile',
        text: 'Tap the pencil on your picture to change it. Friends see this page when they open your name.' },
      { sel: '#profile-stats', title: 'Your stats',
        text: 'Watched titles, watch sessions and unlocked characters add up here as you go.' }
    ] }
  };

  function tipsKey(userId) {
    return 'mcu_tips_seen_' + (userId ? String(userId) : 'anon');
  }

  // stored: the raw localStorage value → the pages already toured (this version).
  function tipsSeen(stored) {
    try {
      const v = JSON.parse(stored);
      if (v && v.v === TIPS_VERSION && Array.isArray(v.pages)) return v.pages.filter(p => typeof p === 'string');
    } catch (_) { /* missing / corrupt */ }
    return [];
  }

  // → the new stored value with `page` added.
  function markTip(stored, page) {
    const pages = tipsSeen(stored);
    if (!pages.includes(page)) pages.push(page);
    return JSON.stringify({ v: TIPS_VERSION, pages });
  }

  const isOut = (p, today) => !p.release || String(p.release).slice(0, 10) <= today;
  const byRelease = (a, b) => String(a.release || '').localeCompare(String(b.release || '')) || String(a.title).localeCompare(String(b.title));

  // The "already watched?" choices: every released title in release order,
  // or only the Doomsday list (in Marvel's order) when that path is picked.
  // today: 'YYYY-MM-DD'. pathIds: the Doomsday list (ids, in order).
  function candidates(projects, mode, pathIds, today) {
    const list = (projects || []).filter(p => p && p.id && isOut(p, today));
    if (mode !== 'dd') return list.sort(byRelease);
    const by = new Map(list.map(p => [p.id, p]));
    return (pathIds || []).map(id => by.get(id)).filter(Boolean);
  }

  // The first `n` titles the path opens with: revealed(p) is "unlocked and
  // not watched yet". Doomsday follows its list order, All Marvel release order.
  function nextUp(projects, mode, pathIds, revealed, n = 3) {
    if (mode === 'dd') {
      const by = new Map((projects || []).map(p => [p.id, p]));
      return (pathIds || []).map(id => by.get(id)).filter(p => p && revealed(p)).slice(0, n);
    }
    return (projects || []).filter(p => p && revealed(p)).sort(byRelease).slice(0, n);
  }

  return { TIPS_VERSION, TIPS, tipsKey, tipsSeen, markTip, candidates, nextUp };
});
