import type { Db } from "./db/client.ts";
import { addDays, formatDay } from "./closet/dates.ts";
import { recordRecovered } from "./impact.ts";
import { VERIFY } from "./orders.ts";

// Return nudges. Once a day the scheduler (index.ts) claims purchases still
// 'kept' whose return window closes within NUDGE_DAYS and whose item hasn't
// shown up in a fit check since the order, and asks "keep or return?".
// Claiming sets nudged_at before sending, so each purchase is nudged once
// even across restarts; a failed send releases the claim.
//
// Answers: "keep" leaves it; "return" marks the purchase 'returning' and the
// item 'returned' and links the retailer's returns page; "returned it" later
// marks it 'returned'. Either move counts its price as money back, once
// (impact.ts). "check returns" runs the check now, any deadline, but skips
// orders from the last week: a just-sent order hasn't had time to be worn.

export const NUDGE_DAYS = 3;
export const CHECK_MIN_AGE_DAYS = 7;

export interface Nudge {
  purchaseId: string;
  userId: string;
  text: string;
}

/**
 * Claims the nudges that are due. Without `anyDeadline`, only windows closing
 * within NUDGE_DAYS; windows already closed never count. With `minAgeDays`,
 * only orders at least that many days old. Worn items aren't claimed, so
 * they're simply never nudged.
 */
export async function claimNudges(
  db: Db,
  opts: { today: string; userId?: string; anyDeadline?: boolean; minAgeDays?: number },
): Promise<Nudge[]> {
  const until = opts.anyDeadline ? null : addDays(opts.today, NUDGE_DAYS);
  const orderedBy = opts.minAgeDays === undefined ? null : addDays(opts.today, -opts.minAgeDays);
  const rows = await db.query<{ id: string; user_id: string; retailer: string; deadline: string; description: string }>(
    `UPDATE purchases p SET nudged_at = now()
     FROM items i
     WHERE i.purchase_id = p.id::text AND i.status = 'active'
       AND p.status = 'kept' AND p.nudged_at IS NULL
       AND p.return_deadline >= $1::date
       AND ($2::date IS NULL OR p.return_deadline <= $2::date)
       AND ($3::text IS NULL OR p.user_id = $3)
       AND ($4::date IS NULL OR p.order_date <= $4::date)
       -- worn in a fit check taken after the order: it's staying
       AND NOT EXISTS (
         SELECT 1 FROM wears w JOIN outfits o ON o.id = w.outfit_id
         WHERE w.item_id = i.id AND o.taken_on > p.order_date)
     RETURNING p.id, p.user_id, p.retailer, to_char(p.return_deadline, 'YYYY-MM-DD') AS deadline, i.description`,
    [opts.today, until, opts.userId ?? null, orderedBy],
  );
  return rows
    .sort((a, b) => a.deadline.localeCompare(b.deadline))
    .map((r) => ({
      purchaseId: r.id,
      userId: r.user_id,
      text: `You haven't worn the ${r.description} from ${r.retailer} in any fit checks yet. Return window closes ${formatDay(r.deadline)}. Keeping it? Reply keep or return.`,
    }));
}

/** Undoes a claim whose message didn't go out, so the next run retries it. */
export async function releaseNudge(db: Db, purchaseId: string): Promise<void> {
  await db.query(`UPDATE purchases SET nudged_at = NULL WHERE id = $1`, [purchaseId]);
}

interface OpenPurchase {
  id: string;
  item_id: number;
  description: string;
  retailer: string;
  returns_url: string | null;
}

// Nudged and not answered yet (status 'kept'), or on its way back ('returning').
async function openPurchases(db: Db, userId: string, stage: "nudged" | "returning"): Promise<OpenPurchase[]> {
  return db.query<OpenPurchase>(
    `SELECT p.id, i.id AS item_id, i.description, p.retailer, rp.returns_url
     FROM purchases p
       JOIN items i ON i.purchase_id = p.id::text
       LEFT JOIN return_policies rp ON rp.retailer = p.retailer
     WHERE p.user_id = $1 AND ${
       stage === "nudged" ? `p.status = 'kept' AND p.nudged_at IS NOT NULL AND p.nudge_answer IS NULL` : `p.status = 'returning'`
     }
     ORDER BY p.nudged_at, p.id`,
    [userId],
  );
}

