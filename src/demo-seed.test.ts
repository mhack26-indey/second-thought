import { beforeEach, expect, test } from "bun:test";
import { addDays, formatDay, today as localToday } from "./closet/dates.ts";
import type { ExtractedItem, PhotoExtraction } from "./closet/extract.ts";
import { activeItems, insertItem } from "./closet/repo.ts";
import type { ImageInput } from "./closet/vlm.ts";
import type { Db } from "./db/client.ts";
import { testDb } from "./db/test-db.ts";
import { DEMO_PROFILE, type DemoOptions, demoReplies, photoDate, scheduleDemoPhotos, seedDemo } from "./demo-seed.ts";
import type { Climate } from "./climate.ts";
import { getProfile } from "./profile.ts";
import { impactTotals } from "./impact.ts";
import { exactMatcher } from "./ingest.ts";
import { claimNudges } from "./returns.ts";

const DEMO = "+15555550100";
const today = localToday();

const piece = (category: ExtractedItem["category"], type: ExtractedItem["type"], color: string, description: string): ExtractedItem => ({
  category,
  type,
  color_primary: color,
  color_secondary: null,
  pattern: "solid",
  fit: "regular",
  season: "all",
  description,
});
const puffer = piece("outerwear", "puffer", "red", "red quilted puffer jacket");
const grayTee = piece("top", "t-shirt", "gray", "light gray t-shirt");
const polo = piece("top", "polo", "navy", "navy short-sleeve polo");
const joggers = piece("bottom", "sweatpants", "black", "black cargo joggers");
const chinos = piece("bottom", "pants", "beige", "khaki chinos");

// What the stubbed vision model sees in each photo.
const PHOTOS: Record<string, PhotoExtraction> = {
  "PXL_20250117_1.jpg": { kind: "fit_check", items: [puffer, grayTee] },
  "IMG-20260801-WA1.jpg": { kind: "fit_check", items: [polo, joggers] },
  "Screenshot_1.png": { kind: "fit_check", items: [puffer] },
  "PXL_20260727_a.jpg": { kind: "fit_check", items: [polo, chinos] },
  "PXL_20260727_b.jpg": { kind: "fit_check", items: [polo, chinos] },
  "P1.jpg": { kind: "product", items: [polo] }, // the model calls it a product shot
};

let db: Db;
beforeEach(async () => {
  db = await testDb();
});

const options = (): DemoOptions => ({
  userId: DEMO,
  today,
  files: Object.keys(PHOTOS),
  savePhoto: async (file) => ({ url: `https://example.test/photos/${file}`, image: { url: `demo:${file}` } }),
  extract: async (image: ImageInput) => PHOTOS[(image as { url: string }).url.slice("demo:".length)]!,
  matcher: () => exactMatcher, // stands in for the vision comparison
});

test("photos are read and deduped like live fit checks", async () => {
  const result = await seedDemo(db, options());

  expect(result.closet.map((r) => [r.description, r.wears])).toEqual([
    ["navy short-sleeve polo", 4],
    ["red quilted puffer jacket", 2],
    ["khaki chinos", 2],
    ["light gray t-shirt", 1],
    ["black cargo joggers", 1],
    ["green cropped utility jacket", 0],
  ]);
  expect(result.closet[1]!.photos).toEqual(["PXL_20250117_1.jpg", "Screenshot_1.png"]);
  expect(result.misread).toEqual([{ file: "P1.jpg", kind: "product" }]); // still ingested as a fit check

  // Items date from the first photo they're in.
  const items = await activeItems(db, DEMO);
  const first = scheduleDemoPhotos(Object.keys(PHOTOS), today)[0]!;
  expect(first.file).toBe("PXL_20250117_1.jpg");
  expect(localToday(items.find((i) => i.description === puffer.description)!.created_at)).toBe(first.takenOn);

  // The storage location and the earlier skipped purchase sit on real items.
  expect(result.stored).toBe("red quilted puffer jacket");
  expect(items.find((i) => i.location)).toMatchObject({ description: "red quilted puffer jacket", location: "under-bed bin" });
  expect(result.skipped).toBe("navy short-sleeve polo");
  expect(await impactTotals(db, DEMO)).toMatchObject({ skipped: 1, recovered: 0, co2Kg: 11.98 }); // a polo (footprint.ts)

  // Only "check returns" reaches the jacket: its window closes in 5 days.
  expect(await claimNudges(db, { today, userId: DEMO })).toEqual([]);
  const [nudge] = await claimNudges(db, { today, userId: DEMO, anyDeadline: true });
  expect(nudge!.text).toBe(
    `You haven't worn the green cropped utility jacket from Zara in any fit checks yet. Return window closes ${formatDay(addDays(today, 5))}. Keeping it? Reply keep or return.`,
  );
});

