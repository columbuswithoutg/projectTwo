/************************************************
 * server/user-requests.js — the changes behind a user's request
 * (Report kind 'request', js/messaging-logic.js validateRequest).
 *
 * The user files a request on /reports; the admin approves or rejects it
 * from the admin Reports tab (POST /api/admin/reports/:id/resolve). This
 * module holds the rules both sides lean on:
 *   - checkNewRequest(): what the user route refuses before filing
 *   - the account changes an approval makes (undo a watch, set a count,
 *     rename with its cascade). "Mark as watched" reuses the admin
 *     Mark-watched path (server/admin-watch.js) and "Delete my account" the
 *     admin delete cascade (server/delete-user.js), both via routes/admin.js.
 *   - inboxText(): the note the user gets in Messages.
 *
 * Models come in as arguments (like server/delete-user.js) so the tests can
 * hand in stubs.
 ************************************************/
const L = require('../js/messaging-logic');

// Statuses that still count as "waiting for the admin".
const OPEN_STATUSES = ['open', 'in-progress'];

// request: the validated request. user: { _id, username, watchedProjects }.
// projects: Map id → project. nameTaken(name): async → true when another
// account holds that name. → { ok, request } | { ok:false, error }.
// mark-watched drops titles the user already has, so the admin only sees
// what would change; a request where every title is already there is refused.
async function checkNewRequest(request, user, projects, nameTaken) {
  const watched = new Set((user.watchedProjects || []).map(e => e.projectId));
  const out = { ...request };
  switch (request.type) {
    case 'mark-watched': {
      const unknown = request.projectIds.filter(id => !projects.has(id));
      if (unknown.length) return { ok: false, error: 'One of those titles no longer exists — reload and try again.' };
      out.projectIds = request.projectIds.filter(id => !watched.has(id));
      if (!out.projectIds.length) return { ok: false, error: 'Those titles are already on your watched list.' };
      return { ok: true, request: out };
    }
    case 'undo-watch':
    case 'fix-count': {
      if (!projects.has(request.projectId)) return { ok: false, error: 'That title no longer exists.' };
      const entry = (user.watchedProjects || []).find(e => e.projectId === request.projectId);
      if (!entry) return { ok: false, error: 'That title isn’t on your watched list.' };
      if (request.type === 'fix-count' && (entry.count || 1) === request.count) {
        return { ok: false, error: `It already shows ${request.count}.` };
      }
      return { ok: true, request: out };
    }
    case 'rename': {
      if (request.newUsername === user.username) return { ok: false, error: 'That’s already your username.' };
      // A change of case only ("bob" → "Bob") is the same account's name.
      const sameName = request.newUsername.toLowerCase() === String(user.username).toLowerCase();
      if (!sameName && await nameTaken(request.newUsername)) return { ok: false, error: 'That username is taken.' };
      out.oldUsername = user.username;
      return { ok: true, request: out };
    }
    default:
      return { ok: true, request: out };
  }
}

// Remove one title from the watched list (and any timer running on it).
// Titles that needed it as a prerequisite stay watched — a real watch is
// never undone by a lock. The entry's memory photos go with it.
// → { ok } | { ok:false, error }
async function undoWatch(User, userId, projectId) {
  const r = await User.updateOne(
    { _id: userId, 'watchedProjects.projectId': projectId },
    { $pull: { watchedProjects: { projectId }, watchSessions: { projectId } } }
  );
  return r.modifiedCount ? { ok: true } : { ok: false, error: 'That title is no longer on their watched list.' };
}

async function setCount(User, userId, projectId, count) {
  const r = await User.updateOne(
    { _id: userId, 'watchedProjects.projectId': projectId },
    { $set: { 'watchedProjects.$.count': count } }
  );
  return r.matchedCount ? { ok: true } : { ok: false, error: 'That title is no longer on their watched list.' };
}

