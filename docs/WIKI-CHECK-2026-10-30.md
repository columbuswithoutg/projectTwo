# Title data vs. MCU Fandom wiki — 2026-10-30

Source: marvelcinematicuniverse.fandom.com (title pages, Phase Four/Five/Six pages,
"Chronological Order/Viewing Timeline"), read 2026-10-30. Checked against `projects.js`
(the client fallback; the live DB copy should match it).

Scope agreed: release dates + phases, story order, watch-before links, missing released
Marvel Studios titles. Netflix/Fox "Phase 1" tags left as is on purpose.

## Status (2026-10-30)

- **A applied** to `projects.js`. Punisher S2 episode runtimes were re-entered from the wiki.
- **D applied**: 8 new cards (I Am Groot as two seasons). Their prerequisites are Werewolf by Night → none,
  I Am Groot → GotG Vol. 2 → I Am Groot S2, Wonder Man → Shang-Chi, Born Again S2 → S1,
  One Last Kill → Born Again S2, Brand New Day → No Way Home, VisionQuest → WandaVision.
  Grid spots were picked by a search that minimises road crossings. The board has 7, and so does
  the same board without the new cards. Doomsday moved from row 31 to row 32. The poster images
  (`werewolfbynight.png`, `iamgroot.png`, `iamgroot2.png`, `wonderman.png`,
  `daredevilbornagain2.png`, `punisheronelastkill.png`, `brandnewday.png`, `visionquest.png`)
  don't exist yet, so these cards show the generated title-card art until they are added.
- **Live DB not updated yet.** Run `node scripts/apply-wiki-check-2026-10-30.js` (dry run), then
  add `--apply`.
- **F applied as recommended links**: Brave New World ← Eternals, The Marvels ← WandaVision,
  Born Again ← Daredevil S3 + Echo.
- **Board re-laid out** to untangle roads (66 cards moved). It keeps the existing rules: Fox films
  left, MCU centre, Netflix right, each card within one row of its year band, never above its own
  prerequisite, Doomsday pinned bottom-centre. Crossings between required roads went 7 → 6 and
  crossings on the full chart 42 → 29. The four new recommended trails account for 16 of those
  29; without them this layout has 13, about the same as the last commit's 12.
- **F rechecked**: Quantumania ← Ant-Man and the Wasp, Brave New World ← Hulk, and The Marvels ←
  Captain Marvel are already required through the chain. Brave New World ← Eternals, The Marvels ←
  WandaVision, and Born Again ← Daredevil S3 / Echo are **not** covered: She-Hulk *recommends*
  Daredevil S3, but recommendations don't carry down the chain. Not added; this is your call.

## A. Wrong data (clear errors)

| id | field | board | wiki |
|---|---|---|---|
| secretinvasion | phase | Phase 4 | **Phase 5** (3rd installment) |
| echo | phase | Phase 4 | **Phase 5** (8th installment) |
| echo | release | 2024-01-10 | **2024-01-09** |
| guardiansholiday | phase | Phase 5 | **Phase 4** (18th and final installment) |
| whatif3 | phase | Phase 6 | **Phase 5** (11th installment) |
| marvelzombies | release | 2024-10-04 | **2025-09-24** |
| spidermananimated | release | 2024-11-02 | **2025-01-29** |
| eyesofwakanda | release | 2024-08-06 | **2025-08-01** |
| punisher2 | episodes | 10 | **13** (episode runtimes need re-entering) |
| doomsday | runtime | 150 | **165** |
| marvelzombies | prerequisite | whatif2 | **whatif1** — spin-off of S1 ep. "What If... Zombies?!" |

## B. Phase tags the wiki doesn't use

- **Your Friendly Neighborhood Spider-Man, Eyes of Wakanda, Marvel Zombies** — the wiki
  counts them as MCU but lists them under *Marvel Animation*, not in any Phase.
  Board tags them Phase 6. → Need a decision: new label (e.g. "Marvel Animation") or
  keep Phase tags as a layout grouping.
- **X-Men '97** — has no page on this wiki at all (it isn't treated as MCU). Board tags it
  Phase 5. → Keep as a side-watch like the Fox films, or drop?

## C. Runtimes off by one minute (wiki value)

eternals 156→155, blackwidow 134→133, guardians1 121→120, guardians2 136→137,
thor1 115→114, antman3 125→124, deadpool3 128→127, thunderbolts 127→126.
Low priority — sources disagree by a minute depending on credits.

## D. Missing titles released before today

| Title | Wiki release | Phase | Notes |
|---|---|---|---|
| Werewolf by Night | 2022-10-07 | 4 (special) | 54 min |
| I Am Groot S1 / S2 | 2022-08-10 / 2023-09-06 | 4 / 5 | shorts, 50 min total |
| Wonder Man | 2026-01-27 | 6 | 8 episodes |
| Daredevil: Born Again S2 | 2026-03-24 | 6 | 8 episodes, follows S1 |
| The Punisher: One Last Kill | 2026-05-12 | 6 (special) | 48 min |
| Spider-Man: Brand New Day | 2026-07-31 | 6 | 145 min, follows No Way Home |
| VisionQuest | 2026-10-13 (airing to 11-10) | 6 | 6 episodes |

## E. Story order vs. unlock chain

Wiki viewing timeline compared with every prerequisite link. Only these run "backwards"
in story time; all are defensible as release-order / spoiler links, so no change
suggested unless you want strict chronology:

- Iron Man 2 → The Incredible Hulk / Captain America: The First Avenger (Hulk is set
  during IM2's week; Cap is set in the 1940s)
- Infinity War → Ant-Man and the Wasp / Captain Marvel (both set earlier; the link
  protects their post-credits scenes)
- Endgame → Black Widow (set in 2016)
- Wakanda Forever → Eyes of Wakanda (set in ancient history)

## F. Watch-before links worth adding (wiki story ties)

- antman3 (Quantumania): add **antmanwasp** (only needs Loki S1 now)
- cap4 (Brave New World): add **hulk** (Ross / The Leader) and **eternals** (Celestial Island)
- themarvels: add **captainmarvel** and **wandavision** (Monica Rambeau)
- daredevilbornagain: recommend **daredevil3** and **echo** (Kingpin)

## Checked and correct

Every other release date, phase tag and episode count matches the wiki — all Phase 1–3
films, the rest of Phase 4/5, all Netflix seasons (dates + episode counts), Agatha,
Ironheart, Daredevil: Born Again S1, Loki S1/S2, What If S1–S3, Fantastic Four, Doomsday's
date. Fox X-Men films aren't on this wiki, so they couldn't be checked against it.

Also: the code comment "// PHASE 5" above Moon Knight in projects.js labels a block of
Phase 4 titles — cosmetic.
