import type { Db } from "./db/client.ts";
import { addDays, formatDay } from "./closet/dates.ts";
import type { ParsedOrder } from "./closet/order.ts";
import { type Item, candidatesByCategory, insertItem } from "./closet/repo.ts";
import { type Matcher, exactMatcher } from "./ingest.ts";

// Order intake: an order screenshot becomes one purchase per line item, with
// its return deadline from return_policies (seeded in schema.sql), and each
// item goes into the closet with source = 'order'. Items go through the same
// dedup as fit checks, so ordering jeans you already own links the order to
// those jeans and says so.

export const DEFAULT_RETURN_DAYS = 30;
export const VERIFY = "Verify on the retailer's site.";

// Short forms people (and receipts) use that no policy name starts with.
const ALIASES: Record<string, string> = {
  hm: "H&M",
  hnm: "H&M",
  ae: "American Eagle",
  aeo: "American Eagle",
  af: "Abercrombie",
  anf: "Abercrombie",
  uo: "Urban Outfitters",
  lulu: "Lululemon",
};

/** "ZARA", "zara.com", "www.Zara.com/us" -> "zara"; "H&M" -> "handm". */
export function retailerKey(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\d?\./, "")
    .replace(/\.(com|co\.uk|co|net|shop|us|ca)(\/.*)?$/, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
}

export interface ReturnPolicy {
  retailer: string; // the policy's name ("Zara"), or the name as read if unknown
  days: number;
  known: boolean;
}

/**
 * The policy whose name the retailer starts with, longest first, so
 * "Abercrombie & Fitch" finds Abercrombie and "Old Navy" isn't taken for
 * anything shorter. Unknown retailers get DEFAULT_RETURN_DAYS.
 */
export async function returnPolicy(db: Db, retailer: string): Promise<ReturnPolicy> {
  const policies = await db.query<{ retailer: string; return_days: number }>(
    `SELECT retailer, return_days FROM return_policies`,
  );
  const key = retailerKey(retailer);
  const alias = ALIASES[key];
  const found =
    policies.find((p) => p.retailer === alias) ??
    policies
      .filter((p) => key && key.startsWith(retailerKey(p.retailer)))
      .sort((a, b) => retailerKey(b.retailer).length - retailerKey(a.retailer).length)[0];
  return found
    ? { retailer: found.retailer, days: found.return_days, known: true }
    : { retailer: retailer || "that store", days: DEFAULT_RETURN_DAYS, known: false };
}

export interface OrderLineResult {
  item: Item; // the closet item the line is now attached to
  description: string; // as read from the order
  price: number | null;
  duplicateOf: Item | null; // an item they already owned that this matched
}

export interface OrderResult {
  policy: ReturnPolicy;
  orderDate: string;
  deadline: string;
  lines: OrderLineResult[];
}

export async function intakeOrder(
  db: Db,
  userId: string,
  order: ParsedOrder,
  opts: { orderDate: string; matcher?: Matcher },
): Promise<OrderResult> {
  const policy = await returnPolicy(db, order.retailer);
  const deadline = addDays(opts.orderDate, policy.days);
  const result: OrderResult = { policy, orderDate: opts.orderDate, deadline, lines: [] };
  if (!order.items.length) return result;

  const categories = [...new Set(order.items.map((i) => i.category))];
  const owned = (await Promise.all(categories.map((c) => candidatesByCategory(db, userId, c)))).flat();
  let matches: (number | null)[];
  try {
    matches = await (opts.matcher ?? exactMatcher)(order.items, owned);
  } catch (err) {
    console.error("order item matching failed; falling back to exact match", err);
    matches = await exactMatcher(order.items, owned);
  }

  const byId = new Map(owned.map((o) => [o.id, o]));
  for (const [index, line] of order.items.entries()) {
    const [purchase] = await db.query<{ id: string }>(
      `INSERT INTO purchases (user_id, retailer, price, order_date, return_deadline, status)
       VALUES ($1, $2, $3, $4, $5, 'kept') RETURNING id`,
      [userId, policy.retailer, line.price, opts.orderDate, deadline],
    );
    const { price, ...item } = line;
    const existing = byId.get(matches[index] ?? -1);
    let saved: Item;
    if (existing && existing.purchase_id === null) {
      // Most likely the same item, worn or texted before the order came in.
      const [row] = await db.query<Item>(`UPDATE items SET purchase_id = $2 WHERE id = $1 RETURNING *`, [
        existing.id,
        purchase!.id,
      ]);
      saved = row!;
      byId.set(saved.id, saved); // a second identical line becomes its own item
    } else {
      saved = await insertItem(db, { ...item, user_id: userId, source: "order", purchase_id: purchase!.id });
    }
    result.lines.push({ item: saved, description: line.description, price, duplicateOf: existing ?? null });
  }
  return result;
}

export const money = (n: number) => `$${n.toFixed(2)}`;

function list(names: string[]): string {
  return names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function orderReply(result: OrderResult, today: string): string {
  const { policy, deadline, lines } = result;
  if (!lines.length) return "I couldn't find any clothes in that order.";

  const window = deadline >= today ? `Return window closes ${formatDay(deadline)}.` : `Return window closed ${formatDay(deadline)}.`;
  const added =
    lines.length === 1
      ? `Added ${lines[0]!.description} from ${policy.retailer}${lines[0]!.price === null ? "" : ` (${money(lines[0]!.price)})`}.`
      : `Added ${list(lines.map((l) => (l.price === null ? l.description : `${l.description} (${money(l.price)})`)))} from ${policy.retailer}.`;
  const out = [`${added} ${window}`];
  if (!policy.known) out.push(`I don't know ${policy.retailer}'s return policy, so I assumed ${policy.days} days.`);
  const warned = new Set<number>();
  for (const { duplicateOf } of lines) {
    if (!duplicateOf || warned.has(duplicateOf.id)) continue;
    warned.add(duplicateOf.id);
    out.push(`Heads up: you already own ${duplicateOf.description}.`);
  }
  out.push(VERIFY);
  return out.join("\n");
}
