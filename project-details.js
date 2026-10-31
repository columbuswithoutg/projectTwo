/************************************************
 * PROJECT DETAILS
 * Per title (keys = project ids in projects.js): a spoiler-free synopsis,
 * reworded from the title's Synopsis section on the Marvel Cinematic
 * Universe Wiki (wiki = that page, kept as the source; not shown), and the cast — the characters from
 * characters.js who appear on screen, as [characterId, look], look being
 * the key of the stage worn in that title ("base" = the debut look,
 * otherwise a stage's `after`). The popup (js/popup.js) shows the
 * synopsis always and the cast only once the title is watched.
 * Repo-only content: not in the DB or the admin CMS.
 ************************************************/
var projectDetails = {
  "ironman1": {
    synopsis: "Tony Stark is a wealthy, brilliant weapons manufacturer who is taken captive overseas and pressed into building a devastating weapon for his captors. He uses his ingenuity to build something very different, and returns home determined to change the course of his life and his company.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Iron_Man_(film)",
    cast: [["ironman","base"], ["rhodey","base"], ["obadiah","base"], ["pepper","base"], ["coulson","base"], ["happy","base"], ["howardstark","base"], ["nick_fury","base"]]
  },
  "ironman2": {
    synopsis: "Now that the world knows Tony Stark is Iron Man, the government wants his suit, and he won't give it up. With Pepper Potts and Rhodey beside him, Tony has to find new allies and face a dangerous new enemy with a grudge.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Iron_Man_2",
    cast: [["ironman","base"], ["pepper","base"], ["rhodey","ironman2"], ["blackwidow","base"], ["nick_fury","base"], ["coulson","base"], ["howardstark","base"], ["happy","base"]]
  },
  "hulk": {
    synopsis: "Scientist Bruce Banner is on the run, searching for a way to cure the gamma exposure that turns him into a rampaging green giant. Cut off from his love Betty Ross, he stays hidden while her father, General Thunderbolt Ross, and the army hunt him relentlessly. When a far more brutal enemy emerges, Banner must decide how to live with the power inside him.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/The_Incredible_Hulk",
    cast: [["hulk","base"], ["bettyross","base"], ["abomination","base"], ["ironman","base"]]
  },
  "thor1": {
    synopsis: "Thor is the heir to the throne of Asgard, but on the day of his coronation his reckless response to an intrusion by the realm's ancient enemies, the Frost Giants, gets him into serious trouble. His father Odin strips him of his powers and sends him to live on Earth. While his scheming brother Loki stirs up trouble back home, the humbled Thor must face a deadly new threat.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Thor_(film)",
    cast: [["thor","base"], ["janefoster","base"], ["loki","base"], ["odin","base"], ["coulson","base"], ["heimdall","base"], ["nick_fury","base"], ["hawkeye","base"]]
  },
  "cap1": {
    synopsis: "During World War II, Steve Rogers, a small and sickly young man desperate to serve his country, signs up for a secret experimental program. The procedure turns him into a super-soldier, and he steps into the fight as Captain America.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Captain_America:_The_First_Avenger",
    cast: [["cap","base"], ["peggy","base"], ["bucky","base"], ["redskull","base"], ["howardstark","base"], ["nick_fury","base"]]
  },
  "avengers1": {
    synopsis: "When a dangerous new enemy threatens the safety of the entire planet, Nick Fury, director of the peacekeeping agency S.H.I.E.L.D., realises he needs a team to stop a global catastrophe. He sets out across the world to recruit Iron Man, the Hulk, Thor, Captain America, Hawkeye and Black Widow.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/The_Avengers",
    cast: [["ironman","avengers1"], ["cap","avengers1"], ["hulk","avengers1"], ["thor","base"], ["blackwidow","avengers1"], ["hawkeye","base"], ["loki","avengers1"], ["coulson","base"], ["nick_fury","base"], ["pepper","base"], ["thanos_snap","base"]]
  },
  "ironman3": {
    synopsis: "Tony Stark faces a rival whose reach seems unlimited. After his personal world is wrecked by this enemy, he sets out to track down those responsible. Cut off and with few resources, he has to lean on his own ingenuity to protect the people closest to him.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Iron_Man_3",
    cast: [["ironman","avengers1"], ["pepper","base"], ["rhodey","ironman2"], ["killian","base"], ["happy","base"], ["trevor","base"], ["hulk","avengers1"]]
  },
  "thor2": {
    synopsis: "With the events of Thor and The Avengers behind him, Thor is working to bring peace back to the Nine Realms. Then Malekith, the leader of an ancient race, returns to throw the universe back into darkness. Neither Odin nor Asgard can stand against him, so Thor sets out on a dangerous and deeply personal journey that brings him back together with Jane Foster.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Thor:_The_Dark_World",
    cast: [["thor","thor2"], ["janefoster","base"], ["loki","avengers1"], ["odin","base"], ["malekith","base"], ["heimdall","base"]]
  },
  "cap2": {
    synopsis: "Steve Rogers is still getting used to the modern world, living in Washington, D.C. and taking missions for S.H.I.E.L.D. When someone close to him is attacked and a conspiracy begins to surface, he partners with Natasha Romanoff and a new friend to face a ghostly assassin.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Captain_America:_The_Winter_Soldier",
    cast: [["cap","cap2"], ["nick_fury","base"], ["blackwidow","avengers1"], ["bucky","cap2"], ["falcon","base"], ["peggy","base"], ["quicksilver","base"], ["wanda_wv","base"]]
  },
  "guardians1": {
    synopsis: "Adventurer Peter Quill steals a mysterious orb and becomes the target of a relentless bounty hunt led by the powerful Ronan. To survive, he reluctantly teams up with a group of misfits: Rocket, a gun-toting raccoon, Groot, a walking tree, the deadly Gamora and the vengeful Drax. They soon learn how dangerous the orb really is.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Guardians_of_the_Galaxy_(film)",
    cast: [["starlord","base"], ["gamora","base"], ["drax","base"], ["groot","guardians1"], ["rocket","base"], ["ronan","base"], ["yondu","base"], ["nebula","base"], ["thanos_snap","base"], ["cosmo","base"]]
  },
  "ageofultron": {
    synopsis: "Tony Stark tries to kick-start a dormant global peacekeeping program, but the experiment goes badly wrong. The Avengers are pushed to their limits as a new threat, Ultron, appears and sets out to carry out his own plans for the planet. Uneasy alliances form as the team faces a worldwide fight.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Avengers:_Age_of_Ultron",
    cast: [["ironman","avengers1"], ["thor","thor2"], ["hulk","avengers1"], ["cap","avengers1"], ["blackwidow","avengers1"], ["hawkeye","base"], ["ultron","base"], ["nick_fury","base"], ["rhodey","ironman2"], ["quicksilver","base"], ["wanda_wv","base"], ["vision","base"], ["falcon","base"], ["peggy","base"], ["heimdall","base"], ["thanos_snap","base"]]
  },
  "antman": {
    synopsis: "Scott Lang, a thief fresh out of prison, is recruited by the inventor Hank Pym, who has created a suit that lets its wearer shrink while gaining strength. Pym wants Scott to take up the Ant-Man mantle and help him guard the technology from a dangerous new rival. Together they plan a daring heist.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Ant-Man_(film)",
    cast: [["antman","base"], ["hankpym","base"], ["wasp_hope","base"], ["falcon","base"], ["cassie","base"], ["peggy","base"], ["howardstark","base"], ["cap","cap2"], ["bucky","cap2"]]
  },
  "civilwar": {
    synopsis: "Steve Rogers leads the Avengers as they keep protecting the world, but a mission that ends with heavy civilian losses brings growing pressure for the team to answer to a governing body. The proposal divides the heroes: Rogers wants to stay independent, while Tony Stark backs oversight.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Captain_America:_Civil_War",
    cast: [["cap","cap2"], ["ironman","avengers1"], ["blackwidow","avengers1"], ["bucky","cap2"], ["falcon","base"], ["rhodey","ironman2"], ["hawkeye","base"], ["blackpanther","base"], ["vision","base"], ["wanda_wv","base"], ["antman","base"], ["spiderman","base"], ["zemo","base"], ["howardstark","base"]]
  },
  "doctorstrange": {
    synopsis: "Stephen Strange is a celebrated neurosurgeon whose life is wrecked when a car accident ruins his hands. Desperate for a cure, he travels to a mysterious sanctuary called Kamar-Taj, where he discovers a hidden world of magic and a secret war against dark forces that threaten reality. He must decide whether to go back to his old life or take up the fight.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Doctor_Strange_(film)",
    cast: [["drstrange","base"], ["wong","base"], ["dormammu","base"], ["thor","thor2"]]
  },
  "guardians2": {
    synopsis: "The Guardians keep roaming the far reaches of space while trying to hold their new family together. Peter Quill begins to dig into the mystery of who his real father is. Along the way, old enemies turn into allies and some well-loved characters from the comics come to the team's aid.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Guardians_of_the_Galaxy_Vol._2",
    cast: [["starlord","base"], ["gamora","base"], ["drax","base"], ["groot","guardians1"], ["rocket","base"], ["yondu","base"], ["nebula","base"], ["mantis","base"], ["ego","base"]]
  },
  "spiderman1": {
    synopsis: "After his first outing alongside the Avengers, Peter Parker heads home to Queens and his Aunt May, with Tony Stark keeping a watchful eye as his new mentor. Peter tries to settle back into ordinary school life while itching to prove he is more than a friendly neighbourhood hero. Then a new threat, the Vulture, arrives and puts everything he cares about at risk.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Spider-Man:_Homecoming",
    cast: [["spiderman","spiderman1"], ["vulture","base"], ["ironman","avengers1"], ["happy","base"], ["pepper","base"], ["cap","avengers1"], ["scorpion","base"]]
  },
  "thor3": {
    synopsis: "Thor is held prisoner on the far side of the universe, cut off from his hammer and desperate to get back to Asgard before Ragnarok, the destruction of his home, comes to pass. Facing a powerful new enemy who wants the throne, he must first survive a gladiatorial contest on a distant planet, where he comes up against an old friend.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Thor:_Ragnarok",
    cast: [["thor","thor3"], ["loki","avengers1"], ["hela","base"], ["heimdall","base"], ["grandmaster","base"], ["valkyrie","base"], ["hulk","thor3"], ["odin","thor3"], ["drstrange","base"]]
  },
  "blackpanther": {
    synopsis: "After the events of Civil War, T'Challa returns to Wakanda, the secretive and technologically advanced African nation, to be crowned king. When an old enemy resurfaces, his strength as both ruler and Black Panther is tested as he is drawn into a conflict that endangers Wakanda and the wider world.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Black_Panther_(film)",
    cast: [["blackpanther","base"], ["killmonger","base"], ["okoye","base"], ["shuri","base"], ["mbaku","base"]]
  },
  "infinitywar": {
    synopsis: "The Avengers and their allies have kept the world safe from threats too big for any one hero. Now Thanos, a warlord of galactic infamy, is hunting the six Infinity Stones to reshape all of reality to his will. The heroes must unite across Earth and space as the stakes have never been higher.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Avengers:_Infinity_War",
    cast: [["ironman","infinitywar"], ["thor","thor3"], ["hulk","avengers1"], ["cap","infinitywar"], ["blackwidow","infinitywar"], ["rhodey","ironman2"], ["drstrange","base"], ["spiderman","infinitywar"], ["blackpanther","base"], ["gamora","base"], ["nebula","base"], ["loki","avengers1"], ["vision","base"], ["wanda_wv","infinitywar"], ["falcon","base"], ["bucky","infinitywar"], ["heimdall","base"], ["okoye","base"], ["wong","base"], ["mantis","base"], ["drax","base"], ["groot","guardians2"], ["rocket","base"], ["pepper","base"], ["thanos_snap","base"], ["starlord","base"], ["shuri","base"], ["mbaku","base"], ["redskull","base"], ["nick_fury","base"]]
  },
  "antmanwasp": {
    synopsis: "After the fallout of his choices in the Avengers' civil conflict, Scott Lang is trying to balance life as a father with his duties as Ant-Man. Hope van Dyne and Hank Pym pull him back in with an urgent mission, and Scott must team up with the Wasp as they dig into secrets from the Pyms' past.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Ant-Man_and_the_Wasp",
    cast: [["antman","base"], ["wasp_hope","antmanwasp"], ["ghost","base"], ["cassie","base"], ["hankpym","base"]]
  },
  "captainmarvel": {
    synopsis: "Set in the 1990s, the film follows Carol Danvers, a powerful fighter who gets caught up in a war between two alien races and lands on Earth. There she crosses paths with a young Nick Fury and begins to discover who she really is.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Captain_Marvel_(film)",
    cast: [["captainmarvel","base"], ["nick_fury","base"], ["talos","base"], ["ronan","base"], ["coulson","base"], ["monica","base"], ["cap","infinitywar"], ["hulk","base"], ["blackwidow","infinitywar"], ["rhodey","ironman2"]]
  },
  "endgame": {
    synopsis: "After Thanos wiped out half of all life across the universe, the surviving Avengers are left broken and divided. They are driven to make one final stand to try to undo the damage and set things right.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Avengers:_Endgame",
    cast: [["ironman","infinitywar"], ["cap","endgame"], ["hulk","endgame"], ["thor","endgame"], ["blackwidow","infinitywar"], ["hawkeye","endgame"], ["rhodey","ironman2"], ["antman","base"], ["drstrange","base"], ["blackpanther","base"], ["captainmarvel","base"], ["spiderman","infinitywar"], ["nebula","endgame"], ["gamora","base"], ["wasp_hope","antmanwasp"], ["valkyrie","base"], ["janefoster","base"], ["wanda_wv","infinitywar"], ["falcon","base"], ["bucky","infinitywar"], ["okoye","base"], ["wong","base"], ["mantis","base"], ["drax","base"], ["shuri","base"], ["howardstark","base"], ["happy","base"], ["peggy","base"], ["hankpym","base"], ["mbaku","base"], ["groot","guardians2"], ["rocket","base"], ["pepper","endgame"], ["thanos_snap","endgame"], ["starlord","base"], ["nick_fury","base"], ["redskull","base"], ["cassie","base"]]
  },
  "farfromhome": {
    synopsis: "Peter Parker joins his friends on a school trip around Europe, hoping to leave superheroics behind for a few weeks. His plans fall apart when he reluctantly agrees to help Nick Fury look into a string of attacks by elemental creatures wreaking havoc across the continent.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Spider-Man:_Far_From_Home",
    cast: [["spiderman","spiderman1"], ["nick_fury","base"], ["mysterio","base"], ["happy","base"], ["talos","base"]]
  },
  "wandavision": {
    synopsis: "Wanda Maximoff and Vision, two super-powered beings, appear to be living an ideal suburban life, and the show presents it in the style of classic sitcoms from different decades. But as the episodes unfold, the pair begin to suspect that all is not as it seems.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/WandaVision#Season_One",
    cast: [["wanda_wv","wandavision"], ["vision","wandavision"], ["monica","base"], ["agatha","base"], ["tommy","base"], ["teen_agatha","base"]]
  },
  "falconws": {
    synopsis: "Following the events of Avengers: Endgame, Sam Wilson and Bucky Barnes find themselves reluctantly teaming up on a global mission. Sam has been handed the shield, Bucky is struggling with his past, and the two do not always get along as they take on a new threat.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/The_Falcon_and_The_Winter_Soldier#Season_One",
    cast: [["falcon","falconws"], ["bucky","falconws"], ["johnwalker","base"], ["zemo","falconws"], ["rhodey","ironman2"], ["isaiah","base"]]
  },
  "loki1": {
    synopsis: "Set after Avengers: Endgame, this season follows Loki, who has slipped away from his own timeline with the Tesseract. He is picked up by the Time Variance Authority, a bureaucracy that polices the flow of time, and is pressed into helping it deal with a threat to the timeline.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Loki_(TV_series)#Season_One",
    cast: [["loki","loki1"], ["sylvie","base"], ["mobius","base"], ["he_who_remains","base"]]
  },
  "blackwidow": {
    synopsis: "When a conspiracy from her past catches up with her, Natasha Romanoff is hunted by a relentless enemy. To survive, she has to go back to her life as a spy and to the people she left behind long before she was an Avenger.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Black_Widow_(film)",
    cast: [["blackwidow","blackwidow"], ["yelena","base"], ["redguardian","base"], ["taskmaster","base"], ["hawkeye","base"]]
  },
  "shangchi": {
    synopsis: "Shang-Chi has built a quiet life for himself, but his past catches up with him when he is pulled back into the orbit of the mysterious Ten Rings organization.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Shang-Chi_and_the_Legend_of_the_Ten_Rings",
    cast: [["shangchi","base"], ["wenwu","base"], ["trevor","base"], ["xialing","base"], ["wong","base"], ["abomination","base"], ["hulk","endgame"], ["captainmarvel","base"]]
  },
  "eternals": {
    synopsis: "The Eternals are ancient immortal beings who have lived quietly among humans on Earth for thousands of years. After the events of Endgame, an unexpected tragedy pulls them out of hiding and forces them to reunite against humanity's oldest enemy, the Deviants.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Eternals_(film)",
    cast: [["sersi","base"], ["ikaris","base"], ["thena","base"], ["ajak","base"], ["kingo","base"], ["sprite","base"], ["phastos","base"], ["makkari","base"], ["druig","base"], ["gilgamesh","base"]]
  },
  "hawkeye": {
    synopsis: "Former Avenger Clint Barton has one simple goal: get home to his family in time for Christmas. His plan runs into trouble when he is forced to team up with Kate Bishop, a young archer who dreams of becoming a hero, and a threat from his past starts to endanger everything.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Hawkeye_(TV_series)#Season_One",
    cast: [["hawkeye","hawkeye"], ["kate","base"], ["yelena","hawkeye"], ["echo","base"], ["fisk","hawkeye"], ["blackwidow","infinitywar"]]
  },
  "whatif1": {
    synopsis: "An anthology series in which the Watcher, Uatu, looks in on alternate versions of Marvel Cinematic Universe events where one key moment goes differently. The first story asks what would have happened if Peggy Carter, rather than Steve Rogers, had become the first super soldier. Later stories rework other major events from the films.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/What_If...%3F/Season_One",
    cast: [["peggy","base"], ["bucky","cap2"], ["howardstark","base"], ["redskull","base"], ["ultron","base"], ["blackpanther","base"], ["yondu","base"], ["thanos_snap","base"], ["ego","base"], ["nebula","base"], ["okoye","base"], ["nick_fury","base"], ["hawkeye","base"], ["hulk","avengers1"], ["loki","avengers1"], ["coulson","base"], ["blackwidow","avengers1"], ["ironman","avengers1"], ["drstrange","base"], ["wong","base"], ["vision","base"], ["wasp_hope","base"], ["happy","base"], ["spiderman","spiderman1"], ["killmonger","base"], ["rhodey","ironman2"], ["thor","base"], ["janefoster","base"], ["grandmaster","base"], ["captainmarvel","base"], ["cap","avengers1"], ["starlord","base"], ["drax","base"], ["hankpym","base"], ["bettyross","base"], ["obadiah","base"], ["pepper","base"], ["shuri","base"], ["gamora","base"]]
  },
  "nowayhome": {
    synopsis: "Spider-Man's secret identity is exposed to the whole world, and his life as a hero begins to collide with his everyday life, putting the people he loves in danger. Peter asks Doctor Strange to cast a spell to make everyone forget, but it goes wrong and tears a hole in reality. Now he faces the consequences across the Multiverse.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Spider-Man:_No_Way_Home",
    cast: [["spiderman","nowayhome"], ["drstrange","base"], ["happy","base"], ["wong","base"], ["daredevil","base"]]
  },
  "moonknight": {
    synopsis: "Steven Grant is a quiet gift-shop employee plagued by blackouts and strange memories of another life. He learns he shares his body with Marc Spector, a mercenary linked to an Egyptian moon god, and is dragged into a conflict among gods and their followers.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Moon_Knight_(TV_series)#Season_One",
    cast: [["moonknight_mk","base"], ["layla","base"]]
  },
  "drstrange2": {
    synopsis: "Doctor Strange turns to his ally Wong, the Sorcerer Supreme, and to Wanda Maximoff for help as the world around him keeps shifting. A threat looms over humanity and the whole multiverse that no single power can stop, and one of its faces looks exactly like Strange himself.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Doctor_Strange_in_the_Multiverse_of_Madness",
    cast: [["drstrange","drstrange2"], ["wanda_wv","wandavision"], ["wong","drstrange2"], ["america","base"], ["tommy","base"], ["teen_agatha","base"], ["peggy","base"], ["mrcfantastic","base"], ["profx","base"]]
  },
  "msmarvel": {
    synopsis: "Kamala Khan is a Muslim American teenager in Jersey City, a keen gamer and fan-fiction writer who idolises Captain Marvel. She feels out of place at school and sometimes at home, until she suddenly gains super powers like the heroes she admires. Life should get easier now, shouldn't it?",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Ms._Marvel_(TV_series)#Season_One",
    cast: [["msmarvel","base"]]
  },
  "thor4": {
    synopsis: "Thor is searching for inner peace when a galactic killer called Gorr the God Butcher, who wants to wipe out the gods, interrupts his retirement. To stop him, Thor teams up with King Valkyrie, Korg and his ex Jane Foster, who now unexpectedly wields his hammer Mjolnir as the Mighty Thor. Together they set off on a cosmic quest.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Thor:_Love_and_Thunder",
    cast: [["thor","thor4"], ["janefoster","thor4"], ["gorr","base"], ["valkyrie","base"], ["heimdall","base"], ["starlord","base"], ["drax","base"], ["nebula","endgame"], ["mantis","base"], ["groot","guardians2"], ["rocket","base"]]
  },
  "shehulk": {
    synopsis: "Jennifer Walters is a single lawyer in her thirties trying to manage her career and love life while also being a towering, green, super-strong hulk. The series follows her as she juggles courtroom cases with her new powers.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/She-Hulk:_Attorney_at_Law",
    cast: [["shehulk","base"], ["abomination","base"], ["hulk","endgame"], ["wong","drstrange2"], ["daredevil","shehulk"]]
  },
  "werewolfbynight": {
    synopsis: "After the death of their leader, a secret group of monster hunters gathers at a gloomy manor on a dark night. The guests are drawn into a deadly contest to claim a powerful relic, a hunt that leads them toward a dangerous creature.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Werewolf_by_Night_(TV_special)",
    cast: [["jack_russell","base"], ["elsa","base"], ["verussa","base"], ["manthing","base"]]
  },
  "iamgroot1": {
    synopsis: "A series of short, comedic episodes following Baby Groot as he grows up and gets into trouble among the stars. Whether aboard the Guardians' ship or exploring strange worlds, the little tree's curiosity keeps landing him in mischief.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/I_Am_Groot/Season_One",
    cast: [["groot","guardians1"], ["rocket","base"], ["drax","base"]]
  },
  "blackpanther2": {
    synopsis: "After King T'Challa's death, Queen Ramonda, Shuri, M'Baku, Okoye and the Dora Milaje fight to protect Wakanda from world powers moving in on the nation. As the Wakandans work toward their next chapter, they join forces with War Dog Nakia and Everett Ross to chart a new path for the kingdom.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Black_Panther:_Wakanda_Forever",
    cast: [["shuri","blackpanther2"], ["okoye","base"], ["mbaku","base"], ["namor","base"], ["ironheart","base"], ["killmonger","base"]]
  },
  "antman3": {
    synopsis: "Scott Lang and Hope van Dyne, joined by Hope's parents Hank Pym and Janet van Dyne and by Scott's daughter Cassie, are pulled into the Quantum Realm. There they meet strange new creatures and an adventure that tests what they think is possible.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Ant-Man_and_the_Wasp:_Quantumania",
    cast: [["antman","antman3"], ["wasp_hope","antmanwasp"], ["hankpym","base"], ["kang","base"], ["cassie","antman3"], ["loki","loki1"], ["mobius","base"]]
  },
  "guardiansholiday": {
    synopsis: "The Guardians head to Earth in search of the ideal Christmas present for Peter Quill, who is more than a little uneasy about the holiday. The mission involves lights, trees, candy canes and a very famous actor named Kevin Bacon.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/The_Guardians_of_the_Galaxy_Holiday_Special",
    cast: [["starlord","base"], ["drax","base"], ["nebula","endgame"], ["mantis","base"], ["groot","guardians2"], ["rocket","base"], ["yondu","base"], ["cosmo","base"]]
  },
  "guardians3": {
    synopsis: "The Guardians are settling into life on Knowhere when echoes of Rocket's troubled past turn their lives upside down. Peter Quill, still grieving the loss of Gamora, must rally the team for a perilous mission to save Rocket's life, one that could spell the end of the Guardians if it fails.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Guardians_of_the_Galaxy_Vol._3",
    cast: [["highevolutionary","base"], ["rocket","guardians3"], ["mantis","guardians3"], ["drax","guardians3"], ["nebula","guardians3"], ["groot","guardians3"], ["cosmo","base"], ["starlord","guardians3"], ["adam","base"], ["gamora","guardians3"], ["yondu","base"]]
  },
  "secretinvasion": {
    synopsis: "Nick Fury learns that a group of shape-shifting Skrulls has been quietly taking the place of people on Earth. Teaming up with old allies, including the Skrull Talos, who has made a home here, he races to stop the plot.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Secret_Invasion_(TV_series)#Season_One",
    cast: [["nick_fury","secretinvasion"], ["talos","base"], ["gravik","base"], ["rhodey","secretinvasion"]]
  },
  "iamgroot2": {
    synopsis: "Baby Groot is back to causing trouble in the second batch of shorts. This time he roams around the Guardians' ships and meets odd, colourful creatures and settings along the way.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/I_Am_Groot/Season_Two",
    cast: [["groot","guardians1"], ["rocket","base"]]
  },
  "loki2": {
    synopsis: "Season 2 picks up right after the Season 1 finale, with Loki fighting to save the Time Variance Authority. Alongside Mobius, Hunter B-15 and a mix of new and returning allies, he moves through a growing and dangerous multiverse, searching for Sylvie, Judge Renslayer, Miss Minutes and answers about free will and purpose.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Loki_(TV_series)#Season_Two",
    cast: [["loki","loki2"], ["sylvie","base"], ["he_who_remains","base"], ["ouroboros","base"], ["mobius","base"]]
  },
  "themarvels": {
    synopsis: "Carol Danvers has freed herself from the Kree and taken her revenge, but the aftermath has left parts of the universe unstable. When she investigates a strange wormhole, her powers become tangled with those of Kamala Khan and her estranged niece Monica Rambeau. The three must learn to work together.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/The_Marvels",
    cast: [["captainmarvel","themarvels"], ["monica","themarvels"], ["msmarvel","base"], ["nick_fury","secretinvasion"], ["valkyrie","base"], ["kate","base"], ["beast","base"]]
  },
  "echo": {
    synopsis: "Maya Lopez is hunted by Wilson Fisk's criminal empire. The pursuit eventually takes her back to her hometown, where she has to face her family and her legacy.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Echo_(TV_series)#Season_One",
    cast: [["echo","echo"], ["daredevil","base"], ["fisk","hawkeye"]]
  },
  "deadpool3": {
    synopsis: "Wade Wilson has put his Deadpool days behind him and is living a quiet civilian life. When his home universe is threatened, he is pulled back into the suit and has to recruit a very unwilling Wolverine to help.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Deadpool_%26_Wolverine",
    cast: [["deadpool","deadpool3"], ["wolverine","deadpool3"], ["cassandra","base"], ["laura","deadpool3"], ["happy","base"], ["gambit","deadpool3"], ["sabretooth","base"]]
  },
  "whatif2": {
    synopsis: "The Watcher once again guides viewers through the multiverse, showing alternate versions of familiar Marvel Cinematic Universe moments with fresh twists. The season brings back many of the franchise's actors in their original roles alongside new faces.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/What_If...%3F/Season_Two",
    cast: [["nebula","base"], ["yondu","base"], ["groot","base"], ["drax","base"], ["hankpym","base"], ["peggy","base"], ["howardstark","base"], ["thor","base"], ["bucky","base"], ["wasp_hope","base"], ["starlord","base"], ["happy","base"], ["hulk","avengers1"], ["hawkeye","base"], ["ironman","base"], ["blackwidow","base"], ["cap","base"], ["grandmaster","base"], ["valkyrie","base"], ["thanos_snap","base"], ["gamora","base"], ["nick_fury","base"], ["wanda_wv","base"], ["drstrange","base"], ["odin","base"], ["hela","base"], ["wenwu","base"], ["heimdall","base"], ["loki","base"], ["antman","base"], ["ego","base"]]
  },
  "whatif3": {
    synopsis: "Marvel's animated multiverse anthology returns for its final season. The Watcher guides viewers through alternate versions of the MCU where familiar heroes and villains make different choices, taking in new genres, bigger spectacle and some new characters along the way.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/What_If...%3F/Season_Three",
    cast: [["falcon","falconws"], ["hulk","avengers1"], ["monica","base"], ["bucky","base"], ["redguardian","base"], ["shangchi","base"], ["moonknight_mk","base"], ["agatha","base"], ["kingo","base"], ["howardstark","base"], ["obadiah","base"], ["nick_fury","base"], ["thor","base"], ["loki","base"], ["coulson","base"], ["yondu","base"], ["grandmaster","base"], ["thanos_snap","base"], ["ironheart","base"], ["mysterio","base"], ["valkyrie","base"], ["okoye","base"], ["wong","base"], ["kate","base"], ["johnwalker","base"], ["xialing","base"], ["peggy","base"], ["storm","base"], ["nebula","base"], ["groot","base"], ["captainmarvel","base"], ["malekith","base"], ["ultron","base"]]
  },
  "xmen97": {
    synopsis: "Following the apparent loss of Professor X, the X-Men carry on his dream of peace between mutants and humans, with their former enemy Magneto stepping in to lead them. They face fresh threats from a world that still fears and distrusts mutants.",
    wiki: "https://marvel.fandom.com/wiki/X-Men_'97",
    cast: [["cyclops","base"], ["jeangrey","base"], ["storm","base"], ["wolverine","base"], ["rogue","base"], ["gambit","base"], ["beast","base"], ["profx","base"], ["magneto","base"], ["nightcrawler","base"], ["mystique","base"]]
  },
  "marvelzombies": {
    synopsis: "After the Avengers are overrun by a zombie plague, a desperate band of survivors learns of something that might finally stop the super-powered undead. They set out across a harsh, ruined world to save what is left of it.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Marvel_Zombies/Season_One",
    cast: [["wanda_wv","wandavision"], ["antman","antman3"], ["yelena","thunderbolts"], ["redguardian","base"], ["valkyrie","base"], ["shangchi","base"], ["kate","base"], ["johnwalker","base"], ["msmarvel","base"], ["ironheart","ironheart"], ["spiderman","base"], ["okoye","base"], ["wenwu","base"], ["zemo","falconws"], ["thor","thor4"]]
  },
  "agatha": {
    synopsis: "Agatha Harkness is powerless and stranded after a spell breaks, and a mysterious goth teenager appears at her side. He asks her to guide him along the Witches' Road, a legendary set of magical trials that grants a witch what she is missing. Agatha puts together a hastily assembled coven and they set off down the Road.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Agatha_All_Along#Season_One",
    cast: [["agatha","agatha"], ["teen_agatha","base"]]
  },
  "spidermananimated": {
    synopsis: "An animated series following a young Peter Parker as he starts out as a hero in Queens, in a style that nods to the character's early comic book roots. He has to balance school, new friendships and his secret life as Spider-Man.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Your_Friendly_Neighborhood_Spider-Man/Season_One",
    cast: [["spiderman","base"], ["tombstone","base"], ["daredevil","base"], ["drstrange","base"], ["scorpion","base"], ["ironman","infinitywar"]]
  },
  "daredevilbornagain": {
    synopsis: "Matt Murdock, a blind lawyer with heightened senses, fights for justice through his busy law firm, while former crime boss Wilson Fisk chases his own ambitions in New York politics. As their old identities start to resurface, the two men are pushed toward a collision.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Daredevil:_Born_Again#Season_One",
    cast: [["daredevil","daredevilbornagain"], ["fisk","daredevilbornagain"], ["karen","base"], ["foggy","base"], ["bullseye","base"], ["vanessa","base"], ["punisher","base"]]
  },
  "ironheart": {
    synopsis: "Set after Black Panther: Wakanda Forever, the series follows Riri Williams, a young genius inventor who returns to her hometown of Chicago determined to make her name. Her gifts for technology collide with a mysterious, magical force as she gets entangled with a charismatic criminal.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Ironheart_(TV_series)#Season_One",
    cast: [["ironheart","ironheart"]]
  },
  "eyesofwakanda": {
    synopsis: "An animated series about Wakandan warriors across history. The Hatut Zaraze, Wakanda's War Dogs, go on dangerous missions around the world to bring home Vibranium stolen by Wakanda's enemies.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Eyes_of_Wakanda",
    cast: []
  },
  "cap4": {
    synopsis: "Sam Wilson is now Captain America. Soon after he meets the new US President, Thaddeus Ross, he is caught up in an international incident, and he has to work out who is behind a global plot before it sets the world against him.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Captain_America:_Brave_New_World",
    cast: [["falcon","cap4"], ["red_hulk","base"], ["isaiah","base"], ["bettyross","base"], ["bucky","falconws"]]
  },
  "thunderbolts": {
    synopsis: "A group of disillusioned antiheroes, including Yelena Belova, Bucky Barnes, Red Guardian, Ghost, Taskmaster and John Walker, find themselves trapped in a deadly setup arranged by Valentina Allegra de Fontaine. To survive they must go on a dangerous mission that forces them to face the darkest parts of their pasts.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Thunderbolts*",
    cast: [["yelena","thunderbolts"], ["bucky","thunderbolts"], ["sentry","base"], ["redguardian","base"], ["johnwalker","base"], ["ghost","thunderbolts"], ["taskmaster","base"]]
  },
  "fantasticfour": {
    synopsis: "In a retro-futuristic world inspired by the 1960s, Marvel's First Family - Reed Richards, Sue Storm, Johnny Storm and Ben Grimm - must balance being heroes with being a family. Their toughest test comes when a ravenous space god, Galactus, and his Herald threaten Earth.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/The_Fantastic_Four:_First_Steps",
    cast: [["mrcfantastic","base"], ["invisiblewoman","base"], ["thething","base"], ["humantorch","base"], ["galactus","base"], ["silversurfer","base"]]
  },
  "wonderman": {
    synopsis: "Simon Williams is an actor who can't get his big break. When he meets the faded star Trevor Slattery and hears that director Von Kovak is making a new Wonder Man film, the two set out to win parts in it, in a comedy about how Hollywood really works.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Wonder_Man_(TV_series)#Season_One",
    cast: [["simonwilliams","base"], ["trevor","wonderman"]]
  },
  "daredevilbornagain2": {
    synopsis: "Mayor Wilson Fisk is tightening his hold on New York and hunting the vigilante Daredevil. Working in secret, Matt Murdock fights to bring down the Kingpin's corrupt empire and take back his city.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Daredevil:_Born_Again/Season_Two",
    cast: [["daredevil","daredevilbornagain2"], ["fisk","daredevilbornagain"], ["bullseye","daredevilbornagain2"], ["karen","base"], ["foggy","base"], ["mr_charles","base"], ["vanessa","base"], ["jessicajones","base"]]
  },
  "punisheronelastkill": {
    synopsis: "Frank Castle is searching for some meaning beyond revenge, but an unexpected force drags him back into the fight.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/The_Punisher:_One_Last_Kill",
    cast: [["punisher","punisheronelastkill"], ["ma_gnucci","base"], ["karen","base"], ["curtis_hoyle","base"]]
  },
  "brandnewday": {
    synopsis: "The world has forgotten Peter Parker, but he is still Spider-Man full-time, fighting crime on his own as his old friends move on without him. The strain of living like this, and a strange new case, start to force a change.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Spider-Man:_Brand_New_Day",
    cast: [["spiderman","brandnewday"], ["hulk","endgame"], ["punisher","punisheronelastkill"], ["jeangrey","base"], ["yelena","thunderbolts"], ["scorpion","brandnewday"], ["tombstone","base"]]
  },
  "visionquest": {
    synopsis: "Vision is back online and in hiding, on the run from people who want to use him as a weapon. Looking for a purpose, he turns to the AI voices inside his own code, Ultron among them. When a bounty is put on his head, he goes on the run with a strange boy who may be his son.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/VisionQuest#Season_One",
    cast: [["vision","visionquest"], ["ultron","visionquest"], ["tommy","visionquest"], ["paladin","base"], ["jocasta","base"]]
  },
  "xmen1": {
    synopsis: "In a near future where mutants are feared and a bill to force them to register is being debated, young Rogue runs away from home and meets the loner Wolverine. Both are drawn into a conflict between Professor Xavier's mutants and Magneto's brotherhood, who believe humanity must be challenged.",
    wiki: "https://xmenmovies.fandom.com/wiki/X-Men_(film)",
    cast: [["profx","base"], ["wolverine","base"], ["magneto","base"], ["storm","base"], ["jeangrey","base"], ["cyclops","base"], ["mystique","base"], ["sabretooth","base"], ["rogue","base"]]
  },
  "xmen2": {
    synopsis: "After a mutant attacks the President, anti-mutant fear grows and a military figure launches an attack on Xavier's school. The X-Men have to work with uneasy allies as they confront a new threat to their kind.",
    wiki: "https://xmenmovies.fandom.com/wiki/X2:_X-Men_United",
    cast: [["profx","base"], ["wolverine","base"], ["magneto","base"], ["storm","base"], ["jeangrey","base"], ["cyclops","base"], ["mystique","base"], ["nightcrawler","base"], ["rogue","base"]]
  },
  "doomsday": {
    synopsis: "Heroes from three separate universes are sent on a collision course and must face a threat unlike anything they have met before.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Avengers:_Doomsday",
    cast: [["thor","thor4"], ["cap","endgame"], ["mrcfantastic","base"], ["yelena","thunderbolts"], ["invisiblewoman","base"], ["falcon","cap4"], ["bucky","thunderbolts"], ["shuri","blackpanther2"], ["antman","antman3"], ["johnwalker","base"], ["namor","base"], ["thething","base"], ["shangchi","base"], ["beast","base"], ["sentry","base"], ["humantorch","base"], ["redguardian","base"], ["mbaku","base"], ["ghost","thunderbolts"], ["loki","loki2"], ["profx","base"], ["magneto","base"], ["nightcrawler","base"], ["mystique","base"], ["cyclops","base"], ["gambit","deadpool3"], ["drstrange","drstrange2"], ["peggy","base"], ["america","base"], ["cassie","antman3"]]
  },
  "xmen3": {
    synopsis: "A cure for the mutant gene is developed, splitting the mutant community. Magneto raises an army of mutants who refuse to be changed, while the X-Men, led by Logan and Storm, try to hold the line. Rogue and Iceman face hard choices of their own as the conflict grows.",
    wiki: "https://xmenmovies.fandom.com/wiki/X-Men:_The_Last_Stand",
    cast: [["wolverine","base"], ["storm","base"], ["magneto","base"], ["jeangrey","xmen3"], ["rogue","base"], ["beast","base"], ["cyclops","base"], ["mystique","base"], ["profx","base"]]
  },
  "firstclass": {
    synopsis: "In the early 1960s, as the world edges toward nuclear war, young telepath Charles Xavier and Erik Lehnsherr come together to recruit other mutants with help from the CIA. Meanwhile a powerful mutant villain works to push the superpowers into conflict.",
    wiki: "https://xmenmovies.fandom.com/wiki/X-Men:_First_Class",
    cast: [["profx","firstclass"], ["magneto","firstclass"], ["mystique","firstclass"], ["beast","firstclass"], ["wolverine","base"]]
  },
  "dofp": {
    synopsis: "The X-Men fight a war for mutant survival across two time periods. The heroes of the original trilogy team up with their younger selves from First Class, hoping to change a pivotal moment in history and save the future in an epic battle.",
    wiki: "https://xmenmovies.fandom.com/wiki/X-Men:_Days_of_Future_Past",
    cast: [["wolverine","base"], ["profx","firstclass"], ["magneto","firstclass"], ["mystique","firstclass"], ["storm","base"], ["beast","firstclass"], ["rogue","base"], ["peter_maximoff","base"], ["jeangrey","base"], ["cyclops","base"], ["apocalypse","base"]]
  },
  "apocalypse": {
    synopsis: "Thousands of years ago, the first and most powerful mutant was worshipped as a god. Betrayed and buried, he wakes in the 1980s and sets out to rebuild the world in his own image. Charles Xavier, Mystique and a team of younger mutants must unite to stop him.",
    wiki: "https://xmenmovies.fandom.com/wiki/X-Men:_Apocalypse",
    cast: [["profx","firstclass"], ["magneto","firstclass"], ["mystique","firstclass"], ["apocalypse","base"], ["beast","firstclass"], ["peter_maximoff","apocalypse"], ["cyclops","apocalypse"], ["jeangrey","apocalypse"], ["nightcrawler","apocalypse"], ["storm","apocalypse"], ["wolverine","base"]]
  },
  "darkphoenix": {
    synopsis: "Jean Grey is struck by a powerful cosmic force during a dangerous rescue mission in space. As she struggles to control her growing, unstable abilities and her own inner demons, her behaviour puts the bonds of the X-Men family under strain.",
    wiki: "https://xmenmovies.fandom.com/wiki/X-Men:_Dark_Phoenix",
    cast: [["jeangrey","apocalypse"], ["profx","firstclass"], ["magneto","firstclass"], ["mystique","firstclass"], ["beast","firstclass"], ["cyclops","apocalypse"], ["storm","apocalypse"], ["peter_maximoff","apocalypse"], ["nightcrawler","apocalypse"]]
  },
  "wolverineorigins": {
    synopsis: "The film explores the violent, romantic past of Logan, his complicated relationship with his brother Victor Creed and the secretive Weapon X program that gave him his adamantium claws. Along the way he crosses paths with other mutants.",
    wiki: "https://xmenmovies.fandom.com/wiki/X-Men_Origins:_Wolverine",
    cast: [["wolverine","base"], ["sabretooth","wolverineorigins"], ["gambit","base"], ["deadpool","base"], ["cyclops","base"], ["profx","base"]]
  },
  "thewolverine": {
    synopsis: "Wolverine goes to modern-day Japan, a world he doesn't know, where he meets dangerous new enemies. As he wrestles with being unable to die, the fight tests his body and his spirit like never before.",
    wiki: "https://xmenmovies.fandom.com/wiki/The_Wolverine",
    cast: [["wolverine","base"], ["jeangrey","base"], ["profx","base"], ["magneto","base"]]
  },
  "logan": {
    synopsis: "In the near future, a worn-out Logan is looking after an ailing Charles Xavier in a hideout on the Mexican border. His efforts to stay out of sight are upended when a young mutant shows up with dangerous people on her trail.",
    wiki: "https://xmenmovies.fandom.com/wiki/Logan_(film)",
    cast: [["wolverine","logan"], ["profx","logan"], ["laura","base"]]
  },
  "deadpool1": {
    synopsis: "Wade Wilson, an ex-soldier turned mercenary, undergoes an illegal experiment that leaves him scarred but able to heal from anything. Calling himself Deadpool, he goes after the man who ruined his life, with plenty of jokes along the way.",
    wiki: "https://xmenmovies.fandom.com/wiki/Deadpool_(film)",
    cast: [["deadpool","base"]]
  },
  "deadpool2": {
    synopsis: "Wade Wilson, the wisecracking mercenary Deadpool, ends up protecting a troubled young mutant from a brutal soldier who has travelled back in time. To take on the threat, he assembles a ragtag team of fellow mutants.",
    wiki: "https://xmenmovies.fandom.com/wiki/Deadpool_2",
    cast: [["deadpool","base"], ["cable","base"], ["profx","firstclass"], ["cyclops","apocalypse"], ["storm","apocalypse"], ["nightcrawler","apocalypse"], ["beast","firstclass"], ["peter_maximoff","apocalypse"]]
  },
  "daredevil1": {
    synopsis: "Matt Murdock lost his sight in an accident as a boy but gained sharpened senses. He opens a law firm in his home neighbourhood of Hell's Kitchen: a lawyer by day, and by night a masked vigilante.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Daredevil_(TV_series)#Season_One",
    cast: [["daredevil","base"], ["karen","base"], ["foggy","base"], ["fisk","base"], ["vanessa","base"]]
  },
  "daredevil2": {
    synopsis: "Matt Murdock believes he is bringing order back to Hell's Kitchen, but new forces rise in the neighbourhood. A vengeful man named Frank Castle starts taking justice into his own hands, and an old flame from Matt's past returns, forcing Matt to decide what kind of hero he wants to be.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Daredevil_(TV_series)#Season_Two",
    cast: [["daredevil","base"], ["karen","base"], ["foggy","base"], ["punisher","base"], ["elektra","base"], ["fisk","base"]]
  },
  "daredevil3": {
    synopsis: "After going missing for months, Matt Murdock returns a broken man, unsure whether he can continue as Daredevil or even as a lawyer. When his old enemy Wilson Fisk is freed from prison, Matt has to choose between hiding from the world and embracing his role as a hero.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Daredevil_(TV_series)/Season_Three",
    cast: [["daredevil","base"], ["karen","base"], ["foggy","base"], ["bullseye","base"], ["fisk","base"], ["vanessa","base"]]
  },
  "jessicajones1": {
    synopsis: "After a short-lived superhero career ended badly, Jessica Jones is rebuilding her life as a sardonic, hard-drinking private investigator in Hell's Kitchen. Haunted by trauma, she uses her unusual abilities to help people in need, especially if they can pay.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Jessica_Jones_(TV_series)#Season_One",
    cast: [["jessicajones","base"], ["lukecage","base"], ["trish","base"], ["kilgrave","base"]]
  },
  "jessicajones2": {
    synopsis: "Jessica Jones wants to get her life back together, but half of New York now sees her as a super-powered murderer. A new case pushes her to dig into her own past and the question of who she really is.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Jessica_Jones_(TV_series)/Season_Two",
    cast: [["jessicajones","base"], ["trish","base"], ["kilgrave","base"], ["foggy","base"]]
  },
  "jessicajones3": {
    synopsis: "Jessica's path crosses with a highly intelligent psychopath, while she and her sister-like friend Trish must mend their strained relationship. Their very different ideas of what it means to be a hero begin to pull them apart.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Jessica_Jones_(TV_series)/Season_Three",
    cast: [["jessicajones","base"], ["trish","base"], ["lukecage","base"]]
  },
  "lukecage1": {
    synopsis: "A sabotaged experiment left Luke Cage super-strong with unbreakable skin. Now a fugitive keeping his head down in Harlem, he is pulled back into the open and has to face the past he tried to leave behind.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Luke_Cage_(TV_series)#Season_One",
    cast: [["lukecage","base"], ["cottonmouth","base"], ["mistynight","base"]]
  },
  "lukecage2": {
    synopsis: "Luke Cage's name is cleared and Harlem now treats him as a celebrity hero. Being famous makes him even more determined to protect his neighbourhood, but a powerful new enemy tests how far he is willing to go.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Luke_Cage_(TV_series)/Season_Two",
    cast: [["lukecage","base"], ["mistynight","base"], ["ironfist","base"], ["colleen","base"], ["foggy","base"]]
  },
  "ironfist1": {
    synopsis: "Danny Rand was believed dead after the plane crash that killed his parents in the Himalayas. Raised and trained by the monks of the hidden city of K'un-Lun, he comes home to New York fifteen years later to reclaim his family's company.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Iron_Fist_(TV_series)#Season_One",
    cast: [["ironfist","base"], ["colleen","base"]]
  },
  "ironfist2": {
    synopsis: "With Matt Murdock gone, Danny Rand has promised to step up and protect New York with his kung-fu skills and the fiery power of the Iron Fist. As he sets out to guard the city and those close to him, a threat emerges that puts his very identity at stake.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/Iron_Fist_(TV_series)#Season_Two",
    cast: [["ironfist","base"], ["colleen","base"], ["mistynight","base"]]
  },
  "defenders": {
    synopsis: "Daredevil, Jessica Jones, Luke Cage and Iron Fist are four solitary New York heroes, each burdened with personal troubles. With a common goal of protecting the city, they discover they may be stronger working together.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/The_Defenders",
    cast: [["daredevil","base"], ["jessicajones","base"], ["lukecage","base"], ["ironfist","base"], ["foggy","base"], ["colleen","base"], ["mistynight","base"], ["trish","base"], ["karen","base"], ["elektra","base"]]
  },
  "punisher1": {
    synopsis: "Frank Castle has had his revenge on the men behind his family's murder, but he starts to suspect that what happened to them was part of something far bigger than New York's gangs. As the Punisher, he goes looking for the truth.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/The_Punisher/Season_One",
    cast: [["punisher","base"], ["curtis_hoyle","base"], ["karen","base"]]
  },
  "punisher2": {
    synopsis: "Frank Castle is trying to live a quiet life on the road when he steps in to save a teenage girl from people trying to kill her. Protecting her drags him into a mystery, and old enemies as well as new ones push him back towards being the Punisher.",
    wiki: "https://marvelcinematicuniverse.fandom.com/wiki/The_Punisher/Season_Two",
    cast: [["punisher","base"], ["curtis_hoyle","base"], ["karen","base"]]
  }
};
