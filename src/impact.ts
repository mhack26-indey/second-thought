import type { Db } from "./db/client.ts";
import { describeKg, footprintOf } from "./footprint.ts";
import { money } from "./orders.ts";

// The impact counter: purchases skipped because a shopping check found
// something they already own, items returned, and items sold or donated, with
// the money back from returns and sales. Thrown away counts nothing. Counts and money are what actually happened.
// The CO₂ is an estimate per item type (footprint.ts, Carbonfact category
// averages), always labeled as one: for a skip, the new item that wasn't
// made; for a return, sale or donation, the new item someone else doesn't need
// to buy when this one is worn again.

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
  returned: number; // purchases sent back
  sold: number; // items sold
  donated: number; // items donated
  recovered: number; // dollars back from returns and sales
  co2Kg: number; // estimated, for item types with a known footprint
}

export type ImpactKind = "avoided" | "recovered" | "sold" | "donated";

/** One counted event, for the wardrobe page's list. */
export interface ImpactEntry {
  kind: ImpactKind;
  at: Date;
  description: string; // the item: for a skip, the owned item it matched
  type: string;
  amount: number | null;
  co2Kg: number | null;
}

export async function impactHistory(db: Db, userId: string): Promise<ImpactEntry[]> {
  const rows = await db.query<{ kind: ImpactKind; created_at: Date; description: string; type: string; amount: string | null }>(
    `SELECT e.kind, e.created_at, i.description, i.type, e.amount::text AS amount
     FROM impact_events e JOIN items i ON i.id = e.item_id
     WHERE e.user_id = $1 ORDER BY e.created_at DESC`,
    [userId],
  );
  return rows.map((r) => ({
    kind: r.kind,
    at: r.created_at,
    description: r.description,
    type: r.type,
    amount: r.amount === null ? null : Number(r.amount),
    co2Kg: footprintOf(r.type),
  }));
}

export async function impactTotals(db: Db, userId: string): Promise<Impact> {
  const history = await impactHistory(db, userId);
  const count = (kind: ImpactKind) => history.filter((h) => h.kind === kind).length;
  return {
    skipped: count("avoided"),
    returned: count("recovered"),
    sold: count("sold"),
    donated: count("donated"),
    recovered: history.filter((h) => h.kind !== "avoided").reduce((sum, h) => sum + (h.amount ?? 0), 0),
    co2Kg: history.reduce((sum, h) => sum + (h.co2Kg ?? 0), 0),
  };
}

export type LetGo = "returned" | "sold" | "donated" | "trashed";

/**
 * They let an item go. Returned marks its order returned (money back, once);
 * sold or donated counts once per item; thrown away just leaves the closet.
 * False if the item isn't theirs or is already gone.
 */
export async function letGo(db: Db, userId: string, itemId: number, how: LetGo, price: number | null = null): Promise<boolean> {
  // One of several identical pieces: one fewer, and the item stays.
  const [fewer] = await db.query<{ purchase_id: string | null }>(
    `UPDATE items SET quantity = quantity - 1 WHERE id = $2 AND user_id = $1 AND status = 'active' AND quantity > 1 RETURNING purchase_id`,
    [userId, itemId],
  );
  const [item] = fewer
    ? [fewer]
    : await db.query<{ purchase_id: string | null }>(
        `UPDATE items SET status = $3 WHERE id = $2 AND user_id = $1 AND status = 'active' RETURNING purchase_id`,
        [userId, itemId, how === "returned" ? "returned" : "removed"],
      );
  if (!item) return false;
  if (how === "returned" && item.purchase_id) {
    await db.query(`UPDATE purchases SET status = 'returned' WHERE id::text = $1 AND user_id = $2`, [item.purchase_id, userId]);
    await recordRecovered(db, item.purchase_id);
  } else if (how === "sold" || how === "donated") {
    await db.query(`INSERT INTO impact_events (user_id, kind, amount, item_id) VALUES ($1, $2, $3, $4)`, [
      userId,
      how,
      how === "sold" ? price : null,
      itemId,
    ]);
  }
  return true;
}

/** Sets how many identical pieces an item is (1–99); false if it isn't theirs. */
export async function setQuantity(db: Db, userId: string, itemId: number, quantity: number): Promise<boolean> {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) return false;
  const rows = await db.query(`UPDATE items SET quantity = $3 WHERE id = $2 AND user_id = $1 AND status = 'active' RETURNING id`, [
    userId,
    itemId,
    quantity,
  ]);
  return rows.length > 0;
}

