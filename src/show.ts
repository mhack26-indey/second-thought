import { CATEGORIES } from "./closet/categories.ts";
import type { Item } from "./closet/repo.ts";
import type { Reply } from "./shopping-mode.ts";
import { SECTION_TITLES } from "./web-style.ts";

// "Show my stuff" by text: the last few fit checks as photos, or the closet
// as a short summary, each with the wardrobe page link for the rest.

export const FIT_CHECKS_SHOWN = 6;
export const PER_CATEGORY = 5;

const FIT_CHECKS = /^(?:show (?:me )?my |send (?:me )?my |my )?(?:fit ?checks|ootds?|outfits)$/;
const CLOSET = /^(?:show (?:me )?my (?:closet|items|clothes|stuff)|my items|what do i (?:own|have)|list my (?:closet|items|clothes))$/;
const normalize = (text: string) => text.trim().toLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g, " ");

export const isShowFitChecks = (text: string) => FIT_CHECKS.test(normalize(text));
export const isShowCloset = (text: string) => CLOSET.test(normalize(text));

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const day = (at: number) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** "navy polo"; skips a color a texted item never mentioned. */
const shortName = (i: Pick<Item, "color_primary" | "type">) => (i.color_primary === "unknown" ? i.type : `${i.color_primary} ${i.type}`);

/**
 * The newest fit checks with photos, newest first: each photo, then its date
 * and what was worn in it; then the page link.
 */
export function fitCheckReplies(
  outfits: { id: number; photoUrl: string | null; at: number }[],
  wears: { outfitId: number; itemId: number }[],
  items: Item[],
  wardrobeLink: string,
): Reply[] {
  const shown = outfits.filter((o) => o.photoUrl).sort((a, b) => b.at - a.at).slice(0, FIT_CHECKS_SHOWN);
  if (!shown.length) return ["No fit checks yet. Send a photo of what you're wearing and I'll start keeping track."];
  const byId = new Map(items.map((i) => [i.id, i]));
  const replies: Reply[] = [];
  for (const o of shown) {
    const worn = wears.filter((w) => w.outfitId === o.id).map((w) => byId.get(w.itemId)).filter((i): i is Item => i !== undefined);
    replies.push({ photo: o.photoUrl! }, `${day(o.at)}: ${worn.length ? worn.map(shortName).join(", ") : "nothing logged from this one"}`);
  }
  const total = outfits.filter((o) => o.photoUrl).length;
  replies.push(`${total > shown.length ? `That's your latest ${shown.length} of ${total}. ` : ""}All your fit checks: ${wardrobeLink}#fits`);
  return replies;
}

/**
 * The closet by category (in the page's order), each sorted by how often it's
 * worn, the top few named: "Tops (9): navy polo (3 wears), … + 4 more".
 */
export function closetSummary(items: Item[], wears: { itemId: number }[], wardrobeLink: string): string {
  if (!items.length) return `Your closet is empty so far. Send a fit check or a photo of your closet rail to fill it: ${wardrobeLink}`;
  const count = new Map<number, number>();
  for (const w of wears) count.set(w.itemId, (count.get(w.itemId) ?? 0) + 1);
  const lines = CATEGORIES.flatMap((cat) => {
    const here = items
      .filter((i) => i.category === cat)
      .sort((a, b) => (count.get(b.id) ?? 0) - (count.get(a.id) ?? 0) || a.description.localeCompare(b.description));
    if (!here.length) return [];
    const named = here.slice(0, PER_CATEGORY).map((i) => `${shortName(i)} (${plural(count.get(i.id) ?? 0, "wear")})`);
    const more = here.length > PER_CATEGORY ? `, + ${here.length - PER_CATEGORY} more` : "";
    const title = SECTION_TITLES[cat].replace(/^./, (c) => c.toUpperCase());
    return [`${title} (${here.length}): ${named.join(", ")}${more}`];
  });
  return [...lines, `See everything: ${wardrobeLink}`].join("\n");
}
