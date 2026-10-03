import { beforeEach, expect, test } from "bun:test";
import type { ExtractedItem } from "./closet/extract.ts";
import type { OrderLine } from "./closet/order.ts";
import { addWear, createOutfit } from "./closet/repo.ts";
import type { Db } from "./db/client.ts";
import { testDb } from "./db/test-db.ts";
import { exactMatcher } from "./ingest.ts";
import { VERIFY, intakeOrder } from "./orders.ts";
import { readPhoto } from "./photo-intake.ts";
import { claimNudges, handleReturnsText, releaseNudge } from "./returns.ts";
import type { RecentFitCheck } from "./shopping-mode.ts";

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
const line = (item: Partial<ExtractedItem>, price = 40): OrderLine => ({ ...jeans, ...item, price });
const tee = line({ category: "top", type: "t-shirt", color_primary: "white", description: "white boxy t-shirt" });
const sneakers = line({ category: "shoes", type: "sneakers", color_primary: "white", description: "white leather sneakers" });

const TODAY = "2026-10-03";

let db: Db;
beforeEach(async () => {
  db = await testDb();
  await db.query(`INSERT INTO users (id, web_token) VALUES ('u1', 'token-u1')`);
});

/** One order; returns the closet item id for each line. */
async function ordered(retailer: string, orderDate: string, items: OrderLine[]): Promise<number[]> {
  const result = await intakeOrder(db, "u1", { retailer, order_date: orderDate, items }, { orderDate, matcher: exactMatcher });
  return result.lines.map((l) => l.item.id);
}

async function wear(itemId: number, takenOn: string) {
  const outfit = await createOutfit(db, { user_id: "u1", taken_on: takenOn });
  await addWear(db, itemId, outfit.id);
}

const purchase = async (description: string) =>
  (
    await db.query<{ status: string; nudge_answer: string | null; item_status: string }>(
      `SELECT p.status, p.nudge_answer, i.status AS item_status
       FROM purchases p JOIN items i ON i.purchase_id = p.id::text WHERE i.description = $1`,
      [description],
    )
  )[0]!;

const reply = (text: string) => handleReturnsText(db, "u1", text, TODAY);

// Zara gives 30 days: ordered Sep 6, the window closes Oct 6, 3 days from TODAY.
const CLOSING_SOON = "2026-09-06";

test("an unworn item is nudged 3 days out; a worn one isn't", async () => {
  const [jeansId, teeId] = await ordered("Zara", CLOSING_SOON, [line({}), tee]);
  await wear(teeId!, "2026-09-20");

  const nudges = await claimNudges(db, { today: TODAY });
  expect(nudges.map((n) => n.text)).toEqual([
    "You haven't worn the black straight-leg denim jeans from Zara in any fit checks yet. Return window closes Oct 6. Keeping it? Reply keep or return.",
  ]);
  expect(nudges[0]!.userId).toBe("u1");
  expect(jeansId).toBeGreaterThan(0);
});

test("only windows closing within 3 days, and a wear before the order doesn't count", async () => {
  await ordered("Zara", "2026-09-05", [line({})]); // closes Oct 5
  await ordered("Zara", "2026-09-07", [tee]); // closes Oct 7: 4 days out
  const [sneakersId] = await ordered("Zara", "2026-09-04", [sneakers]); // closes Oct 4
  await wear(sneakersId!, "2026-09-01"); // before the order: an earlier pair, or the same pair before the screenshot

  const texts = (await claimNudges(db, { today: TODAY })).map((n) => n.text);
  expect(texts).toHaveLength(2);
  expect(texts[0]).toStartWith("You haven't worn the white leather sneakers from Zara"); // soonest first
  expect(texts[1]).toStartWith("You haven't worn the black straight-leg denim jeans from Zara");
});

test("each purchase is nudged once; a failed send can be retried", async () => {
  await ordered("Zara", CLOSING_SOON, [line({})]);
  const [first] = await claimNudges(db, { today: TODAY });
  expect(first).toBeDefined();
  expect(await claimNudges(db, { today: TODAY })).toEqual([]);
  expect(await claimNudges(db, { today: "2026-10-04" })).toEqual([]); // next day too

  await releaseNudge(db, first!.purchaseId);
  expect(await claimNudges(db, { today: TODAY })).toHaveLength(1);
});

test('"return" marks it returning, links the returns page; "returned it" finishes it', async () => {
  await ordered("Zara", CLOSING_SOON, [line({})]);
  await claimNudges(db, { today: TODAY });

  expect(await reply("Return")).toEqual([
    [
      "Okay, the black straight-leg denim jeans is marked as returning.",
      "Start the return here: https://www.zara.com/us/en/help-center/HowToReturn",
      'Text "returned it" once it\'s sent back.',
      VERIFY,
    ].join("\n"),
  ]);
  expect(await purchase("black straight-leg denim jeans")).toEqual({
    status: "returning",
    nudge_answer: "return",
    item_status: "returned",
  });

  expect(await reply("return")).toBeUndefined(); // nothing waiting on an answer now
  expect(await reply("returned it!")).toEqual(["Marked the black straight-leg denim jeans from Zara as returned."]);
  expect((await purchase("black straight-leg denim jeans")).status).toBe("returned");
  expect(await reply("returned it")).toEqual(["I don't have a return in progress for you."]);
});

