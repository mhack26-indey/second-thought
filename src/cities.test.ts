import { afterEach, expect, test } from "bun:test";
import { cityFrom, findCities } from "./cities.ts";

test("cityFrom drops the sentence around the city", () => {
  expect(cityFrom("I'm in Ann Arbor!")).toBe("Ann Arbor");
  expect(cityFrom("i live in Seattle")).toBe("Seattle");
  expect(cityFrom("we are currently in Ann Arbor, MI.")).toBe("Ann Arbor, MI");
  expect(cityFrom("Detroit")).toBe("Detroit");
});

// A fake geocoder: answers by the searched name.
const PLACES: Record<string, object[]> = {
  detroit: [
    { name: "Detroit", admin1: "Michigan", country_code: "US", feature_code: "PPLA2", population: 645705 },
    { name: "Detroit", admin1: "Texas", country_code: "US", feature_code: "PPL", population: 705 },
    { name: "Detroit", admin1: "Michigan", country_code: "US", feature_code: "PPL", population: 10 }, // same label
  ],
  "ann arbor": [
    { name: "Ann Arbor", admin1: "Michigan", country_code: "US", feature_code: "PPLA2", population: 117070 },
    { name: "Ann Arbor Municipal", admin1: "Michigan", country_code: "US", feature_code: "AIRP" },
  ],
  "los angeles": [{ name: "Los Angeles", admin1: "California", country_code: "US", feature_code: "PPLA2", population: 3971883 }],
  paris: [
    { name: "Paris", admin1: "Île-de-France", country: "France", country_code: "FR", feature_code: "PPLC", population: 2138551 },
    { name: "Paris", admin1: "Texas", country_code: "US", feature_code: "PPLA2", population: 24782 },
  ],
};
const realFetch = globalThis.fetch;
function fakeGeocoder() {
  globalThis.fetch = (async (url: string) => {
    const name = decodeURIComponent(/name=([^&]*)/.exec(String(url))![1]!).toLowerCase();
    return Response.json({ results: PLACES[name] });
  }) as typeof fetch;
}
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("one real place comes back as a single labeled choice", async () => {
  fakeGeocoder();
  expect((await findCities("Ann Arbor")).map((c) => c.label)).toEqual(["Ann Arbor, Michigan"]);
});

test("several places are listed biggest first, without duplicate labels", async () => {
  fakeGeocoder();
  expect((await findCities("detroit")).map((c) => c.label)).toEqual(["Detroit, Michigan", "Detroit, Texas"]);
  expect((await findCities("Paris")).map((c) => c.label)).toEqual(["Paris, France", "Paris, Texas"]);
});

test("a state or country narrows it down, with or without a comma", async () => {
  fakeGeocoder();
  expect((await findCities("Detroit, TX")).map((c) => c.label)).toEqual(["Detroit, Texas"]);
  expect((await findCities("detroit texas")).map((c) => c.label)).toEqual(["Detroit, Texas"]);
  expect((await findCities("paris, france")).map((c) => c.label)).toEqual(["Paris, France"]);
});

test("nicknames resolve and nonsense finds nothing", async () => {
  fakeGeocoder();
  expect((await findCities("LA")).map((c) => c.label)).toEqual(["Los Angeles, California"]);
  expect(await findCities("asdfgh")).toEqual([]);
});
