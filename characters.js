/************************************************
 * CHARACTERS DATABASE
 * debut: matches exact node IDs from projects.js
 ************************************************/
// Phase 3: var (not const) so the boot-time content fetch can overwrite.
// See projects.js for the full rationale.
var characters = [

  // ─── PHASE 1 ───────────────────────────────
  { id: "ironman",        name: "Iron Man",                   debut: "ironman1",      image: "ironman.jpg",
    stages: [
      { after: "avengers1",   image: "ironman_avengers.jpg",   look: "Mark VII" },
      { after: "infinitywar",  image: "ironman_nano.jpg",       look: "Nanotech bleeding edge suit" }
    ] },
  { id: "pepper",         name: "Pepper Potts",               debut: "ironman1",      image: "pepper.jpg" },
  { id: "happy",          name: "Happy Hogan",                debut: "ironman1",      image: "happy.jpg" },
  { id: "rhodey",         name: "James Rhodes",               debut: "ironman1",      image: "rhodey.jpg",
    stages: [
      { after: "ironman2",       image: "rhodey_warmachine.jpg", look: "War Machine (Don Cheadle)" },
      { after: "secretinvasion", image: "rhodey_si.jpg",         look: "Skrull impostor, Secret Invasion" }
    ] },
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
      { after: "avengers1", image: "hulk_avengers.jpg", look: "Mark Ruffalo's Hulk" },
      { after: "thor3",    image: "hulk_gladiator.jpg", look: "Sakaar gladiator armor" },
      { after: "endgame",  image: "hulk_smart.jpg",     look: "Smart Hulk" }
    ] },
  { id: "bettyross",      name: "Betty Ross",                 debut: "hulk",          image: "bettyross.jpg" },
  { id: "abomination",    name: "Abomination",                debut: "hulk",          image: "abomination.jpg" },
  { id: "thor",           name: "Thor",                       debut: "thor1",         image: "thor.jpg",
    stages: [
      { after: "thor3",   image: "thor_ragnarok.jpg",     look: "Short hair" },
      { after: "endgame", image: "thor_endgame.jpg",      look: "Bro Thor, Endgame" },
      { after: "thor4",   image: "thor_lovethunder.jpg",  look: "Love & Thunder" }
    ] },
  { id: "loki",           name: "Loki",                       debut: "thor1",         image: "loki.jpg",
    stages: [
      { after: "loki1", image: "loki_tva.jpg", look: "TVA suit variant" },
      { after: "loki2", image: "loki_s2.jpg",  look: "God of Stories, throne at end of time" }
    ] },
  { id: "janefoster",     name: "Jane Foster",                debut: "thor1",         image: "janefoster.jpg",
    stages: [
      { after: "thor4", image: "mightythor.jpg", look: "Mighty Thor" }
    ] },
  { id: "hawkeye",        name: "Hawkeye",                    debut: "thor1",         image: "hawkeye.jpg",
    stages: [
      { after: "endgame", image: "hawkeye_ronin.jpg",  look: "Ronin, darker look" },
      { after: "hawkeye", image: "hawkeye_series.jpg", look: "Mentor to Kate, Hawkeye series" }
    ] },
  { id: "heimdall",       name: "Heimdall",                   debut: "thor1",         image: "heimdall.jpg" },
  { id: "cap",            name: "Captain America",            debut: "cap1",          image: "cap.jpg",
    stages: [
      { after: "avengers1", image: "cap_avengers.jpg", look: "Modern" },
      { after: "cap2",        image: "cap_stealth.jpg",  look: "Dark stealth suit" },
      { after: "infinitywar", image: "cap_iw.jpg",       look: "Bearded Nomad, Infinity War" },
      { after: "endgame",     image: "cap_endgame.jpg",  look: "Endgame suit" }
    ] },
  { id: "peggy",          name: "Peggy Carter",               debut: "cap1",          image: "peggy.jpg" },
  { id: "bucky",          name: "Bucky Barnes",               debut: "cap1",          image: "bucky.jpg",
    stages: [
      { after: "cap2",         image: "wintersoldier.jpg", look: "The Winter Soldier" },
      { after: "infinitywar",  image: "bucky_wakanda.jpg", look: "Vibranium arm, Wakanda look" },
      { after: "falconws",     image: "bucky_fatws.jpg",   look: "Short hair, black-and-gold arm" },
      { after: "thunderbolts", image: "bucky_tb.jpg",      look: "Congressman, Thunderbolts*" }
    ] },
  { id: "redskull",       name: "Red Skull",                  debut: "cap1",          image: "redskull.jpg" },
  { id: "howardstark",    name: "Howard Stark",               debut: "cap1",          image: "howardstark.jpg" },
  { id: "thanos_snap",    name: "Thanos",                     debut: "avengers1",     image: "thanos.jpg" },
  { id: "obadiah",        name: "Obadiah Stane / Iron Monger",debut: "ironman1",      image: "obadiah.jpg" },

  // ─── PHASE 2 ───────────────────────────────
  { id: "killian",        name: "Aldrich Killian",            debut: "ironman3",      image: "killian.jpg" },
  { id: "malekith",       name: "Malekith",                   debut: "thor2",         image: "malekith.jpg" },
  { id: "falcon",         name: "Sam Wilson",                 debut: "cap2",          image: "falcon.jpg",
    stages: [
      { after: "falconws", image: "falcon_cap.jpg", look: "First Captain America suit, with wings" },
      { after: "cap4",     image: "samwilson.jpg",  look: "Captain America, Brave New World suit" }
    ] },
  { id: "starlord",       name: "Star-Lord",                  debut: "guardians1",    image: "starlord.jpg" },
  { id: "gamora",         name: "Gamora",                     debut: "guardians1",    image: "gamora.jpg",
    stages: [
      { after: "guardians3", image: "gamora_variant.jpg", look: "Alternate Gamora, armored, Guardians 3" }
    ] },
  { id: "drax",           name: "Drax",                       debut: "guardians1",    image: "drax.jpg" },
  { id: "rocket",         name: "Rocket",                     debut: "guardians1",    image: "rocket.jpg" },
  { id: "groot",          name: "Groot",                      debut: "guardians1",    image: "groot.jpg",
    stages: [
      { after: "guardians1",  image: "groot_baby.jpg",  look: "Baby Groot, small and cute" },
      { after: "guardians2",  image: "groot_teen.jpg",  look: "Teen Groot with attitude" },
      { after: "guardians3",  image: "groot_vol3.jpg",  look: "Fully grown again, Vol. 3" }
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
      { after: "spiderman1",  image: "spiderman_stark.jpg",      look: "Red/blue Stark suit, Homecoming" },
      { after: "infinitywar", image: "spiderman_iron.jpg",       look: "Iron Spider, Infinity War" },
      { after: "nowayhome",   image: "spiderman_integrated.jpg", look: "Black/gold integrated suit, No Way Home" }
    ] },
  { id: "blackpanther",   name: "Black Panther",              debut: "civilwar",      image: "blackpanther.jpg" },
  { id: "zemo",           name: "Baron Zemo",                 debut: "civilwar",      image: "zemo.jpg",
    stages: [
      { after: "falconws", image: "zemo_fatws.jpg", look: "Purple mask and fur coat, FATWS" }
    ] },
  { id: "drstrange",      name: "Doctor Strange",             debut: "doctorstrange", image: "drstrange.jpg" },
  { id: "wong",           name: "Wong",                       debut: "doctorstrange", image: "wong.jpg" },
  { id: "dormammu",       name: "Dormammu",                   debut: "doctorstrange", image: "dormammu.jpg" },
  { id: "mantis",         name: "Mantis",                     debut: "guardians2",    image: "mantis.jpg" },
  { id: "ego",            name: "Ego the Living Planet",      debut: "guardians2",    image: "ego.jpg" },
  { id: "valkyrie",       name: "Valkyrie",                   debut: "thor3",         image: "valkyrie.jpg" },
  { id: "hela",           name: "Hela",                       debut: "thor3",         image: "hela.jpg" },
  { id: "grandmaster",    name: "Grandmaster",                debut: "thor3",         image: "grandmaster.jpg" },
  { id: "shuri",          name: "Shuri",                      debut: "blackpanther",  image: "shuri.jpg",
    stages: [
      { after: "blackpanther2", image: "shuri_bp.jpg", look: "The new Black Panther" }
    ] },
  { id: "okoye",          name: "Okoye",                      debut: "blackpanther",  image: "okoye.jpg" },
  { id: "killmonger",     name: "Killmonger",                 debut: "blackpanther",  image: "killmonger.jpg" },
  { id: "mbaku",          name: "M'Baku",                     debut: "blackpanther",  image: "mbaku.jpg" },
  { id: "captainmarvel",  name: "Captain Marvel",             debut: "captainmarvel", image: "captainmarvel.jpg" },
  { id: "talos",          name: "Talos",                      debut: "captainmarvel", image: "talos.jpg" },
  { id: "ghost",          name: "Ghost",                      debut: "antmanwasp",    image: "ghost.jpg",
    stages: [
      { after: "thunderbolts", image: "ghost_tb.jpg", look: "Thunderbolts*" }
    ] },
  { id: "mysterio",       name: "Mysterio",                   debut: "farfromhome",   image: "mysterio.jpg" },
  { id: "vulture",        name: "Vulture",                    debut: "spiderman1",    image: "vulture.jpg" },

  // ─── PHASE 4 ───────────────────────────────
  { id: "agatha",         name: "Agatha Harkness",            debut: "wandavision",   image: "agatha.jpg",
    stages: [
      { after: "agatha", image: "agatha2.jpg", look: "Agatha All Along" }
    ] },
  { id: "monica",         name: "Monica Rambeau",             debut: "wandavision",   image: "monica.jpg",
    stages: [
      { after: "themarvels", image: "monica2.jpg", look: "Photon suit, The Marvels" }
    ] },
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
  { id: "echo",           name: "Echo",                       debut: "hawkeye",       image: "echo.jpg",
    stages: [
      { after: "echo", image: "echo_series.jpg", look: "Echo series, back home in Oklahoma" }
    ] },

  // ─── PHASE 5 ───────────────────────────────
  { id: "moonknight_mk",  name: "Moon Knight",                debut: "moonknight",    image: "moonknight.jpg" },
  { id: "layla",          name: "Layla El-Faouly",            debut: "moonknight",    image: "layla.jpg" },
  { id: "america",        name: "America Chavez",             debut: "drstrange2",    image: "america.jpg" },
  { id: "msmarvel",       name: "Ms. Marvel",                 debut: "msmarvel",      image: "msmarvel.jpg" },
  { id: "gorr",           name: "Gorr the God Butcher",       debut: "thor4",         image: "gorr.jpg" },
  { id: "shehulk",        name: "She-Hulk",                   debut: "shehulk",       image: "shehulk.jpg" },
  { id: "namor",          name: "Namor",                      debut: "blackpanther2", image: "namor.jpg" },
  { id: "ironheart",      name: "Ironheart",                  debut: "blackpanther2", image: "ironheart.jpg",
    stages: [
      { after: "ironheart", image: "ironheart2.jpg", look: "New armour, Ironheart series" }
    ] },
  { id: "kang",           name: "Kang the Conqueror",         debut: "antman3",       image: "kang.jpg" },
  { id: "cassie",         name: "Cassie Lang",                debut: "antman",        image: "cassie.jpg",
    stages: [
      { after: "antman3", image: "cassie_stature.jpg", look: "Stature suit, Quantumania" }
    ] },
  { id: "cosmo",          name: "Cosmo the Spacedog",         debut: "guardiansholiday", image: "cosmo.jpg" },
  { id: "adam",           name: "Adam Warlock",               debut: "guardians3",    image: "adamwarlock.jpg" },
  { id: "highevolutionary", name: "High Evolutionary",        debut: "guardians3",    image: "highevolutionary.jpg" },
  { id: "gravik",         name: "Gravik",                     debut: "secretinvasion", image: "gravik.jpg" },
  { id: "ouroboros",      name: "Ouroboros (OB)",             debut: "loki2",         image: "ob.jpg" },

  // ─── PHASE 6 ───────────────────────────────
  { id: "cassandra",      name: "Cassandra Nova",             debut: "deadpool3",     image: "cassandra.jpg" },
  { id: "teen_agatha",    name: "Teen (Billy Maximoff)",      debut: "agatha",        image: "billy.jpg" },
  { id: "johnwalker",     name: "John Walker",                debut: "falconws",      image: "johnwalker.jpg" },
  { id: "isaiah",         name: "Isaiah Bradley",             debut: "falconws",      image: "isaiah.jpg" },
  { id: "red_hulk",       name: "Red Hulk",                   debut: "cap4",          image: "redhulk.jpg" },
  { id: "sentry",         name: "Sentry",                     debut: "thunderbolts",  image: "sentry.jpg" },
  { id: "mrcfantastic",   name: "Mr. Fantastic",              debut: "fantasticfour", image: "mrfantastic.jpg" },
  { id: "invisiblewoman", name: "Invisible Woman",            debut: "fantasticfour", image: "invisiblewoman.jpg" },
  { id: "humantorch",     name: "Human Torch",                debut: "fantasticfour", image: "humantorch.jpg" },
  { id: "thething",       name: "The Thing",                  debut: "fantasticfour", image: "thething.jpg" },
  { id: "galactus",       name: "Galactus",                   debut: "fantasticfour", image: "galactus.jpg" },
  { id: "silversurfer",   name: "Silver Surfer",              debut: "fantasticfour", image: "silversurfer.jpg" },

  // ─── NETFLIX / STREET-LEVEL ────────────────
  { id: "daredevil",      name: "Daredevil",                  debut: "daredevil1",    image: "daredevil.jpg",
    stages: [
      { after: "shehulk",            image: "daredevil_yellow.jpg", look: "Yellow suit, She-Hulk" },
      { after: "daredevilbornagain", image: "daredevil_ba.jpg",     look: "Born Again suit" }
    ] },
  { id: "foggy",          name: "Foggy Nelson",               debut: "daredevil1",    image: "foggy.jpg" },
  { id: "karen",          name: "Karen Page",                 debut: "daredevil1",    image: "karen.jpg" },
  { id: "fisk",           name: "Wilson Fisk",                debut: "daredevil1",    image: "fisk.jpg",
    stages: [
      { after: "hawkeye",            image: "kingpin.jpg",    look: "Kingpin, white suit (Hawkeye, Echo)" },
      { after: "daredevilbornagain", image: "fisk_mayor.jpg", look: "Mayor Fisk, Born Again" }
    ] },
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

  // ─── FOX X-MEN ─────────────────────────────
  { id: "wolverine",      name: "Wolverine",                  debut: "xmen1",         image: "wolverine.jpg",
    stages: [
      { after: "logan",     image: "wolverine_logan.jpg", look: "Old Logan, grey beard" },
      { after: "deadpool3", image: "wolverine_dw.jpg",    look: "Yellow suit, Deadpool & Wolverine" }
    ] },
  { id: "profx",          name: "Professor X",                debut: "xmen1",         image: "profx.jpg",
    stages: [
      { after: "firstclass", image: "profx_young.jpg", look: "Young Charles (James McAvoy)" },
      { after: "logan",      image: "profx_logan.jpg", look: "Elderly Charles, Logan" }
    ] },
  { id: "magneto",        name: "Magneto",                    debut: "xmen1",         image: "magneto.jpg",
    stages: [
      { after: "firstclass", image: "magneto_young.jpg", look: "Young Erik (Michael Fassbender)" }
    ] },
  { id: "jeangrey",       name: "Jean Grey",                  debut: "xmen1",         image: "jeangrey.jpg",
    stages: [
      { after: "xmen3",      image: "jeangrey_phoenix.jpg", look: "Dark Phoenix, The Last Stand" },
      { after: "apocalypse", image: "jeangrey_young.jpg",   look: "Young Jean (Sophie Turner)" }
    ] },
  { id: "cyclops",        name: "Cyclops",                    debut: "xmen1",         image: "cyclops.jpg",
    stages: [
      { after: "apocalypse", image: "cyclops_young.jpg", look: "Young Scott (Tye Sheridan)" }
    ] },
  { id: "storm",          name: "Storm",                      debut: "xmen1",         image: "storm.jpg",
    stages: [
      { after: "apocalypse", image: "storm_young.jpg", look: "Young Ororo (Alexandra Shipp)" }
    ] },
  { id: "mystique",       name: "Mystique",                   debut: "xmen1",         image: "mystique.jpg",
    stages: [
      { after: "firstclass", image: "mystique_young.jpg", look: "Young Raven (Jennifer Lawrence)" }
    ] },
  { id: "rogue",          name: "Rogue",                      debut: "xmen1",         image: "rogue.jpg" },
  { id: "sabretooth",     name: "Sabretooth",                 debut: "xmen1",         image: "sabretooth.jpg",
    stages: [
      { after: "wolverineorigins", image: "sabretooth_origins.jpg", look: "Victor Creed (Liev Schreiber)" }
    ] },
  { id: "nightcrawler",   name: "Nightcrawler",               debut: "xmen2",         image: "nightcrawler.jpg",
    stages: [
      { after: "apocalypse", image: "nightcrawler_young.jpg", look: "Young Kurt (Kodi Smit-McPhee)" }
    ] },
  { id: "beast",          name: "Beast",                      debut: "xmen3",         image: "beast.jpg",
    stages: [
      { after: "firstclass", image: "beast_young.jpg", look: "Young Hank (Nicholas Hoult)" }
    ] },
  { id: "gambit",         name: "Gambit",                     debut: "wolverineorigins", image: "gambit.jpg",
    stages: [
      { after: "deadpool3", image: "gambit_dw.jpg", look: "Channing Tatum, Deadpool & Wolverine" }
    ] },
  { id: "apocalypse",     name: "Apocalypse",                 debut: "apocalypse",    image: "apocalypse.jpg" },
  { id: "laura",          name: "X-23",                       debut: "logan",         image: "laura.jpg",
    stages: [
      { after: "deadpool3", image: "laura_dw.jpg", look: "Grown up, Deadpool & Wolverine" }
    ] },
  { id: "deadpool",       name: "Deadpool",                   debut: "deadpool1",     image: "deadpool.jpg",
    stages: [
      { after: "deadpool3", image: "deadpool_dw.jpg", look: "Deadpool & Wolverine suit" }
    ] },
  { id: "cable",          name: "Cable",                      debut: "deadpool2",     image: "cable.jpg" },

];

