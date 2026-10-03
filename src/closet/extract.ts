import { z } from "zod";
import { CATEGORY_TYPES, ITEM_TYPES, categoryOf, type Category } from "./categories.ts";
import { toImageInput, vlmJson, type ImageInput } from "./vlm.ts";

// Extraction schema from vision-matching-plan.md section 3. The model picks
// `type` from a fixed list and we derive `category` from it, so the two can
// never disagree. `pattern` and `fit` stay open; the prompt steers them.

export const ModelItemSchema = z.object({
  type: z.enum(ITEM_TYPES as [string, ...string[]]),
  color_primary: z.string(),
  color_secondary: z.string().nullable(),
  pattern: z.string(),
  fit: z.string(),
  season: z.enum(["warm", "cold", "all"]),
  description: z.string(),
});

export const ExtractionSchema = z.object({
  items: z.array(ModelItemSchema),
});

type ModelItem = z.infer<typeof ModelItemSchema>;
export type ExtractedItem = ModelItem & { category: Category };

const typeList = Object.entries(CATEGORY_TYPES)
  .map(([category, types]) => `- ${category}: ${types.join(", ")}`)
  .join("\n");

const EXTRACT_PROMPT = `List every clothing item, pair of shoes, accessory and piece of jewelry visibly worn or shown in this photo.

For each item give:
- type: exactly one of these, grouped by category:
${typeList}
  Pick the closest fit. A zip-up or pullover with a hood is a hoodie; a plain sweatshirt without a hood is a crewneck; a knit pullover is a sweater.
- color_primary / color_secondary: plain color names (black, navy, cream, olive...); color_secondary is null if the item is one color
- pattern: solid, striped, graphic, plaid, floral, camo, colorblock, etc.
- fit: e.g. straight-leg, wide-leg, skinny, oversized, slim, cropped, regular; "n/a" where fit doesn't apply
- season: warm, cold, or all
- description: one short phrase someone could use to recognize this exact item later, e.g. "black straight-leg denim jeans"

Rules:
- One entry per physical item. Don't list the same item twice; a pair of shoes or earrings is one item.
- Skip socks, tights and underwear.
- Skip items you can't make out well enough to describe (heavily cropped or hidden).
- If there are no clothing items, return an empty list.
- Use lowercase for every field.`;

export async function extractItems(
  image: string | ImageInput,
): Promise<ExtractedItem[]> {
  const result = await vlmJson({
    schema: ExtractionSchema,
    images: [toImageInput(image)],
    prompt: EXTRACT_PROMPT,
  });
  return result.items.map(withCategory);
}

export function withCategory(item: ModelItem): ExtractedItem {
  return { category: categoryOf(item.type as never), ...item };
}
