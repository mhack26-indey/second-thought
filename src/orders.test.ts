import { beforeEach, expect, test } from "bun:test";
import type { AskVision } from "./closet/compare.ts";
import { addDays, isDate } from "./closet/dates.ts";
import type { ExtractedItem } from "./closet/extract.ts";
import type { OrderLine, ParsedOrder } from "./closet/order.ts";
import { activeItems, createOutfit, insertItem } from "./closet/repo.ts";
import { matchShoppingPhoto } from "./closet/shopping.ts";
import type { Db } from "./db/client.ts";
import { testDb } from "./db/test-db.ts";
import { exactMatcher } from "./ingest.ts";
import { VERIFY, intakeOrder, orderReply, retailerKey, returnPolicy } from "./orders.ts";
import { type PhotoDeps, readPhoto } from "./photo-intake.ts";
import { type RecentFitCheck, shoppingReplies } from "./shopping-mode.ts";

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
const jeansLine: OrderLine = { ...jeans, price: 49.9 };
const teeLine: OrderLine = {
  ...jeans,
  category: "top",
  type: "t-shirt",
  color_primary: "white",
  fit: "regular",
  description: "white boxy cotton t-shirt",
  price: 12.9,
};
const screenshot = { url: "https://example.test/order.png" };
const noShop = async (): Promise<never> => {
  throw new Error("not a product photo");
};
const TODAY = "2026-10-03";

let db: Db;
beforeEach(async () => {
  db = await testDb();
  await db.query(`INSERT INTO users (id, web_token) VALUES ('u1', 'token-u1')`);
});

const order = (retailer: string, items: OrderLine[], order_date: string | null = "2026-10-01"): ParsedOrder => ({
  retailer,
  order_date,
  items,
});

const purchases = () =>
  db.query<{ retailer: string; price: string; order_date: string; return_deadline: string; status: string }>(
    `SELECT retailer, price::text, to_char(order_date, 'YYYY-MM-DD') AS order_date,
       to_char(return_deadline, 'YYYY-MM-DD') AS return_deadline, status FROM purchases ORDER BY price`,
  );

/** A fit check row for a photo, the way handlePhoto saves one before reading it. */
async function savedPhoto() {
  const photoUrl = "https://example.test/photos/new";
  const outfit = await createOutfit(db, { user_id: "u1", taken_on: TODAY, photo_url: photoUrl });
  let cleanedUp = false;
  const fit: RecentFitCheck = {
    outfitId: outfit.id,
    image: screenshot,
    at: Date.now(),
    cancelled: false,
    cleanup: async () => {
      cleanedUp = true;
    },
  };
  return { outfit: { id: outfit.id, photoUrl }, fit, cleanedUp: () => cleanedUp };
}

