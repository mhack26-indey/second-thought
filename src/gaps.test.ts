import { expect, test } from "bun:test";
import type { Item } from "./closet/repo.ts";
import { worthBuying } from "./gaps.ts";
import { exactGroups } from "./match.ts";

let nextId = 1;
const item = (category: string, color: string): Item =>
  ({ id: nextId++, category, type: category === "shoes" ? "sneakers" : category === "top" ? "t-shirt" : "jeans", color_primary: color }) as Item;
// Each outfit is a list of items worn together.
const wears = (outfits: Item[][]) => outfits.flatMap((items, o) => items.map((i) => ({ ...i, outfit_id: o })));

test("needs a few fit checks first", () => {
  const tee = item("top", "black");
  expect(worthBuying(wears([[tee], [tee]]), exactGroups)).toContain("only seen 2 fit checks");
});

test("names the bottleneck slot and a neutral color they don't have", () => {
  const tees = [item("top", "black"), item("top", "white")];
  const pants = [1, 2, 3, 4, 5, 6].map(() => item("bottom", "blue"));
  const shoes = item("shoes", "white");
  const outfits = pants.map((p, i) => [tees[i % 2]!, p, shoes]);
  // 6 bottoms vs 2 tops; shoes (1) are lower still, so shoes come first.
  expect(worthBuying(wears(outfits), exactGroups)).toBe(
    "You wear 6 bottoms with the same pair of shoes. A black pair of shoes would go with all of them: 12 new outfits.",
  );

  const noShoes = pants.map((p, i) => [tees[i % 2]!, p]);
  expect(worthBuying(wears(noShoes), exactGroups)).toBe(
    "You wear 6 bottoms with the same 2 tops. A gray top would go with all of them: 6 new outfits.",
  );
});

test("a balanced rotation says to buy nothing", () => {
  const tees = [item("top", "black"), item("top", "white"), item("top", "gray")];
  const pants = [item("bottom", "blue"), item("bottom", "black"), item("bottom", "beige")];
  const outfits = tees.map((t, i) => [t, pants[i]!]);
  expect(worthBuying(wears(outfits), exactGroups)).toContain("buy right now is nothing");
});
