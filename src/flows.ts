import { type Action, type ChatKind, colorIn, itemFromName, route } from "./llm.ts";
import { type ImageInput, type MediaType, visionEnabled } from "./closet/vlm.ts";
import { type City, cityFrom, findCities } from "./cities.ts";
import { exactGroups, findItemByName, llmGroups } from "./match.ts";
import { addItemToOutfit, deleteFitCheck, itemsOnlyIn, linkItem, mergeItems, relabelItem, unlinkItem } from "./fit-edits.ts";
import { WINDOW_DAYS, worthBuying } from "./gaps.ts";
import { type BotReply, type RecentFitCheck, ShoppingMode } from "./shopping-mode.ts";
import { readPhoto } from "./photo-intake.ts";
import { climateFor } from "./climate.ts";
import { SNOOZE_DAYS, UNWORN_DAYS, findGhosts, ghostQuestion, markAsked, parseCheckinAnswer, pendingCheckin, setCheckin } from "./ghosts.ts";
import { last30Days } from "./recap.ts";
import { recapFor } from "./recaps.ts";
import { handleReturnsText } from "./returns.ts";
import { type LetGo, impactReply, impactTotals, isImpactAsk, isUnskip, letGo, parseLetGo, tossMessage, undoLastSkip } from "./impact.ts";
import { describeKg, footprintOf, isPlural } from "./footprint.ts";
import { wearCount } from "./closet/repo.ts";
import { money } from "./orders.ts";
import {
  type Item,
  type Reminder,
  type User,
  addFitCheck,
  addReminder,
  addTextItems,
  cancelReminder,
  db,
  deletePhoto,
  latestFitCheck,
  getOutfit,
  deleteUserData,
  setPaused,
  photoAt,
  listItems,
  listOutfits,
  localDate,
  pendingReminders,
  removeItem,
  setLocation,
  wornLately,
  updateUser,
} from "./store.ts";
import { recapUrl, wardrobeUrl } from "./web.ts";

export const WELCOME =
  "Hey, I'm Second Thought. Text me your fit checks and order screenshots and I'll remember everything you own, so you stop buying duplicates.";
const ASK_CITY = "First, what city are you in? I use it to know what season your clothes are for.";

const UNITS: Record<string, number> = {
  s: 1_000,
  sec: 1_000,
  m: 60_000,
  min: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hour: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
};

// "remind me in 2 min to check the jacket" -> { ms: 120000, text: "check the jacket" }
const REMIND = /^remind me in (\d+)\s*([a-z]+?)s?(?:\s+(?:to\s+)?(.+))?$/i;

export function parseReminder(input: string): { ms: number; text: string } | undefined {
  const match = REMIND.exec(input.trim());
  if (!match) return undefined;
  const unit = UNITS[match[2]!.toLowerCase()];
  if (!unit) return undefined;
  return { ms: Number(match[1]) * unit, text: match[3] ?? "your reminder" };
}

// "fit check at 8am", "fit check time 8:30 pm" -> 24h hour (minutes are ignored)
const FIT_TIME = /^fit ?checks? (?:at|time)\s+(\d{1,2})(?::\d{2})?\s*(am|pm)?$/i;

export function parseFitCheckHour(input: string): number | undefined {
  const match = FIT_TIME.exec(input.trim());
  if (!match) return undefined;
  let hour = Number(match[1]);
  const meridiem = match[2]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return hour <= 23 ? hour : undefined;
}

