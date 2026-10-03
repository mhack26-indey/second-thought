import { type Action, type ChatKind, route } from "./llm.ts";
import { type ExtractedItem, extractItems } from "./closet/extract.ts";
import { type ImageInput, type MediaType, visionEnabled } from "./closet/vlm.ts";
import { exactGroups, findItemByName, llmGroups } from "./match.ts";
import { WINDOW_DAYS, worthBuying } from "./gaps.ts";
import {
  type Item,
  type Reminder,
  type User,
  addFitCheck,
  addReminder,
  addTextItems,
  ingestFitCheck,
  cancelReminder,
  listItems,
  listOutfits,
  localDate,
  pendingReminders,
  removeItem,
  setLocation,
  wornLately,
  updateUser,
} from "./store.ts";
import { wardrobeUrl } from "./web.ts";

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
  return `${day} ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
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
  '• "fit check at 8am" or "stop fit checks"',
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
  if (/^(hi|hey|hello|yo|sup)$/.test(t)) return { action: "chat", kind: "greeting" };
  const cancel = /^cancel (?:reminder )?#?(\d+)$/.exec(t);
  if (cancel) return { action: "cancel_reminder", number: Number(cancel[1]) };
  if (/^(my )?(profile|info|settings)$/.test(t)) return { action: "show_profile" };
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

/** "I'm in Ann Arbor!" -> "Ann Arbor": the onboarding answer, minus the sentence around it. */
export function cityFrom(text: string): string {
  const city = text
    .trim()
    .replace(/[.!]+$/, "")
    .replace(/^(?:(?:i'?m|i am|im|we'?re|we are)\s+)?(?:(?:currently|living|based|located|staying)\s+)?(?:in|at|from)\s+/i, "")
    .replace(/^(?:i|we)\s+live\s+in\s+/i, "")
    .replace(/^(?:it'?s|its)\s+/i, "")
    .trim();
  return city || text.trim();
}

/** Handle a text message from a user, returning the replies to send. */
export async function handleText(user: User, text: string): Promise<string[]> {
  if (user.step === "city") {
    const city = cityFrom(text);
    await updateUser(user.id, { city, step: "done" });
    const hour = user.fitCheckHour;
    const done = [
      `Got it, ${city}. You're all set.`,
      hour === null ? "Daily fit checks are off." : `I'll ask for a fit check every day around ${formatHour(hour)}.`,
    ].join(" ");
    const first = firstRequests.get(user.id);
    if (first === undefined) return [done, HELP];
    firstRequests.delete(user.id);
    return [done, ...(await handleText({ ...user, city, step: "done" }, first))];
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
      actions = await route(text, {
        now: new Date(),
        reminders: listed.map((r) => `${r.text} (${formatWhen(r.at)})`),
        items: (await listItems(user.id)).map((i) => i.description),
      });
    } catch (err) {
      console.error("LLM routing failed:", err instanceof Error ? err.message : err);
      return [EXACT_COMMANDS];
    }
  }
  if (!actions.length) return ["I didn't catch that.", HELP];

  const replies: string[] = [];
  for (const action of actions) replies.push(...(await runAction(user, action, listed)));
  // Several actions answer in one message instead of a burst of texts.
  return actions.length > 1 ? [replies.join("\n")] : replies;
}

async function runAction(user: User, action: Action, listed: Reminder[]): Promise<string[]> {
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
      await removeItem(user.id, item.id);
      return [`Removed ${item.description}.`];
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
        return [`I don't know where your ${item.description} is. Next time, text me something like "${item.description} is in the hall closet".`];
      }
      const since = item.location_set_at ? `, since ${fmtDay(item.location_set_at)}` : "";
      return [`Your ${item.description}: ${item.location}${since}.`];
    }

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
      const changes: string[] = [];
      if (action.name) {
        user.name = action.name;
        changes.push(`I'll call you ${action.name}`);
      }
      if (action.city) {
        user.city = action.city;
        changes.push(`your city is now ${action.city}`);
      }
      await updateUser(user.id, { name: user.name, city: user.city });
      const sentence = changes.join(" and ");
      return [`Got it, ${sentence}.`];
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

export interface PhotoReply {
  replies: string[]; // send now
  later?: () => Promise<string[]>; // slow work (the vision model); send when it's done
}

const VISION_TYPES = new Set<string>(["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif"]);

export async function handlePhoto(user: User, image: Buffer, mimeType: string): Promise<PhotoReply> {
  if (user.step !== "done") return { replies: [ASK_CITY] };
  const outfit = await addFitCheck(user.id, image, mimeType);
  await updateUser(user.id, { lastFitPhoto: localDate() }); // counts as today's fit check, so no ping
  if (!visionEnabled() || !VISION_TYPES.has(mimeType)) return { replies: ["Saved your fit check."] };

  return {
    replies: ["Saved your fit check. Checking what you're wearing..."],
    later: () => detectItems(user.id, outfit, { base64: image.toString("base64"), mediaType: mimeType as MediaType }),
  };
}

async function detectItems(
  userId: string,
  outfit: { id: number; photoUrl: string },
  image: ImageInput,
): Promise<string[]> {
  // The photo is already saved, so a vision failure only costs the item list.
  let seen: ExtractedItem[];
  try {
    seen = await extractItems(image);
  } catch (err) {
    console.error(`item extraction failed for outfit ${outfit.id}`, err);
    return ["I couldn't make out the items in that one, but the photo is saved."];
  }
  if (!seen.length) return ["I couldn't spot any clothes in that photo."];

  const { worn, added } = await oneAtATime(userId, () => ingestFitCheck(userId, outfit, seen));
  const lines: string[] = [];
  if (worn.length) lines.push(`Wearing: ${worn.map(itemName).join(", ")}.`);
  if (added.length) lines.push(`New to your closet: ${added.map(itemName).join(", ")}.`);
  return [lines.join(" ")];
}

// Two photos sent back to back extract in parallel, but their ingests run in
// order; otherwise both could add the same new jacket.
const userQueues = new Map<string, Promise<unknown>>();
function oneAtATime<T>(userId: string, work: () => Promise<T>): Promise<T> {
  const run = (userQueues.get(userId) ?? Promise.resolve()).then(work, work);
  const tail = run.catch(() => {});
  userQueues.set(userId, tail);
  void tail.then(() => {
    if (userQueues.get(userId) === tail) userQueues.delete(userId);
  });
  return run;
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

/** "black jeans"; skips colors a texted item never mentioned. */
function itemName(item: Item): string {
  return item.color_primary === "unknown" ? item.type : `${item.color_primary} ${item.type}`;
}