const ANSWER = /^(?:i'?ll |i will |i'?m |im )?(keep|keeping|return|returning)(?: (?:it|this|that|them|the item))?(?: #?(\d+))?$/;
const RETURNED = /^(?:i |just )?(?:already )?returned(?: (?:it|this|that|them))?(?: #?(\d+))?$/;
const CHECK = /^(?:check|show|any) (?:my )?returns?$/;

/**
 * Handles "keep", "return", "returned it" and "check returns"; undefined for
 * other texts, including "keep"/"return" when no nudge is waiting on an answer.
 */
export async function handleReturnsText(db: Db, userId: string, text: string, today: string): Promise<string[] | undefined> {
  const t = text.trim().toLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g, " ");

  if (CHECK.test(t)) {
    const nudges = await claimNudges(db, { today, userId, anyDeadline: true, minAgeDays: CHECK_MIN_AGE_DAYS });
    if (nudges.length) return nudges.map((n) => n.text);
    const [recent] = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM purchases
       WHERE user_id = $1 AND status = 'kept' AND nudged_at IS NULL AND order_date > $2::date`,
      [userId, addDays(today, -CHECK_MIN_AGE_DAYS)],
    );
    const wait = recent!.n ? ` Orders from the last ${CHECK_MIN_AGE_DAYS} days get a week to show up in a fit check first.` : "";
    return [`Nothing to check: everything you ordered with an open return window has shown up in a fit check or already got asked about.${wait}`];
  }

  const answer = ANSWER.exec(t);
  if (answer) {
    const waiting = await openPurchases(db, userId, "nudged");
    if (!waiting.length) return undefined;
    const keep = answer[1]!.startsWith("keep");
    const chosen = pick(waiting, answer[2]);
    if (!chosen) return [whichOne(waiting, keep ? "keep" : "return")];
    return [keep ? await keepIt(db, chosen) : await returnIt(db, chosen)];
  }

  const returned = RETURNED.exec(t);
  if (returned) {
    const returning = await openPurchases(db, userId, "returning");
    if (!returning.length) return ["I don't have a return in progress for you."];
    const chosen = pick(returning, returned[1]);
    if (!chosen) return [whichOne(returning, "returned")];
    await db.query(`UPDATE purchases SET status = 'returned' WHERE id = $1`, [chosen.id]);
    await recordRecovered(db, chosen.id); // no-op if "return" already counted it
    return [`Marked the ${chosen.description} from ${chosen.retailer} as returned.`];
  }
  return undefined;
}

/** The only one, or the numbered one; undefined if that's ambiguous or out of range. */
function pick(list: OpenPurchase[], number: string | undefined): OpenPurchase | undefined {
  if (number === undefined) return list.length === 1 ? list[0] : undefined;
  return list[Number(number) - 1];
}

function whichOne(list: OpenPurchase[], verb: string): string {
  return [
    "Which one?",
    ...list.map((p, i) => `${i + 1}. ${p.description} from ${p.retailer}`),
    `Reply like "${verb} 1".`,
  ].join("\n");
}

async function keepIt(db: Db, p: OpenPurchase): Promise<string> {
  await db.query(`UPDATE purchases SET nudge_answer = 'keep' WHERE id = $1`, [p.id]);
  return `Got it, you're keeping the ${p.description}.`;
}

async function returnIt(db: Db, p: OpenPurchase): Promise<string> {
  await db.query(`UPDATE purchases SET status = 'returning', nudge_answer = 'return' WHERE id = $1`, [p.id]);
  await db.query(`UPDATE items SET status = 'returned' WHERE id = $1`, [p.item_id]);
  await recordRecovered(db, p.id);
  return [
    `Okay, the ${p.description} is marked as returning.`,
    p.returns_url ? `Start the return here: ${p.returns_url}` : `Start the return on ${p.retailer}'s site.`,
    'Text "returned it" once it\'s sent back.',
    VERIFY,
  ].join("\n");
}
