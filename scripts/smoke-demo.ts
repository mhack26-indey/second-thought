// Smoke test of the demo, end to end, with nothing leaving this machine: a
// throwaway in-process Postgres (PGlite, served on a local socket so the
// bot's own store.ts talks to it), the vision and text models stubbed by
// replacing fetch, and the demo user seeded from fixture photos. Then the
// demo script's texts and photos go through the bot's real message handlers
// (flows.ts), and every reply is printed so the whole conversation can be read.
// Exits non-zero if a step throws or comes back empty.
//
// Usage: bun run smoke:demo

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

// ---- a throwaway database, and models that never leave the machine ----

const port = 55000 + Math.floor(Math.random() * 5000);
const pg = await PGlite.create();
const server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1" });
await server.start();
process.env.DATABASE_URL = `postgresql://postgres@127.0.0.1:${port}/postgres`;
process.env.OPENROUTER_API_KEY = "smoke-test-stub"; // vision on; every call is answered below
process.env.PUBLIC_URL = "http://localhost:3000";
delete process.env.LLM_BASE_URL;
delete process.env.VISION_MODEL;

const DEMO = "+15550009999";
const DAY = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

type ModelItem = { type: string; color_primary: string; color_secondary: null; pattern: string; fit: string; season: string; description: string };
const piece = (type: string, color: string, description: string, season = "all"): ModelItem => ({
  type,
  color_primary: color,
  color_secondary: null,
  pattern: "solid",
  fit: "regular",
  season,
  description,
});

// What the vision model "sees" in each photo the conversation sends, in order.
const extractions: { image_kind: string; listing_title: null; items: ModelItem[] }[] = [];
const ORDER = {
  retailer: "Uniqlo",
  order_date: ymd(new Date(Date.now() - 2 * DAY)), // 2 days ago: "check returns" leaves it for now
  items: [{ ...piece("t-shirt", "white", "white supima cotton crew-neck t-shirt"), price: 19.9 }],
};

/** The comparison: a seen item is the same as a closet candidate of the same type and color. */
function compare(prompt: string) {
  const closet = new Map<number, { type: string; color: string }>();
  for (const m of prompt.matchAll(/^(\d+): .*? \(([^,]+), ([^,]+),/gm)) closet.set(Number(m[1]), { type: m[2]!, color: m[3]! });
  const items = [...prompt.matchAll(/^(\d+)\. .*? \(([^,]+), ([^,]+),.*?compare with closet items: (.*)$/gm)].map((m) => {
    const ids = m[4] === "none" ? [] : m[4]!.split(", ").map(Number);
    const same = ids.filter((id) => closet.get(id)?.type === m[2] && closet.get(id)?.color === m[3]);
    return { seen: Number(m[1]), matches: same.map((item_id) => ({ item_id, similarity: "near_identical", reason: `same ${m[3]} ${m[2]}` })) };
  });
  return { items };
}

let textModelCalls = 0;
const answer = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }] }), {
    headers: { "Content-Type": "application/json" },
  });

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.endsWith("/chat/completions")) {
    const body = JSON.parse(String(init?.body));
    const last = body.messages.at(-1).content;
    const prompt: string = typeof last === "string" ? last : last.find((p: { type: string }) => p.type === "text").text;
    if (prompt.startsWith("First, image_kind")) {
      const next = extractions.shift();
      if (!next) throw new Error("smoke test: an extraction nobody scripted");
      return answer(next);
    }
    if (prompt.startsWith("This is a screenshot of an online clothing order")) return answer(ORDER);
    if (prompt.includes("Closet items:")) return answer(compare(prompt));
    if (body.response_format?.json_schema?.name === "actions") return answer({ actions: [] }); // the router: nothing in this script needs it
    textModelCalls++;
    throw new Error("smoke test: text model not stubbed for this call"); // callers fall back without it
  }
  if (url.includes("/photos/")) return new Response("not served in the smoke test", { status: 404 }); // comparisons go on without reference photos
  throw new Error(`smoke test: unexpected network call to ${url}`);
}) as typeof fetch;

// ---- the bot, on that database ----

const { addPhoto, db, getUser, photoUrl, sql } = await import("../src/store.ts");
const { seedDemo } = await import("../src/demo-seed.ts");
const { exactMatcher } = await import("../src/ingest.ts");
const flows = await import("../src/flows.ts");

// A 1×1 PNG stands in for every photo; the stubbed model decides what's "in" it.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

