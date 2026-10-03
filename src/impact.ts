import type { Db } from "./db/client.ts";
import { money } from "./orders.ts";

// The impact counter: purchases skipped because a shopping check found
// something they already own, and money back from returns. Only what actually
// happened; no estimated CO₂ or water numbers.

/**
 * A shopping check matched `itemId`; the amount is that item's order price,
 * if it has one. At most once per item per day (server local time), so
 * checking the same jacket again in the store doesn't count twice.
 */
export async function recordAvoided(db: Db, userId: string, itemId: number, now = new Date()): Promise<void> {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  await db.query(
    `INSERT INTO impact_events (user_id, kind, amount, item_id, purchase_id, created_at)
     SELECT $1, 'avoided', p.price, i.id, p.id, $5
     FROM items i LEFT JOIN purchases p ON p.id::text = i.purchase_id
     WHERE i.id = $2
       AND NOT EXISTS (
         SELECT 1 FROM impact_events e
         WHERE e.user_id = $1 AND e.kind = 'avoided' AND e.item_id = $2
           AND e.created_at >= $3 AND e.created_at < $4)`,
    [userId, itemId, dayStart, dayEnd, now],
  );
}

/** A purchase is going back. Counted once, however many times its status moves. */
export async function recordRecovered(db: Db, purchaseId: string): Promise<void> {
  await db.query(
    `INSERT INTO impact_events (user_id, kind, amount, item_id, purchase_id)
     SELECT p.user_id, 'recovered', p.price, i.id, p.id
     FROM purchases p JOIN items i ON i.purchase_id = p.id::text
     WHERE p.id = $1
     LIMIT 1
     ON CONFLICT (purchase_id) WHERE kind = 'recovered' DO NOTHING`,
    [purchaseId],
  );
}

export interface Impact {
  skipped: number; // shopping checks that found a match
  recovered: number; // dollars back from returns
}

export async function impactTotals(db: Db, userId: string): Promise<Impact> {
  const [row] = await db.query<{ skipped: number; recovered: string }>(
    `SELECT count(*) FILTER (WHERE kind = 'avoided')::int AS skipped,
       coalesce(sum(amount) FILTER (WHERE kind = 'recovered'), 0)::text AS recovered
     FROM impact_events WHERE user_id = $1`,
    [userId],
  );
  return { skipped: row!.skipped, recovered: Number(row!.recovered) };
}

const IMPACT_ASK = /^(?:what'?s |show )?(?:my )?(?:impact|stats)$|^how am i doing$/;

export function isImpactAsk(text: string): boolean {
  return IMPACT_ASK.test(text.trim().toLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g, " "));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Skipped 2 purchases · $49.90 back" for the wardrobe page. */
export function impactSummary({ skipped, recovered }: Impact): string {
  return `Skipped ${plural(skipped, "purchase", "purchases")} · ${money(recovered)} back`;
}

export function impactReply({ skipped, recovered }: Impact): string {
  if (skipped === 0 && recovered === 0) return "Nothing yet. Text 'do I have this?' next time you're shopping.";
  const lines = [`You've skipped ${plural(skipped, "purchase", "purchases")} and gotten ${money(recovered)} back.`];
  if (skipped > 0) lines.push(`That's ${plural(skipped, "fewer thing", "fewer things")} in your closet you didn't need.`);
  return lines.join("\n");
}