test("the demo user is Inesh, and both recommendations make sense for the seeded closet", async () => {
  await seedDemo(db, options());
  expect(await getProfile(db, DEMO)).toEqual({
    name: "Inesh",
    ageRange: "18-24",
    occasions: ["class", "gym", "going out"],
    sizeTop: "S",
    sizeBottom: "S",
    sizeShoe: null,
  });
  expect(DEMO_PROFILE.sizeShoe).toBeNull();

  // An Ann Arbor-like climate (jackets in season from October).
  const climate: Climate = { city: "Ann Arbor, Michigan", countryCode: "US", highsC: [0, 2, 8, 15, 22, 27, 29, 28, 24, 17, 9, 3], lowsC: Array(12).fill(0) };
  const { buy, declutter } = await demoReplies(db, DEMO, { climate });

  // No shoes in the stubbed photos and the gym in their week: training shoes, secondhand first,
  // with no size in the link (no shoe size given). Framed for 18–24, never changing what's suggested.
  expect(buy).toContain("You go to the gym, but I don't see athletic shoes in your closet.");
  expect(buy).toContain("Check secondhand first");
  expect(buy).toContain("Secondhand training shoes: https://www.depop.com/search/?q=training%20shoes ·");
  // Every closet piece was worn in the last three weeks; the never-worn Zara order is the one to send back.
  expect(declutter).toEqual([
    [
      "Here's what you could let go:",
      `1. green cropped utility jacket: Never worn since you added it in ${new Date(addDays(today, -25) + "T12:00:00").toLocaleDateString("en-US", { month: "long" })}. Return it by ${formatDay(addDays(today, 5))} (Zara) and get your money back. Zara returns: https://www.zara.com/us/en/help-center/HowToReturn`,
      "Reply 'returned 1' once it's sent back.",
    ].join("\n"),
  ]);
});

test("rerunning resets the demo user and leaves everyone else alone", async () => {
  await db.query(`INSERT INTO users (id, web_token) VALUES ('someone-else', 'token-else')`);
  await insertItem(db, { ...grayTee, user_id: "someone-else", source: "text" });

  const first = await seedDemo(db, options());
  await claimNudges(db, { today, userId: DEMO, anyDeadline: true });
  await db.query(`UPDATE purchases SET status = 'returning' WHERE user_id = $1`, [DEMO]);
  await db.query(`INSERT INTO reminders (user_id, text, due_at) VALUES ($1, 'x', now())`, [DEMO]);

  const second = await seedDemo(db, options());
  expect(second.webToken).toBe(first.webToken); // the wardrobe link survives reruns
  expect(second.closet).toEqual(first.closet);
  const count = async (table: string) =>
    (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1`, [DEMO]))[0]!.n;
  expect(await count("outfits")).toBe(6);
  expect(await count("reminders")).toBe(0);
  expect(await count("impact_events")).toBe(1);
  const [purchase] = await db.query<{ status: string; nudged_at: Date | null }>(`SELECT status, nudged_at FROM purchases WHERE user_id = $1`, [DEMO]);
  expect(purchase).toEqual({ status: "kept", nudged_at: null });
  expect((await activeItems(db, "someone-else")).map((i) => i.description)).toEqual(["light gray t-shirt"]);
});

test("photo dates come from Pixel and WhatsApp names, not screenshots", () => {
  expect(photoDate("PXL_20260727_222520790.RAW-01.jpg")).toBe("2026-07-27");
  expect(photoDate("IMG-20251214-WA00122.jpg")).toBe("2025-12-14");
  expect(photoDate("Screenshot_20261003-183523.png")).toBeNull();
  expect(photoDate("P7143138.jpg")).toBeNull();
});

test("dates are remapped into the last 21 days, in order, with undated photos spread out", () => {
  const schedule = scheduleDemoPhotos(
    ["IMG-20260801-WA1.jpg", "u2.jpg", "PXL_20250117_1.jpg", "PXL_20260727_b.jpg", "u1.jpg", "PXL_20260727_a.jpg"],
    "2026-10-03",
  );
  expect(schedule.map((p) => [p.takenOn, p.file])).toEqual([
    ["2026-09-12", "PXL_20250117_1.jpg"],
    ["2026-09-17", "u1.jpg"],
    ["2026-09-22", "PXL_20260727_a.jpg"], // same day as its pair
    ["2026-09-22", "PXL_20260727_b.jpg"],
    ["2026-09-27", "u2.jpg"],
    ["2026-10-02", "IMG-20260801-WA1.jpg"],
  ]);
});
