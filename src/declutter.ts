import type { Climate } from "./climate.ts";
import { formatDay } from "./closet/dates.ts";
import type { Db } from "./db/client.ts";
import { describeKg, footprintOf, isPlural } from "./footprint.ts";
import { findGhosts } from "./ghosts.ts";
import { type LetGo, letGo } from "./impact.ts";
import { money } from "./orders.ts";
import { bandOf, seasonMonths, weatherName } from "./seasons.ts";
import { type Profile, sizedQuery } from "./profile.ts";
import type { Reply } from "./shopping-mode.ts";

// "What should I get rid of?" Every pick comes from their own data, worked
// out here in code: closet ghosts (ghosts.ts: unworn through its own season,
// so a puffer is never flagged in July), near-duplicates the vision
// comparison saw (item_alike) where one is worn far less, and pieces never
// worn since they were added. Anything added or worn in the last 30 days is
// left alone. Each pick gets an exit: return it while the window's open (money
// back), otherwise resell it, timed to when people buy that kind of thing, or
// donate a plain basic.

export const RECENT_DAYS = 30;
export const RETURNABLE_GRACE_DAYS = 7; // a returnable order gets a week to be worn first (as "check returns" does)
export const TOP = 5;
const SKIP = new Set(["accessory", "jewelry"]); // photos miss these, so "unworn" means little
const BASICS = new Set(["t-shirt", "tank top", "leggings"]); // plain ones rarely resell
const PLAIN = new Set(["solid", "plain", "unknown"]);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export interface ExitLink {
  label: string;
  url: string;
}

export interface LetGoPick {
  itemId: number;
  description: string;
  photoUrl: string | null;
  reasons: string[];
  exit: { kind: "return" | "resell" | "donate"; text: string; links: ExitLink[] };
  deadline: string | null; // YYYY-MM-DD, if it can still go back
}

