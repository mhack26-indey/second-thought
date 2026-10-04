import { z } from "zod";
import type { Item } from "./closet/repo.ts";
import type { Db } from "./db/client.ts";
import { worthBuyingResult } from "./gaps.ts";
import { llmJson } from "./llm.ts";
import type { Groups } from "./match.ts";

// Profile details that make suggestions fit: first name, age range, what
// their week looks like, and sizes. Asked once in onboarding (all optional),
// editable on the wardrobe page and by text. The text model only reads a
// free-form answer into fields; code checks every value, and every
// recommendation is still computed from their own wears. Missing fields
// change nothing.
//
// Privacy: an age range only, never an age or birthdate; "under 18" is stored
// as null (and not asked again).

export const AGE_RANGES = ["18-24", "25-34", "35+"] as const;
export type AgeRange = (typeof AGE_RANGES)[number];
export const OCCASIONS = ["class", "office", "gym", "going out", "formal events", "outdoors", "working from home", "sports"] as const;
export type Occasion = (typeof OCCASIONS)[number];

export interface Profile {
  name: string | null;
  ageRange: AgeRange | null;
  occasions: Occasion[] | null;
  sizeTop: string | null;
  sizeBottom: string | null;
  sizeShoe: string | null;
}
export type ProfilePatch = Partial<Profile>;
export type Field = "name" | "age_range" | "occasions" | "size_top" | "size_bottom" | "size_shoe";

export const PROFILE_QUESTION =
  "Quick ones so my suggestions fit you (reply skip for any): your first name, your age range (under 18, 18–24, 25–34, 35+), what your week usually looks like (class, office, gym, going out…), and your sizes (tops, bottoms, shoes).";

const FIELD_NAMES: Record<Field, string> = {
  name: "first name",
  age_range: "age range (under 18, 18–24, 25–34, 35+)",
  occasions: "what your week looks like (class, office, gym, going out…)",
  size_top: "top size",
  size_bottom: "bottom size",
  size_shoe: "shoe size",
};

/** After an answer: one more ask for unclear fields, the first time only; otherwise done. */
export function nextProfileStep(step: "profile" | "profile_again", unclear: Field[]): "profile_again" | "done" {
  return step === "profile" && unclear.length ? "profile_again" : "done";
}

/** The one follow-up, for answers that came back unclear. */
export function reaskQuestion(fields: Field[]): string {
  const names = fields.map((f) => FIELD_NAMES[f]);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `I didn't quite catch your ${list}. Want to try again? (or skip)`;
}

const STATUS = z.enum(["given", "skipped", "not_mentioned", "unclear"]);
const ProfileAnswer = z.object({
  name: z.object({ status: STATUS, value: z.string().nullable() }),
  age_range: z.object({ status: STATUS, value: z.enum(["under 18", ...AGE_RANGES]).nullable() }),
  occasions: z.object({ status: STATUS, value: z.array(z.enum(OCCASIONS)) }),
  size_top: z.object({ status: STATUS, value: z.string().nullable() }),
  size_bottom: z.object({ status: STATUS, value: z.string().nullable() }),
  size_shoe: z.object({ status: STATUS, value: z.string().nullable() }),
});
export type ProfileAnswer = z.infer<typeof ProfileAnswer>;
export type ReadProfile = (text: string) => Promise<ProfileAnswer>;

const prompt = (text: string) => `Someone was asked: "${PROFILE_QUESTION}"
They replied: "${text.replace(/"/g, "'")}"

For each field, give status and value:
- given: they clearly answered it. skipped: they said skip, pass, no, or "rather not" for it (a reply of just "skip" skips everything). not_mentioned: the reply doesn't touch it. unclear: they tried, but it can't be read as a real answer (a size of "big", an age of "old enough").
- name: their first name only, as written.
- age_range: one of under 18, 18-24, 25-34, 35+. Map an exact age to its range (17 -> under 18, 22 -> 18-24, 40 -> 35+). Never output the exact age.
- occasions: what their week has, from this list only: ${OCCASIONS.join(", ")}. "work" or "job" at a desk is office; "school", "uni" or "lectures" is class; "parties", "bars" or "nights out" is going out; "hiking" is outdoors; "remote" or "WFH" is working from home; a team or league is sports. Empty list unless given.
- size_top, size_bottom, size_shoe: the size as written ("M", "32x30", "10.5"). A single size with no garment named ("I'm a medium") is size_top.
Use value null (or [] for occasions) unless the status is given.`;

