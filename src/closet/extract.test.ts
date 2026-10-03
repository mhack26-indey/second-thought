import { expect, test } from "bun:test";
import { z } from "zod";
import { CATEGORY_TYPES, ITEM_TYPES, categoryOf } from "./categories.ts";
import { ExtractionSchema, withCategory } from "./extract.ts";
import { isSupportedImageFile, toImageInput } from "./vlm.ts";

// Offline checks; nothing here calls the API.

const modelItem = {
  type: "jeans",
  color_primary: "black",
  color_secondary: null,
  pattern: "solid",
  fit: "straight-leg",
  season: "all" as const,
  description: "black straight-leg denim jeans",
};

test("extraction schema converts to JSON Schema with the type enum", () => {
  const schema = z.toJSONSchema(ExtractionSchema) as any;
  expect(schema.properties.items.items.properties.type.enum).toEqual(ITEM_TYPES);
});

test("extraction schema rejects types outside the list", () => {
  expect(ExtractionSchema.safeParse({ items: [modelItem] }).success).toBe(true);
  const bad = { items: [{ ...modelItem, type: "fedora" }] };
  expect(ExtractionSchema.safeParse(bad).success).toBe(false);
});

test("category is derived from type", () => {
  expect(withCategory(modelItem).category).toBe("bottom");
  expect(categoryOf("hoodie")).toBe("top");
  expect(categoryOf("earrings")).toBe("jewelry");
});

test("type names are unique across categories", () => {
  const all = Object.values(CATEGORY_TYPES).flat();
  expect(new Set(all).size).toBe(all.length);
});

test("toImageInput handles URLs and data URLs", () => {
  expect(toImageInput("https://x.com/a.jpg")).toEqual({ url: "https://x.com/a.jpg" });
  expect(toImageInput("data:image/png;base64,AAAA")).toEqual({
    base64: "AAAA",
    mediaType: "image/png",
  });
});

test("isSupportedImageFile filters by extension", () => {
  expect(isSupportedImageFile("fit.JPG")).toBe(true);
  expect(isSupportedImageFile(".gitkeep")).toBe(false);
  expect(isSupportedImageFile("fit.heic")).toBe(true);
  expect(isSupportedImageFile("fit.tiff")).toBe(false);
});
