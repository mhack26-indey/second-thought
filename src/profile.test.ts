import { beforeEach, expect, test } from "bun:test";
import type { Climate } from "./climate.ts";
import type { ExtractedItem } from "./closet/extract.ts";
import { type Item, insertItem } from "./closet/repo.ts";
import type { Db } from "./db/client.ts";
import { testDb } from "./db/test-db.ts";
import { declutterPicks } from "./declutter.ts";
import { worthBuyingResult } from "./gaps.ts";
import { exactGroups } from "./match.ts";
import {
  type ProfileAnswer,
  budgetLine,
  buyAdvice,
  deleteUserRows,
  getProfile,
  nextProfileStep,
  occasionNotes,
  parseProfile,
  quickProfileEdit,
  reaskQuestion,
  saveProfile,
  sizedQuery,
} from "./profile.ts";
import { shoppingReplies } from "./shopping-mode.ts";

let db: Db;
beforeEach(async () => {
  db = await testDb();
  await db.query(`INSERT INTO users (id, web_token) VALUES ('u1', 'tok')`);
});

/** A stubbed text model answer: every field not mentioned unless given. */
const answer = (fields: Partial<ProfileAnswer>): ProfileAnswer => ({
  name: { status: "not_mentioned", value: null },
  age_range: { status: "not_mentioned", value: null },
  occasions: { status: "not_mentioned", value: [] },
  size_top: { status: "not_mentioned", value: null },
  size_bottom: { status: "not_mentioned", value: null },
  size_shoe: { status: "not_mentioned", value: null },
  ...fields,
});
const reads = (a: ProfileAnswer) => async () => a;
const noModel = async (): Promise<never> => {
  throw new Error("the model shouldn't be called");
};

test("a partial answer saves what's there and asks about nothing it skipped", async () => {
  const parsed = await parseProfile(
    "inesh, class and gym mostly, skip the rest",
    reads(
      answer({
        name: { status: "given", value: "inesh" },
        occasions: { status: "given", value: ["class", "gym", "gym"] },
        age_range: { status: "skipped", value: null },
        size_shoe: { status: "skipped", value: null },
      }),
    ),
  );
  expect(parsed).toEqual({ patch: { name: "Inesh", occasions: ["class", "gym"] }, unclear: [], under18: false });
});

test('"skip" skips everything without a model call', async () => {
  for (const skip of ["skip", "Skip.", "no thanks", "pass"]) {
    expect(await parseProfile(skip, noModel)).toEqual({ patch: {}, unclear: [], under18: false });
  }
});

test("unclear fields get one more ask, and only one", async () => {
  const parsed = await parseProfile(
    "big shoes lol, M top",
    reads(answer({ size_shoe: { status: "unclear", value: null }, size_top: { status: "given", value: "m" }, size_bottom: { status: "given", value: "huge" } })),
  );
  expect(parsed.patch).toEqual({ sizeTop: "M" });
  expect(parsed.unclear).toEqual(["size_bottom", "size_shoe"]); // "huge" isn't a size either
  expect(reaskQuestion(parsed.unclear)).toBe("I didn't quite catch your bottom size and shoe size. Want to try again? (or skip)");

  expect(nextProfileStep("profile", parsed.unclear)).toBe("profile_again");
  expect(nextProfileStep("profile_again", parsed.unclear)).toBe("done"); // never a third ask
  expect(nextProfileStep("profile", [])).toBe("done");
});

test("under 18 is never stored, and clears an age range that was there", async () => {
  await saveProfile(db, "u1", { ageRange: "18-24" });
  const parsed = await parseProfile("I'm 16", reads(answer({ age_range: { status: "given", value: "under 18" } })));
  expect(parsed).toEqual({ patch: { ageRange: null }, unclear: [], under18: true }); // not unclear: no re-ask
  await saveProfile(db, "u1", parsed.patch);
  expect((await getProfile(db, "u1"))!.ageRange).toBeNull();

  expect(quickProfileEdit("I'm 16")).toEqual({ patch: { ageRange: null }, under18: true });
  expect(quickProfileEdit("I'm 22")).toEqual({ patch: { ageRange: "18-24" }, under18: false });
  await expect(db.query(`UPDATE users SET age_range = 'under 18' WHERE id = 'u1'`)).rejects.toThrow(); // the table won't take it
});

