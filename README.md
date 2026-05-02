# MCU Tracker

A full-stack MCU watch-order tracker with an animated world map, friend system, character "walkers" that roam the map and have dialogue exchanges, user-uploaded memories, and a hidden admin panel for moderation, user management, live walker tuning, and content editing.

This document describes the **current state** of the project. The Changelog at the bottom is the running record of changes — append a new entry every time a feature ships or a bug is fixed.

---

## Tech stack

| Layer       | Tech                                                                 |
|-------------|----------------------------------------------------------------------|
| Backend     | Node.js + Express 5 + Mongoose                                       |
| Database    | MongoDB Atlas (free tier, cluster name: `Columbus`)                  |
| File store  | Cloudinary (user memories — images & video)                          |
| Auth        | JWT (7-day expiry) + bcryptjs                                        |
| Frontend    | Vanilla JS SPA (no framework)                                        |
| Hosting     | Render.com                                                           |

---

## Repo layout

```
projectOne/
├── server.js                  Express app entry — routes, rate limits, static allowlist
├── package.json
├── .env                       MONGO_URI, JWT_SECRET, CLOUDINARY_*, CLIENT_URL
├── README.md                  ← this file
│
├── projects.js                Static fallback: 71 MCU projects (data, var-declared)
├── characters.js              Static fallback: 131 MCU characters
├── locations.js               Static fallback: 36 world-map locations
├── auth.js                    Login-page script (bound to index.html)
├── index.html                 Login page
├── spa.html                   SPA shell — defers all the JS bundles
├── styles.css                 Single global stylesheet (~3500 lines)
│
├── models/                    Mongoose schemas
│   ├── user.js                username, password, watchedProjects, walkers,
│   │                          isAdmin, banned, tokenVersion, lastActiveAt
│   ├── Friend.js              friend & watch-party requests
│   ├── AuditLog.js            forensic log of every destructive admin action
│   ├── AdminConfig.js         singleton — walker physics overrides
│   ├── Project.js             CMS-editable MCU project content
│   ├── Character.js           CMS-editable MCU character content
│   ├── Location.js            CMS-editable map location content
│   └── Dialogue.js            CMS-editable walker dialogue content (singleton)
│
├── middleware/
│   ├── auth.js                JWT verify + tokenVersion check + ban check
│   │                          + 30s validation cache + lastActiveAt throttle
│   └── requireAdmin.js        composes auth + fresh DB isAdmin re-check
│
├── routes/
│   ├── auth.js                /api/auth/{register,login}
│   ├── progress.js            /api/progress/* — watch progress + memories
│   ├── friends.js             /api/friends/*
│   ├── upload.js              /api/upload — Cloudinary single-file upload
│   ├── profile.js             /api/profile/*
│   ├── admin.js               /api/admin/* — users, mod, audit, config, CMS
│   ├── config.js              /api/config/public — walker physics for SPA boot
│   └── content.js             /api/content/* — projects/chars/locs/dialogues
│
├── server/
│   └── contentLoader.js       vm.runInNewContext loader of static JS files,
│                              used as the Mongo-down fallback for /api/content/*
│
├── scripts/
│   └── seed-content.js        Idempotent seed: JS files → Mongo (run once)
│
└── js/
    ├── boot.js                Router.register + boot-time content fetch
    ├── router.js              Hash-free SPA router
    ├── auth.js                Auth helper (token, isAdmin via JWT decode)
    ├── config.js              Frontend-only app config (CONFIG)
    ├── world-config.js        CONFIG_WORLD — display geometry (NOT content)
    ├── state.js               Watch-progress in-memory store + persist
    ├── walker-dialogues.js    Dialogue API — pairs, defeat, victory lines
    ├── walkers.js             Walker physics + dialogue + fight engine
    ├── walkerView.js          Walker DOM + fight UI
    ├── walkers/...            (other walker render helpers)
    ├── layout.js              Map graph + road network
    ├── nodeFactory.js         Project node DOM builder
    ├── renderer.js            Map renderer
    ├── orderRenderer.js       Watch-order grid renderer
    ├── popup.js               Project popup
    ├── friends.js             Friends UI
    ├── memory.js              Memory upload UI
    ├── utils.js
    └── views/
        ├── login.js           /login
        ├── watchorder.js      /
        ├── app.js             /map
        ├── profile.js         /profile  (⚙ admin link visible to admins)
        ├── characters.js      /characters
        └── admin/
            ├── index.js       /admin shell — six tabs
            ├── users.js       Tab: Users (search, ban, reset, delete, online dot)
            ├── moderation.js  Tab: Moderation (memories grid, friend reqs)
            ├── cms.js         Tab: CMS shell — sub-tabs router
            ├── cms-projects.js
            ├── cms-characters.js
            ├── cms-locations.js
            ├── cms-dialogues.js
            ├── config.js      Tab: Config — live walker tuning sliders
            ├── audit.js       Tab: Audit Log
            └── overview.js    Tab: Overview — stats + signup chart
```

