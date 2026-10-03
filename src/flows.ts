import { type Action, type ChatKind, route } from "./llm.ts";
import {
  DEFAULT_FIT_CHECK_HOUR,
  type Reminder,
  type User,
  localDate,
  pendingReminders,
  save,
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
  '• "fit check at 8am" or "stop fit checks"',
  '• "my profile" to see your info, "city Detroit" or "call me Sam" to change it',
  "Or send a fit check photo.",
].join("\n");

export function fitCheckPrompt(): string {
  return "Daily fit check: send me a photo of what you're wearing today.";
}

/** Replies for a brand-new user: welcome plus the first onboarding question. */
export function startOnboarding(): string[] {
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

/** Handle a text message from a user, returning the replies to send. */
export async function handleText(user: User, text: string): Promise<string[]> {
  if (user.step === "city") {
    user.city = text.trim();
    user.step = "done";
    await save();
    return [
      `Got it, ${user.city}. You're all set.`,
      `I'll ask for a fit check every day around ${formatHour(user.fitCheckHour ?? DEFAULT_FIT_CHECK_HOUR)}.`,
      HELP,
    ];
  }

  // Reminder numbers refer to the list as it stood when they texted, so
  // "cancel 1 and 2" still means the original 1 and 2 after the first cancel.
  const listed = pendingReminders(user);

  const exact = fastPath(text);
  let actions: Action[];
  if (exact) {
    actions = [exact];
  } else {
    try {
      actions = await route(text, {
        now: new Date(),
        reminders: listed.map((r) => `${r.text} (${formatWhen(r.at)})`),
        items: user.items.map((i) => i.name),
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
      user.reminders.push({ id: crypto.randomUUID(), at: action.at, text: action.text, sent: false });
      await save();
      return [`Okay, I'll remind you about "${action.text}" ${formatWhen(action.at)}.`];
    }

    case "list_reminders": {
      const hour = user.fitCheckHour === undefined ? DEFAULT_FIT_CHECK_HOUR : user.fitCheckHour;
      const lines = [`Daily fit check: ${hour === null ? "off" : formatHour(hour)}`];
      const pending = pendingReminders(user);
      if (pending.length) {
        pending.forEach((r, i) => lines.push(`${i + 1}. ${r.text} (${formatWhen(r.at)})`));
        lines.push('Text "cancel 1" to remove one.');
      } else {
        lines.push("No other reminders.");
      }
      return [lines.join("\n")];
    }

    case "cancel_reminder": {
      const listedTarget = listed[action.number - 1];
      const target = listedTarget && user.reminders.find((r) => r.id === listedTarget.id && !r.sent);
      if (!target) return ["I don't see that reminder. Text \"my reminders\" to see the list."];
      user.reminders = user.reminders.filter((r) => r.id !== target.id);
      await save();
      return [`Cancelled: ${target.text}.`];
    }

    case "set_fit_check_time":
      user.fitCheckHour = action.hour;
      await save();
      return [`Done. I'll ask for your fit check around ${formatHour(action.hour)} each day.`];

    case "stop_fit_checks":
      user.fitCheckHour = null;
      await save();
      return ['Okay, no more daily fit checks. Text "fit check at 8am" to turn them back on.'];

    case "show_wardrobe": {
      const n = user.items.length;
      const summary = n ? `${n} item${n === 1 ? "" : "s"}` : "Nothing yet";
      return [`${summary} in your wardrobe: ${wardrobeUrl(user)}`];
    }

    case "add_items": {
      const now = Date.now();
      for (const item of action.items) {
        user.items.push({ id: crypto.randomUUID(), name: item.name, category: item.category, addedAt: now });
      }
      await save();
      return [`Added ${action.items.map((i) => i.name).join(", ")}.`];
    }

    case "remove_item": {
      // Exact name first, then any item containing every word they used
      // ("black jeans" matches "black straight-leg jeans").
      const needle = action.name.toLowerCase();
      const words = needle.split(/[\s-]+/).filter(Boolean);
      const item =
        user.items.find((i) => i.name.toLowerCase() === needle) ??
        user.items.find((i) => {
          const have = new Set(i.name.toLowerCase().split(/[\s-]+/));
          return words.every((w) => have.has(w));
        });
      if (!item) return [`I couldn't find "${action.name}" in your wardrobe.`];
      user.items = user.items.filter((i) => i.id !== item.id);
      await save();
      return [`Removed ${item.name}.`];
    }

    case "show_profile": {
      const hour = user.fitCheckHour === undefined ? DEFAULT_FIT_CHECK_HOUR : user.fitCheckHour;
      return [
        [
          `Name: ${user.name ?? "not set"}`,
          `City: ${user.city ?? "not set"}`,
          `Daily fit check: ${hour === null ? "off" : formatHour(hour)}`,
          `Wardrobe: ${plural(user.items.length, "item")}, ${plural(user.photos.length, "fit check")}`,
          'Change it with "city Detroit", "call me Sam", or "fit check at 8am".',
        ].join("\n"),
      ];
    }

    case "update_profile": {
      const changes: string[] = [];
      if (action.name) {
        user.name = action.name;
        changes.push(`I'll call you ${action.name}`);
      }
      if (action.city) {
        user.city = action.city;
        changes.push(`your city is now ${action.city}`);
      }
      await save();
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

export async function handlePhoto(user: User, file: string, mimeType: string): Promise<string[]> {
  if (user.step !== "done") return [ASK_CITY];
  user.photos.push({ id: crypto.randomUUID(), file, mimeType, at: Date.now() });
  user.lastFitPhoto = localDate(); // counts as today's fit check, so no ping
  await save();
  return ["Saved your fit check. Auto-detecting the items in it is coming soon."];
}