test("sizes said plainly need no model", () => {
  expect(quickProfileEdit("my shoe size is 10")).toEqual({ patch: { sizeShoe: "10" }, under18: false });
  expect(quickProfileEdit("my top size is m")).toEqual({ patch: { sizeTop: "M" }, under18: false });
  expect(quickProfileEdit("I wear a size 32 in jeans")).toEqual({ patch: { sizeBottom: "32" }, under18: false });
  expect(quickProfileEdit("my size is big")).toBeUndefined();
});

test("occasions add up; the page replaces them", async () => {
  await saveProfile(db, "u1", { occasions: ["class"] });
  await saveProfile(db, "u1", { occasions: ["office", "class"] });
  expect((await getProfile(db, "u1"))!.occasions!.sort()).toEqual(["class", "office"]);
  await saveProfile(db, "u1", { occasions: ["gym"] }, { replaceOccasions: true });
  expect((await getProfile(db, "u1"))!.occasions).toEqual(["gym"]);
});

const piece = (type: ExtractedItem["type"], category: ExtractedItem["category"], description: string, extra: Partial<Item> = {}): Item =>
  ({ id: Math.floor(Math.random() * 1e9), type, category, description, color_primary: "black", location: null, ...extra }) as Item;

test("the week drives suggestions, after checking what they own", () => {
  const tee = piece("t-shirt", "top", "white tee");
  const jeans = piece("jeans", "bottom", "black jeans");
  const lifestyle = piece("sneakers", "shoes", "white leather sneakers");
  const worn = [tee, jeans, lifestyle];

  expect(occasionNotes(null, worn, worn)).toEqual([]); // no occasions: nothing changes

  const [gym] = occasionNotes(["gym"], worn, worn);
  expect(gym).toBe("You go to the gym, but I don't see athletic shoes in your closet. A pair of training shoes is the one thing to get for that.");

  // They own running shoes, in storage: say where, don't suggest buying.
  const runners = piece("sneakers", "shoes", "gray running shoes", { location: "hall closet" });
  expect(occasionNotes(["gym"], [...worn, runners], worn)).toEqual(["For the gym you already have your gray running shoes (it's in the hall closet)."]);

  const [office] = occasionNotes(["office"], worn, worn);
  expect(office).toStartWith("You said your week has the office, but only 0 of the 3 pieces you wear are office wear. One office");

  const blazer = piece("blazer", "outerwear", "navy blazer");
  const loafers = piece("loafers", "shoes", "brown loafers", { location: "under-bed bin" });
  expect(occasionNotes(["office"], [...worn, blazer, loafers], worn)).toEqual([
    "For the office, you own 2 pieces you haven't worn lately: navy blazer, brown loafers (it's in the under-bed bin). Try those before buying.",
  ]);
});

test("the age range frames the budget but never changes what's suggested", () => {
  const wear = (id: number, outfit: number, category: string, color: string) =>
    ({ id, outfit_id: outfit, category, type: category === "top" ? "t-shirt" : "jeans", color_primary: color }) as Item & { outfit_id: number };
  const wears = [1, 2, 3, 4].flatMap((o) => [wear(1, o, "top", "black"), wear(10 + o, o, "bottom", "blue"), wear(20 + (o % 2), o, "shoes", "white")]);
  const suggestion = worthBuyingResult(wears, exactGroups);
  expect(suggestion.buy).toBe(true);
  expect(suggestion.text).toContain("A white top would go with all of them"); // from their wears alone

  // The suggestion has no age input at all; only the framing line differs.
  expect(budgetLine("18-24")).toStartWith("Check secondhand first");
  expect(budgetLine("35+")).not.toBe(budgetLine("18-24"));
  expect(budgetLine(null)).toBeNull();
  for (const line of [budgetLine("18-24"), budgetLine("25-34"), budgetLine("35+")]) expect(line).not.toMatch(/\b(top|bottom|shoes|jeans|tee)\b/);
});

