import type { Climate } from "./climate.ts";

// When an item is "in season" in someone's city: the months whose normal
// daily high suits it. Bands are by item type (the season tag breaks ties):
// heavy outerwear when highs are at most 50°F, mid layers at most 65°F,
// warm-weather pieces at least 72°F, everything else all year. A puffer has no
// season in Miami, so it's never asked about there.

export type Band = { maxHighF: number } | { minHighF: number } | "all_year";

const HEAVY = new Set(["puffer", "coat"]);
const MID = new Set(["sweater", "hoodie", "crewneck", "cardigan", "jacket", "denim jacket", "leather jacket", "boots"]);
const WARM = new Set(["shorts", "tank top", "sandals", "slides"]);

export function bandOf(type: string, season: string): Band {
  if (HEAVY.has(type)) return { maxHighF: 50 };
  if (MID.has(type)) return { maxHighF: 65 };
  if (WARM.has(type)) return { minHighF: 72 };
  if (season === "cold") return { maxHighF: 65 };
  if (season === "warm") return { minHighF: 72 };
  return "all_year";
}

const toF = (c: number) => (c * 9) / 5 + 32;

/** Months (0 = January) the item is in season in this climate. */
export function seasonMonths(band: Band, climate: Climate): number[] {
  const months = [...Array(12).keys()];
  if (band === "all_year") return months;
  return months.filter((m) => {
    const high = toF(climate.highsC[m]!);
    return "maxHighF" in band ? high <= band.maxHighF : high >= band.minHighF;
  });
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov–Mar", "all year", or "Jun–Sep" (a season can wrap around New Year). */
export function describeMonths(months: number[]): string {
  if (months.length === 12) return "all year";
  if (!months.length) return "never";
  const set = new Set(months);
  // Start where the run begins: the first month whose previous month isn't in season.
  const start = months.find((m) => !set.has((m + 11) % 12))!;
  const runs: [number, number][] = [];
  let m = start;
  for (let i = 0; i < 12; i++, m = (m + 1) % 12) {
    if (!set.has(m)) continue;
    const last = runs.at(-1);
    if (last && (last[1] + 1) % 12 === m) last[1] = m;
    else runs.push([m, m]);
  }
  return runs.map(([a, b]) => (a === b ? MONTH[a] : `${MONTH[a]}–${MONTH[b]}`)).join(", ");
}

/** What to call the weather the item is for, in the question. */
export function weatherName(type: string, band: Band): string {
  if (band === "all_year") return "fit checks";
  if (HEAVY.has(type)) return `${type} weather`;
  return "maxHighF" in band ? "cold weather" : "warm weather";
}
