import { beforeEach, expect, test } from "bun:test";
import type { Climate } from "./climate.ts";
import type { ExtractedItem } from "./closet/extract.ts";
import { addWear, createOutfit, insertItem } from "./closet/repo.ts";
import type { Db } from "./db/client.ts";
import { testDb } from "./db/test-db.ts";
import { findGhosts, ghostQuestion, markAsked, parseCheckinAnswer, pendingCheckin, setCheckin } from "./ghosts.ts";
import { bandOf, describeMonths, seasonMonths } from "./seasons.ts";

// Monthly average highs in °F (2016–2025, Open-Meteo archive), as °C.
const fToC = (f: number) => ((f - 32) * 5) / 9;
const climate = (city: string, highsF: number[]): Climate => ({ city, countryCode: "US", highsC: highsF.map(fToC), lowsC: highsF.map(fToC) });
const annArbor = climate("Ann Arbor, Michigan", [33, 37, 47, 56, 68, 79, 82, 80, 74, 62, 47, 37]);
const miami = climate("Miami, Florida", [75, 77, 79, 82, 84, 85, 87, 88, 86, 83, 80, 77]);
const la = climate("Los Angeles, California", [66, 68, 69, 75, 76, 83, 88, 90, 87, 83, 75, 67]);

test("seasons come from the city's climate", () => {
  const puffer = bandOf("puffer", "cold");
  expect(describeMonths(seasonMonths(puffer, annArbor))).toBe("Nov–Mar");
  expect(seasonMonths(puffer, miami)).toEqual([]); // never puffer weather
  expect(describeMonths(seasonMonths(bandOf("hoodie", "cold"), annArbor))).toBe("Oct–Apr");
  expect(describeMonths(seasonMonths(bandOf("shorts", "warm"), la))).toBe("Apr–Nov");
  expect(describeMonths(seasonMonths(bandOf("jeans", "all"), miami))).toBe("all year");
});

const hoodie: ExtractedItem = {
  category: "top",
  type: "hoodie",
  color_primary: "gray",
  color_secondary: null,
  pattern: "solid",
  fit: "relaxed",
  season: "cold",
  description: "gray zip hoodie",
};

let db: Db;
beforeEach(async () => {
  db = await testDb();
  await db.query(`INSERT INTO users (id, web_token, step, city) VALUES ('u1', 't1', 'done', 'Ann Arbor, Michigan')`);
});

async function own(item: ExtractedItem, created: string) {
  const it = await insertItem(db, { ...item, user_id: "u1", source: "fit_check" });
  await db.query(`UPDATE items SET created_at = $2 WHERE id = $1`, [it.id, created]);
  return it;
}
async function fitChecks(days: string[], wearing: number[] = []) {
  for (const day of days) {
    const o = await createOutfit(db, { user_id: "u1", taken_on: day, photo_url: `p/${day}` });
    for (const id of wearing) await addWear(db, id, o.id);
  }
}
const everyThirdDay = (from: string, n: number) =>
  Array.from({ length: n }, (_, i) => new Date(Date.parse(from) + i * 3 * 86_400_000).toISOString().slice(0, 10));

test("asks after three weeks of its season unworn, while they kept sending fit checks", async () => {
  const h = await own(hoodie, "2026-09-01");
  await fitChecks(["2026-10-01"], [h.id]); // last worn Oct 1
  await fitChecks(everyThirdDay("2026-10-02", 9)); // 9 fit checks without it, through Oct 26

  expect(await findGhosts(db, "u1", annArbor, new Date(2026, 9, 15))).toEqual([]); // two weeks: too soon
  const [g] = await findGhosts(db, "u1", annArbor, new Date(2026, 9, 26));
  expect(g).toMatchObject({ description: "gray zip hoodie", inSeasonDays: 25, fitChecks: 9 });
  expect(ghostQuestion(g!, "Ann Arbor, Michigan")).toStartWith(
    "Your gray zip hoodie hasn't come out in 4 weeks of cold weather (Oct–Apr in Ann Arbor), across 9 fit checks. What's up with it?\n1. Still love it",
  );
  expect(ghostQuestion(g!, "Ann Arbor, Michigan")).toContain("5. Sold, donated or returned it\n6. It broke, or I threw it away\nReply with a number.");

  // Out of season (July in Ann Arbor), or no fit checks: no question.
  expect(await findGhosts(db, "u1", annArbor, new Date(2027, 6, 10))).toEqual([]);
});

test("no fit checks means no nagging; jewelry is skipped; answers stick", async () => {
  const h = await own(hoodie, "2026-09-01");
  await own({ ...hoodie, category: "jewelry", type: "ring", season: "all", description: "silver ring" }, "2026-09-01");
  expect(await findGhosts(db, "u1", annArbor, new Date(2026, 9, 26))).toEqual([]); // they sent nothing

  await fitChecks(everyThirdDay("2026-10-02", 9));
  const ghosts = await findGhosts(db, "u1", annArbor, new Date(2026, 9, 26));
  expect(ghosts.map((g) => g.description)).toEqual(["gray zip hoodie"]); // not the ring

  await markAsked(db, "u1", h.id, new Date(2026, 9, 26));
  expect((await pendingCheckin(db, "u1"))?.awaiting).toBe("answer");
  await setCheckin(db, h.id, { awaiting: null, occasionOnly: true });
  expect(await pendingCheckin(db, "u1")).toBeUndefined();
  expect(await findGhosts(db, "u1", annArbor, new Date(2026, 9, 26))).toEqual([]); // occasion-only: never asked
});

test("answers by number or in words", () => {
  expect(parseCheckinAnswer("1")).toBe(1);
  expect(parseCheckinAnswer("#4")).toBe(4);
  expect(parseCheckinAnswer("still love it")).toBe(1);
  expect(parseCheckinAnswer("only for weddings")).toBe(2);
  expect(parseCheckinAnswer("it's at my mom's")).toBe(3);
  expect(parseCheckinAnswer("doesn't fit anymore")).toBe(4);
  expect(parseCheckinAnswer("donated it")).toBe(5);
  expect(parseCheckinAnswer("tossed it")).toBe(6);
  expect(parseCheckinAnswer("it ripped")).toBe(6);
  expect(parseCheckinAnswer("worn out, lots of holes")).toBe(6);
  expect(parseCheckinAnswer("what's the weather")).toBeUndefined();
});