interface Row {
  id: number;
  description: string;
  type: string;
  category: string;
  season: string;
  pattern: string;
  color_primary: string;
  photo_url: string | null;
  created_at: Date;
  wears: number;
  last_worn: string | null;
  deadline: string | null;
  retailer: string | null;
  returns_url: string | null;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** "2 navy polos", "2 pairs of black jeans" */
function two(row: Row): string {
  const color = row.color_primary === "unknown" ? "" : `${row.color_primary} `;
  if (isPlural(row.type)) return `2 pairs of ${color}${row.type}`;
  return `2 ${color}${/(s|x|sh|ch)$/.test(row.type) ? `${row.type}es` : `${row.type}s`}`;
}

/** Whether it's this item's season now, so nothing gets flagged off-season. */
function inSeason(row: Row, climate: Climate | undefined, month: number): boolean {
  const band = bandOf(row.type, row.season);
  if (band === "all_year") return true;
  if (!climate) return false; // can't tell which months suit it here
  return seasonMonths(band, climate).includes(month);
}

/**
 * When to list it: warm-weather pieces in spring, cold-weather ones in fall
 * (shifted six months south of the equator), anything else any time.
 */
function listingTime(row: Row, climate: Climate | undefined, month: number): string {
  const band = bandOf(row.type, row.season);
  if (band === "all_year") return "";
  const south = climate !== undefined && climate.highsC[0]! > climate.highsC[6]!;
  const warm = "minHighF" in band;
  const start = (warm ? 2 : 8) + (south ? 6 : 0); // March (spring) or September (fall), north
  const buying = [start, start + 1, start + 2].map((m) => m % 12);
  const noun = isPlural(row.type) || row.type.endsWith("s") ? row.type : `${row.type}s`;
  if (buying.includes(month)) return ` now, while people are buying ${noun}`;
  return ` in ${MONTHS[start % 12]}, when people buy ${noun}`;
}

type Sizes = Pick<Profile, "sizeTop" | "sizeBottom" | "sizeShoe">;

function exitFor(row: Row, climate: Climate | undefined, month: number, sizes?: Sizes | null): LetGoPick["exit"] {
  if (row.deadline) {
    const links = row.returns_url ? [{ label: `${row.retailer} returns`, url: row.returns_url }] : [];
    return { kind: "return", text: `Return it by ${formatDay(row.deadline)}${row.retailer ? ` (${row.retailer})` : ""} and get your money back`, links };
  }
  if (BASICS.has(row.type) && PLAIN.has(row.pattern)) return { kind: "donate", text: "Donate it: plain basics rarely resell", links: [] };
  // In their size, so the price check shows what theirs would sell for.
  const q = encodeURIComponent(sizedQuery(row.description, row.category, sizes));
  return {
    kind: "resell",
    text: `Resell it${listingTime(row, climate, month)}: "${row.description.charAt(0).toUpperCase()}${row.description.slice(1)}"`,
    links: [
      { label: "Depop", url: `https://www.depop.com/search/?q=${q}` },
      { label: "eBay", url: `https://www.ebay.com/sch/i.html?_nkw=${q}` },
    ],
  };
}

/** Up to TOP picks, returnable first (money back, and a deadline), then by how strong the case is. */
export async function declutterPicks(db: Db, userId: string, climate: Climate | undefined, today = new Date(), sizes?: Sizes | null): Promise<LetGoPick[]> {
  const rows = await db.query<Row>(
    `SELECT i.id, i.description, i.type, i.category, i.season, i.pattern, i.color_primary, i.photo_url, i.created_at,
       count(w.outfit_id)::int AS wears, to_char(max(o.taken_on), 'YYYY-MM-DD') AS last_worn,
       to_char(p.return_deadline, 'YYYY-MM-DD') AS deadline, p.retailer, rp.returns_url
     FROM items i
       LEFT JOIN wears w ON w.item_id = i.id LEFT JOIN outfits o ON o.id = w.outfit_id
       LEFT JOIN purchases p ON p.id::text = i.purchase_id AND p.status = 'kept' AND p.return_deadline >= $2::date
       LEFT JOIN return_policies rp ON rp.retailer = p.retailer
     WHERE i.user_id = $1 AND i.status = 'active'
     GROUP BY i.id, p.id, rp.returns_url`,
    [userId, ymd(today)],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const cutoff = new Date(today.getTime() - RECENT_DAYS * 86_400_000);
  const graced = new Date(today.getTime() - RETURNABLE_GRACE_DAYS * 86_400_000);
  // Settled: added over 30 days ago and not worn in 30 days. An order that can
  // still go back only needs a week, or a 30-day window would close before
  // anything could suggest returning it.
  const added = (r: Row) => new Date(r.created_at) <= (r.deadline ? graced : cutoff);
  const settled = (r: Row) => added(r) && (r.last_worn === null || r.last_worn < ymd(cutoff));
  const month = today.getMonth();

  const found = new Map<number, { reasons: string[]; score: number }>();
  const add = (id: number, reason: string, score: number) => {
    const f = found.get(id) ?? { reasons: [], score: 0 };
    f.reasons.push(reason);
    f.score = Math.max(f.score, score) + (f.reasons.length > 1 ? 0.5 : 0);
    found.set(id, f);
  };

  // Near-duplicates: of two similar pieces, the one worn far less.
  const pairs = await db.query<{ item_id: number; other_id: number }>(
    `SELECT a.item_id, a.other_id FROM item_alike a JOIN items i ON i.id = a.item_id WHERE i.user_id = $1`,
    [userId],
  );
  for (const pair of pairs) {
    const [a, b] = [byId.get(pair.item_id), byId.get(pair.other_id)];
    if (!a || !b) continue; // one of them is gone
    const [more, less] = a.wears >= b.wears ? [a, b] : [b, a];
    const far = more.wears >= 2 && (less.wears === 0 || more.wears / less.wears >= 3);
    if (!far || !settled(less) || !inSeason(less, climate, month)) continue;
    const ratio = less.wears === 0 ? null : Math.round(more.wears / less.wears);
    add(
      less.id,
      ratio === null
        ? `You have ${two(less)}; you've worn the other ${more.wears}× and this one never`
        : `You have ${two(less)}; you wear the other one ${ratio}× more`,
      3 + Math.min(ratio ?? 10, 10) / 10,
    );
  }

  // Closet ghosts: unworn through its own season (ghosts.ts already skips off-season items).
  if (climate) {
    for (const g of await findGhosts(db, userId, climate, today)) {
      const row = byId.get(g.itemId);
      if (!row || !settled(row)) continue;
      add(row.id, `Hasn't come out in ${Math.round(g.inSeasonDays / 7)} weeks of ${weatherName(g.type, g.band)}`, 2 + g.inSeasonDays / 100);
    }
  }

  // Never worn since it was added.
  for (const row of rows) {
    // Off-season pieces wait for their season, unless they can still go back: the window won't wait.
    if (row.wears > 0 || SKIP.has(row.category) || !settled(row) || (!row.deadline && !inSeason(row, climate, month))) continue;
    const added = new Date(row.created_at);
    add(row.id, `Never worn since you added it in ${MONTHS[added.getMonth()]}`, 1);
  }

  const picks = [...found].map(([id, f]) => {
    const row = byId.get(id)!;
    return {
      pick: { itemId: id, description: row.description, photoUrl: row.photo_url, reasons: f.reasons, exit: exitFor(row, climate, month, sizes), deadline: row.deadline },
      score: f.score,
    };
  });
  return picks
    .sort((x, y) => {
      if (x.pick.deadline && y.pick.deadline) return x.pick.deadline.localeCompare(y.pick.deadline);
      if (x.pick.deadline || y.pick.deadline) return x.pick.deadline ? -1 : 1;
      return y.score - x.score;
    })
    .slice(0, TOP)
    .map((p) => p.pick);
}

export const NOTHING_TO_CLEAR = "Nothing to clear out. You're wearing what you own.";
export const SOLD_HINT = "Reply 'sold 2' or 'donated 2' when it's gone.";

/** How to report what happened, using numbers from this list ("sold 2" only if there's a 2 to sell). */
function answerHints(picks: LetGoPick[]): string[] {
  const resell = picks.findIndex((p) => p.exit.kind !== "return");
  const back = picks.findIndex((p) => p.exit.kind === "return");
  const hints: string[] = [];
  if (resell >= 0) hints.push(resell === 1 ? SOLD_HINT : `Reply 'sold ${resell + 1}' or 'donated ${resell + 1}' when it's gone.`);
  if (back >= 0) hints.push(`Reply 'returned ${back + 1}' once it's sent back.`);
  return hints;
}

/** The reply: the top pick's photo, then one line per pick, then how to report it. */
export function declutterReplies(picks: LetGoPick[]): Reply[] {
  if (!picks.length) return [NOTHING_TO_CLEAR];
  const lines = picks.map((p, i) => {
    const links = p.exit.links.map((l) => `${l.label}: ${l.url}`).join(" · ");
    return `${i + 1}. ${p.description}: ${p.reasons.join("; ")}. ${p.exit.text}.${links ? ` ${links}` : ""}`;
  });
  const text = ["Here's what you could let go:", ...lines, ...answerHints(picks)].join("\n");
  return picks[0]!.photoUrl ? [{ photo: picks[0]!.photoUrl }, text] : [text];
}

const ASK = /^(?:what should i (?:get rid of|let go of|toss|declutter|clear out)|what can i get rid of|declutter(?: my (?:closet|wardrobe))?|help me declutter|clean out my (?:closet|wardrobe)|clear out my (?:closet|wardrobe)|what don'?t i (?:ever )?wear|what do i never wear)$/;

export function isDeclutterAsk(text: string): boolean {
  return ASK.test(text.trim().toLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g, " "));
}

/** Remembers the list they were shown, so "sold 2" means its second item (users.declutter_list). */
export async function saveDeclutterList(db: Db, userId: string, picks: LetGoPick[]): Promise<void> {
  const list = picks.map((p) => ({ id: p.itemId, kind: p.exit.kind }));
  await db.query(`UPDATE users SET declutter_list = $2, declutter_at = now() WHERE id = $1`, [userId, JSON.stringify(list)]);
}

const ANSWER = /^(sold|donated|gave away|returned)\s+(?:#|no\.?\s*|number\s+)?(\d+)(?:\s+for\s+\$?(\d+(?:\.\d{1,2})?))?$/;
const LIST_DAYS = 14;

/**
 * "sold 2", "sold 2 for $15", "donated 1", or "returned 1" for a pick that
 * could go back: lets that item go and counts it (impact.ts: sold and
 * donated count as kept in circulation, returns as money back). Undefined
 * when it isn't an answer to a recent list.
 */
export async function answerDeclutter(db: Db, userId: string, text: string): Promise<string | undefined> {
  const m = ANSWER.exec(text.trim().toLowerCase().replace(/[.!]+$/, "").replace(/\s+/g, " "));
  if (!m) return undefined;
  const [row] = await db.query<{ declutter_list: string | null; fresh: boolean }>(
    `SELECT declutter_list, coalesce(declutter_at > now() - make_interval(days => $2), false) AS fresh FROM users WHERE id = $1`,
    [userId, LIST_DAYS],
  );
  if (!row?.declutter_list || !row.fresh) return undefined;
  const list: { id: number; kind: string }[] = JSON.parse(row.declutter_list);
  const picked = list[Number(m[2]) - 1];
  const how: LetGo = m[1] === "sold" ? "sold" : m[1] === "returned" ? "returned" : "donated";
  if (how === "returned" && picked?.kind !== "return") return undefined; // "returned 2" about an order: returns.ts
  if (!picked) return `There's no number ${m[2]} on the list. Text "what should I get rid of?" to see it again.`;

  const [item] = await db.query<{ description: string; type: string }>(`SELECT description, type FROM items WHERE id = $1 AND user_id = $2`, [
    picked.id,
    userId,
  ]);
  const price = m[3] ? Number(m[3]) : null;
  if (!item || !(await letGo(db, userId, picked.id, how, price))) return "That one's already gone from your closet.";
  if (how === "returned") return `Marked your ${item.description} as returned. That money's back in your pocket.`;
  const kg = footprintOf(item.type);
  const saved = kg !== null ? ` Someone else wearing it saves ${describeKg(kg)} (estimate).` : "";
  const done = how === "sold" ? `Sold your ${item.description}${price ? ` for ${money(price)}` : ""}` : `Donated your ${item.description}`;
  return `${done}. It stays in circulation instead of in your closet.${saved}`;
}
