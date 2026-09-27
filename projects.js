// Phase 3: declared as `var` (not `const`) so the boot-time fetch from
// /api/content/projects can overwrite this default with the live DB
// version. The literal below remains as the client-side fallback used
// when the fetch fails (offline, server unreachable, network blip).
var projects = [
  // PHASE 1
  { id: "ironman1", title: "Iron Man", release: "2008-05-02", runtime: 126, prerequisites: [], phase: "Phase 1", gridX: 0, gridY: 1, location: "malibu", watched: false, image: "ironman.png" },
  { id: "ironman2", title: "Iron Man 2", release: "2010-05-07", runtime: 124, prerequisites: ["ironman1"], phase: "Phase 1", gridX: 0, gridY: 2, location: "malibu", watched: false, image: "ironman2.png" },
  { id: "hulk", title: "The Incredible Hulk", release: "2008-06-13", runtime: 112, prerequisites: ["ironman2"], phase: "Phase 1", gridX: -2, gridY: 3, location: "harlem", watched: false, image: "hulk.png" },
  { id: "thor1", title: "Thor", release: "2011-05-06", runtime: 115, prerequisites: ["ironman2"], phase: "Phase 1", gridX: -1, gridY: 3, location: "new-mexico", watched: false, image: "thor.png" },
  { id: "cap1", title: "Captain America: The First Avenger", release: "2011-07-22", runtime: 124, prerequisites: ["ironman2"], phase: "Phase 1", gridX: 2, gridY: 3, location: "brooklyn", watched: false, image: "captainAmerica.png" },
  { id: "avengers1", title: "The Avengers", release: "2012-05-04", runtime: 143, prerequisites: ["thor1", "cap1", "hulk"], phase: "Phase 1", gridX: 0, gridY: 4, location: "nyc", watched: false, image: "avengers.png" },

  // PHASE 2
  { id: "ironman3", title: "Iron Man 3", release: "2013-05-03", runtime: 130, prerequisites: ["avengers1"], phase: "Phase 2", gridX: 0, gridY: 5, location: "malibu", watched: false, image: "ironman3.png" },
  { id: "thor2", title: "Thor: The Dark World", release: "2013-11-08", runtime: 112, prerequisites: ["avengers1"], phase: "Phase 2", gridX: -1, gridY: 5, location: "london", watched: false, image: "thor2.png" },
  { id: "cap2", title: "Captain America: The Winter Soldier", release: "2014-04-04", runtime: 136, prerequisites: ["avengers1"], phase: "Phase 2", gridX: 2, gridY: 5, location: "dc", watched: false, image: "captainAmerica2.png" },
  { id: "guardians1", title: "Guardians of the Galaxy", release: "2014-08-01", runtime: 121, prerequisites: [], phase: "Phase 2", gridX: -2, gridY: 5, location: "xandar", watched: false, image: "gotg.png" },
  { id: "ageofultron", title: "Avengers: Age of Ultron", release: "2015-05-01", runtime: 141, prerequisites: ["ironman3", "thor2", "cap2"], phase: "Phase 2", gridX: 0, gridY: 6, location: "sokovia", watched: false, image: "avengers2.png" },
  { id: "antman", title: "Ant-Man", release: "2015-07-17", runtime: 117, prerequisites: ["ageofultron"], phase: "Phase 2", gridX: 3, gridY: 7, location: "sf", watched: false, image: "ant-man.png" },

  // PHASE 3
  { id: "civilwar", title: "Captain America: Civil War", release: "2016-05-06", runtime: 147, prerequisites: ["antman"], phase: "Phase 3", gridX: 2, gridY: 8, location: "nyc", watched: false, image: "captainAmerica3.png" },
  { id: "doctorstrange", title: "Doctor Strange", release: "2016-11-04", runtime: 115, prerequisites: [], phase: "Phase 3", gridX: -3, gridY: 8, location: "hong-kong", watched: false, image: "docstrange.png" },
  { id: "guardians2", title: "Guardians of the Galaxy Vol. 2", release: "2017-05-05", runtime: 136, prerequisites: ["guardians1"], phase: "Phase 3", gridX: -2, gridY: 8, location: "sovereign", watched: false, image: "gotg2.png" },
  { id: "spiderman1", title: "Spider-Man: Homecoming", release: "2017-07-07", runtime: 133, prerequisites: ["civilwar"], phase: "Phase 3", gridX: 1, gridY: 9, location: "queens", watched: false, image: "spider-man.png" },
  { id: "thor3", title: "Thor: Ragnarok", release: "2017-11-03", runtime: 130, prerequisites: ["ageofultron"], phase: "Phase 3", gridX: 1, gridY: 8, location: "sakaar", watched: false, image: "thor3.png" },
  { id: "blackpanther", title: "Black Panther", release: "2018-02-16", runtime: 134, prerequisites: ["civilwar"], phase: "Phase 3", gridX: 3, gridY: 9, location: "wakanda", watched: false, image: "blackPanther.png" },
  { id: "infinitywar", title: "Avengers: Infinity War", release: "2018-04-27", runtime: 149, prerequisites: ["thor3", "blackpanther", "spiderman1", "guardians2", "doctorstrange"], phase: "Phase 3", gridX: 0, gridY: 10, location: "wakanda", watched: false, image: "avengers3.png" },
  { id: "antmanwasp", title: "Ant-Man and the Wasp", release: "2018-07-06", runtime: 118, prerequisites: ["infinitywar"], phase: "Phase 3", gridX: 2, gridY: 11, location: "sf", watched: false, image: "ant-man2.png" },
  { id: "captainmarvel", title: "Captain Marvel", release: "2019-03-08", runtime: 123, prerequisites: ["infinitywar"], phase: "Phase 3", gridX: -1, gridY: 11, location: "hala", watched: false, image: "captainMarvel.png" },
  { id: "endgame", title: "Avengers: Endgame", release: "2019-04-26", runtime: 181, prerequisites: ["antmanwasp", "captainmarvel"], phase: "Phase 3", gridX: 0, gridY: 12, location: "avengers-compound", watched: false, image: "avengers4.png" },
  { id: "farfromhome", title: "Spider-Man: Far From Home", release: "2019-07-02", runtime: 129, prerequisites: ["endgame"], phase: "Phase 3", gridX: -1, gridY: 13, location: "london", watched: false, image: "spider-man2.png" },

  // PHASE 4
  { id: "wandavision", title: "WandaVision", release: "2021-01-15", episodes: [29, 35, 33, 35, 36, 34, 37, 48, 49], prerequisites: ["endgame"], phase: "Phase 4", gridX: 0, gridY: 14, location: "nyc", watched: false, image: "wandavision.png" },
  { id: "falconws", title: "The Falcon and the Winter Soldier", release: "2021-03-19", episodes: [50, 52, 55, 52, 58, 50], prerequisites: ["endgame"], phase: "Phase 4", gridX: 6, gridY: 14, location: "madripoor", watched: false, image: "falconws.png" },
  { id: "loki1", title: "Loki", release: "2021-06-09", episodes: [52, 54, 42, 48, 49, 49], prerequisites: ["endgame"], phase: "Phase 4", gridX: -5, gridY: 14, location: "tva", watched: false, image: "loki.png" },
  { id: "blackwidow", title: "Black Widow", release: "2021-07-09", runtime: 134, prerequisites: ["endgame"], phase: "Phase 4", gridX: 5, gridY: 14, location: "budapest", watched: false, image: "blackwidow.png" },
  { id: "shangchi", title: "Shang-Chi and the Legend of the Ten Rings", release: "2021-09-03", runtime: 132, prerequisites: ["endgame"], phase: "Phase 4", gridX: 2, gridY: 14, location: "ta-lo", watched: false, image: "shangchi.png" },
  { id: "eternals", title: "Eternals", release: "2021-11-05", runtime: 156, prerequisites: ["endgame"], phase: "Phase 4", gridX: 2, gridY: 14, location: "london", watched: false, image: "eternals.png" },
  { id: "hawkeye", title: "Hawkeye", release: "2021-11-24", episodes: [62, 44, 49, 57, 57, 62], prerequisites: ["blackwidow"], phase: "Phase 4", gridX: 3, gridY: 15, location: "nyc", watched: false, image: "hawkeye.png" },
  { id: "whatif1", title: "What If...?", release: "2021-08-11", episodes: [33, 32, 31, 32, 32, 30, 32, 35, 37], prerequisites: ["loki1"], phase: "Phase 4", gridX: -4, gridY: 15, location: "multiverse", watched: false, image: "whatif1.png" },
  { id: "nowayhome", title: "Spider-Man: No Way Home", release: "2021-12-17", runtime: 148, prerequisites: ["farfromhome"], phase: "Phase 4", gridX: -1, gridY: 14, location: "queens", watched: false, image: "spider-man3.png" },

  // PHASE 5
  { id: "moonknight", title: "Moon Knight", release: "2022-03-30", episodes: [47, 52, 51, 52, 50, 43], prerequisites: [], phase: "Phase 4", gridX: 4, gridY: 16, location: "cairo", watched: false, image: "moonknight.png" },
  { id: "drstrange2", title: "Doctor Strange in the Multiverse of Madness", release: "2022-05-06", runtime: 126, prerequisites: ["wandavision", "nowayhome"], phase: "Phase 4", gridX: -1, gridY: 16, location: "multiverse", watched: false, image: "docstrange2.png" },
  { id: "msmarvel", title: "Ms. Marvel", release: "2022-06-08", episodes: [48, 48, 47, 46, 45, 50], prerequisites: ["endgame"], phase: "Phase 4", gridX: 1, gridY: 16, location: "karachi", watched: false, image: "msmarvel.png" },
  { id: "thor4", title: "Thor: Love and Thunder", release: "2022-07-08", runtime: 119, prerequisites: ["endgame"], phase: "Phase 4", gridX: -2, gridY: 16, location: "new-asgard", watched: false, image: "thor4.png" },
  { id: "shehulk", title: "She-Hulk: Attorney at Law", release: "2022-08-18", episodes: [36, 30, 32, 32, 34, 33, 34, 30, 37], prerequisites: ["endgame", "daredevil3"], phase: "Phase 4", gridX: 3, gridY: 16, location: "nyc", watched: false, image: "shehulk.png" },
  { id: "blackpanther2", title: "Black Panther: Wakanda Forever", release: "2022-11-11", runtime: 161, prerequisites: ["endgame"], phase: "Phase 4", gridX: 2, gridY: 17, location: "wakanda", watched: false, image: "blackPanther2.png" },
  { id: "antman3", title: "Ant-Man and the Wasp: Quantumania", release: "2023-02-17", runtime: 125, prerequisites: ["loki1"], phase: "Phase 5", gridX: -5, gridY: 17, location: "quantum", watched: false, image: "ant-man3.png" },
  { id: "guardiansholiday", title: "The Guardians of the Galaxy Holiday Special", release: "2022-11-25", runtime: 44, prerequisites: ["endgame"], phase: "Phase 5", gridX: -3, gridY: 17, location: "knowhere", watched: false, image: "guardians-holiday.png" },
  { id: "guardians3", title: "Guardians of the Galaxy Vol. 3", release: "2023-05-05", runtime: 150, prerequisites: ["guardiansholiday"], phase: "Phase 5", gridX: -3, gridY: 18, location: "counter-earth", watched: false, image: "gotg3.png" },
  { id: "secretinvasion", title: "Secret Invasion", release: "2023-06-21", episodes: [57, 47, 43, 48, 38, 42], prerequisites: ["endgame"], phase: "Phase 4", gridX: 2, gridY: 16, location: "london", watched: false, image: "secretinvasion.png" },
  { id: "loki2", title: "Loki (Season 2)", release: "2023-10-05", episodes: [48, 55, 51, 52, 49, 58], prerequisites: ["loki1"], phase: "Phase 5", gridX: -6, gridY: 18, location: "tva", watched: false, image: "loki2.png" },
  { id: "themarvels", title: "The Marvels", release: "2023-11-10", runtime: 105, prerequisites: ["msmarvel", "secretinvasion"], phase: "Phase 5", gridX: 1, gridY: 18, location: "hala", watched: false, image: "themarvels.png" },

  // PHASE 6 (released so far)
  { id: "echo", title: "Echo", release: "2024-01-10", episodes: [50, 38, 37, 39, 37], prerequisites: ["hawkeye"], phase: "Phase 4", gridX: 4, gridY: 19, location: "nola", watched: false, image: "echo.png" },
  { id: "deadpool3", title: "Deadpool & Wolverine", release: "2024-07-26", runtime: 128, prerequisites: ["loki2"], phase: "Phase 5", gridX: -6, gridY: 19, location: "multiverse", watched: false, image: "deadpool3.png" },
  { id: "whatif2", title: "What If...? | Season 2", release: "2023-12-22", episodes: [32, 31, 32, 30, 33, 32, 32, 31, 35], prerequisites: ["whatif1"], phase: "Phase 5", gridX: -4, gridY: 19, location: "multiverse", watched: false, image: "whatif2.png" },
  { id: "whatif3", title: "What If...? | Season 3", release: "2024-12-22", episodes: [30, 31, 30, 31, 30, 30, 32, 34], prerequisites: ["whatif2"], phase: "Phase 6", gridX: -4, gridY: 20, location: "multiverse", watched: false, image: "whatif3.png" },
  { id: "xmen97", title: "X-Men '97", release: "2024-03-20", episodes: [30, 32, 30, 30, 33, 31, 30, 31, 34, 39], prerequisites: [], phase: "Phase 5", gridX: -3, gridY: 19, location: "multiverse", watched: false, image: "xmen97.png" },
  { id: "marvelzombies", title: "Marvel Zombies", release: "2024-10-04", episodes: [35, 33, 34, 37], prerequisites: ["whatif2"], phase: "Phase 6", gridX: -3, gridY: 20, location: "multiverse", watched: false, image: "marvelzombies.png" },
  { id: "agatha", title: "Agatha All Along", release: "2024-09-18", episodes: [41, 34, 40, 34, 34, 40, 46, 32, 54], prerequisites: ["wandavision"], phase: "Phase 5", gridX: 0, gridY: 19, location: "nyc", watched: false, image: "agatha.png" },
  { id: "spidermananimated", title: "Your Friendly Neighborhood Spider-Man", release: "2024-11-02", episodes: [26, 24, 25, 24, 24, 25, 24, 25, 24, 26], prerequisites: [], phase: "Phase 6", gridX: -1, gridY: 19, location: "queens", watched: false, image: "spiderman-animated.png" },
  { id: "daredevilbornagain", title: "Daredevil: Born Again", release: "2025-03-04", episodes: [52, 39, 39, 44, 42, 47, 48, 43, 52], prerequisites: ["shehulk"], phase: "Phase 5", gridX: 3, gridY: 20, location: "hells-kitchen", watched: false, image: "daredevil.png" },
  { id: "ironheart", title: "Ironheart", release: "2025-06-24", episodes: [46, 45, 42, 44, 43, 49], prerequisites: ["blackpanther2"], phase: "Phase 5", gridX: 1, gridY: 20, location: "chicago", watched: false, image: "ironheart.png" },
  { id: "eyesofwakanda", title: "Eyes of Wakanda", release: "2024-08-06", episodes: [29, 28, 28, 29], prerequisites: ["blackpanther2"], phase: "Phase 6", gridX: 2, gridY: 20, location: "wakanda", watched: false, image: "eyesofwakanda.png" },
  { id: "cap4", title: "Captain America: Brave New World", release: "2025-02-14", runtime: 118, prerequisites: ["falconws"], phase: "Phase 5", gridX: 6, gridY: 21, location: "dc", watched: false, image: "cap4.png" },
  { id: "thunderbolts", title: "Thunderbolts*", release: "2025-05-02", runtime: 127, prerequisites: ["blackwidow", "falconws"], phase: "Phase 5", gridX: 5, gridY: 21, location: "nyc", watched: false, image: "thunderbolts.png" },
  { id: "fantasticfour", title: "The Fantastic Four: First Steps", release: "2025-07-25", runtime: 115, prerequisites: [], phase: "Phase 6", gridX: 1, gridY: 21, location: "nyc", watched: false, image: "fantasticfour.png" },

  // NETFLIX SAGA (MCU STREET-LEVEL ERA) — anchored in the five NYC boroughs.
  // Hell's Kitchen: Daredevil / Jessica Jones (Alias Investigations is on
  // 46th St) / Iron Fist (Rand HQ operates street-level here) / Defenders
  // (team-up base) / Punisher. Harlem: Luke Cage (Pop's, Harlem's Paradise).
  // DAREDEVIL — Matt Murdock's firm is in Hell's Kitchen
  { id: "daredevil1", title: "Daredevil", release: "2015-04-10", episodes: [53, 55, 51, 55, 54, 54, 57, 55, 52, 57, 58, 56, 58], prerequisites: [], hiddenPrerequisites: ["ironman1"], phase: "Phase 1", gridX: 5, gridY: 1, location: "hells-kitchen", watched: false, image: "daredevil1.png" },
  { id: "daredevil2", title: "Daredevil | Season 2", release: "2016-03-18", episodes: [49, 52, 55, 48, 56, 50, 53, 55, 55, 54, 54, 55, 59], prerequisites: ["daredevil1"], phase: "Phase 1", gridX: 5, gridY: 2, location: "hells-kitchen", watched: false, image: "daredevils2.png" },
  { id: "daredevil3", title: "Daredevil | Season 3", release: "2018-10-19", episodes: [59, 52, 53, 58, 60, 55, 58, 56, 59, 53, 59, 55, 63], prerequisites: ["defenders"], phase: "Phase 1", gridX: 5, gridY: 5, location: "hells-kitchen", watched: false, image: "daredevils3.png" },
  // JESSICA JONES — Alias Investigations at 485 W 46th St (Hell's Kitchen)
  { id: "jessicajones1", title: "Jessica Jones", release: "2015-11-20", episodes: [53, 52, 51, 50, 51, 55, 49, 51, 52, 51, 52, 54, 53], prerequisites: ["daredevil1"], phase: "Phase 1", gridX: 6, gridY: 2, location: "hells-kitchen", watched: false, image: "jessicajones.png" },
  { id: "jessicajones2", title: "Jessica Jones | Season 2", release: "2018-03-08", episodes: [54, 54, 49, 52, 52, 54, 53, 53, 53, 52, 52, 55, 58], prerequisites: ["defenders"], phase: "Phase 1", gridX: 6, gridY: 5, location: "hells-kitchen", watched: false, image: "jessicajoness2.png" },
  { id: "jessicajones3", title: "Jessica Jones | Season 3", release: "2019-06-14", episodes: [53, 55, 52, 52, 52, 53, 53, 52, 53, 53, 53, 52, 56], prerequisites: ["jessicajones2"], phase: "Phase 1", gridX: 6, gridY: 6, location: "hells-kitchen", watched: false, image: "jessicajoness3.png" },
  // LUKE CAGE — Harlem is his whole beat
  { id: "lukecage1", title: "Luke Cage", release: "2016-09-30", episodes: [55, 57, 54, 53, 52, 54, 52, 55, 53, 55, 56, 56, 55], prerequisites: ["jessicajones1"], phase: "Phase 1", gridX: 7, gridY: 3, location: "harlem", watched: false, image: "lukecage1.png" },
  { id: "lukecage2", title: "Luke Cage | Season 2", release: "2018-06-22", episodes: [55, 55, 54, 55, 52, 57, 54, 54, 60, 57, 55, 56, 63], prerequisites: ["defenders"], phase: "Phase 1", gridX: 7, gridY: 5, location: "harlem", watched: false, image: "lukecage2.png" },
  // IRON FIST
  { id: "ironfist1", title: "Iron Fist", release: "2017-03-17", episodes: [58, 55, 51, 52, 56, 56, 53, 53, 54, 50, 56, 54, 57], prerequisites: ["daredevil2"], phase: "Phase 1", gridX: 4, gridY: 3, location: "hells-kitchen", watched: false, image: "ironfist1.png" },
  { id: "ironfist2", title: "Iron Fist | Season 2", release: "2018-09-07", episodes: [54, 50, 51, 51, 51, 55, 51, 47, 51, 57], prerequisites: ["defenders"], phase: "Phase 1", gridX: 4, gridY: 5, location: "hells-kitchen", watched: false, image: "ironfist2.png" },
  // THE DEFENDERS (CROSSOVER EVENT) — team-up meets in Hell's Kitchen
  { id: "defenders", title: "The Defenders", release: "2017-08-18", episodes: [54, 49, 46, 51, 49, 46, 50, 48], prerequisites: ["daredevil2", "jessicajones1", "lukecage1", "ironfist1"], phase: "Phase 1", gridX: 5, gridY: 4, location: "hells-kitchen", watched: false, image: "defenders.png" },
  // THE PUNISHER — Frank Castle operates out of Hell's Kitchen
  { id: "punisher1", title: "The Punisher", release: "2017-11-17", episodes: [53, 52, 54, 50, 55, 49, 53, 57, 49, 55, 46, 57, 53], prerequisites: ["daredevil2"], phase: "Phase 1", gridX: 8, gridY: 4, location: "hells-kitchen", watched: false, image: "punisher.png" },
  { id: "punisher2", title: "The Punisher | Season 2", release: "2019-01-18", episodes: [53, 52, 50, 50, 53, 51, 54, 57, 54, 58], prerequisites: ["punisher1"], phase: "Phase 1", gridX: 8, gridY: 5, location: "hells-kitchen", watched: false, image: "punisher2.png" }

];
