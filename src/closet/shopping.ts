import type { Db } from "../db/client.ts";
import { type AskVision, compareToCloset, type Similarity } from "./compare.ts";
import { type ExtractedItem, extractItems } from "./extract.ts";
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
  deps: { extract?: typeof extractItems; ask?: AskVision; load?: (url: string) => Promise<ImageInput> } = {},
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
    });
  }
  const matches = [...best.values()]
    .sort((a, b) => (a.similarity === b.similarity ? 0 : a.similarity === "near_identical" ? -1 : 1))
    .slice(0, MAX_MATCHES);
  return { seen, matches, verdict: matches.length ? "similar" : "none" };
}
