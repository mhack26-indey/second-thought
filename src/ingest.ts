import type { Db } from "./db/client.ts";
import { type AskVision, compareToCloset, pickSameItems } from "./closet/compare.ts";
import type { ExtractedItem } from "./closet/extract.ts";
import { type Item, type ItemSource, addWear, candidatesByCategory, insertItem } from "./closet/repo.ts";
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

/**
 * A matcher's answer can carry, per seen item, the owned items it was rated
 * "similar" to: different pieces, but near-duplicates (two navy polos). Ingest
 * records those pairs for "what should I get rid of?".
 */
export type Matches = (number | null)[] & { alike?: number[][] };

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
      const comparison = await compareToCloset(image, seen, owned, ask, load);
      const matches: Matches = pickSameItems(comparison);
      matches.alike = comparison.map((ms) => ms.filter((m) => m.similarity === "similar").map((m) => m.item.id));
      return matches;
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

/**
 * The shared half of every photo ingest: each seen item either matches an
 * item the user already owns (which learns any details it was missing) or is
 * saved as new, with the photo it was seen in.
 */
async function saveSeen(
  db: Db,
  userId: string,
  seen: ExtractedItem[],
  photoUrl: string,
  source: ItemSource,
  matcher: Matcher,
): Promise<{ item: Item; existed: boolean }[]> {
  const categories = [...new Set(seen.map((s) => s.category))];
  const owned = (await Promise.all(categories.map((c) => candidatesByCategory(db, userId, c)))).flat();

  let matches: Matches;
  try {
    matches = await matcher(seen, owned);
  } catch (err) {
    console.error("item matching failed; falling back to exact match", err);
    matches = await exactMatcher(seen, owned);
  }

  const byId = new Map(owned.map((o) => [o.id, o]));
  const saved: { item: Item; existed: boolean }[] = [];
  for (const [index, item] of seen.entries()) {
    const existing = byId.get(matches[index] ?? -1);
    saved.push(
      existing
        ? { item: await fillFromPhoto(db, existing, item, photoUrl), existed: true }
        : { item: await insertItem(db, { ...item, user_id: userId, source, photo_url: photoUrl }), existed: false },
    );
  }
  // Near-duplicates the comparison saw, between this photo's items and the closet.
  for (const [index, { item }] of saved.entries()) {
    for (const other of matches.alike?.[index] ?? []) {
      if (other === item.id) continue;
      await db.query(`INSERT INTO item_alike (item_id, other_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [
        Math.min(item.id, other),
        Math.max(item.id, other),
      ]);
    }
  }
  return saved;
}

/** A fit check: every item seen gets a wear, whether it's new or already owned. */
export async function ingestOutfit(
  db: Db,
  userId: string,
  outfit: { id: number; photoUrl: string },
  seen: ExtractedItem[],
  matcher: Matcher = matchSeenItems,
): Promise<IngestResult> {
  const result: IngestResult = { worn: [], added: [] };
  for (const { item, existed } of await saveSeen(db, userId, seen, outfit.photoUrl, "fit_check", matcher)) {
    (existed ? result.worn : result.added).push(item);
    await addWear(db, item.id, outfit.id);
  }
  return result;
}

/**
 * A closet dump (a rail, a pile, a drawer): new items are saved with source
 * 'closet'. Nothing was worn, so no outfit and no wears.
 */
export async function ingestCloset(
  db: Db,
  userId: string,
  photoUrl: string,
  seen: ExtractedItem[],
  matcher: Matcher = matchSeenItems,
): Promise<{ had: Item[]; added: Item[] }> {
  const saved = await saveSeen(db, userId, seen, photoUrl, "closet", matcher);
  return { had: saved.filter((s) => s.existed).map((s) => s.item), added: saved.filter((s) => !s.existed).map((s) => s.item) };
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
