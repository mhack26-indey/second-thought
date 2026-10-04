import type { ItemType } from "./closet/categories.ts";

// Roughly what making one new item of each type emits, so a skipped purchase
// can say what it saved. These are estimates, and every reply says so.
//
// Source: Carbonfact's average footprint per product category (median kg
// CO₂e, from raw materials to final assembly, aligned with the EU Product
// Environmental Footprint method): https://www.carbonfact.com/carbon-footprint
// Making is what skipping a purchase avoids; washing and wearing aren't
// counted, since you'd wash whatever you wore instead. Checked 2026-10-03.
//
// Types without a close Carbonfact category (most jewelry, watches) are null
// and add nothing rather than a guess.

const KG_CO2E: Record<ItemType, number | null> = {
  "t-shirt": 10.6,
  "long-sleeve shirt": 9.76, // Long Sleeve T-Shirt
  "tank top": 6.91,
  "button-up shirt": 11.98, // Shirt
  polo: 11.98, // Shirt
  blouse: 10.84, // Tops
  crewneck: 18.97, // Hoodie: a sweatshirt without the hood
  hoodie: 18.97,
  sweater: 19.05,
  cardigan: 26.85,
  jeans: 16.34,
  pants: 27.5,
  sweatpants: 16.29, // Bottoms
  leggings: 6.16,
  shorts: 16.29, // Bottoms
  skirt: 11.15,
  dress: 14.24,
  jumpsuit: 14.24, // Dress
  jacket: 29.72, // Jackets
  "denim jacket": 29.72, // Jackets
  "leather jacket": 29.72, // Jackets
  coat: 29.72, // Jackets
  puffer: 29.72, // Jackets
  blazer: 29.72, // Jackets
  vest: 20.95, // Gilet
  sneakers: 12.09,
  boots: 79.97,
  heels: 62.42, // Pumps
  sandals: 33.5, // Open Toe Shoes
  flats: 37.95,
  loafers: 68.33,
  slides: 33.5, // Open Toe Shoes
  bag: 11.78, // Handbag
  hat: 4.22, // Baseball Caps
  belt: 11.19,
  sunglasses: 5.45, // Glasses
  scarf: 8.6,
  necklace: null,
  earrings: 0.36,
  bracelet: null,
  ring: null,
  watch: null,
};

/** Estimated kg CO₂e to make a new item of this type, or null if unknown. */
export function footprintOf(type: string): number | null {
  return KG_CO2E[type as ItemType] ?? null;
}

// EPA: a typical passenger car emits about 400 g of CO₂ per mile.
// https://www.epa.gov/greenvehicles/greenhouse-gas-emissions-typical-passenger-vehicle
const KG_PER_MILE = 0.4;

/** "≈ 16 kg CO₂e (about 41 miles of driving)" */
export function describeKg(kg: number): string {
  const miles = Math.round(kg / KG_PER_MILE);
  return `≈ ${Math.round(kg)} kg CO₂e (about ${miles} ${miles === 1 ? "mile" : "miles"} of driving)`;
}

const PAIRS = new Set(["jeans", "pants", "sweatpants", "leggings", "shorts", "sneakers", "boots", "heels", "sandals", "flats", "loafers", "slides", "sunglasses", "earrings"]);

/** Pairs and plural-named items ("jeans", "sneakers") take plural verbs. */
export function isPlural(type: string): boolean {
  return PAIRS.has(type);
}

/** "a new pair of jeans", "a new hoodie" */
export function aNew(type: string): string {
  return PAIRS.has(type) ? `a new pair of ${type}` : `a new ${type}`;
}

const SKIP_ASK = `Reply "skip" and I'll count it, or "buying it" if you're getting it anyway.`;

/**
 * The shopping reply's last line: asks whether they're skipping it, with what
 * skipping saves. Nothing counts until they answer (ShoppingMode.answerSkip).
 */
export function skipLine(type: string): string {
  const kg = footprintOf(type);
  if (kg === null) return `Skip it? ${SKIP_ASK}`;
  return `Skip it? Making ${aNew(type)} emits ${describeKg(kg)}, estimated from Carbonfact's average for the category. ${SKIP_ASK}`;
}
