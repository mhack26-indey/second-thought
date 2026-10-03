// Closet accuracy on real photos: ingests every photo in demo_images/ into a
// throwaway user on an in-process database (PGlite; nothing touches Neon),
// through the same path as a live fit check (src/photo-intake.ts), and scores
// the result against the hand labels in demo_images/labels.json.
//
// Usage: bun run eval:closet   (needs OPENROUTER_API_KEY; writes eval/closet-results.md)
//
// Each photo's extraction runs once and is reused by every ingest run below,
// so the runs differ only in what the dedup comparison sees. Model answers
// vary between runs; these numbers are one run.

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { today } from "../src/closet/dates.ts";
import { compareToCloset } from "../src/closet/compare.ts";
import { type ExtractedItem, type PhotoExtraction, extractPhoto } from "../src/closet/extract.ts";
import { candidatesByCategory } from "../src/closet/repo.ts";
import { type ImageInput, imageFromFile, isSupportedImageFile } from "../src/closet/vlm.ts";
import type { Db } from "../src/db/client.ts";
import { testDb } from "../src/db/test-db.ts";
import { scheduleDemoPhotos } from "../src/demo-seed.ts";
import { type Matcher, visionMatcher } from "../src/ingest.ts";
import { matchSeenItems } from "../src/match.ts";
import { readPhoto } from "../src/photo-intake.ts";

const DIR = "demo_images";
const OUT = "eval/closet-results.md";
const USER = "eval";

interface LabelDef {
  category: string;
  color: string;
  description: string;
}
interface Appearance {
  label: string;
  unsure?: boolean;
}
const labels: { items: Record<string, LabelDef>; photos: Record<string, Appearance[]> } = await Bun.file(
  join(DIR, "labels.json"),
).json();

const onDisk = new Set((await readdir(DIR)).filter(isSupportedImageFile));
const files = Object.keys(labels.photos).filter((f) => onDisk.has(f));
const missing = Object.keys(labels.photos).filter((f) => !onDisk.has(f));
const unlabeled = [...onDisk].filter((f) => !(f in labels.photos));
if (missing.length) console.warn(`Labeled but not in ${DIR}/: ${missing.join(", ")}`);
if (unlabeled.length) console.warn(`In ${DIR}/ but not labeled (left out): ${unlabeled.join(", ")}`);
const order = scheduleDemoPhotos(files, today()).map((p) => p.file); // the order the seed ingests them

// ---- vision calls, cached per photo ----

const images = new Map<string, ImageInput>();
const image = async (file: string) => images.get(file) ?? images.set(file, await imageFromFile(join(DIR, file))).get(file)!;
const urlOf = (file: string) => `demo:${file}`;
const fileOf = (url: string) => url.slice("demo:".length);
const load = (url: string) => image(fileOf(url));

const extractions = new Map<string, PhotoExtraction>();
let extractSeconds = 0;
async function extracted(file: string): Promise<PhotoExtraction> {
  const cached = extractions.get(file);
  if (cached) return cached;
  const started = Date.now();
  const result = await extractPhoto(await image(file));
  extractSeconds += (Date.now() - started) / 1000;
  extractions.set(file, result);
  return result;
}

// ---- color groups, for comparing a model's color name with a label's ----

const COLOR_GROUPS: [RegExp, string][] = [
  [/navy|midnight|dark blue/, "navy"],
  [/olive|sage|green|army|forest|moss/, "green"],
  [/khaki|beige|tan|sand|stone|camel|cream|ivory|off-white|ecru|taupe/, "beige"],
  [/gr[ae]y|charcoal|heather|silver|slate/, "gray"],
  [/blue|cobalt|royal/, "blue"],
  [/black|jet/, "black"],
  [/white/, "white"],
  [/red|burgundy|maroon|crimson/, "red"],
  [/brown|chocolate|coffee/, "brown"],
];
const colorGroup = (c: string) => COLOR_GROUPS.find(([re]) => re.test(c.toLowerCase()))?.[1] ?? c.toLowerCase();

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2));
function overlap(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  return wa.size ? [...wa].filter((w) => wb.has(w)).length / wa.size : 0;
}