test("links carry their size", async () => {
  const sizes = { sizeTop: "M", sizeBottom: "32", sizeShoe: "10" };
  expect(sizedQuery("navy polo", "top", sizes)).toBe("navy polo size M");
  expect(sizedQuery("black jeans", "bottom", sizes)).toBe("black jeans size 32");
  expect(sizedQuery("white sneakers", "shoes", sizes)).toBe("white sneakers size 10");
  expect(sizedQuery("black bag", "accessory", sizes)).toBe("black bag"); // no size for bags
  expect(sizedQuery("navy polo", "top", null)).toBe("navy polo"); // none given: as before

  const seen = [{ description: "navy polo", category: "top" } as ExtractedItem];
  expect(shoppingReplies({ seen, matches: [], verdict: "none" }, new Date(), sizes)[0]).toContain("depop.com/search/?q=navy%20polo%20size%20M");

  // Resale links too.
  const item = await insertItem(db, { ...seen[0]!, type: "polo", color_primary: "navy", color_secondary: null, pattern: "solid", fit: "regular", season: "all", user_id: "u1", source: "text" });
  await db.query(`UPDATE items SET created_at = '2026-01-01' WHERE id = $1`, [item.id]);
  const climate: Climate = { city: "x", countryCode: null, highsC: Array(12).fill(20), lowsC: Array(12).fill(10) };
  const [pick] = await declutterPicks(db, "u1", climate, new Date("2026-06-01T12:00:00Z"), sizes);
  expect(pick!.exit.links.map((l) => l.url)).toEqual([
    "https://www.depop.com/search/?q=navy%20polo%20size%20M",
    "https://www.ebay.com/sch/i.html?_nkw=navy%20polo%20size%20M",
  ]);
});

test('"what should I buy?" links a secondhand search in their size', () => {
  const wear = (id: number, outfit: number, category: string, color: string) =>
    ({ id, outfit_id: outfit, category, type: category === "top" ? "t-shirt" : "jeans", color_primary: color, description: category }) as Item & { outfit_id: number };
  // Same black tee with four different pairs of pants: a top is what's missing.
  const wears = [1, 2, 3, 4].flatMap((o) => [wear(1, o, "top", "black"), wear(10 + o, o, "bottom", "blue")]);
  const sizes = { sizeTop: "S", sizeBottom: "S", sizeShoe: null };
  const reply = buyAdvice(wears, [], exactGroups, { occasions: null, ageRange: "18-24", ...sizes });
  expect(reply).toContain("A white top would go with all of them");
  expect(reply).toContain("Check secondhand first");
  expect(reply).toContain("Secondhand white top: https://www.depop.com/search/?q=white%20top%20size%20S · eBay: https://www.ebay.com/sch/i.html?_nkw=white%20top%20size%20S");

  // Gym with no athletic shoes: a search for those too, with no size when they gave no shoe size.
  const withGym = buyAdvice(wears, [], exactGroups, { occasions: ["gym"], ageRange: null, ...sizes });
  expect(withGym).toContain("Secondhand training shoes: https://www.depop.com/search/?q=training%20shoes ·");
  // A pair of Nikes counts as athletic: never suggest buying what they may own.
  const nikes = { id: 99, category: "shoes", type: "sneakers", description: "black nike sneakers with white sole" } as Item;
  expect(occasionNotes(["gym"], [nikes], [nikes])).toEqual([]);
});

test("delete my data takes the profile with it", async () => {
  await saveProfile(db, "u1", { name: "Inesh", ageRange: "18-24", occasions: ["gym"], sizeTop: "M", sizeBottom: "32", sizeShoe: "10" });
  await db.query(`INSERT INTO users (id, web_token) VALUES ('u2', 'tok2')`);
  await saveProfile(db, "u2", { sizeShoe: "9" });

  await deleteUserRows(db, "u1");
  expect(await getProfile(db, "u1")).toBeUndefined();
  expect((await getProfile(db, "u2"))!.sizeShoe).toBe("9"); // only theirs
});
