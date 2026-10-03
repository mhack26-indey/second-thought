import { beforeEach, expect, test } from "bun:test";
import { migrate, type Db } from "../db/client.ts";
import { testDb } from "../db/test-db.ts";
import { CATEGORIES } from "./categories.ts";
import type { ExtractedItem } from "./extract.ts";
import {
  activeItems,
  addWear,
  candidatesByCategory,
  createOutfit,
  insertItem,
  setItemStatus,
  wearCount,
} from "./repo.ts";

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
const hoodie: ExtractedItem = {
  ...jeans,
  category: "top",
  type: "hoodie",
  fit: "oversized",
  season: "cold",
  description: "grey oversized pullover hoodie",
};

let db: Db;
beforeEach(async () => {
  db = await testDb();
});

test("migrate is idempotent", async () => {
  await migrate(db);
  await migrate(db);
});

test("insertItem returns the saved row with defaults", async () => {
  const item = await insertItem(db, { ...jeans, user_id: "u1", source: "fit_check" });
  expect(item.id).toBeGreaterThan(0);
  expect(item.status).toBe("active");
  expect(item.type).toBe("jeans");
  expect(item.created_at).toBeInstanceOf(Date);
});

test("every app category passes the SQL category check", async () => {
  for (const category of CATEGORIES) {
    await insertItem(db, { ...jeans, category, user_id: "u1", source: "closet" });
  }
});

test("SQL rejects unknown categories and sources", async () => {
  await expect(insertItem(db, { ...jeans, category: "hat" as never, user_id: "u1", source: "closet" })).rejects.toThrow();
  await expect(insertItem(db, { ...jeans, user_id: "u1", source: "gift" as never })).rejects.toThrow();
});

test("candidatesByCategory scopes to user, category and active items", async () => {
  const mine = await insertItem(db, { ...jeans, user_id: "u1", source: "fit_check" });
  await insertItem(db, { ...hoodie, user_id: "u1", source: "fit_check" });
  await insertItem(db, { ...jeans, user_id: "u2", source: "fit_check" });
  const returned = await insertItem(db, { ...jeans, user_id: "u1", source: "order" });
  await db.query(`UPDATE items SET status = 'returned' WHERE id = $1`, [returned.id]);

  const candidates = await candidatesByCategory(db, "u1", "bottom");
  expect(candidates.map((c) => c.id)).toEqual([mine.id]);
});

test("text items need no photo", async () => {
  const item = await insertItem(db, { ...jeans, user_id: "u1", source: "text" });
  expect(item.photo_url).toBeNull();
  expect(item.source).toBe("text");
});

test("activeItems lists every category but skips removed items, scoped to the user", async () => {
  const a = await insertItem(db, { ...jeans, user_id: "u1", source: "text" });
  const b = await insertItem(db, { ...hoodie, user_id: "u1", source: "fit_check" });
  const gone = await insertItem(db, { ...jeans, user_id: "u1", source: "text" });
  await insertItem(db, { ...jeans, user_id: "u2", source: "text" });

  expect(await setItemStatus(db, "u1", gone.id, "removed")).toBe(true);
  expect((await activeItems(db, "u1")).map((i) => i.id)).toEqual([a.id, b.id]);
});

test("setItemStatus won't touch another user's item", async () => {
  const theirs = await insertItem(db, { ...jeans, user_id: "u2", source: "text" });
  expect(await setItemStatus(db, "u1", theirs.id, "removed")).toBe(false);
  expect((await activeItems(db, "u2")).length).toBe(1);
});

test("wears link items to outfits and count per item", async () => {
  const item = await insertItem(db, { ...jeans, user_id: "u1", source: "fit_check" });
  const monday = await createOutfit(db, { user_id: "u1", taken_on: "2026-09-28", photo_url: "https://x/1.jpg" });
  const tuesday = await createOutfit(db, { user_id: "u1", taken_on: "2026-09-29" });
  await addWear(db, item.id, monday.id);
  await addWear(db, item.id, tuesday.id);
  await addWear(db, item.id, tuesday.id); // duplicate is a no-op
  expect(await wearCount(db, item.id)).toBe(2);
  expect(monday.taken_on).toBeInstanceOf(Date);
});

test("deleting an item removes its wears", async () => {
  const item = await insertItem(db, { ...jeans, user_id: "u1", source: "fit_check" });
  const outfit = await createOutfit(db, { user_id: "u1", taken_on: "2026-09-28" });
  await addWear(db, item.id, outfit.id);
  await db.query(`DELETE FROM items WHERE id = $1`, [item.id]);
  expect(await db.query(`SELECT * FROM wears`)).toEqual([]);
});