export const readProfileWithModel: ReadProfile = (text) => llmJson(ProfileAnswer, prompt(text));

const SKIP_ALL = /^(?:skip|skip (?:it|all|them|everything)|pass|no thanks|no|nah|rather not|none|n\/a)$/;

const cleanName = (s: string) => {
  const first = s.trim().split(/\s+/)[0]!.replace(/[^\p{L}'-]/gu, "");
  return first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase().slice(0, 30) : null;
};
// A size is a letter size ("M", "small") or a number, maybe with a length or
// a half ("32x30", "10.5"); "big" or "normal" isn't one. The size is pulled out
// of whatever came back, so "size 10 shoes" or a stray "goes_9.5" still reads.
const WORD_SIZES: Record<string, string> = { small: "S", medium: "M", large: "L", "extra small": "XS", "extra large": "XL" };
const SIZE_TOKEN = /(?:^|[^a-z0-9])((?:xxs|xs|s|m|l|xl|xxl|xxxl|\dxl)(?![a-z])|\d{1,2}(?:\.5)?(?:\s?[x/]\s?\d{2})?)(?![0-9])/i;
const cleanSize = (s: string) => {
  const v = s.trim().toLowerCase();
  const word = Object.keys(WORD_SIZES).sort((a, b) => b.length - a.length).find((w) => v.includes(w));
  if (word) return WORD_SIZES[word]!;
  if (/^(one size|os)$/.test(v)) return "One size";
  const token = SIZE_TOKEN.exec(v)?.[1];
  if (!token) return null;
  return /\d/.test(token) ? token.replace(/\s/g, "") : token.toUpperCase();
};

export interface ParsedProfile {
  patch: ProfilePatch; // only fields they actually answered
  unclear: Field[]; // worth one more ask
  under18: boolean; // said under 18: nothing stored for age
}

/**
 * A free-form answer, read into fields. "skip" alone needs no model. Values
 * the model returns are checked here; one that doesn't hold up counts as
 * unclear.
 */
export async function parseProfile(text: string, read: ReadProfile = readProfileWithModel): Promise<ParsedProfile> {
  const t = text.trim().toLowerCase().replace(/[.!]+$/, "");
  if (SKIP_ALL.test(t)) return { patch: {}, unclear: [], under18: false };
  const a = await read(text);
  const patch: ProfilePatch = {};
  const unclear: Field[] = [];
  let under18 = false;
  const given = <K extends Field>(f: K) => a[f].status === "given";
  const flag = (f: Field) => a[f].status === "unclear" && unclear.push(f);

  if (given("name")) {
    const name = a.name.value ? cleanName(a.name.value) : null;
    name ? (patch.name = name) : unclear.push("name");
  } else flag("name");

  if (given("age_range")) {
    if (a.age_range.value === "under 18") {
      under18 = true;
      patch.ageRange = null; // never stored as under 18; clears anything there
    }
    else if (a.age_range.value) patch.ageRange = a.age_range.value;
    else unclear.push("age_range");
  } else flag("age_range");

  if (given("occasions")) {
    const occasions = [...new Set(a.occasions.value)];
    occasions.length ? (patch.occasions = occasions) : unclear.push("occasions");
  } else flag("occasions");

  for (const [field, key] of [["size_top", "sizeTop"], ["size_bottom", "sizeBottom"], ["size_shoe", "sizeShoe"]] as const) {
    if (given(field)) {
      const size = a[field].value ? cleanSize(a[field].value!) : null;
      size ? (patch[key] = size) : unclear.push(field);
    } else flag(field);
  }
  return { patch, unclear, under18 };
}

/** Sizes and age ranges said plainly ("my shoe size is 10"), with no model call. */
export function quickProfileEdit(text: string): { patch: ProfilePatch; under18: boolean } | undefined {
  const t = text.trim().toLowerCase().replace(/[.!]+$/, "").replace(/\s+/g, " ");
  // "my shoe size is 10", "top size M"; or "I wear a size 32 in pants".
  const named = /^(?:my )?(shoe|top|shirt|bottom|pants?|jeans|waist) size(?: is|'s|:)? (?:now )?(.{1,12})$/.exec(t);
  const worn = /^i (?:wear|am|'m) (?:a )?size (\S{1,8}) (?:in )?(shoes?|tops?|shirts?|pants|jeans|bottoms?)$/.exec(t);
  const [what, raw] = named ? [named[1]!, named[2]!] : worn ? [worn[2]!, worn[1]!] : [];
  if (what && raw) {
    const value = cleanSize(raw);
    if (!value) return undefined;
    const key = what.startsWith("shoe") ? "sizeShoe" : /^(top|shirt)/.test(what) ? "sizeTop" : "sizeBottom";
    return { patch: { [key]: value }, under18: false };
  }
  const age = /^(?:my age(?: range)? is |i'?m |i am )(\d{1,2})(?: years old)?$/.exec(t);
  if (age) {
    const n = Number(age[1]);
    if (n < 18) return { patch: { ageRange: null }, under18: true };
    return { patch: { ageRange: n <= 24 ? "18-24" : n <= 34 ? "25-34" : "35+" }, under18: false };
  }
  return undefined;
}

/** What got saved, in a short confirmation. */
export function describePatch(patch: ProfilePatch): string {
  const parts: string[] = [];
  if (patch.name) parts.push(`name ${patch.name}`);
  if (patch.ageRange) parts.push(`age range ${patch.ageRange.replace("-", "–")}`);
  if (patch.occasions?.length) parts.push(`your week: ${patch.occasions.join(", ")}`);
  if (patch.sizeTop) parts.push(`top size ${patch.sizeTop}`);
  if (patch.sizeBottom) parts.push(`bottom size ${patch.sizeBottom}`);
  if (patch.sizeShoe) parts.push(`shoe size ${patch.sizeShoe}`);
  return parts.join(", ");
}

// ---- how recommendations use it ----

/** The size for an item's category, if they gave one. */
export function sizeFor(category: string, p: Pick<Profile, "sizeTop" | "sizeBottom" | "sizeShoe"> | null | undefined): string | null {
  if (!p) return null;
  if (category === "shoes") return p.sizeShoe;
  if (category === "bottom") return p.sizeBottom;
  if (category === "top" || category === "outerwear" || category === "dress") return p.sizeTop;
  return null;
}

/**
 * A search query that finds things in their size. Depop's and eBay's size
 * filters use per-category ids that a URL can't name reliably, so the size
 * goes in the search text, which both sites match.
 */
export function sizedQuery(description: string, category: string, p: Pick<Profile, "sizeTop" | "sizeBottom" | "sizeShoe"> | null | undefined): string {
  const size = sizeFor(category, p);
  return size ? `${description} size ${size}` : description;
}

/**
 * Budget framing by age range: secondhand first for younger ranges. Never
 * changes what's suggested, only how to buy it. Null when unknown.
 */
export function budgetLine(ageRange: AgeRange | null | undefined): string | null {
  if (ageRange === "18-24") return "Check secondhand first: Depop or a thrift store usually has one for under $20.";
  if (ageRange === "25-34") return "Secondhand first, or one well-made new piece that lasts.";
  if (ageRange === "35+") return "One well-made piece will outlast three cheap ones; secondhand is worth a look too.";
  return null;
}

// Office-appropriate types, by slot (an approximation from type; the
// description breaks ties for sweatpants and the like).
const OFFICE: Record<string, Set<string>> = {
  top: new Set(["button-up shirt", "blouse", "polo", "sweater", "cardigan"]),
  bottom: new Set(["pants", "skirt"]),
  shoes: new Set(["loafers", "flats", "heels", "boots"]),
};
const OFFICE_EXTRA = new Set(["blazer", "dress"]);
const isOffice = (i: Item) => (OFFICE[i.category]?.has(i.type) ?? false) || OFFICE_EXTRA.has(i.type);
// Athletic shoes by use, or by a sports brand: a pair of Nikes may be lifestyle
// sneakers, but suggesting gym shoes to someone who might own them is worse.
const ATHLETIC = /\b(run|running|athletic|training|trainers?|gym|sport|tennis|basketball|cross[- ]?train|nike|adidas|asics|new balance|puma|reebok|under armour|brooks|hoka|saucony|on cloud)/i;
const isAthleticShoe = (i: Item) => i.category === "shoes" && i.type === "sneakers" && ATHLETIC.test(i.description);
const DRESSY = new Set(["blazer", "dress", "heels", "loafers", "button-up shirt"]);
const SLOT_EXAMPLES: Record<string, string> = { top: "a button-up or knit polo", bottom: "chinos or trousers", shoes: "loafers or leather boots" };
const OFFICE_SEARCH: Record<"top" | "bottom" | "shoes", string> = { top: "button up shirt", bottom: "chinos", shoes: "loafers" };

/** A note, and what to search secondhand for if it suggests buying something. */
interface Advice {
  text: string;
  search?: { category: string; query: string };
}
const where = (i: Item) => (i.location ? ` (it's in the ${i.location})` : "");

/**
 * What their week needs that their closet doesn't cover, checked against
 * everything they own first (storage included), so it never suggests buying
 * something they have. `owned` is the closet; `worn` is what they've worn
 * lately. Empty without occasions.
 */
export function occasionAdvice(occasions: Occasion[] | null | undefined, owned: Item[], worn: Item[]): Advice[] {
  if (!occasions?.length) return [];
  const notes: Advice[] = [];
  const wornIds = new Set(worn.map((i) => i.id));

  if (occasions.includes("gym")) {
    const shoes = owned.filter(isAthleticShoe);
    if (!shoes.length) {
      notes.push({
        text: "You go to the gym, but I don't see athletic shoes in your closet. A pair of training shoes is the one thing to get for that.",
        search: { category: "shoes", query: "training shoes" },
      });
    } else if (!shoes.some((s) => wornIds.has(s.id))) notes.push({ text: `For the gym you already have your ${shoes[0]!.description}${where(shoes[0]!)}.` });
  }

  if (occasions.includes("office")) {
    const wornOffice = worn.filter(isOffice);
    if (wornOffice.length < 3) {
      const unworn = owned.filter((i) => isOffice(i) && !wornIds.has(i.id));
      if (unworn.length >= 2) {
        notes.push({ text: `For the office, you own ${unworn.length} pieces you haven't worn lately: ${unworn.slice(0, 3).map((i) => `${i.description}${where(i)}`).join(", ")}. Try those before buying.` });
      } else {
        // The office slot they're thinnest in, among everything they own.
        const slot = (["top", "bottom", "shoes"] as const)
          .map((s) => ({ s, n: owned.filter((i) => i.category === s && isOffice(i)).length }))
          .sort((a, b) => a.n - b.n)[0]!.s;
        notes.push({
          text: `You said your week has the office, but only ${wornOffice.length} of the ${worn.length} pieces you wear ${wornOffice.length === 1 ? "is" : "are"} office wear. One office ${slot === "shoes" ? "pair of shoes" : slot} (${SLOT_EXAMPLES[slot]}) would cover more of your week.`,
          search: { category: slot, query: OFFICE_SEARCH[slot] },
        });
      }
    }
  }

  if (occasions.includes("formal events") && !owned.some((i) => DRESSY.has(i.type))) {
    notes.push({ text: "For formal events, there's nothing dressy in your closet yet: a blazer (or a dress) covers most of them.", search: { category: "outerwear", query: "blazer" } });
  }
  return notes;
}

/** Just the sentences (what the tests and older callers read). */
export function occasionNotes(occasions: Occasion[] | null | undefined, owned: Item[], worn: Item[]): string[] {
  return occasionAdvice(occasions, owned, worn).map((a) => a.text);
}

/**
 * The reply to "what should I buy?": what their week needs first (checked
 * against everything they own), then the outfit gap from what they wear
 * (gaps.ts), then the budget line, only when something's being suggested.
 */
export function buyAdvice(
  wears: (Item & { outfit_id: number })[],
  owned: Item[],
  groups: Groups,
  p: Pick<Profile, "occasions" | "ageRange" | "sizeTop" | "sizeBottom" | "sizeShoe">,
): string {
  const notes = occasionAdvice(p.occasions, owned, wears);
  const gap = worthBuyingResult(wears, groups);
  const buying = notes.some((n) => n.search) || gap.buy;
  const budget = buying ? budgetLine(p.ageRange) : null;
  // Secondhand first, in their size: one search per thing it suggests.
  const searches = [...notes.flatMap((n) => (n.search ? [n.search] : [])), ...(gap.suggestion ? [gap.suggestion] : [])].map((q) => {
    const query = encodeURIComponent(sizedQuery(q.query, q.category, p));
    return `Secondhand ${q.query}: https://www.depop.com/search/?q=${query} · eBay: https://www.ebay.com/sch/i.html?_nkw=${query}`;
  });
  return [...notes.map((n) => n.text), gap.text, budget, ...searches].filter(Boolean).join("\n");
}

// ---- storage ----

export function profileFromRow(r: Record<string, unknown>): Profile {
  return {
    name: (r.name as string | null) ?? null,
    ageRange: (r.age_range as AgeRange | null) ?? null,
    occasions: (r.occasions as Occasion[] | null) ?? null,
    sizeTop: (r.size_top as string | null) ?? null,
    sizeBottom: (r.size_bottom as string | null) ?? null,
    sizeShoe: (r.size_shoe as string | null) ?? null,
  };
}

export async function getProfile(db: Db, userId: string): Promise<Profile | undefined> {
  const [row] = await db.query(`SELECT name, age_range, occasions, size_top, size_bottom, size_shoe FROM users WHERE id = $1`, [userId]);
  return row ? profileFromRow(row) : undefined;
}

/**
 * Saves the fields in `patch` (occasions are added to what's there unless
 * `replaceOccasions`). Undefined fields are left alone; null clears one.
 */
export async function saveProfile(db: Db, userId: string, patch: ProfilePatch, opts: { replaceOccasions?: boolean } = {}): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [userId];
  const set = (column: string, value: unknown, expr = (n: number) => `$${n}`) => {
    params.push(value);
    sets.push(`${column} = ${expr(params.length)}`);
  };
  if (patch.name !== undefined) set("name", patch.name);
  if (patch.ageRange !== undefined) set("age_range", patch.ageRange);
  if (patch.occasions !== undefined) {
    // Sent as JSON: Bun's Postgres client doesn't encode a JS array as a Postgres array (PGlite does).
    const list = (n: number) => `ARRAY(SELECT jsonb_array_elements_text($${n}::jsonb))`;
    if (patch.occasions === null) set("occasions", null);
    else if (opts.replaceOccasions) set("occasions", JSON.stringify(patch.occasions), list);
    else set("occasions", JSON.stringify(patch.occasions), (n) => `ARRAY(SELECT DISTINCT unnest(coalesce(occasions, '{}'::text[]) || ${list(n)}))`);
  }
  if (patch.sizeTop !== undefined) set("size_top", patch.sizeTop);
  if (patch.sizeBottom !== undefined) set("size_bottom", patch.sizeBottom);
  if (patch.sizeShoe !== undefined) set("size_shoe", patch.sizeShoe);
  if (sets.length) await db.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $1`, params);
}

/**
 * "delete my data": the closet tables (no foreign key to users) and the user
 * row, which takes the profile and everything that references it (photos,
 * reminders, purchases, impact...) with it.
 */
export async function deleteUserRows(db: Db, userId: string): Promise<void> {
  await db.query(`DELETE FROM items WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM outfits WHERE user_id = $1`, [userId]);
  await db.query(`DELETE FROM users WHERE id = $1`, [userId]);
}
