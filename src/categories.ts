export const CATEGORIES = ["tops", "bottoms", "outerwear", "shoes", "dresses", "accessories", "other"] as const;
export type Category = (typeof CATEGORIES)[number];
