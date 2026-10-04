import { expect, test } from "bun:test";
import { ITEM_TYPES } from "./closet/categories.ts";
import { aNew, describeKg, footprintOf, skipLine } from "./footprint.ts";

test("every closet type has an entry, and unknowns are null rather than guessed", () => {
  for (const type of ITEM_TYPES) expect(footprintOf(type) === null || footprintOf(type)! > 0).toBe(true);
  expect(footprintOf("jeans")).toBe(16.34);
  expect(footprintOf("watch")).toBeNull();
  expect(footprintOf("not a type")).toBeNull();
});

test("replies read naturally and say they're estimates", () => {
  expect(aNew("jeans")).toBe("a new pair of jeans");
  expect(aNew("hoodie")).toBe("a new hoodie");
  expect(describeKg(16.34)).toBe("≈ 16 kg CO₂e (about 41 miles of driving)");
  expect(skipLine("watch")).toBe(`Skip it? Reply "skip" and I'll count it, or "buying it" if you're getting it anyway.`);
  expect(skipLine("jeans")).toBe(
    `Skip it? Making a new pair of jeans emits ≈ 16 kg CO₂e (about 41 miles of driving), estimated from Carbonfact's average for the category. Reply "skip" and I'll count it, or "buying it" if you're getting it anyway.`,
  );
});
