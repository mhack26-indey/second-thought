import { findCities } from "./cities.ts";
import type { Db } from "./db/client.ts";

// A city's normal climate: the average daily high and low for each month over
// the last 10 full years, from Open-Meteo's free weather archive (no key).
// Fetched once per city and cached in city_climate; a season is about what a
// month is usually like there, not today's weather.

export interface Climate {
  city: string;
  countryCode: string | null;
  highsC: number[]; // 12 monthly averages, January first
  lowsC: number[];
}

const YEARS = 10;

async function fetchMonthly(latitude: number, longitude: number, now = new Date()) {
  const last = now.getFullYear() - 1;
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${latitude}&longitude=${longitude}` +
    `&start_date=${last - YEARS + 1}-01-01&end_date=${last}-12-31&daily=temperature_2m_max,temperature_2m_min&timezone=auto`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`climate archive ${res.status}`);
  const body = (await res.json()) as { daily: { time: string[]; temperature_2m_max: (number | null)[]; temperature_2m_min: (number | null)[] } };
  const monthly = (values: (number | null)[]) => {
    const sum = Array(12).fill(0);
    const n = Array(12).fill(0);
    body.daily.time.forEach((day, i) => {
      const v = values[i];
      if (v === null || v === undefined) return;
      const m = Number(day.slice(5, 7)) - 1;
      sum[m] += v;
      n[m]++;
    });
    return sum.map((s, m) => Math.round((s / n[m]) * 10) / 10);
  };
  return { highsC: monthly(body.daily.temperature_2m_max), lowsC: monthly(body.daily.temperature_2m_min) };
}

/** The climate for a saved city name, from the cache or fetched once. Undefined if the city can't be found. */
export async function climateFor(db: Db, city: string): Promise<Climate | undefined> {
  const [row] = await db.query<{ country_code: string | null; highs_c: string; lows_c: string }>(
    `SELECT country_code, highs_c, lows_c FROM city_climate WHERE city = $1`,
    [city],
  );
  if (row) return { city, countryCode: row.country_code, highsC: JSON.parse(row.highs_c), lowsC: JSON.parse(row.lows_c) };

  // Saved names are labels the lookup itself produced, so the first match is the place.
  const [place] = await findCities(city);
  if (place?.latitude === undefined || place.longitude === undefined) return undefined;
  const { highsC, lowsC } = await fetchMonthly(place.latitude, place.longitude);
  await db.query(
    `INSERT INTO city_climate (city, country_code, latitude, longitude, highs_c, lows_c) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (city) DO NOTHING`,
    [city, place.countryCode ?? null, place.latitude, place.longitude, JSON.stringify(highsC), JSON.stringify(lowsC)],
  );
  return { city, countryCode: place.countryCode ?? null, highsC, lowsC };
}
