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

const agrees = (a: string | null, b: string | null) => a === UNKNOWN || b === UNKNOWN || a === b;

/** Same type, same color and pattern groups; "unknown" matches anything. */
export function sameItem(owned: Item, seen: ExtractedItem, g: Groups): boolean {
  return (
    owned.type === seen.type &&
    agrees(g.color(owned.color_primary), g.color(seen.color_primary)) &&
    // Texted items never have a second color, so don't hold that against them.
    (owned.source === "text" || g.color(owned.color_secondary) === g.color(seen.color_secondary)) &&
    agrees(g.pattern(owned.pattern), g.pattern(seen.pattern))
  );
}

/**
 * For each seen item, the id of the owned item it is, or null if it's new.
 * Each owned item matches at most once (two black tees in one photo are two
 * tees); among several matches, the one with the same fit wins.
 */
export function matchWithGroups(seen: ExtractedItem[], owned: Item[], g: Groups): (number | null)[] {
  const used = new Set<number>();
  return seen.map((item) => {
    const fits = owned.filter((o) => !used.has(o.id) && sameItem(o, item, g));
    const match = fits.find((o) => o.fit === item.fit) ?? fits[0];
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
