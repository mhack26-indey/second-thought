import type { Db } from "./db/client.ts";
import { type AskVision, compareToCloset, pickSameItems } from "./closet/compare.ts";
import type { ExtractedItem } from "./closet/extract.ts";
import { type Item, addWear, candidatesByCategory, insertItem } from "./closet/repo.ts";
import type { ImageInput } from "./closet/vlm.ts";
import { exactGroups, matchSeenItems, matchWithGroups } from "./match.ts";

// Fit check ingest: every item seen in a photo either matches something the
// user already owns (log a wear) or is new (add it to the closet).
//
// With the photo at hand, the vision model judges each item against
// same-category closet items (closet/compare.ts). Otherwise, or if that call
// fails, matching (match.ts) has the local model group color and pattern
// names, since the same item gets described with different words. If that
// fails too, names compare as written, so an outage costs a few duplicates,
// not the photo.

const UNKNOWN = "unknown"; // fields a texted item didn't mention

export type Matcher = (seen: ExtractedItem[], owned: Item[]) => Promise<(number | null)[]>;

export const exactMatcher: Matcher = async (seen, owned) => matchWithGroups(seen, owned, exactGroups);

/** Matches by looking at the photo; falls back to name matching if the call fails. */
export function visionMatcher(
  image: ImageInput,
  fallback: Matcher = matchSeenItems,
  ask?: AskVision,
  load?: (url: string) => Promise<ImageInput>,
): Matcher {
  return async (seen, owned) => {
    try {
      return pickSameItems(await compareToCloset(image, seen, owned, ask, load));
    } catch (err) {
      console.error("vision matching failed; falling back to name matching", err);
      return fallback(seen, owned);
    }
  };
}

export interface IngestResult {
  worn: Item[]; // already in the closet
  added: Item[]; // new to the closet
}

export async function ingestOutfit(
  db: Db,
  userId: string,
  outfit: { id: number; photoUrl: string },
  seen: ExtractedItem[],
  matcher: Matcher = matchSeenItems,
): Promise<IngestResult> {
  const categories = [...new Set(seen.map((s) => s.category))];
  const owned = (await Promise.all(categories.map((c) => candidatesByCategory(db, userId, c)))).flat();

  let matches: (number | null)[];
  try {
    matches = await matcher(seen, owned);
  } catch (err) {
    console.error("item matching failed; falling back to exact match", err);
    matches = await exactMatcher(seen, owned);
  }

  const byId = new Map(owned.map((o) => [o.id, o]));
  const result: IngestResult = { worn: [], added: [] };
  for (const [index, item] of seen.entries()) {
    const existing = byId.get(matches[index] ?? -1);
    let saved: Item;
    if (existing) {
      saved = await fillFromPhoto(db, existing, item, outfit.photoUrl);
      result.worn.push(saved);
    } else {
      saved = await insertItem(db, { ...item, user_id: userId, source: "fit_check", photo_url: outfit.photoUrl });
      result.added.push(saved);
    }
    await addWear(db, saved.id, outfit.id);
  }
  return result;
}

// A texted item ("just got black jeans") learns its details and gets a photo
// the first time it shows up in a fit check.
async function fillFromPhoto(db: Db, owned: Item, seen: ExtractedItem, photoUrl: string): Promise<Item> {
  const fill = (field: "color_primary" | "pattern" | "fit") =>
    owned[field] === UNKNOWN ? seen[field] : owned[field];
  const needsUpdate =
    owned.photo_url === null || (["color_primary", "pattern", "fit"] as const).some((f) => owned[f] === UNKNOWN);
  if (!needsUpdate) return owned;

  const [row] = await db.query<Item>(
    `UPDATE items SET color_primary = $2, color_secondary = $3, pattern = $4, fit = $5,
       description = $6, photo_url = coalesce(photo_url, $7)
     WHERE id = $1 RETURNING *`,
    [
      owned.id,
      fill("color_primary"),
      owned.color_secondary ?? seen.color_secondary,
      fill("pattern"),
      fill("fit"),
      owned.photo_url ? owned.description : seen.description,
      photoUrl,
    ],
  );
  return row!;
}
