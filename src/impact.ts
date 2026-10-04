import type { Db } from "./db/client.ts";
import { describeKg, footprintOf } from "./footprint.ts";
import { money } from "./orders.ts";

// The impact counter: purchases skipped because a shopping check found
// something they already own, and money back from returns. Counts and money
// are what actually happened; the CO₂ is an estimate per item type
// (footprint.ts, Carbonfact category averages) and is always labeled as one.

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
  co2Kg: number; // estimated, for skipped purchases of item types with a known footprint
}

/** One skipped purchase, for "Here's what you skipped". */
export interface Skipped {
  at: Date;
  description: string; // the owned item the shopping check matched
  type: string;
  co2Kg: number | null;
}

export async function skippedPurchases(db: Db, userId: string): Promise<Skipped[]> {
  const rows = await db.query<{ created_at: Date; description: string; type: string }>(
    `SELECT e.created_at, i.description, i.type
     FROM impact_events e JOIN items i ON i.id = e.item_id
     WHERE e.user_id = $1 AND e.kind = 'avoided' ORDER BY e.created_at DESC`,
    [userId],
  );
  return rows.map((r) => ({ at: r.created_at, description: r.description, type: r.type, co2Kg: footprintOf(r.type) }));
}

export async function impactTotals(db: Db, userId: string): Promise<Impact> {
  const [row] = await db.query<{ skipped: number; recovered: string }>(
    `SELECT count(*) FILTER (WHERE kind = 'avoided')::int AS skipped,
       coalesce(sum(amount) FILTER (WHERE kind = 'recovered'), 0)::text AS recovered
     FROM impact_events WHERE user_id = $1`,
    [userId],
  );
  const co2Kg = (await skippedPurchases(db, userId)).reduce((sum, s) => sum + (s.co2Kg ?? 0), 0);
  return { skipped: row!.skipped, recovered: Number(row!.recovered), co2Kg };
}

const IMPACT_ASK = /^(?:what'?s |show )?(?:my )?(?:impact|stats)$|^how am i doing$/;

export function isImpactAsk(text: string): boolean {
  return IMPACT_ASK.test(text.trim().toLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g, " "));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Skipped 2 purchases · ≈ 35 kg CO₂e saved · $49.90 back" for the wardrobe page; zeros are left out. */
export function impactSummary({ skipped, recovered, co2Kg }: Impact): string {
  if (skipped === 0 && recovered === 0) return "Nothing skipped yet";
  const parts = [`Skipped ${plural(skipped, "purchase", "purchases")}`];
  if (co2Kg > 0) parts.push(`≈ ${Math.round(co2Kg)} kg CO₂e saved`);
  if (recovered > 0) parts.push(`${money(recovered)} back`);
  return parts.join(" · ");
}

export function impactReply({ skipped, recovered, co2Kg }: Impact): string {
  if (skipped === 0 && recovered === 0) return "Nothing yet. Text 'do I have this?' next time you're shopping.";
  const lines = [
    recovered > 0
      ? `You've skipped ${plural(skipped, "purchase", "purchases")} and gotten ${money(recovered)} back.`
      : `You've skipped ${plural(skipped, "purchase", "purchases")}.`,
  ];
  if (co2Kg > 0) lines.push(`Not making ${skipped === 1 ? "it" : "those"} saved ${describeKg(co2Kg)}. That's an estimate from Carbonfact's averages per item type.`);
  if (skipped > 0) lines.push(`That's ${plural(skipped, "fewer thing", "fewer things")} in your closet you didn't need.`);
  return lines.join("\n");
}
