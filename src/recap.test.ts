import { beforeEach, expect, test } from "bun:test";
import type { ExtractedItem } from "./closet/extract.ts";
import { addWear, createOutfit, insertItem } from "./closet/repo.ts";
import type { Db } from "./db/client.ts";
import { testDb } from "./db/test-db.ts";
import { buildRecap, last30Days, previousMonth, recapText } from "./recap.ts";
import { recapPng } from "./recap-card.ts";

const jeans: ExtractedItem = {
  category: "bottom",
  type: "jeans",
  color_primary: "black",
  color_secondary: null,
  pattern: "solid",
  fit: "straight-leg",
  season: "all",
  description: "black straight-leg jeans",
};

let db: Db;
beforeEach(async () => {
  db = await testDb();
  await db.query(`INSERT INTO users (id, web_token, step) VALUES ('u1', 't1', 'done')`);
});

async function item(description: string, created: string, type = "jeans", category = "bottom") {
  const it = await insertItem(db, { ...jeans, type, category: category as any, description, user_id: "u1", source: "fit_check" });
  await db.query(`UPDATE items SET created_at = $2 WHERE id = $1`, [it.id, created]);
  return it;
}

test("counts the period's fit checks, wears, most worn, ghosts and impact", async () => {
  const fav = await item("black straight-leg jeans", "2026-08-01");
  const tee = await item("white tee", "2026-08-01", "t-shirt", "top");
  const ghost = await item("red puffer", "2026-08-01", "puffer", "outerwear");
  await item("new hat", "2026-09-28", "hat", "accessory"); // too new to be a ghost

  for (const day of ["2026-09-05", "2026-09-12", "2026-09-20"]) {
    const o = await createOutfit(db, { user_id: "u1", taken_on: day, photo_url: `p/${day}` });
    await addWear(db, fav.id, o.id);
    if (day === "2026-09-12") await addWear(db, tee.id, o.id);
  }
  const before = await createOutfit(db, { user_id: "u1", taken_on: "2026-08-20", photo_url: "p/aug" });
  await addWear(db, ghost.id, before.id); // worn, but not in September

  await db.query(
    `INSERT INTO impact_events (user_id, kind, amount, item_id, created_at) VALUES
       ('u1', 'avoided', NULL, $1, '2026-09-10'), ('u1', 'sold', 20, $2, '2026-09-15'), ('u1', 'avoided', NULL, $1, '2026-08-10')`,
    [fav.id, tee.id],
  );

  const r = await buildRecap(db, "u1", "2026-09-01", "2026-10-01", "September 2026");
  expect(r).toMatchObject({
    fitChecks: 3,
    itemsWorn: 2,
    closetSize: 4,
    favorites: [{ description: "black straight-leg jeans", category: "bottom", wears: 3, photoUrl: null }], // the tee was worn once
    ghosts: ["red puffer"],
    newItems: 1,
    skipped: 1,
    letGo: 1,
    moneyBack: 20,
  });
  expect(r.co2Kg).toBeCloseTo(16.34 + 10.6); // a skipped pair of jeans and a sold tee (footprint.ts)
  expect(recapText(r)).toContain("Most worn: black straight-leg jeans (3×).");

  // The card draws to a PNG.
  const png = await recapPng(r);
  expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
});

test("most worn is per category, so shoes don't win everything; one wear doesn't count", async () => {
  const sneakers = await item("white sneakers", "2026-08-01", "sneakers", "shoes");
  const jeansA = await item("black straight-leg jeans", "2026-08-01");
  const jeansB = await item("blue wide-leg jeans", "2026-08-01");
  const tee = await item("white tee", "2026-08-01", "t-shirt", "top");
  for (const [i, day] of ["2026-09-02", "2026-09-09", "2026-09-16", "2026-09-23"].entries()) {
    const o = await createOutfit(db, { user_id: "u1", taken_on: day, photo_url: `p/${day}` });
    await addWear(db, sneakers.id, o.id); // every day
    await addWear(db, (i < 3 ? jeansA : jeansB).id, o.id);
    if (i === 0) await addWear(db, tee.id, o.id); // once: not a favorite
  }
  const r = await buildRecap(db, "u1", "2026-09-01", "2026-10-01", "September 2026");
  expect(r.favorites.map((f) => [f.category, f.description, f.wears])).toEqual([
    ["bottom", "black straight-leg jeans", 3],
    ["shoes", "white sneakers", 4],
  ]);
});

test("periods: the last 30 days through today, and last calendar month", () => {
  expect(last30Days(new Date(2026, 9, 3))).toEqual({ from: "2026-09-04", to: "2026-10-04", title: "Your last 30 days" });
  expect(previousMonth(new Date(2026, 9, 1, 11))).toEqual({ from: "2026-09-01", to: "2026-10-01", title: "September 2026", key: "2026-09" });
  expect(previousMonth(new Date(2027, 0, 1)).key).toBe("2026-12");
});
