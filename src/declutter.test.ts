import { beforeEach, expect, test } from "bun:test";
import type { Climate } from "./climate.ts";
import type { ExtractedItem } from "./closet/extract.ts";
import { activeItems, insertItem } from "./closet/repo.ts";
import type { Db } from "./db/client.ts";
import { testDb } from "./db/test-db.ts";
import {
  NOTHING_TO_CLEAR,
  answerDeclutter,
  declutterPicks,
  declutterReplies,
  isDeclutterAsk,
  saveDeclutterList,
} from "./declutter.ts";
import { impactTotals } from "./impact.ts";
import { exactMatcher, ingestOutfit, visionMatcher } from "./ingest.ts";

// Ann Arbor-like normal highs (°C): puffer weather Nov–Mar, warm weather May–Sep.
const ANN_ARBOR: Climate = {
  city: "Ann Arbor, Michigan",
  countryCode: "US",
  highsC: [0, 2, 8, 15, 22, 27, 29, 28, 24, 17, 9, 3],
  lowsC: [-8, -7, -3, 3, 9, 15, 17, 16, 12, 6, 1, -5],
};
const DAY = 86_400_000;

const piece = (type: ExtractedItem["type"], category: ExtractedItem["category"], color: string, description: string, season: ExtractedItem["season"] = "all", pattern = "solid"): ExtractedItem => ({
  category,
  type,
  color_primary: color,
  color_secondary: null,
  pattern,
  fit: "regular",
  season,
  description,
});
const puffer = piece("puffer", "outerwear", "red", "red quilted puffer jacket", "cold");
const polo = piece("polo", "top", "navy", "navy short-sleeve polo");
const jeans = piece("jeans", "bottom", "black", "black straight-leg jeans");
const shorts = piece("shorts", "bottom", "olive", "olive adidas shorts", "warm");
const tee = piece("t-shirt", "top", "white", "plain white crew-neck tee");

let db: Db;
beforeEach(async () => {
  db = await testDb();
  await db.query(`INSERT INTO users (id, web_token) VALUES ('u1', 'tok')`);
});

/** An item added on `addedOn`, with a photo. */
async function owns(item: ExtractedItem, addedOn: string, extra: { purchase_id?: string } = {}) {
  const row = await insertItem(db, { ...item, user_id: "u1", source: "fit_check", photo_url: `https://example.test/${item.type}.jpg`, ...extra });
  await db.query(`UPDATE items SET created_at = $2 WHERE id = $1`, [row.id, `${addedOn}T12:00:00Z`]);
  return row;
}

/** A fit check on `day` wearing these items (none: just an active user). */
async function fitCheck(day: string, ...itemIds: number[]) {
  const [o] = await db.query<{ id: number }>(`INSERT INTO outfits (user_id, taken_on, created_at) VALUES ('u1', $1, $2) RETURNING id`, [day, `${day}T12:00:00Z`]);
  for (const id of itemIds) await db.query(`INSERT INTO wears (item_id, outfit_id) VALUES ($1, $2)`, [id, o!.id]);
}

/** Weekly fit checks from `from` to `to`, wearing `itemId` in each (so the user is active). */
async function weekly(from: string, to: string, itemId: number) {
  for (let t = Date.parse(from); t <= Date.parse(to); t += 7 * DAY) await fitCheck(new Date(t).toISOString().slice(0, 10), itemId);
}

const alike = (a: number, b: number) => db.query(`INSERT INTO item_alike (item_id, other_id) VALUES ($1, $2)`, [Math.min(a, b), Math.max(a, b)]);

