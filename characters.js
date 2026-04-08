/************************************************
 * CHARACTERS DATABASE
 * debut: matches exact node IDs from projects.js
 ************************************************/
const characters = [

  // ─── PHASE 1 ───────────────────────────────
  { id: "ironman",        name: "Iron Man",                   debut: "ironman1",      image: "ironman.jpg",
    stages: [
      { after: "avengers1",   image: "ironman_avengers.jpg",   look: "Avengers suit, Mark VII" },
      { after: "infinitywar",  image: "ironman_nano.jpg",       look: "Nanotech bleeding edge suit" }
    ] },
  { id: "pepper",         name: "Pepper Potts",               debut: "ironman1",      image: "pepper.jpg" },
  { id: "happy",          name: "Happy Hogan",                debut: "ironman1",      image: "happy.jpg" },
  { id: "rhodey",         name: "James Rhodes",               debut: "ironman1",      image: "rhodey.jpg" },
  { id: "nick_fury",      name: "Nick Fury",                  debut: "ironman1",      image: "nickfury.jpg",
    stages: [
      { after: "secretinvasion", image: "nickfury_si.jpg", look: "Secret Invasion era, older, battle-worn" }
    ] },
  { id: "coulson",        name: "Agent Coulson",              debut: "ironman1",      image: "coulson.jpg" },
  { id: "blackwidow",     name: "Black Widow",                debut: "ironman2",      image: "blackwidow.jpg",
    stages: [
      { after: "infinitywar", image: "blackwidow_blonde.jpg", look: "Blonde hair, Infinity War era" },
      { after: "blackwidow",  image: "blackwidow_white.jpg",  look: "White suit, Black Widow movie" }
    ] },
  { id: "hulk",           name: "Hulk",                       debut: "hulk",          image: "hulk.jpg",
    stages: [
      { after: "thor3",    image: "hulk_gladiator.jpg", look: "Sakaar gladiator armor, war paint" },
      { after: "endgame",  image: "hulk_smart.jpg",     look: "Smart Hulk, glasses, calm" }
    ] },
  { id: "bettyross",      name: "Betty Ross",                 debut: "hulk",          image: "bettyross.jpg" },
  { id: "abomnination",   name: "Abomination",                debut: "hulk",          image: "abomination.jpg" },
  { id: "thor",           name: "Thor",                       debut: "thor1",         image: "thor.jpg",
    stages: [
      { after: "thor3", image: "thor_ragnarok.jpg",     look: "Short hair, Ragnarok armor" },
      { after: "thor4", image: "thor_lovethunder.jpg",  look: "Love & Thunder outfit, blue/gold" }
    ] },
  { id: "loki",           name: "Loki",                       debut: "thor1",         image: "loki.jpg",
    stages: [
      { after: "loki1", image: "loki_tva.jpg", look: "TVA suit variant" },
      { after: "loki2", image: "loki_s2.jpg",  look: "God of Stories, throne at end of time" }
    ] },
  { id: "janefoster",     name: "Jane Foster",                debut: "thor1",         image: "janefoster.jpg" },
  { id: "hawkeye",        name: "Hawkeye",                    debut: "thor1",         image: "hawkeye.jpg",
    stages: [
      { after: "hawkeye", image: "hawkeye_ronin.jpg", look: "Ronin/mentor era, darker look" }
    ] },
  { id: "heimdall",       name: "Heimdall",                   debut: "thor1",         image: "heimdall.jpg" },
  { id: "cap",            name: "Captain America",            debut: "cap1",          image: "cap.jpg",
    stages: [
      { after: "avengers1", image: "cap_avengers.jpg", look: "Avengers blue suit, modern" },
      { after: "cap2",      image: "cap_stealth.jpg",  look: "Dark stealth suit, SHIELD era" },
      { after: "endgame",   image: "cap_endgame.jpg",  look: "Scale mail Endgame suit" }
    ] },
  { id: "peggy",          name: "Peggy Carter",               debut: "cap1",          image: "peggy.jpg" },
  { id: "bucky",          name: "Bucky Barnes",               debut: "cap1",          image: "bucky.jpg",
    stages: [
      { after: "blackpanther", image: "bucky_wakanda.jpg", look: "Vibranium arm, Wakanda look" }
    ] },
  { id: "redskull",       name: "Red Skull",                  debut: "cap1",          image: "redskull.jpg" },
  { id: "howardstark",    name: "Howard Stark",               debut: "cap1",          image: "howardstark.jpg" },
  { id: "thanos_snap",    name: "Thanos",                     debut: "avengers1",     image: "thanos.jpg" },

  // ─── PHASE 2 ───────────────────────────────
  { id: "killian",        name: "Aldrich Killian",            debut: "ironman3",      image: "killian.jpg" },
  { id: "malekith",       name: "Malekith",                   debut: "thor2",         image: "malekith.jpg" },
  { id: "falcon",         name: "Falcon",                     debut: "cap2",          image: "falcon.jpg",
    stages: [
      { after: "falconws", image: "falcon_cap.jpg", look: "Captain America suit with wings" }
    ] },
  { id: "wintersolider",  name: "Winter Soldier",             debut: "cap2",          image: "wintersoldier.jpg" },
  { id: "starlord",       name: "Star-Lord",                  debut: "guardians1",    image: "starlord.jpg" },
  { id: "gamora",         name: "Gamora",                     debut: "guardians1",    image: "gamora.jpg",
    stages: [
      { after: "guardians3", image: "gamora_variant.jpg", look: "Alternate Gamora, armored, Guardians 3" }
    ] },
  { id: "drax",           name: "Drax",                       debut: "guardians1",    image: "drax.jpg" },
  { id: "rocket",         name: "Rocket",                     debut: "guardians1",    image: "rocket.jpg" },
  { id: "groot",          name: "Groot",                      debut: "guardians1",    image: "groot.jpg",
    stages: [
      { after: "guardians2",  image: "groot_baby.jpg",  look: "Baby Groot, small and cute" },
      { after: "infinitywar", image: "groot_teen.jpg",  look: "Teen Groot with attitude" }
    ] },
  { id: "nebula",         name: "Nebula",                     debut: "guardians1",    image: "nebula.jpg",
    stages: [
      { after: "endgame", image: "nebula_hero.jpg", look: "Hero Nebula, gold plating, softer look" }
    ] },
  { id: "ronan",          name: "Ronan the Accuser",          debut: "guardians1",    image: "ronan.jpg" },
  { id: "yondu",          name: "Yondu",                      debut: "guardians1",    image: "yondu.jpg" },
  { id: "wanda_wv",       name: "Wanda Maximoff",             debut: "ageofultron",   image: "wanda.jpg",
    stages: [
      { after: "wandavision", image: "wanda_scarletwitch.jpg", look: "Scarlet Witch with crown/headpiece" }
    ] },
  { id: "quicksilver",    name: "Quicksilver",                debut: "ageofultron",   image: "quicksilver.jpg" },
  { id: "vision",         name: "Vision",                     debut: "ageofultron",   image: "vision.jpg" },
  { id: "ultron",         name: "Ultron",                     debut: "ageofultron",   image: "ultron.jpg" },
  { id: "antman",         name: "Ant-Man",                    debut: "antman",        image: "antman.jpg" },
  { id: "wasp_hope",      name: "Hope Van Dyne",              debut: "antman",        image: "hope.jpg" },
  { id: "hankpym",        name: "Hank Pym",                   debut: "antman",        image: "hankpym.jpg" },

  // ─── PHASE 3 ───────────────────────────────
  { id: "spiderman",      name: "Spider-Man",                 debut: "civilwar",      image: "spiderman.jpg",
    stages: [
      { after: "spiderman1", image: "spiderman_stark.jpg",      look: "Red/blue Stark suit, Homecoming" },
      { after: "nowayhome",  image: "spiderman_integrated.jpg", look: "Black/gold integrated suit, No Way Home" }
    ] },
  { id: "blackpanther",   name: "Black Panther",              debut: "civilwar",      image: "blackpanther.jpg" },
  { id: "zemo",           name: "Baron Zemo",                 debut: "civilwar",      image: "zemo.jpg" },
  { id: "drstrange",      name: "Doctor Strange",             debut: "doctorstrange", image: "drstrange.jpg" },
  { id: "wong",           name: "Wong",                       debut: "doctorstrange", image: "wong.jpg" },
  { id: "dormammu",       name: "Dormammu",                   debut: "doctorstrange", image: "dormammu.jpg" },
  { id: "mantis",         name: "Mantis",                     debut: "guardians2",    image: "mantis.jpg" },
  { id: "ego",            name: "Ego the Living Planet",      debut: "guardians2",    image: "ego.jpg" },
  { id: "valkyrie",       name: "Valkyrie",                   debut: "thor3",         image: "valkyrie.jpg" },
  { id: "hela",           name: "Hela",                       debut: "thor3",         image: "hela.jpg" },
  { id: "grandmaster",    name: "Grandmaster",                debut: "thor3",         image: "grandmaster.jpg" },
  { id: "shuri",          name: "Shuri",                      debut: "blackpanther",  image: "shuri.jpg" },
  { id: "okoye",          name: "Okoye",                      debut: "blackpanther",  image: "okoye.jpg" },
  { id: "killmonger",     name: "Killmonger",                 debut: "blackpanther",  image: "killmonger.jpg" },
  { id: "mshields",       name: "M'Baku",                     debut: "blackpanther",  image: "mbaku.jpg" },
  { id: "captainmarvel",  name: "Captain Marvel",             debut: "captainmarvel", image: "captainmarvel.jpg" },
  { id: "talos",          name: "Talos",                      debut: "captainmarvel", image: "talos.jpg" },
  { id: "ghost",          name: "Ghost",                      debut: "antmanwasp",    image: "ghost.jpg" },
  { id: "mysterio",       name: "Mysterio",                   debut: "farfromhome",   image: "mysterio.jpg" },

  // ─── PHASE 4 ───────────────────────────────
  { id: "agatha",         name: "Agatha Harkness",            debut: "wandavision",   image: "agatha.jpg" },
  { id: "monica",         name: "Monica Rambeau",             debut: "wandavision",   image: "monica.jpg" },
  { id: "samwilson",      name: "Captain America (Sam)",      debut: "falconws",      image: "samwilson.jpg" },
  { id: "loki_tva",       name: "Loki (TVA)",                 debut: "loki1",         image: "loki_tva.jpg" },
  { id: "sylvie",         name: "Sylvie",                     debut: "loki1",         image: "sylvie.jpg" },
  { id: "mobius",         name: "Mobius",                     debut: "loki1",         image: "mobius.jpg" },
  { id: "he_who_remains", name: "He Who Remains",             debut: "loki1",         image: "hewhoremains.jpg" },
  { id: "yelena",         name: "Yelena Belova",              debut: "blackwidow",    image: "yelena.jpg" },
  { id: "redguardian",    name: "Red Guardian",               debut: "blackwidow",    image: "redguardian.jpg" },
  { id: "taskmaster",     name: "Taskmaster",                 debut: "blackwidow",    image: "taskmaster.jpg" },
  { id: "shangchi",       name: "Shang-Chi",                  debut: "shangchi",      image: "shangchi.jpg" },
  { id: "xialing",        name: "Xu Xialing",                 debut: "shangchi",      image: "xialing.jpg" },
  { id: "wenwu",          name: "Xu Wenwu",                   debut: "shangchi",      image: "wenwu.jpg" },
  { id: "kate",           name: "Kate Bishop",                debut: "hawkeye",       image: "kate.jpg" },

  // ─── PHASE 5 ───────────────────────────────
  { id: "moonknight_mk",  name: "Moon Knight",                debut: "moonknight",    image: "moonknight.jpg" },
  { id: "layla",          name: "Layla El-Faouly",            debut: "moonknight",    image: "layla.jpg" },
  { id: "america",        name: "America Chavez",             debut: "drstrange2",    image: "america.jpg" },
  { id: "msmarvel",       name: "Ms. Marvel",                 debut: "msmarvel",      image: "msmarvel.jpg" },
  { id: "thor_lt",        name: "Thor (Love & Thunder)",      debut: "thor4",         image: "thor_lt.jpg" },
  { id: "mightythor",     name: "Mighty Thor",                debut: "thor4",         image: "mightythor.jpg" },
  { id: "gorr",           name: "Gorr the God Butcher",       debut: "thor4",         image: "gorr.jpg" },
  { id: "shehulk",        name: "She-Hulk",                   debut: "shehulk",       image: "shehulk.jpg" },
  { id: "namor",          name: "Namor",                      debut: "blackpanther2", image: "namor.jpg" },
  { id: "ironheart",      name: "Ironheart",                  debut: "blackpanther2", image: "ironheart.jpg" },
  { id: "riri",           name: "Riri Williams",              debut: "blackpanther2", image: "riri.jpg" },
  { id: "kang",           name: "Kang the Conqueror",         debut: "antman3",       image: "kang.jpg" },
  { id: "cassie",         name: "Cassie Lang",                debut: "antman3",       image: "cassie.jpg" },
  { id: "cosmo",          name: "Cosmo the Spacedog",         debut: "guardiansholiday", image: "cosmo.jpg" },
  { id: "adam",           name: "Adam Warlock",               debut: "guardians3",    image: "adamwarlock.jpg" },
  { id: "highevolutionary", name: "High Evolutionary",        debut: "guardians3",    image: "highevolutionary.jpg" },
  { id: "fury_si",        name: "Nick Fury (Secret Invasion)",debut: "secretinvasion", image: "fury_si.jpg" },
  { id: "gravik",         name: "Gravik",                     debut: "secretinvasion", image: "gravik.jpg" },
  { id: "loki_s2",        name: "Loki (Season 2)",            debut: "loki2",         image: "loki_s2.jpg" },
  { id: "ouroboros",      name: "Ouroboros (OB)",             debut: "loki2",         image: "ob.jpg" },
  { id: "kamala",         name: "Kamala Khan",                debut: "msmarvel",      image: "kamala.jpg" },
  { id: "monicarambeau2", name: "Monica Rambeau (Marvels)",   debut: "themarvels",    image: "monica2.jpg" },

  // ─── PHASE 6 ───────────────────────────────
  { id: "echo",           name: "Echo",                       debut: "echo",          image: "echo.jpg" },
  { id: "kingpin",        name: "Kingpin",                    debut: "echo",          image: "kingpin.jpg" },
  { id: "deadpool",       name: "Deadpool",                   debut: "deadpool3",     image: "deadpool.jpg" },
  { id: "wolverine",      name: "Wolverine",                  debut: "deadpool3",     image: "wolverine.jpg" },
  { id: "cassandra",      name: "Cassandra Nova",             debut: "deadpool3",     image: "cassandra.jpg" },
  { id: "agatha_aaa",     name: "Agatha (All Along)",         debut: "agatha",        image: "agatha2.jpg" },
  { id: "teen_agatha",    name: "Teen (Billy Maximoff)",      debut: "agatha",        image: "billy.jpg" },
  { id: "daredevil_ba",   name: "Daredevil (Born Again)",     debut: "daredevilbornagain", image: "daredevil_ba.jpg" },
  { id: "riri2",          name: "Ironheart (Series)",         debut: "ironheart",     image: "ironheart2.jpg" },
  { id: "johnwalker",     name: "John Walker",                debut: "falconws",      image: "johnwalker.jpg" },
  { id: "bucky2",         name: "Bucky Barnes (FATWS)",       debut: "falconws",      image: "bucky2.jpg" },
  { id: "isaiah",         name: "Isaiah Bradley",             debut: "falconws",      image: "isaiah.jpg" },
  { id: "sam_cap",        name: "Captain America (Sam Wilson)", debut: "cap4",        image: "sam_cap.jpg" },
  { id: "red_hulk",       name: "Red Hulk",                   debut: "cap4",          image: "redhulk.jpg" },
  { id: "ghost_tb",       name: "Ghost (Thunderbolts)",       debut: "thunderbolts",  image: "ghost_tb.jpg" },
  { id: "sentry",         name: "Sentry",                     debut: "thunderbolts",  image: "sentry.jpg" },
  { id: "mrcfantastic",   name: "Mr. Fantastic",              debut: "fantasticfour", image: "mrfantastic.jpg" },
  { id: "invisiblewoman", name: "Invisible Woman",            debut: "fantasticfour", image: "invisiblewoman.jpg" },
  { id: "humantorch",     name: "Human Torch",                debut: "fantasticfour", image: "humantorch.jpg" },
  { id: "thething",       name: "The Thing",                  debut: "fantasticfour", image: "thething.jpg" },
  { id: "galactus",       name: "Galactus",                   debut: "fantasticfour", image: "galactus.jpg" },
  { id: "silvesurfer",    name: "Silver Surfer",              debut: "fantasticfour", image: "silversurfer.jpg" },

  // ─── NETFLIX / STREET-LEVEL ────────────────
  { id: "daredevil",      name: "Daredevil",                  debut: "daredevil1",    image: "daredevil.jpg" },
  { id: "foggy",          name: "Foggy Nelson",               debut: "daredevil1",    image: "foggy.jpg" },
  { id: "karen",          name: "Karen Page",                 debut: "daredevil1",    image: "karen.jpg" },
  { id: "fisk",           name: "Wilson Fisk",                debut: "daredevil1",    image: "fisk.jpg" },
  { id: "elektra",        name: "Elektra",                    debut: "daredevil2",    image: "elektra.jpg" },
  { id: "punisher",       name: "Punisher",                   debut: "daredevil2",    image: "punisher.jpg" },
  { id: "jessicajones",   name: "Jessica Jones",              debut: "jessicajones1", image: "jessicajones.jpg" },
  { id: "lukecage",       name: "Luke Cage",                  debut: "jessicajones1", image: "lukecage.jpg" },
  { id: "trish",          name: "Trish Walker",               debut: "jessicajones1", image: "trish.jpg" },
  { id: "kilgrave",       name: "Kilgrave",                   debut: "jessicajones1", image: "kilgrave.jpg" },
  { id: "ironfist",       name: "Iron Fist",                  debut: "ironfist1",     image: "ironfist.jpg" },
  { id: "colleen",        name: "Colleen Wing",               debut: "ironfist1",     image: "colleen.jpg" },
  { id: "mistynight",     name: "Misty Knight",               debut: "lukecage1",     image: "misty.jpg" },
  { id: "cottonmouth",    name: "Cottonmouth",                debut: "lukecage1",     image: "cottonmouth.jpg" },

];

/************************************************
 * STAGE HELPERS
 * Resolve which image to show based on watch progress
 ************************************************/

// Get all unlocked stage images for a character (default + watched stages)
function getCharStages(char, watched) {
  const check = typeof watched.isWatched === 'function'
    ? (id) => watched.isWatched(id)
    : (id) => watched.has(id);
  const results = [{ image: char.image, label: "Default" }];
  if (char.stages) {
    char.stages.forEach(s => {
      if (check(s.after)) results.push({ image: s.image, label: s.look });
    });
  }
  return results;
}

// Get the highest unlocked image (used as default display)
function getCharImage(char, watched) {
  const stages = getCharStages(char, watched);
  return stages[stages.length - 1].image;
}