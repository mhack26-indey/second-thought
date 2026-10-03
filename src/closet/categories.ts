// Closet vocabulary. Every item has a category and a type (its subcategory).
// Types are deliberately coarse: specific enough that "do I already own a
// hoodie?" works, loose enough that the model picks the same one every time.
// Anything finer (wash, cut, neckline) goes in fit/pattern/description.

export const CATEGORY_TYPES = {
  top: [
    "t-shirt",
    "long-sleeve shirt",
    "tank top",
    "button-up shirt",
    "polo",
    "blouse",
    "crewneck",
    "hoodie",
    "sweater",
    "cardigan",
  ],
  bottom: ["jeans", "pants", "sweatpants", "leggings", "shorts", "skirt"],
  dress: ["dress", "jumpsuit"],
  outerwear: ["jacket", "denim jacket", "leather jacket", "coat", "puffer", "blazer", "vest"],
  shoes: ["sneakers", "boots", "heels", "sandals", "flats", "loafers", "slides"],
  accessory: ["bag", "hat", "belt", "sunglasses", "scarf"],
  jewelry: ["necklace", "earrings", "bracelet", "ring", "watch"],
} as const;

export type Category = keyof typeof CATEGORY_TYPES;
export type ItemType = (typeof CATEGORY_TYPES)[Category][number];

export const CATEGORIES = Object.keys(CATEGORY_TYPES) as Category[];
export const ITEM_TYPES = Object.values(CATEGORY_TYPES).flat() as ItemType[];

const TYPE_TO_CATEGORY = new Map<string, Category>(
  CATEGORIES.flatMap((c) => CATEGORY_TYPES[c].map((t) => [t, c] as const)),
);

export function categoryOf(type: ItemType): Category {
  return TYPE_TO_CATEGORY.get(type)!;
}
