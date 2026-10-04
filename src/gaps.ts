import type { Item } from "./closet/repo.ts";
import type { Groups } from "./match.ts";

// "What should I actually buy?" From what they actually wear (fit checks,
// not everything they own), find the outfit slot with the fewest pieces in
// rotation: 8 pants worn with the same 2 tops means one more top goes with
// all 8. If nothing stands out, the answer is to buy nothing.

const SLOTS = ["top", "bottom", "shoes"] as const;
type Slot = (typeof SLOTS)[number];

const NAMES: Record<Slot, [one: string, many: string]> = {
  top: ["top", "tops"],
  bottom: ["bottom", "bottoms"],
  shoes: ["pair of shoes", "pairs of shoes"],
};
const name = (slot: Slot, n: number) => `${n} ${NAMES[slot][n === 1 ? 0 : 1]}`;

// Suggested in this order: colors that go with almost anything.
const NEUTRALS = ["black", "white", "gray", "navy", "beige"];

export const MIN_OUTFITS = 3; // fewer fit checks than this isn't a pattern
export const WINDOW_DAYS = 90;

export function worthBuying(wears: (Item & { outfit_id: number })[], groups: Groups): string {
  return worthBuyingResult(wears, groups).text;
}

/** The answer, and whether it suggests buying anything (a missing slot) or not. */
/** What it suggests, for search links: the slot's category and what to search for. */
export interface BuySuggestion {
  category: "top" | "bottom" | "shoes";
  query: string; // "gray shoes", "black top"
}

const QUERY_NOUN: Record<Slot, string> = { top: "top", bottom: "pants", shoes: "shoes" };

export function worthBuyingResult(wears: (Item & { outfit_id: number })[], groups: Groups): { text: string; buy: boolean; suggestion?: BuySuggestion } {
  const no = (text: string) => ({ text, buy: false });
  const outfits = new Set(wears.map((w) => w.outfit_id)).size;
  if (outfits === 0) {
    return no("Send me a few fit checks first. I base this on what you actually wear, not just what you own.");
  }
  if (outfits < MIN_OUTFITS) {
    return no(`I base this on what you actually wear, and I've only seen ${outfits} fit check${outfits === 1 ? "" : "s"} lately. Send a few more and ask again.`);
  }

  // Distinct items in rotation per slot.
  const worn = new Map<Slot, Map<number, Item>>(SLOTS.map((s) => [s, new Map()]));
  for (const w of wears) worn.get(w.category as Slot)?.set(w.id, w);
  const counts = SLOTS.map((slot) => ({ slot, items: [...worn.get(slot)!.values()] })).filter((c) => c.items.length);
  if (counts.length < 2) {
    return no("Your fit checks don't show enough tops, bottoms and shoes to compare yet. Full-length photos help.");
  }

  counts.sort((a, b) => a.items.length - b.items.length);
  const low = counts[0]!;
  const high = counts[counts.length - 1]!;
  if (high.items.length < 2 * low.items.length) {
    const list = SLOTS.flatMap((s) => {
      const c = counts.find((c) => c.slot === s);
      return c ? [name(s, c.items.length)] : [];
    });
    return no(`Nothing's holding your closet back: you rotate ${list.join(", ")}. The most sustainable buy right now is nothing.`);
  }

  // One more piece in the low slot makes a new outfit with every combination
  // of the other slots.
  const combos = counts.slice(1).reduce((n, c) => n * c.items.length, 1);
  const have = new Set(low.items.map((i) => groups.color(i.color_primary)));
  const color = NEUTRALS.find((c) => !have.has(c));
  const one = NAMES[low.slot][0];
  const same = low.items.length === 1 ? `the same ${one}` : `the same ${name(low.slot, low.items.length)}`;

  const text = [
    `You wear ${name(high.slot, high.items.length)} with ${same}.`,
    `${color ? `A ${color} ${one}` : `Another ${one}`} would go with all of them: ${combos} new outfit${combos === 1 ? "" : "s"}.`,
  ].join(" ");
  return { text, buy: true, suggestion: { category: low.slot, query: `${color ? `${color} ` : ""}${QUERY_NOUN[low.slot]}` } };
}
