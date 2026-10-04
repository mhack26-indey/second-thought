import { z } from "zod";
import type { ExtractedItem } from "./closet/extract.ts";
import type { Item } from "./closet/repo.ts";
import { categoryOf } from "./closet/categories.ts";
import { colorIn, llmJson, patternIn, typeIn } from "./llm.ts";

// Deciding whether two descriptions are the same thing. Names drift: the
// vision model says "grey" one day and "charcoal" the next, people text
// "gray sweater" for what was logged as a crewneck. These go to the local
// text model, so they don't spend the vision model's daily quota.
//
// Matching items: the model sorts each color and pattern name into a fixed
// group, and code compares groups. Asked "is this the same item?" directly,
// a 7B model paired a graphic tee with a plain one even when told not to;
// it's reliable at "which group is this word in?".

export const COLOR_GROUPS = [
  "black", "white", "gray", "silver", "cream", "beige", "brown", "red", "burgundy", "pink",
  "orange", "yellow", "gold", "green", "olive", "teal", "light blue", "blue", "navy", "purple",
  "multicolor",
] as const;
export const PATTERN_GROUPS = [
  "solid", "striped", "plaid", "graphic", "floral", "camo", "polka dot", "animal print",
  "colorblock", "tie-dye", "other print",
] as const;

const UNKNOWN = "unknown"; // a field the owner never mentioned; matches anything

export interface Groups {
  color: (name: string | null) => string | null;
  pattern: (name: string) => string;
}

/** No model: names compare as written. The fallback when the model is down. */
export const exactGroups: Groups = { color: (c) => c, pattern: (p) => p };

const cache = { color: new Map<string, string>(), pattern: new Map<string, string>() };

const GroupSchema = z.object({
  colors: z.array(z.object({ name: z.string(), group: z.enum([...COLOR_GROUPS, UNKNOWN]) })),
  patterns: z.array(z.object({ name: z.string(), group: z.enum([...PATTERN_GROUPS, UNKNOWN]) })),
});

/** Groups for every color and pattern on these items, one model call for the new names. */
export async function llmGroups(items: ExtractedItem[]): Promise<Groups> {
  const key = (s: string) => s.trim().toLowerCase();
  const colors = new Set<string>();
  const patterns = new Set<string>();
  for (const i of items) {
    for (const c of [i.color_primary, i.color_secondary]) if (c) colors.add(key(c));
    patterns.add(key(i.pattern));
  }
  const newColors = [...colors].filter((c) => c !== UNKNOWN && !cache.color.has(c));
  const newPatterns = [...patterns].filter((p) => p !== UNKNOWN && !cache.pattern.has(p));

  if (newColors.length || newPatterns.length) {
    const answer = await llmJson(
      GroupSchema,
      `Sort each clothing color name into one color group, and each pattern name into one pattern group.

Color groups: ${COLOR_GROUPS.join(", ")}
(charcoal, heather grey and slate are gray; dark blue and midnight are navy; tan, khaki and camel are beige; off-white and ivory are cream; maroon and wine are burgundy; sage and forest are green; denim blue is blue.)

Pattern groups: ${PATTERN_GROUPS.join(", ")}
(plain and solid are solid; pinstripe and stripes are striped; checkered, gingham and tartan are plaid; logo, print text, band tee and graphic are graphic; leopard and zebra are animal print.)

Use "unknown" only for a name that isn't a color or pattern at all.

Colors: ${JSON.stringify(newColors)}
Patterns: ${JSON.stringify(newPatterns)}

Return every name exactly as given.`,
    );
    for (const { name, group } of answer.colors) cache.color.set(key(name), group);
    for (const { name, group } of answer.patterns) cache.pattern.set(key(name), group);
  }

  // A name the model skipped compares as written rather than matching anything.
  return {
    color: (c) => (c === null ? null : cache.color.get(key(c)) ?? key(c)),
    pattern: (p) => cache.pattern.get(key(p)) ?? key(p),
  };
}

// Neighboring shades the vision model drifts between for the same item
// (one photo's "off-white" blouse is the next one's "beige").
const NEIGHBORS = [
  ["white", "cream"],
  ["cream", "beige"],
  ["gray", "silver"],
  ["light blue", "blue"],
  ["blue", "navy"],
  ["red", "burgundy"],
  ["green", "olive"],
  ["gold", "yellow"],
];
const near = (a: string, b: string) => NEIGHBORS.some(([x, y]) => (a === x && b === y) || (a === y && b === x));

const agrees = (a: string, b: string) => a === UNKNOWN || b === UNKNOWN || a === b;

/**
 * Same type, same or neighboring color group, same pattern group; "unknown"
 * matches anything. Second colors aren't compared: the model is too
 * inconsistent about them (gold frames on black sunglasses), and pattern
 * already tells striped from solid.
 */
export function sameItem(owned: Item, seen: ExtractedItem, g: Groups): boolean {
  const [a, b] = [g.color(owned.color_primary)!, g.color(seen.color_primary)!];
  return owned.type === seen.type && (agrees(a, b) || near(a, b)) && agrees(g.pattern(owned.pattern), g.pattern(seen.pattern));
}

const descWords = (s: string) => s.toLowerCase().match(/[a-z]+/g) ?? [];

/**
 * How alike two closet items look on paper: same type, same (or neighboring)
 * color group, same pattern group, shared description words. For suggesting
 * "same as..." merges when the vision model split one item in two.
 */
export function likeness(a: ExtractedItem, b: ExtractedItem, g: Groups): number {
  let score = a.type === b.type ? 3 : 0;
  const [ca, cb] = [g.color(a.color_primary)!, g.color(b.color_primary)!];
  score += ca === cb ? 2 : agrees(ca, cb) || near(ca, cb) ? 1 : 0;
  if (agrees(g.pattern(a.pattern), g.pattern(b.pattern))) score += 1;
  const wa = new Set(descWords(a.description));
  const wb = new Set(descWords(b.description));
  const shared = [...wa].filter((w) => wb.has(w)).length;
  return score + (2 * shared) / Math.max(wa.size, wb.size, 1);
}