const outfitCount = async () => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM outfits`))[0]!.n;

test("an order screenshot leaves the fit checks and goes to order intake", async () => {
  const { outfit, fit, cleanedUp } = await savedPhoto();
  const deps: PhotoDeps = {
    db,
    extract: async () => ({ kind: "order_screenshot", items: [] }),
    parseOrder: async () => order("ZARA", [jeansLine, teeLine]),
    matcher: () => exactMatcher,
    shop: noShop,
    today: () => TODAY,
  };

  const replies = await readPhoto("u1", outfit, screenshot, fit, deps);
  expect(replies).toEqual([
    `Added black straight-leg denim jeans ($49.90) and white boxy cotton t-shirt ($12.90) from Zara. Return window closes Oct 31.\n${VERIFY}`,
  ]);
  expect(await outfitCount()).toBe(0);
  expect(cleanedUp()).toBe(true);
  expect(fit.notFitCheck).toBe(true);

  expect(await purchases()).toEqual([
    { retailer: "Zara", price: "12.90", order_date: "2026-10-01", return_deadline: "2026-10-31", status: "kept" },
    { retailer: "Zara", price: "49.90", order_date: "2026-10-01", return_deadline: "2026-10-31", status: "kept" },
  ]);
  const items = await activeItems(db, "u1");
  expect(items.map((i) => [i.type, i.source])).toEqual([
    ["jeans", "order"],
    ["t-shirt", "order"],
  ]);
  expect(items.every((i) => i.purchase_id !== null)).toBe(true);
});

test("a fit check photo is still ingested as one", async () => {
  const { outfit, fit } = await savedPhoto();
  const deps: PhotoDeps = {
    db,
    extract: async () => ({ kind: "fit_check", items: [jeans] }),
    parseOrder: async () => {
      throw new Error("not an order");
    },
    matcher: () => exactMatcher,
    shop: noShop,
  };
  expect(await readPhoto("u1", outfit, screenshot, fit, deps)).toEqual([
    "Saved your fit check. New to your closet: black jeans.",
  ]);
  expect(await outfitCount()).toBe(1);
  expect(await purchases()).toEqual([]);
});

test("deadline is the order date plus the retailer's return days", async () => {
  const target = await intakeOrder(db, "u1", order("target.com", [jeansLine]), { orderDate: "2026-09-15" });
  expect(target.policy).toEqual({ retailer: "Target", days: 90, known: true });
  expect(target.deadline).toBe("2026-12-14");

  const nike = await intakeOrder(db, "u1", order("Nike", [teeLine]), { orderDate: "2026-12-20" });
  expect(nike.deadline).toBe("2027-02-18"); // across a year end
  expect(addDays("2028-02-01", 30)).toBe("2028-03-02"); // leap year
});

test("no visible order date means today", async () => {
  const { outfit, fit } = await savedPhoto();
  const replies = await readPhoto("u1", outfit, screenshot, fit, {
    db,
    extract: async () => ({ kind: "order_screenshot", items: [] }),
    parseOrder: async () => order("Uniqlo", [teeLine], null),
    matcher: () => exactMatcher,
    shop: noShop,
    today: () => TODAY,
  });
  expect(replies[0]).toContain("Return window closes Nov 2.");
  expect((await purchases())[0]!.order_date).toBe(TODAY);
  expect(isDate("2026-02-30")).toBe(false);
});

test("retailer names are normalized before matching a policy", async () => {
  const names = async (...raw: string[]) => Promise.all(raw.map(async (r) => (await returnPolicy(db, r)).retailer));
  expect(await names("ZARA", "zara.com", "www.Zara.com/us")).toEqual(["Zara", "Zara", "Zara"]);
  expect(await names("H&M", "hm.com", "Abercrombie & Fitch", "American Eagle Outfitters", "AE")).toEqual([
    "H&M",
    "H&M",
    "Abercrombie",
    "American Eagle",
    "American Eagle",
  ]);
  expect(await names("Old Navy", "lululemon athletica", "SHEIN", "amazon.com")).toEqual([
    "Old Navy",
    "Lululemon",
    "Shein",
    "Amazon",
  ]);
  expect(retailerKey("Urban Outfitters")).toBe("urbanoutfitters");
});

test("an unknown retailer gets 30 days, and the reply says so", async () => {
  const result = await intakeOrder(db, "u1", order("Princess Polly", [teeLine]), { orderDate: "2026-10-01" });
  expect(result.policy).toEqual({ retailer: "Princess Polly", days: 30, known: false });
  expect(orderReply(result, TODAY)).toBe(
    [
      "Added white boxy cotton t-shirt from Princess Polly ($12.90). Return window closes Oct 31.",
      "I don't know Princess Polly's return policy, so I assumed 30 days.",
      VERIFY,
    ].join("\n"),
  );
});

test("ordering something you already own links to it and warns", async () => {
  const owned = await insertItem(db, { ...jeans, user_id: "u1", source: "fit_check", photo_url: "https://example.test/photos/older" });
  const result = await intakeOrder(db, "u1", order("Gap", [jeansLine]), { orderDate: "2026-10-01", matcher: exactMatcher });

  const items = await activeItems(db, "u1");
  expect(items).toHaveLength(1); // linked, not added twice
  expect(items[0]!.id).toBe(owned.id);
  expect(items[0]!.purchase_id).not.toBeNull();
  expect(orderReply(result, TODAY)).toBe(
    [
      "Added black straight-leg denim jeans from Gap ($49.90). Return window closes Oct 31.",
      "Heads up: you already own black straight-leg denim jeans.",
      VERIFY,
    ].join("\n"),
  );
});

test("an expired window says closed", async () => {
  const result = await intakeOrder(db, "u1", order("Zara", [jeansLine]), { orderDate: "2026-08-01" });
  expect(orderReply(result, TODAY)).toStartWith("Added black straight-leg denim jeans from Zara ($49.90). Return window closed Aug 31.");
});

test("a shopping match from an order with an open window says it's still returnable", async () => {
  const fresh = await intakeOrder(db, "u1", order("Zara", [jeansLine]), { orderDate: "2026-10-01" });
  const old = await intakeOrder(db, "u1", order("Zara", [teeLine]), { orderDate: "2026-08-01" });
  const ids = [fresh.lines[0]!.item.id, old.lines[0]!.item.id];
  const ask: AskVision = async () => ({
    items: [{ seen: 0, matches: [{ item_id: ids[0]!, similarity: "near_identical", reason: "same jeans" }] }],
  });
  const askTee: AskVision = async () => ({
    items: [{ seen: 0, matches: [{ item_id: ids[1]!, similarity: "similar", reason: "same boxy tee" }] }],
  });
  const noPhotos = async (): Promise<never> => {
    throw new Error("offline");
  };

  const open = await matchShoppingPhoto(db, "u1", screenshot, { extract: async () => [jeans], ask, load: noPhotos, today: () => TODAY });
  expect(open.matches[0]!.returnable_until).toBe("2026-10-31");
  expect(shoppingReplies(open)[0]).toContain("same jeans (since ");
  expect(shoppingReplies(open)[0]).toEndWith(", still returnable until Oct 31)");

  const tee = { ...jeans, category: "top" as const, type: "t-shirt", description: "white tee" };
  const closed = await matchShoppingPhoto(db, "u1", screenshot, { extract: async () => [tee], ask: askTee, load: noPhotos, today: () => TODAY });
  expect(closed.matches[0]!.returnable_until).toBeNull();
  expect(shoppingReplies(closed)[0]).not.toContain("returnable");
});
