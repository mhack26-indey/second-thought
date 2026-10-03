import { z } from "zod";
import { ITEM_TYPES } from "./categories.ts";
import { type ExtractedItem, ModelItemSchema, withCategory } from "./extract.ts";
import { type ImageInput, vlmJson } from "./vlm.ts";

// Reads an order screenshot (confirmation page, receipt, shipping email) in
// one vision call. Line items use the extraction fields so they go into the
// closet like any other item; the model picks `type` and we derive `category`.

const LineItemSchema = ModelItemSchema.extend({
  price: z.number().nullable(), // per item, in the order's currency
});

export const OrderSchema = z.object({
  retailer: z.string(),
  order_date: z.string().nullable(), // YYYY-MM-DD
  items: z.array(LineItemSchema),
});

export interface OrderLine extends ExtractedItem {
  price: number | null;
}

export interface ParsedOrder {
  retailer: string;
  order_date: string | null; // YYYY-MM-DD, or null when none is visible
  items: OrderLine[];
}

const ORDER_PROMPT = `This is a screenshot of an online clothing order (an order confirmation, receipt or shipping email).

Return:
- retailer: the store's name as shown (e.g. "Zara", "H&M", "amazon.com")
- order_date: the date the order was placed, as YYYY-MM-DD, or null if no order date is visible. Don't guess a year that isn't shown; use null instead.
- items: one entry per clothing item, pair of shoes, accessory or piece of jewelry ordered. Skip anything that isn't clothing (electronics, home goods, gift cards), shipping and tax lines. If a quantity is more than 1, list the item that many times.

For each item:
- type: exactly one of: ${ITEM_TYPES.join(", ")}. Pick the closest fit.
- color_primary / color_secondary: plain color names from the product name or thumbnail; color_secondary is null if one color
- pattern: solid, striped, graphic, plaid, floral, etc.; "unknown" if you can't tell
- fit: e.g. straight-leg, wide-leg, oversized, slim, cropped, regular; "unknown" if you can't tell, "n/a" where fit doesn't apply
- season: warm, cold, or all
- description: one short phrase someone could use to recognize this item later, e.g. "black straight-leg denim jeans"
- price: the price paid for one item as a number (49.9 for $49.90), or null if none is shown

Use lowercase for every field except retailer.`;

export async function parseOrder(image: ImageInput): Promise<ParsedOrder> {
  const result = await vlmJson({ schema: OrderSchema, images: [image], prompt: ORDER_PROMPT });
  return {
    retailer: result.retailer.trim(),
    order_date: result.order_date,
    items: result.items.map(({ price, ...item }) => ({ ...withCategory(item), price })),
  };
}
