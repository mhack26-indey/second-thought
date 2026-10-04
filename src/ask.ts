import { z } from "zod";
import { vlmJson } from "./closet/vlm.ts";
import type { Db } from "./db/client.ts";
import { impactHistory, impactTotals } from "./impact.ts";

// Questions about their own closet that no specific command answers ("what
// did I wear on Tuesday?", "how much have I spent at Zara?", "what have I
// never worn?"). The model gets their data as plain facts, already counted
// and dated, and answers only from it: no opinions, no style advice, nothing
// it can't point to. It can't change anything; questions are read-only.

const AnswerSchema = z.object({
  answerable: z.boolean(), // false when the data doesn't say
  answer: z.string(),
});

const day = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : d === null || d === undefined ? null : String(d).slice(0, 10));

/** Their closet as facts for the model: compact, with counts and dates worked out by code. */
export async function closetFacts(db: Db, userId: string) {
  const items = await db.query<any>(
    `SELECT i.id, i.description, i.category, i.type, i.color_primary, i.pattern, i.quantity, i.location, i.source, i.created_at,
       count(o.id)::int AS wears, max(o.taken_on) AS last_worn
     FROM items i LEFT JOIN wears w ON w.item_id = i.id LEFT JOIN outfits o ON o.id = w.outfit_id
     WHERE i.user_id = $1 AND i.status = 'active' GROUP BY i.id ORDER BY i.category, i.id`,
    [userId],
  );
  const fitChecks = await db.query<any>(
    `SELECT o.taken_on, array_agg(i.description ORDER BY i.category) FILTER (WHERE i.id IS NOT NULL) AS worn
     FROM outfits o LEFT JOIN wears w ON w.outfit_id = o.id LEFT JOIN items i ON i.id = w.item_id
     WHERE o.user_id = $1 GROUP BY o.id ORDER BY o.taken_on DESC, o.id DESC LIMIT 60`,
    [userId],
  );
  const purchases = await db.query<any>(
    `SELECT p.retailer, p.price::text AS price, p.order_date, p.return_deadline, p.status, i.description
     FROM purchases p LEFT JOIN items i ON i.purchase_id = p.id::text WHERE p.user_id = $1 ORDER BY p.order_date DESC`,
    [userId],
  );
  const reminders = await db.query<any>(
    `SELECT text, due_at FROM reminders WHERE user_id = $1 AND NOT sent ORDER BY due_at`,
    [userId],
  );
  const [user] = await db.query<any>(`SELECT name, city FROM users WHERE id = $1`, [userId]);
  const history = await impactHistory(db, userId);
  const totals = await impactTotals(db, userId);
  return {
    profile: { name: user?.name ?? null, city: user?.city ?? null },
    items: items.map((i) => ({
      item: i.description,
      category: i.category,
      type: i.type,
      color: i.color_primary,
      pattern: i.pattern,
      ...(i.quantity > 1 ? { how_many: i.quantity } : {}),
      ...(i.location ? { kept_in: i.location } : {}),
      added: day(i.created_at),
      added_from: i.source,
      times_worn: i.wears,
      last_worn: day(i.last_worn),
    })),
    fit_checks: fitChecks.map((f) => ({ date: day(f.taken_on), wearing: f.worn ?? [] })),
    purchases: purchases.map((p) => ({
      item: p.description,
      retailer: p.retailer,
      price: p.price === null ? null : Number(p.price),
      ordered: day(p.order_date),
      return_by: day(p.return_deadline),
      status: p.status,
    })),
    let_go_or_skipped: history.map((h) => ({
      what: h.kind === "avoided" ? "skipped buying one like it" : h.kind === "recovered" ? "returned" : h.kind,
      item: h.description,
      date: day(h.at),
      ...(h.amount ? { amount: h.amount } : {}),
    })),
    reminders: reminders.map((r) => ({ text: r.text, due: day(r.due_at) })),
    totals: { skipped: totals.skipped, returned: totals.returned, sold: totals.sold, donated: totals.donated, money_back: totals.recovered },
  };
}

/**
 * Answers a question from their data, or undefined if the data doesn't say
 * (or the model fails). The reply is short and plain, and only what's in the facts.
 */
export async function answerFromCloset(db: Db, userId: string, question: string, today = new Date()): Promise<string | undefined> {
  const facts = await closetFacts(db, userId);
  try {
    const { answerable, answer } = await vlmJson({
      schema: AnswerSchema,
      images: [],
      prompt: `Answer a person's question about their own closet, using ONLY the DATA below.

Rules:
- Every fact, number and date in your answer must come from DATA. Count and compare only what's listed.
- If DATA doesn't contain what's needed, set answerable to false.
- Never give opinions, style advice, outfit ideas, or suggestions to buy anything. Just answer what was asked.
- Reply in 1-3 short, plain sentences, no markdown or lists. Write dates like "Oct 3". Today is ${today.toISOString().slice(0, 10)}.

DATA:
${JSON.stringify(facts)}

Question: ${question}`,
    });
    return answerable && answer.trim() ? answer.trim() : undefined;
  } catch (err) {
    console.error("closet question failed", err);
    return undefined;
  }
}