/**
 * Pairs a photo's labeled items with what the model extracted from it: same
 * category required, then same color group, then shared description words.
 * Returns, per appearance, the index of the extracted item (or -1).
 */
function align(appearances: Appearance[], seen: ExtractedItem[]): number[] {
  const scored: { a: number; s: number; score: number }[] = [];
  appearances.forEach((ap, a) => {
    const def = labels.items[ap.label]!;
    seen.forEach((item, s) => {
      if (item.category !== def.category) return;
      const score = (colorGroup(item.color_primary) === colorGroup(def.color) ? 2 : 0) + overlap(def.description, item.description);
      scored.push({ a, s, score });
    });
  });
  scored.sort((x, y) => y.score - x.score);
  const result = appearances.map(() => -1);
  const used = new Set<number>();
  for (const { a, s } of scored) {
    if (result[a] !== -1 || used.has(s)) continue;
    result[a] = s;
    used.add(s);
  }
  return result;
}

// ---- one ingest run: photos in order into a fresh database ----

interface Run {
  db: Db;
  /** Per photo, the closet item each extracted item went to (same order as the extraction). */
  itemsOf: Map<string, number[]>;
  fallbacks: number; // comparisons that failed and fell back to name matching
}

async function ingest(include: string[]): Promise<Run> {
  const db = await testDb();
  await db.query(`INSERT INTO users (id, web_token) VALUES ($1, 'eval')`, [USER]);
  const run: Run = { db, itemsOf: new Map(), fallbacks: 0 };
  const fallback: Matcher = async (seen, owned) => {
    run.fallbacks++;
    return matchSeenItems(seen, owned);
  };
  for (const file of order.filter((f) => include.includes(f))) {
    const url = urlOf(file);
    const [outfit] = await db.query<{ id: number }>(
      `INSERT INTO outfits (user_id, photo_url, taken_on) VALUES ($1, $2, current_date) RETURNING id`,
      [USER, url],
    );
    let matched: (number | null)[] = [];
    const img = await image(file);
    await readPhoto(USER, { id: outfit!.id, photoUrl: url }, img, { outfitId: outfit!.id, image: img, at: Date.now(), cancelled: false }, {
      db,
      extract: async () => ({ ...(await extracted(file)), kind: "fit_check" }),
      matcher: (i) => {
        const vision = visionMatcher(i, fallback, undefined, load);
        return async (seen, owned) => {
          const ids = await vision(seen, owned);
          matched = ids.map((id) => (owned.some((o) => o.id === id) ? id : null));
          return ids;
        };
      },
      shop: async () => [],
    });
    // Seen items the matcher linked keep that id; the rest were added in order, with this photo.
    const added = (await db.query<{ id: number }>(`SELECT id FROM items WHERE photo_url = $1 AND source = 'fit_check' ORDER BY id`, [url])).map(
      (r) => r.id,
    );
    const seen = (await extracted(file)).items;
    let next = 0;
    run.itemsOf.set(
      file,
      seen.map((_, i) => matched[i] ?? added[next++] ?? -1),
    );
    process.stdout.write(".");
  }
  process.stdout.write("\n");
  return run;
}

/** label -> closet item ids its (sure) appearances went to, in this run. */
function itemsByLabel(run: Run, include: string[]): Map<string, Set<number>> {
  const byLabel = new Map<string, Set<number>>();
  for (const file of include) {
    const appearances = labels.photos[file]!;
    const ids = run.itemsOf.get(file) ?? [];
    align(appearances, extractions.get(file)!.items).forEach((s, a) => {
      if (s === -1 || appearances[a]!.unsure) return;
      const set = byLabel.get(appearances[a]!.label) ?? new Set();
      set.add(ids[s]!);
      byLabel.set(appearances[a]!.label, set);
    });
  }
  return byLabel;
}

// ---- 1. everything, in seed order ----

const started = Date.now();
console.log(`Extracting and ingesting ${files.length} photos`);
const main = await ingest(files);

