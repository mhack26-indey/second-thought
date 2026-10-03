import { beforeEach, expect, test } from "bun:test";
import type { AskVision } from "./closet/compare.ts";
import type { ExtractedItem } from "./closet/extract.ts";
import { insertItem } from "./closet/repo.ts";
import type { Db } from "./db/client.ts";
import { testDb } from "./db/test-db.ts";
import { impactReply, impactSummary, impactTotals, isImpactAsk } from "./impact.ts";
import { exactMatcher } from "./ingest.ts";
import { intakeOrder } from "./orders.ts";
import { claimNudges, handleReturnsText } from "./returns.ts";
import { ShoppingMode } from "./shopping-mode.ts";

const jeans: ExtractedItem = {
  category: "bottom",
  type: "jeans",
  color_primary: "black",
  color_secondary: null,
  pattern: "solid",
  fit: "straight-leg",
  season: "all",
  description: "black straight-leg denim jeans",
};
const TODAY = "2026-10-03";
const photo = { url: "https://example.test/store-photo.jpg" };

let db: Db;
beforeEach(async () => {
  db = await testDb();
  await db.query(`INSERT INTO users (id, web_token) VALUES ('u1', 'token-u1')`);
});

const noPhotos = async (): Promise<never> => {
  throw new Error("offline");
};
/** The vision model calls `id` (if any) near_identical to the photo's item. */
const answer = (id?: number): AskVision => async () => ({
  items: [{ seen: 0, matches: id ? [{ item_id: id, similarity: "near_identical" as const, reason: "same jeans" }] : [] }],
});
const shopping = (id?: number, at = Date.parse("2026-10-03T15:00:00")) =>
  new ShoppingMode({
    db,
    now: () => at,
    match: { extract: async () => [jeans], ask: answer(id), load: noPhotos, today: () => TODAY },
  });

const events = () =>
  db.query<{ kind: string; amount: string | null; item_id: number; purchase_id: string | null }>(
    `SELECT kind, amount::text, item_id, purchase_id FROM impact_events ORDER BY created_at, kind`,
  );

async function orderedJeans(orderDate = "2026-09-06") {
  const result = await intakeOrder(
    db,
    "u1",
    { retailer: "Zara", order_date: orderDate, items: [{ ...jeans, price: 49.9 }] },
    { orderDate, matcher: exactMatcher },
  );
  return result.lines[0]!.item;
}

test("a shopping match records a skipped purchase; no match records nothing", async () => {
  const owned = await insertItem(db, { ...jeans, user_id: "u1", source: "fit_check", photo_url: "https://example.test/photos/a" });

  await shopping(undefined).match("u1", photo); // the model sees nothing alike
  expect(await events()).toEqual([]);

  const replies = await shopping(owned.id).match("u1", photo);
  expect(replies[0]).toStartWith("You already have 1 like this:");
  expect(await events()).toEqual([{ kind: "avoided", amount: null, item_id: owned.id, purchase_id: null }]);
});

test("the skipped amount is the matched item's order price", async () => {
  const fromOrder = await orderedJeans();
  await shopping(fromOrder.id).match("u1", photo);
  const [event] = await events();
  expect(event).toMatchObject({ kind: "avoided", amount: "49.90", item_id: fromOrder.id });
  expect(event!.purchase_id).toBe(fromOrder.purchase_id);
});

test("the same item counts once a day, however often it's checked", async () => {
  const owned = await insertItem(db, { ...jeans, user_id: "u1", source: "fit_check" });
  const other = await insertItem(db, { ...jeans, color_primary: "blue", user_id: "u1", source: "fit_check" });
  const morning = Date.parse("2026-10-03T09:00:00");
  const evening = Date.parse("2026-10-03T23:30:00");
  const nextDay = Date.parse("2026-10-04T00:30:00");

  await shopping(owned.id, morning).match("u1", photo);
  await shopping(owned.id, evening).match("u1", photo); // same day: not again
  expect(await impactTotals(db, "u1")).toEqual({ skipped: 1, recovered: 0 });

  await shopping(other.id, evening).match("u1", photo); // a different item that day counts
  await shopping(owned.id, nextDay).match("u1", photo); // and so does the next day
  expect(await impactTotals(db, "u1")).toEqual({ skipped: 3, recovered: 0 });
});

test("money back counts once as a purchase goes returning, then returned", async () => {
  await orderedJeans();
  await claimNudges(db, { today: TODAY });

  await handleReturnsText(db, "u1", "return", TODAY);
  expect((await events()).map((e) => [e.kind, e.amount])).toEqual([["recovered", "49.90"]]);

  await handleReturnsText(db, "u1", "returned it", TODAY);
  expect(await events()).toHaveLength(1);
  expect(await impactTotals(db, "u1")).toEqual({ skipped: 0, recovered: 49.9 });
});

test('"my impact" replies with the totals', async () => {
  expect(impactReply(await impactTotals(db, "u1"))).toBe("Nothing yet. Text 'do I have this?' next time you're shopping.");

  // A return only: no closing line, since nothing was skipped.
  expect(impactReply({ skipped: 0, recovered: 49.9 })).toBe("You've skipped 0 purchases and gotten $49.90 back.");

  const owned = await orderedJeans("2026-10-01");
  await shopping(owned.id).match("u1", photo);
  await shopping(owned.id, Date.parse("2026-10-04T11:00:00")).match("u1", photo); // the next day
  const totals = await impactTotals(db, "u1");
  expect(totals).toEqual({ skipped: 2, recovered: 0 });
  expect(impactReply(totals)).toBe(
    "You've skipped 2 purchases and gotten $0.00 back.\nThat's 2 fewer things in your closet you didn't need.",
  );
  expect(impactReply({ skipped: 1, recovered: 0 })).toEndWith("That's 1 fewer thing in your closet you didn't need.");
  expect(impactSummary(totals)).toBe("Skipped 2 purchases · $0.00 back");
});

test("impact asks", () => {
  for (const ask of ["my impact", "Impact", "my stats", "How am I doing?", "what's my impact"]) expect(isImpactAsk(ask)).toBe(true);
  for (const other of ["how am I doing on returns", "my wardrobe", "stats on my jeans"]) expect(isImpactAsk(other)).toBe(false);
});
