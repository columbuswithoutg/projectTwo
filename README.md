# MCU Tracker

A full-stack MCU watch-order tracker with an animated world map, friend system, character "walkers" that roam the map and have dialogue exchanges, user-uploaded memories, and a hidden admin panel for moderation, user management, live walker tuning, and content editing.

This document describes the **current state** of the project. The Changelog at the bottom is the running record of changes — append a new entry every time a feature ships or a bug is fixed.

---

## Tech stack

| Layer       | Tech                                                                 |
|-------------|----------------------------------------------------------------------|
| Backend     | Node.js + Express 5 + Mongoose + helmet + compression                |
| Database    | MongoDB Atlas (free tier, cluster name: `Columbus`)                  |
| File store  | Cloudinary (user memories — images & video)                          |
| Auth        | JWT (7-day expiry) + bcryptjs                                        |
| Frontend    | Vanilla JS SPA (no framework)                                        |
| Build       | esbuild via `scripts/build.mjs` — concat + minify into hashed chunks |
| PWA         | `manifest.json` + `sw.js` — installable, offline shell               |
| Hosting     | Render.com                                                           |

---

## Repo layout

```
projectOne/
├── server.js                  Express app entry — routes, rate limits, static allowlist, helmet, compression
├── manifest.json              PWA manifest (name, icons, theme color, start_url)
├── sw.js                      Service worker TEMPLATE → dist/sw.js (version + precache filled by the build)
├── package.json
├── dist/                      BUILD OUTPUT (gitignored): static/{core,world,admin}.<hash>.js,
│                              styles.<hash>.css, three-shim.<hash>.js, spa.html, sw.js
├── .env                       MONGO_URI, JWT_SECRET, CLOUDINARY_*, CLIENT_URL
├── README.md                  ← this file
│
├── projects.js                Static fallback: 71 MCU projects (data, var-declared)
├── characters.js              Static fallback: 131 MCU characters
├── locations.js               Static fallback: 36 world-map locations
├── auth.js                    Login-page script (bound to index.html)
├── index.html                 Login page
├── spa.html                   SPA shell TEMPLATE → dist/spa.html (build fills stylesheet, chunk manifest, core script)
├── styles.css                 Single global stylesheet (~7300 lines; minified + hashed by the build)
│
├── models/                    Mongoose schemas
│   ├── user.js                username, password, watchedProjects, walkers,
│   │                          isAdmin, banned, tokenVersion, lastActiveAt,
│   │                          homeCharacter (4-slot layered-SVG config)
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
│   ├── contentLoader.js       vm.runInNewContext loader of static JS files,
│   │                          used as the Mongo-down fallback for /api/content/*
│   ├── feed.js                Feed post creation/merge helpers (server-side only)
│   └── friendship.js          friendFilter() / getFriendIds() — the ONE place the
│                              "accepted friend incl. legacy type-less docs" query lives
│
├── scripts/
│   ├── build.mjs              Client build → dist/ (`npm run build`; `--watch --serve` = `npm run dev`)
│   ├── seed-content.js        Idempotent seed: JS files → Mongo (run once)
│   ├── export-content.js      Inverse: Mongo → static fallback files (--dry-run)
│   ├── optimize-images.mjs    Shrink assets/characters + assets/images in place (--dry-run)
│   ├── build-humanoid-assets.mjs  Raw Quaternius glTF → assets/models/humanoid/v1
│   └── audit-humanoid-assets.mjs  Report on the built humanoid assets
│
├── test/                      node --test unit tests (npm test) — no Mongo needed
│   ├── physics.test.js        3D physics helpers
│   ├── humanoid.test.js       humanoid rig logic
│   ├── npc.test.js            /world NPC patrol logic
│   ├── world-chat.test.js     /world chat channels
│   ├── friendship.test.js     server/friendship.js filter shapes + getFriendIds
│   └── auth-middleware.test.js middleware/auth.js (JWT, tokenVersion, ban, cache)
│
├── docs/
│   └── VOICE-TURN-SETUP.md    5-minute TURN relay setup for cross-NAT voice
│
├── .github/workflows/ci.yml   CI: npm ci (runs the build) + node --check sweep + npm test
│
└── js/
    ├── boot.js                Instant mount from fallbacks + background content refresh; lazy routes
    ├── chunk-loader.js        Chunks.load(name) — injects a lazy chunk's <script>s from the manifest in dist/spa.html
    ├── three-shim.mjs         ES module: imports three from unpkg, exposes window.THREE (loaded with the world chunk)
    ├── router.js              Hash-free SPA router
    ├── auth.js                Auth helper (token, isAdmin via JWT decode)
    ├── theme.js               Light/Dark/System theme manager (see profile toggle)
    ├── playground3d-physics.js Pure jump/fall/walkability math (unit-tested)
    ├── playground3d-avatar.js  Avatar mesh builders + shared geometry cache + hero-gear material
    ├── playground3d-input.js   Keyboard / mouse / touch / joystick input for the 3D views
    ├── playground3d-occlusion.js See-through walls/roofs between the camera and the player
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
    ├── playground.js          /home engine — layered-SVG character + RAF loop
    └── views/
        ├── login.js           /login
        ├── watchorder.js      /
        ├── app.js             /map
        ├── profile.js         /profile  (⚙ admin link visible to admins)
        ├── characters.js      /characters
        ├── home.js            /home — playground shell
        ├── home-builder.js    /home character builder modal
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
npm install          # also builds dist/ (postinstall)
npm run dev          # build, watch js/ + styles.css + templates, and start server.js
```
Open `http://localhost:3000`. Edits rebuild in ~300 ms; reload to pick them up. `npm start` (= `node server.js`) serves an existing build without watching — run `npm run build` first. The server forces Google DNS (8.8.8.8) at startup to work around Atlas SRV resolution issues on Windows.

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
1. `dist/spa.html` loads the **core chunk** (deferred). Inside it, `js/world-config.js` and the static content files (`projects.js`, `characters.js`, `locations.js`, `js/walker-dialogues.js`) populate global vars as **fallbacks**. The 3D views, sockets and voice (`world` chunk) and the admin panel (`admin` chunk) are fetched by `js/chunk-loader.js` the first time their route is visited; the Three.js module shim loads with the world chunk, so `/login` and the 2D views never wait on unpkg.
2. `js/boot.js` runs last. It calls `Promise.allSettled` on `/api/content/{projects,characters,locations,dialogues}` and overwrites `window.projects` / `characters` / `LOCATIONS` and `WALKER_DIALOGUES.applyData(...)` with live DB values.
3. It also fetches `/api/config/public` and merges admin-tunable physics into `Walkers.PHYSICS`.
4. `Router.init('app')` mounts the initial view immediately against the fallbacks; when the content fetch reports a change, `/`, `/map` and `/characters` remount.

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

### Adding a character or poster image
Drop the file into `assets/characters/` or `assets/images/`, reference it by filename in `characters.js` / `projects.js` (or the CMS), then run:
```bash
node scripts/optimize-images.mjs
```
It rewrites only files that get at least 10% smaller (characters ≤600px, posters ≤800px on the long edge, JPEG q82) and keeps names and extensions, so nothing else changes. `--dry-run` reports without writing.

### Deploy to Render
- Push to the connected branch → Render rebuilds automatically.
- Set the service's **Health Check Path** to `/api/health` — it returns 503 while Mongo is disconnected, so Render recycles a wedged process instead of leaving it serving 500s.
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
- **The client is a build artefact.** `server.js` serves `dist/` and refuses to start without `dist/spa.html`. `spa.html` and `sw.js` in the repo root are templates; `js/*.js` are sources and are no longer served over HTTP. Adding a JS file means adding it to the right chunk list in `scripts/build.mjs`, in dependency order. Chunks are plain concatenations minified with `esbuild.transform` — **never switch to `bundle`/`format`**: the files share state through top-level declarations and `boot.js` reassigns `window.projects` etc., which any bundle format would scope away. The build's global-name assertion exists to catch exactly that.
- **Service worker cache invalidation is automatic.** `dist/sw.js` gets `CACHE_VERSION` from the hash of the build outputs, so any change to any built file rolls the cache — no manual bumps. `/dist/*` is cache-first (hashed names), `/assets/*` stale-while-revalidate (held open with `waitUntil`), `/api/*` and `/socket.io/*` never cached. A tab left open across a deploy that then asks for a lazy chunk whose hash is gone gets one full reload (`_reloadOnce` in `js/router.js`).
- **Render must run the build.** The default Build Command (`npm install`) triggers `postinstall` → `npm run build`; if the Build Command is ever customised keep `npm run build` in it. Start Command: `npm start`.
- **`trust proxy` is set to 1** (one hop: Render's load balancer). `req.ip` and every rate limiter key off `X-Forwarded-For`. If another proxy layer (e.g. Cloudflare) is ever added in front of Render, raise the hop count in `server.js` or the limiters collapse back into one shared bucket.
- **Helmet CSP is ENFORCED** (since 2026-07-07) with an allowlist covering the inline importmap, unpkg.com (Three.js), Cloudinary, Google Fonts, websockets, and data:/blob: images. **Adding any new external source requires extending the allowlist in server.js first** or first paint will brick. Other security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, HSTS, COOP, CORP=cross-origin) are on.
- **`index.html` + root `auth.js` are a stale legacy login page** (since 2026-08-06). The in-app router rewrites `/index.html` → `/` and `/login` always serves `spa.html`, so nothing in normal navigation reaches them — but a direct request for `/index.html` still gets served statically (`server.js` `ROOT_FILES`) and runs the old, un-animated register/login script. `js/views/login.js` is the live implementation; keep new auth UX changes there, not in the legacy file.