// Extraction: every labeled appearance, sure or not.
let appearances = 0;
let foundCategory = 0;
let foundColor = 0;
const extractionMisses: string[] = [];
const kinds: Record<string, number> = {};
for (const file of files) {
  const { kind, items } = extractions.get(file)!;
  kinds[kind] = (kinds[kind] ?? 0) + 1;
  const labeled = labels.photos[file]!;
  align(labeled, items).forEach((s, a) => {
    appearances++;
    const def = labels.items[labeled[a]!.label]!;
    if (s === -1) {
      extractionMisses.push(`${labeled[a]!.label} in ${file}`);
      return;
    }
    foundCategory++;
    if (colorGroup(items[s]!.color_primary) === colorGroup(def.color)) foundColor++;
    else extractionMisses.push(`${labeled[a]!.label} in ${file}: color "${items[s]!.color_primary}"`);
  });
}

// Dedup, sure appearances only.
const byLabel = itemsByLabel(main, files);
const labelsOf = new Map<number, Set<string>>();
for (const [label, ids] of byLabel) for (const id of ids) labelsOf.set(id, (labelsOf.get(id) ?? new Set()).add(label));
const sureCount = (label: string) => Object.values(labels.photos).flat().filter((a) => a.label === label && !a.unsure).length;
const repeated = [...byLabel.keys()].filter((l) => sureCount(l) >= 2);
const split = repeated.filter((l) => byLabel.get(l)!.size > 1);
const wrong = [...labelsOf].filter(([, ls]) => ls.size > 1);
const descriptions = new Map(
  (await main.db.query<{ id: number; description: string }>(`SELECT id, description FROM items WHERE user_id = $1`, [USER])).map((r) => [r.id, r.description]),
);
const wearsOf = new Map(
  (
    await main.db.query<{ id: number; n: number }>(
      `SELECT i.id, count(w.outfit_id)::int AS n FROM items i LEFT JOIN wears w ON w.item_id = i.id WHERE i.user_id = $1 GROUP BY i.id`,
      [USER],
    )
  ).map((r) => [r.id, r.n]),
);
const unmatchedItems = [...descriptions.keys()].filter((id) => !labelsOf.has(id));

// ---- 2. shopping: hold one photo out, ingest the rest, match it ----

// Each label seen (surely) in 2+ photos is held out in its latest one; labels
// sharing that photo share the run.
const holdouts = new Map<string, string[]>();
for (const label of Object.keys(labels.items)) {
  const photos = order.filter((f) => files.includes(f) && labels.photos[f]!.some((a) => a.label === label && !a.unsure));
  if (photos.length < 2) continue;
  const held = photos.at(-1)!;
  holdouts.set(held, [...(holdouts.get(held) ?? []), label]);
}

interface ShopResult {
  label: string;
  held: string;
  top1: boolean;
  top3: boolean;
  note: string;
}
const shopping: ShopResult[] = [];
for (const [held, heldLabels] of holdouts) {
  const rest = files.filter((f) => f !== held);
  console.log(`Holding out ${held} (${heldLabels.join(", ")}); ingesting the other ${rest.length}`);
  const run = await ingest(rest);
  const expected = itemsByLabel(run, rest);
  const { items: seen } = extractions.get(held)!;
  const categories = [...new Set(seen.map((s) => s.category))];
  const owned = (await Promise.all(categories.map((c) => candidatesByCategory(run.db, USER, c)))).flat();
  const comparison = await compareToCloset(await image(held), seen, owned, undefined, load);
  const appearances = labels.photos[held]!;
  const aligned = align(appearances, seen);
  for (const label of heldLabels) {
    const s = aligned[appearances.findIndex((a) => a.label === label)]!;
    const want = expected.get(label);
    if (s === -1) {
      shopping.push({ label, held, top1: false, top3: false, note: "not extracted from the held-out photo" });
      continue;
    }
    if (!want?.size) {
      shopping.push({ label, held, top1: false, top3: false, note: "not in the closet built from the other photos" });
      continue;
    }
    const ranked = comparison[s]!.map((m) => m.item.id);
    const descriptionsHere = new Map(owned.map((o) => [o.id, o.description]));
    const top1 = want.has(ranked[0] ?? -1);
    const top3 = ranked.slice(0, 3).some((id) => want.has(id));
    const shown = ranked.slice(0, 3).map((id) => `${descriptionsHere.get(id)}${want.has(id) ? " ✓" : ""}`);
    shopping.push({ label, held, top1, top3, note: shown.length ? shown.join("; ") : "no matches returned" });
  }
}

