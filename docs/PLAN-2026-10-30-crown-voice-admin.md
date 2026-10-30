# Plan 2026-10-30: champion rewards on both bodies, road voice, admin sidebar

Approved answers (2026-10-30): crown/laurel sit ON TOP of any hat; "same road" = same road
segment (one road = one prerequisite edge, key `fromId__toId`); ship with a cap of the 8 nearest
voice users, a ~1 s dwell before a zone change counts, and Project text chat scoped to roads too;
admin gets a grouped left sidebar with breadcrumbs, a URL per view and a sticky Save bar.

Work runs as three parallel Opus 5.5 (medium) agents on disjoint files. No commits by agents;
the owner reviews screenshots, then commits (no co-author trailer).

## A. Crown + laurel fit both bodies

Problem: `_sgTickCrowns` (js/playground3d.js ~5576-5632) adds each reward group to the scene and
holds it at `rig.position.y + 1.86 * rig.scale.y` every frame. 1.86 is the realistic hairline.
The Box head is a 0.55 cube spanning y 1.47-2.02 (plus hair to ~2.1), so the crown band and the
whole laurel end up inside the head; only spike tips show. Remote players share the bug.

Fix:
1. Parent the reward to the head instead of the scene.
   - Realistic (`rig.userData.humanoid`): `inst.mountRigid('head', g)`; position from
     `inst.measure().head` (`crownY`, `skull.c/r`); scale so the band's inner radius (0.16)
     rings the skull + hair clearance. Add `crownFit(H, {hat})` next to `hatFit` in
     js/playground3d-gear-logic.js (pure, unit-tested in test/gear.test.js).
   - Box / stand-in (`rig.userData.bones.head`): `head.add(g)` at local y ≈ 0.30, uniform scale
     ≈ 0.30/0.17 so it rings the cube. Do NOT multiply by the build scale again (root carries it).
2. Hat rule: when a hat/helmet/hood is worn, lift the reward to the hat's crown height
   (`hatFit(H, style).crown` on realistic; hat top on Box).
3. Stacking: keep `crownLayout`, but as head-relative offsets (laurel slightly below crown).
   Update test/scene-geometry.test.js.
4. Re-attach when the actor upgrades from stand-in to GLB (`_upgradeActor` removes children) and
   when hats change. Dispose on removal as now. Keep the gentle bob as a local y tweak.
5. Verify in /world on Realistic (woman/man, Slim/Normal/Large/Huge), Box (Normal/Huge), with and
   without a hat, sitting, and on a remote walker. Screenshots.

Files: js/playground3d.js, js/playground3d-gear-logic.js, js/playground3d-scene.js,
js/quote-guess.js (crown registration y), test/gear.test.js, test/scene-geometry.test.js.

## B. Voice (and Project chat) on the same road

Today: server `applyZone` (routes/world-socket.js ~686-731) → `zoneOf` → `ChatLogic.projectAt`;
`player.projectId` drives `islandPeers` for voice AND Project chat; off-island = no peers.
Roads: js/road-router.js `route(projects,{trails:false})` gives `{key, runs,...}` per
prerequisite edge; client builds walkable rectangles in `_buildWorldRoad` (js/playground3d.js
~3822-3864, ROAD_W 2.5). Server loads only `id gridX gridY` and has no road geometry.

Fix:
1. Shared pure helper `roadAt(x, z, roadRects, prevKey)` in js/world-chat-logic.js: nearest
   centreline wins at crossings; keep `prevKey` while still inside it (hysteresis).
   Build `roadRects` from `RoadRouter.route` + the same view constants as the client (move the
   constants to a shared module or add a drift test like the existing ZONE_HALF one).
2. Server: load `prerequisites` in `projectGrid()`, cache routed rects, rebuild on
   `invalidateProjectGrid`. Add `player.roadKey`; generalise scope to
   `zone = projectId ? 'p:'+id : roadKey ? 'r:'+key : null`. Only count a road when the user has
   watched both end islands (matches client gating). `islandPeers` compares `zone`.
3. Dwell: a zone change becomes effective only after ~1 s of continuous new zone.
4. Cap: `voice:peers` / peer-joined limited to the 8 nearest voice users in the zone (server has
   positions); re-evaluate on a slow timer (e.g. 2 s) and emit joined/left deltas.
5. Project text chat uses the same zone, so road peers get it automatically; `world:zone` payload
   gains `roadKey` + a display label ("Road: Iron Man → Iron Man 2").
6. Client: js/views/world.js `_voiceVisual` idle state + "where" text; HUD label for road
   zone; stale comments in js/voice-chat.js and world-socket.js.
7. Tests: roadAt + hysteresis + cap selection + dwell in test/world-chat.test.js (or new file);
   socket-contract still passes. Live check: two bot tabs on different origins, both on the same
   road → `voice:peers` lists each other; step onto an island → leave/join after ~1 s.

Files: js/world-chat-logic.js, routes/world-socket.js, js/views/world.js, js/voice-chat.js
(comments/labels only), js/road-router.js (export helpers if needed), tests.

## C. Admin: grouped sidebar

Today: 7 top tabs, CMS holds 6 sub-tabs, Quotes/Scenes drill 3-4 levels deep, no breadcrumbs, no
URL (Back exits /admin, reload → Users), Save at the bottom of long pages, game switches split
between Config and CMS, Overview last.

New IA (left sidebar, collapses to a drawer ≤ 720px):
- Overview (landing)
- People: Users · Moderation · Reports · Quote suggestions
- Content: Projects (list/board) · Characters · Locations · Dialogues
- Minigames: Scene Guess (flag + round settings + stills) · Quote Guess (flag + round sec +
  islands + import/export)
- World settings: Physics · Defaults · NPC bodies · other flags left in Config
- System: Audit log

Mechanics: one registry in js/views/admin/index.js (absorb cms.js); `?tab=&sub=&id=` kept in the
URL via history.replaceState (router keeps the query, server needs no change); breadcrumb strip
at the top of the content pane; sticky bottom Save bar shown whenever `isDirty()`; existing
dirty/discard dialogs kept; sub-tab bars scroll on phones. Panes keep their
mount/unmount/isDirty/discard contract; only Projects/Dialogues/Quotes/Scenes internal back
buttons become breadcrumb links. README tab table updated.

Files: js/views/admin/index.js, cms.js, config.js, cms-quotes.js, cms-scenes.js,
cms-dialogues.js, styles/legacy/17-admin.css, styles/pages/admin-cms.css, README.md.
Verify with the client-side stub recipe (Auth stubs + fixture AdminView.api on :3002) and
screenshots at desktop + 375px.