export function formatHour(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${hour < 12 ? "am" : "pm"}`;
}

function formatWhen(at: number): string {
  const d = new Date(at);
  const day = localDate(d) === localDate() ? "today" : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return `${day} at ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const HELP = [
  "You can text me things like:",
  '• "my wardrobe" to see your closet',
  '• "I just got black jeans" to add clothes',
  '• "remind me tomorrow to return the jacket"',
  '• "my reminders" to see your schedule',
  '• "winter jacket is in the under-bed bin", then "where\'s my winter jacket?"',
  '• "what should I buy?" to find the gap in what you wear',
  '• "my recap" for a card of your last 30 days',
  '• "check my closet" to find what you haven\'t been wearing',
  '• "do I have this?" then a photo, to check before you buy',
  '• "you missed my watch" or "that\'s not a blouse, it\'s a tee" to fix your last fit check',
  '• a screenshot of an order, to track its return window ("check returns" to see what to send back)',
  '• "my impact" to see what you skipped buying and got back',
  '• "fit check at 8am" or "stop fit checks"; "stop" pauses everything until you text again',
  '• "delete my data" to erase everything and start over',
  '• "my profile" to see your info, "city Detroit" or "call me Sam" to change it',
  "Or send a fit check photo.",
].join("\n");

export function fitCheckPrompt(): string {
  return "Daily fit check: send me a photo of what you're wearing today.";
}

// A new user's first text is often a real request ("just got black jeans").
// It waits here until they've answered the city question, then runs.
// In memory only: a restart mid-onboarding just loses that one text.
const firstRequests = new Map<string, string>();

/** Replies for a brand-new user: welcome plus the first onboarding question. */
export function startOnboarding(userId: string, firstText?: string): string[] {
  const greeting = firstText !== undefined && fastPath(firstText)?.action === "chat";
  if (firstText?.trim() && !greeting) {
    firstRequests.set(userId, firstText);
    return [WELCOME, `I'll get to that in a sec. ${ASK_CITY}`];
  }
  return [WELCOME, ASK_CITY];
}

// Exact commands skip the model: instant, free, and work with no LLM running.
function fastPath(text: string): Action | undefined {
  const t = text.trim().toLowerCase().replace(/[.!?]+$/, "");
  const reminder = parseReminder(t);
  if (reminder) return { action: "add_reminder", at: Date.now() + reminder.ms, text: reminder.text };
  const hour = parseFitCheckHour(t);
  if (hour !== undefined) return { action: "set_fit_check_time", hour };
  if (/^stop fit ?checks?$/.test(t)) return { action: "stop_fit_checks" };
  if (/^(my )?(wardrobe|closet)$/.test(t)) return { action: "show_wardrobe" };
  if (/^(my )?reminders?( schedule)?$/.test(t)) return { action: "list_reminders" };
  if (/^(help|\?|commands)$/.test(t)) return { action: "help" };
  if (/^(thanks?( you)?|thx|ty)$/.test(t)) return { action: "chat", kind: "thanks" };
  if (/^(hi+|hey+|hello|yo|sup|good (morning|afternoon|evening))$/.test(t)) return { action: "chat", kind: "greeting" };
  const cancel = /^cancel (?:reminder )?#?(\d+)$/.exec(t);
  if (cancel) return { action: "cancel_reminder", number: Number(cancel[1]) };
  if (/^(my )?(profile|info|settings)$/.test(t)) return { action: "show_profile" };
  // Quantities: "how many white tees do I have", "I have 3 of the gray crewneck". Answered with a
  // link to the page (counts aren't changed by text), so these fixed phrasings skip the model.
  const count =
    /^how many (?:of )?(?:my |the )?(.+?) do i (?:have|own)$/.exec(t) ??
    /^(?:i |actually i |i actually )(?:have|own) (?:\d+|two|three|four|five|six|seven|eight|nine|ten) (?:of )?(?:the |my |those |these )?(.+?)(?:,? btw| actually)?$/.exec(t);
  if (count) return { action: "item_count", name: count[1]! };
  if (/^(change|update|set|edit) (my )?(city|location)$/.test(t)) return { action: "update_profile" };
  // Match the original text so the city or name keeps its capitalization.
  const raw = text.trim().replace(/[.!]+$/, "");
  const city = /^(?:(?:set|change|update) )?(?:my )?(?:city|location)(?: to| is)?:? (?!of\b)(.+)$/i.exec(raw);
  if (city) return { action: "update_profile", city: city[1]!.trim() };
  // "call me" only takes one capitalized word, so "call me tomorrow" stays a reminder.
  const name = /^my name is (.+)$/i.exec(raw) ?? /^call me ([A-Z][\w'-]*)$/.exec(raw);
  if (name && /^(tomorrow|later|tonight|back|soon)$/i.test(name[1]!)) return undefined;
  if (name) return { action: "update_profile", name: name[1]!.trim() };
  return undefined;
}

// Shown when the model is unreachable: only commands that fastPath handles.
const EXACT_COMMANDS = [
  "I'm having trouble understanding right now. These still work:",
  '• "my wardrobe"',
  '• "my reminders" / "cancel 1"',
  '• "remind me in 2 hours to return the jacket"',
  '• "fit check at 8am" / "stop fit checks"',
  '• "my profile" / "city Detroit" / "my name is Sam"',
].join("\n");

/**
 * Looks up what they typed as a city. One real match is saved; several are
 * listed for them to pick by number; none gets the question again. If the
 * lookup service is down, what they typed is saved as is.
 */
async function chooseCity(user: User, text: string): Promise<string[]> {
  const typed = cityFrom(text);
  let found: City[];
  try {
    found = await findCities(typed);
  } catch (err) {
    console.error("city lookup failed; saving it as typed", err);
    return setCity(user, typed);
  }
  if (found.length === 1) return setCity(user, found[0]!.label);
  if (!found.length) {
    return [
      user.city
        ? `I couldn't find a city called "${typed}", so yours is still ${user.city}. Adding the state helps, like "city Springfield, Illinois".`
        : `I couldn't find a city called "${typed}". What city are you in? Adding the state helps, like "Springfield, Illinois".`,
    ];
  }
  const options = found.map((c) => c.label);
  await updateUser(user.id, { step: "city_pick", cityOptions: options });
  return [["Which one?", ...options.map((o, i) => `${i + 1}. ${o}`), "Reply with the number, or type it again with the state."].join("\n")];
}

/** Saves their city; during onboarding, also finishes it. */
async function setCity(user: User, city: string): Promise<string[]> {
  const onboarding = !user.city;
  await updateUser(user.id, { city, step: "done", cityOptions: null });
  if (!onboarding) return [`Got it, your city is now ${city}.`];

  const hour = user.fitCheckHour;
  const done = [
    `Got it, ${city}. You're all set.`,
    hour === null ? "Daily fit checks are off." : `I'll ask for a fit check every day around ${formatHour(hour)}.`,
  ].join(" ");
  const first = firstRequests.get(user.id);
  if (first === undefined) return [done, HELP];
  firstRequests.delete(user.id);
  return [done, ...(await handleText({ ...user, city, step: "done", cityOptions: null }, first))];
}

/** Handle a text message from a user, returning the replies to send. */
export async function handleText(user: User, text: string): Promise<string[]> {
  if (user.step === "city") return chooseCity(user, text);
  if (user.step === "city_pick") {
    const pick = /^\s*#?(\d+)[.)]?\s*$/.exec(text);
    const chosen = pick ? user.cityOptions?.[Number(pick[1]) - 1] : undefined;
    if (chosen) return setCity(user, chosen);
    if (!user.city) return chooseCity(user, text); // still onboarding: another try at the city
    // Already set up and they moved on: drop the question, handle the text.
    await updateUser(user.id, { step: "done", cityOptions: null });
    user.step = "done";
    user.cityOptions = null;
  }

  // Reminder numbers refer to the list as it stood when they texted, so
  // "cancel 1 and 2" still means the original 1 and 2 after the first cancel.
  const listed = await pendingReminders(user.id);

  const exact = fastPath(text);
  let actions: Action[];
  if (exact) {
    actions = [exact];
  } else {
    try {
      const [items, lastFit] = await Promise.all([listItems(user.id), latestFitCheck(user.id)]);
      actions = await route(text, {
        now: new Date(),
        reminders: listed.map((r) => `${r.text} (${formatWhen(r.at)})`),
        items: items.map((i) => i.description),
        lastFit: lastFit?.items.map((i) => i.description),
      });
    } catch (err) {
      console.error("LLM routing failed:", err instanceof Error ? err.message : err);
      return [EXACT_COMMANDS];
    }
  }
  if (!actions.length) return ["I didn't catch that.", HELP];

  const replies: string[] = [];
  for (const action of actions) replies.push(...(await runAction(user, action, listed, text)));
  // Several actions answer in one message instead of a burst of texts.
  return actions.length > 1 ? [replies.join("\n")] : replies;
}

async function runAction(user: User, action: Action, listed: Reminder[], text = ""): Promise<string[]> {
  switch (action.action) {
    case "add_reminder": {
      await addReminder(user.id, action.at, action.text);
      return [`Okay, I'll remind you about "${action.text}" ${formatWhen(action.at)}.`];
    }

    case "list_reminders": {
      const hour = user.fitCheckHour;
      const lines = [`Daily fit check: ${hour === null ? "off" : formatHour(hour)}`];
      const pending = await pendingReminders(user.id);
      if (pending.length) {
        pending.forEach((r, i) => lines.push(`${i + 1}. ${r.text} (${formatWhen(r.at)})`));
        lines.push('Text "cancel 1" to remove one.');
      } else {
        lines.push("No other reminders.");
      }
      return [lines.join("\n")];
    }

    case "cancel_reminder": {
      const target = listed[action.number - 1];
      if (!target || !(await cancelReminder(user.id, target.id))) {
        return ["I don't see that reminder. Text \"my reminders\" to see the list."];
      }
      return [`Cancelled: ${target.text}.`];
    }

    case "set_fit_check_time":
      await updateUser(user.id, { fitCheckHour: action.hour });
      user.fitCheckHour = action.hour; // later actions in the same text see it
      return [`Done. I'll ask for your fit check around ${formatHour(action.hour)} each day.`];

    case "stop_fit_checks":
      await updateUser(user.id, { fitCheckHour: null });
      user.fitCheckHour = null;
      return ['Okay, no more daily fit checks. Text "fit check at 8am" to turn them back on.'];

    case "show_wardrobe": {
      const n = (await listItems(user.id)).length;
      const summary = n ? `${n} item${n === 1 ? "" : "s"}` : "Nothing yet";
      return [`${summary} in your wardrobe: ${wardrobeUrl(user)}`];
    }

    case "add_items": {
      await addTextItems(user.id, action.items);
      return [`Added ${action.items.map((i) => i.description).join(", ")}.`];
    }

    case "remove_item": {
      const item = await findOwned(user.id, action.name);
      if (!item) return [`I couldn't find "${action.name}" in your wardrobe.`];
      // How it left decides what counts, so ask unless they said. The model
      // sometimes leaves "how" out of "gave away" or "returned"; the words decide then.
      const said = action.how ? { how: action.how, price: action.price ?? null } : parseLetGo(text);
      if (!said) {
        letGoQuestions.set(user.id, { itemId: item.id, at: Date.now() });
        const options = item.purchase_id ? "returned, sold, donated, or threw it away" : "sold, donated, or threw it away";
        return [`How did your ${item.description} go: ${options}? (Add the price if you sold it.)`];
      }
      return [await letItGo(user, item, said.how, said.price)];
    }

    case "set_location": {
      const item = await findOwned(user.id, action.name);
      if (!item) return [`I couldn't find "${action.name}" in your wardrobe. Add it first, like "I have a ${action.name}".`];
      await setLocation(user.id, item.id, action.location);
      return [`Got it. ${capitalize(item.description)}: ${action.location}.`];
    }

    case "find_item": {
      const item = await findOwned(user.id, action.name);
      if (!item) return [`I couldn't find "${action.name}" in your wardrobe.`];
      if (!item.location) {
        // Worded so it reads right for "jacket" and "sneakers" alike.
        return [`I don't have a spot saved for your ${item.description}. Next time, text me something like "put the ${item.description} in the hall closet".`];
      }
      const since = item.location_set_at ? `, since ${fmtDay(item.location_set_at)}` : "";
      return [`Your ${item.description}: ${item.location}${since}.`];
    }

    case "item_count": {
      // Counts are edited on the page, where you can see the item; texts only point there.
      const item = await findOwned(user.id, action.name);
      if (!item) return [`I couldn't find "${action.name}" in your wardrobe. You can see everything here: ${wardrobeUrl(user)}`];
      const have = item.quantity > 1 ? `You have ${item.quantity} × ${item.description}.` : `I have one ${item.description} for you.`;
      return [`${have} To change how many you own, tap "How many?" next to it: ${wardrobeUrl(user)}#item-${item.id}`];
    }

    case "delete_fit_check": {
      const latest = await latestFitCheck(user.id);
      if (!latest) return ["You don't have any fit checks to delete."];
      const onlyHere = await itemsOnlyIn(db, user.id, latest.outfit.id);
      deleteQuestions.set(user.id, { outfitId: latest.outfit.id, at: Date.now() });
      const day = latest.outfit.at ? new Date(latest.outfit.at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
      const also = onlyHere.length ? ` That also removes ${onlyHere.join(", ")}, which only came from that photo.` : "";
      return [`Delete your fit check from ${day}?${also} Reply yes to delete it.`];
    }

    case "fit_same":
    case "fit_relabel":
    case "fit_missing":
    case "fit_not_there":
      return [await correctFitCheck(user, action)];

    case "worth_buying": {
      const wears = await wornLately(user.id, WINDOW_DAYS);
      const groups = await llmGroups(wears).catch((err) => {
        console.error("color grouping failed", err);
        return exactGroups;
      });
      return [worthBuying(wears, groups)];
    }

    case "show_profile": {
      const hour = user.fitCheckHour;
      const [items, outfits] = await Promise.all([listItems(user.id), listOutfits(user.id)]);
      return [
        [
          `Name: ${user.name ?? "not set"}`,
          `City: ${user.city ?? "not set"}`,
          `Daily fit check: ${hour === null ? "off" : formatHour(hour)}`,
          `Wardrobe: ${plural(items.length, "item")}, ${plural(outfits.length, "fit check")}`,
          `Edit it here: ${wardrobeUrl(user)}#profile`,
          'Or text "city Detroit", "call me Sam", or "fit check at 8am".',
        ].join("\n"),
      ];
    }

    case "update_profile": {
      // "change my location" with no city: ask rather than guess.
      if (!action.name && !action.city) return ['Sure, what city are you in now? Text it like "city Detroit".'];
      const replies: string[] = [];
      if (action.name) {
        user.name = action.name;
        await updateUser(user.id, { name: action.name });
        replies.push(`Got it, I'll call you ${action.name}.`);
      }
      if (action.city) replies.push(...(await chooseCity(user, action.city)));
      return [replies.join("\n")];
    }

    case "help":
      return [HELP];

    case "chat":
      return [CHAT_REPLIES[action.kind]];
  }
}

// Small talk gets canned replies so the model never writes free text (a 3B
// model will happily give style advice or promise features that don't exist).
const CHAT_REPLIES: Record<ChatKind, string> = {
  greeting: 'Hey! Send a fit check, or text "help" to see what I can do.',
  thanks: "Anytime!",
  style: "I don't judge style or pick outfits. I just keep track of what you own so you don't buy it twice.",
  other: 'Not sure I can help with that. Text "help" to see what I can do.',
};

export type { BotReply, Reply } from "./shopping-mode.ts";

const shopping = new ShoppingMode({ db });
const photoDeps = { db, shop: shopping.match.bind(shopping) };

/** Handle a text message; "do I have this?" may answer later, after the vision model. */
const STOP = /^(?:stop|pause|mute|unsubscribe|stop (?:messaging|texting|notifying|bugging) me|stop (?:all )?(?:messages|notifications|texts)|no more (?:messages|notifications|texts))$/;
const DELETE_ALL = /^(?:please )?(?:delete|erase|wipe|remove|clear) (?:all )?(?:of )?(?:my )?(?:data|account|info|information|everything|stuff|closet and everything)$|^reset (?:me|my account|everything|my data)$|^start over$/;

// "delete my data" waits for a yes; anything else cancels it.
const deleteAllQuestions = new Map<string, number>();

export async function handleTextMessage(user: User, text: string): Promise<BotReply> {
  const t = text.trim().toLowerCase().replace(/[.!?]+$/, "");

  if (deleteAllQuestions.has(user.id)) {
    const asked = deleteAllQuestions.get(user.id)!;
    deleteAllQuestions.delete(user.id);
    if (Date.now() - asked < 10 * 60_000 && /^(?:yes|yeah|yep|y|delete it|do it|i'?m sure)\b/.test(t)) {
      await deleteUserData(user.id);
      return { replies: ["Done. Everything's deleted. Text me anytime to start over."] };
    }
    if (/^(?:no|nope|nah|cancel|never ?mind|keep it)\b/.test(t)) return { replies: ["Okay, nothing was deleted."] };
  }
  if (DELETE_ALL.test(t)) {
    deleteAllQuestions.set(user.id, Date.now());
    return {
      replies: [
        "Are you sure? This deletes your closet, fit checks, photos, reminders, purchases and impact, and starts you over. Reply yes to delete everything.",
      ],
    };
  }
  if (STOP.test(t)) {
    await setPaused(user.id, true);
    return { replies: ["Sure, I'll hold off on notifications. Once you send me another message, they'll start again."] };
  }
  if (user.paused) await setPaused(user.id, false); // any message: they're back

  if (user.step === "done") {
    const checkin = await answerCheckin(user, text);
    if (checkin) return { replies: [checkin] };
    if (CHECK_CLOSET.test(text.trim().toLowerCase().replace(/[.!?]+$/, ""))) {
      return { replies: [(await askCheckin(user, { demo: true })) ?? "Nothing's been sitting unworn in its season. Nice."] };
    }
    const deleteAnswer = await answerDelete(user, text);
    if (deleteAnswer) return { replies: [deleteAnswer] };
    const letGoAnswer = await answerLetGo(user, text);
    if (letGoAnswer) return { replies: [letGoAnswer] };
    // "keep" / "return" after a nudge, "returned it", "check returns" (returns.ts)
    const returns = await handleReturnsText(db, user.id, text, localDate());
    if (returns) return { replies: returns };
    if (isImpactAsk(text)) return { replies: [impactReply(await impactTotals(db, user.id))] };
    if (RECAP_ASK.test(text.trim().toLowerCase().replace(/[.!?]+$/, ""))) {
      const { card, summary } = await recapFor(user.id, last30Days());
      return { replies: [...(card ? [{ image: card, name: "recap.png", mimeType: "image/png" }] : []), summary, `Share it: ${recapUrl(user)}`] };
    }
    if (isUnskip(text)) {
      const was = await undoLastSkip(db, user.id);
      return {
        replies: [was ? `Got it, I took that off your skipped count (it matched your ${was}).` : "There's no recent skip to take back."],
      };
    }
    const shop = shopping.onText(user.id, text);
    if (shop) return shop;
  }
  return { replies: await handleText(user, text) };
}

const VISION_TYPES = new Set<string>(["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif"]);

export async function handlePhoto(user: User, image: Buffer, mimeType: string): Promise<BotReply> {
  if (user.paused) await setPaused(user.id, false); // any message: they're back
  if (user.step !== "done") return { replies: [ASK_CITY] };
  const canRead = visionEnabled() && VISION_TYPES.has(mimeType);
  const input: ImageInput = { base64: image.toString("base64"), mediaType: mimeType as MediaType };

  // They asked "do I have this?" first: match the photo, save nothing.
  if (shopping.takePending(user.id)) {
    if (!canRead) return { replies: ["I can't look at that photo right now, so I can't check it against your closet."] };
    return { replies: [], later: () => shopping.match(user.id, input) };
  }

  const outfit = await addFitCheck(user.id, image, mimeType);
  const lastFitPhoto = user.lastFitPhoto;
  await updateUser(user.id, { lastFitPhoto: localDate() }); // counts as today's fit check, so no ping
  if (!canRead) return { replies: ["Saved your fit check."] };

  // A "do I have this?" right after can still take it back (shopping-mode.ts).
  const fit: RecentFitCheck = {
    outfitId: outfit.id,
    image: input,
    at: Date.now(),
    cancelled: false,
    cleanup: async () => {
      await deletePhoto(user.id, outfit.photoUrl);
      await updateUser(user.id, { lastFitPhoto });
    },
  };
  shopping.fitCheckSaved(user.id, fit);
  // Saved as a fit check until the vision model says otherwise: an order
  // screenshot comes back out and goes to order intake (photo-intake.ts).
  return {
    replies: ["Got it, taking a look..."],
    later: () => (fit.work = readPhoto(user.id, outfit, input, fit, photoDeps)),
  };
}

// "Got rid of the crewneck" waits for how it went before it counts. In memory:
// a restart forgets an unanswered question, and the item simply stays.
const letGoQuestions = new Map<string, { itemId: number; at: number }>();
const LET_GO_WINDOW_MS = 30 * 60_000;

const RECAP_ASK = /^(?:my |show me my |send me my |what'?s my )?(?:monthly )?(?:recap|wrap(?:ped)?|month in review)$/;

// "Delete my last fit check" waits for a yes, since it can't be undone.
const deleteQuestions = new Map<string, { outfitId: number; at: number }>();
const DELETE_WINDOW_MS = 10 * 60_000;
const YES = /^(?:yes|yeah|yep|yup|y|sure|ok(?:ay)?|do it|delete it|go ahead)\b/i;

/** Their answer to "delete your fit check?", if one is waiting. */
async function answerDelete(user: User, text: string): Promise<string | undefined> {
  const waiting = deleteQuestions.get(user.id);
  if (!waiting) return undefined;
  deleteQuestions.delete(user.id); // one chance: anything else drops it
  if (Date.now() - waiting.at > DELETE_WINDOW_MS) return undefined;
  if (!YES.test(text.trim())) return /^(?:no|nope|nah|cancel|never ?mind|keep it)\b/i.test(text.trim()) ? "Okay, I kept it." : undefined;
  const outfit = await getOutfit(user.id, waiting.outfitId);
  const removed = await deleteFitCheck(db, user.id, waiting.outfitId);
  if (!removed) return "That fit check is already gone.";
  if (outfit?.photoUrl) await deletePhoto(user.id, outfit.photoUrl);
  return removed.length ? `Deleted it, and removed ${removed.join(", ")}.` : "Deleted it. Everything else stays in your closet.";
}

/** Their answer to "how did it go?", if one is waiting. */
async function answerLetGo(user: User, text: string): Promise<string | undefined> {
  const waiting = letGoQuestions.get(user.id);
  if (!waiting || Date.now() - waiting.at > LET_GO_WINDOW_MS) return undefined;
  const answer = parseLetGo(text);
  if (!answer) return undefined; // something else: leave the question open
  letGoQuestions.delete(user.id);
  const item = (await listItems(user.id)).find((i) => i.id === waiting.itemId);
  if (!item) return "That item's already gone from your wardrobe.";
  return letItGo(user, item, answer.how, answer.price);
}

const CHECK_CLOSET = /^(?:check|scan) (?:my )?(?:closet|wardrobe|clothes)$/;

/**
 * Asks "what happened to this?" about their most overdue in-season item, and
 * returns the question (undefined if nothing qualifies). `demo` ("check my
 * closet") shortens the wait to a week so the seeded closet can show it.
 */
export async function askCheckin(user: User, opts: { demo?: boolean } = {}): Promise<string | undefined> {
  if (!user.city) return undefined;
  const climate = await climateFor(db, user.city).catch((err) => {
    console.error(`climate for ${user.city} failed`, err);
    return undefined;
  });
  if (!climate) return undefined;
  const [ghost] = await findGhosts(db, user.id, climate, new Date(), opts.demo ? 7 : UNWORN_DAYS);
  if (!ghost) return undefined;
  await markAsked(db, user.id, ghost.itemId);
  return ghostQuestion(ghost, user.city);
}

/** Replies to "what happened to this?" and its follow-ups (where is it, how did it go). */
async function answerCheckin(user: User, text: string): Promise<string | undefined> {
  const pending = await pendingCheckin(db, user.id);
  if (!pending) return undefined;
  const item = (await listItems(user.id)).find((i) => i.id === pending.item_id);
  if (!item) return undefined;

  if (pending.awaiting === "location") {
    if (fastPath(text)) return undefined; // a command, not a place
    await setLocation(user.id, item.id, text.trim().replace(/^(?:it'?s |in |at )+/i, ""));
    await setCheckin(db, item.id, { awaiting: null, snoozeDays: 90 });
    return `Got it, your ${item.description} is ${text.trim().replace(/^(?:it'?s )/i, "")}. I won't ask about it for a while.`;
  }
  if (pending.awaiting === "let_go") {
    if (/^(?:keep|keeping it|nevermind|never mind)\b/i.test(text.trim())) {
      await setCheckin(db, item.id, { awaiting: null, snoozeDays: SNOOZE_DAYS });
      return `Okay, keeping your ${item.description}.`;
    }
    const said = parseLetGo(text);
    if (!said) return undefined;
    await setCheckin(db, item.id, { awaiting: null });
    return letItGo(user, item, said.how, said.price);
  }

  switch (parseCheckinAnswer(text)) {
    case 1:
      await setCheckin(db, item.id, { awaiting: null, snoozeDays: SNOOZE_DAYS });
      return `Got it, I'll leave your ${item.description} alone for a few weeks.`;
    case 2:
      await setCheckin(db, item.id, { awaiting: null, occasionOnly: true });
      return `Noted: your ${item.description} is for special occasions. I won't ask about it again.`;
    case 3:
      await setCheckin(db, item.id, { awaiting: "location" });
      return `Where is it? (like "under-bed bin" or "at my mom's")`;
    case 4: {
      await setCheckin(db, item.id, { awaiting: "let_go" });
      const listing = `https://www.depop.com/search/?q=${encodeURIComponent(item.description)}`;
      return [
        `Then someone else might love it. It's in season now, a good time to list it:`,
        `"${capitalize(item.description)}"`,
        `See what similar ones go for: ${listing}`,
        `Text "sold it for $20" or "donated" once it's gone (I'll count it), or "keep" to hang on to it.`,
      ].join("\n");
    }
    case 5:
      await setCheckin(db, item.id, { awaiting: "let_go" });
      return `Nice. Did you sell it (and for how much), donate it, or return it?`;
    case 6:
      await setCheckin(db, item.id, { awaiting: null });
      return letItGo(user, item, "trashed", null);
    default:
      return undefined; // something else: leave the question open
  }
}

async function letItGo(user: User, item: Item, how: LetGo, price: number | null): Promise<string> {
  if (!(await letGo(db, user.id, item.id, how, price))) return `Couldn't update your ${item.description}.`;
  const kg = footprintOf(item.type);
  const saved = how !== "trashed" && kg !== null ? ` Someone else wearing it saves ${describeKg(kg)} (estimate).` : "";
  // One of several identical pieces: say how many are left.
  const several = item.quantity > 1 ? ` (${item.quantity - 1} left)` : "";
  const one = item.quantity > 1 ? `one ${item.description}` : `your ${item.description}`;
  if (how === "trashed" && item.quantity === 1) {
    return tossMessage(item.description, isPlural(item.type), item.created_at, await wearCount(db, item.id));
  }
  const done = {
    returned: `Marked ${one} as returned${several}.`,
    sold: `Nice, sold ${one}${price ? ` for ${money(price)}` : ""}${several}.`,
    donated: `Donated ${one}${several}. Good call.`,
    trashed: `Removed ${one}${several}.`,
  }[how];
  return done + (how === "trashed" ? "" : saved);
}

type Correction = Extract<Action, { action: "fit_same" | "fit_relabel" | "fit_missing" | "fit_not_there" }>;

/**
 * Fixes what the bot read from their most recent fit check, by text: the
 * same edits as the wardrobe page's fit check editor (fit-edits.ts).
 */
async function correctFitCheck(user: User, fix: Correction): Promise<string> {
  const latest = await latestFitCheck(user.id);
  if (!latest) return "I don't have a fit check from you yet. Send a photo of your outfit first.";
  const { outfit, items: inPhoto } = latest;
  const listed = inPhoto.length ? inPhoto.map((i) => i.description).join(", ") : "nothing yet";
  const notThere = (name: string) => `I don't see "${name}" in your last fit check. It has: ${listed}.`;

  if (fix.action === "fit_missing") {
    const closet = await listItems(user.id);
    const linkedIds = new Set(inPhoto.map((i) => i.id));
    const owned = await findItemByName(fix.name, closet.filter((i) => !linkedIds.has(i.id))).catch(() => undefined);
    if (owned) {
      await linkItem(db, user.id, outfit.id, owned.id);
      return `Added your ${owned.description} to your last fit check.`;
    }
    const item = await itemFromName(fix.name).catch(() => undefined);
    if (!item) return `I couldn't tell what kind of item "${fix.name}" is. Try naming it, like "black watch".`;
    const saved = await addItemToOutfit(db, user.id, outfit, item);
    return `Added ${saved.description} to your closet and your last fit check.`;
  }

  const item = await findItemByName(fix.name, inPhoto).catch(() => undefined);
  // "Forgot to mention I'm wearing my black jeans" can come back as fit_same
  // for an item that isn't in the photo. If it's something they own, they
  // mean it's missing from the photo; otherwise it's just not there.
  if (!item && fix.action === "fit_same") {
    const linkedIds = new Set(inPhoto.map((i) => i.id));
    const closet = (await listItems(user.id)).filter((i) => !linkedIds.has(i.id));
    const owned = await findItemByName(fix.name, closet).catch(() => undefined);
    if (owned) {
      await linkItem(db, user.id, outfit.id, owned.id);
      return `Added your ${owned.description} to your last fit check.`;
    }
  }
  if (!item) return notThere(fix.name);

  if (fix.action === "fit_not_there") {
    const { removed } = await unlinkItem(db, user.id, outfit.id, item.id);
    return removed
      ? `Removed ${item.description}: it only came from that photo.`
      : `Took ${item.description} off your last fit check.`;
  }

  if (fix.action === "fit_same") {
    const closet = await listItems(user.id);
    const real = await findItemByName(fix.as, closet.filter((i) => i.id !== item.id)).catch(() => undefined);
    if (real && (await mergeItems(db, user.id, item.id, real.id))) {
      return `Fixed: that's your ${real.description}, not something new.`;
    }
    // Not something they own after all: treat it as "it's actually a ...".
  }

  // Relabel. Keep the photo's color in the description if they didn't name one.
  const as = await itemFromName(fix.as).catch(() => undefined);
  if (!as) return `I couldn't tell what "${fix.as}" is. Try naming the kind of item, like "t-shirt".`;
  const named = colorIn(fix.as);
  const description = named || item.color_primary === "unknown" ? as.description : `${item.color_primary} ${as.description.replace(/^(a|an|the) /, "")}`;
  const fixed = await relabelItem(db, user.id, item.id, { ...as, description });
  return fixed ? `Fixed: ${item.description} is now ${fixed.description}.` : notThere(fix.name);
}

/**
 * The item someone means by "the gray sweater": exact name, then any item
 * containing every word they used ("black jeans" matches "black straight-leg
 * jeans"), then the local model for different words for the same thing.
 */
async function findOwned(userId: string, name: string): Promise<Item | undefined> {
  const needle = name.toLowerCase();
  const words = needle.split(/[\s-]+/).filter(Boolean);
  const items = await listItems(userId);
  const item =
    items.find((i) => i.description.toLowerCase() === needle) ??
    items.find((i) => {
      const have = new Set(i.description.toLowerCase().split(/[\s-]+/));
      return words.every((w) => have.has(w));
    });
  return (
    item ??
    (await findItemByName(name, items).catch((err) => {
      console.error("item lookup by name failed", err);
      return undefined;
    }))
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
