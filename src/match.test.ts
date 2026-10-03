import { expect, test } from "bun:test";
import type { ExtractedItem } from "./closet/extract.ts";
import type { Item } from "./closet/repo.ts";
import { type Groups, exactGroups, matchWithGroups } from "./match.ts";

// What the model would answer for these names.
const GROUPS: Record<string, string> = { charcoal: "gray", grey: "gray", plain: "solid", logo: "graphic" };
const groups: Groups = {
  color: (c) => (c === null ? null : GROUPS[c] ?? c),
  pattern: (p) => GROUPS[p] ?? p,
};

const tee: ExtractedItem = {
  category: "top",
  type: "t-shirt",
  color_primary: "white",
  color_secondary: null,
  pattern: "solid",
  fit: "regular",
  season: "warm",
  description: "plain white t-shirt",
};
let nextId = 1;
const own = (item: Partial<Item>): Item =>
  ({ ...tee, id: nextId++, user_id: "u", photo_url: "x", source: "fit_check", purchase_id: null, location: null, status: "active", created_at: new Date(), ...item }) as Item;

test("different names for the same color and pattern match", () => {
  const owned = [own({ color_primary: "grey", pattern: "plain" })];
  const seen = [{ ...tee, color_primary: "charcoal" }];
  expect(matchWithGroups(seen, owned, groups)).toEqual([owned[0]!.id]);
  expect(matchWithGroups(seen, owned, exactGroups)).toEqual([null]);
});

test("a different pattern group is a different item", () => {
  const owned = [own({})];
  expect(matchWithGroups([{ ...tee, pattern: "logo" }], owned, groups)).toEqual([null]);
});

test("unknown matches anything, and a texted item's missing second color is ignored", () => {
  const owned = [own({ source: "text", photo_url: null, color_primary: "unknown", pattern: "unknown" })];
  expect(matchWithGroups([{ ...tee, color_secondary: "black", pattern: "striped" }], owned, groups)).toEqual([
    owned[0]!.id,
  ]);
});

test("each owned item matches once, preferring the same fit", () => {
  const loose = own({ fit: "oversized" });
  const regular = own({});
  expect(matchWithGroups([tee, tee, tee], [loose, regular], groups)).toEqual([regular.id, loose.id, null]);
});
