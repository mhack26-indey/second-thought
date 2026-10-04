import type { Db } from "./db/client.ts";
import { footprintOf } from "./footprint.ts";

// The recap card's numbers for one period: "your last 30 days" on demand, and
// the previous calendar month on the 1st. Everything here is what happened in
// the period, read from the closet and impact tables; the CO₂ is the same
// labeled estimate as the impact counter (footprint.ts).

export interface Recap {
  title: string; // "Your last 30 days", "September 2026"
  fitChecks: number;
  itemsWorn: number; // distinct items in the period's fit checks
  closetSize: number; // active items now
  // The most-worn piece in each category (shoes always win overall, so it's per
  // category), worn at least twice, in CATEGORY_ORDER, at most four.
  favorites: { description: string; category: string; wears: number; photoUrl: string | null }[];
  ghosts: string[]; // in the closet a while, not worn in the period (all of them; the card shows a few)
  newItems: number;
  skipped: number;
  letGo: number; // returned, sold or donated in the period
  moneyBack: number;
  co2Kg: number;
}

const CATEGORY_ORDER = ["top", "bottom", "outerwear", "shoes", "dress", "accessory", "jewelry"];
const MAX_FAVORITES = 4;

// An item added in the last two weeks hasn't had a fair chance to be worn yet.
const GHOST_GRACE_DAYS = 14;

/** The recap for fit checks taken in [from, to), dates as YYYY-MM-DD. */
export async function buildRecap(db: Db, userId: string, from: string, to: string, title: string): Promise<Recap> {
  const [counts] = await db.query<{ fit_checks: number; closet: number; new_items: number }>(
    `SELECT
       (SELECT count(*)::int FROM outfits WHERE user_id = $1 AND taken_on >= $2::date AND taken_on < $3::date) AS fit_checks,
       (SELECT count(*)::int FROM items WHERE user_id = $1 AND status = 'active') AS closet,
       (SELECT count(*)::int FROM items WHERE user_id = $1 AND created_at >= $2::date AND created_at < $3::date) AS new_items`,
    [userId, from, to],
  );

  // Wears in the period, per active item, most worn first (latest wear breaks ties).
  const worn = await db.query<{ description: string; category: string; photo_url: string | null; wears: number }>(
    `SELECT i.description, i.category, i.photo_url, count(*)::int AS wears
     FROM wears w JOIN outfits o ON o.id = w.outfit_id JOIN items i ON i.id = w.item_id
     WHERE o.user_id = $1 AND o.taken_on >= $2::date AND o.taken_on < $3::date AND i.status = 'active'
     GROUP BY i.id ORDER BY count(*) DESC, max(o.taken_on) DESC, i.id`,
    [userId, from, to],
  );

  const ghosts = await db.query<{ description: string }>(
    `SELECT i.description FROM items i
     WHERE i.user_id = $1 AND i.status = 'active' AND i.created_at < $3::date - $4::int
       AND NOT EXISTS (
         SELECT 1 FROM wears w JOIN outfits o ON o.id = w.outfit_id
         WHERE w.item_id = i.id AND o.taken_on >= $2::date AND o.taken_on < $3::date)
     ORDER BY i.created_at, i.id`,
    [userId, from, to, GHOST_GRACE_DAYS],
  );

  const impact = await db.query<{ kind: string; type: string; amount: string | null }>(
    `SELECT e.kind, i.type, e.amount::text AS amount
     FROM impact_events e JOIN items i ON i.id = e.item_id
     WHERE e.user_id = $1 AND e.created_at >= $2::date AND e.created_at < $3::date`,
    [userId, from, to],
  );

  // worn is most-worn first, so the first one seen in a category is its favorite.
  const favorites = CATEGORY_ORDER.flatMap((category) => {
    const top = worn.find((w) => w.category === category && w.wears > 1);
    return top ? [{ description: top.description, category, wears: top.wears, photoUrl: top.photo_url }] : [];
  }).slice(0, MAX_FAVORITES);
  return {
    title,
    fitChecks: counts!.fit_checks,
    itemsWorn: worn.length,
    closetSize: counts!.closet,
    favorites,
    ghosts: ghosts.map((g) => g.description),
    newItems: counts!.new_items,
    skipped: impact.filter((e) => e.kind === "avoided").length,
    letGo: impact.filter((e) => e.kind !== "avoided").length,
    moneyBack: impact.filter((e) => e.kind !== "avoided").reduce((sum, e) => sum + Number(e.amount ?? 0), 0),
    co2Kg: impact.reduce((sum, e) => sum + (footprintOf(e.type) ?? 0), 0),
  };
}

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "Your last 30 days", through today. */
export function last30Days(today = new Date()): { from: string; to: string; title: string } {
  const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
  return { from: ymd(from), to: ymd(to), title: "Your last 30 days" };
}

/** The calendar month before `today`'s, for the recap sent on the 1st. */
export function previousMonth(today = new Date()): { from: string; to: string; title: string; key: string } {
  const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const to = new Date(today.getFullYear(), today.getMonth(), 1);
  const title = from.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return { from: ymd(from), to: ymd(to), title, key: ymd(from).slice(0, 7) };
}

/** The recap as a text message, for when the image can't be made. */
export function recapText(r: Recap): string {
  const lines = [`${r.title}: ${r.fitChecks} fit check${r.fitChecks === 1 ? "" : "s"}, ${r.itemsWorn} of your ${r.closetSize} pieces worn.`];
  if (r.favorites.length) lines.push(`Most worn: ${r.favorites.map((f) => `${f.description} (${f.wears}×)`).join(", ")}.`);
  if (r.ghosts.length) lines.push(`Didn't get worn: ${r.ghosts.slice(0, 3).join(", ")}${r.ghosts.length > 3 ? ` and ${r.ghosts.length - 3} more` : ""}.`);
  if (r.skipped || r.letGo) lines.push(`Skipped ${r.skipped}, let go of ${r.letGo}${r.co2Kg > 0 ? `, ≈ ${Math.round(r.co2Kg)} kg CO₂e saved (est.)` : ""}.`);
  return lines.join("\n");
}
