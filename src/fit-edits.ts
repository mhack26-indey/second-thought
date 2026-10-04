import type { ExtractedItem } from "./closet/extract.ts";
import { type Item, deleteOutfit, insertItem } from "./closet/repo.ts";
import type { Db } from "./db/client.ts";

// Fixing a fit check by hand on the wardrobe page, when the vision model got
// it wrong: link an item that's in the photo, unlink one that isn't, merge an
// item it split in two, or add one it missed.

/** Marks an item as worn in a fit check; false if either isn't theirs. */
export async function linkItem(db: Db, userId: string, outfitId: number, itemId: number): Promise<boolean> {
  // Already linked counts as linked; only someone else's item or photo fails.
  const [row] = await db.query<{ ok: number }>(
    `WITH ok AS (
       SELECT i.id AS item_id, o.id AS outfit_id FROM items i, outfits o
       WHERE i.id = $3 AND i.user_id = $1 AND i.status = 'active' AND o.id = $2 AND o.user_id = $1),
     ins AS (INSERT INTO wears (item_id, outfit_id) SELECT item_id, outfit_id FROM ok ON CONFLICT DO NOTHING)
     SELECT count(*)::int AS ok FROM ok`,
    [userId, outfitId, itemId],
  );
  return (row?.ok ?? 0) > 0;
}

/**
 * "Not in this photo." An item the vision model made up from this photo
 * (first seen here, worn nowhere else) leaves the closet too.
 */
export async function unlinkItem(db: Db, userId: string, outfitId: number, itemId: number): Promise<{ removed: boolean }> {
  await db.query(
    `DELETE FROM wears w USING outfits o WHERE w.outfit_id = o.id AND o.user_id = $1 AND o.id = $2 AND w.item_id = $3`,
    [userId, outfitId, itemId],
  );
  const gone = await db.query(
    `UPDATE items i SET status = 'removed'
     WHERE i.id = $2 AND i.user_id = $1 AND i.source = 'fit_check'
       AND NOT EXISTS (SELECT 1 FROM wears w WHERE w.item_id = i.id)
     RETURNING id`,
    [userId, itemId],
  );
  return { removed: gone.length > 0 };
}

/**
 * "Same as..." when the vision model split one item in two: every wear of
 * `fromId` moves to `intoId`, which also takes its photo and order if it had
 * none, and `fromId` leaves the closet. One statement, so all or nothing.
 */
export async function mergeItems(db: Db, userId: string, fromId: number, intoId: number): Promise<boolean> {
  if (fromId === intoId) return false;
  const [row] = await db.query<{ merged: number }>(
    `WITH f AS (SELECT id, photo_url, purchase_id FROM items WHERE id = $2 AND user_id = $1 AND status = 'active'),
       t AS (SELECT id FROM items WHERE id = $3 AND user_id = $1 AND status = 'active'),
       moved AS (
         INSERT INTO wears (item_id, outfit_id)
         SELECT t.id, w.outfit_id FROM wears w, f, t WHERE w.item_id = f.id
         ON CONFLICT DO NOTHING RETURNING 1),
       dropped AS (DELETE FROM wears w USING f, t WHERE w.item_id = f.id RETURNING 1),
       kept AS (
         UPDATE items i SET photo_url = coalesce(i.photo_url, f.photo_url), purchase_id = coalesce(i.purchase_id, f.purchase_id)
         FROM f, t WHERE i.id = t.id RETURNING 1),
       gone AS (UPDATE items i SET status = 'removed' FROM f, t WHERE i.id = f.id RETURNING 1)
     SELECT (SELECT count(*) FROM gone)::int AS merged`,
    [userId, fromId, intoId],
  );
  return (row?.merged ?? 0) > 0;
}

/** A new item, added by hand to a fit check. */
export async function addItemToOutfit(
  db: Db,
  userId: string,
  outfit: { id: number; photoUrl: string | null },
  item: ExtractedItem,
): Promise<Item> {
  const saved = await insertItem(db, { ...item, user_id: userId, source: "fit_check", photo_url: outfit.photoUrl });
  await linkItem(db, userId, outfit.id, saved.id);
  return saved;
}

/**
 * "It's not a blouse, it's a t-shirt": fixes what the item is (type,
 * category, description) and any color or pattern they named. Things they
 * didn't mention ("unknown") keep what the photo said.
 */
export async function relabelItem(db: Db, userId: string, itemId: number, as: ExtractedItem): Promise<Item | undefined> {
  const [row] = await db.query<Item>(
    `UPDATE items SET type = $3, category = $4, description = $5,
       color_primary = CASE WHEN $6 = 'unknown' THEN color_primary ELSE $6 END,
       pattern = CASE WHEN $7 = 'unknown' THEN pattern ELSE $7 END
     WHERE id = $2 AND user_id = $1 AND status = 'active' RETURNING *`,
    [userId, itemId, as.type, as.category, as.description, as.color_primary, as.pattern],
  );
  return row;
}

/**
 * What deleting a fit check would take with it: the items first seen in it
 * and worn nowhere else (the same rule as deleteOutfit), for the confirmation.
 */
export async function itemsOnlyIn(db: Db, userId: string, outfitId: number): Promise<string[]> {
  const rows = await db.query<{ description: string }>(
    `SELECT i.description FROM items i JOIN outfits o ON o.id = $2 AND o.user_id = $1
     WHERE i.user_id = $1 AND i.source = 'fit_check' AND i.created_at >= o.created_at
       AND EXISTS (SELECT 1 FROM wears w WHERE w.item_id = i.id AND w.outfit_id = o.id)
       AND NOT EXISTS (SELECT 1 FROM wears w WHERE w.item_id = i.id AND w.outfit_id <> o.id)
     ORDER BY i.id`,
    [userId, outfitId],
  );
  return rows.map((r) => r.description);
}

/**
 * Deletes a fit check: the outfit, its wears, and the items only it added
 * (deleteOutfit). The stored photo is the caller's to delete (photos table).
 * Returns the removed items' names, or undefined if it isn't theirs.
 */
export async function deleteFitCheck(db: Db, userId: string, outfitId: number): Promise<string[] | undefined> {
  const [own] = await db.query(`SELECT 1 FROM outfits WHERE id = $2 AND user_id = $1`, [userId, outfitId]);
  if (!own) return undefined;
  const removed = await itemsOnlyIn(db, userId, outfitId);
  await deleteOutfit(db, userId, outfitId);
  return removed;
}
