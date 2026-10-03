import { z } from "zod";
import type { ExtractedItem } from "./extract.ts";
import type { Item } from "./repo.ts";
import { type ImageInput, loadImage, vlmJson } from "./vlm.ts";

// Stage 2 of match and dedup (vision-matching-plan.md section 3): SQL has
// already narrowed the closet to the same categories; the vision model looks
// at the photo and judges each item seen in it against those candidates.
//
// It sees the actual garments: the new photo plus the earlier photos the
// closest candidates came from. So wording drift between extractions
// ("blouse" one day, "t-shirt" the next; maroon vs burgundy) doesn't create
// duplicates, and two different black bags that were both described as
// "black textured leather" don't merge.

export type Similarity = "near_identical" | "similar";

export interface CandidateMatch {
  item: Item;
  similarity: Similarity;
  reason: string;
}

/** For each seen item (same order), the closet items it resembles, closest first. */
export type Comparison = CandidateMatch[][];

const ComparisonSchema = z.object({
  items: z.array(
    z.object({
      seen: z.number().int(),
      matches: z.array(
        z.object({
          item_id: z.number().int(),
          similarity: z.enum(["near_identical", "similar", "different"]),
          reason: z.string(),
        }),
      ),
    }),
  ),
});

export type AskVision = (opts: {
  schema: typeof ComparisonSchema;
  images: ImageInput[];
  prompt: string;
  effort?: "low" | "medium" | "high";
  model?: string;
}) => Promise<z.infer<typeof ComparisonSchema>>;

// Past this many candidates in a category, pre-sort by attribute overlap and
// send only the closest few, so the prompt stays small.
const MAX_CANDIDATES = 40;
const TRIMMED_CANDIDATES = 20;
// Earlier photos sent alongside the new one, for the most likely candidates.
const MAX_REFERENCE_PHOTOS = 6;
// Telling apart near-identical items across photos takes more thought than
// extraction: at low effort the model merged a woven flap bag with a woven
// tote every time; at medium it kept them apart in 3 of 3 runs.
const COMPARE_EFFORT = "medium";
const COMPARE_MODEL = process.env.COMPARE_MODEL; // defaults to VISION_MODEL

/** Same-category closet items worth showing the model for one seen item. */
export function candidatesFor(seen: ExtractedItem, owned: Item[]): Item[] {
  const sameCategory = owned.filter((o) => o.category === seen.category);
  if (sameCategory.length <= MAX_CANDIDATES) return sameCategory;
  return [...sameCategory].sort((a, b) => overlap(b, seen) - overlap(a, seen)).slice(0, TRIMMED_CANDIDATES);
}

function overlap(o: Item, seen: ExtractedItem): number {
  return (o.type === seen.type ? 2 : 0) + (o.color_primary === seen.color_primary ? 1 : 0);
}

/**
 * Up to MAX_REFERENCE_PHOTOS earlier photos. Items in the new photo take
 * turns: each one's closest candidate gets its photo in before any item gets
 * a second, so a busy photo can't crowd out one item's only match. Photos
 * that fail to load are skipped; those candidates are judged from their
 * descriptions alone.
 */
async function referencePhotos(
  seen: ExtractedItem[],
  candidates: Item[][],
  load: (url: string) => Promise<ImageInput>,
): Promise<{ url: string; label: string; image: ImageInput }[]> {
  const ranked = seen.map((s, i) =>
    candidates[i]!.filter((c) => c.photo_url).sort((a, b) => overlap(b, s) - overlap(a, s)),
  );
  const urls: string[] = [];
  const longest = Math.max(0, ...ranked.map((r) => r.length));
  for (let rank = 0; rank < longest && urls.length < MAX_REFERENCE_PHOTOS; rank++) {
    for (const list of ranked) {
      const url = list[rank]?.photo_url;
      if (url && !urls.includes(url)) urls.push(url);
      if (urls.length === MAX_REFERENCE_PHOTOS) break;
    }
  }
  const loaded = await Promise.all(urls.map((url) => load(url).catch(() => undefined)));
  return urls
    .map((url, i) => ({ url, image: loaded[i] }))
    .filter((p): p is { url: string; image: ImageInput } => p.image !== undefined)
    .map((p, i) => ({ ...p, label: String.fromCharCode(65 + i) })); // A, B, C...
}

function describe(item: Pick<Item, "type" | "color_primary" | "pattern" | "fit" | "description">): string {
  return `${item.description} (${item.type}, ${item.color_primary}, ${item.pattern}, ${item.fit})`;
}