// Ids of characters that were merged into another character's stages.
// Saved walker selections still carry the old ids; js/walkers.js maps them.
const MERGED_CHARACTER_IDS = {
  thor_lt: "thor", mightythor: "janefoster", fury_si: "nick_fury",
  wintersoldier: "bucky", bucky2: "bucky", samwilson: "falcon", sam_cap: "falcon",
  kamala: "msmarvel", riri: "ironheart", riri2: "ironheart", agatha_aaa: "agatha",
  monicarambeau2: "monica", daredevil_ba: "daredevil", kingpin: "fisk", ghost_tb: "ghost"
};

/************************************************
 * STAGE HELPERS
 * Resolve which image to show based on watch progress
 ************************************************/

// `watched` is either a Set of project ids or an object with isWatched(id).
function watchedCheck(watched) {
  return typeof watched.isWatched === 'function'
    ? (id) => watched.isWatched(id)
    : (id) => watched.has(id);
}

// A character is unlocked by watching any project they appear in: their
// debut or the project of any stage (Deadpool & Wolverine alone unlocks
// Wolverine, in the yellow suit).
function isCharUnlocked(char, watched) {
  const check = watchedCheck(watched);
  return check(char.debut) || (char.stages || []).some(s => check(s.after));
}

// Get the looks a character has unlocked: the debut look once the debut is
// watched, plus every stage whose project is watched. `after` = the project
// that unlocked the look.
function getCharStages(char, watched) {
  const check = watchedCheck(watched);
  const base = { image: char.image, label: "Default", after: char.debut };
  const results = check(char.debut) ? [base] : [];
  if (char.stages) {
    char.stages.forEach(s => {
      if (check(s.after)) results.push({ image: s.image, label: s.look, after: s.after });
    });
  }
  // Nothing unlocked (e.g. a villain shown before you've met them): debut look
  return results.length ? results : [base];
}

