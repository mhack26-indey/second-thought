import { expect, test } from "bun:test";
import type { Item } from "./closet/repo.ts";
import { FIT_CHECKS_SHOWN, closetSummary, fitCheckReplies, isShowCloset, isShowFitChecks } from "./show.ts";

const LINK = "https://example.test/w/tok";
let nextId = 1;
const item = (category: string, type: string, color: string): Item =>
  ({ id: nextId++, category, type, color_primary: color, description: `${color} ${type}` }) as Item;

test("routing phrases", () => {
  for (const t of ["show my fit checks", "my ootds", "My outfits.", "show me my fitchecks", "my fit checks"]) expect(isShowFitChecks(t)).toBe(true);
  for (const t of ["show my closet", "my items", "What do I own?", "show me my clothes"]) expect(isShowCloset(t)).toBe(true);
  for (const t of ["what should I wear?", "my wardrobe", "delete my last fit check", "show my closet a jacket"]) {
    expect(isShowFitChecks(t) || isShowCloset(t)).toBe(false);
  }
});

test("the closet is grouped by category, most worn first, top 5 then the rest counted", () => {
  const tops = ["navy polo", "white t-shirt", "gray crewneck", "black hoodie", "red t-shirt", "olive sweater", "beige polo"].map((n) => {
    const [color, ...type] = n.split(" ");
    return item("top", type.join(" "), color!);
  });
  const jeans = item("bottom", "jeans", "black");
  const bag = item("accessory", "bag", "unknown"); // a texted item, color never said
  const wears = [
    ...Array(3).fill({ itemId: tops[0]!.id }),
    ...Array(2).fill({ itemId: tops[1]!.id }),
    { itemId: tops[6]!.id },
    { itemId: jeans.id },
  ];
  expect(closetSummary([bag, jeans, ...tops], wears, LINK)).toBe(
    [
      "Tops (7): navy polo (3 wears), white t-shirt (2 wears), beige polo (1 wear), black hoodie (0 wears), gray crewneck (0 wears), + 2 more",
      "Bottoms (1): black jeans (1 wear)",
      "Accessories (1): bag (0 wears)",
      `See everything: ${LINK}`,
    ].join("\n"),
  );
  expect(closetSummary([], [], LINK)).toStartWith("Your closet is empty so far.");
});

test("fit checks: the latest 6, newest first, each with its date and what was worn", () => {
  const polo = item("top", "polo", "navy");
  const chinos = item("bottom", "pants", "beige");
  const day = (d: number) => Date.parse(`2026-09-${String(d).padStart(2, "0")}T12:00:00`);
  const outfits: { id: number; photoUrl: string | null; at: number }[] = [1, 3, 5, 7, 9, 11, 13, 15].map((d, i) => ({ id: i + 1, photoUrl: `${LINK}/p/${i + 1}`, at: day(d) }));
  outfits.push({ id: 99, photoUrl: null, at: day(20) }); // no photo: not shown or counted
  const wears = [
    { outfitId: 8, itemId: polo.id },
    { outfitId: 8, itemId: chinos.id },
  ];
  const replies = fitCheckReplies(outfits, wears, [polo, chinos], LINK);

  const photos = replies.filter((r) => typeof r !== "string");
  expect(photos).toHaveLength(FIT_CHECKS_SHOWN);
  expect(replies.slice(0, 4)).toEqual([{ photo: `${LINK}/p/8` }, "Sep 15: navy polo, beige pants", { photo: `${LINK}/p/7` }, "Sep 13: nothing logged from this one"]);
  expect(replies.at(-1)).toBe(`That's your latest 6 of 8. All your fit checks: ${LINK}#fits`);
});

test("someone with no fit checks gets told how to start", () => {
  expect(fitCheckReplies([], [], [], LINK)).toEqual(["No fit checks yet. Send a photo of what you're wearing and I'll start keeping track."]);
});
