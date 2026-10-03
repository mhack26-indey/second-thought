import { beforeEach, expect, test } from "bun:test";
import type { ExtractedItem } from "./closet/extract.ts";
import { activeItems, addWear, createOutfit, insertItem, wearCount } from "./closet/repo.ts";
import type { Db } from "./db/client.ts";
import { testDb } from "./db/test-db.ts";
import { addItemToOutfit, linkItem, mergeItems, unlinkItem } from "./fit-edits.ts";

const sweats: ExtractedItem = {
  category: "bottom",
  type: "sweatpants",
  color_primary: "gray",
  color_secondary: null,
  pattern: "solid",
  fit: "relaxed",
  season: "all",
  description: "grey puma sweatpants",
};

let db: Db;
beforeEach(async () => {
  db = await testDb();
});

async function fit(url: string, userId = "u1") {
  return createOutfit(db, { user_id: userId, taken_on: "2026-10-01", photo_url: url });
}

test("merge moves every wear to the real item and removes the duplicate", async () => {
  const [a, b, c] = [await fit("p/a"), await fit("p/b"), await fit("p/c")];
  const real = await insertItem(db, { ...sweats, user_id: "u1", source: "fit_check", photo_url: "p/a" });
  const dupe = await insertItem(db, { ...sweats, description: "heather grey drawstring sweatpants", user_id: "u1", source: "fit_check", photo_url: "p/b" });
  await addWear(db, real.id, a.id);
  await addWear(db, dupe.id, b.id);
  await addWear(db, dupe.id, c.id);
  await addWear(db, real.id, c.id); // both linked to one photo: no double wear after the merge

  expect(await mergeItems(db, "u1", dupe.id, real.id)).toBe(true);
  expect(await wearCount(db, real.id)).toBe(3);
  expect((await activeItems(db, "u1")).map((i) => i.id)).toEqual([real.id]);
});

test("merge refuses another user's item or the item itself", async () => {
  const mine = await insertItem(db, { ...sweats, user_id: "u1", source: "text" });
  const theirs = await insertItem(db, { ...sweats, user_id: "u2", source: "text" });
  expect(await mergeItems(db, "u1", mine.id, theirs.id)).toBe(false);
  expect(await mergeItems(db, "u1", mine.id, mine.id)).toBe(false);
  expect(await activeItems(db, "u1")).toHaveLength(1);
});

test("unlink removes an item only ever seen in that photo, and keeps one worn elsewhere", async () => {
  const [a, b] = [await fit("p/a"), await fit("p/b")];
  const madeUp = await insertItem(db, { ...sweats, user_id: "u1", source: "fit_check", photo_url: "p/a" });
  const real = await insertItem(db, { ...sweats, description: "black jeans", user_id: "u1", source: "fit_check", photo_url: "p/a" });
  await addWear(db, madeUp.id, a.id);
  await addWear(db, real.id, a.id);
  await addWear(db, real.id, b.id);

  expect(await unlinkItem(db, "u1", a.id, madeUp.id)).toEqual({ removed: true });
  expect(await unlinkItem(db, "u1", a.id, real.id)).toEqual({ removed: false });
  expect(await wearCount(db, real.id)).toBe(1);
  expect((await activeItems(db, "u1")).map((i) => i.id)).toEqual([real.id]);
});

test("unlink keeps a texted item even with no wears left", async () => {
  const a = await fit("p/a");
  const texted = await insertItem(db, { ...sweats, user_id: "u1", source: "text" });
  await addWear(db, texted.id, a.id);
  expect(await unlinkItem(db, "u1", a.id, texted.id)).toEqual({ removed: false });
  expect(await activeItems(db, "u1")).toHaveLength(1);
});

test("link and add only touch the user's own items and photos", async () => {
  const mine = await fit("p/a");
  const theirs = await fit("p/x", "u2");
  const item = await insertItem(db, { ...sweats, user_id: "u1", source: "text" });

  expect(await linkItem(db, "u1", mine.id, item.id)).toBe(true);
  expect(await linkItem(db, "u1", mine.id, item.id)).toBe(true); // already linked: still fine, one wear
  expect(await wearCount(db, item.id)).toBe(1);
  expect(await linkItem(db, "u1", theirs.id, item.id)).toBe(false);

  const added = await addItemToOutfit(db, "u1", { id: mine.id, photoUrl: "p/a" }, { ...sweats, description: "olive tote" });
  expect(added.source).toBe("fit_check");
  expect(added.photo_url).toBe("p/a");
  expect(await wearCount(db, added.id)).toBe(1);
});
