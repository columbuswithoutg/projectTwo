const projects = [
  // PHASE 1
  { id: "ironman1", title: "Iron Man", release: "2008-05-02", prerequisites: [], phase: "Phase 1", gridX: 0, gridY: 1, watched: false, image: "ironman.png" },
  { id: "ironman2", title: "Iron Man 2", release: "2010-05-07", prerequisites: ["ironman1"], phase: "Phase 1", gridX: 0, gridY: 2, watched: false, image: "ironman2.png" },
  { id: "hulk", title: "The Incredible Hulk", release: "2008-06-13", prerequisites: ["ironman2"], phase: "Phase 1", gridX: -2, gridY: 3, watched: false, image: "hulk.png" },
  { id: "thor1", title: "Thor", release: "2011-05-06", prerequisites: ["ironman2"], phase: "Phase 1", gridX: -1, gridY: 3, watched: false, image: "thor.png" },
  { id: "cap1", title: "Captain America: The First Avenger", release: "2011-07-22", prerequisites: ["ironman2"], phase: "Phase 1", gridX: 2, gridY: 3, watched: false, image: "captainAmerica.png" },
  { id: "avengers1", title: "The Avengers", release: "2012-05-04", prerequisites: ["thor1", "cap1", "hulk"], phase: "Phase 1", gridX: 0, gridY: 4, watched: false, image: "avengers.png" },

  // PHASE 2
  { id: "ironman3", title: "Iron Man 3", release: "2013-05-03", prerequisites: ["avengers1"], phase: "Phase 2", gridX: 0, gridY: 5, watched: false, image: "ironman3.png" },
  { id: "thor2", title: "Thor: The Dark World", release: "2013-11-08", prerequisites: ["avengers1"], phase: "Phase 2", gridX: -1, gridY: 5, watched: false, image: "thor2.png" },
  { id: "cap2", title: "Captain America: The Winter Soldier", release: "2014-04-04", prerequisites: ["avengers1"], phase: "Phase 2", gridX: 2, gridY: 5, watched: false, image: "captainAmerica2.png" },
  { id: "guardians1", title: "Guardians of the Galaxy", release: "2014-08-01", prerequisites: [], phase: "Phase 2", gridX: -2, gridY: 5, watched: false, image: "gotg.png" },
  { id: "ageofultron", title: "Avengers: Age of Ultron", release: "2015-05-01", prerequisites: ["ironman3", "thor2", "cap2"], phase: "Phase 2", gridX: 0, gridY: 6, watched: false, image: "avengers2.png" },
  { id: "antman", title: "Ant-Man", release: "2015-07-17", prerequisites: ["ageofultron"], phase: "Phase 2", gridX: 3, gridY: 7, watched: false, image: "ant-man.png" },

  // PHASE 3
  { id: "civilwar", title: "Captain America: Civil War", release: "2016-05-06", prerequisites: ["antman"], phase: "Phase 3", gridX: 2, gridY: 8, watched: false, image: "captainAmerica3.png" },
  { id: "doctorstrange", title: "Doctor Strange", release: "2016-11-04", prerequisites: [], phase: "Phase 3", gridX: -3, gridY: 8, watched: false, image: "docstrange.png" },
  { id: "guardians2", title: "Guardians of the Galaxy Vol. 2", release: "2017-05-05", prerequisites: ["guardians1"], phase: "Phase 3", gridX: -2, gridY: 8, watched: false, image: "gotg2.png" },
  { id: "spiderman1", title: "Spider-Man: Homecoming", release: "2017-07-07", prerequisites: ["civilwar"], phase: "Phase 3", gridX: 1, gridY: 9, watched: false, image: "spider-man.png" },
  { id: "thor3", title: "Thor: Ragnarok", release: "2017-11-03", prerequisites: ["ageofultron"], phase: "Phase 3", gridX: 1, gridY: 8, watched: false, image: "thor3.png" },
  { id: "blackpanther", title: "Black Panther", release: "2018-02-16", prerequisites: ["civilwar"], phase: "Phase 3", gridX: 3, gridY: 9, watched: false, image: "blackPanther.png" },
  { id: "infinitywar", title: "Avengers: Infinity War", release: "2018-04-27", prerequisites: ["thor3", "blackpanther", "spiderman1", "guardians2", "doctorstrange"], phase: "Phase 3", gridX: 0, gridY: 10, watched: false, image: "avengers3.png" },
  { id: "antmanwasp", title: "Ant-Man and the Wasp", release: "2018-07-06", prerequisites: ["infinitywar"], phase: "Phase 3", gridX: 2, gridY: 11, watched: false, image: "ant-man2.png" },
  { id: "captainmarvel", title: "Captain Marvel", release: "2019-03-08", prerequisites: ["infinitywar"], phase: "Phase 3", gridX: -1, gridY: 11, watched: false, image: "captainMarvel.png" },
  { id: "endgame", title: "Avengers: Endgame", release: "2019-04-26", prerequisites: ["antmanwasp", "captainmarvel"], phase: "Phase 3", gridX: 0, gridY: 12, watched: false, image: "avengers4.png" },
  { id: "farfromhome", title: "Spider-Man: Far From Home", release: "2019-07-02", prerequisites: ["endgame"], phase: "Phase 3", gridX: -1, gridY: 13, watched: false, image: "spider-man2.png" },

  // PHASE 4
  { id: "wandavision", title: "WandaVision", release: "2021-01-15", prerequisites: ["endgame"], phase: "Phase 4", gridX: 0, gridY: 14, watched: false, image: "wandavision.png" },
  { id: "falconws", title: "The Falcon and the Winter Soldier", release: "2021-03-19", prerequisites: ["endgame"], phase: "Phase 4", gridX: 6, gridY: 14, watched: false, image: "falconws.png" },
  { id: "loki1", title: "Loki", release: "2021-06-09", prerequisites: ["endgame"], phase: "Phase 4", gridX: -5, gridY: 14, watched: false, image: "loki.png" },
  { id: "blackwidow", title: "Black Widow", release: "2021-07-09", prerequisites: ["endgame"], phase: "Phase 4", gridX: 5, gridY: 14, watched: false, image: "blackwidow.png" },
  { id: "shangchi", title: "Shang-Chi and the Legend of the Ten Rings", release: "2021-09-03", prerequisites: ["endgame"], phase: "Phase 4", gridX: 2, gridY: 14, watched: false, image: "shangchi.png" },
  { id: "eternals", title: "Eternals", release: "2021-11-05", prerequisites: ["endgame"], phase: "Phase 4", gridX: 2, gridY: 14, watched: false, image: "eternals.png" },
  { id: "hawkeye", title: "Hawkeye", release: "2021-11-24", prerequisites: ["blackwidow"], phase: "Phase 4", gridX: 3, gridY: 15, watched: false, image: "hawkeye.png" },
  { id: "whatif1", title: "What If...?", release: "2021-08-11", prerequisites: ["loki1"], phase: "Phase 4", gridX: -4, gridY: 15, watched: false, image: "whatif1.png" },
  { id: "nowayhome", title: "Spider-Man: No Way Home", release: "2021-12-17", prerequisites: ["farfromhome"], phase: "Phase 4", gridX: -1, gridY: 14, watched: false, image: "spider-man3.png" },

  // PHASE 5
  { id: "moonknight", title: "Moon Knight", release: "2022-03-30", prerequisites: [], phase: "Phase 5", gridX: 4, gridY: 16, watched: false, image: "moonknight.png" },
  { id: "drstrange2", title: "Doctor Strange in the Multiverse of Madness", release: "2022-05-06", prerequisites: ["wandavision", "nowayhome"], phase: "Phase 5", gridX: -1, gridY: 16, watched: false, image: "docstrange2.png" },
  { id: "msmarvel", title: "Ms. Marvel", release: "2022-06-08", prerequisites: ["endgame"], phase: "Phase 5", gridX: 1, gridY: 16, watched: false, image: "msmarvel.png" },
  { id: "thor4", title: "Thor: Love and Thunder", release: "2022-07-08", prerequisites: ["endgame"], phase: "Phase 5", gridX: -2, gridY: 16, watched: false, image: "thor4.png" },
  { id: "shehulk", title: "She-Hulk: Attorney at Law", release: "2022-08-18", prerequisites: ["endgame", "daredevil3"], phase: "Phase 5", gridX: 3, gridY: 16, watched: false, image: "shehulk.png" },
  { id: "blackpanther2", title: "Black Panther: Wakanda Forever", release: "2022-11-11", prerequisites: ["endgame"], phase: "Phase 5", gridX: 2, gridY: 17, watched: false, image: "blackPanther2.png" },
  { id: "antman3", title: "Ant-Man and the Wasp: Quantumania", release: "2023-02-17", prerequisites: ["loki1"], phase: "Phase 5", gridX: -5, gridY: 17, watched: false, image: "ant-man3.png" },
  { id: "guardiansholiday", title: "The Guardians of the Galaxy Holiday Special", release: "2022-11-25", prerequisites: ["endgame"], phase: "Phase 5", gridX: -3, gridY: 17, watched: false, image: "guardians-holiday.png" },
  { id: "guardians3", title: "Guardians of the Galaxy Vol. 3", release: "2023-05-05", prerequisites: ["guardiansholiday"], phase: "Phase 5", gridX: -3, gridY: 18, watched: false, image: "gotg3.png" },
  { id: "secretinvasion", title: "Secret Invasion", release: "2023-06-21", prerequisites: ["endgame"], phase: "Phase 5", gridX: 2, gridY: 16, watched: false, image: "secretinvasion.png" },
  { id: "loki2", title: "Loki (Season 2)", release: "2023-10-05", prerequisites: ["loki1"], phase: "Phase 5", gridX: -6, gridY: 18, watched: false, image: "loki2.png" },
  { id: "themarvels", title: "The Marvels", release: "2023-11-10", prerequisites: ["msmarvel", "secretinvasion"], phase: "Phase 5", gridX: 1, gridY: 18, watched: false, image: "themarvels.png" },

  // PHASE 6 (released so far)
  { id: "echo", title: "Echo", release: "2024-01-10", prerequisites: ["hawkeye"], phase: "Phase 6", gridX: 4, gridY: 19, watched: false, image: "echo.png" },
  { id: "deadpool3", title: "Deadpool & Wolverine", release: "2024-07-26", prerequisites: ["loki2"], phase: "Phase 6", gridX: -6, gridY: 19, watched: false, image: "deadpool3.png" },
  { id: "whatif2", title: "What If...? | Season 2", release: "2023-12-22", prerequisites: ["whatif1"], phase: "Phase 5", gridX: -4, gridY: 19, watched: false, image: "whatif2.png" },
  { id: "whatif3", title: "What If...? | Season 3", release: "2024-12-22", prerequisites: ["whatif2"], phase: "Phase 6", gridX: -4, gridY: 20, watched: false, image: "whatif3.png" },
  { id: "xmen97", title: "X-Men '97", release: "2024-03-20", prerequisites: [], phase: "Phase 5", gridX: -3, gridY: 19, watched: false, image: "xmen97.png" },
  { id: "marvelzombies", title: "Marvel Zombies", release: "2024-10-04", prerequisites: ["whatif2"], phase: "Phase 6", gridX: -3, gridY: 20, watched: false, image: "marvelzombies.png" },
  { id: "agatha", title: "Agatha All Along", release: "2024-09-18", prerequisites: ["wandavision"], phase: "Phase 5", gridX: 0, gridY: 19, watched: false, image: "agatha.png" },
  { id: "spidermananimated", title: "Your Friendly Neighborhood Spider-Man", release: "2024-11-02", prerequisites: [], phase: "Phase 6", gridX: -1, gridY: 19, watched: false, image: "spiderman-animated.png" },
  { id: "daredevilbornagain", title: "Daredevil: Born Again", release: "2025-03-04", prerequisites: ["shehulk"], phase: "Phase 6", gridX: 3, gridY: 20, watched: false, image: "daredevil.png" },
  { id: "ironheart", title: "Ironheart", release: "2025-06-24", prerequisites: ["blackpanther2"], phase: "Phase 6", gridX: 1, gridY: 20, watched: false, image: "ironheart.png" },
  { id: "eyesofwakanda", title: "Eyes of Wakanda", release: "2024-08-06", prerequisites: ["blackpanther2"], phase: "Phase 6", gridX: 2, gridY: 20, watched: false, image: "eyesofwakanda.png" },
  { id: "cap4", title: "Captain America: Brave New World", release: "2025-02-14", prerequisites: ["falconws"], phase: "Phase 6", gridX: 6, gridY: 21, watched: false, image: "cap4.png" },
  { id: "thunderbolts", title: "Thunderbolts*", release: "2025-05-02", prerequisites: ["blackwidow", "falconws"], phase: "Phase 6", gridX: 5, gridY: 21, watched: false, image: "thunderbolts.png" },
  { id: "fantasticfour", title: "The Fantastic Four: First Steps", release: "2025-07-25", prerequisites: [], phase: "Phase 6", gridX: 1, gridY: 21, watched: false, image: "fantasticfour.png" },

  // NETFLIX SAGA (MCU STREET-LEVEL ERA)
  // DAREDEVIL
  { id: "daredevil1", title: "Daredevil", release: "2015-04-10", prerequisites: ["ironman1"], phase: "Phase 1", gridX: 5, gridY: 1, watched: false, image: "daredevil1.png" },
  { id: "daredevil2", title: "Daredevil | Season 2", release: "2016-03-18", prerequisites: ["daredevil1"], phase: "Phase 1", gridX: 5, gridY: 2, watched: false, image: "daredevils2.png" },
  { id: "daredevil3", title: "Daredevil | Season 3", release: "2018-10-19", prerequisites: ["defenders"], phase: "Phase 1", gridX: 5, gridY: 5, watched: false, image: "daredevils3.png" },
  // JESSICA JONES
  { id: "jessicajones1", title: "Jessica Jones", release: "2015-11-20", prerequisites: ["daredevil1"], phase: "Phase 1", gridX: 6, gridY: 2, watched: false, image: "jessicajones.png" },
  { id: "jessicajones2", title: "Jessica Jones | Season 2", release: "2018-03-08", prerequisites: ["defenders"], phase: "Phase 1", gridX: 6, gridY: 5, watched: false, image: "jessicajoness2.png" },
  { id: "jessicajones3", title: "Jessica Jones | Season 3", release: "2019-06-14", prerequisites: ["jessicajones2"], phase: "Phase 1", gridX: 6, gridY: 6, watched: false, image: "jessicajoness3.png" },
  // LUKE CAGE
  { id: "lukecage1", title: "Luke Cage", release: "2016-09-30", prerequisites: ["jessicajones1"], phase: "Phase 1", gridX: 7, gridY: 3, watched: false, image: "lukecage1.png" },
  { id: "lukecage2", title: "Luke Cage | Season 2", release: "2018-06-22", prerequisites: ["defenders"], phase: "Phase 1", gridX: 7, gridY: 5, watched: false, image: "lukecage2.png" },
  // IRON FIST
  { id: "ironfist1", title: "Iron Fist", release: "2017-03-17", prerequisites: ["daredevil2"], phase: "Phase 1", gridX: 4, gridY: 3, watched: false, image: "ironfist1.png" },
  { id: "ironfist2", title: "Iron Fist | Season 2", release: "2018-09-07", prerequisites: ["defenders"], phase: "Phase 1", gridX: 4, gridY: 5, watched: false, image: "ironfist2.png" },
  // THE DEFENDERS (CROSSOVER EVENT)
  { id: "defenders", title: "The Defenders", release: "2017-08-18", prerequisites: ["daredevil2", "jessicajones1", "lukecage1", "ironfist1"], phase: "Phase 1", gridX: 5, gridY: 4, watched: false, image: "defenders.png" },
  // THE PUNISHER
  { id: "punisher1", title: "The Punisher", release: "2017-11-17", prerequisites: ["daredevil2"], phase: "Phase 1", gridX: 8, gridY: 4, watched: false, image: "punisher.png" },
  { id: "punisher2", title: "The Punisher | Season 2", release: "2019-01-18", prerequisites: ["punisher1"], phase: "Phase 1", gridX: 8, gridY: 5, watched: false, image: "punisher2.png" }

];