test('"keep" leaves it and confirms', async () => {
  await ordered("Zara", CLOSING_SOON, [line({})]);
  expect(await reply("keep")).toBeUndefined(); // not nudged yet: not ours to answer
  await claimNudges(db, { today: TODAY });

  expect(await reply("I'll keep it")).toEqual(["Got it, you're keeping the black straight-leg denim jeans."]);
  expect(await purchase("black straight-leg denim jeans")).toEqual({ status: "kept", nudge_answer: "keep", item_status: "active" });
  expect(await reply("keep")).toBeUndefined();
});

test("with two nudges waiting, a bare answer asks which", async () => {
  await ordered("Zara", CLOSING_SOON, [line({}), tee]);
  await claimNudges(db, { today: TODAY });

  const [which] = (await reply("return"))!;
  expect(which).toStartWith("Which one?\n1. ");
  const second = which!.split("\n")[2]!.replace(/^2\. /, "").replace(/ from Zara$/, "");
  await reply("return 2");
  expect((await purchase(second)).status).toBe("returning");
});

test('"check returns" nudges now, whatever the deadline, and only once', async () => {
  await ordered("Nike", "2026-09-20", [sneakers]); // Nike: 60 days, closes Nov 19
  expect(await claimNudges(db, { today: TODAY })).toEqual([]); // not within 3 days

  expect(await reply("check returns")).toEqual([
    "You haven't worn the white leather sneakers from Nike in any fit checks yet. Return window closes Nov 19. Keeping it? Reply keep or return.",
  ]);
  expect((await reply("return"))![0]).toContain("https://www.nike.com/help/a/returns-policy");
  expect((await reply("Check my returns"))![0]).toStartWith("Nothing to check");
});

test('"check returns" skips orders from the last 7 days', async () => {
  await ordered("Zara", "2026-09-28", [sneakers]); // 5 days ago: just arrived, not nudged
  await ordered("Zara", "2026-09-26", [line({})]); // 7 days ago: checked

  const replies = await reply("check returns");
  expect(replies).toHaveLength(1);
  expect(replies![0]).toStartWith("You haven't worn the black straight-leg denim jeans from Zara");

  expect(await reply("check returns")).toEqual([
    "Nothing to check: everything you ordered with an open return window has shown up in a fit check or already got asked about. Orders from the last 7 days get a week to show up in a fit check first.",
  ]);
  // The recent one isn't used up: the daily pass can still nudge it near its deadline.
  expect(await claimNudges(db, { today: "2026-10-26" })).toHaveLength(1);
});

test("a closed window is never nudged", async () => {
  await ordered("Zara", "2026-08-01", [line({})]); // closed Aug 31
  expect((await reply("check returns"))![0]).toStartWith("Nothing to check");
});

test("a product photo comes out of the fit checks and gets the shopping match", async () => {
  const photoUrl = "https://example.test/photos/new";
  const outfit = await createOutfit(db, { user_id: "u1", taken_on: TODAY, photo_url: photoUrl });
  let cleanedUp = false;
  const fit: RecentFitCheck = {
    outfitId: outfit.id,
    image: { url: photoUrl },
    at: Date.now(),
    cancelled: false,
    cleanup: async () => {
      cleanedUp = true;
    },
  };
  let shoppedWith: ExtractedItem[] | undefined;
  const replies = await readPhoto("u1", { id: outfit.id, photoUrl }, fit.image, fit, {
    db,
    extract: async () => ({ kind: "product", items: [jeans] }),
    parseOrder: async () => {
      throw new Error("not an order");
    },
    matcher: () => exactMatcher,
    shop: async (_user, _image, seen) => {
      shoppedWith = seen;
      return ["You already have 1 like this:\n• …", { photo: "https://example.test/photos/older" }];
    },
  });

  expect(replies).toEqual([
    "That looks like a product photo, so I checked your closet instead of saving it as a fit check.",
    "You already have 1 like this:\n• …",
    { photo: "https://example.test/photos/older" },
  ]);
  expect(shoppedWith).toEqual([jeans]); // the extraction is reused, not repeated
  expect((await db.query(`SELECT id FROM outfits`)).length).toBe(0);
  expect((await db.query(`SELECT id FROM items`)).length).toBe(0);
  expect(cleanedUp).toBe(true);
  expect(fit.notFitCheck).toBe(true);
});
