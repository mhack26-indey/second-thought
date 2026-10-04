import { beforeEach, expect, test } from "bun:test";
import type { AskVision } from "./closet/compare.ts";
import type { ExtractedItem } from "./closet/extract.ts";
import { activeItems, addWear, createOutfit, insertItem, wearCount } from "./closet/repo.ts";
import type { Db } from "./db/client.ts";
import { testDb } from "./db/test-db.ts";
import { ingestOutfit } from "./ingest.ts";
import { PENDING_MS, ShoppingMode, UNDO_MS, isShoppingAsk, isShoppingCaption } from "./shopping-mode.ts";

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
const tee: ExtractedItem = {
  ...jeans,
  category: "top",
  type: "t-shirt",
  color_primary: "white",
  fit: "regular",
  description: "plain white crew-neck t-shirt",
};
const shoppingPhoto = { url: "https://example.test/store-photo.jpg" };

let db: Db;
let clock: number;
beforeEach(async () => {
  db = await testDb();
  await db.query(`INSERT INTO users (id, web_token) VALUES ('u1', 'token-u1')`);
  clock = Date.parse("2026-10-03T12:00:00Z");
});

const noPhotos = async (): Promise<never> => {
  throw new Error("offline");
};
const noExtract = async (): Promise<never> => {
  throw new Error("extraction should have been reused");
};

/** The vision model calls every candidate in `ids` near_identical to seen item 0. */
const sameAs =
  (ids: () => number[]): AskVision =>
  async () => ({
    items: [{ seen: 0, matches: ids().map((item_id) => ({ item_id, similarity: "near_identical" as const, reason: "same wash and cut" })) }],
  });

/** Jeans first seen in an earlier fit check, so they have a photo and a wear. */
async function ownedJeans() {
  const photoUrl = "https://example.test/photos/older";
  const outfit = await createOutfit(db, { user_id: "u1", taken_on: "2026-09-12", photo_url: photoUrl });
  const item = await insertItem(db, { ...jeans, user_id: "u1", source: "fit_check", photo_url: photoUrl });
  await addWear(db, item.id, outfit.id);
  return item;
}

const outfitCount = async () => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM outfits`))[0]!.n;

test("text then photo: the ask waits for the photo, which is matched and not saved", async () => {
  const owned = await ownedJeans();
  const mode = new ShoppingMode({
    db,
    now: () => clock,
    match: { extract: async () => [jeans], ask: sameAs(() => [owned.id]), load: noPhotos },
  });

  expect(mode.onText("u1", "Do I have this?")).toEqual({ replies: ["Send me the photo."] });
  clock += PENDING_MS - 1000;
  expect(mode.takePending("u1")).toBe(true);
  expect(mode.takePending("u1")).toBe(false); // one photo per ask

  const replies = await mode.match("u1", shoppingPhoto);
  const since = owned.created_at.toLocaleDateString("en-US", { month: "long" });
  expect(replies).toEqual([
    `You already have 1 like this:\n• black straight-leg denim jeans: same wash and cut (since ${since})`,
    { photo: "https://example.test/photos/older" },
    `Skip it? Making a new pair of jeans emits ≈ 16 kg CO₂e (about 41 miles of driving), estimated from Carbonfact's average for the category. Reply "skip" and I'll count it, or "buying it" if you're getting it anyway.`,
  ]);
  expect(await activeItems(db, "u1")).toHaveLength(1);
  expect(await outfitCount()).toBe(1);
});

test("the ask expires after 5 minutes", async () => {
  const mode = new ShoppingMode({ db, now: () => clock });
  mode.onText("u1", "shopping");
  clock += PENDING_MS + 1;
  expect(mode.takePending("u1")).toBe(false);
});

