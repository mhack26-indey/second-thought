import { beforeEach, expect, test } from "bun:test";
import { addDays, formatDay, today as localToday } from "./closet/dates.ts";
import { activeItems, insertItem, recentWears } from "./closet/repo.ts";
import type { Db } from "./db/client.ts";
import { testDb } from "./db/test-db.ts";
import { DEMO_OUTFITS, seedDemo } from "./demo-seed.ts";
import { WINDOW_DAYS, worthBuying } from "./gaps.ts";
import { impactTotals } from "./impact.ts";
import { exactGroups } from "./match.ts";
import { claimNudges } from "./returns.ts";

const DEMO = "+15555550100";
const today = localToday(); // recentWears counts back from the database's current_date

let db: Db;
beforeEach(async () => {
  db = await testDb();
});

const savePhoto = async (name: string) => (name === "fit-12" ? null : `https://example.test/photos/${name}`);
const seed = () => seedDemo(db, { userId: DEMO, today, savePhoto });
const count = async (table: string) =>
  (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1`, [DEMO]))[0]!.n;

test("every demo beat has something to find", async () => {
  const result = await seed();
  expect(result).toMatchObject({ outfits: 12, items: 13, missingPhotos: ["fit-12"] });

  // "what should I buy?" names tops
  const answer = worthBuying(await recentWears(db, DEMO, WINDOW_DAYS), exactGroups);
  expect(answer).toBe("You wear 5 bottoms with the same 2 tops. A gray top would go with all of them: 15 new outfits.");

  // black jeans worn often, with a photo for the vision model to compare against
  const items = await activeItems(db, DEMO);
  const jeans = items.find((i) => i.description === "black straight-leg jeans")!;
  const [wears] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM wears WHERE item_id = $1`, [jeans.id]);
  expect(wears!.n).toBe(6);
  expect(jeans.photo_url).toBe("https://example.test/photos/fit-01");

  // only "check returns" reaches the jacket: its window closes in 5 days
  expect(await claimNudges(db, { today, userId: DEMO })).toEqual([]);
  const [nudge] = await claimNudges(db, { today, userId: DEMO, anyDeadline: true });
  expect(nudge!.text).toBe(
    `You haven't worn the green cropped utility jacket from Zara in any fit checks yet. Return window closes ${formatDay(addDays(today, 5))}. Keeping it? Reply keep or return.`,
  );

  expect(items.find((i) => i.location)).toMatchObject({ description: "camel wool coat", location: "under-bed bin" });
  expect(await impactTotals(db, DEMO)).toEqual({ skipped: 1, recovered: 0 });
});

test("rerunning resets the demo user and leaves everyone else alone", async () => {
  await db.query(`INSERT INTO users (id, web_token) VALUES ('someone-else', 'token-else')`);
  await insertItem(db, { ...{ category: "top", type: "hoodie", color_primary: "red", color_secondary: null, pattern: "solid", fit: "regular", season: "all", description: "red hoodie" }, user_id: "someone-else", source: "text" });

  const first = await seed();
  // Rehearsal leftovers: a nudge answered, a reminder, an extra shopping check.
  await claimNudges(db, { today, userId: DEMO, anyDeadline: true });
  await db.query(`UPDATE purchases SET status = 'returning' WHERE user_id = $1`, [DEMO]);
  await db.query(`INSERT INTO reminders (user_id, text, due_at) VALUES ($1, 'x', now())`, [DEMO]);

  const second = await seed();
  expect(second.webToken).toBe(first.webToken); // the wardrobe link survives reruns
  expect(await count("outfits")).toBe(DEMO_OUTFITS.length);
  expect(await count("items")).toBe(13);
  expect(await count("reminders")).toBe(0);
  expect(await count("impact_events")).toBe(1);
  const [purchase] = await db.query<{ status: string; nudged_at: Date | null }>(
    `SELECT status, nudged_at FROM purchases WHERE user_id = $1`,
    [DEMO],
  );
  expect(purchase).toEqual({ status: "kept", nudged_at: null });

  expect((await activeItems(db, "someone-else")).map((i) => i.description)).toEqual(["red hoodie"]);
});
