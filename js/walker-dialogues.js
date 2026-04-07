/************************************************
 * WALKER DIALOGUES
 * Character pair conversations when walkers meet
 * Key format: "id1|id2" (alphabetically sorted)
 ************************************************/
const WALKER_DIALOGUES = (() => {

  // Each entry: [charA_line, charB_line, charA_line, ...]
  // charA = alphabetically first ID, charB = second
  const pairs = {

    // ── Iron Man relationships ──
    "cap|ironman": [
      ["We need a plan of attack.", "I have a plan... attack."],
      ["You know, I'm not the one who needs to watch their back.", "Is that a threat, Cap?", "It's a promise."],
      ["Language!", "...It was one time, Steve."],
      ["You could've called.", "You could've not dropped an airport on me."]
    ],
    "ironman|spiderman": [
      ["Mr. Stark! Is this an Avengers mission?", "No, this is a walk, kid. Relax."],
      ["I'm nothing without the suit...", "If you're nothing without the suit, you shouldn't have it."],
      ["Hey Mr. Stark, do you have any snacks?", "Do I look like a vending machine?", "...A little bit, yeah."],
      ["Can I be an Avenger now?", "We'll talk about it later.", "You always say that!"]
    ],
    "ironman|pepper": [
      ["Tony, you promised no more suits.", "This isn't a suit... it's a walking outfit."],
      ["I love you 3000.", "I love you more than 3000."],
      ["You're going to be late for dinner.", "I'm never late. Everyone else is just early."]
    ],
    "ironman|rhodey": [
      ["Next time, baby.", "You always say that.", "And I always mean it."],
      ["BOOM! You looking for this?", "That's your story? Really?"],
      ["I think I need an upgrade.", "You ARE an upgrade, Rhodey."]
    ],
    "ironman|thor": [
      ["Point Break! Long time no see.", "I am not Point Break.", "Sure you are, big guy."],
      ["Doth mother know you weareth her drapes?", "...That was ONE time, Stark."]
    ],
    "ironman|hulk": [
      ["We've got a code green.", "I'm always angry.", "That's my secret too... coffee."],
      ["Sun's getting real low, big guy.", "That only works when Natasha does it."]
    ],
    "ironman|drstrange": [
      ["Do you concur, Doctor?", "I'm not that kind of doctor.", "Then what's with the cape?"],
      ["Nice facial hair.", "...Right back at you."]
    ],

    // ── Thor relationships ──
    "loki|thor": [
      ["Brother!", "I am NOT your brother.", "...Adopted."],
      ["I thought you were dead!", "I get that a lot."],
      ["Get help.", "No.", "GET HELP!!", "I hate this plan."],
      ["We're not doing 'Get Help.'", "We are absolutely doing 'Get Help.'"]
    ],
    "hulk|thor": [
      ["FRIEND FROM WORK!", "We are NOT friends from work!", "...But we are?"],
      ["Thor sad.", "I'm not sad! ...Okay maybe a little."],
      ["Hulk like raging fire. Thor like smoldering fire.", "That's... actually kind of nice."]
    ],
    "thor|valkyrie": [
      ["Your Majesty.", "Don't call me that. Makes me feel old.", "You ARE old.", "...Fair point."],
      ["I need a drink.", "It's 10 in the morning.", "And?"]
    ],
    "heimdall|thor": [
      ["I can see everything.", "Can you see why I skipped breakfast?", "...You didn't. You had Pop-Tarts."]
    ],
    "hela|thor": [
      ["Kneel.", "I don't really kneel.", "He really doesn't.", "...Who asked you?"]
    ],

    // ── Cap relationships ──
    "bucky|cap": [
      ["I'm with you till the end of the line.", "...Right back at ya, pal."],
      ["You pulled me from the river. Why?", "Because you're my friend.", "...You're my mission.", "Then finish it."],
      ["How's the arm?", "Not bad. Wakandan engineering.", "Show-off."]
    ],
    "cap|falcon": [
      ["On your left.", "Oh, come on!", "On your left.", "I HEARD YOU THE FIRST TIME."],
      ["Take care of the shield.", "I will.", "I know you will."]
    ],
    "cap|peggy": [
      ["I had a date.", "You're late.", "Couldn't call... bad reception in the ice."]
    ],
    "blackwidow|cap": [
      ["You know, you're kind of scary sometimes.", "Thank you.", "...That wasn't a compliment."]
    ],

    // ── Guardians ──
    "groot|rocket": [
      ["I am Groot.", "I know, buddy.", "I am Groot.", "Well that's just rude."],
      ["I am Groot!", "No, you cannot have a gun.", "I am Groot.", "ESPECIALLY not that one."],
      ["I am Groot.", "Yeah, yeah, I love you too. Don't make it weird."]
    ],
    "gamora|starlord": [
      ["I'm gonna make some weird faces.", "...Was that supposed to be charming?"],
      ["Dance with me.", "I don't dance.", "Everyone dances.", "NOT me."],
      ["I like your plan. Except it sucks.", "Tell me how you really feel."]
    ],
    "gamora|nebula": [
      ["You were always the favorite.", "That's not true.", "Father made me watch while he—", "I know. I'm sorry."],
      ["Sister.", "...Sister.", "This is progress.", "Don't push it."]
    ],
    "drax|starlord": [
      ["Nothing goes over my head. My reflexes are too fast.", "That's... not what that means."],
      ["I can see you. You're eating a cracker.", "I thought I was invisible!", "...You were not."]
    ],
    "groot|starlord": [
      ["I am Groot.", "...I understood that!", "I am Groot.", "Wait, never mind."]
    ],
    "mantis|drax": [
      ["You are horrifying to look at.", "...Thank you?", "That was not a compliment.", "I'll take it anyway."]
    ],

    // ── Wanda & Vision ──
    "vision|wanda_wv": [
      ["What is grief, if not love persevering?", "...That's beautiful, Vis."],
      ["Wanda, we can't stay here.", "Just five more minutes.", "You said that an hour ago."],
      ["I just feel you.", "And I feel you."]
    ],
    "quicksilver|wanda_wv": [
      ["You didn't see that coming?", "I hate when you say that.", "You didn't see THAT coming either."],
      ["Keep up, old lady.", "We're TWINS!", "Yeah, but I'm faster."]
    ],

    // ── Black Widow & Hawkeye ──
    "blackwidow|hawkeye": [
      ["Just like Budapest all over again.", "You and I remember Budapest very differently."],
      ["I've got red in my ledger.", "We all do, Nat."],
      ["Don't you dare miss.", "I never miss.", "Show-off."]
    ],

    // ── Spider-Man ──
    "drstrange|spiderman": [
      ["The Multiverse is not a concept you can just—", "Yeah yeah, I opened a portal once!", "That was an accident."],
      ["Scooby-Doo this crap.", "Please never say that again."]
    ],
    "mysterio|spiderman": [
      ["People need to believe.", "In you? Hard pass.", "You wound me, Spider-Man."]
    ],

    // ── Loki variants ──
    "loki_tva|sylvie": [
      ["What makes Loki a Loki?", "Independence. Authority. Style.", "...I was going to say trust issues."],
      ["I've been pruned, stabbed, and betrayed.", "Welcome to being a Loki."],
      ["For you.", "...For us."]
    ],
    "loki_tva|mobius": [
      ["Wow.", "Wow what?", "Just... wow.", "You're being weird, Mobius."],
      ["I believe in you, Loki.", "That makes one of us.", "Then I'll believe enough for both."],
      ["Jet ski?", "JET SKI!", "...We really need better hobbies."]
    ],

    // ── Doctor Strange ──
    "drstrange|wong": [
      ["Wong.", "Strange.", "...That's still funny to me.", "It's really not."],
      ["I'm the Sorcerer Supreme.", "Actually, that's me now.", "On a technicality!", "Still counts."],
      ["Want to get food?", "I thought you'd never ask."]
    ],

    // ── Ant-Man ──
    "antman|falcon": [
      ["I'm a big fan!", "...Who are you?", "I'm Ant-Man!", "Oh. The guy who shrinks."],
      ["You're an Avenger?", "I am! Surprised?", "...A little bit, yeah."]
    ],
    "antman|wasp_hope": [
      ["I know a guy.", "You mean me.", "I mean you.", "Say my name.", "...The Wasp."]
    ],

    // ── Black Panther ──
    "blackpanther|shuri": [
      ["What are THOSE?!", "They're my shoes, Shuri.", "Old man shoes!", "I am your KING."],
      ["Another broken white boy to fix.", "Shuri, please.", "What? I'm just saying."]
    ],
    "blackpanther|okoye": [
      ["Wakanda forever.", "Forever.", "...That never gets old.", "No. It does not."]
    ],

    // ── Deadpool & Wolverine ──
    "deadpool|wolverine": [
      ["Hey, buddy! Wanna team up?", "No.", "Too late, we're already walking together!"],
      ["You're the best there is at what you do.", "And what's that?", "Looking angry. It's a gift."],
      ["I'm touching your claws.", "Touch them and lose the hand.", "...Worth it."],
      ["Maximum effort!", "Minimum patience.", "That's fair."]
    ],

    // ── Netflix / Street-Level ──
    "daredevil|punisher": [
      ["You're one bad day away from being me.", "No, Frank. I'm not.", "Keep telling yourself that, Red."],
      ["Justice isn't a weapon.", "No, but I am.", "...Frank."]
    ],
    "daredevil|fisk": [
      ["This city needs me.", "This city will be your GRAVE.", "...You always were dramatic, Fisk."]
    ],
    "jessicajones|lukecage": [
      ["You look good.", "I know.", "Humble as ever.", "Always."],
      ["Sweet Christmas.", "Did you just say 'sweet Christmas'?", "...Maybe."]
    ],
    "daredevil|jessicajones": [
      ["I'm a lawyer.", "I'm a PI.", "We should NOT be friends.", "Absolutely not."]
    ],
    "ironfist|lukecage": [
      ["Heroes for Hire?", "I told you, we're not calling it that.", "But it sounds cool!", "It really doesn't."]
    ],

    // ── Captain Marvel ──
    "captainmarvel|nick_fury": [
      ["Where have you BEEN?", "Saving other planets.", "...A text would've been nice."],
      ["Higher, further, faster.", "Just don't break my stuff.", "No promises."]
    ],

    // ── Shang-Chi ──
    "shangchi|xialing": [
      ["You ran away.", "I came back!", "After TEN years.", "...I needed some time."]
    ],
    "shangchi|wong": [
      ["Karaoke later?", "I'm the Sorcerer Supreme. I don't do karaoke.", "...Hotel California?", "I'll get my coat."]
    ],

    // ── Others ──
    "nick_fury|coulson": [
      ["Agent Coulson, report.", "Everything's fine, sir.", "When you say fine...", "I mean controlled chaos."]
    ],
    "hawkeye|kate": [
      ["I learned from the best.", "That's sweet, Kate.", "I was talking about the YouTube videos.", "...I'm standing right here."]
    ],
    "blackwidow|yelena": [
      ["You're such a poser.", "I'm your older sister. Show some respect.", "Make me.", "...I walked into that one."]
    ]
  };

  // Generic dialogues for any pair without specific lines
  const generic = [
    ["{a}: Fancy meeting you here.", "{b}: Small world.", "{a}: Literally."],
    ["{a}: You come here often?", "{b}: I'm literally walking randomly.", "{a}: Same."],
    ["{a}: Hey.", "{b}: Hey.", "{a}: ...Nice weather.", "{b}: We're on a map."],
    ["{a}: Shouldn't we be saving the world?", "{b}: It's our day off."],
    ["{a}: I like your outfit.", "{b}: Thanks, I got it from my movie."],
    ["{a}: Are we going the same way?", "{b}: I hope not.", "{a}: Rude."],
    ["{a}: This place looks familiar.", "{b}: It's the same map every time.", "{a}: Still cool though."],
    ["{a}: Quick question—", "{b}: No.", "{a}: You don't even know what I was going to ask!", "{b}: Still no."],
    ["{a}: Wanna race?", "{b}: Absolutely not.", "{a}: Because you'd lose?", "{b}: ...Maybe."],
    ["{a}: Do you think they're watching us?", "{b}: Who?", "{a}: The user.", "{b}: ...Don't make it weird."]
  ];

  function getKey(id1, id2) {
    return [id1, id2].sort().join('|');
  }

  function getDialogue(charA, charB) {
    const key = getKey(charA.id, charB.id);
    const specific = pairs[key];

    if (specific) {
      const exchange = specific[Math.floor(Math.random() * specific.length)];
      // Determine who speaks first based on key order
      const [first, second] = key.split('|');
      const nameA = charA.id === first ? charA.name : charB.name;
      const nameB = charA.id === first ? charB.name : charA.name;
      return exchange.map((line, i) => ({
        speaker: i % 2 === 0 ? first : second,
        name: i % 2 === 0 ? nameA : nameB,
        text: line
      }));
    }

    // Generic fallback
    const template = generic[Math.floor(Math.random() * generic.length)];
    const nameA = charA.name;
    const nameB = charB.name;
    return template.map(line => {
      const isA = line.startsWith('{a}');
      return {
        speaker: isA ? charA.id : charB.id,
        name: isA ? nameA : nameB,
        text: line.replace(/\{[ab]\}: /, '')
      };
    });
  }

  return { getDialogue, getKey };
})();