test("photo then text: the fit check is taken back and its photo matched", async () => {
  const owned = await ownedJeans();
  const mode = new ShoppingMode({
    db,
    now: () => clock,
    match: { extract: noExtract, ask: sameAs(() => [owned.id]), load: noPhotos },
  });

  // The photo came in as a fit check: the jeans were logged as worn, the tee added.
  const photoUrl = "https://example.test/photos/new";
  const outfit = await createOutfit(db, { user_id: "u1", taken_on: "2026-10-03", photo_url: photoUrl });
  let cleanedUp = false;
  const fit = {
    outfitId: outfit.id,
    image: shoppingPhoto,
    at: clock,
    cancelled: false,
    seen: [jeans, tee],
    cleanup: async () => {
      cleanedUp = true;
    },
    work: undefined as Promise<unknown> | undefined,
  };
  mode.fitCheckSaved("u1", fit);
  fit.work = ingestOutfit(db, "u1", { id: outfit.id, photoUrl }, [jeans, tee], async () => [owned.id, null]);
  await fit.work;
  expect(await activeItems(db, "u1")).toHaveLength(2);

  clock += UNDO_MS - 1000;
  const ask = mode.onText("u1", "do I own something like this");
  expect(ask?.replies).toEqual([]);
  expect(fit.cancelled).toBe(true);

  const replies = await ask!.later!();
  expect(replies[0]).toBe("Got it, that's not a fit check. I took it back out.");
  expect(replies[1]).toStartWith("You already have 1 like this:\n• black straight-leg denim jeans");
  expect(replies[2]).toEqual({ photo: "https://example.test/photos/older" });

  expect((await activeItems(db, "u1")).map((i) => i.id)).toEqual([owned.id]); // tee gone, jeans kept
  expect(await wearCount(db, owned.id)).toBe(1); // only the older wear
  expect(await outfitCount()).toBe(1);
  expect(cleanedUp).toBe(true);
});

test("an ask more than 2 minutes after a fit check waits for a new photo instead", async () => {
  const mode = new ShoppingMode({ db, now: () => clock });
  const outfit = await createOutfit(db, { user_id: "u1", taken_on: "2026-10-03" });
  mode.fitCheckSaved("u1", { outfitId: outfit.id, image: shoppingPhoto, at: clock, cancelled: false });
  clock += UNDO_MS + 1;
  expect(mode.onText("u1", "do i have this")).toEqual({ replies: ["Send me the photo."] });
  expect(await outfitCount()).toBe(1);
});

test("undo leaves a texted item but takes back the photo it picked up", async () => {
  const texted = await insertItem(db, { ...tee, user_id: "u1", source: "text", fit: "unknown", description: "white tee" });
  const photoUrl = "https://example.test/photos/new";
  const outfit = await createOutfit(db, { user_id: "u1", taken_on: "2026-10-03", photo_url: photoUrl });
  await ingestOutfit(db, "u1", { id: outfit.id, photoUrl }, [tee], async () => [texted.id]);

  const mode = new ShoppingMode({ db, now: () => clock, match: { extract: noExtract, ask: sameAs(() => []), load: noPhotos } });
  mode.fitCheckSaved("u1", { outfitId: outfit.id, image: shoppingPhoto, at: clock, cancelled: false, seen: [tee] });
  await mode.onText("u1", "do I have this")!.later!();

  const [item] = await activeItems(db, "u1");
  expect(item!.id).toBe(texted.id);
  expect(item!.photo_url).toBeNull();
  expect(await wearCount(db, texted.id)).toBe(0);
});

test("no match: says so and links a secondhand search", async () => {
  const mode = new ShoppingMode({ db, match: { extract: async () => [jeans], ask: sameAs(() => []), load: noPhotos } });
  expect(await mode.match("u1", shoppingPhoto)).toEqual([
    "Nothing like it in your closet.\nSecondhand: https://www.depop.com/search/?q=black%20straight-leg%20denim%20jeans",
  ]);
});

test("a failed vision call gets a reply, not silence", async () => {
  const mode = new ShoppingMode({ db, match: { extract: noExtract } });
  expect(await mode.match("u1", shoppingPhoto)).toEqual(["I couldn't make out that photo. Try another one?"]);
});

test("shopping asks are whole-message phrasings", () => {
  for (const ask of [
    "Do I have this?",
    "do I own something like this",
    "do i already have something similar to this",
    "Shopping",
    "I'm shopping rn",
    "checking something",
    "im checking something out",
  ]) {
    expect(isShoppingAsk(ask)).toBe(true);
  }
  for (const other of [
    "remind me in 2 hours to go shopping",
    "do I have black jeans?",
    "what should I buy?",
    "my wardrobe",
  ]) {
    expect(isShoppingAsk(other)).toBe(false);
  }
});

test("photo captions that mean 'check my closet' vs a plain fit check", () => {
  for (const c of ["do I have this?", "is this a dupe", "should i buy these", "thinking about getting this", "in the store rn, do I already own something like it"]) {
    expect(isShoppingCaption(c)).toBe(true);
  }
  for (const c of ["fit check", "today's fit", "first day of class", "new haircut lol"]) expect(isShoppingCaption(c)).toBe(false);
});
