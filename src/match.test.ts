import { expect, test } from "bun:test";
import type { ExtractedItem } from "./closet/extract.ts";
import type { Item } from "./closet/repo.ts";
import { type Groups, exactGroups, matchWithGroups, searchItems } from "./match.ts";

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

test("neighboring shades match, but an exact shade is preferred", () => {
  const beige = own({ color_primary: "beige" });
  const white = own({ color_primary: "white" });
  const cream = { ...tee, color_primary: "cream" };
  expect(matchWithGroups([cream], [beige], groups)).toEqual([beige.id]);
  expect(matchWithGroups([{ ...tee, color_primary: "black" }], [beige], groups)).toEqual([null]);
  expect(matchWithGroups([tee], [beige, white], groups)).toEqual([white.id]);
});

test("unknown matches anything, and second colors are ignored", () => {
  const owned = [own({ source: "text", photo_url: null, color_primary: "unknown", pattern: "unknown" }), own({})];
  expect(matchWithGroups([{ ...tee, pattern: "striped" }], owned, groups)).toEqual([owned[0]!.id]);
  expect(matchWithGroups([{ ...tee, color_secondary: "gold" }], owned.slice(1), groups)).toEqual([owned[1]!.id]);
});

test("each owned item matches once, preferring the same fit", () => {
  const loose = own({ fit: "oversized" });
  const regular = own({});
  expect(matchWithGroups([tee, tee, tee], [loose, regular], groups)).toEqual([regular.id, loose.id, null]);
});

test("search ranks by type, color group, and words, including a half-typed word", () => {
  const closet = [
    own({ category: "bottom", type: "sweatpants", color_primary: "grey", description: "grey puma sweatpants with drawstring" }),
    own({ category: "bottom", type: "sweatpants", color_primary: "navy", description: "navy drawstring sweatpants" }),
    own({ category: "bottom", type: "jeans", color_primary: "black", description: "black straight-leg jeans" }),
    own({ category: "top", type: "t-shirt", color_primary: "white", description: "plain white t-shirt" }),
  ];
  const [puma, navy, jeans, tee] = closet;
  const ids = (q: string) => searchItems(q, closet, groups).map((i) => i.id);

  expect(ids("charcoal sweats")[0]).toBe(puma!.id); // nickname type + color group (charcoal = gray)
  expect(ids("charcoal sweats")).not.toContain(tee!.id);
  expect(ids("the puma ones")).toEqual([puma!.id]);
  expect(ids("pu")).toEqual([puma!.id]); // still typing "puma"
  expect(ids("navy")[0]).toBe(navy!.id);
  expect(ids("black jeans")[0]).toBe(jeans!.id);
  expect(ids("")).toEqual([]);
});