// Get the highest unlocked image (used as default display)
function getCharImage(char, watched) {
  const stages = getCharStages(char, watched);
  return stages[stages.length - 1].image;
}

/************************************************
 * WALKER COMBAT STATS
 * hp, melee (weapon + dmg), range (weapon + dmg), moveSpeed, atkSpeed
 * Characters with both melee and range use both in fights
 * Villains use same base stats — 1.5x HP applied at spawn time
 ************************************************/
const WALKER_STATS = {
  // ── S-tier (cosmic) ──
  //                   hp   melee:[weapon, dmg]       range:[weapon, dmg]        moveSpd atkSpd
  thor:           { hp: 255, melee: ['hammer', 22],    range: ['beam', 10],       moveSpeed: 48, atkSpeed: 1.1 },
  wanda_wv:       { hp: 240, melee: ['hex', 14],       range: ['hex', 18],        moveSpeed: 42, atkSpeed: 1.3 },
  captainmarvel:  { hp: 260, melee: ['fist', 16],      range: ['photon', 14],     moveSpeed: 52, atkSpeed: 1.0 },
  hela:           { hp: 245, melee: ['necrosword', 20], range: ['necrosword', 12], moveSpeed: 44, atkSpeed: 1.2 },
  dormammu:       { hp: 235, melee: ['darkEnergy', 12], range: ['darkEnergy', 16], moveSpeed: 32, atkSpeed: 0.8 },
  ego:            { hp: 215, melee: ['tendril', 18],    range: ['tendril', 8],     moveSpeed: 30, atkSpeed: 0.6 },

  // ── A-tier (powerhouse) ──
  hulk:           { hp: 205, melee: ['fist', 24],      range: null,               moveSpeed: 38, atkSpeed: 0.8 },
  thanos_snap:    { hp: 210, melee: ['gauntlet', 18],  range: ['beam', 10],       moveSpeed: 36, atkSpeed: 0.9 },
  drstrange:      { hp: 185, melee: ['fist', 6],       range: ['magic', 16],      moveSpeed: 43, atkSpeed: 1.4 },
  vision:         { hp: 195, melee: ['fist', 10],      range: ['beam', 12],       moveSpeed: 45, atkSpeed: 1.1 },
  abomination:    { hp: 190, melee: ['fist', 22],      range: null,               moveSpeed: 34, atkSpeed: 0.7 },
  ultron:         { hp: 198, melee: ['fist', 8],        range: ['beam', 14],       moveSpeed: 40, atkSpeed: 1.0 },
  agatha:         { hp: 182, melee: ['fist', 6],        range: ['magic', 15],      moveSpeed: 41, atkSpeed: 1.1 },

  // ── B-tier (fighter) ──
  ironman:        { hp: 158, melee: ['fist', 8],        range: ['repulsor', 12],   moveSpeed: 46, atkSpeed: 1.2 },
  loki:           { hp: 145, melee: ['dagger', 14],     range: ['magic', 6],       moveSpeed: 44, atkSpeed: 1.3 },
  blackpanther:   { hp: 162, melee: ['claw', 16],       range: null,               moveSpeed: 47, atkSpeed: 1.1 },
  spiderman:      { hp: 142, melee: ['fist', 8],        range: ['web', 9],         moveSpeed: 50, atkSpeed: 1.4 },
  starlord:       { hp: 148, melee: ['fist', 6],        range: ['blaster', 12],    moveSpeed: 43, atkSpeed: 1.0 },
  gamora:         { hp: 152, melee: ['sword', 18],      range: null,               moveSpeed: 45, atkSpeed: 1.1 },
  shangchi:       { hp: 155, melee: ['rings', 12],      range: ['rings', 9],       moveSpeed: 48, atkSpeed: 1.3 },
  groot:          { hp: 165, melee: ['branch', 14],     range: null,               moveSpeed: 35, atkSpeed: 0.8 },
  ronan:          { hp: 160, melee: ['hammer', 14],     range: ['beam', 6],        moveSpeed: 37, atkSpeed: 0.9 },
  killmonger:     { hp: 153, melee: ['suit', 12],       range: ['suit', 6],        moveSpeed: 44, atkSpeed: 1.1 },
  malekith:       { hp: 150, melee: ['aether', 10],     range: ['aether', 8],      moveSpeed: 38, atkSpeed: 0.9 },
  kang:           { hp: 157, melee: ['fist', 6],        range: ['beam', 14],       moveSpeed: 42, atkSpeed: 1.2 },

  // ── C-tier (soldier) ──
  cap:            { hp: 128, melee: ['shield', 12],     range: ['shield', 5],      moveSpeed: 42, atkSpeed: 1.0 },
  bucky:          { hp: 122, melee: ['arm', 10],        range: ['pistol', 5],      moveSpeed: 41, atkSpeed: 1.1 },
  wolverine:      { hp: 135, melee: ['claws', 16],      range: null,               moveSpeed: 43, atkSpeed: 1.2 },
  deadpool:       { hp: 118, melee: ['katana', 9],      range: ['pistol', 5],      moveSpeed: 45, atkSpeed: 1.3 },
  drax:           { hp: 125, melee: ['daggers', 14],    range: null,               moveSpeed: 38, atkSpeed: 0.9 },
  nebula:         { hp: 115, melee: ['baton', 8],       range: ['blaster', 7],     moveSpeed: 44, atkSpeed: 1.1 },
  lukecage:       { hp: 132, melee: ['fist', 12],       range: null,               moveSpeed: 36, atkSpeed: 0.8 },
  moonknight_mk:  { hp: 120, melee: ['dart', 8],       range: ['dart', 8],        moveSpeed: 43, atkSpeed: 1.2 },
  shehulk:        { hp: 126, melee: ['fist', 14],       range: null,               moveSpeed: 40, atkSpeed: 1.0 },
  redskull:       { hp: 124, melee: ['fist', 8],        range: ['tesseract', 7],   moveSpeed: 39, atkSpeed: 0.9 },
  cassandra:      { hp: 130, melee: ['fist', 6],        range: ['psychic', 11],    moveSpeed: 41, atkSpeed: 1.1 },
  wenwu:          { hp: 155, melee: ['rings', 10],      range: ['rings', 10],      moveSpeed: 43, atkSpeed: 1.2 },

  // ── D-tier (street) ──
  blackwidow:     { hp: 84,  melee: ['baton', 8],      range: ['pistol', 4],      moveSpeed: 44, atkSpeed: 1.3 },
  hawkeye:        { hp: 78,  melee: ['baton', 5],       range: ['arrow', 9],       moveSpeed: 42, atkSpeed: 1.2 },
  falcon:         { hp: 82,  melee: ['fist', 5],        range: ['redwing', 7],     moveSpeed: 46, atkSpeed: 1.0 },
  antman:         { hp: 76,  melee: ['fist', 6],        range: ['disc', 7],        moveSpeed: 43, atkSpeed: 1.1 },
  wasp_hope:      { hp: 81,  melee: ['fist', 5],        range: ['sting', 8],       moveSpeed: 45, atkSpeed: 1.2 },
  daredevil:      { hp: 88,  melee: ['club', 12],       range: ['club', 3],        moveSpeed: 47, atkSpeed: 1.4 },
  jessicajones:   { hp: 86,  melee: ['fist', 12],       range: null,               moveSpeed: 40, atkSpeed: 0.9 },
  ironfist:       { hp: 79,  melee: ['chi', 10],        range: ['chi', 5],         moveSpeed: 44, atkSpeed: 1.3 },
  kate:           { hp: 72,  melee: ['baton', 4],       range: ['arrow', 8],       moveSpeed: 43, atkSpeed: 1.1 },
  yelena:         { hp: 83,  melee: ['baton', 7],       range: ['pistol', 5],      moveSpeed: 44, atkSpeed: 1.2 },
  punisher:       { hp: 85,  melee: ['fist', 6],        range: ['shotgun', 8],     moveSpeed: 39, atkSpeed: 1.0 },
  rocket:         { hp: 68,  melee: ['fist', 3],        range: ['blaster', 9],     moveSpeed: 48, atkSpeed: 1.3 },
  mantis:         { hp: 65,  melee: ['fist', 4],        range: ['pulse', 6],       moveSpeed: 40, atkSpeed: 0.9 },
  mysterio:       { hp: 73,  melee: ['fist', 3],        range: ['drone', 10],      moveSpeed: 41, atkSpeed: 1.0 },
  fisk:           { hp: 92,  melee: ['fist', 13],       range: null,               moveSpeed: 33, atkSpeed: 0.7 },
  kilgrave:       { hp: 62,  melee: ['fist', 3],        range: ['mind', 7],        moveSpeed: 38, atkSpeed: 0.8 },
  cottonmouth:    { hp: 70,  melee: ['fist', 8],        range: ['pistol', 4],      moveSpeed: 37, atkSpeed: 0.9 },
  nick_fury:      { hp: 75,  melee: ['fist', 4],        range: ['pistol', 8],      moveSpeed: 40, atkSpeed: 1.0 },
  coulson:        { hp: 74,  melee: ['fist', 4],        range: ['pistol', 8],      moveSpeed: 41, atkSpeed: 1.0 },

  // ── Fox X-Men ──
  apocalypse:     { hp: 230, melee: ['fist', 14],       range: ['darkEnergy', 14], moveSpeed: 36, atkSpeed: 0.9 },
  magneto:        { hp: 200, melee: ['fist', 6],        range: ['beam', 15],       moveSpeed: 40, atkSpeed: 1.0 },
  jeangrey:       { hp: 190, melee: ['fist', 5],        range: ['psychic', 16],    moveSpeed: 42, atkSpeed: 1.1 },
  storm:          { hp: 170, melee: ['fist', 5],        range: ['photon', 14],     moveSpeed: 45, atkSpeed: 1.1 },
  profx:          { hp: 150, melee: ['fist', 3],        range: ['psychic', 14],    moveSpeed: 30, atkSpeed: 0.9 },
  sabretooth:     { hp: 140, melee: ['claws', 15],      range: null,               moveSpeed: 44, atkSpeed: 1.1 },
  cable:          { hp: 140, melee: ['arm', 9],         range: ['blaster', 12],    moveSpeed: 40, atkSpeed: 1.0 },
  beast:          { hp: 130, melee: ['fist', 13],       range: null,               moveSpeed: 46, atkSpeed: 1.0 },
  cyclops:        { hp: 120, melee: ['fist', 6],        range: ['beam', 13],       moveSpeed: 43, atkSpeed: 1.2 },
  laura:          { hp: 110, melee: ['claws', 14],      range: null,               moveSpeed: 50, atkSpeed: 1.4 },
  gambit:         { hp: 105, melee: ['baton', 7],       range: ['disc', 10],       moveSpeed: 45, atkSpeed: 1.3 },
  rogue:          { hp: 95,  melee: ['fist', 9],        range: null,               moveSpeed: 41, atkSpeed: 1.0 },
  mystique:       { hp: 90,  melee: ['fist', 10],       range: ['pistol', 5],      moveSpeed: 47, atkSpeed: 1.4 },
  nightcrawler:   { hp: 85,  melee: ['sword', 9],       range: null,               moveSpeed: 52, atkSpeed: 1.5 },

  // Fallback
  _default:       { hp: 80,  melee: ['fist', 10],      range: null,               moveSpeed: 40, atkSpeed: 1.0 }
};

