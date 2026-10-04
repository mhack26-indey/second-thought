import { ACTION_NAMES } from "./llm.ts";

// The usage guide (web.ts renders it at /guide and /w/<token>/guide; "help"
// and onboarding link to it). Each entry names the intent it documents: a
// router action (llm.ts ACTION_NAMES) or a command handled before the router
// (photos, "do I have this?", returns, stats, "stop"...). guide.test.ts fails
// if a router action has no entry, so the guide can't fall behind the bot.

export type Intent =
  | (typeof ACTION_NAMES)[number]
  | "fit_check_photo"
  | "closet_dump"
  | "shopping_check"
  | "unskip"
  | "order_photo"
  | "return_answer"
  | "returned_it"
  | "check_returns"
  | "impact"
  | "recap"
  | "check_closet"
  | "pause"
  | "delete_data"
  | "link_accounts";

export interface GuideEntry {
  intent: Intent;
  command: string; // what to send; copyable unless it's a photo
  photo?: boolean; // sent as a photo, so there's nothing to copy
  does: string; // one line
  reply?: string; // an example of what comes back
}

export interface GuideSection {
  title: string;
  entries: GuideEntry[];
}

/** The three-photo loop, for the top of the guide and the onboarding intro. */
export const LOOP = [
  { icon: "camera", title: "Getting dressed?", line: "Send a fit check. I log what you wear and add anything new to your closet." },
  { icon: "bag", title: "Shopping?", line: 'Send a screenshot and ask "do I have this?" I show what you already own that\'s close.' },
  { icon: "receipt", title: "Bought something?", line: "Send the receipt. I watch the return window and nudge you if it goes unworn." },
] as const;

export const GUIDE: GuideSection[] = [
  {
    title: "Closet and fit checks",
    entries: [
      { intent: "fit_check_photo", command: "A photo of your outfit", photo: true, does: "Logs what you're wearing; new pieces join your closet.", reply: "Saved your fit check. Wearing: navy polo, beige pants." },
      { intent: "closet_dump", command: "add my closet", does: "For 10 minutes, every photo of your closet rail, a drawer or a pile adds what's in it.", reply: "Added 6 items: navy polo, black jeans, … 2 you already had." },
      { intent: "add_items", command: "just got black jeans", does: "Adds clothes without a photo.", reply: "Added black jeans." },
      { intent: "remove_item", command: "sold my gray sweater for $20", does: "Takes something out of your closet: sold, donated, returned or thrown away." },
      { intent: "item_count", command: "how many white tees do I have?", does: "Counts identical pieces." },
      { intent: "fit_missing", command: "you missed my watch", does: "Adds something your last fit check didn't catch." },
      { intent: "fit_relabel", command: "that's not a blouse, it's a tee", does: "Fixes what an item in your last fit check is called." },
      { intent: "fit_same", command: "the jacket is actually my red puffer", does: "Tells me a 'new' item is one you already own, so it isn't counted twice." },
      { intent: "fit_not_there", command: "there's no hat in that", does: "Unlinks something that isn't in your last fit check." },
      { intent: "delete_fit_check", command: "delete my last fit check", does: "Removes your latest fit check, after you confirm." },
      { intent: "show_wardrobe", command: "my wardrobe", does: "Links your wardrobe page: everything you own, every fit check.", reply: "23 items in your wardrobe: (link)" },
    ],
  },
  {
    title: "Shopping",
    entries: [
      { intent: "shopping_check", command: "do I have this?", does: "Then send the photo or screenshot; I check it against your closet and save nothing.", reply: "You already have 1 like this: • navy short-sleeve polo: same collar and color (since July)" },
      { intent: "unskip", command: "I didn't skip it", does: "Bought it anyway? Takes back the skip I counted." },
      { intent: "worth_buying", command: "what should I buy?", does: "Finds the one piece that would open up the most outfits, or says to buy nothing.", reply: "You wear 5 bottoms with the same 2 tops. A gray top would go with all of them." },
    ],
  },
  {
    title: "Orders and returns",
    entries: [
      { intent: "order_photo", command: "A receipt or order screenshot", photo: true, does: "Adds what you bought and starts tracking the return window.", reply: "Added black jeans from Zara ($49.90). Return window closes Oct 31." },
      { intent: "return_answer", command: "return", does: "Answers a return nudge: links the store's returns page. Or reply keep." },
      { intent: "returned_it", command: "returned it", does: "Marks a return as sent back." },
      { intent: "check_returns", command: "check returns", does: "Asks about anything unworn from orders at least a week old." },
    ],
  },
  {
    title: "Your stats",
    entries: [
      { intent: "impact", command: "my impact", does: "What you skipped buying, sent back or passed on, and the money and CO₂ saved.", reply: "You've skipped 2 purchases and sold 1 item, and gotten $15.00 back." },
      { intent: "recap", command: "my recap", does: "A card of your last 30 days: most worn, what sat unworn." },
      { intent: "check_closet", command: "check my closet", does: "Finds what you haven't worn in its season." },
    ],
  },
  {
    title: "Finding things",
    entries: [
      { intent: "set_location", command: "put my winter jacket in the under-bed bin", does: "Remembers where you keep something." },
      { intent: "find_item", command: "where's my winter jacket?", does: "Tells you where it is.", reply: "Your winter jacket: under-bed bin, since Oct 3." },
      { intent: "last_worn", command: "when did I last wear my red puffer?", does: "Finds the last fit check it was in, with a link to it.", reply: "You last wore your red quilted puffer jacket on Sep 25: (link)" },
    ],
  },
  {
    title: "Reminders",
    entries: [
      { intent: "add_reminder", command: "remind me friday at 5pm to return the jacket", does: "Texts you at that time." },
      { intent: "list_reminders", command: "my reminders", does: "Your daily fit check time and upcoming reminders." },
      { intent: "cancel_reminder", command: "cancel 1", does: "Cancels a reminder by its number in the list." },
      { intent: "set_fit_check_time", command: "fit check at 8am", does: "Moves your daily fit check prompt." },
      { intent: "stop_fit_checks", command: "stop fit checks", does: "Turns the daily prompt off." },
    ],
  },
  {
    title: "Settings and privacy",
    entries: [
      { intent: "show_profile", command: "my profile", does: "Your name, city and fit check time." },
      { intent: "update_profile", command: "city Detroit", does: 'Changes your city (or "call me Sam" for your name).' },
      { intent: "pause", command: "stop", does: "Pauses every message I'd start, until you text again." },
      { intent: "delete_data", command: "delete my data", does: "Erases your closet, photos and everything else, after you confirm." },
      { intent: "link_accounts", command: "link", does: "Moves your closet between iMessage and Telegram with a 6-digit code." },
      { intent: "help", command: "help", does: "The short list of commands, with a link here." },
    ],
  },
];

