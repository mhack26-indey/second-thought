import { beforeEach, expect, test } from "bun:test";
import type { AskVision } from "./closet/compare.ts";
import type { ExtractedItem } from "./closet/extract.ts";
import { activeItems, insertItem } from "./closet/repo.ts";
import type { Db } from "./db/client.ts";
import { testDb } from "./db/test-db.ts";
import { impactReply, impactSummary, impactTotals, isImpactAsk, isUnskip, letGo, parseLetGo, setQuantity, tossMessage, undoLastSkip } from "./impact.ts";
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
  expect(await impactTotals(db, "u1")).toMatchObject({ skipped: 1, recovered: 0 });
  expect((await impactTotals(db, "u1")).co2Kg).toBeCloseTo(16.34); // one pair of jeans (footprint.ts)

  await shopping(other.id, evening).match("u1", photo); // a different item that day counts
  await shopping(owned.id, nextDay).match("u1", photo); // and so does the next day
  expect(await impactTotals(db, "u1")).toMatchObject({ skipped: 3, recovered: 0 });
});

test("money back counts once as a purchase goes returning, then returned", async () => {
  await orderedJeans();
  await claimNudges(db, { today: TODAY });

  await handleReturnsText(db, "u1", "return", TODAY);
  expect((await events()).map((e) => [e.kind, e.amount])).toEqual([["recovered", "49.90"]]);

  await handleReturnsText(db, "u1", "returned it", TODAY);
  expect(await events()).toHaveLength(1);
  expect(await impactTotals(db, "u1")).toMatchObject({ skipped: 0, returned: 1, recovered: 49.9 });
  expect((await impactTotals(db, "u1")).co2Kg).toBeCloseTo(16.34); // the returned jeans get worn again, est.
});

test('"my impact" replies with the totals', async () => {
  expect(impactReply(await impactTotals(db, "u1"))).toBe("Nothing yet. Text 'do I have this?' next time you're shopping.");

  // A return only: no closing line, since nothing was skipped.
  const none = { skipped: 0, returned: 0, sold: 0, donated: 0, recovered: 0, co2Kg: 0 };
  expect(impactReply({ ...none, returned: 1, recovered: 49.9 })).toBe("You've returned 1 item, and gotten $49.90 back.");

  const owned = await orderedJeans("2026-10-01");
  await shopping(owned.id).match("u1", photo);
  await shopping(owned.id, Date.parse("2026-10-04T11:00:00")).match("u1", photo); // the next day
  const totals = await impactTotals(db, "u1");
  expect(totals).toMatchObject({ skipped: 2, recovered: 0 });
  expect(totals.co2Kg).toBeCloseTo(32.68); // two pairs of jeans, estimated
  // No money back yet, so no "$0.00 back"; the CO₂ line says it's an estimate.
  expect(impactReply(totals)).toBe(
    "You've skipped 2 purchases.\nThat saved ≈ 33 kg CO₂e (about 82 miles of driving). That's an estimate from Carbonfact's averages per item type.\nThat's 2 fewer things in your closet you didn't need.",
  );
  expect(impactReply({ ...none, skipped: 1 })).toEndWith("That's 1 fewer thing in your closet you didn't need.");
  expect(impactSummary(totals)).toBe("Skipped 2 purchases · ≈ 33 kg CO₂e saved");
  expect(impactSummary(none)).toBe("Nothing skipped yet");
  expect(impactSummary({ ...none, skipped: 1, sold: 1, donated: 1, recovered: 20, co2Kg: 40.2 })).toBe(
    "Skipped 1 purchase · Sold 1 · Donated 1 · ≈ 40 kg CO₂e saved · $20.00 back",
  );
});

test("impact asks", () => {
  for (const ask of ["my impact", "Impact", "my stats", "How am I doing?", "what's my impact"]) expect(isImpactAsk(ask)).toBe(true);
  for (const other of ["how am I doing on returns", "my wardrobe", "stats on my jeans"]) expect(isImpactAsk(other)).toBe(false);
});

