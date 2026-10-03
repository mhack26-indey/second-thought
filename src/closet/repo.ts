import type { Db } from "../db/client.ts";
import type { Category } from "./categories.ts";
import type { ExtractedItem } from "./extract.ts";

// SQL for the closet tables. Match, dedup and ingest build on these.

// "text" = described in a text message ("just got black jeans"), so no photo.
export type ItemSource = "fit_check" | "closet" | "order" | "text";
export type ItemStatus = "active" | "returned" | "removed";

export interface Item extends ExtractedItem {
  id: number;
  user_id: string;
  photo_url: string | null;
  source: ItemSource;
  purchase_id: string | null;
  location: string | null;
  location_set_at: Date | null;
  status: ItemStatus;
  created_at: Date;
}

export interface Outfit {
  id: number;
  user_id: string;
  photo_url: string | null;
  taken_on: Date;
  created_at: Date;
}

export async function insertItem(
  db: Db,
  item: ExtractedItem & {
    user_id: string;
    source: ItemSource;
    photo_url?: string | null;
    purchase_id?: string | null;
  },
): Promise<Item> {
  const [row] = await db.query<Item>(
    `INSERT INTO items (user_id, category, type, color_primary, color_secondary,
       pattern, fit, season, description, photo_url, source, purchase_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      item.user_id,
      item.category,
      item.type,
      item.color_primary,
      item.color_secondary,
      item.pattern,
      item.fit,
      item.season,
      item.description,
      item.photo_url ?? null,
      item.source,
      item.purchase_id ?? null,
    ],
  );
  return row!;
}

/** Stage 1 of match/dedup: the user's active items in one category. */
export async function candidatesByCategory(
  db: Db,
  userId: string,
  category: Category,
): Promise<Item[]> {
  return db.query<Item>(
    `SELECT * FROM items
     WHERE user_id = $1 AND category = $2 AND status = 'active'
     ORDER BY id`,
    [userId, category],
  );
}

/** Everything the user currently owns, oldest first. */
export async function activeItems(db: Db, userId: string): Promise<Item[]> {
  return db.query<Item>(
    `SELECT * FROM items WHERE user_id = $1 AND status = 'active' ORDER BY id`,
    [userId],
  );
}

/** Returns false if the item doesn't exist or belongs to someone else. */
export async function setItemStatus(
  db: Db,
  userId: string,
  itemId: number,
  status: ItemStatus,
): Promise<boolean> {
  const rows = await db.query(
    `UPDATE items SET status = $3 WHERE id = $1 AND user_id = $2 RETURNING id`,
    [itemId, userId, status],
  );
  return rows.length > 0;
}

/** Where the item is kept; returns false if it isn't the user's. */
export async function setItemLocation(
  db: Db,
  userId: string,
  itemId: number,
  location: string,
): Promise<boolean> {
  const rows = await db.query(
    `UPDATE items SET location = $3, location_set_at = now() WHERE id = $1 AND user_id = $2 RETURNING id`,
    [itemId, userId, location],
  );
  return rows.length > 0;
}

/** Items worn in outfits taken in the last `days` days, one row per wear. */
export async function recentWears(
  db: Db,
  userId: string,
  days: number,
): Promise<(Item & { outfit_id: number })[]> {
  return db.query(
    `SELECT i.*, w.outfit_id FROM wears w
       JOIN items i ON i.id = w.item_id
       JOIN outfits o ON o.id = w.outfit_id
     WHERE o.user_id = $1 AND o.taken_on >= current_date - $2::int AND i.status = 'active'`,
    [userId, days],
  );
}

export async function createOutfit(
  db: Db,
  outfit: { user_id: string; taken_on: string | Date; photo_url?: string | null },
): Promise<Outfit> {
  const [row] = await db.query<Outfit>(
    `INSERT INTO outfits (user_id, photo_url, taken_on) VALUES ($1, $2, $3) RETURNING *`,
    [outfit.user_id, outfit.photo_url ?? null, outfit.taken_on],
  );
  return row!;
}

/** Logs a wear; logging the same item twice for one outfit is a no-op. */
export async function addWear(db: Db, itemId: number, outfitId: number): Promise<void> {
  await db.query(
    `INSERT INTO wears (item_id, outfit_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [itemId, outfitId],
  );
}

export async function wearCount(db: Db, itemId: number): Promise<number> {
  const [row] = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM wears WHERE item_id = $1`,
    [itemId],
  );
  return row!.n;
}