/** Router actions the guide leaves out on purpose: small talk has no command. */
export const UNDOCUMENTED: readonly Intent[] = ["chat"];

/** Sent when onboarding finishes: the three-photo loop and the guide link. */
export function onboardingIntro(guideLink: string): string {
  return [
    "You're set! Here's how it works:",
    "📸 Getting dressed? Send a fit check.",
    '🛍️ Shopping? Send a screenshot and ask "do I have this?"',
    "🧾 Bought something? Send the receipt and I'll watch the return window.",
    `Every command is here: ${guideLink}`,
  ].join("\n");
}

/** "help" and the like end with the guide link. */
export const withGuideLink = (text: string, guideLink: string) => `${text}\nEvery command is here: ${guideLink}`;

export const wardrobeLinkMessage = (wardrobeLink: string) => `Your wardrobe page, always up to date: ${wardrobeLink}`;

/** The short command list for "help", ending with the guide link. */
const HELP = [
  "You can text me things like:",
  '• "my wardrobe" to see your closet',
  '• "I just got black jeans" to add clothes',
  '• "remind me tomorrow to return the jacket"',
  '• "my reminders" to see your schedule',
  '• "winter jacket is in the under-bed bin", then "where\'s my winter jacket?"',
  '• "what should I buy?" to find the gap in what you wear',
  '• "my recap" for a card of your last 30 days',
  '• "check my closet" to find what you haven\'t been wearing',
  '• "add my closet", then photos of your closet rail, a drawer or a pile of clothes, to add a lot at once',
  '• "do I have this?" then a photo, to check before you buy',
  '• "you missed my watch" or "that\'s not a blouse, it\'s a tee" to fix your last fit check',
  '• a screenshot of an order, to track its return window ("check returns" to see what to send back)',
  '• "my impact" to see what you skipped buying and got back',
  '• "fit check at 8am" or "stop fit checks"; "stop" pauses everything until you text again',
  '• "delete my data" to erase everything and start over',
  '• "link" to move your closet between iMessage and Telegram',
  '• "my profile" to see your info, "city Detroit" or "call me Sam" to change it',
  "Or send a fit check photo.",
].join("\n");

export const helpText = (guideLink: string) => withGuideLink(HELP, guideLink);
