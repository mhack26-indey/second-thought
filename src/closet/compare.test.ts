import { expect, test } from "bun:test";
import { testDb } from "../db/test-db.ts";
import { type AskVision, candidatesFor, compareToCloset, pickSameItems } from "./compare.ts";
import type { ExtractedItem } from "./extract.ts";
import { insertItem, type Item } from "./repo.ts";
import type { ImageInput } from "./vlm.ts";
import { matchShoppingPhoto } from "./shopping.ts";

// Offline: the vision model is faked, so these check our handling of its answers.

const image = { url: "https://example.test/fit.jpg" };

const jeans: ExtractedItem = {
  category: "bottom",
  type: "jeans",
  color_primary: "black",
  color_secondary: null,
  pattern: "solid",
  fit: "straight-leg",
  season: "all",
  description: "black straight-leg denim jeans",
};
const top: ExtractedItem = {
  ...jeans,
  category: "top",
  type: "blouse",
  fit: "regular",
  description: "black short-sleeve top with leather shoulder panels",
};

let nextId = 1;
function owned(item: ExtractedItem, overrides: Partial<Item> = {}): Item {
  return {
    ...item,
    id: nextId++,
    user_id: "u1",
    photo_url: "https://example.test/photos/1",
    source: "fit_check",
    purchase_id: null,
    location: null,
    status: "active",
    created_at: new Date("2026-09-01"),
    ...overrides,
  } as Item;
}

/** A fake vision model that returns a fixed answer and records the prompt. */
function fake(answer: Awaited<ReturnType<AskVision>>) {
  const calls: string[] = [];
  const images: ImageInput[][] = [];
  const ask: AskVision = async (opts) => {
    calls.push(opts.prompt);
    images.push(opts.images);
    return answer;
  };
  return { ask, calls, images };
}

/** Earlier photos never load offline; candidates are judged from text. */
const noPhotos = async (): Promise<never> => {
  throw new Error("offline");
};

test("no candidates in the photo's categories means no model call", async () => {
  const { ask, calls } = fake({ items: [] });
  const result = await compareToCloset(image, [jeans], [owned(top)], ask, noPhotos);
  expect(result).toEqual([[]]);
  expect(calls.length).toBe(0);
});

test("the prompt only offers same-category items to each photo item", async () => {
  const myJeans = owned(jeans);
  const myTop = owned({ ...top, type: "t-shirt" });
  const { ask, calls } = fake({ items: [] });
  await compareToCloset(image, [jeans, top], [myJeans, myTop], ask, noPhotos);
  expect(calls[0]).toContain(`0. black straight-leg denim jeans (jeans, black, solid, straight-leg) — compare with closet items: ${myJeans.id}\n`);
  expect(calls[0]).toContain(`compare with closet items: ${myTop.id}\n`);
});

test("answers are filtered to allowed ids and sorted near_identical first", async () => {
  const a = owned(jeans);
  const b = owned({ ...jeans, description: "black skinny jeans" });
  const otherCategory = owned(top);
  const { ask } = fake({
    items: [
      {
        seen: 0,
        matches: [
          { item_id: b.id, similarity: "similar", reason: "also black jeans" },
          { item_id: a.id, similarity: "near_identical", reason: "same jeans" },
          { item_id: otherCategory.id, similarity: "near_identical", reason: "wrong category" },
          { item_id: 9999, similarity: "near_identical", reason: "made up" },
          { item_id: a.id, similarity: "similar", reason: "repeated" },
        ],
      },
      { seen: 7, matches: [{ item_id: a.id, similarity: "near_identical", reason: "no such photo item" }] },
    ],
  });
  const [matches] = await compareToCloset(image, [jeans], [a, b, otherCategory], ask, noPhotos);
  expect(matches!.map((m) => [m.item.id, m.similarity])).toEqual([
    [a.id, "near_identical"],
    [b.id, "similar"],
  ]);
});

test("pickSameItems only takes near_identical, each owned item once", async () => {
  const a = owned(jeans);
  const b = owned(jeans);
  const { ask } = fake({
    items: [
      { seen: 0, matches: [{ item_id: a.id, similarity: "near_identical", reason: "" }] },
      {
        seen: 1,
        matches: [
          { item_id: a.id, similarity: "near_identical", reason: "" },
          { item_id: b.id, similarity: "near_identical", reason: "" },
        ],
      },
      { seen: 2, matches: [{ item_id: b.id, similarity: "similar", reason: "" }] },
    ],
  });
  const comparison = await compareToCloset(image, [jeans, jeans, jeans], [a, b], ask, noPhotos);
  expect(pickSameItems(comparison)).toEqual([a.id, b.id, null]);
});

test("big categories send the 20 closest candidates", () => {
  const closet = [
    ...Array.from({ length: 30 }, () => owned({ ...jeans, type: "pants", color_primary: "khaki" })),
    ...Array.from({ length: 15 }, () => owned({ ...jeans, color_primary: "blue" })),
    owned(jeans),
  ];
  const picked = candidatesFor(jeans, closet);
  expect(picked.length).toBe(20);
  expect(picked[0]!.color_primary).toBe("black");
  expect(picked.slice(1, 16).every((c) => c.type === "jeans")).toBe(true);
});

