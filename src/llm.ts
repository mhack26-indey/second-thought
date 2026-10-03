import { z } from "zod";
import { ITEM_TYPES, type ItemType } from "./closet/categories.ts";
import { type ExtractedItem, withCategory } from "./closet/extract.ts";

// A small model turns free-form texts into one structured action. Any
// OpenAI-compatible endpoint works; the default is a local Ollama server.
//   Local (free):  ollama pull qwen2.5:7b
//   Hosted (free tier): LLM_BASE_URL=https://api.groq.com/openai/v1
//                       LLM_MODEL=llama-3.1-8b-instant LLM_API_KEY=...
const BASE_URL = process.env.LLM_BASE_URL ?? "http://localhost:11434/v1";
// 7B, not 3B: the 3B model passed the eval too, but it was fragile: small
// prompt changes broke other cases, and some phrasings sent it into a
// runaway generation. 7B is ~1.5s a text on an M-series Mac.
const MODEL = process.env.LLM_MODEL ?? "qwen2.5:7b";
const API_KEY = process.env.LLM_API_KEY;

/**
 * Loads the model and pins it in memory. Ollama unloads idle models after 5
 * minutes, which made the first text after a quiet stretch take ~11s.
 * No-op for hosted APIs.
 */
export async function warmUp(): Promise<void> {
  if (!BASE_URL.includes(":11434")) return;
  try {
    const res = await fetch(`${BASE_URL.replace(/\/v1\/?$/, "")}/api/generate`, {
      method: "POST",
      body: JSON.stringify({ model: MODEL, keep_alive: -1 }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  } catch (err) {
    console.warn(`Couldn't load ${MODEL} in Ollama (is it running and pulled?):`, err instanceof Error ? err.message : err);
  }
}

export type Action =
  | { action: "add_reminder"; at: number; text: string }
  | { action: "list_reminders" }
  | { action: "cancel_reminder"; number: number }
  | { action: "set_fit_check_time"; hour: number }
  | { action: "stop_fit_checks" }
  | { action: "show_wardrobe" }
  | { action: "add_items"; items: ExtractedItem[] }
  | { action: "remove_item"; name: string }
  | { action: "set_location"; name: string; location: string }
  | { action: "find_item"; name: string }
  | { action: "worth_buying" }
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
{"action":"add_items","items":[{"type":"<kind of item>","color":"<if they said>","pattern":"<if they said>","fit":"<if they said>","description":"<the item in their words>"}]}
{"action":"remove_item","name":"<item exactly as written in their items>"}
{"action":"set_location","name":"<the item, as written in their items if it's there>","location":"<where they put it, in their words>"}   (they say where they keep or put something)
{"action":"find_item","name":"<the item, as written in their items if it's there>"}   (they ask where something is)
{"action":"worth_buying"}   (they ask what they should buy, get next, or are missing)
{"action":"show_profile"}   (their info / profile / settings)
{"action":"update_profile","city":"<new city, optional>","name":"<what to call them, optional>"}   (they moved, or tell you their name)
{"action":"help"}   (they ask what the bot can do)
{"action":"chat","kind":"greeting|thanks|style|other"}   (small talk; "style" = any question about how something looks or what to wear)

Rules:
- Use add_items only when they say they own, bought, or got clothes. Leave out color, pattern, or fit if they didn't say it. Include every item they mention, even ones already in their items (duplicates are handled later).
- "type" is the kind of item in a word or two: jeans, hoodie, sneakers, blazer, earrings...
- Do the reminder time math in fields, never by hand: "tonight at 9" is days_from_now 0, time "21:00".
- Questions about how clothes look or what to wear are always chat with kind "style". Questions about what to buy are worth_buying.
- Never repeat an action or add one they didn't ask for.`;

// Few-shot examples, formatted exactly like real requests.
const EX_CONTEXT = "Their reminders: 1. return the green jacket (Sat 1:00 PM); 2. check the zara refund (Mon 9:00 AM)\nTheir items: black jeans, gray crewneck";
const SINGLE_EXAMPLES: [string, object][] = [
  ["remind me tomorrow at 6pm to return the green jacket", { action: "add_reminder", text: "return the green jacket", days_from_now: 1, time: "18:00" }],
  ["ping me in 2 hours about the boots", { action: "add_reminder", text: "the boots", in_minutes: 120 }],
  ["remind me next week to sell the old sneakers", { action: "add_reminder", text: "sell the old sneakers", days_from_now: 7 }],
  ["remind me thursday at 3:30pm to ship the hoodie back", { action: "add_reminder", text: "ship the hoodie back", weekday: "thursday", time: "15:30" }],
  ["what's coming up", { action: "list_reminders" }],
  ["forget the zara one", { action: "cancel_reminder", number: 2 }],
  ["nvm about the green jacket, delete that reminder", { action: "cancel_reminder", number: 1 }],
  ["make my daily fit check 8pm", { action: "set_fit_check_time", hour: 20 }],
  ["just got white sneakers and a navy hoodie", {
    action: "add_items",
    items: [
      { type: "sneakers", color: "white", description: "white sneakers" },
      { type: "hoodie", color: "navy", description: "navy hoodie" },
    ],
  }],
  ["picked up a plaid flannel and a beanie", {
    action: "add_items",
    items: [
      { type: "flannel", pattern: "plaid", description: "plaid flannel" },
      { type: "beanie", description: "beanie" },
    ],
  }],
  ["bought another gray crewneck and a red beanie", {
    action: "add_items",
    items: [
      { type: "crewneck", color: "gray", description: "gray crewneck" },
      { type: "beanie", color: "red", description: "red beanie" },
    ],
  }],
  ["donated the gray sweater", { action: "remove_item", name: "gray crewneck" }],
  ["show me my closet", { action: "show_wardrobe" }],
  ["put my winter jacket in the under-bed bin", { action: "set_location", name: "winter jacket", location: "under-bed bin" }],
  ["the gray crewneck is at my mom's", { action: "set_location", name: "gray crewneck", location: "my mom's" }],
  ["where's my winter jacket", { action: "find_item", name: "winter jacket" }],
  ["where did I put the black jeans?", { action: "find_item", name: "black jeans" }],
  ["what should I actually buy?", { action: "worth_buying" }],
  ["what am I missing in my closet", { action: "worth_buying" }],
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
    { action: "add_items", items: [{ type: "puffer", color: "black", description: "black puffer" }] },
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
      // Bounds a runaway generation (a constrained model can loop on whitespace)
      // so it fails fast instead of hitting the timeout. Five actions fit easily.
      max_tokens: 600,
      // A schema (not just "json_object") makes Ollama constrain generation to
      // one "actions" array; with plain JSON mode the 3B model sometimes wrote
      // the "actions" key twice and the parse kept only the broken second one.
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "actions",
          strict: false,
          schema: {
            type: "object",
            properties: { actions: { type: "array", items: { type: "object" } } },
            required: ["actions"],
          },
        },
      },
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

// Common words people use that aren't in the closet module's type list.
const TYPE_SYNONYMS: Record<string, ItemType> = {
  tee: "t-shirt",
  tshirt: "t-shirt",
  shirt: "t-shirt",
  sweatshirt: "crewneck",
  trainers: "sneakers",
  cargos: "pants",
  chinos: "pants",
  trousers: "pants",
  joggers: "sweatpants",
  cargo: "pants",
  parka: "coat",
  "button down": "button-up shirt",
  "button-down": "button-up shirt",
  flannel: "button-up shirt",
  hoops: "earrings",
  studs: "earrings",
  beanie: "hat",
  cap: "hat",
  tote: "bag",
  backpack: "bag",
};

const COLORS = new Set(
  ("black white gray grey charcoal navy blue light-blue red burgundy maroon green olive sage teal " +
    "brown tan beige cream ivory khaki camel pink purple lavender yellow mustard orange gold silver " +
    "denim multicolor").split(" "),
);
const PATTERNS = new Set("solid striped graphic plaid floral camo colorblock checkered polka-dot houndstooth".split(" "));

// Longest first, so "denim jacket" wins over "jacket" and "button down" over "down".
const KNOWN_WORDS: [string, ItemType][] = [
  ...ITEM_TYPES.map((t): [string, ItemType] => [t, t]),
  ...(Object.entries(TYPE_SYNONYMS) as [string, ItemType][]),
].sort((a, b) => b[0].length - a[0].length);

/**
 * Maps the model's free-form type ("button down", "beanie") to one of the
 * closet module's types, checking their description first, then the type it gave.
 * Picking from 45 types in the prompt made the small model worse at everything.
 */
function resolveType(type: unknown, description: string): ItemType | undefined {
  // Their own words first: the model sometimes relabels ("gray crewneck" as hoodie).
  for (const text of [description, String(type ?? "")]) {
    const padded = ` ${text.toLowerCase().trim()} `;
    const hit = KNOWN_WORDS.find(([word]) => padded.includes(` ${word} `) || padded.includes(` ${word}s `));
    if (hit) return hit[1];
  }
  return undefined;
}

// A texted item fills the closet module's required fields with what the user
// said; anything they didn't mention is "unknown" for matching to skip.
function toItem(raw: any): ExtractedItem | undefined {
  const field = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().toLowerCase() : undefined);
  const description = field(raw?.description);
  if (!description) return undefined;
  const type = resolveType(raw?.type, description);
  if (!type) return undefined;
  const season = field(raw?.season);
  // Small models put any adjective in "color" ("rain jacket" -> "rain"); keep
  // real colors, and move a pattern word to pattern.
  const color = field(raw?.color);
  const pattern = field(raw?.pattern) ?? (color && PATTERNS.has(color) ? color : undefined);
  return withCategory({
    type,
    color_primary: color && COLORS.has(color) ? color : "unknown",
    color_secondary: null,
    pattern: pattern ?? "unknown",
    fit: field(raw?.fit) ?? "unknown",
    season: season === "warm" || season === "cold" ? season : "all",
    description,
  });
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
      const items = raw.items.map(toItem).filter((i: ExtractedItem | undefined) => i) as ExtractedItem[];
      return items.length ? { action: "add_items", items } : undefined;
    }
    case "remove_item": {
      const name = str(raw.name);
      return name ? { action: "remove_item", name } : undefined;
    }
    case "set_location": {
      const name = str(raw.name);
      const location = str(raw.location);
      return name && location ? { action: "set_location", name, location } : undefined;
    }
    case "find_item": {
      const name = str(raw.name);
      return name ? { action: "find_item", name } : undefined;
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
    case "worth_buying":
    case "help":
      return { action: raw.action };
    default:
      return undefined;
  }
}

/**
 * One prompt in, schema-checked JSON out, on the same local model. Used for
 * text-only judgments (is this the same item?) so they don't spend the
 * vision model's small daily quota.
 */
export async function llmJson<T extends z.ZodType>(schema: T, prompt: string): Promise<z.infer<T>> {
  const { $schema: _, ...jsonSchema } = z.toJSONSchema(schema);
  let problem = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 800,
        response_format: { type: "json_schema", json_schema: { name: "answer", strict: true, schema: jsonSchema } },
        messages: [{ role: "user", content: prompt }],
      }),
      // Runs in the background after a fit check, so it can take its time; a
      // first batch of new color names takes ~15s on an M-series Mac.
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { choices: { message: { content: string } }[] };
    try {
      const parsed = schema.safeParse(JSON.parse(body.choices[0]?.message.content ?? ""));
      if (parsed.success) return parsed.data;
      problem = parsed.error.message;
    } catch {
      problem = "invalid JSON";
    }
  }
  throw new Error(`LLM output failed twice: ${problem}`);
}