// The writes a rename makes, in order. Usernames are stored by value in
// co-watcher lists (users' watchedProjects[].watchedWith and feed posts)
// and on the user's own reports, so those follow the new name. The first
// step also bumps tokenVersion: the user signs in again with the new name.
function renameSteps(userId, oldName, newName) {
  return [
    {
      name: 'user', model: 'User', op: 'updateOne',
      filter: { _id: userId, username: oldName },
      update: { $set: { username: newName, usernameLower: newName.toLowerCase() }, $unset: { usernameLowerConflict: 1 }, $inc: { tokenVersion: 1 } }
    },
    {
      name: 'watched-with', model: 'User', op: 'updateMany',
      filter: { 'watchedProjects.watchedWith': oldName },
      update: { $set: { 'watchedProjects.$[].watchedWith.$[n]': newName } },
      options: { arrayFilters: [{ n: oldName }] }
    },
    {
      name: 'feed-watched-with', model: 'FeedPost', op: 'updateMany',
      filter: { watchedWith: oldName },
      update: { $set: { 'watchedWith.$[n]': newName } },
      options: { arrayFilters: [{ n: oldName }] }
    },
    {
      name: 'reports', model: 'Report', op: 'updateMany',
      filter: { user: userId },
      update: { $set: { username: newName } }
    }
  ];
}

// models: { User, FeedPost, Report }. → { ok, steps } | { ok:false, error }
// The account row goes first; if it fails (name taken meanwhile, or the
// user renamed / vanished) nothing else is touched.
async function rename(models, userId, oldName, newName) {
  const steps = renameSteps(userId, oldName, newName);
  const done = [];
  for (const s of steps) {
    try {
      const r = await models[s.model][s.op](s.filter, s.update, s.options);
      if (s.name === 'user' && !r.matchedCount) return { ok: false, error: 'Their username changed since they asked.' };
      done.push({ name: s.name });
    } catch (err) {
      if (s.name === 'user') {
        return { ok: false, error: err && err.code === 11000 ? 'That username was taken in the meantime.' : 'Rename failed.' };
      }
      // Later steps are best effort: the account already has its new name.
      done.push({ name: s.name, error: err && err.message });
    }
  }
  return { ok: true, steps: done };
}

// The note the user gets in Messages once the admin has acted.
// extra: { added, skipped } for mark-watched (titles), reason text for a rejection.
function inboxText(request, outcome, { titleOf, added, skipped, reason } = {}) {
  const name = (id) => String((titleOf && titleOf(id)) || id);
  const what = L.requestTitle(request, titleOf);
  if (outcome === 'rejected') {
    return `Your request “${what}” wasn’t approved${reason ? `: ${reason}` : '.'}`;
  }
  switch (request.type) {
    case 'mark-watched': {
      const a = (added || []).map(name);
      const s = (skipped || []).map(name);
      const list = (xs) => xs.slice(0, 10).join(', ') + (xs.length > 10 ? ` and ${xs.length - 10} more` : '');
      const left = (request.projectIds || []).length - a.length - s.length;
      const notApproved = left > 0 ? ` ${left} ${left === 1 ? 'wasn’t' : 'weren’t'} approved.` : '';
      // The user may have watched them all themselves before the admin acted.
      if (!a.length) {
        const which = s.length === 1 ? (left > 0 ? 'the approved title' : 'the requested title')
          : (left > 0 ? 'the approved titles' : 'all of the requested titles');
        return `Approved: you’d already watched ${which}, so nothing needed changing.` + notApproved;
      }
      return `Approved: ${a.length === 1 ? 'a title is' : `${a.length} titles are`} now on your watched list — ${list(a)}.`
        + (s.length ? ` Already on your list: ${list(s)}.` : '') + notApproved;
    }
    case 'undo-watch': return `Approved: ${name(request.projectId)} is off your watched list.`;
    case 'fix-count':  return `Approved: ${name(request.projectId)} now shows ${request.count} watch${request.count === 1 ? '' : 'es'}.`;
    case 'add-title':  return `Approved: we’ll add “${request.title}” to the board — thanks for the suggestion!`;
    case 'rename':     return `Approved: your username is now ${request.newUsername}. Sign in again with the new name.`;
    default:           return `Your request “${what}” was approved.`;
  }
}

module.exports = { OPEN_STATUSES, checkNewRequest, undoWatch, setCount, renameSteps, rename, inboxText };