test("matchShoppingPhoto returns the top 3 closet items with photos and a verdict", async () => {
  const db = await testDb();
  const save = (item: ExtractedItem, photo: string) =>
    insertItem(db, { ...item, user_id: "u1", source: "fit_check", photo_url: photo });
  const exact = await save(jeans, "https://x/1.jpg");
  const close1 = await save({ ...jeans, description: "black skinny jeans" }, "https://x/2.jpg");
  const close2 = await save({ ...jeans, description: "charcoal jeans" }, "https://x/3.jpg");
  const close3 = await save({ ...jeans, description: "black cords" }, "https://x/4.jpg");
  await insertItem(db, { ...jeans, user_id: "u2", source: "fit_check" }); // someone else's

  const { ask } = fake({
    items: [
      {
        seen: 0,
        matches: [
          { item_id: close1.id, similarity: "similar", reason: "skinnier" },
          { item_id: close2.id, similarity: "similar", reason: "lighter" },
          { item_id: exact.id, similarity: "near_identical", reason: "same jeans" },
          { item_id: close3.id, similarity: "similar", reason: "cords" },
        ],
      },
    ],
  });
  const result = await matchShoppingPhoto(db, "u1", image, { extract: async () => [jeans], ask, load: noPhotos });
  expect(result.verdict).toBe("similar");
  expect(result.matches.map((m) => m.item_id)).toEqual([exact.id, close1.id, close2.id]);
  expect(result.matches[0]).toMatchObject({ similarity: "near_identical", photo_url: "https://x/1.jpg", reason: "same jeans" });
  expect(result.matches[0]!.owned_since).toBeInstanceOf(Date);

  const none = await matchShoppingPhoto(db, "u1", image, { extract: async () => [top], ask: fake({ items: [] }).ask, load: noPhotos });
  expect(none).toMatchObject({ matches: [], verdict: "none" });
});

test("earlier photos of the closest candidates are sent and labeled; failed loads are skipped", async () => {
  const photo = (n: number) => `https://example.test/photos/${n}`;
  const same = owned(jeans, { photo_url: photo(1) });
  const sameColor = owned({ ...jeans, type: "pants" }, { photo_url: photo(2) });
  const broken = owned({ ...jeans, type: "pants" }, { photo_url: photo(3) });
  const noPhoto = owned({ ...jeans, type: "shorts", color_primary: "blue" }, { photo_url: null });
  const sharesPhoto = owned({ ...jeans, type: "skirt", color_primary: "red" }, { photo_url: photo(1) });

  const loaded: string[] = [];
  const load = async (url: string): Promise<ImageInput> => {
    loaded.push(url);
    if (url === photo(3)) throw new Error("404");
    return { base64: url.slice(-1), mediaType: "image/jpeg" };
  };
  const { ask, calls, images } = fake({ items: [] });
  await compareToCloset(image, [jeans], [noPhoto, broken, sameColor, sharesPhoto, same], ask, load);

  expect(loaded.sort()).toEqual([photo(1), photo(2), photo(3)]);
  expect(images[0]).toEqual([image, { base64: "1", mediaType: "image/jpeg" }, { base64: "2", mediaType: "image/jpeg" }]);
  const prompt = calls[0]!;
  expect(prompt).toContain("earlier photos A, B");
  expect(prompt).toContain(`${same.id}: black straight-leg denim jeans (jeans, black, solid, straight-leg) [in photo A]`);
  expect(prompt).toContain(`${sharesPhoto.id}: black straight-leg denim jeans (skirt, red, solid, straight-leg) [in photo A]`);
  expect(prompt).toMatch(new RegExp(`${sameColor.id}: .*\\[in photo B\\]`));
  expect(prompt).not.toMatch(new RegExp(`${broken.id}: .*\\[in photo`));
  expect(prompt).not.toMatch(new RegExp(`${noPhoto.id}: .*\\[in photo`));
});

test("a busy photo can't crowd out one item's only reference photo", async () => {
  const photo = (n: number) => `https://example.test/photos/${n}`;
  // Seven close jeans candidates, each from its own photo, and one top.
  const jeansCloset = Array.from({ length: 7 }, (_, n) => owned(jeans, { photo_url: photo(n) }));
  const onlyTop = owned({ ...top, type: "t-shirt", color_primary: "grey" }, { photo_url: photo(99) });
  const loaded: string[] = [];
  const load = async (url: string): Promise<ImageInput> => {
    loaded.push(url);
    return { base64: "x", mediaType: "image/jpeg" };
  };
  await compareToCloset(image, [jeans, top], [...jeansCloset, onlyTop], fake({ items: [] }).ask, load);
  expect(loaded.length).toBe(6);
  expect(loaded).toContain(photo(99));
});
