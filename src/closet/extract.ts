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

// What kind of photo it is, read in the same call so routing costs nothing:
// a fit check (worn clothes), an order screenshot (a retailer's order or
// receipt page), or a product shot (a store photo or listing, even with a
// model wearing it), or a closet dump (clothes nobody is wearing, shown to
// add them to the closet: a rail, a pile, a drawer). A listing's title says
// which garment is for sale, so only that one is read, not the rest of the
// model's outfit.
export const IMAGE_KINDS = ["fit_check", "order_screenshot", "product", "closet_dump"] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

export const ExtractionSchema = z.object({
  image_kind: z.enum(IMAGE_KINDS),
  listing_title: z.string().nullable(), // a store listing's product name, as shown
  items: z.array(ModelItemSchema),
});

type ModelItem = z.infer<typeof ModelItemSchema>;
export type ExtractedItem = ModelItem & { category: Category };

const typeList = Object.entries(CATEGORY_TYPES)
  .map(([category, types]) => `- ${category}: ${types.join(", ")}`)
  .join("\n");

const EXTRACT_PROMPT = `First, image_kind:
- order_screenshot: a screenshot of an online order, order confirmation, receipt or shipping email (a retailer's page or app listing items bought, usually with prices)
- product: a store listing or product page (shop layout: a product name, a price, sizes, "add to bag/cart"), even when a model is wearing the item; or a photo of one item on its own (on a hanger, held up, laid flat, on a store shelf) with nobody wearing it
- closet_dump: several clothes nobody is wearing, at home, shown to record what someone owns: a closet rail, a pile on a bed, an open drawer, folded stacks, shoes lined up
- fit_check: anything else, usually a person showing what they're wearing

listing_title: for a product listing, its product name or description exactly as shown (e.g. "Relaxed Straight-Leg Jean"); otherwise null.

If it's an order_screenshot, return an empty items list; the order is read separately.

If it's a product listing, list ONLY what's for sale:
- With a product name or description, list just the garment(s) it names, and none of the other clothes the model is styled in. Describe it in the listing's own words where they say something useful (color, cut, fabric).
- If the listing sells a whole outfit (a "set", "matching set", "two-piece", "co-ord", bundle, or several pieces each with its own price), list every piece of it.
- With no text, list only the featured item (the one centered or most prominent).

If it's a closet_dump, list every item you can identify, including ones partly hidden behind others as long as you can tell what they are (a sleeve and collar are enough for a shirt). Each hanger, stack or pair is its own item.

Otherwise (a fit check or a plain product photo), list every clothing item, pair of shoes, accessory and piece of jewelry visibly worn or shown in this photo.

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
- Skip items you can't make out well enough to describe (heavily cropped or hidden; in a closet_dump, see above).
- If there are no clothing items, return an empty list.
- Use lowercase for every field.`;

export interface PhotoExtraction {
  kind: ImageKind;
  items: ExtractedItem[];
  listing?: string | null; // a store listing's product name, if the photo is one
}

/** One vision call: what kind of photo it is, and the items in it. */
export async function extractPhoto(image: string | ImageInput): Promise<PhotoExtraction> {
  const result = await vlmJson({
    schema: ExtractionSchema,
    images: [toImageInput(image)],
    prompt: EXTRACT_PROMPT,
  });
  return { kind: result.image_kind, items: result.items.map(withCategory), listing: result.listing_title?.trim() || null };
}

export async function extractItems(image: string | ImageInput): Promise<ExtractedItem[]> {
  return (await extractPhoto(image)).items;
}

export function withCategory(item: ModelItem): ExtractedItem {
  return { category: categoryOf(item.type as never), ...item };
}