// The city's climate, so "what should I get rid of?" needs no weather service.
await db.query(
  `INSERT INTO city_climate (city, country_code, latitude, longitude, highs_c, lows_c) VALUES ($1, 'US', 42.28, -83.74, $2, $3) ON CONFLICT (city) DO NOTHING`,
  ["Ann Arbor, Michigan", JSON.stringify([0, 2, 8, 15, 22, 27, 29, 28, 24, 17, 9, 3]), JSON.stringify([-8, -7, -3, 3, 9, 15, 17, 16, 12, 6, 1, -5])],
);

const polo = piece("polo", "navy", "navy blue short-sleeve polo shirt", "warm");
const chinos = piece("pants", "beige", "beige straight-leg chinos");
const nikes = piece("sneakers", "black", "black nike running sneakers");
const sambas = piece("sneakers", "white", "white leather sneakers with gum sole");
const puffer = piece("puffer", "red", "red quilted puffer jacket", "cold");
const tee = piece("t-shirt", "gray", "light gray crew-neck t-shirt");
const sweats = piece("sweatpants", "gray", "gray puma sweatpants", "cold");
const quarterZip = piece("sweater", "gray", "heather gray quarter-zip sweater", "cold");
const jeans = piece("jeans", "black", "black straight-leg jeans");
const FIXTURE: Record<string, ModelItem[]> = {
  "PXL_20260701_1.jpg": [puffer, tee, sweats, nikes],
  "IMG-20260705-WA1.jpg": [quarterZip, jeans, sambas],
  "PXL_20260712_1.jpg": [polo, chinos, sambas],
  "Screenshot_1.png": [tee, jeans, nikes],
  "PXL_20260727_a.jpg": [polo, chinos],
  "PXL_20260727_b.jpg": [polo, chinos, sambas],
  "IMG-20260801-WA1.jpg": [puffer, sweats, nikes],
};
const { withCategory } = await import("../src/closet/extract.ts");

const seeded = await seedDemo(db, {
  userId: DEMO,
  files: Object.keys(FIXTURE),
  savePhoto: async (file) => ({ url: photoUrl(await addPhoto(DEMO, PNG, "image/png")), image: { url: `fixture:${file}` } }),
  extract: async (image) => ({ kind: "fit_check", items: FIXTURE[(image as { url: string }).url.slice("fixture:".length)]!.map((i) => withCategory(i as never)) }),
  matcher: () => exactMatcher,
});
console.log(`Seeded ${DEMO}: ${seeded.closet.length} items from ${seeded.photos.length} fit checks.\n`);

// ---- the demo, in order ----

let step = 0;
let failed = false;
const show = (r: unknown) => (typeof r === "string" ? r : `[photo: ${(r as { photo: string }).photo}]`);

async function run(label: string, send: () => Promise<{ replies: unknown[]; later?: () => Promise<unknown[]> }>) {
  step++;
  console.log(`── ${step}. You: ${label}`);
  try {
    const reply = await send();
    const all = [...reply.replies, ...(reply.later ? await reply.later() : [])];
    if (!all.length || all.every((r) => typeof r === "string" && !r.trim())) throw new Error("empty reply");
    for (const r of all) console.log(`   Bot: ${show(r).replace(/\n/g, "\n        ")}`);
  } catch (err) {
    failed = true;
    console.error(`   ✗ FAILED: ${err instanceof Error ? err.stack ?? err.message : err}`);
  }
  console.log();
}
const me = async () => (await getUser(DEMO))!;
const text = (t: string) => run(t, async () => flows.handleTextMessage(await me(), t));
const photo = (label: string, seen: (typeof extractions)[number]) =>
  run(`[${label}]`, async () => {
    extractions.push(seen);
    return flows.handlePhoto(await me(), PNG, "image/png");
  });

await text("show my closet");
await text("do I have this?");
await photo("photo of a navy polo in a store", { image_kind: "product", listing_title: null, items: [polo] });
await photo("screenshot of a Uniqlo order", { image_kind: "order_screenshot", listing_title: null, items: [] });
await text("check returns");
await text("return");
await text("what should I get rid of?");
await text("my impact");
await text("show my fit checks");
await text("help");

if (extractions.length) {
  failed = true;
  console.error(`✗ ${extractions.length} scripted photo reading(s) never used`);
}
console.log(textModelCalls ? `(${textModelCalls} text-model call(s) weren't stubbed; the bot fell back without them)` : "");
await sql.close();
await server.stop();
await pg.close();
if (failed) {
  console.error("SMOKE TEST FAILED");
  process.exit(1);
}
console.log(`Smoke test passed: ${step} steps, every one answered.`);
process.exit(0);