---

## Pending / not built

- TURN credentials for cross-NAT voice: the code is fully wired; create a
  provider account and set `TURN_URLS`/`TURN_USERNAME`/`TURN_CREDENTIAL`
  (see `docs/VOICE-TURN-SETUP.md`).
- Broader test coverage — client logic modules, auth middleware and the
  friendship helper are covered; home-layout validation and the admin
  sanitisers are the next targets.

---

## Changelog

Append new entries at the **top** of this section. Use the format:

```
## YYYY-MM-DD — short title
Brief summary of what changed and why.
- file/path:line — what changed
```

---

### 2026-09-23 — Realistic body: every hair style, facial-hair style and eye shape

The second parity pass. The realistic body squeezed 14 hair styles onto 5 pack meshes (Spiky, Curly and Side-part looked the same; so did Cap, Mohawk and Buzz), drew one full beard for all five facial-hair styles (in the hair colour, ignoring `facialHairColor`), and ignored eye shape. Now every option has its own look:
- **Hair** (`hairSpec` in `js/playground3d-humanoid-logic.js`): each style is a pack mesh, optionally clipped to part of the head (Bob = Long cut at the jaw, Undercut = Side-part top only, bare sides), plus smooth procedural pieces built by `_hairExtras` in `js/playground3d-humanoid.js`: spikes, a mohawk crest along the scalp's centre line, a bumpy afro set back from the face, ringlet curls, a tapered ponytail with a tie, a topknot bun, and the "Cap" as a smooth bowl cut at the brow. They sit on a skull ellipsoid fitted to each body's own head vertices above eye level (`variant.skull`): an estimate from the head's bounding box floated the mohawk off the back of the head.
- **Facial hair** (`beardSpec`): Stubble is the beard mesh at 40% opacity, Mustache / Goatee are clipped regions of it, Chinstrap keeps what lies below a line rising from the chin to the ears (the new `under` region), Beard is whole. It takes `facialHairColor` like the Box body. Hair clipping is `_addHairClip` (the same bind-pose planes as the clothing shells); `setOpacity` now multiplies a material's `baseOpacity`, so a fade-in doesn't make stubble solid.
- **Eye shape** (`eyeShapeFor`, `EYE_SHAPE_VERT`): the faces are sculpted, so Narrow / Wide / Sharp / Soft reshape the lids and eyeballs in the vertex shader around each eye (centres measured per body in `variant.eyes`): scale about the eye centre and, for Sharp / Soft, lift or drop the outer corner only. The brows are mostly left alone (tilting them read as a frown). Round is the model as sculpted. The schema's `realistic: 'unsupported'` flag and SLOT_MAP's `unsupported` kind are gone.
- Checked on the male, female and Huge bodies in /customize thumbnails and in /world.
- Tests: `test/humanoid.test.js`: 14 distinct hair specs (Bald = none), 5 distinct beard specs, eye-shape directions.
- **Still different from Box:** the Neutral and Masculine genders share the male model on Realistic.

### 2026-09-23 — Props alignment, realistic body gets every Box clothing style

**Sit / lie alignment.** Lying in a bed turned 90° laid the body across it (the old known bug below): `_applyPose` and `_applyDownPose` in `js/playground3d.js` now set `root.rotation.order = 'YXZ'`, so the tilt is about the body's own sideways axis after the yaw. The body also lies from the bed's foot edge (`_sitOn`, offset 0.85 → 1.0); at 0.85 the head poked ~0.2 past the headboard on both body types. Verified in /world on beds and chairs at all four facings, Realistic and Box.

**Clothing parity (Realistic catches up to Box).** The realistic body used to paint clothes as flat colour, so every shoe style looked the same, as did most shirt / trouser styles, and all four accent colours were ignored. It now builds a counterpart for each Box piece:
- **Region shells** (`js/playground3d-humanoid.js`): the jacket/armour "shell" (a copy of the body surface pushed out slightly, so it bends with every animation) can now be clipped to a patch by up to 6 planes in bind-pose body space (`_regionPlanes`, `uPlanes` / `uRegionPart` / `uRag` in `_shellMaterial`), optionally only on some parts. `setGarments` builds `spec.details` through the shared `_addShell`. Limb pieces are bounded by height, not by how far along the bone they sit: triangles straddling the knee mixed the two bones' values and leaked slivers.
- **Which piece each style gets** (`detailsFor` in `js/playground3d-humanoid-logic.js`, unit-tested): sneaker sole (accent or white), hi-top collar, boot shaft (+ accent cuff), dress shoe (gloss + dark sole), heel sole, sandal sole + strap (bare foot); loose Pants vs skin-tight Slim, cargo pockets, jogger cuffs, greaves; hoodie pocket, polo collar, V-neck, turtleneck, jersey stripe (accent or white), ripped-shirt hem + shoulder flaps; outerwear front seam (accent or near-black), bomber hem; bodysuit seam + belt, robe front panel, jumpsuit collar + belt. The engine resolves the colour lists in `_lookFor`, where an accent on Auto falls through to the same default the Box body uses.
- **Real geometry** (`_attachRealisticGear`): heel blocks on the foot bones, a smooth hood for the Hoodie top and the hooded jacket, and a bow tie on a Polo with an accent colour. `handle.partBox(name)` and `foot.L` / `foot.R` anchors let them size and place themselves.
- **Fixes:** a jacket / bomber / trench / vest hem is now straight at the waist (the torso/pelvis border was stair-stepped and read as torn); legs under a trench coat keep their trousers (they were bare); a stored Skirt trouser style under a suit no longer builds a skirt; Fingerless gloves stop at the knuckles.
- **Left as is (judgment calls):** outerwear over a suit still shows on Realistic (Box drops everything but a cape; the realistic behaviour is tested and the customizer allows the combination); Armor keeps its own two-tone layout. Hair, beard styles, eye shape and the Neutral/Masculine body are a planned second pass.
- Tests: `test/humanoid.test.js` — detail kinds per shoe / trouser / top / outerwear / suit style, accent fallbacks, no skirt under a suit.

### 2026-09-23 — Security + bug fix pass, mobile screen lock

From a full code review. Security and data-loss fixes first, then bugs, then the mobile "whole app drags / zooms / turns blue" problem.

