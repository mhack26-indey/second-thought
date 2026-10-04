import type { Climate } from "./climate.ts";
import type { Db } from "./db/client.ts";
import { isPlural } from "./footprint.ts";
import { type Band, bandOf, describeMonths, seasonMonths, weatherName } from "./seasons.ts";

// "What happened to this?": an item that's gone about three weeks of its own
// season unworn while they've kept sending fit checks gets asked about, with
// the answers listed. Seasons come from the city's climate (seasons.ts), so a
// puffer in Ann Arbor is asked about in winter and never in Miami.
//
// The question and what it's waiting for live in item_checkins, so a restart
// doesn't lose them.

export const UNWORN_DAYS = 21; // in-season days without a wear before asking
export const ASK_EVERY_DAYS = 7; // at most one question a week per user
export const SNOOZE_DAYS = 21; // "still love it": leave it for another three weeks
// Photos often miss these, so "unworn" would just mean "not spotted".
const SKIP_CATEGORIES = new Set(["accessory", "jewelry"]);

export interface Ghost {
  itemId: number;
  description: string;
  type: string;
  inSeasonDays: number; // in-season days since it was last worn (or added)
  fitChecks: number; // fit checks they sent in those days
  months: number[];
  band: Band;
}

const DAY = 86_400_000;
const dayOf = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Items in season and unworn for at least `minDays` in-season days, while
 * they kept sending fit checks (at least one a week on average over that
 * time), most overdue first. Snoozed, occasion-only and skipped categories
 * are left out.
 */
export async function findGhosts(db: Db, userId: string, climate: Climate, today = new Date(), minDays = UNWORN_DAYS): Promise<Ghost[]> {
  const items = await db.query<{ id: number; description: string; type: string; category: string; season: string; since: Date }>(
    `SELECT i.id, i.description, i.type, i.category, i.season,
       coalesce((SELECT max(o.taken_on) FROM wears w JOIN outfits o ON o.id = w.outfit_id WHERE w.item_id = i.id), i.created_at::date) AS since
     FROM items i LEFT JOIN item_checkins c ON c.item_id = i.id
     WHERE i.user_id = $1 AND i.status = 'active'
       AND NOT coalesce(c.occasion_only, false)
       AND (c.snooze_until IS NULL OR c.snooze_until <= $2::date)`,
    [userId, today.toISOString().slice(0, 10)],
  );
  const fitDays = new Set(
    (await db.query<{ taken_on: Date }>(`SELECT DISTINCT taken_on FROM outfits WHERE user_id = $1`, [userId])).map((r) =>
      dayOf(new Date(r.taken_on)),
    ),
  );

  const ghosts: Ghost[] = [];
  for (const item of items) {
    if (SKIP_CATEGORIES.has(item.category)) continue;
    const band = bandOf(item.type, item.season);
    const months = seasonMonths(band, climate);
    if (!months.length || !months.includes(today.getMonth())) continue; // not its season here, or not now
    // Count the in-season days after it was last worn, through today.
    let inSeasonDays = 0;
    let fitChecks = 0;
    for (let t = dayOf(new Date(item.since)) + DAY; t <= dayOf(today); t += DAY) {
      if (!months.includes(new Date(t).getUTCMonth())) continue;
      inSeasonDays++;
      if (fitDays.has(t)) fitChecks++;
    }
    const active = fitChecks >= Math.floor(inSeasonDays / 7);
    if (inSeasonDays >= minDays && active && fitChecks > 0) {
      ghosts.push({ itemId: item.id, description: item.description, type: item.type, inSeasonDays, fitChecks, months, band });
    }
  }
  return ghosts.sort((a, b) => b.inSeasonDays - a.inSeasonDays);
}

const weeks = (days: number) => (days < 14 ? `${days} days` : `${Math.round(days / 7)} weeks`);

export const ANSWERS = [
  "Still love it, just haven't worn it",
  "Only for special occasions",
  "It's in storage or somewhere else",
  "It doesn't fit or I don't love it anymore",
  "Sold, donated or returned it",
  "It broke, or I threw it away",
];

