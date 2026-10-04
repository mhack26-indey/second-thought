import { expect, test } from "bun:test";
import { closetFacts } from "./ask.ts";
import { addWear, createOutfit, insertItem } from "./closet/repo.ts";
import { testDb } from "./db/test-db.ts";

test("the facts the model reads are counted and dated by code", async () => {
  const db = await testDb();
  await db.query(`INSERT INTO users (id, web_token, step, city) VALUES ('u1', 't1', 'done', 'Ann Arbor, Michigan')`);
  const base = { color_secondary: null, pattern: "solid", fit: "regular", season: "all", user_id: "u1", source: "fit_check" } as const;
  const jeans = await insertItem(db, { ...base, category: "bottom", type: "jeans", color_primary: "black", description: "black jeans" });
  await insertItem(db, { ...base, category: "top", type: "t-shirt", color_primary: "white", description: "white tee" });
  for (const day of ["2026-09-20", "2026-10-01"]) await addWear(db, jeans.id, (await createOutfit(db, { user_id: "u1", taken_on: day, photo_url: `p/${day}` })).id);

  const facts = await closetFacts(db, "u1");
  expect(facts.profile.city).toBe("Ann Arbor, Michigan");
  expect(facts.items.find((i) => i.item === "black jeans")).toMatchObject({ times_worn: 2, last_worn: "2026-10-01" });
  expect(facts.items.find((i) => i.item === "white tee")).toMatchObject({ times_worn: 0, last_worn: null });
  expect(facts.fit_checks.map((f) => [f.date, f.wearing])).toEqual([
    ["2026-10-01", ["black jeans"]],
    ["2026-09-20", ["black jeans"]],
  ]);
});