- **Caption XSS** — `esc()` in `js/utils.js` now escapes `"` and `'` too; it was used inside `alt="…"` / `src="…"`, so a friend's memory caption could inject an `onerror` handler. `routes/progress.js` `sanitizeMemory` also rejects memory URLs containing quotes, `<`, `>` or whitespace.
- **Home rooms need friendship** — `home:join` in `routes/world-socket.js` now requires the owner or an accepted friend (`friendFilter`), matching `GET /api/friends/by-username`. Before, any logged-in user could join, chat and join voice (exposing peers' IPs).
- **No more progress wipe** — `js/state.js`: a logged-in user whose `/progress/load` fails no longer falls back to (empty) localStorage; `loadFailed` blocks saves and `clear()` until a successful load, with a toast. Save failures now show a toast instead of only `console.warn`.
- **Dependencies** — `npm audit fix` (multer, socket.io-parser, ws, path-to-regexp, mongoose, qs, body-parser …). Left: `cloudinary` < 2.7 (needs a breaking v2 upgrade, and `multer-storage-cloudinary@4` targets v1).
- **Chat spam floor** — every `/world` chat channel (incl. project and whisper) now has the same 750 ms per-player floor as the DM route (`MessagingLogic.C.SEND_FLOOR_MS`, `p.lastAnyChat`); the 10 s world cooldown is unchanged.
- **Leaving a page mid-load** — `js/views/home.js` (`_loadSeq`) and the four `js/views/friend-*.js` views (`_mountSeq`) bail after each await once unmounted; `FriendView.enter` has an `_enterSeq` that `exit()` bumps, and the router now calls `exit()` whenever it leaves `/friend/*` (not only when already active), so a late response never swaps a friend's data into your own view.
- **Usernames** — register rejects a name that matches an existing one case-insensitively ("bob" next to "Bob"). Existing duplicate pairs, if any, are untouched.
- **Friend requests** — a `rejected` request no longer blocks the pair from requesting again (`routes/friends.js`).
- **Admin cleanup** — deleting a user also deletes their `ProjectStay` rows (no ghost house keepers); deleting a memory also removes it from feeds (`feed.removeMemory`) and invalidates the Cloudinary CDN copy.
- **Voice mesh leak** — `leaveHomeVoice()` in `routes/world-socket.js` removes a socket from `voiceHomes` (and sends `voice:peer-left`) on `home:leave`, home switch, retired duplicate tab and disconnect.
- **Fetch errors** — memory delete in `js/popup.js` only removes the memory on screen after the server confirms (toast otherwise); `js/profile.js` `loadProfile` checks `res.ok`.
- **Mobile screen lock** (`styles.css`, `js/boot.js`) — `* { touch-action: pan-x pan-y; -webkit-tap-highlight-color: transparent }` turns off browser pinch / double-tap zoom and the blue tap flash while keeping one-finger scrolling; the in-app zoom surfaces keep their own more specific `touch-action`. `body` gets `overscroll-behavior: none` and `user-select: none` / no long-press callout; inputs, chat lines, DM bubbles and feed captions opt back into selection. `html` is clipped (`overflow: hidden`, except the legacy login page) so the app can't slide sideways; scroll panels get `overscroll-behavior: contain`. `gesturestart` / `gesturechange` are cancelled for iOS Safari, which ignores `user-scalable=no`.

### 2026-09-22 — Houses round 2: admin prop cap, wall-hugging props, shelf runs, standable props, bed, sit / lie, spawn at your house

- **Admin-editable prop cap** — `world.maxProps` (default 20, 1..60) in `models/AdminConfig.js` (+ `defaults()`), `CONFIG_RULES` in `routes/admin.js`, the public reshape in `routes/config.js` (→ `window.APP_WORLD.maxProps`), a slider in `js/views/admin/config.js`. `validateHouse(raw, { maxProps })` keeps the shared module pure; `routes/world.js` validates the PUT against a fresh read (`maxPropsNow`) and returns the cached value on `GET /houses`; **reads never truncate** (`toHouse` uses the grid size as the cap — an over-cap doc used to vanish entirely). The editor counts against the server's value, previews an over-cap legacy house and refuses Save until enough props are removed.
- **Props hug walls** — every solid prop on an edge cell slides flush to that wall (`wallHug` + the generalised slide in `_buildProps`); `WALL_BACKED` (bookshelf, chair, bed) also turn their back to it.
- **Bookshelf runs** — `propRuns(props, 'bookshelf')` groups adjacent shelves with the same facing; `_buildProps` builds one object per run `cells × 1.0` wide (`PG3DProps.make('bookshelf', { width })`, bays laid out per metre) with one collision box; the plan draws a joined outline.
- **Standable props** — collision boxes carry `top` (chair .53, table / crate .80, bookshelf 1.805, bed .60; plant / lamp stay blockers). `PG3DPhysics.groundAt` / `blocksAt` / `stepVertical(..., floorY)`: a box stops blocking once the feet are within `STEP` (0.25) of its top, the tick integrates against the ground under the feet (jump from / land on a prop, walk off and fall), `_lastSafe` is never recorded on a prop, teleports land on `groundAt`, remote "airborne" is measured from the ground under the peer.
- **Bed** — new prop kind, two cells (anchor = headboard cell, foot cell along the facing: `PROP_SPAN`, `propCells`, `propCentreOffset`); `canPlaceProp` (frame snap + forced facing first, then cap / bounds / overlap over every cell, `skipIndex` for rotate) is shared by `validateHouse` and the editor, which draws the bed across both cells and turns it to the first free facing.
- **Sit / lie** — `E` (or the touch 🪑 button, `.pg-sit`, shown only near a chair / bed) snaps the player onto the nearest chair (hips at seat height, facing the chair's way) or bed (on the mattress, head at the headboard, root tipped onto its back); any movement / jump / punch / knockdown stands them up on the first free side. `_seat`, `_sitOn`, `_standUp`, `_scanSeats`, the "Sit (E)" pill (`.pg3d-seatprompt`). Poses: `_applyPose` (eased weight on `root.userData`) hand-poses box bodies; rigged bodies get `handle.setPose('sit')` — a third offset layer in `js/playground3d-humanoid.js` (`_sitOffsets`: thighs −90°, shins +90°) — and `selectAnimState({ pose })` pins the base to idle. The pose rides on `world:pos` (`pose: 'sit' | 'lie' | null`, sanitised server-side, on the join record so snapshots carry it); remote peers render it with speed 0.
- **Spawn at your house** — `_fetchHouses` runs alongside the character fetch; the spawn picker (`_openSpawnPicker(islands, mode, { houses })`) lists "Your houses" (🔑 + stay) before the islands whenever you keep one on a visible island; the pick is remembered in `localStorage.world_spawn_pref` and preselected next time; `_applyHouses` pushes decorations after `initWorld`.
- Tests: `test/world-house.test.js` (cap override, bed cells, `canPlaceProp`, `propRuns`, `wallHug`), `test/physics.test.js` (standable props), `test/humanoid.test.js` (pose state).
- **Known bug (fixed 2026-09-23, see that entry):** lying in a bed whose `rot` is 1 or 3 (bed running along X) lays the body *across* the bed. `_applyPose` writes `root.rotation.x` while the root keeps three.js's default Euler order `XYZ`, so the tilt is about world X, not the body's own sideways axis; only rot 0 / 2 beds look right (that is all the verification tested). `_applyDownPose` (knockdown) has the same latent flaw. Fix by giving character roots `rotation.order = 'YXZ'` (or composing yaw × tilt as a quaternion) and test every pose at all four facings.

### 2026-09-22 — House editor: roof shapes, wall finishes, window placement

The keeper's **Edit house** panel now restyles the building itself, not just its colours: a roof shape (flat slab / gable with a ridge running E–W or N–S / hip pyramid, plus an optional chimney), a wall finish (plaster / brick / stone / timber — all tinted by the wall palette colour), a window style (cross / grid / plain / shutters), and **where the windows go**. The floor plan grew a wall ring around the 10×10 floor: pick 🪟 and tap a wall cell to put a window there, tap it again to select / remove it, or press **Auto** to go back to the engine's one-window-per-long-wall default. **The door is not editable and never will be**: its side, position and width come from the roads (`_doorwayOnSide` + the clip/merge now in `_sideOpenings`), it is drawn on the plan as a locked 🚪 cell, and a window that would touch it is refused by the editor and skipped by the engine (the same `windowBlocked` rule on both ends). Undecorated houses look exactly as before.

- `js/world-house-logic.js` — `ROOF_STYLES` / `WALL_STYLES` / `WINDOW_STYLES` / `SIDES`, new house fields `roofStyle`, `roofDir`, `chimney`, `wallStyle`, `windowStyle`, `windows` (`null` = auto, else `[{ side, pos }]` ≤ 8, no duplicate cells), `windowSpan` / `windowBlocked` / `openingsToCells` / `autoWindowCentres` / `canPlaceWindow` — all in edge-offset units along a wall so the editor and engine share one door test.
- `js/playground3d-house.js` (new, `PG3DHouse`, UMD) — cached white-based wall textures per finish (Lambert map × colour can only darken, so joints stay white and block bodies go darker; one 2 u × 1 u tile, repeat both ways), cached window-glass textures per style, `roofExtra` (gable prism / hip pyramid as explicit triangle soup with auto-outward winding, gable ends in the wall material, trim fascia, brick chimney; shares the slab's roof material and only disposes what it owns), `roofHeightAt`.
- `js/playground3d.js` — `_sideOpenings(node)` factored out of `buildSide` and exported as `getHouseLayout(projectId)` (door openings per side, edge-offset units); the window carve handles any number of panes per segment (fillers between panes, sill + header each, one full-segment collision box as before) and shutters as trim decor; `_anchorWallUVs` rewrites every wall panel's UVs from world position so brick courses run unbroken through the fillers / sill / header around a window; `_applyRoof` builds / tears down `node.roofExtra` and records `node.roofTopY`; `_tickRoomCeilings` hides the pitched part with the slab; keeper tags anchor above `roofTopY`. `_wallTexture` / `_makeWindowGlass` moved into `PG3DHouse`.
- `js/views/world.js` — style chip rows (Roof + Ridge + Chimney, Walls, Windows + Auto) above the swatches; the 12×12 plan with wall ring, locked door cells, greyed auto-window preview, selectable windows, the 🪟 kind chip, plain-English refusals from `canPlaceWindow`. The 30 s house poll no longer wipes the live preview of the island being edited (`_houseEditing`).
- **Double windows + glass walls**: adjacent window cells on one wall merge into a single wide pane (`windowRuns`: width = cells − 1 + 1.5 u, the glass texture repeats once per cell so it reads as two framed panes; shutters only at the ends). The spacing rule is gone — only duplicates are refused. New wall finish `glass`: every wall panel (and gable end) is a translucent pane (`PG3DHouse.glassWallMaterial`, keeper wall colour as tint or pale sky, no shadows); no windows are carved on glass walls and the editor dims the window controls.
- **Props**: the cap is now 20 per house (`C.MAX_PROPS`, was 8 — plenty of furniture, well short of the 100 cells). Wall-backed props (`WALL_BACKED`, currently the bookshelf) placed on an edge cell of the grid turn their back to that wall (`wallSideOfCell` / `wallBackedRot`, forced by `validateHouse` so the server agrees) and `_buildProps` slides them flush against the wall's inner face; the editor's Rotate tool explains why they won't turn. Anywhere else they stand free.
- **House showcase while editing** — the keeper edits from *inside* the house, where its roof is hidden, so roof changes were invisible. While the editor is open the camera now circles the house from outside (`Playground3D.setHouseShowcase` / `clearHouseShowcase`: `_updateCamera` orbits the platform at 24 u, `_tickRoomCeilings` keeps that house's roof on, occlusion fading is paused so the walls between the outside camera and the player don't go see-through). On wide screens the panel docks right so the house stays in view; **👁 Look at the house** hides the panel and backdrop, the **✏️ Back to editing** pill restores it.
- `models/WorldHouse.js`, `routes/world.js` — the six new fields (`windows` is `Mixed` so `null` and `[]` both round-trip); `HOUSE_FIELDS` extended. Validation is unchanged: the shared `validateHouse`.
- `styles.css` — `.world-house-chip*`, `.world-house-wall(.locked)`, `.world-house-corner`, `.world-house-window(.auto/.selected)`. `scripts/build.mjs` — new file in the `world` chunk, `PG3DHouse` in `EXPECT_ATTACHED`.
- Tests: `test/world-house.test.js` (enums, coercion, window rules, door helpers), `test/house-geometry.test.js` (new, `roofHeightAt`).

---

### 2026-09-22 — Landscape phones: two-thumb HUD, rotate hint, fullscreen + lock, FOV by aspect

`/home`, `/world` and friend homes (all one `Playground3D` engine) were portrait-first; held sideways, the HUD was just the portrait layout squashed into ~375px of height. Landscape is now the natural way in on every phone, degrading per platform because no phone can be *forced*: iPhone Safari has neither element fullscreen nor `screen.orientation.lock`, and Android only honours `lock()` once the document is fullscreen.

| | Landscape HUD | Rotate hint | Fullscreen button | Landscape lock |
|---|---|---|---|---|
| Android (Chrome / Samsung / Firefox) | ✓ | ✓ | ✓ | ✓ after fullscreen (also in the installed PWA) |
| iPhone Safari / PWA | ✓ | ✓ | hidden (unsupported) | unsupported |
| iPad Safari | ✓ when the touch HUD shows (≤768px) | no (phones only) | ✓ | rejects, swallowed |
| Desktop | unchanged | no | no (CSS-gated) | — |

- `js/pg-orientation.js` (new, `PGOrientation`, world chunk before `playground3d.js`) — `attach(stage, { onResize })` / `detach()`: the `.pg-fullscreen` button (created only when `document.fullscreenEnabled || webkitFullscreenEnabled`; `requestFullscreen({navigationUI:'hide'})` → `screen.orientation.lock('landscape')` after the promise resolves, all rejections swallowed; exit unlocks; detach exits fullscreen if we entered it, so leaving `/world` never strands you locked), the one-time `.pg-rotate-hint` pill on portrait phones (`(pointer: coarse) and (orientation: portrait) and (max-width: 520px)`, localStorage `pg_rotate_hint_seen`, waits out `/world`'s controls hint so two pills never stack, dismissed on rotate / first tap / 6 s), and an orientation-change resize nudge.
- `js/playground3d.js` — attaches it after input creation (to `_container`, after the innerHTML wipe), detaches in `destroy()`. `_resizeRenderer` now sets `camera.fov = PG3DPhysics.fovForAspect(aspect)`: 60° in landscape, opening to 80° in phone portrait so the side-to-side view no longer collapses to ~30°.
- `js/playground3d-physics.js` `fovForAspect` + `test/physics.test.js`.
- `styles.css` — `@media (orientation: landscape) and (max-height: 520px)` (every phone sideways, no tablet/desktop): `body:has(.pg-stage) { --header-height: 48px }` (only the 3D views), joystick bottom-left, jump + punch in a right-thumb arc, fullscreen button top-right, chat band `min(480px, 56vw)` with a 72px log. Portrait: fullscreen button tops the right-thumb stack; joystick / jump / punch / `.pg-header` respect `env(safe-area-inset-*)`. Hidden with the rest of the HUD while the nav drawer is open.
- Keeper chip fix (`js/views/world.js` `_refreshHouseHud`, `.world-house-keeper-*`): `🔑 keeper · 3m · you 12s` was ellipsised at 180px, cutting off *your own* stay — your progress toward taking the house. It's now two spans: the name may ellipsise, "you 12s" never does, and it carries a fill that grows toward the keeper's time. Usernames go through `esc()`.
- `manifest.json` `orientation` stays `any` — a manifest lock would apply to the whole installed app, and iOS ignores it anyway.
- Not verified on hardware: DevTools can't emulate iPhone's missing fullscreen API or a real rotation/lock. Follow-up: on a cold first `/world` visit the controls hint can be wiped by the engine's `container.innerHTML = ''` if THREE finishes loading after it appears.

### 2026-09-22 — Keeper-decorated houses, island stay tracking, island-scoped voice

Every project house in `/world` is now editable — by exactly one person: the **keeper**, the user with the longest all-time *active* stay on that island. Stay time accrues while connected and pauses after one minute without any action (movement, a chat message on any channel, an emote, a punch, a stone grab), so chatting while standing still counts and a parked tab does not. The keeper picks wall / roof / trim / lamp colours from a palette, hangs a sign over the door, and places up to 8 interior props on a 10×10 grid; everyone sees the result live. Voice in `/world` now uses the same island scope as Project chat: you only connect to players standing on your island and the mic idles on the roads (`/home` voice unchanged).

- `js/world-stay-logic.js` (new, server-only, tested) — `enter` / `touch` / `drain` credit math with the 60 s AFK cap (`creditedUpTo` prevents double credit across flushes), `keeperOf`, `formatStay`.
- `js/world-house-logic.js` (new, shared, tested) — 14-swatch `PALETTE`, `PROP_KINDS`, `validateHouse` (palette bounds, sign sanitising to 24 chars, ≤ 8 props on cells 1..10, no duplicate cells, rot wrap), `cellToLocal`.
- `models/ProjectStay.js`, `models/WorldHouse.js` (new) — per-user-per-project ms totals (unique `(userId, projectId)`, keeper index) and per-project decorations. Kept off `Project` so the CMS export / reseed never touch player edits.
- `routes/world-socket.js` — `stay` on the player record; touched by every accepted `world:*` action, drained on island change / disconnect / eviction; `flushStays()` bulk-`$inc`s once a minute (`unref`'d timer) and is exported with `broadcastWorld` for the HTTP route. Voice: `voicePeersInSameRoom('world')` and `voice:peer-joined` fan-out are now `ChatLogic.islandPeers(...)`; the `world:pos` zone transition sends `voice:peer-left` both ways, then `voice:peers` / `voice:peer-joined` for the new island; the single-presence eviction also retires the old socket from the voice mesh (it used to linger with a dead mesh).
- `routes/world.js` (new), mounted at `/api/world` in `server.js` — `GET /houses` (all houses + `{ userId, username, ms }` keeper per island) and `PUT /houses/:projectId` (validates, forces a stay flush, 403 unless the caller is the keeper, upserts, broadcasts `world:house`).
- `js/world-chat-logic.js` — `islandPeers(selfId, players, members)`.
- `js/playground3d-props.js` (new) — primitive builders for chair / table / frame / plant / lamp / rug / bookshelf / crate with collision footprints (rug walk-over).
- `js/playground3d.js` — the plaster texture is painted on a white base and each wall panel's `material.color` carries the wall colour (default look unchanged); `_buildNodeWalls` reads `node.house` for wall / trim / lamp colours and hangs a canvas sign on the first door lintel (or the south wall of a lone island); `_applyRoof` (per-node material only when customised), `_buildProps` (AABBs in `_walls`), exports `setHouses` / `applyHouse` / `getHouse`.
- `js/home-socket.js` — `world:house` event, `onZone` / `onHouse` callbacks, `getProjectId()` on the handle.
- Keeper indicator: every unlocked house carries a floating tag over its roof (`🔑 <keeper> · <stay>` plus `you <stay>` when the viewer has time there or stands on it, `🔑 You` on your own, `🔑 Unclaimed` only on the island you stand on). Tags show only for houses one road away — inside a house, just that house; on a house's apron, it and its road neighbours; on a road, its two ends — and never beyond 80 u. Hero NPC name tags follow the same vicinity rule (`_computeVicinity` / `_inVicinity` in `_tickHUD`). The viewer's own stay on their current island ticks live between polls (client-side estimate of the server AFK rule, re-baselined each poll) — `Playground3D.setHouseKeepers` + `_tickHUD` placement, `.pg3d-keeper-tag`. `GET /houses` also returns `mine` (the caller's stay per island) and the view polls it every 30 s.
- Portrait: the keeper can upload a photo (same `/api/upload` Cloudinary route as memories; the PUT pins the URL to the app's Cloudinary prefix) that hangs inside every `frame` prop. Frames are wall-hung: `validateHouse` snaps a frame to the nearest wall cell and fixes its facing (`snapFrameToWall` / `frameWall`), `_buildProps` places it on that wall's inner face, and it registers no collision box — `WorldHouse.portrait`, `PG3DProps.make(..., { hasPortrait })` leaves the picture plane white and `_buildProps` textures it via `_loadTexture` (material flagged `keepMap` so the cached texture survives rebuilds). Uploading auto-places a frame if the house has none.
- `js/views/world.js` — header HUD (`🏠 Edit house` for the keeper, `🔑 <name> · <stay> · you <stay>` for others, hidden off-island), `_loadHouses`, the editor overlay (swatch rows, sign input, prop chips, rotate / remove, SVG grid, live local preview, Save → PUT / Cancel → restore). Voice button title / `.idle` state reflect the island; the "voice trouble" toast now fires only on a real `failed` / `disconnected` (it used to fire on every routine teardown).
- `js/voice-chat.js` — `getZone` option and `zone` in `_diag()` / the diagnostics panel ("island: …", island-aware empty states); `onPeerStateChange` carries a `reason`.
- `styles.css` — `.world-house-*` HUD + editor, `.pg3d-voice.idle`. `scripts/build.mjs` — new files in the `world` chunk; `PG3DProps`, `WorldHouseLogic` globals.
- Tests: `test/world-stay.test.js`, `test/world-house.test.js` (new), `islandPeers` cases in `test/world-chat.test.js`. Docs: `docs/VOICE-TURN-SETUP.md` notes the island scope.

---

### 2026-09-22 — esbuild build: hashed core/world/admin chunks, lazy 3D + admin, generated sw.js

The shell used to load 62 separate unminified scripts (~1.1 MB) on every route, plus the Three.js module from unpkg — and because a parser-inserted module script shares the deferred execution list, `/login` could not run `boot.js` until unpkg answered. There is now a build step. `npm install` / `npm run build` writes `dist/`; `npm run dev` builds, watches and starts the server.

- `scripts/build.mjs` (new) — concatenates each chunk's files in the old `<script defer>` order and minifies with `esbuild.transform` (no bundling, so top-level globals and the `var`-declared content files survive; a build-time assertion proves it). Outputs `dist/static/core|world|admin.<hash>.js` (+ source maps), `styles.<hash>.css`, `three-shim.<hash>.js`, and generates `dist/spa.html` and `dist/sw.js` from the root templates. Core 430 KB → 227 KB; world 563 KB → 240 KB (lazy); admin 102 KB → 63 KB (lazy).
- `js/chunk-loader.js` (new) — `Chunks.load(name)` injects a chunk's scripts (in order) from the JSON manifest in `dist/spa.html`, then the Three shim as a fire-and-forget module.
- `js/three-shim.mjs` (new) — the former inline module script; also records `window.__threeAddons`.
- `js/router.js` — `navigate` is async; a route registered with a function is lazy (await → memoize); a navigation started while a chunk downloads supersedes it; a failed chunk load does one full reload (sessionStorage-guarded).
- `js/boot.js` — `/home`, `/customize`, `/world`, `/friend/:u/home` load `world`; `/admin` loads `world` then `admin` (its Config tab reads `WorldNpcLogic` + `Playground`).
- `spa.html`, `sw.js` — now templates with `build:` markers / `__PLACEHOLDERS__`; absolute asset URLs (relative ones broke on hard reload of `/home/edit`).
- `server.js` — fails fast without `dist/spa.html`; `/dist` served `immutable, max-age=1y`; `spa.html` + `sw.js` from `dist/`; `/js` mount and the content data files removed from the static allowlist (the legacy `index.html` + `auth.js` + raw `styles.css` stay).
- `package.json` — `build`, `postinstall`, `start`, `dev` scripts; `esbuild` dependency; name `mcu-tracker`. `.gitignore` — `dist/`. CI — `npm ci` step so the build runs in CI. `.claude/launch.json` — `dev` config.

---

### 2026-09-22 — playground3d.js split: avatar builders, input, occlusion

`js/playground3d.js` was 5,837 lines in one closure. The three regions that touch little or no engine state now live in their own files, loaded just before it; the engine aliases their exports back to the old underscore names so the remaining ~3,500 lines are byte-for-byte unchanged. No behaviour change intended.

- `js/playground3d-avatar.js` (new, ~1,800 lines) — `PG3DAvatar`: box + procedural body builders, hair/facial hair/glasses/hat/helmet/prop/emblem/clothing/footwear/outerwear/suit/accessories, plus `sharedGeom` (the page-lifetime geometry cache), `gearMat` and `palette`. Pure: reads `window.THREE`, `Playground` and its arguments only.
- `js/playground3d-input.js` (new) — `PG3DInput.makeInput(viewport, { orbit, CAMERA, minElev })`; same return shape as the old `_makeInput`.
- `js/playground3d-occlusion.js` (new) — `PG3DOcclusion.create()` → `{ tick(dt, now, scene, camera, player), reset() }`; occluder boxes and faded materials are per-instance closure state.
- `js/playground3d.js` — aliases at the top of the character-rig section; `_initInternal` calls `PG3DInput.makeInput`; `_tick`/`destroy` call `_occlusion.tick`/`reset`.
- `spa.html` — three script tags before `playground3d.js`.

---

### 2026-09-22 — character and poster images optimised in place

`assets/` was 42 MB, with single character portraits up to 3.2 MB for an 80px avatar. Every file under `assets/characters` (103) and `assets/images` (71) is now a real JPEG (q82, mozjpeg) capped at 600px / 800px on the long edge. Filenames and extensions are unchanged so `projects.js`, `characters.js` and the Mongo CMS copies needed no edits (the posters were already JPEG bytes under `.png` names; that status quo is kept rather than introducing renames).

- `scripts/optimize-images.mjs` (new) — idempotent, only rewrites when at least 10% smaller so re-runs don't re-compress already-optimised files; `--dry-run`. Decodes from a Buffer because on Windows libvips holding the source path open blocks overwriting it.
- `assets/characters` 20.6 MB → ~2 MB, `assets/images` 9.6 MB → ~5 MB.

---

### 2026-09-22 — friendship helper + first backend tests

The "are these two users friends?" Mongo filter (pair-or-either-side, status accepted, and the three-way `type: 'friend' | missing | null` clause for pre-`type` docs) was copy-pasted seven times across two route files. It now lives in one module, and the backend has its first unit tests (previously only client logic modules were tested).

- `server/friendship.js` (new) — `friendFilter(userId, otherId?, { accepted })` and `getFriendIds(userId)` (Set of self + accepted friends, as strings).
- `routes/friends.js` — request-exists, list, stones, profile-by-username, progress-by-id, watch-request, remove all use the helper. Behaviour preserved: request-exists and remove still match any status; list still populates usernames.
- `routes/feed.js` — `circleIds` is now an alias of `getFriendIds`; unused `Friend` import dropped.
- `test/friendship.test.js`, `test/auth-middleware.test.js` (new) — 14 tests, run by `npm test` / CI. Mongoose models register without a connection, so `User.findById` / `Friend.find` are stubbed on the model; no database needed.

---

### 2026-09-22 — req.body guards + /api/health

Express 5 leaves `req.body` undefined when no body parser matched the request's Content-Type, so six handlers that destructured it bare threw a TypeError → 500 instead of the intended 400. They now use the `req.body || {}` pattern the rest of the routes already follow. Also adds a health endpoint so hosting can tell "process up" from "process up but database down".

- `routes/progress.js` (delete memory, save walkers), `routes/profile.js` (picture), `routes/friends.js` (request, respond, watch-request) — `req.body || {}`.
- `server.js` — `GET /api/health` → `200 { ok:true, db:'connected', uptime }` or `503` when Mongo's `readyState !== 1`. Not rate-limited. Set Render's Health Check Path to `/api/health`.

---

### 2026-09-22 — trust proxy + service worker revalidate fix

Two production bugs. Behind Render's proxy every request reported the proxy's IP, so all rate limiters shared one bucket (20 login attempts per 15 min for the whole site) and the audit log recorded the proxy address. Separately, the service worker's background revalidate was not held open with `waitUntil`, so when a cached file was served the browser could kill the worker before the cache updated — the root cause of the recurring "old scripts on reopen" bug that the manual `CACHE_VERSION` bumps were papering over.

- `server.js` — `app.set('trust proxy', 1)` right after the app is created. One hop = Render's load balancer.
- `sw.js` — stale-while-revalidate branch now wraps both the revalidate fetch and `cache.put` in `event.waitUntil`.

---

### 2026-09-13 — Friends activity Feed tab

New `/feed` tab (Watch Order · Feed · World): a Facebook-style card whenever you or a friend watches a project, who they watched it with, any memories they added, and a comment thread friends can post into.

- `models/FeedPost.js` (new) — one post per watch "session": author, participants (author + accepted co-watchers — a post reaches friends of any participant), projectId, kind (`watch`/`memory`), count, watchedWith, memories (with uploader), comments, activityAt.
- `server/feed.js` (new) — posts are created server-side only. Activity on the same project within 12h updates the existing post (rewatch, co-watcher, memory) instead of adding another. Un-watching retracts a fresh post with no comments/memories; a save that adds more than 3 projects at once (bulk restore) posts nothing. All helpers swallow errors so the feed can never fail a progress save.
- `routes/progress.js` — `/save` diffs against the pre-update document; `/watch`, `/memory` (add/delete) record feed activity after responding.
- `routes/friends.js` — accepting a watch-party request merges both users into one post (awaited, so the accepter's follow-up save doesn't duplicate it).
- `routes/feed.js` (new) — `GET /api/feed?before=` (self + friends, 15/page), `POST /api/feed/:id/comments`, `DELETE /api/feed/:id/comments/:cid` (comment author or post author).
- `js/views/feed.js` (new), `spa.html`, `js/boot.js`, `server.js` — view + route; names only link to people you're friends with.
- `js/views/watchorder.js`, `js/views/app.js` — Feed tab added. `styles.css` — `.feed-*` rules; `.view-tab` no longer wraps on phones.
- `sw.js` — cache bumped to `mcu-v15`.
- **Follow-up (same day): reactions + captions.** `FeedPost` gains `caption` (author-only, 500 chars) and `reactions` (one per user: like/love/haha/wow/sad/angry). New `PUT /api/feed/:id/reaction { type | null }` (anyone who can see the post) and `PUT /api/feed/:id/caption` (author only). Cards show the caption (✎ to add/edit inline — Enter saves, Esc cancels), a "You and 3 others" reaction summary that opens a who-reacted list with per-reaction tabs, and a Like button: tap to like/unlike, hover or long-press for the six-reaction picker, ArrowUp from the keyboard. Cache bumped to `mcu-v16`.

---

### 2026-08-06 — CMS drag-to-move board, dark default, Goals guide, register transition

Four independent UX changes. Full details in each area's plan; summary per file:

- `routes/admin.js` — `sanitizeProject()` now omits `gridX`/`gridY` from the update when the caller doesn't send them (was defaulting to 0 and silently teleporting projects on every plain form save). New `PUT /content/projects/bulk/positions` — validates, merges against DB state, 409s on cell collisions, `bulkWrite`s the diff, one `contentEdit` audit entry.
- `js/views/admin/cms-projects-board.js` (new) — drag-to-move board for the CMS Projects tab: every project as an SVG node at its `gridX/gridY` with prerequisite arrows, pointer-based drag with a free-cell drop check, click-empty-cell to create, click-node to edit, keyboard arrow-key move, staged moves committed via one "Save layout".
- `js/views/admin/cms-projects.js` — List/Board mode toggle; the position fields in the per-project form are now a read-only display fed by the board (or by the clicked empty cell for a new project); `adoptItems()` re-seeds both from a save response.
- `styles.css` — `.admin-cms-modes`/`.admin-cms-board`/`.admin-board-*` rules.
- `js/theme.js`, `spa.html`, `index.html`, `manifest.json` — dark mode is now the hard default: an unset/invalid `mcu-theme` resolves to dark regardless of OS preference; only an explicit `'system'` choice follows the OS live. `theme-color` meta and PWA manifest colors updated to match.
- `js/goals.js` (new) — Goals guide panel. `computeGoals()` lists locked projects one step ahead only (every requirement already watched or revealed — never recurses into projects the user can't see yet), reusing `isUnlocked`/`isPhaseUnlocked`/`isRevealed`/`allPrereqs` from `js/utils.js`. `showGoalsPanel()` follows the `showFriendsPanel()` pattern; wired to a new "Goals" nav-drawer button in `js/views/watchorder.js` and `js/views/app.js`.
- `js/views/login.js` — fixed the bug where the post-register tab switch immediately hid its own success message; register now plays an animated success step (checkmark + toast) before landing on the Login tab with the username prefilled and password focused. Skips the animation under `prefers-reduced-motion`.
- `sw.js` — `CACHE_VERSION` → `mcu-v8`.

---

### 2026-07-07 — Batch 5: Infinity Stones reworked into shared PvP + Snap

Replaced the per-player daily stone hunt (batch 3) with the real MCU dynamic: **one shared set of six stones** in the /world room, server-authoritative.
- **Grab / steal / snap:** the six stones spawn free in a ring around the Iron Man 1 island (the universal spawn — identical coords for everyone regardless of which other islands they've unlocked). Walk onto a free stone to claim it; **punch someone holding stones to steal one** (the batch-4 punch now also transfers a stone). Hold all six → a pulsing **SNAP** button (also `G`) dusts a random ~50% of the *other* players — they fade and respawn at spawn — then all six scatter free for a fresh round. Held stones orbit their holder so everyone can see who's carrying what (the punch-target cue).
- **Server authority** (`routes/world-socket.js`): in-memory `worldStones` (holder per stone), `world:stones`/`world:stone-update`/`world:stone-grab`/`world:snap`/`world:snapped` events; steal-one on `world:punch`; snap verifies all-six + 500ms floor, picks victims via partial Fisher–Yates, `$inc`s `User.stoneSnaps`; `freeStonesOf` drops stones on disconnect AND on the duplicate-socket eviction so a rejoin can't strand one.
- **Client:** `playground3d.js` renders the ring/orbit stones + optimistic grab + `applySnap`/`snapRespawnLocal` (reuses the `.pg3d-fade` + remote-opacity systems); `home-socket.js` relays the events + `setLocalId` on connect; `world.js` held-count chip, SNAP button, `world:snapped` flash/toasts, and the leaderboard now ranks lifetime snaps.
- **Persistence:** `models/user.js` `stoneHunt` → `stoneSnaps` (Number); removed `GET/POST /api/progress/stones` (daily); `/api/friends/stones` now ranks by lifetime snaps. Removed the seeded-placement helpers (`pickStoneSpots`/`mulberry32`/`hashString`) + their tests from the physics module. `sw.js` → `mcu-v7`.
- **Verified** with two live sockets: grab → contested-grab rejected → steal exactly one on punch → assemble six → snap dusts ~50% and `stoneSnaps` 0→1 in the DB → stones reset free → holder's stones drop on disconnect. Client held-count + snap-respawn verified via the engine API (the in-browser walk-to-grab uses the same proven batch-3 pickup but couldn't be driven live under the known /world preview movement throttle).

### 2026-07-07 — Batch 4: punch + knockdown; node "click to view" prompt removed

**Removed:** the /world proximity prompt ("📺 Click to view [movie]") and its E-key shortcut — feature deleted end-to-end (engine state/tick block/`getActiveNode`/`setProjectClickHandler`, view wiring, `.pg3d-prompt` CSS, `WORLD.PROXIMITY`). Projects are watched from `/` and `/map`; /world is now purely the playground. First-visit controls hint updated (WASD · Space jump · F punch).

**Punch + knockdown.** **F** (desktop) or the **👊 touch button** (stacked above jump) throws a 300ms right-arm jab. The nearest remote player or NPC within 1.4u (and 1.5u vertically) gets knocked down: tips backward to flat, lies 1.8s — with input dead if it's YOU — then eases back up. 600ms punch cooldown.
- Networked like emotes: engine `_onPunch` callback → `js/home-socket.js` emits `world:punch { target }` (every swing broadcasts, hits carry the victim's socket id; homes stay local) → `routes/world-socket.js` validates (world membership, 500ms per-socket floor, target must be null or a live world player) and relays → receivers play the attacker's jab and the victim client calls `knockdownLocal()`.
- Engine: `PUNCH` consts, `consumePunch` input (F + `.pg-punch` button with the joystick's lifecycle/visibility gates), `_applyJabPose` (priority over the wave emote), `_applyDownPose` shared by local/remote/NPC rigs, `PG3DPhysics.pickPunchTarget` (pure, unit-tested), public `setPunchHandler`/`playRemotePunch`/`knockdownRemote`/`knockdownLocal`, state reset on init/destroy so a knockdown can't survive a remount.
- Verified live with two real socket connections: punch relayed with the correct target id, victim input dead while down, knocked-down rig visibly tipped in-scene. `sw.js` → `mcu-v6`.

### 2026-07-07 — Batch 3: Daily Infinity Stone hunt, walker polish, avatar taper/sway

**Daily Infinity Stone hunt (/world retention loop).** Six stones (Space/Mind/Reality/Power/Time/Soul) hide in new deterministic spots every day — seeded by the SERVER's date + the player's unlocked-island set, so friends with the same islands hunt the same spots. Ground stones collect on walk-over; ~⅓ float at jump height and require a leap (3D pickup radius 0.9 from the feet). Collect all six → white "snap" flash + daily streak. HUD chip (`💎 n/6`) in the world header doubles as the friends-leaderboard button (rank, today's count, ✨ completion, 🔥 streak). Small worlds (<3 islands) spawn `islands×2` stones.
- `js/playground3d-physics.js` — `mulberry32`, `hashString`, `STONES`, `pickStoneSpots` (pure, unit-tested: determinism, walkability, separation, jump-reachability math).
- `js/playground3d.js` — `spawnStones`/`clearStones`/`setStoneHandler`/`getStoneWorld` public API; emissive octahedron meshes (shared geometry), spin+bob, pickup in the world tick; stones cleared in `destroy()`. **Bug fix:** `WORLD.PROXIMITY` was referenced but never defined, so the "enter project" node prompt could never appear — now `PROXIMITY: 9`.
- `routes/progress.js` — `GET/POST /api/progress/stones`: server date is the daily key (client clocks can't farm ahead), stone-id whitelist, streak computed on completion (yesterday-completed chains it), 30-day pruning of the Mixed blob, `markModified` on save.
- `routes/friends.js` — `GET /api/friends/stones` leaderboard (self + accepted friends, sorted by today's count then streak).
- `models/user.js` — `stoneHunt` Mixed field. `js/views/world.js` — chip, pickup toasts, snap effect, leaderboard modal (Esc/backdrop via `wireModalDismiss`), scene-ready retry, unmount cleanup. `styles.css` — chip/panel/flash (scene-dark in both themes). `sw.js` → `mcu-v5`.

**2D map walker polish.** Walker chips (the circular character portraits roaming /map) grew 24→28px, moved their visual styling from JS inline styles into CSS (`.map-walker img`) — which also killed the last pre-retheme GOLD ring literals — and gained life while moving: a fast bob + a lean into the walk direction (applied to the wrapper so `.hit-flash`/`.fainted` on the img are untouched). `js/walkers.js` `createWalkerElement` + `applyWalkerPosition`.

**Avatar extras.** Torso now tapers (hips 1.0 → shoulders 0.93, one-time vertex pass inside the shared-geometry cache) and idle avatars sway subtly (local via `_idleClock`; remotes/NPCs stateless phase-offset so crowds don't sync). Verified: 340/340 customization thumbnails render clean.

### 2026-07-07 — Batch 2: light-first theme system, /world gap-jumping, rounded avatars, tests + CI, CSP enforced

The big one. Five workstreams shipped together:

**Light-first theme system.** White "Marvel comics print" light theme (white surfaces, near-black text, #ED1D24 accents) is now the DEFAULT; the original dark palette survives as an opt-in dark theme. The animated map and 3D world are *scenes* and stay dark in both themes (poster art needs a dark canvas — same reason Netflix is dark). Semantic tokens (`--surface-*`, `--text-*`, `--border-*`, `--scrim*`, `--shadow-*`, `--ink` channel triple) + one `[data-theme="dark"]` override block in `styles.css`; fixed `--scene-*` tokens for the map/3D surfaces. Anti-flash inline script in both HTML heads resolves saved preference / `prefers-color-scheme` before first paint; new `js/theme.js` is the runtime API; Light/Dark/System toggle lives in `/profile` → Appearance. `manifest.json` theme/background → light values; `CACHE_VERSION` → `mcu-v4`.

**/world gap-jumping + fall/respawn.** While airborne, the walkability check no longer pins you to platforms — a running jump (air-speed ×1.25 → ~3.4u carry) clears the 2.0u/2.8u gaps between adjacent islands; distant islands (20u) stay unreachable. Land on nothing and you fall below the world, fade out, and respawn at your last safe spot (1s or −8u, whichever first). Peers see the fall via the existing y-sync + unwalkable-ground fade; y broadcast floors at −2 to mirror the server clamp (zero server changes). Mobile gets a bottom-right jump button (`.pg-jump`) with the same visibility gates as the joystick. Pure physics extracted to `js/playground3d-physics.js` (UMD) and unit-tested.

**Rounded "polished stylized" avatars.** All 35 customization slots preserved. Head/torso → `RoundedBoxGeometry` (shimmed from examples/jsm in spa.html's module script), limbs → two-segment capsules with knee/elbow bend in the walk cycle (elbow/knee pivots exposed as `*Lower` bones), sphere hands, neck cylinder, landing-squash after jumps. Walk animation unified into `_walkPose`/`_dampPose` (was three duplicated blocks: local/remote/NPC — NPCs and peers get the bend for free). Geometries shared via a module cache keyed on shape+dims (both rig-dispose sites skip `userData.shared` — critical). Verified: 340/340 slot-option thumbnail renders clean, /customize open→close→reopen twice with no WebGL errors.

**Instant boot.** `js/boot.js` now mounts the SPA immediately against the bundled fallback data; the `/api/content/*` fetch runs in the background and remounts `/`, `/map`, or `/characters` only if the DB copy meaningfully differs (bookkeeping fields ignored). The 3D views never remount. Cold-server boots no longer stare at the splash.

**Security & infra.** CSP flipped from Report-Only to **enforced** after a violation-free sweep of login/map/watch-order/world/home/customize. Dev mode (`NODE_ENV` ≠ production) now serves all static files `no-cache` so edits show on plain reload (production keeps the 1-day cache). First test suite: `test/physics.test.js` (9 tests, `npm test` → `node --test`); GitHub Actions CI (`.github/workflows/ci.yml`) runs a full `node --check` syntax pass + tests. `scripts/export-content.js` snapshots CMS-edited Mongo content back into the static fallback files (`--dry-run` supported); dialogues export to `data/dialogues-export.json`. Voice TURN setup guide at `docs/VOICE-TURN-SETUP.md` (client + server were already wired; set `TURN_URLS`/`TURN_USERNAME`/`TURN_CREDENTIAL` to activate). Dead pre-SPA files deleted: `app.html`, `characters.html`, `profile.html`, `characters-page.js`, `testing.js`, `js/main.js`, plus `showAuthModal`/`updateAuthUI` in `js/popup.js`.

### 2026-07-07 — Marvel red retheme

Replaced the gold accent theme with Marvel brand red (#ED1D24) — the gold never matched the Marvel identity. The palette flows through CSS variables, so the swap is centralized; the legacy `--gold-*` variable names are kept (values now red) to avoid a mass rename across ~5,500 lines. Text on the accent gradient flipped from black to white (black-on-gold worked; black-on-red didn't). The danger confirm button deepened to crimson so destructive actions stay visually distinct now that the brand accent is also red.

- `styles.css` — `--color-primary` → `#ED1D24`, `--color-primary-light` → `#ff4b51`; all `rgba(201, 162, 39, …)` literals → `rgba(237, 29, 36, …)`; new `--gold: var(--color-primary)` (a few rules referenced `var(--gold)` which was previously **undefined** — silent inherit bug, now fixed); all `color: #000` on the accent gradient → `#fff`; `.confirm-btn.confirm-ok.danger` → deep crimson gradient; boot-splash logo filter retuned from gold to red tint.
- `spa.html`, `index.html`, `manifest.json` — `theme-color`/`theme_color` `#daa520` → `#ED1D24`.
- `sw.js` — `CACHE_VERSION` → `mcu-v3`.

### 2026-07-07 — UX batch 1 + security quick wins

Shipped the first batch of the improvement roadmap: killed the blank screen during boot with a themed splash, replaced every remaining native `window.confirm` on the admin surface with the branded `confirmDialog`, gave the friends panel real error/retry states (a failed pending-requests fetch used to hang on "Loading…" forever), wired Esc/backdrop dismissal into the home-edit modals and the friends panel, and landed three security quick wins (JWT_SECRET strength guard, `.env.example`, CSP in Report-Only mode). Secrets from the original leaked `.env` (first commit) still need rotating in Cloudinary + Render — the local `.env` JWT_SECRET has been regenerated.

- `spa.html` — static `#boot-splash` (gold-tinted logo + sweep bar, painted before any JS runs) + `#boot-splash-status` a11y announcement.
- `styles.css` — splash styles (reduced-motion aware), `.friends-retry-btn`.
- `js/boot.js` — removes splash + status after `Router.init`; content fetches capped at 4s via `AbortSignal.timeout` (feature-checked) so a cold server can't hold boot hostage.
- `sw.js` — `CACHE_VERSION` → `mcu-v2`; `avengers-logo.svg` precached.
- `js/views/admin/{users,moderation,config,cms-projects,cms-characters,cms-locations,cms-dialogues}.js` — all 10 `window.confirm` calls → `await confirmDialog({...})`, destructive ones styled `danger`.
- `js/friends.js` — pending list now has a `.catch` with error + Retry (was an infinite "Loading…"); friends list failure gets the same Retry; Add-friend search/request wrapped in try/catch (button no longer sticks on '…'); panel wired to `wireModalDismiss` (Esc/backdrop/focus-restore).
- `js/views/home-edit.js` — project-picker and room-menu modals wired to `wireModalDismiss` (Esc was previously not handled).
- `server.js` — refuses to boot if `JWT_SECRET` < 32 chars; helmet CSP enabled in **Report-Only** mode with an allowlist (self, unpkg, Cloudinary, Google Fonts, ws/wss, data:/blob:). Flip `reportOnly: false` after a bake-in period with no console violations.
- `.env.example` (new) — documents all env vars incl. optional TURN.



Added opt-in WebRTC proximity voice chat to `/world`, `/home`, and `/friend/:user/home`. A 🎙️ toggle in the chat row asks for mic permission, then opens a P2P mesh with every other voice-enabled peer in the same room. Audio is direct peer-to-peer (no server bandwidth, no SFU); the existing Socket.IO connection only relays SDP / ICE. A 100 ms loop reads each remote's lerped position from `Playground3D.getRemotePlayers()` and ramps per-peer `GainNode`s on a linear falloff (full at 0u → silent at 25u), so voices fade as players walk apart. Speaking peers get a green glow on their nametag via RMS-based voice activity detection. STUN-only (Google public STUN) — strict-NAT users will silently fail to connect, no TURN fallback yet.

- `routes/world-socket.js` — added `voiceWorld: Set<socketId>` and `voiceHomes: Map<ownerId, Set<socketId>>` membership tracking; three new signaling events `voice:announce`, `voice:leave`, `voice:signal` plus three server-broadcast notifications `voice:peers`, `voice:peer-joined`, `voice:peer-left`. `voice:signal` is a single-target relay validated to be in the sender's room (no cross-room leak). Per-pair rate cap 50ms, payload size guard 8KB. Disconnect handler extended to clean up voice sets and broadcast `voice:peer-left` to surviving peers.
- `js/voice-chat.js` (new) — `VoiceManager.start({socket, scope, getLocalState, getRemotePlayers, onError, onPeerStateChange})` IIFE. Acquires mic via `getUserMedia({echoCancellation, noiseSuppression, autoGainControl})`, opens an `RTCPeerConnection` per peer (deterministic glare-safe role: lower `socket.id` initiates), routes incoming audio through hidden `<audio muted autoplay playsInline>` → `MediaStreamSource` → `GainNode` → `audioCtx.destination`. Per-peer `AnalyserNode` for RMS voice activity. Linear distance gain with `setTargetAtTime` smoothing. STUN config: `stun:stun.l.google.com:19302`. Returns `{stop, mutePeer, isMuted}`.
- `js/playground3d.js` — added `getRemotePlayers()` returning `[{id, x, y, z, username}]` snapshot read from the `current` (lerped) position, and `setRemotePlayerSpeaking(id, on)` toggling `.speaking` on the existing `.pg3d-nametag` element. Stored `username` on the `_remotePlayers` entry shape so the accessor can expose it.
- `js/views/world.js`, `js/views/home.js`, `js/views/friend-home.js` — added 🎙️ `#world-voice-btn` to `.world-chat-inputrow` next to the emote button; lazy `VoiceManager.start` on first click; `aria-pressed` reflects state; unmount cleanup ordering is `voice.stop() → mp.stop() → Playground3D.destroy()` so `voice:leave` reaches the server while the socket is still open.
- `spa.html` — `<script defer src="js/voice-chat.js">` wired after `js/home-socket.js` and before the view scripts.
- `styles.css` — `.pg3d-voice` button styled to match `.pg3d-emote`, `[aria-pressed="true"]` green glow when active; `.pg3d-nametag.speaking` green outline ring; mobile 600px breakpoint shrinks button to 36px to match the emote button.

### 2026-05-16 — Production hardening + PWA shell

Shipped five wins from the prioritized improvement menu: baseline security headers, response compression, lazy-loaded `<img>` tags in modal/secondary views, a per-frame allocation + texture cache rework in the 3D engine, and an installable PWA shell with an offline-capable service worker. The app is now installable on desktop and mobile; the shell renders offline; `/world` has measurably less GC churn during HUD ticks; project poster textures are downloaded once and reused across `/home` ↔ `/world` swaps.

- `package.json` — added `helmet` and `compression` to dependencies.
- `server.js` — wired `compression()` as the first middleware and `helmet({contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, crossOriginResourcePolicy: 'cross-origin'})` after it. CSP intentionally off (importmap + unpkg + Cloudinary + Fonts would all break under default `default-src 'self'`).
- `server.js` — `ROOT_FILES` extended with `manifest.json` and `sw.js`. New `NO_CACHE_FILES` set forces `Cache-Control: no-cache` on `sw.js`; `Service-Worker-Allowed: /` header set defensively for root scope.
- `manifest.json` (new) — name, short_name, theme/background color, 192/512 icons referencing `/assets/favicon.jpg`, `display: standalone`.
- `sw.js` (new) — `install` precaches the SPA shell + static fallback data, `fetch` does network-only for `/api/*` and `/socket.io/*`, navigation fallback to cached `/spa.html`, stale-while-revalidate for `/js/*` and `/assets/*`. `CACHE_VERSION` bump invalidates on next activate.
- `spa.html`, `index.html` — added `<link rel="manifest" href="/manifest.json">` and `<meta name="theme-color" content="#daa520">`.
- `js/boot.js` — registers `/sw.js` inside a `load` listener so registration never competes with first paint.
- `js/playground3d.js` — module-scoped `_textureCache` Map + lazy `_textureLoader`, surfaced via `_loadTexture(url, onReady)`. Replaces the two inline `new THREE.TextureLoader()` + `loader.load(...)` sites in `_buildLayoutScene` and `_rebuildWorldNodes`. New `_sceneAlive` flag (set true at the end of `_initInternal`, false at the top of `destroy`) guards late-firing texture callbacks against writing to a disposed scene. Module-scoped `_hudAnchor` Vector3 replaces the per-frame `new THREE.Vector3(...)` in `_tickHUD`'s remote-player loop. `destroy` no longer disposes textures (the cache owns them across mount cycles); per-material/geometry disposal preserved.
- `js/views/friend-profile.js:35`, `js/popup.js:63`, `js/memory.js:42`, `js/memory.js:117`, `js/views/home-edit.js:276` — added `loading="lazy"` to remaining `<img>` tags. `js/nodeFactory.js` and `js/views/characters.js` already had it.

---

### 2026-05-02 — /home playground (v1)

A new `/home` route: a fixed 1500×1000 px room where the user's customized layered-SVG character walks around in third-person (camera-follow). WASD + arrow keys on desktop, fixed bottom-center virtual joystick on mobile (portrait-first). 4-slot character builder (skin / hair style + color / shirt / pants) opens automatically on first visit and on demand thereafter. Designed as the foundation for a future room-per-Marvel-project memory system.

- Added: `js/playground.js` — engine (RAF loop, input adapter for keyboard + touch joystick, layered SVG renderer with 5 skin tones × 6 hair styles × 6 hair colors × 8 shirt × 8 pants palette options, scenery backdrop). Exposes `init/destroy/setCharacter/renderCharacter`.
- Added: `js/views/home.js` — `HomeView` with header, drawer (own copy of nav menu), Customize button. Fetches saved character on mount, opens builder on first visit, hot-swaps the sprite on save.
- Added: `js/views/home-builder.js` — `HomeBuilder` modal with live preview that re-renders on every selection change. Saves via `PUT /api/profile/home-character`.
- Added: `homeCharacter` field on User schema (5 small int slots, defaults to null until first save).
- Added: `GET /api/profile/home-character` and `PUT /api/profile/home-character` in `routes/profile.js` with per-slot range validation.
- Modified: `js/views/watchorder.js` and `js/views/app.js` — `🏠 Home` button at the top of the existing nav drawer + click handler routing to `/home`.
- Modified: `js/boot.js` — `Router.register('/home', HomeView)`.
- Modified: `server.js` — `/home` added to SPA route list.
- Modified: `spa.html` — `js/playground.js`, `js/views/home-builder.js`, `js/views/home.js` script tags wired in.
- Styles: `.pg-stage`, `.pg-room`, `.pg-sprite`, `.pg-joy`, `.pg-modal*` appended to `styles.css`. Mobile breakpoint at 600 px scales the joystick down and stacks the modal preview.

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
