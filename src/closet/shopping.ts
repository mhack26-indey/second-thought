import type { Db } from "../db/client.ts";
import { type AskVision, compareToCloset, type Similarity } from "./compare.ts";
import { type ExtractedItem, extractItems } from "./extract.ts";
import { today as localToday } from "./dates.ts";
import { candidatesByCategory } from "./repo.ts";
import type { ImageInput } from "./vlm.ts";

// "Do I already own this?" for a shopping photo (POST /closet/match in the
// plan). Nothing is saved: extract what's in the photo, pull same-category
// closet items, let the vision model judge, return the closest few.

export interface ShoppingMatch {
  item_id: number;
  description: string;
  similarity: Similarity;
  reason: string;
  photo_url: string | null; // the fit check the item was first seen in
  owned_since: Date;
  returnable_until: string | null; // YYYY-MM-DD, if it came from an order whose return window is open
}

export interface ShoppingResult {
  seen: ExtractedItem[]; // what the model found in the shopping photo
  matches: ShoppingMatch[]; // near_identical first, at most MAX_MATCHES
  verdict: "similar" | "none";
}

const MAX_MATCHES = 3;

export async function matchShoppingPhoto(
  db: Db,
  userId: string,
  image: ImageInput,
  deps: {
    extract?: typeof extractItems;
    ask?: AskVision;
    load?: (url: string) => Promise<ImageInput>;
    today?: () => string;
  } = {},
): Promise<ShoppingResult> {
  const seen = await (deps.extract ?? extractItems)(image);
  const categories = [...new Set(seen.map((s) => s.category))];
  const owned = (await Promise.all(categories.map((c) => candidatesByCategory(db, userId, c)))).flat();
  const comparison = await compareToCloset(image, seen, owned, deps.ask, deps.load);

  // One entry per closet item (its closest rating), near_identical first.
  const best = new Map<number, ShoppingMatch>();
  for (const { item, similarity, reason } of comparison.flat()) {
    const current = best.get(item.id);
    if (current && (current.similarity === "near_identical" || similarity === "similar")) continue;
    best.set(item.id, {
      item_id: item.id,
      description: item.description,
      similarity,
      reason,
      photo_url: item.photo_url,
      owned_since: item.created_at,
      returnable_until: null,
    });
  }
  const matches = [...best.values()]
    .sort((a, b) => (a.similarity === b.similarity ? 0 : a.similarity === "near_identical" ? -1 : 1))
    .slice(0, MAX_MATCHES);
  await addReturnWindows(db, matches, (deps.today ?? localToday)());
  return { seen, matches, verdict: matches.length ? "similar" : "none" };
}

/** Marks matches bought in an order that can still go back ("still returnable until Oct 30"). */
async function addReturnWindows(db: Db, matches: ShoppingMatch[], today: string): Promise<void> {
  if (!matches.length) return;
  const ids = matches.map((m) => m.item_id);
  const rows = await db.query<{ id: number; until: string }>(
    `SELECT i.id, to_char(p.return_deadline, 'YYYY-MM-DD') AS until
     FROM items i JOIN purchases p ON p.id::text = i.purchase_id
     WHERE p.status = 'kept' AND p.return_deadline >= $1::date
       AND i.id IN (${ids.map((_, n) => `$${n + 2}`).join(", ")})`,
    [today, ...ids],
  );
  const until = new Map(rows.map((r) => [r.id, r.until]));
  for (const m of matches) m.returnable_until = until.get(m.item_id) ?? null;
}
