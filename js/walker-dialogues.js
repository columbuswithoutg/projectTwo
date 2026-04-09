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
 ************************************************/
const WALKER_DIALOGUES = (() => {

  const pairs = {

    // ── Iron Man relationships ──
    "cap|ironman": [
      { requires: "avengers1", lines: ["We need a plan of attack.", "I have a plan... attack."] },
      { requires: "avengers1", startsWith: "ironman", lines: ["Doth mother know you weareth her drapes?", "...That was ONE time, Stark."] },
      { requires: "ageofultron", lines: ["Language!", "...It was one time, Steve."] },
      { requires: "ageofultron", startsWith: "ironman", lines: ["No way we all get through this.", "I got no plans tomorrow night.", "...I'll pick you up at 7."] },
      { requires: "civilwar", lines: ["You could've called.", "You could've not dropped an airport on me."] },
      { requires: "civilwar", startsWith: "ironman", lines: ["Sometimes I wanna punch you in your perfect teeth.", "...I get that a lot."] }
    ],

    "ironman|spiderman": [
      { requires: "civilwar", lines: ["Kid, relax. This is just a walk.", "But Mr. Stark, is this an Avengers mission?", "No. Definitely not."] },
      { requires: "spiderman1", lines: ["If you're nothing without the suit, you shouldn't have it.", "I'm nothing without the suit...", "That's the point, kid."] },
      { requires: "spiderman1", startsWith: "spiderman", lines: ["Mr. Stark! Do I look like a vending machine?", "...A little bit, yeah.", "Watch it, kid."] },
      { requires: "spiderman1", startsWith: "spiderman", lines: ["Can I be an Avenger now?", "We'll talk about it later.", "You always say that!"] },
      { requires: "infinitywar", lines: ["You should not be here.", "I know, but I couldn't just stay behind!", "...Kid, you're gonna give me a heart attack."] }
    ],

    "ironman|pepper": [
      { requires: "ironman1", lines: ["This isn't a suit... it's a walking outfit.", "Tony, you promised no more suits.", "Technically, it's armor."] },
      { requires: "endgame", lines: ["I love you 3000.", "I love you more than 3000."] },
      { requires: "ironman3", startsWith: "pepper", lines: ["How many suits is 'a few', Tony?", "...Forty-two.", "TONY!"] },
      { requires: "ironman1", startsWith: "pepper", lines: ["You're going to be late for dinner.", "I'm never late. Everyone else is just early.", "...That doesn't even make sense."] }
    ],

    "ironman|rhodey": [
      { requires: "ironman1", lines: ["Next time, baby.", "You always say that.", "And I always mean it."] },
      { requires: "ageofultron", startsWith: "rhodey", lines: ["BOOM! You looking for this?", "That story again?", "It's a GOOD story!", "...Tell it one more time."] },
      { requires: "ironman2", startsWith: "rhodey", lines: ["I think I need a better suit.", "Rhodey, you ARE the upgrade.", "...That's sweet, Tones."] }
    ],

    "ironman|thor": [
      { requires: "avengers1", lines: ["Point Break! Long time no see.", "I am not Point Break.", "Sure you are, big guy."] },
      { requires: "avengers1", lines: ["Doth mother know you weareth her drapes?", "...That was ONE time, Stark."] },
      { requires: "ageofultron", startsWith: "thor", lines: ["You dare lift my hammer?", "It's a party trick.", "It is NOT a party trick!"] }
    ],

    "drstrange|ironman": [
      { requires: "infinitywar", startsWith: "ironman", lines: ["Do you concur, Doctor?", "I'm not that kind of doctor.", "Then what's with the cape?"] },
      { requires: "infinitywar", lines: ["Nice facial hair.", "...Right back at you.", "We should start a club."] },
      { requires: "infinitywar", lines: ["We're in the endgame now.", "Please don't say that.", "I've seen 14 million outcomes.", "And how many do we win?", "...You don't want to know."] }
    ],

    "hulk|ironman": [
      { requires: "avengers1", lines: ["I'm always angry.", "That's my secret too... coffee."] },
      { requires: "ageofultron", startsWith: "ironman", lines: ["Sun's getting real low, big guy.", "That only works when Natasha does it.", "Worth a shot."] },
      { requires: "endgame", lines: ["Hulk gave you taco.", "Thanks, big guy.", "Hulk want taco back.", "...No."] }
    ],

    // ── Thor relationships ──
    "loki|thor": [
      { requires: "thor1", lines: ["Brother!", "I am NOT your brother.", "...Adopted."] },
      { requires: "thor2", startsWith: "thor", lines: ["I thought you were dead!", "I get that a lot.", "Loki, I swear—", "Surprise."] },
      { requires: "thor3", startsWith: "thor", lines: ["We're doing 'Get Help.'", "We are NOT doing 'Get Help.'", "GET HELP!!", "I hate you."] },
      { requires: "thor3", lines: ["We're not doing 'Get Help.'", "We are absolutely doing 'Get Help.'"] },
      { requires: "avengers1", lines: ["I have an army.", "We have a Hulk.", "...I hate the Hulk."] }
    ],

    "hulk|thor": [
      { requires: "thor3", startsWith: "thor", lines: ["FRIEND FROM WORK!", "Hulk know tiny god.", "I'm not tiny!", "...Little bit tiny."] },
      { requires: "endgame", lines: ["Thor okay?", "I'm not sad! ...Okay maybe a little."] },
      { requires: "thor3", lines: ["Hulk like raging fire. Thor like smoldering fire.", "That's... actually kind of nice."] }
    ],

    "thor|valkyrie": [
      { requires: "thor3", lines: ["Your Majesty.", "Don't call me that. Makes me feel old.", "You ARE old.", "...Fair point."] },
      { requires: "thor3", startsWith: "valkyrie", lines: ["I need a drink.", "It's 10 in the morning.", "And?", "...Fair point."] }
    ],

    "heimdall|thor": [
      { requires: "thor1", lines: ["I can see everything.", "Can you see why I skipped breakfast?", "...You didn't. You had Pop-Tarts."] }
    ],

    "hela|thor": [
      { requires: "thor3", lines: ["Kneel before your queen.", "I don't really kneel.", "You will.", "Not today."] }
    ],

    // ── Cap relationships ──
    "bucky|cap": [
      { requires: "cap1", lines: ["Don't do anything stupid until I get back.", "How can I? You're taking all the stupid with you.", "...Punk.", "Jerk."] },
      { requires: "cap2", lines: ["You pulled me from the river. Why?", "Because you're my friend.", "...You're my mission.", "Then finish it."] },
      { requires: "blackpanther", startsWith: "cap", lines: ["The arm looks good.", "Wakandan vibranium. Not bad.", "Better than 'not bad.'"] },
      { requires: "cap1", startsWith: "cap", lines: ["I'm with you till the end of the line.", "...Right back at ya, pal."] }
    ],

    "cap|falcon": [
      { requires: "cap2", lines: ["On your left.", "Oh, come on!", "On your left.", "I HEARD YOU THE FIRST TIME."] },
      { requires: "endgame", lines: ["Take care of the shield.", "I will.", "I know you will."] }
    ],

    "cap|peggy": [
      { requires: "cap1", lines: ["I had a date.", "You're late.", "Couldn't call... bad reception in the ice."] }
    ],

    "blackwidow|cap": [
      { requires: "avengers1", lines: ["Do you trust me?", "I do.", "...That makes one of us."] },
      { requires: "cap2", startsWith: "cap", lines: ["Where did Captain America learn to steal a car?", "Nazi Germany.", "...Noted."] }
    ],

    // ── Guardians ──
    "groot|rocket": [
      { requires: "guardians1", lines: ["I am Groot.", "I know, buddy.", "I am Groot.", "Well that's just rude."] },
      { requires: "guardians1", lines: ["I am Groot!", "No, you cannot have a gun.", "I am Groot.", "ESPECIALLY not that one."] },
      { requires: "guardians1", lines: ["I am Groot.", "Yeah, yeah, I love you too. Don't make it weird."] }
    ],

    "gamora|starlord": [
      { requires: "guardians1", startsWith: "starlord", lines: ["I'm gonna make some weird faces.", "...Was that supposed to be charming?", "Definitely.", "It wasn't."] },
      { requires: "guardians1", startsWith: "starlord", lines: ["Dance with me.", "I don't dance.", "Come on, everyone dances.", "NOT me."] },
      { requires: "guardians1", lines: ["I like your plan. Except it sucks.", "Tell me how you really feel."] }
    ],

    "gamora|nebula": [
      { requires: "guardians2", lines: ["Sister.", "...Sister.", "This is progress.", "Don't push it."] },
      { requires: "guardians2", startsWith: "nebula", lines: ["You were always the favorite.", "I wasn't. Not really.", "Father made me watch while he—", "I know. I'm sorry."] }
    ],

    "drax|starlord": [
      { requires: "guardians1", lines: ["Nothing goes over my head. My reflexes are too fast.", "That's... not what that means."] },
      { requires: "infinitywar", lines: ["I am standing perfectly still.", "Drax, I can literally see you.", "No, you cannot. I am invisible.", "...You're eating chips."] }
    ],

    "groot|starlord": [
      { requires: "guardians1", lines: ["I am Groot.", "...I understood that!", "I am Groot.", "Wait, never mind."] }
    ],

    "drax|mantis": [
      { requires: "guardians2", lines: ["You are horrifying to look at.", "...Thank you?", "That was not a compliment.", "I'll take it anyway."] }
    ],

    // ── Wanda & Vision ──
    "vision|wanda_wv": [
      { requires: "wandavision", lines: ["What is grief, if not love persevering?", "...That's beautiful, Vis."] },
      { requires: "wandavision", lines: ["Wanda, we can't stay here.", "Just five more minutes.", "You said that an hour ago."] },
      { requires: "wandavision", lines: ["I just feel you.", "And I feel you."] }
    ],

    "quicksilver|wanda_wv": [
      { requires: "ageofultron", lines: ["You didn't see that coming?", "I hate when you say that.", "You didn't see THAT coming either."] },
      { requires: "ageofultron", lines: ["Keep up, old lady.", "We're TWINS!", "Yeah, but I'm faster."] }
    ],

    // ── Black Widow & Hawkeye ──
    "blackwidow|hawkeye": [
      { requires: "avengers1", lines: ["Just like Budapest all over again.", "You and I remember Budapest very differently."] },
      { requires: "avengers1", lines: ["I've got red in my ledger.", "We all do, Nat."] },
      { requires: "avengers1", lines: ["Don't you dare miss.", "I never miss.", "Show-off."] }
    ],

    // ── Spider-Man ──
    "drstrange|spiderman": [
      { requires: "nowayhome", lines: ["The Multiverse is not a concept you can just—", "Yeah yeah, I opened a portal once!", "That was an accident."] },
      { requires: "nowayhome", startsWith: "spiderman", lines: ["Scooby-Doo this crap!", "Please never say that again.", "...Too late."] }
    ],

    "mysterio|spiderman": [
      { requires: "farfromhome", lines: ["People need to believe.", "In you? Hard pass.", "You wound me, Spider-Man."] }
    ],

    // ── Loki variants ──
    "loki_tva|sylvie": [
      { requires: "loki1", lines: ["What makes Loki a Loki?", "Independence. Authority. Style.", "...I was going to say trust issues."] },
      { requires: "loki1", lines: ["I've been pruned, stabbed, and betrayed.", "Welcome to being a Loki."] },
      { requires: "loki1", lines: ["For you.", "...For us."] }
    ],

    "loki_tva|mobius": [
      { requires: "loki1", lines: ["What's so great about jet skis anyway?", "Wow.", "...That's not an answer.", "It's the only answer."] },
      { requires: "loki2", startsWith: "mobius", lines: ["I believe in you, Loki.", "...That makes one of us.", "Then I'll believe enough for both."] },
      { requires: "loki1", lines: ["Jet ski?", "JET SKI!", "...We really need better hobbies."] }
    ],

    // ── Doctor Strange ──
    "drstrange|wong": [
      { requires: "doctorstrange", lines: ["Wong.", "Strange.", "...That's still funny to me.", "It's really not."] },
      { requires: "nowayhome", lines: ["I'm the Sorcerer Supreme.", "Actually, that's me now.", "On a technicality!", "Still counts."] },
      { requires: "doctorstrange", lines: ["Want to get food?", "I thought you'd never ask."] }
    ],

    // ── Ant-Man ──
    "antman|falcon": [
      { requires: "civilwar", lines: ["I'm a big fan!", "...Do I know you?", "I'm Ant-Man!", "Oh. The guy who shrinks."] },
      { requires: "civilwar", lines: ["So am I an Avenger now?", "Buddy, you shrink.", "That's a yes, right?", "...No."] }
    ],

    "antman|wasp_hope": [
      { requires: "antman", lines: ["I know a guy.", "You mean me.", "I mean you.", "Say my name.", "...The Wasp."] }
    ],

    // ── Black Panther ──
    "blackpanther|shuri": [
      { requires: "blackpanther", startsWith: "shuri", lines: ["What are THOSE?!", "These are perfectly fine shoes.", "Old man shoes!", "I am your KING."] },
      { requires: "blackpanther", startsWith: "shuri", lines: ["Another broken white boy to fix.", "Shuri, please.", "What? I'm just saying."] }
    ],

    "blackpanther|okoye": [
      { requires: "blackpanther", lines: ["Wakanda forever.", "Forever.", "...That never gets old.", "No. It does not."] }
    ],

    // ── Deadpool & Wolverine ──
    "deadpool|wolverine": [
      { requires: "deadpool3", lines: ["Hey, buddy! Wanna team up?", "No.", "Too late, we're already walking together!"] },
      { requires: "deadpool3", lines: ["You're the best there is at what you do.", "And what's that?", "Looking angry. It's a gift."] },
      { requires: "deadpool3", lines: ["I'm touching your claws.", "Touch them and lose the hand.", "...Worth it."] },
      { requires: "deadpool3", lines: ["Maximum effort!", "Minimum patience.", "That's fair."] }
    ],

    // ── Netflix / Street-Level ──
    "daredevil|punisher": [
      { requires: "daredevil2", startsWith: "punisher", lines: ["You're one bad day away from being me, Red.", "No, Frank. I'm not.", "Keep telling yourself that."] },
      { requires: "daredevil2", lines: ["Justice isn't a weapon.", "No, but I am.", "...Frank."] }
    ],

    "daredevil|fisk": [
      { requires: "daredevil1", lines: ["This city doesn't belong to you.", "This city will be your GRAVE.", "...You always were dramatic, Fisk."] },
      { requires: "daredevil1", startsWith: "fisk", lines: ["I want to make this city a better place.", "By crushing everyone in it?", "...You wouldn't understand."] }
    ],

    "jessicajones|lukecage": [
      { requires: "jessicajones1", lines: ["You look good.", "I know.", "Humble as ever.", "Always."] },
      { requires: "lukecage1", startsWith: "lukecage", lines: ["Sweet Christmas.", "Did you just say that out loud?", "...Maybe.", "You absolutely did."] }
    ],

    "daredevil|jessicajones": [
      { requires: "defenders", lines: ["I'm a lawyer.", "I'm a PI.", "We should NOT be friends.", "Absolutely not."] }
    ],

    "ironfist|lukecage": [
      { requires: "lukecage1", lines: ["Heroes for Hire?", "I told you, we're not calling it that.", "But it sounds cool!", "It really doesn't."] }
    ],

    // ── Captain Marvel ──
    "captainmarvel|nick_fury": [
      { requires: "endgame", startsWith: "nick_fury", lines: ["Where have you BEEN?", "Saving other planets.", "A text would've been nice.", "I was busy."] },
      { requires: "captainmarvel", lines: ["Higher, further, faster.", "Just don't break my stuff.", "No promises."] }
    ],

    // ── Shang-Chi ──
    "shangchi|xialing": [
      { requires: "shangchi", startsWith: "xialing", lines: ["You ran away.", "I came back!", "After TEN years.", "I know. I'm sorry."] }
    ],

    "shangchi|wong": [
      { requires: "shangchi", lines: ["Karaoke later?", "I'm the Sorcerer Supreme. I don't do karaoke.", "...Hotel California?", "I'll get my coat."] }
    ],

    // ── Others ──
    "coulson|nick_fury": [
      { requires: "ironman1", startsWith: "nick_fury", lines: ["Agent Coulson, report.", "Everything's under control, sir.", "Is it?", "...I mean controlled chaos."] }
    ],

    "hawkeye|kate": [
      { requires: "hawkeye", startsWith: "kate", lines: ["I learned from the best.", "That's sweet, Kate.", "I was talking about the YouTube videos.", "...I'm standing right here."] }
    ],

    "blackwidow|yelena": [
      { requires: "blackwidow", lines: ["I'm your older sister. Show some respect.", "You're such a poser.", "Make me.", "...I walked into that one."] },
      { requires: "blackwidow", startsWith: "yelena", lines: ["That superhero landing pose is so dramatic.", "...It's cool and you know it.", "It's ridiculous.", "You're just jealous."] }
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

  return { getDialogue, getKey };
})();