/** The items most like `target` in its category, best first. */
export function mostAlike(target: Item, pool: Item[], g: Groups, n = 4): Item[] {
  return pool
    .filter((i) => i.id !== target.id && i.category === target.category)
    .map((i) => ({ i, score: likeness(target, i, g) }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.i);
}

const FILLER = new Set(["a", "an", "the", "my", "of", "with", "and", "in", "on", "one", "ones", "pair", "some"]);

/**
 * Closet items for a description being typed ("grey sweats", "the puma ones"),
 * best first: the named type (then its category), the named color group (or a
 * neighboring shade; a clearly different color counts against), the named
 * pattern, and matching words, where the last word can be half typed.
 * No model call per keystroke: color names come from the groups cache.
 */
export function searchItems(query: string, items: Item[], g: Groups, n = 6): Item[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const type = typeIn(q);
  const color = colorIn(q);
  const pattern = patternIn(q);
  const words = (q.match(/[a-z0-9]+/g) ?? []).filter((w) => !FILLER.has(w));
  const last = /[a-z0-9]$/.test(q) ? words.at(-1) : undefined; // still being typed

  return items
    .map((item) => {
      let score = 0;
      if (type) score += item.type === type ? 4 : item.category === categoryOf(type) ? 1 : -2;
      if (color) {
        const [want, have] = [g.color(color)!, g.color(item.color_primary)!];
        score += want === have ? 3 : agrees(want, have) || near(want, have) ? 1 : -2;
      }
      if (pattern && agrees(g.pattern(pattern), g.pattern(item.pattern))) score += 1;
      const have = new Set([...descWords(item.description), ...descWords(item.type), item.category]);
      for (const w of words) {
        if (have.has(w)) score += 2;
        else if (w === last && w.length >= 2 && [...have].some((h) => h.startsWith(w))) score += 1;
      }
      return { item, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.item.description.localeCompare(b.item.description))
    .slice(0, n)
    .map((x) => x.item);
}

/**
 * For each seen item, the id of the owned item it is, or null if it's new.
 * Each owned item matches at most once (two black tees in one photo are two
 * tees). Among several matches, the same color group beats a neighboring
 * one, then the same fit wins.
 */
export function matchWithGroups(seen: ExtractedItem[], owned: Item[], g: Groups): (number | null)[] {
  const used = new Set<number>();
  const score = (o: Item, item: ExtractedItem) =>
    (agrees(g.color(o.color_primary)!, g.color(item.color_primary)!) ? 0 : 2) + (o.fit === item.fit ? 0 : 1);
  return seen.map((item) => {
    const fits = owned.filter((o) => !used.has(o.id) && sameItem(o, item, g));
    const [match] = fits.sort((x, y) => score(x, item) - score(y, item));
    if (!match) return null;
    used.add(match.id);
    return match.id;
  });
}

export async function matchSeenItems(seen: ExtractedItem[], owned: Item[]): Promise<(number | null)[]> {
  const relevant = owned.filter((o) => seen.some((s) => s.type === o.type));
  if (!relevant.length) return seen.map(() => null);
  return matchWithGroups(seen, relevant, await llmGroups([...seen, ...relevant]));
}

const FindSchema = z.object({ id: z.number().int().nullable() });

/**
 * The item someone means by "the gray crewneck", or undefined.
 *
 * Code narrows the closet first: a named type keeps that type, or its category
 * if they own none ("hat" -> accessories); a named color keeps only matching
 * or neighboring shades.
 * The model then picks among what's left. Asked to pick from the whole closet,
 * every model tried sometimes answered "red hat" with the gray crewneck, which
 * would remove the wrong item.
 */
export async function findItemByName(name: string, items: Item[]): Promise<Item | undefined> {
  const type = typeIn(name);
  // The exact type if they own one ("tee" -> their t-shirts), else the category
  // ("sweater" can still mean a crewneck).
  const sameType = type ? items.filter((i) => i.type === type) : [];
  let pool = sameType.length ? sameType : type ? items.filter((i) => i.category === categoryOf(type)) : items;
  const color = colorIn(name);
  if (color && pool.length) {
    const asked = { color_primary: color, color_secondary: null, pattern: UNKNOWN } as ExtractedItem;
    const g = await llmGroups([...pool, asked]).catch(() => exactGroups);
    const want = g.color(color)!;
    pool = pool.filter((i) => {
      const have = g.color(i.color_primary)!;
      return agrees(have, want) || near(have, want);
    });
  }
  if (!pool.length) return undefined;
  // Settled without the model: their exact name, or the one item of the type they named.
  // (Asked to pick from one exact match, the model sometimes said "none".)
  const exact = pool.find((i) => i.description.toLowerCase() === name.trim().toLowerCase());
  if (exact) return exact;
  if (pool.length === 1 && type && pool[0]!.type === type) return pool[0];
  items = pool;
  const { id } = await llmJson(
    FindSchema,
    `Someone referred to an item in their closet as "${name}". Which of these items do they mean? Allow for different words for the same color (gray/grey/charcoal), type (crewneck/sweatshirt/sweater, sneakers/trainers) or style. If none fits, or it's a toss-up between several, return null.

Items:
${JSON.stringify(
  items.map((i) => ({
    id: i.id,
    type: i.type,
    color: i.color_primary,
    pattern: i.pattern,
    fit: i.fit,
    description: i.description,
  })),
  null,
  1,
)}`,
  );
  return items.find((i) => i.id === id);
}