---

## Setup

### Prerequisites
- Node.js 18+
- A MongoDB Atlas cluster (free tier works) or local Mongo
- A Cloudinary account (for memory uploads)

### `.env`
```
MONGO_URI=mongodb+srv://...
JWT_SECRET=<random-32+-char-string>
CLIENT_URL=http://localhost:3000
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
PORT=3000
```

### Run locally
```
npm install
node server.js
```
Open `http://localhost:3000`. The server forces Google DNS (8.8.8.8) at startup to work around Atlas SRV resolution issues on Windows.

### One-time content seed (optional)
The CMS tab will be empty until you copy the static JS files into MongoDB:
```
node scripts/seed-content.js
```
The script is idempotent (upsert by `id`). Pass `--wipe` to reset and re-seed.

If you skip the seed: the app falls back to the static JS files via `server/contentLoader.js`. App works identically; CMS just shows empty lists.

---

## Architecture

### Client boot order
1. spa.html loads scripts in `defer` order. `js/world-config.js` and the static content files (`projects.js`, `characters.js`, `locations.js`, `js/walker-dialogues.js`) populate global vars as **fallbacks**.
2. `js/boot.js` runs last. It calls `Promise.allSettled` on `/api/content/{projects,characters,locations,dialogues}` and overwrites `window.projects` / `characters` / `LOCATIONS` and `WALKER_DIALOGUES.applyData(...)` with live DB values.
3. It also fetches `/api/config/public` and merges admin-tunable physics into `Walkers.PHYSICS`.
4. After both fetches settle, `Router.init('app')` mounts the initial view.

If any fetch fails the static globals remain — the SPA still works.

### Auth flow
- Login: `POST /api/auth/login` → JWT signed with `{ id, isAdmin, tv: tokenVersion }` and 7-day expiry.
- Every authed request hits `middleware/auth.js`:
  - JWT signature verify (cheap)
  - 30-second in-memory cache keyed on `${userId}|${tokenVersion}` to avoid hitting Mongo on every request
  - On cache miss, fetches `tokenVersion` and `banned` from Mongo; rejects with 401 if `tokenVersion` mismatch (forces re-login after ban / password reset / forced logout).
  - On success, throttled `lastActiveAt` write — at most once per minute per user.
  - Sets `Cache-Control: private, no-store` so authed responses can't leak across user accounts in the same browser tab.
- Admin gate: `middleware/requireAdmin.js` wraps `auth` then re-fetches `isAdmin` from Mongo (the JWT claim alone could be stale up to 7 days after demotion).

### Content / Mongo fallback
`/api/content/*` first reads from the corresponding Mongo collection. If the collection is empty or Mongo errors, it falls back to a cached read of the static JS files via `server/contentLoader.js` (which uses `vm.runInNewContext` with a capture epilogue trick to extract `const`-declared globals out of a sandbox).

### Admin model
Promote a user to admin by setting `isAdmin: true` on their Mongo document — there is no public path. Then re-login to mint a fresh JWT carrying the `isAdmin: true` claim.

---

## Admin panel

**Access:** `/admin` (hidden route). Visible as a ⚙ button on the `/profile` page once you have `isAdmin: true`.

| Tab         | What it does                                                                 |
|-------------|------------------------------------------------------------------------------|
| Users       | List, search, view details. Ban / unban / reset password / delete. Green dot for users active in last 5 min, relative-time "active 3m ago". |
| Moderation  | Sub-tabs: Memories grid (delete uploads — also wipes from Cloudinary), Pending friend requests. |
| CMS         | Sub-tabs: Projects, Characters, Locations, Dialogues. Per-field forms. Audit-logged. |
| Config      | Live sliders for walker speed, pause min/max, encounter dist/cooldown, fight spawn chance, plus default Fights/Dialogues toggles for new users. |
| Audit Log   | Paginated, action-filterable forensic log of every destructive admin action. |
| Overview    | Total users, banned count, memory count, and a 30-day signup bar chart.       |

**Critical security property to preserve:** the JWT carries `isAdmin` for UX gating, but `requireAdmin` re-fetches from Mongo on every admin call. Demoting an admin in the DB takes effect immediately — no waiting 7 days for their token to expire.

**`tokenVersion` rotation:** ban / unban / password reset all bump the user's `tokenVersion`. The auth middleware compares JWT's `tv` to the stored value; mismatch = 401. This logs out every other tab/device the user has open.

---

## Common operations

