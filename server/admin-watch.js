// Admin "Mark watched" (POST /api/admin/users/:id/watched): an admin skips
// the watch timer for a user. It deliberately bypasses BOTH rules a normal
// watch goes through (server/watchRules.js) — the runtime timer and the
// "watch X first" / phase locks — but it only ever adds real project ids,
// and never touches a title the user already has (its count, co-watchers and
// memories stay exactly as they are).

const MAX_PER_REQUEST = 200;
const MAX_WATCHED = 200;   // same cap as routes/progress.js MAX_WATCHED_PROJECTS
const INBOX_TITLES = 10;   // titles named in the inbox message, then "and N more"

function validId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 80;
}

// raw: the request's projectIds. watchedIds: Set of the user's watched ids.
// known: Map/Set of every existing project id.
// → { error, unknown? } or { add: [ids to add], skip: [already watched] }
function planMarkWatched(raw, watchedIds, known) {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'Pick at least one project' };
  if (raw.length > MAX_PER_REQUEST) return { error: `At most ${MAX_PER_REQUEST} projects at once` };
  if (!raw.every(validId)) return { error: 'Invalid projectId' };
  const ids = [...new Set(raw)];
  const unknown = ids.filter(id => !known.has(id));
  if (unknown.length) return { error: `Unknown project: ${unknown[0]}`, unknown };
  const add = ids.filter(id => !watchedIds.has(id));
  const skip = ids.filter(id => watchedIds.has(id));
  if (watchedIds.size + add.length > MAX_WATCHED) {
    return { error: `That would pass the ${MAX_WATCHED}-project limit` };
  }
  return { add, skip };
}

// New watchedProjects entries: one finished watch each, dated now.
function newEntries(ids, now = new Date()) {
  return ids.map(projectId => ({ projectId, count: 1, watchedWith: [], memories: [], lastWatchedAt: now }));
}

// The note the user gets in their Messages inbox from "Admin".
function inboxText(titles) {
  const n = titles.length;
  const named = titles.slice(0, INBOX_TITLES).join(', ');
  const more = n > INBOX_TITLES ? ` and ${n - INBOX_TITLES} more` : '';
  return `An admin marked ${n === 1 ? 'a project' : `${n} projects`} as watched for you: ${named}${more}.`;
}

module.exports = { MAX_PER_REQUEST, MAX_WATCHED, planMarkWatched, newEntries, inboxText };
