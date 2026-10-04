import { beforeEach, expect, test } from "bun:test";
import type { ExtractedItem, PhotoExtraction } from "./closet/extract.ts";
import { activeItems, createOutfit } from "./closet/repo.ts";
import type { Db } from "./db/client.ts";
import { testDb } from "./db/test-db.ts";
import { CLOSET_MODE_MS, CLOSET_OFFER, ClosetMode, closetSummary, isClosetModeStart } from "./closet-mode.ts";
import { exactMatcher } from "./ingest.ts";
import { type PhotoDeps, readClosetPhoto, readPhoto } from "./photo-intake.ts";
import type { RecentFitCheck } from "./shopping-mode.ts";

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
const polo = piece("top", "polo", "navy", "navy short-sleeve polo");
const tee = piece("top", "t-shirt", "white", "white crew-neck t-shirt");
const jeans = piece("bottom", "jeans", "black", "black straight-leg jeans");
const puffer = piece("outerwear", "puffer", "red", "red quilted puffer jacket");

let db: Db;
let clock: number;
beforeEach(async () => {
  db = await testDb();
  await db.query(`INSERT INTO users (id, web_token) VALUES ('u1', 'token-u1')`);
  clock = Date.parse("2026-10-04T12:00:00Z");
});

const deps = (read: PhotoExtraction): PhotoDeps => ({
  db,
  extract: async () => read,
  matcher: () => exactMatcher, // stands in for the vision comparison
  shop: async () => {
    throw new Error("not a shopping photo");
  },
});
const count = async (table: string) => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`))[0]!.n;

test("a closet dump saves its items as 'closet', with no outfit and no wears", async () => {
  const replies = await readClosetPhoto("u1", "https://example.test/photos/rail", { url: "rail" }, deps({ kind: "closet_dump", items: [polo, tee, jeans] }));
  expect(replies).toEqual(["Added 3 items: navy polo, white t-shirt, black jeans."]);

  const items = await activeItems(db, "u1");
  expect(items.map((i) => [i.description, i.source, i.photo_url])).toEqual([
    ["navy short-sleeve polo", "closet", "https://example.test/photos/rail"],
    ["white crew-neck t-shirt", "closet", "https://example.test/photos/rail"],
    ["black straight-leg jeans", "closet", "https://example.test/photos/rail"],
  ]);
  expect(await count("wears")).toBe(0);
  expect(await count("outfits")).toBe(0);
});

test("a second dump photo dedups against the first", async () => {
  await readClosetPhoto("u1", "https://example.test/photos/rail", { url: "rail" }, deps({ kind: "closet_dump", items: [polo, tee, jeans] }));
  const replies = await readClosetPhoto("u1", "https://example.test/photos/bed", { url: "bed" }, deps({ kind: "closet_dump", items: [polo, jeans, puffer] }));
  expect(replies).toEqual(["Added 1 item: red puffer. 2 you already had."]);
  expect(await activeItems(db, "u1")).toHaveLength(4);

  const again = await readClosetPhoto("u1", "https://example.test/photos/bed2", { url: "bed2" }, deps({ kind: "closet_dump", items: [polo, tee] }));
  expect(again).toEqual(["Nothing new: you already had all 2."]);
});

test("closet mode reads a photo as a closet dump even when the model says fit check", async () => {
  const replies = await readClosetPhoto("u1", "https://example.test/photos/pile", { url: "pile" }, deps({ kind: "fit_check", items: [polo, jeans] }));
  expect(replies[0]).toStartWith("Added 2 items");
  expect(await count("wears")).toBe(0);
  expect((await activeItems(db, "u1")).every((i) => i.source === "closet")).toBe(true);
});

test("a detected closet dump leaves the fit checks but keeps its photo", async () => {
  const photoUrl = "https://example.test/photos/drawer";
  const outfit = await createOutfit(db, { user_id: "u1", taken_on: "2026-10-04", photo_url: photoUrl });
  const calls: string[] = [];
  const fit: RecentFitCheck = {
    outfitId: outfit.id,
    image: { url: "drawer" },
    at: clock,
    cancelled: false,
    cleanup: async () => void calls.push("cleanup"), // would delete the photo
    notToday: async () => void calls.push("notToday"),
  };
  const replies = await readPhoto("u1", { id: outfit.id, photoUrl }, fit.image, fit, deps({ kind: "closet_dump", items: [tee, puffer] }));

  expect(replies).toEqual(["Added 2 items: white t-shirt, red puffer."]);
  expect(await count("outfits")).toBe(0);
  expect(await count("wears")).toBe(0);
  expect(calls).toEqual(["notToday"]); // not today's fit check, and the photo stays for the items
  expect(fit.notFitCheck).toBe(true);
  expect((await activeItems(db, "u1")).map((i) => i.photo_url)).toEqual([photoUrl, photoUrl]);
});

test('"add my closet" opens a 10-minute window; "done" closes it with the closet count', async () => {
  const mode = new ClosetMode({ db, now: () => clock });
  expect(isClosetModeStart("Add my closet!")).toBe(true);
  expect(isClosetModeStart("closet dump")).toBe(true);
  expect(mode.onText("u1", "done")).toBeUndefined(); // not in closet mode: not ours

  expect(mode.onText("u1", "add my closet")!.replies[0]).toStartWith("Closet mode for the next 10 minutes");
  expect(mode.active("u1")).toBe(true);
  await mode.track("u1", readClosetPhoto("u1", "https://example.test/photos/rail", { url: "rail" }, deps({ kind: "closet_dump", items: [polo, tee] })));

  const done = mode.onText("u1", "Done!")!;
  expect(done.replies).toEqual([]);
  expect(await done.later!()).toEqual([closetSummary(2)]);
  expect(closetSummary(2)).toBe(
    "Your closet has 2 items. Send a fit check whenever you get dressed and I'll start tracking what you actually wear.",
  );
  expect(mode.active("u1")).toBe(false);
});

test("the window runs out after 10 minutes and the scheduler gets the summary", async () => {
  const mode = new ClosetMode({ db, now: () => clock });
  mode.onText("u1", "closet dump");
  await mode.track("u1", readClosetPhoto("u1", "https://example.test/photos/rail", { url: "rail" }, deps({ kind: "closet_dump", items: [jeans] })));

  clock += CLOSET_MODE_MS - 1000;
  expect(await mode.expired()).toEqual([]);
  clock += 2000;
  expect(mode.active("u1")).toBe(false);
  expect(await mode.expired()).toEqual([{ userId: "u1", text: closetSummary(1) }]);
  expect(await mode.expired()).toEqual([]); // once
});

test("onboarding offers the closet; skip closes it quietly, photos make it a closet dump", async () => {
  const mode = new ClosetMode({ db, now: () => clock });
  expect(mode.offer("u1")).toBe(CLOSET_OFFER);
  expect(CLOSET_OFFER).toBe("Want to add your closet now? Send a few photos of your closet or a pile of clothes, or skip.");
  expect(mode.active("u1")).toBe(true); // so the photos they send next go to the closet

  expect(await mode.onText("u1", "skip")!.later!()).toEqual([
    "No problem. Send a fit check whenever you get dressed and I'll start tracking what you actually wear.",
  ]);
  expect(mode.active("u1")).toBe(false);

  // Outside an onboarding offer, "skip" isn't closet mode's to answer.
  mode.onText("u1", "add my closet");
  expect(mode.onText("u1", "skip")).toBeUndefined();
});