// ---- report ----

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "n/a");
const top1 = shopping.filter((r) => r.top1).length;
const top3 = shopping.filter((r) => r.top3).length;
const labelCount = Object.keys(labels.items).length;
const minutes = ((Date.now() - started) / 60_000).toFixed(1);

const summary: [string, string][] = [
  ["Photos", `${files.length} (model called ${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(", ")}; all ingested as fit checks)`],
  ["Unique items created vs true unique labels", `${descriptions.size} vs ${labelCount} (${unmatchedItems.length} items match no label)`],
  ["Missed merges (one label split into several items)", `${split.length} of ${repeated.length} repeated labels`],
  ["Wrong merges (different labels in one item)", `${wrong.length} items`],
  ["Extraction: labeled items found, right category", `${foundCategory}/${appearances} (${pct(foundCategory, appearances)})`],
  ["Extraction: right category and color", `${foundColor}/${appearances} (${pct(foundColor, appearances)})`],
  ["Shopping match precision@1", `${top1}/${shopping.length} (${pct(top1, shopping.length)})`],
  ["Shopping match in top 3", `${top3}/${shopping.length} (${pct(top3, shopping.length)})`],
  ["Comparisons that fell back to name matching", `${main.fallbacks} (main run)`],
];

const md = [
  "# Closet eval",
  "",
  `${files.length} real outfit photos of one person (\`demo_images/\`, not checked in) against hand labels (\`demo_images/labels.json\`: ${labelCount} items, ${appearances} appearances). Run ${today()}, ${minutes} min, vision model \`${process.env.VISION_MODEL ?? "google/gemini-3.8-flash"}\`. One run; model answers vary between runs. Merge scoring and shopping skip appearances labeled unsure. Produced by \`bun run eval:closet\`.`,
  "",
  "| Metric | Result |",
  "|---|---|",
  ...summary.map(([k, v]) => `| ${k} | ${v} |`),
  "",
  "## Labels and the items they became",
  "",
  "| Label | Sure photos | Items (wear count) |",
  "|---|---|---|",
  ...Object.keys(labels.items)
    .map((l) => [l, sureCount(l), [...(byLabel.get(l) ?? [])]] as const)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([l, n, ids]) => `| ${l} | ${n} | ${ids.length ? ids.map((id) => `${descriptions.get(id)} (${wearsOf.get(id)})`).join("; ") : "not found"} |`),
  "",
  "## Missed merges",
  "",
  ...(split.length ? split.map((l) => `- **${l}**: ${[...byLabel.get(l)!].map((id) => `"${descriptions.get(id)}"`).join(", ")}`) : ["None."]),
  "",
  "## Wrong merges",
  "",
  ...(wrong.length ? wrong.map(([id, ls]) => `- "${descriptions.get(id)}" holds ${[...ls].join(", ")}`) : ["None."]),
  "",
  "## Items that match no label",
  "",
  ...(unmatchedItems.length ? unmatchedItems.map((id) => `- ${descriptions.get(id)} (${wearsOf.get(id)} wears)`) : ["None."]),
  "",
  "## Extraction misses",
  "",
  ...(extractionMisses.length ? extractionMisses.map((m) => `- ${m}`) : ["None."]),
  "",
  "## Shopping match (held-out photo vs the closet from the other photos)",
  "",
  "| Label | Held out | @1 | Top 3 | Top matches (✓ = right item) |",
  "|---|---|---|---|---|",
  ...shopping.map((r) => `| ${r.label} | ${r.held} | ${r.top1 ? "yes" : "no"} | ${r.top3 ? "yes" : "no"} | ${r.note} |`),
  "",
].join("\n");

await mkdir("eval", { recursive: true });
await writeFile(OUT, md);
console.log(`\n${summary.map(([k, v]) => `${k.padEnd(52)} ${v}`).join("\n")}\n\nExtraction ${extractSeconds.toFixed(0)}s; total ${minutes} min. Details in ${OUT}.`);
process.exit(0);
