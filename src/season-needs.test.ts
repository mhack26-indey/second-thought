import { expect, test } from "bun:test";
import type { Climate } from "./climate.ts";
import type { Item } from "./closet/repo.ts";
import { exactGroups } from "./match.ts";
import { buyAdvice } from "./profile.ts";
import { seasonAdvice, upcomingSeason } from "./season-needs.ts";

// Ann Arbor-like monthly normal highs (°C): winter (≤ 50°F) Nov–Mar, summer (≥ 72°F) Jun–Sep.
const ANN_ARBOR: Climate = {
  city: "Ann Arbor, Michigan",
  countryCode: "US",
  highsC: [0, 2, 8, 15, 22, 27, 29, 28, 24, 17, 9, 3],
  lowsC: Array(12).fill(0),
};
const MIAMI: Climate = { city: "Miami, Florida", countryCode: "US", highsC: Array(12).fill(29), lowsC: Array(12).fill(22) };
const at = (ymd: string) => new Date(`${ymd}T12:00:00`);

let nextId = 1;
const item = (category: string, type: string, color: string, description: string, extra: Partial<Item> = {}): Item =>
  ({ id: nextId++, category, type, color_primary: color, description, season: "all", fit: "regular", location: null, ...extra }) as Item;
const wornIn = (i: Item, times: number) => Array.from({ length: times }, (_, n) => ({ ...i, outfit_id: n + 1 }));

test("the coming season comes from the city's climate", () => {
  expect(upcomingSeason(ANN_ARBOR, at("2026-10-04"))).toEqual({ name: "winter", month: 10, highF: 48 }); // November, 4 weeks out
  expect(upcomingSeason(ANN_ARBOR, at("2026-05-10"))).toEqual({ name: "summer", month: 5, highF: 81 });
  expect(upcomingSeason(ANN_ARBOR, at("2026-08-10"))).toBeNull(); // summer's on; winter is months away
  expect(upcomingSeason(ANN_ARBOR, at("2026-12-10"))).toBeNull(); // already winter
  expect(upcomingSeason(ANN_ARBOR, at("2026-09-01"))).toBeNull(); // November is 8+ weeks out
  expect(upcomingSeason(MIAMI, at("2026-10-04"))).toBeNull(); // no winter at all
});

const puffer = item("outerwear", "puffer", "red", "red quilted puffer jacket", { season: "cold", location: "under-bed bin" });
const boots = item("shoes", "boots", "black", "black chelsea boots", { season: "cold" });
const sweater = item("top", "sweater", "gray", "gray quarter-zip sweater", { season: "cold" });
const hoodie = item("top", "hoodie", "black", "black hoodie", { season: "cold" });
const tee = item("top", "t-shirt", "white", "white tee");
const jeans = item("bottom", "jeans", "black", "black straight-leg jeans", { fit: "straight-leg" });
const sneakers = item("shoes", "sneakers", "black", "black leather sneakers");

test("an owned piece in storage covers what the season needs, and says where it is", () => {
  const advice = seasonAdvice(ANN_ARBOR, [puffer, sweater, hoodie, tee, jeans, sneakers], [...wornIn(sneakers, 4), ...wornIn(jeans, 4)], at("2026-10-04"))!;
  expect(advice.lines[0]).toBe("Winter's coming: November highs here average 48°F.");
  expect(advice.lines).toContain("Your red quilted puffer jacket is in the under-bed bin, so you're covered on jackets.");
  expect(advice.lines).toContain("You have 2 warm layers, like your gray quarter-zip sweater.");
  // Missing: cold-weather shoes, in the color they wear most on their feet.
  expect(advice.lines).toContain("For winter you have no cold-weather shoes. Black boots fit what you already wear.");
  expect(advice.searches).toEqual([{ category: "shoes", query: "black boots" }]); // no jacket search: they own one
  expect(advice.counts).toEqual({ outerwear: 1, top: 3, bottom: 1, shoes: 1 }); // winter or all-year pieces
});

test("at most two suggestions, from their own colors and fits", () => {
  const advice = seasonAdvice(ANN_ARBOR, [tee, jeans, sneakers], [...wornIn(jeans, 5), ...wornIn(tee, 5)], at("2026-10-20"))!;
  expect(advice.searches).toHaveLength(2);
  expect(advice.lines).toContain("For winter you have no winter jacket. A black winter coat fits what you already wear.");
});

test("covered for the season and nothing else missing: buy nothing", () => {
  const owned = [puffer, boots, sweater, hoodie, tee, jeans];
  // Two tops, two bottoms... a balanced rotation, so the outfit gap suggests nothing either.
  const wears = [1, 2, 3].flatMap((o) => [
    { ...tee, outfit_id: o },
    { ...jeans, outfit_id: o },
    { ...boots, outfit_id: o },
  ]);
  const reply = buyAdvice(wears, owned, exactGroups, { occasions: null, ageRange: null, sizeTop: null, sizeBottom: null, sizeShoe: null }, { climate: ANN_ARBOR, today: at("2026-10-04") });
  expect(reply.split("\n")).toEqual([
    "Winter's coming: November highs here average 48°F.",
    "Your red quilted puffer jacket is in the under-bed bin, so you're covered on jackets.",
    "Your black chelsea boots cover cold-weather shoes.",
    "You have 2 warm layers, like your gray quarter-zip sweater.",
    "You're set for winter. Buy nothing.",
  ]);
});

test("a season need gets the same sized secondhand link and budget line as any suggestion", () => {
  const reply = buyAdvice(
    [...wornIn(sneakers, 3), ...wornIn(jeans, 3), ...wornIn(tee, 3)],
    [puffer, sweater, hoodie, tee, jeans, sneakers],
    exactGroups,
    { occasions: null, ageRange: "18-24", sizeTop: "S", sizeBottom: "S", sizeShoe: "10" },
    { climate: ANN_ARBOR, today: at("2026-10-04") },
  );
  expect(reply).toContain("Check secondhand first");
  expect(reply).toContain("Secondhand black boots: https://www.depop.com/search/?q=black%20boots%20size%2010 · eBay:");
});

test("no season change: the reply is exactly what it was", () => {
  const wears = [...wornIn(jeans, 3), ...wornIn(tee, 3), ...wornIn(sneakers, 3)];
  const owned = [tee, jeans, sneakers];
  const p = { occasions: ["gym" as const], ageRange: "18-24" as const, sizeTop: "S", sizeBottom: "S", sizeShoe: null };
  const before = buyAdvice(wears, owned, exactGroups, p);
  expect(buyAdvice(wears, owned, exactGroups, p, { climate: ANN_ARBOR, today: at("2026-08-10") })).toBe(before);
  expect(buyAdvice(wears, owned, exactGroups, p, { climate: undefined })).toBe(before); // no city, no climate
});
