import { CATEGORIES, type Category } from "./store.ts";

// A small model turns free-form texts into one structured action. Any
// OpenAI-compatible endpoint works; the default is a local Ollama server.
//   Local (free):  ollama pull qwen2.5:3b
//   Hosted (free tier): LLM_BASE_URL=https://api.groq.com/openai/v1
//                       LLM_MODEL=llama-3.1-8b-instant LLM_API_KEY=...
const BASE_URL = process.env.LLM_BASE_URL ?? "http://localhost:11434/v1";
const MODEL = process.env.LLM_MODEL ?? "qwen2.5:3b";
const API_KEY = process.env.LLM_API_KEY;

export type Action =
  | { action: "add_reminder"; at: number; text: string }
  | { action: "list_reminders" }
  | { action: "cancel_reminder"; number: number }
  | { action: "set_fit_check_time"; hour: number }
  | { action: "stop_fit_checks" }
  | { action: "show_wardrobe" }
  | { action: "add_items"; items: { name: string; category: Category }[] }
  | { action: "remove_item"; name: string }
  | { action: "show_profile" }
  | { action: "update_profile"; city?: string; name?: string }
  | { action: "help" }
  | { action: "chat"; kind: ChatKind };

export const CHAT_KINDS = ["greeting", "thanks", "style", "other"] as const;
export type ChatKind = (typeof CHAT_KINDS)[number];

const SYSTEM = `You route text messages for Second Thought, an iMessage bot that remembers what clothes a user owns.
Reply with ONE JSON object and nothing else: {"actions":[...]}.
Add one action per request in the message, in the order they asked. Most messages have exactly one.
Possible actions:

{"action":"add_reminder","text":"<what to remind them about, in their words>","in_minutes":<number>}   (for "in 20 min", "in 3 hours")
{"action":"add_reminder","text":"<...>","days_from_now":<0 today, 1 tomorrow, 7 next week>,"time":"<HH:MM 24-hour, optional>"}   (for a day and/or clock time)
{"action":"add_reminder","text":"<...>","weekday":"<monday...sunday>","time":"<HH:MM 24-hour, optional>"}   (for a named day like "friday")
{"action":"list_reminders"}   (their reminders or schedule)
{"action":"cancel_reminder","number":<the number of the matching reminder in their list>}
{"action":"set_fit_check_time","hour":<0-23, 24-hour clock>}   (change the daily fit check reminder; "daily reminder" means this)
{"action":"stop_fit_checks"}
{"action":"show_wardrobe"}   (their closet / wardrobe / what they own)
{"action":"add_items","items":[{"name":"<short description>","category":"<${CATEGORIES.join("|")}>"}]}
{"action":"remove_item","name":"<item name exactly as in their items>"}
{"action":"show_profile"}   (their info / profile / settings)
{"action":"update_profile","city":"<new city, optional>","name":"<what to call them, optional>"}   (they moved, or tell you their name)
{"action":"help"}   (they ask what the bot can do)
{"action":"chat","kind":"greeting|thanks|style|other"}   (small talk; "style" = any question about how something looks or what to wear)

Rules:
- Use add_items only when they say they own, bought, or got clothes.
- Do the reminder time math in fields, never by hand: "tonight at 9" is days_from_now 0, time "21:00".
- Questions about how clothes look or what to wear are always chat with kind "style".
- Never repeat an action or add one they didn't ask for.`;

// Few-shot examples, formatted exactly like real requests.
const EX_CONTEXT = "Their reminders: 1. return the green jacket (Sat 1:00 PM); 2. check the zara refund (Mon 9:00 AM)\nTheir items: black jeans, gray crewneck";
const SINGLE_EXAMPLES: [string, object][] = [
  ["remind me tomorrow at 6pm to return the green jacket", { action: "add_reminder", text: "return the green jacket", days_from_now: 1, time: "18:00" }],
  ["ping me in 2 hours about the boots", { action: "add_reminder", text: "the boots", in_minutes: 120 }],
  ["remind me thursday at 3:30pm to ship the hoodie back", { action: "add_reminder", text: "ship the hoodie back", weekday: "thursday", time: "15:30" }],
  ["what's coming up", { action: "list_reminders" }],
  ["forget the zara one", { action: "cancel_reminder", number: 2 }],
  ["make my daily fit check 8pm", { action: "set_fit_check_time", hour: 20 }],
  ["just got white sneakers and a navy hoodie", {
    action: "add_items",
    items: [
      { name: "white sneakers", category: "shoes" },
      { name: "navy hoodie", category: "tops" },
    ],
  }],
  ["donated the gray sweater", { action: "remove_item", name: "gray crewneck" }],
  ["show me my closet", { action: "show_wardrobe" }],
  ["what info do you have on me", { action: "show_profile" }],
  ["I just moved to Chicago", { action: "update_profile", city: "Chicago" }],
  ["my name's Sam btw", { action: "update_profile", name: "Sam" }],
  ["call me Jordan", { action: "update_profile", name: "Jordan" }],
  ["is this a good fit?", { action: "chat", kind: "style" }],
  ["what should I wear to the party", { action: "chat", kind: "style" }],
  ["good morning!", { action: "chat", kind: "greeting" }],
  ["appreciate it", { action: "chat", kind: "thanks" }],
  ["what's the weather like", { action: "chat", kind: "other" }],
];

