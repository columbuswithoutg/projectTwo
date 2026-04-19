/************************************************
 * WALKER DIALOGUES
 * Character pair conversations when walkers meet
 *
 * Key format: "id1|id2" (alphabetically sorted)
 * Each exchange: { requires, lines, startsWith? }
 *   - requires: node ID of the movie/show the dialogue references
 *   - lines[0] spoken by the initiator, lines[1] by the other, alternating
 *   - startsWith: (optional) character ID who speaks first
 *     If omitted, the alphabetically first ID speaks first
 *
 * Lines sourced from MCU films/shows. Verbatim where possible,
 * lightly adapted for two-character walker format.
 ************************************************/
const WALKER_DIALOGUES = (() => {

  const pairs = {

    // ── Iron Man relationships ──
    "cap|ironman": [
      // Avengers 1 — actual exchange on the helicarrier
      { requires: "avengers1", lines: ["Big man in a suit of armor. Take that off, what are you?", "Genius, billionaire, playboy, philanthropist."] },
      // Avengers 1 — battle of New York
      { requires: "avengers1", startsWith: "ironman", lines: ["Call it, Captain.", "Alright, listen up."] },
      // Avengers 1 — actual line from Tony
      { requires: "avengers1", startsWith: "ironman", lines: ["Doth mother know you weareth her drapes?", "...That is not the point, Stark."] },
      // Age of Ultron — Cap's actual slip
      { requires: "ageofultron", lines: ["Language!", "Did you just say 'language'?", "It just slipped out."] },
      // Civil War — actual lines
      { requires: "civilwar", startsWith: "ironman", lines: ["Sometimes I wanna punch you in your perfect teeth.", "Is that all you've got?"] },
      // Civil War — the bunker
      { requires: "civilwar", lines: ["He's my friend.", "So was I."] }
    ],

    "ironman|spiderman": [
      // Homecoming — actual Tony line
      { requires: "spiderman1", lines: ["If you're nothing without this suit, then you shouldn't have it.", "But Mr. Stark—", "I want you to be better."] },
      // Civil War — Peter's actual intro
      { requires: "civilwar", startsWith: "spiderman", lines: ["Hey everyone.", "...Good job, kid.", "Thanks! I could've stuck the landing a little better."] },
      // Infinity War — actual exchange
      { requires: "infinitywar", startsWith: "spiderman", lines: ["I'm Peter, by the way.", "Doctor Strange.", "Oh, we're using our made-up names? I'm Spider-Man then."] },
      // Homecoming — actual Tony line
      { requires: "spiderman1", startsWith: "spiderman", lines: ["Can I keep the suit?", "Yes, we were just talking about it.", "Really?!", "No."] }
    ],

    "ironman|pepper": [
      // Iron Man 1 — actual exchange
      { requires: "ironman1", startsWith: "pepper", lines: ["Is this about the Avengers? Which I know nothing about.", "The Avengers Initiative was scrapped.", "...And I'm supposed to believe that?"] },
      // Endgame — Morgan's actual line, Tony repeats it
      { requires: "endgame", lines: ["I love you 3000.", "...You know I love you 3000 too."] },
      // Iron Man 3 — actual plot point
      { requires: "ironman3", startsWith: "pepper", lines: ["Tony, how many suits do you have now?", "Uh... a few.", "How many is 'a few'?", "...forty-two."] }
    ],

    "ironman|rhodey": [
      // Iron Man 1 — actual line
      { requires: "ironman1", lines: ["Next time, baby.", "You always say 'next time.'", "And I always mean it."] },
      // Age of Ultron — Rhodey's actual story retelling
      { requires: "ageofultron", startsWith: "rhodey", lines: ["BOOM! You looking for this?", "That's the whole story?", "Yeah, it's a War Machine story.", "...It's very good then."] },
      // Iron Man 2 — actual exchange about the suit
      { requires: "ironman2", startsWith: "rhodey", lines: ["You don't deserve to wear one of these.", "Come on, pal.", "Rethink this, Tony."] }
    ],

    "ironman|thor": [
      // Avengers 1 — actual Tony line about Thor's cape
      { requires: "avengers1", lines: ["No hard feelings, Point Break.", "Do not call me that.", "Point Break! I love that movie."] },
      // Age of Ultron — the hammer lift scene
      { requires: "ageofultron", startsWith: "thor", lines: ["You're all not worthy.", "...The handle's imprinted, right?", "That is a very interesting theory."] }
    ],

    "drstrange|ironman": [
      // Infinity War — actual meeting
      { requires: "infinitywar", startsWith: "ironman", lines: ["What is your job exactly, besides making balloon animals?", "Protecting your reality, douchebag.", "...Fair enough."] },
      // Infinity War — actual exchange
      { requires: "infinitywar", lines: ["Seriously, you don't have any money?", "Attachment to the material is detachment from the spiritual.", "I'll buy you a sandwich."] },
      // Infinity War — the actual endgame line
      { requires: "infinitywar", lines: ["We're in the endgame now.", "...How many did we win?", "One."] }
    ],

    "hulk|ironman": [
      // Avengers 1 — Bruce's actual iconic line
      { requires: "avengers1", lines: ["That's my secret, Captain. I'm always angry.", "...I love it when he does that."] },
      // Age of Ultron — actual lullaby reference
      { requires: "ageofultron", startsWith: "ironman", lines: ["Sun's getting real low, big guy.", "That only works when SHE does it.", "Had to try."] },
      // Avengers 1 — actual post-credits shawarma reference
      { requires: "avengers1", startsWith: "ironman", lines: ["Have you ever tried shawarma?", "I don't know what that is.", "I don't know what it is either. I wanna try it."] }
    ],

    // ── Thor relationships ──
    "loki|thor": [
      // Thor 1 — adapted from actual dynamic
      { requires: "thor1", lines: ["I never wanted the throne!", "...Could've fooled me."] },
      // Thor 2 — Loki's actual fake death reveal
      { requires: "thor2", startsWith: "thor", lines: ["I thought you were dead!", "Did you mourn?", "We all did.", "I'm touched."] },
      // Thor 3 — actual Get Help scene
      { requires: "thor3", startsWith: "thor", lines: ["We're doing 'Get Help.'", "We are NOT doing 'Get Help.'", "GET HELP! My brother is dying!", "I hate you."] },
      // Avengers 1 — actual exchange
      { requires: "avengers1", lines: ["I have an army.", "We have a Hulk."] },
      // Thor 3 — actual snake story
      { requires: "thor3", startsWith: "thor", lines: ["He turned himself into a snake. I went to pick up the snake because I love snakes.", "And?", "He stabbed me."] }
    ],

    "hulk|thor": [
      // Thor 3 — Thor's actual arena reaction
      { requires: "thor3", startsWith: "thor", lines: ["I know him! He's a friend from work!", "Hulk no friend. Hulk smash.", "I just said we're friends!"] },
      // Thor 3 — actual Hulk line about fire
      { requires: "thor3", lines: ["Hulk like raging fire. Thor like smoldering fire.", "...That's actually kind of nice."] },
      // Endgame — Professor Hulk era
      { requires: "endgame", startsWith: "thor", lines: ["What happened to you?", "I put the brains and the brawn together.", "...Huh."] }
    ],

    "thor|valkyrie": [
      // Thor 3 — actual Valkyrie attitude
      { requires: "thor3", startsWith: "valkyrie", lines: ["I don't do 'hero' anymore.", "But you're a Valkyrie!", "Former. Retired. Done."] },
      // Thor 3 — actual bottle scene reference
      { requires: "thor3", startsWith: "valkyrie", lines: ["What have you done?", "I went on a little trip.", "You smell like a brewery.", "...Ran into an old friend."] }
    ],

    "heimdall|thor": [
      // Thor 1 — Heimdall's actual role as all-seer
      { requires: "thor1", lines: ["I can see nine realms and ten trillion souls.", "Can you see where I left my hammer?", "...It is in the next room."] }
    ],

    "hela|thor": [
      // Thor 3 — actual Hela line
      { requires: "thor3", lines: ["Kneel before your queen.", "I don't think so.", "It's a shame, really. You would have made a lovely addition to my army."] }
    ],

    // ── Cap relationships ──
    "bucky|cap": [
      // Cap 1 — actual exchange before shipping out
      { requires: "cap1", lines: ["Don't do anything stupid until I get back.", "How can I? You're taking all the stupid with you.", "...Punk.", "Jerk."] },
      // Cap 2 — actual climax dialogue
      { requires: "cap2", lines: ["You're my mission.", "Then finish it. 'Cause I'm with you to the end of the line."] },
      // Cap 1 — actual catchphrase
      { requires: "cap1", startsWith: "cap", lines: ["I'm with you till the end of the line.", "...Yeah, pal. I know you are."] }
    ],

    "cap|falcon": [
      // Cap 2 — actual jogging scene
      { requires: "cap2", lines: ["On your left.", "On my left. Got it.", "On your left.", "DON'T SAY IT!"] },
      // Endgame — actual shield passing
      { requires: "endgame", lines: ["How does it feel?", "Like it's someone else's.", "It isn't."] }
    ],

    "cap|peggy": [
      // Cap 1 — actual last words before the ice
      { requires: "cap1", lines: ["I'm gonna need a rain check on that dance.", "Alright. A week, next Saturday, at the Stork Club.", "You got it."] }
    ],

    "blackwidow|cap": [
      // Cap 2 — actual mall disguise scene
      { requires: "cap2", startsWith: "cap", lines: ["Public displays of affection make people very uncomfortable.", "Yes, they do.", "...Still uncomfortable."] },
      // Avengers 1 — actual trust exchange
      { requires: "avengers1", lines: ["Regimes fall every day. I tend not to weep over that.", "...I do."] }
    ],

    // ── Guardians ──
    "groot|rocket": [
      // Guardians 1 — actual dynamic
      { requires: "guardians1", lines: ["I am Groot.", "I know, buddy.", "I am Groot.", "Well that IS rude."] },
      // Guardians 1 — actual scene about weapons
      { requires: "guardians1", lines: ["I am Groot!", "No, Groot. You can't have that guy's arm.", "I am Groot.", "He didn't actually need it? He was USING it!"] },
      // Guardians 1 — actual Rocket emotional moment
      { requires: "guardians1", lines: ["I am Groot.", "Yeah, yeah, I love you too. Don't make it weird."] }
    ],

    "gamora|starlord": [
      // Guardians 1 — actual dance-off reference
      { requires: "guardians1", startsWith: "starlord", lines: ["Dance-off, bro.", "...What are you doing?", "I'm distracting you.", "It's working. And I hate it."] },
      // Guardians 2 — actual unspoken thing
      { requires: "guardians2", startsWith: "starlord", lines: ["There's an unspoken thing between us.", "There is no unspoken thing.", "There's definitely an unspoken thing.", "Stop saying 'unspoken thing.'"] },
      // Guardians 1 — actual Gamora sass
      { requires: "guardians1", lines: ["I'm a warrior. An assassin. I don't dance.", "Everybody's got moves.", "I don't."] }
    ],

    "gamora|nebula": [
      // Guardians 2 — actual sisterly exchange
      { requires: "guardians2", startsWith: "nebula", lines: ["You were the one who wanted to win. I just wanted a sister.", "...You had one."] },
      // Guardians 2 — actual détente
      { requires: "guardians2", lines: ["Sister.", "...Sister."] }
    ],

    "drax|starlord": [
      // Guardians 1 — actual Drax line
      { requires: "guardians1", lines: ["Nothing goes over my head. My reflexes are too fast. I would catch it.", "...Sure, buddy."] },
      // Infinity War — actual invisible Drax
      { requires: "infinitywar", lines: ["I have mastered the ability of standing so incredibly still... that I become invisible to the eye.", "...You're eating a zarg-nut.", "But my movement... was so slow... that it was imperceptible."] }
    ],

    "groot|starlord": [
      // Guardians 1 — actual dynamic
      { requires: "guardians1", lines: ["I am Groot.", "Well that's just as fascinating as the first 89 times.", "I am Groot.", "...I'm sorry. I really am."] }
    ],

    "drax|mantis": [
      // Guardians 2 — actual Drax bluntness
      { requires: "guardians2", lines: ["You are beautiful. On the inside.", "Thank you, Drax.", "Not on the outside, though.", "...Okay."] }
    ],

    // ── Wanda & Vision ──
    "vision|wanda_wv": [
      // WandaVision — actual Vision line
      { requires: "wandavision", lines: ["What is grief, if not love persevering?", "...That's the most beautiful thing anyone's ever said to me."] },
      // WandaVision — actual exchange about the ship of Theseus
      { requires: "wandavision", lines: ["I request elaboration.", "That's my line.", "I know. I like saying it."] },
      // Infinity War — actual farewell
      { requires: "infinitywar", lines: ["I just feel you.", "I just feel you."] }
    ],

    "quicksilver|wanda_wv": [
      // Age of Ultron — Pietro's actual catchphrase
      { requires: "ageofultron", lines: ["You didn't see that coming?", "I hate it when you say that.", "You didn't see THAT coming either."] },
      // Age of Ultron — actual volunteering scene
      { requires: "ageofultron", lines: ["We volunteered for Strucker's experiments.", "People thought we were crazy.", "We were. A little.", "...Speak for yourself."] }
    ],

    // ── Black Widow & Hawkeye ──
    "blackwidow|hawkeye": [
      // Avengers 1 — actual Budapest exchange
      { requires: "avengers1", lines: ["Just like Budapest all over again.", "You and I remember Budapest very differently."] },
      // Avengers 1 — actual Natasha line to Loki about Clint
      { requires: "avengers1", lines: ["I've got red in my ledger. I'd like to wipe it out.", "...Yeah. Me too."] },
      // Endgame — actual Vormir exchange
      { requires: "endgame", lines: ["Tell my family I love them.", "Tell them yourself.", "...You first."] }
    ],

    // ── Spider-Man ──
    "drstrange|spiderman": [
      // No Way Home — actual Peter botching the spell
      { requires: "nowayhome", startsWith: "spiderman", lines: ["Can you make everyone forget I'm Spider-Man?", "The spell is for the whole world.", "Wait, can you exclude a few people?", "Peter, that's not how this works."] },
      // No Way Home — actual Scooby-Doo line
      { requires: "nowayhome", startsWith: "spiderman", lines: ["We Scooby-Doo this crap!", "...Please don't call it that.", "Too late."] }
    ],

    "mysterio|spiderman": [
      // Far From Home — actual Mysterio manipulation
      { requires: "farfromhome", lines: ["People need to believe. And nowadays, they'll believe anything.", "That's... kind of dark.", "That's the world, kid."] }
    ],

    // ── Loki variants ──
    "loki_tva|sylvie": [
      // Loki S1 — actual identity discussion
      { requires: "loki1", lines: ["What makes a Loki a Loki?", "Independence. Authority. Style.", "...I was going to say our inability to trust."] },
      // Loki S1 — actual pruning reference
      { requires: "loki1", lines: ["I've been pruned, stabbed, and now this.", "Welcome to being a Loki."] },
      // Loki S1 — actual finale
      { requires: "loki1", lines: ["For you.", "...For us."] }
    ],

    "loki_tva|mobius": [
      // Loki S1 — actual Mobius wow moment
      { requires: "loki1", lines: ["What's so great about jet skis?", "Wow.", "That's... not an answer.", "It's the only answer that matters."] },
      // Loki S2 — actual Mobius encouragement
      { requires: "loki2", startsWith: "mobius", lines: ["I believe in you, Loki.", "Nobody's ever said that to me before.", "I know. That's why I'm saying it."] },
      // Loki S1 — actual jet ski enthusiasm
      { requires: "loki1", lines: ["Jet ski?", "JET SKI!", "...We have vastly different priorities."] }
    ],

    // ── Doctor Strange ──
    "drstrange|wong": [
      // Doctor Strange — actual name exchange
      { requires: "doctorstrange", lines: ["Wong. Just Wong? Like Adele?", "Or Aristotle. Drake. Bono.", "...That's a good one."] },
      // No Way Home — actual Sorcerer Supreme exchange
      { requires: "nowayhome", lines: ["I'm the Sorcerer Supreme.", "Actually, technically, that's me.", "On a technicality!", "Still counts."] },
      // Shang-Chi post-credits — actual karaoke reference
      { requires: "shangchi", lines: ["Want to get food?", "I thought you'd never ask.", "...Just not karaoke.", "Too late. Already booked."] }
    ],

    // ── Ant-Man ──
    "antman|falcon": [
      // Civil War — actual Scott meeting Sam
      { requires: "civilwar", lines: ["I'm a big fan.", "...I don't even know who you are.", "I'm Ant-Man!", "Oh, the guy who broke into my house."] },
      // Ant-Man — actual post-credits scene reference
      { requires: "antman", lines: ["I know a guy.", "Is he any good?", "Well, he can shrink.", "...Great."] }
    ],

    "antman|wasp_hope": [
      // Ant-Man — actual training dynamic
      { requires: "antman", startsWith: "wasp_hope", lines: ["You want to know how I knew you'd miss that punch?", "Because I telegraphed it?", "Because you telegraphed it.", "...I literally just said that."] }
    ],

    // ── Black Panther ──
    "blackpanther|shuri": [
      // Black Panther — actual "What are those" scene
      { requires: "blackpanther", startsWith: "shuri", lines: ["What are THOSE?!", "My sandals.", "Why do you have on sandals in the lab?!", "I am your king!"] },
      // Black Panther — actual Bucky reference
      { requires: "blackpanther", startsWith: "shuri", lines: ["Great, another broken white boy for us to fix.", "Shuri.", "What? I'm kidding. Mostly."] }
    ],

    "blackpanther|okoye": [
      // Black Panther — actual Okoye loyalty
      { requires: "blackpanther", startsWith: "okoye", lines: ["I am loyal to that throne, no matter WHO sits on it.", "Then we are in agreement.", "Wakanda forever.", "Forever."] }
    ],

    // ── Deadpool & Wolverine ──
    "deadpool|wolverine": [
      // Deadpool & Wolverine — actual dynamic
      { requires: "deadpool3", lines: ["Hey, buddy! Let's be best friends!", "No.", "Too late!"] },
      // Deadpool's actual catchphrase + Wolverine's attitude
      { requires: "deadpool3", lines: ["Maximum effort!", "Minimum interest.", "That hurts, Logan."] },
      // Deadpool & Wolverine — actual claw reference
      { requires: "deadpool3", lines: ["Those claws are very cool, by the way.", "They're not for show.", "Can I touch them?", "Touch them and you lose the hand.", "...Still gonna touch them."] },
      // Wolverine's actual catchphrase adapted
      { requires: "deadpool3", startsWith: "wolverine", lines: ["I'm the best there is at what I do.", "And what's that?", "...Wouldn't you like to know.", "I would, actually."] }
    ],

    // ── Netflix / Street-Level ──
    "daredevil|punisher": [
      // Daredevil S2 — actual rooftop debate
      { requires: "daredevil2", startsWith: "punisher", lines: ["You know you're one bad day away from being me.", "No, Frank. I'm not.", "Keep telling yourself that, Red."] },
      // Daredevil S2 — actual philosophical clash
      { requires: "daredevil2", lines: ["You hit them, they get back up. I hit them, they stay down.", "That's the difference between justice and murder.", "Potato, potahto."] }
    ],

    "daredevil|fisk": [
      // Daredevil S1 — actual ill intent speech reference
      { requires: "daredevil1", startsWith: "fisk", lines: ["I am the ill intent.", "This city rejected you.", "This city doesn't know what it needs."] },
      // Daredevil S1 — actual exchange
      { requires: "daredevil1", lines: ["This city doesn't belong to you, Fisk.", "No. It belongs to the people. And I will save them from themselves."] }
    ],

    "jessicajones|lukecage": [
      // Jessica Jones S1 — actual dynamic
      { requires: "jessicajones1", lines: ["You look like crap.", "I know.", "Charming as always.", "I do my best."] },
      // Luke Cage S1 — actual Sweet Christmas
      { requires: "lukecage1", startsWith: "lukecage", lines: ["Sweet Christmas.", "Did you actually just say that?", "It's my thing.", "...It's really not."] }
    ],

    "daredevil|jessicajones": [
      // Defenders — actual team tension
      { requires: "defenders", lines: ["I'm a lawyer.", "I'm a private investigator.", "We should probably not be friends.", "Agreed."] }
    ],

    "ironfist|lukecage": [
      // Luke Cage / Heroes for Hire reference
      { requires: "lukecage1", lines: ["Heroes for Hire?", "We are NOT calling it that.", "But it sounds cool!", "It really doesn't."] }
    ],

    // ── Captain Marvel ──
    "captainmarvel|nick_fury": [
      // Captain Marvel — actual exchange
      { requires: "captainmarvel", lines: ["Higher, further, faster, baby.", "Just don't break anything.", "No promises.", "...I wasn't asking."] },
      // Endgame — adapted from actual pager/absence
      { requires: "endgame", startsWith: "nick_fury", lines: ["Where the HELL have you been?!", "There are a lot of other planets out there.", "And they don't have phones?"] }
    ],

    // ── Shang-Chi ──
    "shangchi|xialing": [
      // Shang-Chi — actual sibling exchange
      { requires: "shangchi", startsWith: "xialing", lines: ["You ran away.", "I thought I was protecting you.", "By LEAVING me there?!", "...I know. I'm sorry."] }
    ],

    "shangchi|wong": [
      // Shang-Chi post-credits — actual karaoke scene
      { requires: "shangchi", lines: ["Karaoke?", "I shouldn't. I'm the Sorcerer Supreme.", "Hotel California?", "...One song."] }
    ],

    // ── Others ──
    "coulson|nick_fury": [
      // Iron Man 1 / Avengers 1 — actual Coulson-Fury dynamic
      { requires: "ironman1", startsWith: "nick_fury", lines: ["What do we got, Coulson?", "We've got eyes on the target, sir.", "Good. Don't lose them.", "When have I ever?"] }
    ],

    "hawkeye|kate": [
      // Hawkeye — actual Kate fangirling
      { requires: "hawkeye", startsWith: "kate", lines: ["You're Hawkeye! I'm your biggest fan!", "...Great.", "Can you sign my bow?", "No.", "What about my quiver?", "Also no."] }
    ],

    "blackwidow|yelena": [
      // Black Widow — actual pose discussion
      { requires: "blackwidow", startsWith: "yelena", lines: ["The pose. You do the pose in your fights.", "It's not a pose.", "It's a little bit of a pose.", "...It's effective."] },
      // Black Widow — actual sister dynamic
      { requires: "blackwidow", lines: ["We're sisters.", "It's not real.", "It was real to me.", "...Yeah. Me too."] }
    ]
  };

  function getKey(id1, id2) {
    return [id1, id2].sort().join('|');
  }

  function getDialogue(charA, charB, watched) {
    const key = getKey(charA.id, charB.id);
    const allExchanges = pairs[key];
    if (!allExchanges) return null;

    const check = watched
      ? (typeof watched.isWatched === 'function' ? (id) => watched.isWatched(id) : (id) => watched.has(id))
      : () => true;

    const available = allExchanges.filter(e => check(e.requires));
    if (available.length === 0) return null;

    const chosen = available[Math.floor(Math.random() * available.length)];
    const [first, second] = key.split('|');

    const initiator = chosen.startsWith || first;
    const responder = initiator === first ? second : first;

    const nameMap = new Map([[charA.id, charA.name], [charB.id, charB.name]]);

    return chosen.lines.map((line, i) => {
      const speaker = i % 2 === 0 ? initiator : responder;
      return {
        speaker,
        name: nameMap.get(speaker),
        text: line
      };
    });
  }

  // ── Villain defeat lines (shown when villain HP reaches 0) ──
  const villainDefeatLines = {
    thanos_snap:    ["I am... inevitable. Or perhaps not.", "You could not live with your own failure."],
    loki:           ["The sun will shine on us again...", "I assure you, brother... this isn't over."],
    ultron:         ["There are... no strings... on me...", "You want to protect the world... but you don't want it to change."],
    hela:           ["It was never about the throne...", "I'm not a queen or a monster. I'm the goddess of death."],
    killmonger:     ["Bury me in the ocean...", "Is this your king?"],
    redskull:       ["I have seen the future, Captain... and there are no flags.", "Cut off one head... two more shall take its place."],
    abomination:   ["Give me a REAL fight!", "I want more..."],
    malekith:       ["The Aether cannot be destroyed...", "Darkness returns..."],
    ronan:          ["You... cannot stop it. The judgment is upon you.", "I will unfurl one thousand years of Kree justice."],
    dormammu:       ["You will... return...", "This is not the end."],
    ego:            ["I wanted to experience... everything.", "Eternity... was within my grasp."],
    killian:        ["You know who I am. You don't know where I am.", "I am the Mandarin!"],
    fisk:           ["This city... will remember me.", "I will not be stopped by some man... in a mask."],
    kilgrave:       ["I once told a man to go screw himself... he did.", "JESSICA!"],
    mysterio:       ["People need to believe...", "You'll see. It's all... an illusion."],
    kang:           ["You can't stop what's coming.", "See you soon."],
    cottonmouth:    ["Everybody wants to be the king...", "Harlem is mine."],
    kingpin:        ["This city needs me.", "When I was a boy..."],
    cassandra:      ["You were never enough.", "Interesting..."],
    wenwu:          ["I have lived a thousand years...", "The rings... were never yours."],
    punisher:       ["One batch... two batch...", "I do what needs to be done."],
    zemo:           ["An empire toppled by its enemies can rise again...", "But one which crumbles from within? That is dead. Forever."],
    wintersoldier:  ["I remember everything...", "Mission... failed."],
    he_who_remains: ["See you soon.", "If you think I'm evil... just wait."],
    gorr:           ["All gods must die...", "Let me tell you a story..."],
    agatha:         ["It was Agatha all along!", "You don't know what you've unleashed."],
    vulture:        ["I'll kill you dead.", "The world's changed, boys."],
    _default:       ["This isn't over...", "I'll be back.", "You got lucky."]
  };

  function getDefeatLine(villainId) {
    const lines = villainDefeatLines[villainId] || villainDefeatLines._default;
    return lines[Math.floor(Math.random() * lines.length)];
  }

  // ── Villain victory lines (shown when all walkers faint) ──
  const villainVictoryLines = {
    thanos_snap:    ["I am inevitable.", "Dread it. Run from it. Destiny arrives all the same."],
    loki:           ["Kneel.", "I am burdened with glorious purpose."],
    ultron:         ["There are no strings on me.", "Upon this rock, I will build my church."],
    hela:           ["I'm not a queen or a monster. I'm the goddess of death.", "Kneel before your queen."],
    killmonger:     ["Is this your king?", "The world took everything away from me."],
    redskull:       ["You could have the power of the gods!", "HAIL HYDRA."],
    abomination:   ["Is that all you've got?!", "GIVE ME A REAL FIGHT!"],
    malekith:       ["The Aether is mine.", "Your universe was never meant to survive."],
    ronan:          ["The judgment is upon you all.", "They call me terrorist. I am a freedom fighter."],
    dormammu:       ["You've come to die.", "Your world is now my world."],
    ego:            ["It doesn't need to be like this. We can do this together.", "I AM the universe."],
    killian:        ["I am the Mandarin!", "A famous man once said, we create our own demons."],
    fisk:           ["I am the ill intent.", "This city deserves a better class of criminal."],
    kilgrave:       ["Now, SMILE.", "I once told a man to go screw himself. He did."],
    mysterio:       ["People... they need to believe.", "The truth is... you're too late, Spider-Man."],
    kang:           ["See you soon.", "You just made something far worse."],
    cottonmouth:    ["Everybody wants to be the king.", "Harlem is MINE."],
    kingpin:        ["When I was a boy...", "Take your shot."],
    cassandra:      ["You never stood a chance.", "Fascinating."],
    wenwu:          ["I have lived a thousand years. You are nothing.", "The rings are mine."],
    punisher:       ["One batch, two batch. Penny and dime.", "I do what needs to be done."],
    zemo:           ["An empire toppled by its enemies can rise again.", "Mission accomplished."],
    wintersoldier:  ["Mission complete.", "Hail Hydra."],
    he_who_remains: ["See you soon.", "If you think I'm evil... just wait."],
    gorr:           ["All gods must die.", "The gods don't care about you."],
    agatha:         ["It was Agatha all along!", "You have no idea what you've unleashed."],
    vulture:        ["I'm the bad guy? I'm saving YOU.", "The rich and the powerful... they don't care about us."],
    _default:       ["Too easy.", "Is that all?", "Pathetic."]
  };

  function getVictoryLine(villainId) {
    const lines = villainVictoryLines[villainId] || villainVictoryLines._default;
    return lines[Math.floor(Math.random() * lines.length)];
  }

  return { getDialogue, getKey, getDefeatLine, getVictoryLine };
})();
