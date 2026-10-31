/************************************************
 * HELP LOGIC (pure, unit-tested) — the "?" help centre's content and rules:
 *   GUIDE_VERSION   bump it when cards are added or changed: everyone who
 *                   already opened the guide gets the red dot back
 *   SECTIONS        every feature a signed-in user can use, grouped by area;
 *                   each card names its screenshot under /assets/help/
 *   seenKey         the per-user localStorage key that remembers the version
 *                   last opened (kept across log out, like the theme)
 *   needsDot        whether the "?" button still shows its red dot
 *   search          the sections narrowed to the cards matching a query
 *
 * UMD-ish like js/share-logic.js: `HelpLogic` in the browser, module.exports
 * under node. Loads in the core chunk before js/help.js.
 ************************************************/
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.HelpLogic = api;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const GUIDE_VERSION = 1;

  // card: { id, title, img (file in /assets/help/, or null), steps[], keys?: [[key, what]], note? }
  // Labels in quotes are the exact button text, so people can match them on screen.
  const SECTIONS = [
    {
      id: 'start', title: 'Getting started',
      cards: [
        { id: 'tabs', title: 'The four main screens', img: 'tabs.jpg', steps: [
          'Use the tabs at the top to switch between Watch Order, Board, Feed and World.',
          'Watch Order is the chart of every title in story order. Board is the same titles as to-do columns.',
          'Feed shows what you and your friends have watched. World is the 3D map you can walk around.',
          'Your picture at the top right opens your Profile.'
        ] },
        { id: 'drawer', title: 'The menu', img: 'drawer.jpg', steps: [
          'Tap the menu button (three lines) at the top left.',
          'It has everything else: Home, Characters, the Universe map, Customize character, Friends, Messages, Goals and Report a bug.',
          'A red number next to Messages means you have unread messages.',
          'Press Esc or tap outside the menu to close it.'
        ] },
        { id: 'install', title: 'Install it like an app', img: null, steps: [
          'On a phone: open your browser menu and choose "Add to Home screen" (Android) or Share → "Add to Home Screen" (iPhone).',
          'On a computer: click the install icon at the right end of the address bar.',
          'It then opens full screen from its own icon, and the app still opens without internet.'
        ] }
      ]
    },
    {
      id: 'watch', title: 'Watch Order',
      cards: [
        { id: 'chart', title: 'Find your way around the chart', img: 'watch-order.jpg', steps: [
          'Every film and series is a poster. Lines show which ones lead into which.',
          'Drag to move around. Scroll, pinch or use − / + to zoom.',
          'Posters stay locked until you have watched the titles before them.'
        ], keys: [['+ / −', 'Zoom in / out'], ['0', 'Reset the zoom'], ['Tab, then Enter', 'Open the selected poster']] },
        { id: 'popup', title: 'Open a title', img: 'popup.jpg', steps: [
          'Tap any unlocked poster to open its card.',
          'You get a spoiler-free summary, how many times you have watched it, and who you watched it with.',
          'Once you have watched it, "Characters in this" shows the cast in their looks from that title.'
        ] },
        { id: 'mark', title: 'Mark something as watched', img: 'watch-timer.jpg', steps: [
          'Open the title and tap "Start watching". A countdown the length of the film or episode starts.',
          'When it reaches zero, tap "Mark as watched". For a series you go one episode at a time.',
          'Changed your mind? Tap "Cancel". Up to 2 countdowns can run at once.',
          'Already watched it? "Watch again" adds another viewing.'
        ] },
        { id: 'post', title: 'Post about it', img: 'composer.jpg', steps: [
          'After "Mark as watched" a post box opens.',
          'Add a caption, "Tag friends" who watched with you and "Photo / video" if you like.',
          'Tap "Post" to share it on the Feed, or "Don\'t post" to skip.'
        ] },
        { id: 'memories', title: 'Memories and watching with friends', img: 'popup-actions.jpg', steps: [
          '"Add Memory" on a title\'s card uploads a photo or video with an optional caption.',
          'Your memories are listed on the card. Tap "View" to see them full size.',
          '"Watched with a Friend" sends a friend a request. Once they accept, you both show as watching it together.'
        ] },
        { id: 'walkers', title: 'Walkers: characters that roam the chart', img: 'walkers.jpg', steps: [
          'Open the menu → "Walkers" and pick characters you have unlocked. You get one slot for each title you have watched.',
          'They walk the roads, chat with each other and sometimes fight.',
          'Turn "Fights" or "Dialogues" on or off in the same menu.'
        ] },
        { id: 'goals', title: 'Goals: the road to Avengers: Doomsday', img: 'goals.jpg', steps: [
          'Open the menu → "Goals" to see Marvel\'s list of what to watch before Avengers: Doomsday.',
          'The bar fills as you go. Tap a title you can watch now to jump straight to it.',
          '"Share to story" makes a picture and link of your progress.'
        ] },
        { id: 'map', title: 'The Universe map', img: 'universe-map.jpg', steps: [
          'Open the menu → "Universe map" to see every title pinned to where it happens on Earth and beyond.',
          'The "UP NEXT" shelf at the bottom shows what you can watch next.',
          'Tap the globe button at the top right to zoom back out to the whole world.'
        ], keys: [['Arrow keys', 'Move the map'], ['+ / −', 'Zoom'], ['W or Esc', 'Back to the whole world']] }
      ]
    },
    {
      id: 'board', title: 'Board',
      cards: [
        { id: 'columns', title: 'Your to-do columns', img: 'board.jpg', steps: [
          'Titles sit in three columns: "Not started", "In progress" and "Done".',
          'Drag a card by its grip (the dotted handle) to move it, or use its buttons to start, finish or cancel.',
          'You have to start watching before a card can go to Done.',
          'Tap a title to open its card.'
        ] },
        { id: 'filters', title: 'Filter the columns', img: 'board-filters.jpg', steps: [
          'Use the drop-down at the top of a column to narrow it.',
          'Not started: all unlocked titles, only movies, only series, or one phase.',
          'Done: your last 5, 10 or 20 watched, or everything. Your choice is remembered.'
        ] }
      ]
    },
    {
      id: 'feed', title: 'Feed',
      cards: [
        { id: 'feed', title: 'See what friends are watching', img: 'feed.jpg', steps: [
          'Each card is something you or a friend watched, with their caption, photos and who they watched with.',
          'Tap a friend\'s name to see their progress.',
          'An empty feed? Tap "Find friends" to add some.'
        ] },
        { id: 'react', title: 'React and comment', img: 'feed-react.jpg', steps: [
          'Tap "Like" to like a post. Hold it (or hover) to pick Love, Haha, Wow, Sad or Angry instead.',
          'Tap the reaction count to see who reacted.',
          'Type in "Write a comment…" and tap the send arrow to comment. You can delete your own comments.',
          'On your own posts, the pencil button lets you edit the caption.'
        ] }
      ]
    },
    {
      id: 'world', title: 'World',
      cards: [
        { id: 'move', title: 'Walk around the 3D world', img: 'world.jpg', steps: [
          'Every title you have watched is an island, joined to the next by roads.',
          'Walk, jump and explore. Other players are walking around too.',
          'Fall off the edge and you come back where you last stood.',
          'If you have islands in different places, you pick where to start.'
        ], keys: [['W A S D / arrows', 'Walk'], ['Space', 'Jump'], ['Drag the mouse', 'Turn the camera (drag down to look up at the sky)'], ['Scroll', 'Zoom'], ['F', 'Punch'], ['E', 'Sit, lie down, use things, play games']] },
        { id: 'touch', title: 'Playing on a phone or tablet', img: 'world-touch.jpg', steps: [
          'Turn your phone sideways for the best view.',
          'Use the joystick at the bottom left to walk. Drag anywhere else to turn the camera (drag down to look up); pinch to zoom.',
          'Buttons on the right: jump, punch, and sit (it appears when you are next to a seat).',
          'On Android, the full-screen button at the top right fills the screen.'
        ] },
        { id: 'chat', title: 'Chat with other players', img: 'world-chat.jpg', steps: [
          'Type in the chat box at the bottom and press Enter or the send arrow.',
          '"World" talks to everyone. "Project" only to people on your island or road.',
          '"Whisper" talks privately to one player, or type /w name message. Offline players get it in Messages.',
          'Tap the wave button to wave.'
        ] },
        { id: 'voice', title: 'Talk with your voice', img: 'world-voice.jpg', steps: [
          'Tap the microphone button next to the chat box and allow the microphone. Tap it again to mute.',
          'You hear the players on the same island, quieter the further away they are.',
          'No microphone? You can still listen (the button shows headphones).'
        ] },
        { id: 'props', title: 'Sit, lie down and use things', img: null, steps: [
          'Walk up to a chair, sofa or bed and press E (or tap the sit button) to sit or lie down.',
          'Things like the TV, fireplace, fridge and tap do something too — stand next to them and press E.',
          'Move, jump or punch to get up again.'
        ] },
        { id: 'houses', title: 'Keep and decorate an island\'s house', img: null, steps: [
          'Each island has a house. Whoever has spent the most time on that island keeps it (at least 5 minutes, and idle time does not count).',
          'The key label at the top shows who keeps the island you are on.',
          'If it is you, tap "Edit house": change the roof, walls and windows, add a sign and a photo, and place furniture.',
          'Tap "Save" and everyone sees your house.'
        ] },
        { id: 'stones', title: 'Infinity Stones', img: null, note: 'Only during an event the admin has switched on.', steps: [
          'Six stones appear around the Iron Man island. Walk onto one to pick it up.',
          'Punch someone holding stones to steal one. The stone counter at the top shows how many you have.',
          'Collect all six and tap "SNAP" (or press G) — half the other players turn to dust.',
          'Tap the stone counter to see who has snapped the most.'
        ] }
      ]
    },
    {
      id: 'games', title: 'Minigames',
      cards: [
        { id: 'open', title: 'Find and start a game', img: 'island-screen.jpg', note: 'Each game is switched on island by island, so not every island has one.', steps: [
          'Islands with a game have a big screen. The top bar says something like "2 games here".',
          'Walk up to the screen and press E (or tap the game button).',
          'If an island has two games, pick one with 1 or 2.',
          'Join the lobby, and the host taps "Start now". You can also just watch.'
        ] },
        { id: 'scene', title: 'Scene Guess', img: null, steps: [
          'You see 10 stills from the title. Guess when each one happens.',
          'Tap or drag the timeline, fine-tune with −1m / −10s / +10s / +1m, then "Lock in".',
          'The closer you are, the more points, up to 1,000 a picture.',
          'The island\'s champion gets to choose the picture on its screen.'
        ], keys: [['← / →', '10 seconds'], ['Shift + arrows', '1 minute'], ['Enter or Space', 'Lock in'], ['Esc', 'Leave']] },
        { id: 'quote', title: 'Quote Guess', img: null, steps: [
          'Each round shows a line: guess "Who said it?" or "What\'s the reply?" from four choices.',
          'Answer fast — quicker answers score more.',
          '"Suggest a line" sends a quote of your own for the admin to check.'
        ], keys: [['1–4 or A–D', 'Pick an answer']] }
      ]
    },
    {
      id: 'home', title: 'Home',
      cards: [
        { id: 'home', title: 'Your own 3D home', img: 'home.jpg', steps: [
          'Open the menu → "Home". You get a new room for every 2 titles you watch.',
          'Each room is themed on a title you pick.',
          'Walk around with the same controls as the World. Friends who visit can chat and talk with you.'
        ] },
        { id: 'rooms', title: 'Add and arrange rooms', img: 'home-edit.jpg', steps: [
          'In Home, tap the pencil button → "Edit rooms".',
          'Tap a "+" next to a room and choose a title for the new room.',
          'Tap a room to remove it. Tap "Save" when you are done.'
        ] },
        { id: 'decorate', title: 'Decorate a room', img: null, steps: [
          'In Home, tap the pencil button → "Decorate" and the room\'s name.',
          'Pick furniture from the tabs and tap the floor plan to place it. "Rotate" turns it, "Remove" takes it away.',
          '"Look at the house" previews it. Tap "Save" to keep it.'
        ] }
      ]
    },
    {
      id: 'me', title: 'Avatar & Profile',
      cards: [
        { id: 'customize', title: 'Make your character', img: 'customize.jpg', steps: [
          'Open the menu → "Customize character".',
          'Choose a tab — Body, Face, Hair, clothes, Accessories, Hero or Presets — and pick what you like.',
          'Drag the preview to turn it round. "Randomize" surprises you.',
          'Tap "Save". This is how you look in the World and your Home.'
        ] },
        { id: 'characters', title: 'Characters you have unlocked', img: 'characters.jpg', steps: [
          'Open the menu → "Characters".',
          'Watching a title unlocks everyone in it, in the looks they have there.',
          'Search by name, and tap a character to see all their versions.'
        ] },
        { id: 'profile', title: 'Your profile and stats', img: 'profile.jpg', steps: [
          'Tap your picture at the top right.',
          'See how much you have watched, characters unlocked, your favourite co-watcher and any game champion badges.',
          'Tap the pencil on your picture to pick a hero portrait.'
        ] },
        { id: 'theme', title: 'Change the look (Cinematic or Comic)', img: 'theme.jpg', steps: [
          'On your Profile, find "Appearance".',
          'Pick "Cinematic" (dark), "Comic" (bright) or "System" to follow your device.'
        ] }
      ]
    },
    {
      id: 'friends', title: 'Friends & Messages',
      cards: [
        { id: 'add', title: 'Add friends', img: 'friends.jpg', steps: [
          'Open the menu → "Friends".',
          'Type a username under "Add friend", tap "Search", then "Add" next to the right person.',
          'Requests sent to you appear under "Pending Requests" — tap "Accept" or "Reject".'
        ] },
        { id: 'visit', title: 'Look at a friend\'s progress', img: null, steps: [
          'In Friends, tap "View Progress" next to a friend (or tap their name on the Feed).',
          'Switch between their "Watch order", "Map" and "Home". In their Home you can walk around and chat with them.',
          'Tap "← Back to mine" to return.'
        ] },
        { id: 'messages', title: 'Send messages', img: 'messages.jpg', steps: [
          'Open the menu → "Messages".',
          'Tap "New message", type a username and your message, then "Send".',
          'Replies from the admin to your reports also land here.'
        ] },
        { id: 'share', title: 'Share your progress', img: 'share.jpg', steps: [
          'Tap "Share to story" on your Profile or in Goals.',
          '"Copy" the link, "Download image", or share straight to your phone\'s apps.',
          'Anyone with the link can see your progress without an account. "Turn off link" stops it working.'
        ] }
      ]
    },
    {
      id: 'account', title: 'Help & Account',
      cards: [
        { id: 'report', title: 'Report a bug or suggest an idea', img: 'report.jpg', steps: [
          'Open the menu → "Report a bug", or "Report a bug or idea" on your Profile.',
          'Choose Bug or Suggestion, give it a title, describe it and tap "Send".',
          'See your reports and the admin\'s replies under Profile → "My reports".'
        ] },
        { id: 'ask', title: 'Ask the admin', img: 'ask-admin.jpg', steps: [
          'On your Profile, tap "Ask the admin".',
          'Choose what you need: mark titles as watched, undo or fix a watch, add a missing title, change your username, or delete your account.',
          'Add a note and tap "Send request". The answer arrives in Messages.'
        ] },
        { id: 'password', title: 'Change your password', img: null, steps: [
          'On your Profile, tap "Change password".',
          'Enter your current password and the new one twice.'
        ] },
        { id: 'logout', title: 'Log out', img: null, steps: [
          'Open the menu → "Log out". This signs you out on every device.'
        ] }
      ]
    }
  ];

  function seenKey(userId) {
    return 'mcu_help_seen_' + (userId ? String(userId) : 'anon');
  }

  // stored: the raw localStorage value (null when never opened).
  function needsDot(stored, version) {
    const v = version == null ? GUIDE_VERSION : version;
    const seen = Number.parseInt(stored, 10);
    return !(Number.isFinite(seen) && seen >= v);
  }

  function cardText(card) {
    return [card.title, card.note || '', ...(card.steps || []),
      ...(card.keys || []).map(k => k.join(' '))].join(' ').toLowerCase();
  }

  // Every word of the query has to appear in the card (title, steps, keys or
  // note) or in its section's title. Sections left with no cards are dropped.
  function search(sections, query) {
    const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return sections;
    const out = [];
    for (const s of sections) {
      const head = s.title.toLowerCase();
      const cards = s.cards.filter(c => {
        const text = head + ' ' + cardText(c);
        return words.every(w => text.includes(w));
      });
      if (cards.length) out.push({ ...s, cards });
    }
    return out;
  }

  return { GUIDE_VERSION, SECTIONS, seenKey, needsDot, search };
});