### Promote yourself to admin
In MongoDB Atlas Data Explorer → `mcu-tracker` → `users`:
- Find your user by username
- Edit the document, add field `isAdmin` of type `Boolean` set to `true`
- Save
- Log out of the app and log back in (so a fresh JWT carries the claim)

### Seed/reseed content
```
node scripts/seed-content.js          # upsert (safe to re-run)
node scripts/seed-content.js --wipe   # drop collections then re-seed
```

### Deploy to Render
- Push to the connected branch → Render rebuilds automatically.
- No new env vars required for Phase 2 / 3 — same `MONGO_URI`, `JWT_SECRET`, `CLOUDINARY_*`.
- Render filesystem is ephemeral, so the static fallback JS files (which live in the repo) survive across deploys; the seed script needs to be run pointing at the production Mongo URI:
  ```powershell
  $env:MONGO_URI = "<production-mongo-uri>"
  node scripts/seed-content.js
  Remove-Item Env:\MONGO_URI
  ```

### Backups
- Atlas free tier has continuous backup with point-in-time restore (default-on; check the Backup tab).
- Static JS files in the repo are an additional last-resort fallback for content (not for users / audit / memories).

---

## Known constraints & gotchas

- **Render filesystem is ephemeral.** Anything written to disk at runtime vanishes on the next deploy. All persistent state must be in Mongo or Cloudinary.
- **Boot-time content fetch adds ~100ms** before the first view mounts. On a healthy server this is invisible; on a cold start it's brief but noticeable. If it ever becomes an issue, the static globals remain available and we could render against them first, then re-render after fetch.
- **`Object.freeze` on PHYSICS was dropped in Phase 2.** Don't restore it — `Walkers.applyConfig` mutates sub-objects.
- **`const` → `var` in the static content files (projects.js / characters.js / locations.js).** Don't change back. boot.js reassigns these globals after the content fetch resolves.
- **CMS edits do not propagate back to the static JS files.** Once you start editing via the admin UI, the JS files become a stale snapshot. There is no automatic export-to-JS-files job (could be built later as `scripts/export-content.js`).
- **MongoDB SRV lookup fails on default Windows DNS.** Both `server.js` and `scripts/seed-content.js` force Google DNS (`8.8.8.8`) at startup to work around this.
- **`isAdmin` is set manually in MongoDB.** No promote-from-UI flow exists by design — there's no public path to admin.

---

## Pending / not built

- `scripts/export-content.js` to snapshot CMS edits back into the static JS files (for version-controlled disaster recovery of content). Mentioned in the original plan, deferred.
- An automated test suite. Currently `npm test` is a stub.
- A CI pipeline.

---

## Changelog

Append new entries at the **top** of this section. Use the format:

```
## YYYY-MM-DD — short title
Brief summary of what changed and why.
- file/path:line — what changed
```

---

### 2026-05-02 — Centralized auth gate in the router

Hardened the "no tab is reachable until you log in" guarantee. Previously each view checked `Auth.isLoggedIn()` at the top of its own `mount()`. That worked but every new view had to remember to add the check, and a brief redirect dance happened mid-mount. The router now blocks unauthorized navigation up front.

- `js/router.js` — new `PUBLIC_ROUTES` set (just `/login` for now). Gate inside `navigate()` rewrites the path to `/login` whenever a non-public route is requested without a session. Uses `history.replaceState` so the unauthorized URL doesn't sit in browser history.
- Per-view `Auth.isLoggedIn()` checks left in place as defense-in-depth (no-op once the router gate runs first; preserves protection if a view is ever mounted directly without going through `navigate`).



Mirrored all four MCU content datasets (projects, characters, locations, walker dialogues) to MongoDB so admins can edit content without redeploying. Static JS files retained as Mongo-down fallback.

- Added: `models/{Project,Character,Location,Dialogue}.js` — schemas mirroring the JS-file shapes.
- Added: `server/contentLoader.js` — boot-time `vm.runInNewContext` extraction of `const`-declared globals from the static JS files; surgical IIFE rewrite for `walker-dialogues.js`.
- Added: `routes/content.js` — public `GET /api/content/{projects,characters,locations,dialogues}` with `source: 'db' | 'fallback'` indicator.
- Added: `routes/admin.js` content CRUD endpoints under `/api/admin/content/*`.
- Added: `scripts/seed-content.js` — idempotent upsert of static files into Mongo.
- Added: `js/views/admin/cms.js` + four `cms-*.js` editor modules with per-field forms, project / character dropdowns, dynamic stage / exchange lists.
- Added: `js/world-config.js` — `CONFIG_WORLD` extracted from `locations.js`.
- Modified: `projects.js`, `characters.js`, `locations.js` — `const` → `var` so boot can overwrite.
- Modified: `js/walker-dialogues.js` — three internal data objects switched to `let`, new `applyData(data)` setter exposed on the IIFE return.
- Modified: `js/boot.js` — boot-time `/api/content/*` fetch via `Promise.allSettled` before `Router.init`.
- Modified: `spa.html` — `js/world-config.js` script tag added; six new admin CMS scripts wired in.