/************************************************
 * VILLAIN DATA — which villain spawns at which node
 ************************************************/
const VILLAIN_DATA = {
  ironman1: ['obadiah'],
  ironman3: ['killian'],
  hulk: ['abomination'],
  thor1: ['loki'],
  thor2: ['malekith'],
  thor3: ['hela'],
  thor4: ['gorr'],
  cap1: ['redskull'],
  cap2: ['bucky'],
  avengers1: ['loki', 'thanos_snap'],
  ageofultron: ['ultron'],
  guardians1: ['ronan'],
  guardians2: ['ego'],
  civilwar: ['zemo'],
  doctorstrange: ['dormammu'],
  blackpanther: ['killmonger'],
  spiderman1: ['vulture'],
  antmanwasp: ['ghost'],
  infinitywar: ['thanos_snap'],
  endgame: ['thanos_snap'],
  farfromhome: ['mysterio'],
  wandavision: ['agatha'],
  loki1: ['he_who_remains'],
  shangchi: ['wenwu'],
  blackwidow: ['taskmaster'],
  antman3: ['kang'],
  blackpanther2: ['namor'],
  guardians3: ['highevolutionary'],
  secretinvasion: ['gravik'],
  cap4: ['red_hulk'],
  thunderbolts: ['sentry'],
  fantasticfour: ['galactus'],
  daredevil1: ['fisk'],
  daredevil2: ['punisher'],
  jessicajones1: ['kilgrave'],
  lukecage1: ['cottonmouth'],
  deadpool3: ['cassandra'],
  echo: ['fisk'],
  xmen1: ['magneto'],
  wolverineorigins: ['sabretooth'],
  apocalypse: ['apocalypse'],
  deadpool2: ['cable']
};

