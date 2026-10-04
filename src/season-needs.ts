import type { Climate } from "./climate.ts";
import type { Item } from "./closet/repo.ts";
import { isPlural } from "./footprint.ts";
import { type Band, bandOf, seasonMonths } from "./seasons.ts";

// "What should I buy?" when a season is about to change: which season starts
// within six weeks in their city (from its monthly climate normals, the same
// bands seasons.ts uses), what that season needs, and what they already own
// for it, storage included, before anything is suggested. Everything here is
// computed from their closet and wears; nothing is generic advice.

export const SEASON_LOOKAHEAD_DAYS = 42;
export type SeasonName = "winter" | "summer";

// Winter: months whose normal high is at most 50°F (puffer weather); summer: at least 72°F.
const SEASON_BANDS: Record<SeasonName, Band> = { winter: { maxHighF: 50 }, summer: { minHighF: 72 } };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const toF = (c: number) => Math.round((c * 9) / 5 + 32);

export interface UpcomingSeason {
  name: SeasonName;
  month: number; // the month it starts (0 = January)
  highF: number; // that month's normal high
}

/** The season that starts within six weeks and isn't on yet, or null. */
export function upcomingSeason(climate: Climate, today = new Date()): UpcomingSeason | null {
  const day = 86_400_000;
  for (const name of ["winter", "summer"] as const) {
    const months = seasonMonths(SEASON_BANDS[name], climate);
    if (!months.length || months.length === 12 || months.includes(today.getMonth())) continue; // never, always, or already
    for (let ahead = 1; ahead <= 2; ahead++) {
      const start = new Date(today.getFullYear(), today.getMonth() + ahead, 1);
      if ((start.getTime() - today.getTime()) / day > SEASON_LOOKAHEAD_DAYS) break;
      if (months.includes(start.getMonth())) return { name, month: start.getMonth(), highF: toF(climate.highsC[start.getMonth()]!) };
    }
  }
  return null;
}

/** One thing a season needs, and which owned items cover it. */
interface Need {
  label: string; // "jackets": "you're covered on jackets"
  missing: string; // "no winter jacket"
  category: string;
  noun: string; // what to search for
  min: number; // how many it takes to be covered
  covers: (i: Item) => boolean;
}

const COLD = (i: Item) => {
  const band = bandOf(i.type, i.season);
  return band !== "all_year" && "maxHighF" in band;
};
const WARM_OK = (i: Item) => {
  const band = bandOf(i.type, i.season);
  return band === "all_year" || "minHighF" in band;
};

const NEEDS: Record<SeasonName, Need[]> = {
  winter: [
    { label: "jackets", missing: "no winter jacket", category: "outerwear", noun: "winter coat", min: 1, covers: (i) => i.category === "outerwear" && (["puffer", "coat"].includes(i.type) || i.season === "cold") },
    { label: "cold-weather shoes", missing: "no cold-weather shoes", category: "shoes", noun: "boots", min: 1, covers: (i) => i.category === "shoes" && (i.type === "boots" || i.season === "cold") },
    { label: "warm layers", missing: "only one warm layer", category: "top", noun: "sweater", min: 2, covers: (i) => i.category === "top" && COLD(i) },
  ],
  summer: [
    { label: "shorts", missing: "no shorts", category: "bottom", noun: "shorts", min: 1, covers: (i) => i.category === "bottom" && (["shorts", "skirt"].includes(i.type) || i.season === "warm") },
    { label: "warm-weather tops", missing: "too few warm-weather tops", category: "top", noun: "t-shirt", min: 3, covers: (i) => i.category === "top" && WARM_OK(i) },
    { label: "summer shoes", missing: "no shoes for warm weather", category: "shoes", noun: "sneakers", min: 1, covers: (i) => i.category === "shoes" && WARM_OK(i) },
  ],
};

export interface SeasonAdvice {
  season: UpcomingSeason;
  lines: string[]; // what's coming, what covers it, what's missing
  searches: { category: string; query: string }[]; // at most 2, for the sized secondhand links
  counts: Record<string, number>; // items for that season (or all year), by category
}

/** The value worn most often among these, by wear (not by how many they own). */
function mostWorn(wears: Item[], pick: (i: Item) => string | null): string | null {
  const n = new Map<string, number>();
  for (const w of wears) {
    const v = pick(w);
    if (v) n.set(v, (n.get(v) ?? 0) + 1);
  }
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
const realColor = (i: Item) => (i.color_primary && i.color_primary !== "unknown" ? i.color_primary.split(" ").at(-1)! : null);
const realFit = (i: Item) => (i.fit && !["unknown", "n/a", "regular"].includes(i.fit) ? i.fit : null);

/**
 * The season part of "what should I buy?": null when no season change is
 * within six weeks (the reply stays as it was). `owned` is the closet (with
 * locations); `wears` is what they've worn lately, one row per wear.
 */
export function seasonAdvice(climate: Climate, owned: Item[], wears: Item[], today = new Date()): SeasonAdvice | null {
  const season = upcomingSeason(climate, today);
  if (!season) return null;
  const Name = season.name.charAt(0).toUpperCase() + season.name.slice(1);
  const lines = [`${Name}'s coming: ${MONTHS[season.month]} highs here average ${season.highF}°F.`];

  // Their items for that season (or any season), by category.
  const counts: Record<string, number> = {};
  const inSeason = (i: Item) => {
    const band = bandOf(i.type, i.season);
    return band === "all_year" || (season.name === "winter" ? "maxHighF" in band : "minHighF" in band);
  };
  for (const i of owned) if (inSeason(i)) counts[i.category] = (counts[i.category] ?? 0) + 1;

  const searches: SeasonAdvice["searches"] = [];
  for (const need of NEEDS[season.name]) {
    const have = owned.filter(need.covers);
    if (have.length >= need.min) {
      // Covered: say by what, and where it is if it's put away.
      const stored = have.find((i) => i.location);
      const shown = stored ?? have[0]!;
      lines.push(
        stored
          ? `Your ${shown.description} is in the ${stored.location}, so you're covered on ${need.label}.`
          : have.length === 1
            ? `Your ${shown.description} ${isPlural(shown.type) ? "cover" : "covers"} ${need.label}.`
            : `You have ${have.length} ${need.label}, like your ${shown.description}.`,
      );
      continue;
    }
    if (searches.length >= 2) continue; // at most two suggestions
    // Missing: suggest it in the colors and fits they actually wear.
    const worn = wears.filter((w) => w.category === need.category);
    const color = mostWorn(worn, realColor) ?? mostWorn(wears, realColor);
    const fit = need.category === "shoes" ? null : mostWorn(worn, realFit);
    const what = [color, fit, need.noun].filter(Boolean).join(" ");
    const plural = /s$/.test(need.noun); // boots, shorts, sneakers
    const pick = plural ? `${what.charAt(0).toUpperCase()}${what.slice(1)} fit` : `A ${what} fits`;
    lines.push(`For ${season.name} you have ${need.missing}. ${pick} what you already wear.`);
    searches.push({ category: need.category, query: [color, need.noun].filter(Boolean).join(" ") });
  }
  return { season, lines, searches, counts };
}