/** The question, with the answers listed. */
export function ghostQuestion(g: Ghost, city: string): string {
  const town = city.split(",")[0];
  const when = g.band === "all_year" ? "" : ` (${describeMonths(g.months)} in ${town})`;
  const span = g.band === "all_year" ? `in ${weeks(g.inSeasonDays)}` : `in ${weeks(g.inSeasonDays)} of ${weatherName(g.type, g.band)}${when}`;
  return [
    `Your ${g.description} ${isPlural(g.type) ? "haven't" : "hasn't"} come out ${span}, across ${g.fitChecks} fit check${g.fitChecks === 1 ? "" : "s"}. What's up with it?`,
    ...ANSWERS.map((a, i) => `${i + 1}. ${a}`),
    "Reply with a number.",
  ].join("\n");
}

/** Records that the bot asked about this item, so the answer can find it. */
export async function markAsked(db: Db, userId: string, itemId: number, today = new Date()): Promise<void> {
  await db.query(
    `INSERT INTO item_checkins (item_id, user_id, asked_at, awaiting) VALUES ($1, $2, now(), 'answer')
     ON CONFLICT (item_id) DO UPDATE SET asked_at = now(), awaiting = 'answer'`,
    [itemId, userId],
  );
  await db.query(`UPDATE users SET last_checkin_ask = $2::date WHERE id = $1`, [userId, today.toISOString().slice(0, 10)]);
}

/** The item the bot is waiting on an answer about (asked in the last 3 days), if any. */
export async function pendingCheckin(db: Db, userId: string) {
  const [row] = await db.query<{ item_id: number; awaiting: string; description: string; type: string; purchase_id: string | null }>(
    `SELECT c.item_id, c.awaiting, i.description, i.type, i.purchase_id
     FROM item_checkins c JOIN items i ON i.id = c.item_id
     WHERE c.user_id = $1 AND c.awaiting IS NOT NULL AND c.asked_at > now() - interval '3 days' AND i.status = 'active'
     ORDER BY c.asked_at DESC LIMIT 1`,
    [userId],
  );
  return row;
}

export async function setCheckin(
  db: Db,
  itemId: number,
  patch: { awaiting?: string | null; snoozeDays?: number; occasionOnly?: boolean },
): Promise<void> {
  await db.query(
    `UPDATE item_checkins SET
       awaiting = CASE WHEN $2 THEN $3 ELSE awaiting END,
       snooze_until = CASE WHEN $4::int IS NULL THEN snooze_until ELSE current_date + $4::int END,
       occasion_only = coalesce($5, occasion_only)
     WHERE item_id = $1`,
    [itemId, "awaiting" in patch, patch.awaiting ?? null, patch.snoozeDays ?? null, patch.occasionOnly ?? null],
  );
}

/** "1".."6", or the same answers in words. */
export function parseCheckinAnswer(text: string): number | undefined {
  const t = text.trim().toLowerCase().replace(/[.!?]+$/, "");
  const n = /^#?([1-6])\b/.exec(t);
  if (n) return Number(n[1]);
  if (/\b(love it|keep(?:ing)? it|still (?:wear|like|love)|haven'?t (?:gotten|had) (?:a chance|around))\b/.test(t)) return 1;
  if (/\b(occasions?|formal|weddings?|events?|interviews?|special)\b/.test(t)) return 2;
  if (/\b(storage|stored|at my (?:mom|dad|parent)|in the (?:attic|basement|closet)|bin)\b/.test(t)) return 3;
  if (/\b(doesn'?t fit|too (?:small|big|tight|loose)|don'?t (?:like|love|wear)|outgrew)\b/.test(t)) return 4;
  // Broken or worn out goes with thrown away: either way it's done.
  if (/\b(threw|thrown|trash\w*|toss\w*|garbage|binned|broke|broken|ripped|torn|holes?|fell apart|worn out|wore (?:it )?out)\b/.test(t)) return 6;
  if (/\b(sold|donat\w*|gave (?:it )?away|returned)\b/.test(t)) return 5;
  return undefined;
}