test("letting go: sold and donated count once, thrown away counts nothing", async () => {
  const sold = await insertItem(db, { ...jeans, user_id: "u1", source: "fit_check" });
  const given = await insertItem(db, { ...jeans, user_id: "u1", source: "fit_check" });
  const trashed = await insertItem(db, { ...jeans, user_id: "u1", source: "fit_check" });

  expect(await letGo(db, "u1", sold.id, "sold", 25)).toBe(true);
  expect(await letGo(db, "u1", sold.id, "sold", 25)).toBe(false); // already gone
  expect(await letGo(db, "u2", given.id, "donated")).toBe(false); // not theirs
  expect(await letGo(db, "u1", given.id, "donated")).toBe(true);
  expect(await letGo(db, "u1", trashed.id, "trashed")).toBe(true);

  const totals = await impactTotals(db, "u1");
  expect(totals).toMatchObject({ sold: 1, donated: 1, recovered: 25 });
  expect(totals.co2Kg).toBeCloseTo(2 * 16.34); // not the trashed pair
  expect(await activeItems(db, "u1")).toHaveLength(0);
});

test("returning an ordered item marks the order returned and counts its price once", async () => {
  const owned = await orderedJeans("2026-10-01");
  expect(await letGo(db, "u1", owned.id, "returned")).toBe(true);
  const [p] = await db.query<{ status: string }>(`SELECT status FROM purchases`);
  expect(p!.status).toBe("returned");
  expect(await impactTotals(db, "u1")).toMatchObject({ returned: 1, recovered: 49.9 });
});

test('"I didn\'t skip it" takes back the latest skip', async () => {
  const owned = await orderedJeans("2026-10-01");
  await shopping(owned.id).match("u1", photo);
  expect((await impactTotals(db, "u1")).skipped).toBe(1);
  expect(await undoLastSkip(db, "u1")).toBe(owned.description);
  expect((await impactTotals(db, "u1")).skipped).toBe(0);
  expect(await undoLastSkip(db, "u1")).toBeUndefined();

  for (const t of ["I didn't skip it", "didnt skip it", "oops I didn't skip that one", "bought it anyway", "I did not skip it, I bought it"]) {
    expect(isUnskip(t)).toBe(true);
  }
  expect(isUnskip("did I skip anything")).toBe(false);
});

test("how an item left, from a reply", () => {
  expect(parseLetGo("sold it for $20")).toEqual({ how: "sold", price: 20 });
  expect(parseLetGo("sold on depop")).toEqual({ how: "sold", price: null });
  expect(parseLetGo("gave it away to my brother")).toEqual({ how: "donated", price: null });
  expect(parseLetGo("goodwill")).toEqual({ how: "donated", price: null });
  expect(parseLetGo("I returned it")).toEqual({ how: "returned", price: null });
  expect(parseLetGo("tossed it, it ripped")).toEqual({ how: "trashed", price: null });
  expect(parseLetGo("remind me tomorrow")).toBeUndefined();
});

test("tossing says how long it lasted: short lives get the quality note, long ones a good run", () => {
  const now = new Date("2026-10-03T12:00:00");
  expect(tossMessage("white sneakers", true, new Date("2026-08-22T12:00:00"), 3, now)).toBe(
    "Removed your white sneakers. They only lasted 6 weeks and 3 wears. That's a short life for clothes; next time, sturdier pieces (or good secondhand ones) are worth paying for. Textile recycling keeps even broken clothes out of landfill.",
  );
  expect(tossMessage("gray hoodie", false, new Date("2023-09-01T12:00:00"), 140, now)).toBe(
    "Removed your gray hoodie. It had a good run: 3 years and 140 wears. Textile recycling keeps even broken clothes out of landfill.",
  );
});

test("several identical pieces: letting one go leaves the rest, the last one ends the item", async () => {
  const tees = await insertItem(db, { ...jeans, user_id: "u1", source: "fit_check" });
  expect(await setQuantity(db, "u1", tees.id, 3)).toBe(true);
  expect(await setQuantity(db, "u1", tees.id, 0)).toBe(false);
  expect(await setQuantity(db, "u2", tees.id, 2)).toBe(false); // not theirs

  expect(await letGo(db, "u1", tees.id, "sold", 10)).toBe(true);
  expect(await letGo(db, "u1", tees.id, "donated")).toBe(true);
  let [left] = await activeItems(db, "u1");
  expect(left!.quantity).toBe(1);
  expect(await impactTotals(db, "u1")).toMatchObject({ sold: 1, donated: 1, recovered: 10 });

  expect(await letGo(db, "u1", tees.id, "trashed")).toBe(true); // the last one
  expect(await activeItems(db, "u1")).toHaveLength(0);
  expect(await letGo(db, "u1", tees.id, "sold")).toBe(false); // gone
});