function comparePrompt(seen: ExtractedItem[], candidates: Item[][], photoLabels: Map<string, string>): string {
  const photoNote = (c: Item) => {
    const label = c.photo_url && photoLabels.get(c.photo_url);
    return label ? ` [in photo ${label}]` : "";
  };
  const labels = [...photoLabels.values()];
  const imagesIntro = labels.length
    ? `The first image is the new photo. The next ${labels.length === 1 ? "image is earlier photo A" : `images are earlier photos ${labels.join(", ")}, in that order`}. Each closet item below names the earlier photo that shows it: find it there and judge by how it looks, not by its description, which was written by a model from that photo and can be off (e.g. "grey panels" for dark leather). An item can show up in several photos, and an earlier photo can show things that aren't the listed closet item; only the listed closet ids count.`
    : "The image is the new photo.";
  const seenList = seen
    .map((s, i) => {
      const ids = candidates[i]!.map((c) => c.id);
      return `${i}. ${describe(s)} — compare with closet items: ${ids.length ? ids.join(", ") : "none"}`;
    })
    .join("\n");
  const closet = [...new Map(candidates.flat().map((c) => [c.id, c])).values()]
    .map((c) => `${c.id}: ${describe(c)}${photoNote(c)}`)
    .join("\n");

  return `${imagesIntro}

The new photo shows items numbered below. For each one, judge it against the closet items listed for it, using what you see in the photo. The closet descriptions were written from other photos, so wording can differ for the same item (a top called a blouse once and a t-shirt another time, maroon vs burgundy).

Ratings:
- near_identical: very likely the same physical item the person already owns. Same garment, allowing for lighting, angle, wrinkles and wording.
- similar: a different item, but close enough that owning one makes the other a near-duplicate (same kind of item, same color family, same overall look).
- different: anything else. Different details that would be visible (a leather panel, a print, a flap vs an open tote, a different cut or length) make it different, even if the words overlap.

Items in the photo:
${seenList}

Closet items:
${closet}

For each photo item, list only the closet items you rate near_identical or similar, closest first, each with a short reason a person would understand (e.g. "same black straight-leg jeans, slightly darker wash"). Use the photo item numbers as "seen" and only the closet ids listed for that item. Return an empty matches list when nothing is close.`;
}

/**
 * One vision call for a whole photo. Skips the call when no seen item has
 * candidates (an empty closet, or a new category).
 */
export async function compareToCloset(
  image: ImageInput,
  seen: ExtractedItem[],
  owned: Item[],
  ask: AskVision = vlmJson,
  load: (url: string) => Promise<ImageInput> = loadImage,
): Promise<Comparison> {
  const candidates = seen.map((s) => candidatesFor(s, owned));
  const result: Comparison = seen.map(() => []);
  if (candidates.every((c) => c.length === 0)) return result;

  const references = await referencePhotos(seen, candidates, load);
  const answer = await ask({
    schema: ComparisonSchema,
    images: [image, ...references.map((r) => r.image)],
    prompt: comparePrompt(seen, candidates, new Map(references.map((r) => [r.url, r.label]))),
    effort: COMPARE_EFFORT,
    model: COMPARE_MODEL,
  });

  const rank = { near_identical: 0, similar: 1 } as const;
  for (const entry of answer.items) {
    const allowed = new Map((candidates[entry.seen] ?? []).map((c) => [c.id, c]));
    const matches = result[entry.seen];
    if (!matches) continue; // the model invented a photo item
    for (const m of entry.matches) {
      const item = allowed.get(m.item_id); // drops other categories and made-up ids
      if (!item || m.similarity === "different" || matches.some((x) => x.item.id === item.id)) continue;
      matches.push({ item, similarity: m.similarity, reason: m.reason });
    }
    matches.sort((a, b) => rank[a.similarity] - rank[b.similarity]);
  }
  return result;
}

/**
 * Dedup on ingest: the owned item each seen item *is*, or null if it's new.
 * Only near_identical counts, and each owned item matches at most once per
 * photo (two black tees in one photo are two tees).
 */
export function pickSameItems(comparison: Comparison): (number | null)[] {
  const used = new Set<number>();
  return comparison.map((matches) => {
    const same = matches.find((m) => m.similarity === "near_identical" && !used.has(m.item.id));
    if (!same) return null;
    used.add(same.item.id);
    return same.item.id;
  });
}
