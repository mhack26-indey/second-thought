// Turns whatever someone typed as their city into real places, via
// Open-Meteo's geocoding API (free, no key; the plan uses Open-Meteo for
// weather too). "detroit" has several matches, so the bot lists them and
// asks which; "asdfgh" has none, so it asks again.

export interface City {
  label: string; // "Ann Arbor, Michigan" / "Paris, France"
  population: number;
  latitude?: number;
  longitude?: number;
  countryCode?: string; // "US"
}

export const MAX_CHOICES = 5;

/** "I'm in Ann Arbor!" -> "Ann Arbor": the onboarding answer, minus the sentence around it. */
export function cityFrom(text: string): string {
  const city = text
    .trim()
    .replace(/[.!]+$/, "")
    .replace(/^(?:(?:i'?m|i am|im|we'?re|we are)\s+)?(?:(?:currently|living|based|located|staying)\s+)?(?:in|at|from)\s+/i, "")
    .replace(/^(?:i|we)\s+live\s+in\s+/i, "")
    .replace(/^(?:it'?s|its)\s+/i, "")
    .trim();
  return city || text.trim();
}


const US_STATES: Record<string, string> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california", co: "colorado",
  ct: "connecticut", de: "delaware", fl: "florida", ga: "georgia", hi: "hawaii", id: "idaho",
  il: "illinois", in: "indiana", ia: "iowa", ks: "kansas", ky: "kentucky", la: "louisiana",
  me: "maine", md: "maryland", ma: "massachusetts", mi: "michigan", mn: "minnesota",
  ms: "mississippi", mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada",
  nh: "new hampshire", nj: "new jersey", nm: "new mexico", ny: "new york", nc: "north carolina",
  nd: "north dakota", oh: "ohio", ok: "oklahoma", or: "oregon", pa: "pennsylvania",
  ri: "rhode island", sc: "south carolina", sd: "south dakota", tn: "tennessee", tx: "texas",
  ut: "utah", vt: "vermont", va: "virginia", wa: "washington", wv: "west virginia",
  wi: "wisconsin", wy: "wyoming", dc: "district of columbia", "d c": "district of columbia",
};

// Nicknames people text that the geocoder reads literally ("LA" is a town in Cambodia).
const NICKNAMES: Record<string, string> = {
  la: "Los Angeles, CA",
  sf: "San Francisco, CA",
  nyc: "New York, NY",
  dc: "Washington D.C.",
  philly: "Philadelphia, PA",
  vegas: "Las Vegas, NV",
  nola: "New Orleans, LA",
  atl: "Atlanta, GA",
  chi: "Chicago, IL",
  "a2": "Ann Arbor, MI",
};

interface GeoResult {
  name: string;
  admin1?: string;
  country?: string;
  country_code?: string;
  feature_code?: string;
  population?: number;
  latitude?: number;
  longitude?: number;
}

async function search(name: string): Promise<GeoResult[]> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=20&language=en`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`geocoding ${res.status}`);
  const body = (await res.json()) as { results?: GeoResult[] };
  return body.results ?? [];
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

function label(r: GeoResult): string {
  if (r.admin1 === "District of Columbia") return "Washington, D.C.";
  if (r.country_code === "US") return [r.name, r.admin1].filter(Boolean).join(", ");
  return [r.name, r.country].filter(Boolean).join(", ");
}

/** True if a qualifier like "MI", "michigan" or "france" fits this place. */
function fits(r: GeoResult, qualifier: string): boolean {
  const q = norm(qualifier);
  const state = US_STATES[q] ?? q;
  return [r.admin1, r.country, r.country_code].some((v) => v && norm(v) === state) ||
    (q === "usa" || q === "us" ? r.country_code === "US" : false);
}

/**
 * Real places matching what they typed, best first (at most MAX_CHOICES).
 * "Ann Arbor, MI" and "ann arbor michigan" search "Ann Arbor" and keep the
 * Michigan one. Throws if the geocoder is unreachable.
 */
export async function findCities(text: string): Promise<City[]> {
  text = NICKNAMES[norm(text)] ?? text;
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  const words = (parts[0] ?? "").split(/\s+/);
  const extra = parts.slice(1);

  // Try the whole name first, then drop trailing words as qualifiers
  // ("ann arbor michigan" -> "ann arbor" + "michigan").
  for (let n = words.length; n >= 1; n--) {
    const name = words.slice(0, n).join(" ");
    const dropped = words.slice(n).join(" ");
    const qualifiers = dropped ? [dropped, ...extra] : extra;
    let results = (await search(name)).filter((r) => r.feature_code?.startsWith("PPL"));
    if (!results.length) continue;

    for (const q of qualifiers) {
      const narrowed = results.filter((r) => fits(r, q));
      if (narrowed.length) results = narrowed;
      else if (n < words.length) results = []; // the dropped words weren't a place qualifier
    }
    // No exact name means a nickname ("NYC" -> New York) or a typo; only big
    // cities are worth offering then, not every village that starts with "Nyc".
    const exact = results.filter((r) => norm(r.name) === norm(name));
    results = exact.length ? exact : results.filter((r) => (r.population ?? 0) >= 50_000);
    if (!results.length) continue;

    const byLabel = new Map<string, City>();
    for (const r of results) {
      const l = label(r);
      const population = r.population ?? 0;
      if ((byLabel.get(l)?.population ?? -1) < population) {
        byLabel.set(l, { label: l, population, latitude: r.latitude, longitude: r.longitude, countryCode: r.country_code });
      }
    }
    return [...byLabel.values()].sort((a, b) => b.population - a.population).slice(0, MAX_CHOICES);
  }
  return [];
}