/** "sold it for $20", "donated", "tossed it" -> how and the price, if any. */
export function parseLetGo(text: string): { how: LetGo; price: number | null } | undefined {
  const t = text.toLowerCase();
  const price = Number(/\$?\s*(\d+(?:\.\d{1,2})?)/.exec(t)?.[1]) || null;
  if (/\b(sold|sell|depop|poshmark|ebay|vinted)\b/.test(t)) return { how: "sold", price };
  if (/\b(donat\w*|gave (?:it )?away|goodwill|thrift|gave it to)\b/.test(t)) return { how: "donated", price: null };
  if (/\b(return\w*|sent (?:it )?back)\b/.test(t)) return { how: "returned", price: null };
  if (/\b(threw|throw|thrown|trash\w*|toss\w*|garbage|binned|bin|ripped|torn|broke|broken|holes?|fell apart|worn out)\b/.test(t)) return { how: "trashed", price: null };
  return undefined;
}

/**
 * What to say when an item is thrown away or broke: how long it lasted. A
 * piece that didn't make it a year is a sign to buy sturdier next time, and
 * the reply says so plainly; one that did had a good run.
 */
export function tossMessage(description: string, plural: boolean, since: Date, wears: number, now = new Date()): string {
  const days = Math.max(1, Math.round((now.getTime() - since.getTime()) / 86_400_000));
  const span =
    days >= 730 ? `${Math.floor(days / 365)} years` : days >= 60 ? `${Math.round(days / 30)} months` : days >= 14 ? `${Math.round(days / 7)} weeks` : `${days} day${days === 1 ? "" : "s"}`;
  const they = plural ? "They" : "It";
  const wore = `${wears} wear${wears === 1 ? "" : "s"}`;
  const life =
    days < 365
      ? `${they} only lasted ${span} and ${wore}. That's a short life for clothes; next time, sturdier pieces (or good secondhand ones) are worth paying for.`
      : `${they} had a good run: ${span} and ${wore}.`;
  return `Removed your ${description}. ${life} Textile recycling keeps even broken clothes out of landfill.`;
}

/**
 * A shopping match counts as skipped right away, but they may buy it anyway:
 * "I didn't skip it" takes back the latest skip from the last week.
 * Returns what it matched, or undefined if there was nothing to take back.
 */
export async function undoLastSkip(db: Db, userId: string): Promise<string | undefined> {
  const [row] = await db.query<{ description: string }>(
    `WITH last AS (
       SELECT id, item_id FROM impact_events
       WHERE user_id = $1 AND kind = 'avoided' AND created_at > now() - interval '7 days'
       ORDER BY created_at DESC LIMIT 1),
     gone AS (DELETE FROM impact_events e USING last WHERE e.id = last.id RETURNING last.item_id)
     SELECT i.description FROM gone JOIN items i ON i.id = gone.item_id`,
    [userId],
  );
  return row?.description;
}

const UNSKIP = /^(?:(?:oh|oops|nah|actually|lol),? )?(?:i )?(?:didn'?t|did not|didnt) skip(?: it| that(?: one)?)?(?:,? i bought it)?$|^(?:i )?(?:bought|got) it anyway$/;

export function isUnskip(text: string): boolean {
  return UNSKIP.test(text.trim().toLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g, " "));
}

const IMPACT_ASK = /^(?:what'?s |show )?(?:my )?(?:impact|stats)$|^how am i doing$/;

export function isImpactAsk(text: string): boolean {
  return IMPACT_ASK.test(text.trim().toLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g, " "));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Skipped 2 · Sold 1 · ≈ 50 kg CO₂e saved · $40.00 back" for the wardrobe page; zeros are left out. */
export function impactSummary({ skipped, returned, sold, donated, recovered, co2Kg }: Impact): string {
  if (skipped + returned + sold + donated === 0) return "Nothing skipped yet";
  const parts = [
    skipped && `Skipped ${plural(skipped, "purchase", "purchases")}`,
    returned && `Returned ${returned}`,
    sold && `Sold ${sold}`,
    donated && `Donated ${donated}`,
    co2Kg > 0 && `≈ ${Math.round(co2Kg)} kg CO₂e saved`,
    recovered > 0 && `${money(recovered)} back`,
  ].filter(Boolean);
  return parts.join(" · ");
}

export function impactReply({ skipped, returned, sold, donated, recovered, co2Kg }: Impact): string {
  if (skipped + returned + sold + donated === 0) return "Nothing yet. Text 'do I have this?' next time you're shopping.";
  const did = [
    skipped && `skipped ${plural(skipped, "purchase", "purchases")}`,
    returned && `returned ${plural(returned, "item", "items")}`,
    sold && `sold ${plural(sold, "item", "items")}`,
    donated && `donated ${plural(donated, "item", "items")}`,
  ].filter(Boolean) as string[];
  const list = did.length > 1 ? `${did.slice(0, -1).join(", ")} and ${did.at(-1)}` : did[0]!;
  const lines = [recovered > 0 ? `You've ${list}, and gotten ${money(recovered)} back.` : `You've ${list}.`];
  if (co2Kg > 0) lines.push(`That saved ${describeKg(co2Kg)}. That's an estimate from Carbonfact's averages per item type.`);
  if (skipped > 0) lines.push(`That's ${plural(skipped, "fewer thing", "fewer things")} in your closet you didn't need.`);
  return lines.join("\n");
}