test("a cold-weather ghost is flagged in its season and never in summer", async () => {
  const coat = await owns(puffer, "2026-03-01");
  const everyday = await owns(jeans, "2026-03-01");
  await weekly("2026-03-02", "2027-01-25", everyday.id);

  const july = await declutterPicks(db, "u1", ANN_ARBOR, new Date("2026-07-15T12:00:00Z"));
  expect(july.map((p) => p.description)).not.toContain(puffer.description);

  const january = await declutterPicks(db, "u1", ANN_ARBOR, new Date("2027-01-25T12:00:00Z"));
  const pick = january.find((p) => p.itemId === coat.id)!;
  expect(pick.reasons.join(" ")).toMatch(/^Hasn't come out in \d+ weeks of puffer weather/);
});

test("of two near-duplicates, the one worn far less is flagged", async () => {
  const worn = await owns(polo, "2026-05-01");
  const spare = await owns({ ...polo, description: "navy polo with white trim" }, "2026-05-01");
  await alike(worn.id, spare.id);
  for (const day of ["2026-05-10", "2026-05-20", "2026-06-01", "2026-06-15", "2026-07-01"]) await fitCheck(day, worn.id);
  await fitCheck("2026-05-12", spare.id);

  const [pick] = await declutterPicks(db, "u1", ANN_ARBOR, new Date("2026-07-15T12:00:00Z"));
  expect(pick!.itemId).toBe(spare.id);
  expect(pick!.reasons).toContain("You have 2 navy polos; you wear the other one 5× more");
});

test("ingest records the pairs the vision comparison rates similar", async () => {
  const first = await owns(polo, "2026-05-01");
  const ask = async () => ({ items: [{ seen: 0, matches: [{ item_id: first.id, similarity: "similar" as const, reason: "another navy polo" }] }] });
  const noPhotos = async (): Promise<never> => {
    throw new Error("offline");
  };
  const [outfit] = await db.query<{ id: number }>(`INSERT INTO outfits (user_id, taken_on) VALUES ('u1', '2026-06-01') RETURNING id`);
  const { added } = await ingestOutfit(db, "u1", { id: outfit!.id, photoUrl: "https://example.test/fit.jpg" }, [polo], visionMatcher({ url: "x" }, exactMatcher, ask, noPhotos));
  expect(added).toHaveLength(1); // similar isn't the same item: it's added
  expect(await db.query(`SELECT item_id, other_id FROM item_alike`)).toEqual([{ item_id: first.id, other_id: added[0]!.id }]);
});

test("a pick that can still go back says to return it, and comes first", async () => {
  const [purchase] = await db.query<{ id: string }>(
    `INSERT INTO purchases (user_id, retailer, price, order_date, return_deadline, status) VALUES ('u1', 'Target', 25, '2026-06-01', '2026-08-30', 'kept') RETURNING id`,
  );
  const ordered = await owns(jeans, "2026-06-01", { purchase_id: purchase!.id });
  const old = await owns({ ...polo, description: "navy polo" }, "2026-03-01");
  const spare = await owns({ ...polo, description: "navy polo, thinner" }, "2026-03-01");
  await alike(old.id, spare.id);
  for (const day of ["2026-04-01", "2026-04-10", "2026-04-20", "2026-05-01", "2026-05-10", "2026-05-20"]) await fitCheck(day, old.id);

  const picks = await declutterPicks(db, "u1", ANN_ARBOR, new Date("2026-07-15T12:00:00Z"));
  expect(picks[0]!.itemId).toBe(ordered.id); // money back first, though the duplicate scores higher
  expect(picks[0]!.exit).toEqual({
    kind: "return",
    text: "Return it by Aug 30 (Target) and get your money back",
    links: [{ label: "Target returns", url: "https://www.target.com/returns" }],
  });
  expect(picks.map((p) => p.itemId)).toContain(spare.id);
});

test("an order that can still go back only needs a week before it's offered back", async () => {
  const order = async (orderDate: string, deadline: string) => {
    const [p] = await db.query<{ id: string }>(
      `INSERT INTO purchases (user_id, retailer, price, order_date, return_deadline, status) VALUES ('u1', 'Zara', 69.9, $1, $2, 'kept') RETURNING id`,
      [orderDate, deadline],
    );
    return p!.id;
  };
  const jacket = await owns(piece("jacket", "outerwear", "green", "green cropped utility jacket"), "2026-06-20", { purchase_id: await order("2026-06-20", "2026-07-20") });
  const fresh = await owns(piece("jacket", "outerwear", "black", "black bomber jacket"), "2026-07-12", { purchase_id: await order("2026-07-12", "2026-08-11") });

  const picks = await declutterPicks(db, "u1", ANN_ARBOR, new Date("2026-07-15T12:00:00Z"));
  expect(picks.map((p) => p.itemId)).toEqual([jacket.id]); // 25 days old: offered back; 3 days old: not yet
  expect(picks[0]!.exit.text).toBe("Return it by Jul 20 (Zara) and get your money back");
  expect(declutterReplies(picks).at(-1)).toContain("Reply 'returned 1' once it's sent back.");
  expect(fresh.id).toBeGreaterThan(0);
});

test("anything added or worn in the last 30 days is left alone", async () => {
  await owns(tee, "2026-07-01"); // added 2 weeks ago, never worn
  const worn = await owns(polo, "2026-03-01");
  const spare = await owns({ ...polo, description: "navy polo, thinner" }, "2026-03-01");
  await alike(worn.id, spare.id);
  for (const day of ["2026-04-01", "2026-05-01", "2026-06-01"]) await fitCheck(day, worn.id);
  await fitCheck("2026-07-10", spare.id); // worn last week

  expect(await declutterPicks(db, "u1", ANN_ARBOR, new Date("2026-07-15T12:00:00Z"))).toEqual([]);
  expect(declutterReplies([])).toEqual([NOTHING_TO_CLEAR]);
});

test("never-worn pieces get the right exit: donate a plain tee, resell timed to the season", async () => {
  const plain = await owns(tee, "2026-01-05");
  const warm = await owns(shorts, "2025-08-01");
  await weekly("2026-01-06", "2026-01-30", plain.id); // some activity; the tee itself...
  await db.query(`DELETE FROM wears WHERE item_id = $1`, [plain.id]); // ...was never actually worn

  const january = await declutterPicks(db, "u1", ANN_ARBOR, new Date("2026-08-20T12:00:00Z"));
  const teePick = january.find((p) => p.itemId === plain.id)!;
  expect(teePick.reasons).toEqual(["Never worn since you added it in January"]);
  expect(teePick.exit.kind).toBe("donate");

  const shortsPick = january.find((p) => p.itemId === warm.id)!;
  expect(shortsPick.exit.text).toBe('Resell it in March, when people buy shorts: "Olive adidas shorts"');
  expect(shortsPick.exit.links.map((l) => l.label)).toEqual(["Depop", "eBay"]);

  // In their buying season (fall, for a sweater), it's "now".
  const knit = await owns(piece("sweater", "top", "gray", "gray cable-knit sweater", "cold", "cable knit"), "2026-01-05");
  const october = await declutterPicks(db, "u1", ANN_ARBOR, new Date("2026-10-20T12:00:00Z"));
  expect(october.find((p) => p.itemId === knit.id)!.exit.text).toStartWith("Resell it now, while people are buying sweaters");
  expect(october.map((p) => p.itemId)).not.toContain(warm.id); // shorts are out of season in October
});

test("the reply sends the top pick's photo, one line each, and how to report it", async () => {
  await owns(tee, "2026-01-05");
  const picks = await declutterPicks(db, "u1", ANN_ARBOR, new Date("2026-03-20T12:00:00Z"));
  const replies = declutterReplies(picks);
  expect(replies[0]).toEqual({ photo: "https://example.test/t-shirt.jpg" });
  expect(replies[1]).toBe(
    ["Here's what you could let go:", "1. plain white crew-neck tee: Never worn since you added it in January. Donate it: plain basics rarely resell.", "Reply 'sold 1' or 'donated 1' when it's gone."].join("\n"),
  );
});

test('"sold 2" and "donated 1" let the item go and count it as kept in circulation', async () => {
  const shirt = await owns(tee, "2026-01-05");
  const warm = await owns(shorts, "2025-08-01");
  const picks = await declutterPicks(db, "u1", ANN_ARBOR, new Date("2026-08-20T12:00:00Z"));
  await saveDeclutterList(db, "u1", picks);
  const n = (id: number) => picks.findIndex((p) => p.itemId === id) + 1;

  expect(await answerDeclutter(db, "u1", `sold ${n(warm.id)} for $15`)).toStartWith("Sold your olive adidas shorts for $15.00. It stays in circulation");
  expect(await answerDeclutter(db, "u1", `donated ${n(shirt.id)}`)).toStartWith("Donated your plain white crew-neck tee.");
  expect(await activeItems(db, "u1")).toEqual([]);
  expect(await impactTotals(db, "u1")).toMatchObject({ sold: 1, donated: 1, recovered: 15 });

  expect(await answerDeclutter(db, "u1", "sold 9")).toStartWith("There's no number 9 on the list");
  expect(await answerDeclutter(db, "u1", "returned 1")).toBeUndefined(); // not a returnable pick: returns.ts's
  expect(await answerDeclutter(db, "u1", "sold my jeans")).toBeUndefined();
});

test("declutter asks", () => {
  for (const ask of ["What should I get rid of?", "declutter", "clean out my closet", "what don't I wear", "help me declutter"]) {
    expect(isDeclutterAsk(ask)).toBe(true);
  }
  for (const other of ["what should I buy?", "get rid of the red hat", "what did I wear yesterday"]) expect(isDeclutterAsk(other)).toBe(false);
});