const CHAINED_EXAMPLES: [string, object[]][] = [
  ["got a black puffer, remind me friday to return the green jacket", [
    { action: "add_items", items: [{ name: "black puffer", category: "outerwear" }] },
    { action: "add_reminder", text: "return the green jacket", weekday: "friday" },
  ]],
  ["cancel both reminders and stop the fit checks", [
    { action: "cancel_reminder", number: 1 },
    { action: "cancel_reminder", number: 2 },
    { action: "stop_fit_checks" },
  ]],
];

const EXAMPLES: [string, object[]][] = [
  ...SINGLE_EXAMPLES.map(([text, action]): [string, object[]] => [text, [action]]),
  ...CHAINED_EXAMPLES,
];

export interface Context {
  now: Date;
  reminders: string[]; // pending reminders, in list order
  items: string[];
}

// Cap so a confused model can't fire off a pile of actions from one text.
const MAX_ACTIONS = 5;

export async function route(text: string, ctx: Context): Promise<Action[]> {
  const context = [
    `Their reminders: ${ctx.reminders.length ? ctx.reminders.map((r, i) => `${i + 1}. ${r}`).join("; ") : "none"}`,
    `Their items: ${ctx.items.length ? ctx.items.join(", ") : "none"}`,
  ].join("\n");

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        ...EXAMPLES.flatMap(([user, actions]) => [
          { role: "user", content: `${EX_CONTEXT}\n\nMessage: ${user}` },
          { role: "assistant", content: JSON.stringify({ actions }) },
        ]),
        { role: "user", content: `${context}\n\nMessage: ${text}` },
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);

  const body = (await res.json()) as { choices: { message: { content: string } }[] };
  const content = body.choices[0]?.message.content ?? "";
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {}
  // Accept a bare action too, in case the model forgets the wrapper.
  const raws: unknown[] = Array.isArray(parsed?.actions) ? parsed.actions : parsed?.action ? [parsed] : [];

  const actions: Action[] = [];
  const seen = new Set<string>();
  for (const raw of raws) {
    const action = validate(raw, ctx.now);
    const key = JSON.stringify(action);
    if (!action || seen.has(key)) continue; // drop invalid and duplicate actions
    seen.add(key);
    actions.push(action);
  }
  if (actions.length < raws.length || !actions.length) {
    console.warn(`LLM gave unusable actions for ${JSON.stringify(text)}: ${content}`);
  }
  return actions.slice(0, MAX_ACTIONS);
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// Turn the model's reminder fields into a timestamp. The model only extracts
// "in N minutes" or "day + clock time"; the arithmetic happens here.
function reminderTime(raw: any, now: Date, num: (v: unknown) => number): number | undefined {
  const minutes = num(raw.in_minutes);
  if (minutes > 0) return now.getTime() + Math.round(minutes * 60_000);

  const weekday = WEEKDAYS.indexOf(String(raw.weekday ?? "").toLowerCase());
  const days =
    weekday >= 0
      ? (weekday - now.getDay() + 7) % 7
      : raw.days_from_now === undefined
        ? 0
        : num(raw.days_from_now);
  const time = typeof raw.time === "string" ? /^(\d{1,2}):(\d{2})$/.exec(raw.time.trim()) : null;
  if (!Number.isInteger(days) || days < 0) return undefined;

  const at = new Date(now);
  at.setDate(at.getDate() + days);
  if (time) {
    const [h, m] = [Number(time[1]), Number(time[2])];
    if (h > 23 || m > 59) return undefined;
    at.setHours(h, m, 0, 0);
  } else if (days > 0 || weekday >= 0) {
    at.setHours(9, 0, 0, 0); // "remind me friday" means Friday morning, not this exact minute
  }
  // Already passed: "friday" said on a Friday evening means next week,
  // "at 9" said at 10pm means tomorrow.
  if (at <= now) {
    if (weekday >= 0) at.setDate(at.getDate() + 7);
    else if (time && days === 0) at.setDate(at.getDate() + 1);
    else return undefined;
  }
  return at.getTime();
}

// Small models drift from the schema, so check every field before acting.
function validate(raw: any, now: Date): Action | undefined {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v));
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

  switch (raw?.action) {
    case "add_reminder": {
      const at = reminderTime(raw, now, num);
      const text = str(raw.text);
      return at && text ? { action: "add_reminder", at, text } : undefined;
    }
    case "cancel_reminder": {
      const n = num(raw.number);
      return Number.isInteger(n) && n > 0 ? { action: "cancel_reminder", number: n } : undefined;
    }
    case "set_fit_check_time": {
      const hour = num(raw.hour);
      return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? { action: "set_fit_check_time", hour } : undefined;
    }
    case "add_items": {
      if (!Array.isArray(raw.items)) return undefined;
      const items = raw.items
        .map((i: any) => ({
          name: str(i?.name),
          category: CATEGORIES.includes(i?.category) ? (i.category as Category) : "other",
        }))
        .filter((i: { name?: string }) => i.name) as { name: string; category: Category }[];
      return items.length ? { action: "add_items", items } : undefined;
    }
    case "remove_item": {
      const name = str(raw.name);
      return name ? { action: "remove_item", name } : undefined;
    }
    case "update_profile": {
      const city = str(raw.city);
      const name = str(raw.name);
      if (!city && !name) return undefined;
      return { action: "update_profile", ...(city && { city }), ...(name && { name }) };
    }
    case "chat":
      return { action: "chat", kind: CHAT_KINDS.includes(raw.kind) ? raw.kind : "other" };
    case "list_reminders":
    case "stop_fit_checks":
    case "show_wardrobe":
    case "show_profile":
    case "help":
      return { action: raw.action };
    default:
      return undefined;
  }
}
