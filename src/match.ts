import { z } from "zod";
import type { ExtractedItem } from "./closet/extract.ts";
import type { Item } from "./closet/repo.ts";
import { llmJson } from "./llm.ts";

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

/** The item someone means by "the gray crewneck", or undefined. */
export async function findItemByName(name: string, items: Item[]): Promise<Item | undefined> {
  if (!items.length) return undefined;
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