// Weapon type → display color for spinning weapon circle
const WEAPON_COLORS = {
  hammer: '#e0e0e0', shield: '#4a9eff', repulsor: '#00e5ff',
  hex: '#ff4040', photon: '#6eb5ff', gauntlet: '#ffd700',
  dagger: '#40ff40', claw: '#c0c0c0', web: '#ffffff',
  fist: '#ffffff', magic: '#b060ff', beam: '#ffff40',
  darkEnergy: '#8b00ff', necrosword: '#00ff80', sword: '#c0c0c0',
  arrow: '#ffa500', baton: '#ff6060', blaster: '#ff8c00',
  rings: '#ffd700', branch: '#8b4513', suit: '#4a4a4a',
  aether: '#cc0000', arm: '#c0c0c0', claws: '#e0e0e0',
  katana: '#ff4444', daggers: '#c0c0c0', dart: '#e0e0e0',
  tesseract: '#4060ff', psychic: '#ff00ff', sting: '#ffff00',
  disc: '#ff6600', redwing: '#ff0000', club: '#cc4444',
  chi: '#ffcc00', shotgun: '#888888', pulse: '#80ff80',
  drone: '#00cccc', mind: '#cc00cc', pistol: '#aaaaaa',
  tendril: '#4060ff',
  _default: '#c9a227'
};

