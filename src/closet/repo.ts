import type { Db } from "../db/client.ts";
import type { Category } from "./categories.ts";
import type { ExtractedItem } from "./extract.ts";

// SQL for the closet tables. Match, dedup and ingest build on these.

export type ItemSource = "fit_check" | "closet" | "order";
export type ItemStatus = "active" | "returned" | "removed";

export interface Item extends ExtractedItem {
  id: number;
  user_id: string;
  photo_url: string | null;
  source: ItemSource;
  purchase_id: string | null;
  location: string | null;
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
