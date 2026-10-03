import { beforeEach, expect, test } from "bun:test";
import type { ExtractedItem } from "./closet/extract.ts";
import { activeItems, createOutfit, insertItem, wearCount } from "./closet/repo.ts";
import type { Db } from "./db/client.ts";
import { testDb } from "./db/test-db.ts";
import { type Matcher, exactMatcher, ingestOutfit } from "./ingest.ts";

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

let db: Db;
let outfitN = 0;
beforeEach(async () => {
  db = await testDb();
});

async function fitCheck(seen: ExtractedItem[], matcher: Matcher = exactMatcher) {
  const photoUrl = `https://example.test/photos/${++outfitN}`;
  const outfit = await createOutfit(db, { user_id: "u1", taken_on: "2026-10-03", photo_url: photoUrl });
  return ingestOutfit(db, "u1", { id: outfit.id, photoUrl }, seen, matcher);
}

test("first fit check adds items; the second logs wears", async () => {
  const first = await fitCheck([jeans, tee]);
  expect(first.added.map((i) => i.type)).toEqual(["jeans", "t-shirt"]);
  expect(first.added[0]!.source).toBe("fit_check");

  const second = await fitCheck([jeans, { ...tee, color_primary: "navy" }]);
  expect(second.worn.map((i) => i.type)).toEqual(["jeans"]);
  expect(second.added.map((i) => i.color_primary)).toEqual(["navy"]);

  expect(await wearCount(db, first.added[0]!.id)).toBe(2);
  expect(await activeItems(db, "u1")).toHaveLength(3);
});

test("a texted item picks up details and a photo when it's worn", async () => {
  const texted = await insertItem(db, {
    ...jeans,
    user_id: "u1",
    source: "text",
    color_primary: "black",
    pattern: "unknown",
    fit: "unknown",
    description: "black jeans",
  });

  const { worn, added } = await fitCheck([{ ...jeans, color_secondary: "grey" }]);
  expect(added).toEqual([]);
  expect(worn[0]!.id).toBe(texted.id);
  expect(worn[0]!.fit).toBe("straight-leg");
  expect(worn[0]!.pattern).toBe("solid");
  expect(worn[0]!.photo_url).toStartWith("https://example.test/photos/");
});

test("two matching items in one photo are two items", async () => {
  await fitCheck([tee]);
  const { worn, added } = await fitCheck([tee, tee]);
  expect(worn).toHaveLength(1);
  expect(added).toHaveLength(1);
});

test("removed items aren't matched", async () => {
  const { added } = await fitCheck([jeans]);
  await db.query(`UPDATE items SET status = 'removed' WHERE id = $1`, [added[0]!.id]);
  const second = await fitCheck([jeans]);
  expect(second.added).toHaveLength(1);
});

test("the model's matches are used, and a failed call falls back to exact match", async () => {
  const { added } = await fitCheck([jeans]);
  const greyJeans = { ...jeans, color_primary: "charcoal" };

  const viaModel = await fitCheck([greyJeans], async () => [added[0]!.id]);
  expect(viaModel.worn.map((i) => i.id)).toEqual([added[0]!.id]);

  const fallback = await fitCheck([greyJeans], async () => {
    throw new Error("model down");
  });
  expect(fallback.added).toHaveLength(1); // exact match can't tell charcoal from black
});