// Weapon type → SVG shape template. {c} is replaced with the weapon color.
const WEAPON_SHAPES = {
  // Thor's hammer — T-shaped Mjolnir
  hammer: `<rect x="6" y="0" width="2" height="9" fill="{c}"/>
           <rect x="3" y="0" width="8" height="4" rx="1" fill="{c}"/>`,

  // Cap's shield — half circle
  shield: `<path d="M2,7 A5,5 0 0,1 12,7 Z" fill="{c}" stroke="{c}" stroke-width="0.5"/>
           <path d="M4,7 A3.5,3.5 0 0,1 10,7 Z" fill="none" stroke="#fff" stroke-width="0.8"/>`,

  // Iron Man repulsor — glowing circle with ring
  repulsor: `<circle cx="7" cy="7" r="4" fill="{c}" opacity="0.7"/>
             <circle cx="7" cy="7" r="5.5" fill="none" stroke="{c}" stroke-width="1"/>
             <circle cx="7" cy="4" r="1.5" fill="#fff" opacity="0.8"/>`,

  // Loki's dagger — thin pointed blade
  dagger: `<polygon points="7,0 9,10 7,13 5,10" fill="{c}"/>
           <rect x="5.5" y="9" width="3" height="2" rx="0.5" fill="#a0a0a0"/>`,

  // Deadpool katana — long thin blade
  katana: `<rect x="6" y="0" width="2" height="11" fill="{c}"/>
           <rect x="4.5" y="10" width="5" height="1.5" rx="0.5" fill="#a0a0a0"/>
           <rect x="6" y="11" width="2" height="3" fill="#8b4513"/>`,

  // Wolverine claws — three parallel lines
  claws: `<rect x="3" y="1" width="1.5" height="10" rx="0.5" fill="{c}"/>
          <rect x="6" y="0" width="1.5" height="12" rx="0.5" fill="{c}"/>
          <rect x="9" y="1" width="1.5" height="10" rx="0.5" fill="{c}"/>`,

  // Gamora's Godslayer sword
  sword: `<polygon points="7,0 9,9 7,14 5,9" fill="{c}"/>
          <rect x="5" y="9" width="4" height="1.5" rx="0.5" fill="#a0a0a0"/>`,

  // Hawkeye/Kate arrow
  arrow: `<line x1="7" y1="0" x2="7" y2="13" stroke="{c}" stroke-width="1.5"/>
          <polygon points="7,0 4,4 10,4" fill="{c}"/>
          <line x1="5" y1="12" x2="9" y2="12" stroke="{c}" stroke-width="1"/>`,

  // Black Widow / Yelena / Nebula baton
  baton: `<rect x="6" y="0" width="2" height="14" rx="1" fill="{c}"/>
          <circle cx="7" cy="2" r="1" fill="#fff" opacity="0.6"/>`,

  // Star-Lord / Rocket blaster
  blaster: `<rect x="4" y="4" width="6" height="4" rx="1" fill="{c}"/>
            <rect x="2" y="5" width="3" height="2" rx="0.5" fill="{c}"/>
            <circle cx="11" cy="6" r="2" fill="#fff" opacity="0.5"/>`,

  // Spider-Man web ball
  web: `<circle cx="7" cy="5" r="4" fill="none" stroke="{c}" stroke-width="1"/>
        <line x1="7" y1="1" x2="7" y2="9" stroke="{c}" stroke-width="0.5"/>
        <line x1="3" y1="5" x2="11" y2="5" stroke="{c}" stroke-width="0.5"/>
        <line x1="7" y1="9" x2="7" y2="14" stroke="{c}" stroke-width="1" stroke-dasharray="1,1"/>`,

  // Doctor Strange / Agatha magic circle
  magic: `<circle cx="7" cy="7" r="5" fill="none" stroke="{c}" stroke-width="1.5"/>
          <circle cx="7" cy="7" r="2.5" fill="{c}" opacity="0.4"/>
          <line x1="2" y1="7" x2="12" y2="7" stroke="{c}" stroke-width="0.5"/>
          <line x1="7" y1="2" x2="7" y2="12" stroke="{c}" stroke-width="0.5"/>`,

  // Vision / Ultron / Kang beam
  beam: `<rect x="5" y="0" width="4" height="14" rx="2" fill="{c}" opacity="0.6"/>
         <rect x="6" y="0" width="2" height="14" fill="{c}"/>
         <circle cx="7" cy="2" r="2" fill="#fff" opacity="0.6"/>`,

  // Wanda hex energy — diamond
  hex: `<polygon points="7,0 14,7 7,14 0,7" fill="{c}" opacity="0.6"/>
        <polygon points="7,3 11,7 7,11 3,7" fill="{c}"/>`,

  // Captain Marvel photon blast
  photon: `<polygon points="7,0 9,5 14,5 10,8 12,14 7,10 2,14 4,8 0,5 5,5" fill="{c}" opacity="0.8"/>`,

  // Thanos gauntlet — fist with gem
  gauntlet: `<rect x="3" y="3" width="8" height="9" rx="2" fill="{c}"/>
             <circle cx="7" cy="6" r="2" fill="#ff4444"/>
             <rect x="2" y="2" width="2" height="4" rx="1" fill="{c}"/>
             <rect x="10" y="2" width="2" height="4" rx="1" fill="{c}"/>`,

  // Black Panther vibranium claw
  claw: `<path d="M3,14 Q4,8 3,2 L5,0 Q6,6 7,2 L9,0 Q8,6 9,2 L11,0 Q10,8 11,14 Z" fill="{c}" opacity="0.8"/>`,

  // Hela's necrosword
  necrosword: `<polygon points="7,0 8.5,5 10,3 9,8 11,7 8,12 7,14 6,12 3,7 5,8 4,3 5.5,5" fill="{c}"/>`,

  // Dark energy (Dormammu)
  darkEnergy: `<circle cx="7" cy="7" r="5" fill="{c}" opacity="0.4"/>
               <circle cx="7" cy="7" r="3" fill="{c}" opacity="0.7"/>
               <circle cx="7" cy="7" r="1" fill="#fff" opacity="0.5"/>`,

  // Shang-Chi / Wenwu ten rings
  rings: `<circle cx="7" cy="7" r="5" fill="none" stroke="{c}" stroke-width="1.5"/>
          <circle cx="7" cy="7" r="3" fill="none" stroke="{c}" stroke-width="1"/>
          <circle cx="7" cy="7" r="1" fill="{c}"/>`,

  // Groot branch
  branch: `<rect x="6" y="0" width="2" height="14" rx="1" fill="{c}"/>
           <rect x="8" y="3" width="4" height="1.5" rx="0.5" fill="{c}" transform="rotate(-30,8,3)"/>
           <rect x="2" y="6" width="4" height="1.5" rx="0.5" fill="{c}" transform="rotate(30,6,6)"/>`,

  // Drax dual daggers
  daggers: `<polygon points="4,0 5.5,8 4,10 2.5,8" fill="{c}"/>
            <polygon points="10,0 11.5,8 10,10 8.5,8" fill="{c}"/>`,

  // Cap's vibranium arm (Bucky)
  arm: `<rect x="4" y="2" width="6" height="10" rx="2" fill="{c}"/>
        <line x1="5" y1="4" x2="9" y2="4" stroke="#888" stroke-width="0.5"/>
        <line x1="5" y1="6" x2="9" y2="6" stroke="#888" stroke-width="0.5"/>
        <line x1="5" y1="8" x2="9" y2="8" stroke="#888" stroke-width="0.5"/>`,

  // Moon Knight crescent dart
  dart: `<path d="M7,0 Q12,7 7,14 Q8,7 7,0 Z" fill="{c}"/>`,

  // Iron Fist chi fist
  chi: `<circle cx="7" cy="7" r="5" fill="{c}" opacity="0.3"/>
        <circle cx="7" cy="7" r="3" fill="{c}" opacity="0.6"/>
        <polygon points="7,2 8.5,5.5 12,7 8.5,8.5 7,12 5.5,8.5 2,7 5.5,5.5" fill="{c}"/>`,

  // Wasp sting
  sting: `<circle cx="7" cy="4" r="3" fill="{c}" opacity="0.5"/>
          <polygon points="7,7 9,14 5,14" fill="{c}"/>`,

  // Ant-Man shrink disc
  disc: `<circle cx="7" cy="7" r="5" fill="{c}" opacity="0.5"/>
         <circle cx="7" cy="7" r="3" fill="{c}"/>
         <polygon points="7,3 8,5.5 7,5 6,5.5" fill="#fff" opacity="0.5"/>`,

  // Falcon Redwing drone
  redwing: `<polygon points="7,2 12,8 7,7 2,8" fill="{c}"/>
            <polygon points="7,7 10,12 7,10 4,12" fill="{c}" opacity="0.7"/>`,

  // Punisher shotgun blast
  shotgun: `<rect x="5" y="0" width="4" height="10" rx="1" fill="#666"/>
            <circle cx="7" cy="1" r="2.5" fill="{c}" opacity="0.7"/>
            <rect x="6" y="9" width="2" height="5" fill="#8b4513"/>`,

  // Nick Fury / Coulson pistol
  pistol: `<rect x="5" y="2" width="4" height="7" rx="1" fill="#666"/>
           <rect x="6" y="8" width="2" height="4" fill="#444"/>
           <circle cx="7" cy="2" r="1.5" fill="{c}" opacity="0.6"/>`,

  // Kilgrave mind control
  mind: `<circle cx="7" cy="7" r="4" fill="none" stroke="{c}" stroke-width="1" stroke-dasharray="2,2"/>
         <circle cx="7" cy="7" r="2" fill="{c}" opacity="0.5"/>
         <circle cx="7" cy="7" r="6" fill="none" stroke="{c}" stroke-width="0.5" opacity="0.4"/>`,

  // Mysterio drone
  drone: `<rect x="3" y="5" width="8" height="4" rx="1" fill="{c}"/>
          <polygon points="1,7 3,5 3,9" fill="{c}" opacity="0.6"/>
          <polygon points="13,7 11,5 11,9" fill="{c}" opacity="0.6"/>
          <circle cx="7" cy="7" r="1" fill="#fff"/>`,

  // Mantis empathy pulse
  pulse: `<circle cx="7" cy="7" r="3" fill="{c}" opacity="0.4"/>
          <circle cx="7" cy="7" r="5" fill="none" stroke="{c}" stroke-width="0.7" opacity="0.5"/>
          <circle cx="7" cy="7" r="1.5" fill="{c}"/>`,

  // Cassandra Nova psychic
  psychic: `<circle cx="7" cy="7" r="4" fill="{c}" opacity="0.3"/>
            <line x1="3" y1="3" x2="11" y2="11" stroke="{c}" stroke-width="1"/>
            <line x1="11" y1="3" x2="3" y2="11" stroke="{c}" stroke-width="1"/>
            <circle cx="7" cy="7" r="2" fill="{c}"/>`,

  // Red Skull tesseract weapon
  tesseract: `<rect x="3" y="3" width="8" height="8" fill="{c}" opacity="0.5" transform="rotate(45,7,7)"/>
              <rect x="4.5" y="4.5" width="5" height="5" fill="{c}" opacity="0.8" transform="rotate(45,7,7)"/>`,

  // Killmonger vibranium suit energy
  suit: `<polygon points="7,1 12,5 12,10 7,13 2,10 2,5" fill="none" stroke="{c}" stroke-width="1.5"/>
         <circle cx="7" cy="7" r="2" fill="{c}"/>`,

  // Malekith aether
  aether: `<ellipse cx="7" cy="7" rx="5" ry="3" fill="{c}" opacity="0.5"/>
           <ellipse cx="7" cy="7" rx="3" ry="5" fill="{c}" opacity="0.5"/>
           <circle cx="7" cy="7" r="2" fill="{c}"/>`,

  // Ego tendril
  tendril: `<path d="M7,0 Q10,4 8,7 Q11,9 9,12 Q8,14 7,14 Q6,14 5,12 Q3,9 6,7 Q4,4 7,0" fill="{c}" opacity="0.7"/>`,

  // Default — simple glowing orb
  _default: `<circle cx="7" cy="7" r="4" fill="{c}"/>
             <circle cx="7" cy="7" r="2" fill="#fff" opacity="0.4"/>`
};