### 2026-05-02 — Account-switch caching audit + fixes

Found two real issues during account-switch audit. Added `Cache-Control: private, no-store` to authed responses; clear per-user localStorage on logout.

- `middleware/auth.js` — set `Cache-Control: private, no-store` on every authed response (both cache hit & miss branches) to prevent any browser/proxy from serving User A's response to User B in the same tab.
- `js/auth.js` — `Auth.logout()` now also removes `mcu_walkers` and `CONFIG.STORAGE_KEY` (watch progress) so the next login in the same tab doesn't briefly inherit the previous user's data. Per-device prefs (`mcu_fights_enabled`, `mcu_dialogues_enabled`) intentionally kept.

### 2026-05-02 — Phase 2: Live walker tuning + presence

Admin can tune walker physics (speed, pause, encounter distance/cooldown, fight spawn chance) and the global Fights/Dialogues default toggles without redeploying. Users tab shows online dots and "active 3m ago"-style timestamps.

- Added: `models/AdminConfig.js` — singleton config doc with min/max validators.
- Added: `routes/config.js` — public `GET /api/config/public` returning current physics + flags.
- Added: `routes/admin.js` config endpoints — `GET/PUT /api/admin/config`, `POST /api/admin/config/reset`.
- Added: `js/views/admin/config.js` — six sliders + two toggles, debounced live readouts, audit-logged save with diff.
- Modified: `js/walkers.js` — dropped `Object.freeze(PHYSICS)`; added `Walkers.applyConfig(cfg)` and `Walkers.applyFlagDefaults(flags)`.
- Modified: `js/boot.js` — fetch `/api/config/public` at boot and apply.
- Modified: `models/user.js` — added `lastActiveAt: Date` (indexed).
- Modified: `middleware/auth.js` — throttled `lastActiveAt` write (max once per minute per user).
- Modified: `js/views/admin/users.js` — green dot for users active in last 5 min, relative-time meta line.
- Server: `/api/config` mounted with its own modest IP-keyed limiter (60/min).

### 2026-05-02 — Phase 2 bug fix: admin page wouldn't scroll

`body { overflow: hidden; height: 100vh }` clipped the admin page's bottom content (notably the user detail panel below the fold).

- `styles.css` — `.admin-page` now has its own `height: 100dvh; overflow-y: auto` scroll container.
- `js/views/admin/users.js` — `openDetail` calls `scrollIntoView({ behavior: 'smooth', block: 'start' })` so the panel slides into view instead of expecting the user to scroll.

### 2026-05-02 — Phase 1: Admin panel MVP

Hidden `/admin` route gated by `isAdmin` boolean on the user document. Tabs: Users, Moderation, Audit Log, Overview.

- Added: `models/user.js` fields — `isAdmin`, `banned`, `bannedAt`, `banReason`, `tokenVersion`. Mongoose `timestamps: true` for signup-trend analytics.
- Added: `models/AuditLog.js` — `{actor, action, target, meta, ip, createdAt}`, indexed on `(action, createdAt)` and `(actor, createdAt)`.
- Added: `middleware/requireAdmin.js` — composes auth, then DB re-check of `isAdmin`.
- Added: `routes/admin.js` — users CRUD + ban/reset/delete; memories list + delete (with Cloudinary destroy); pending friends moderation; audit log; overview analytics.
- Added: `js/views/admin/{index,users,moderation,audit,overview}.js` — tabbed shell + per-tab editors. Shared `AdminView.api()` wrapper handles 401/403, toast notifications.
- Added: ⚙ admin link button in `/profile` header for admins.
- Modified: `routes/auth.js` — JWT now carries `{id, isAdmin, tv}`; banned users get 403 at login.
- Modified: `middleware/auth.js` — 30-second validation cache keyed on `${userId}|${tokenVersion}`; rejects on tokenVersion mismatch (forces re-login after ban / password reset / forced logout).
- Modified: `server.js` — `/admin` added to SPA route list; `/api/admin` mounted with tighter 60/min limiter behind `requireAdmin`.
- Styles: full admin theme appended to `styles.css` matching the dark/gold palette; mobile breakpoint at 480 px.

---

## How to update this doc

When you ship a feature or fix a bug:

1. Add a new entry at the **top** of the Changelog section.
2. Use heading format `### YYYY-MM-DD — short title`.
3. One-paragraph summary, then a bullet list of the concrete file/path changes.
4. If the change adds new constraints or gotchas, also update the **Known constraints & gotchas** section.
5. If the repo layout changed, also update the **Repo layout** section.
6. Don't delete old changelog entries — they're the project's history.
