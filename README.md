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
| PWA         | `manifest.json` + `sw.js` — installable, offline shell               |
| Hosting     | Render.com                                                           |

---

## Repo layout

```
projectOne/
├── server.js                  Express app entry — routes, rate limits, static allowlist, helmet, compression
├── manifest.json              PWA manifest (name, icons, theme color, start_url)
├── sw.js                      Service worker — precache shell + SWR for /js & /assets; never caches /api
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
│   └── contentLoader.js       vm.runInNewContext loader of static JS files,
│                              used as the Mongo-down fallback for /api/content/*
│
├── scripts/
│   ├── seed-content.js        Idempotent seed: JS files → Mongo (run once)
│   └── export-content.js      Inverse: Mongo → static fallback files (--dry-run)
│
├── test/
│   └── physics.test.js        node --test unit tests for the 3D physics helpers
│
├── docs/
│   └── VOICE-TURN-SETUP.md    5-minute TURN relay setup for cross-NAT voice
│
├── .github/workflows/ci.yml   CI: node --check sweep + npm test
│
└── js/
    ├── boot.js                Instant mount from fallbacks + background content refresh
    ├── router.js              Hash-free SPA router
    ├── auth.js                Auth helper (token, isAdmin via JWT decode)
    ├── theme.js               Light/Dark/System theme manager (see profile toggle)
    ├── playground3d-physics.js Pure jump/fall/walkability math (unit-tested)
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
- **Service worker cache invalidation.** `sw.js` precaches the SPA shell + static fallback data and serves stale-while-revalidate for `/js/*` and `/assets/*`. `/api/*` and `/socket.io/*` are never cached. When a deploy must invalidate the precache (precache list changed, shell shape changed), bump `CACHE_VERSION` in `sw.js`; the `activate` handler deletes old caches.
- **Helmet CSP is ENFORCED** (since 2026-07-07) with an allowlist covering the inline importmap, unpkg.com (Three.js), Cloudinary, Google Fonts, websockets, and data:/blob: images. **Adding any new external source requires extending the allowlist in server.js first** or first paint will brick. Other security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, HSTS, COOP, CORP=cross-origin) are on.

---

## Pending / not built

- TURN credentials for cross-NAT voice: the code is fully wired; create a
  provider account and set `TURN_URLS`/`TURN_USERNAME`/`TURN_CREDENTIAL`
  (see `docs/VOICE-TURN-SETUP.md`).
- Broader test coverage — `test/physics.test.js` covers the 3D physics
  helpers; auth middleware and home-layout validation are good next targets.

---

## Changelog

Append new entries at the **top** of this section. Use the format:

```
## YYYY-MM-DD — short title
Brief summary of what changed and why.
- file/path:line — what changed
```

---

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
