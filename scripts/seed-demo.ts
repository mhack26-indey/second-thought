// Seeds the demo user on the database in DATABASE_URL from the real outfit
// photos in demo_images/: each one goes through the same extraction and
// dedup as a live fit check, dated so they span the last three weeks. Adds
// the unworn Zara jacket, a storage location and one earlier skipped purchase
// (src/demo-seed.ts). Wipes and recreates only that user's data, so it's safe
// to rerun before every rehearsal. Run it against a Neon branch, not
// production (README, "Demo data").
//
// Usage: DEMO_PHONE=+15551234567 bun run seed:demo [--skip a.jpg,b.jpg] [--dry-run]
//   DEMO_PHONE  the demo phone's iMessage id, exactly as the bot sees it (+1 and 10 digits, or an email)
//   DEMO_NAME, DEMO_CITY  optional (default Sam, Ann Arbor, Michigan)
//   --skip      leave these photos out (comma-separated filenames)
//   --dry-run   list the photos and dates that would be ingested; no database, no vision calls

import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { parseArgs } from "node:util";
import { today } from "../src/closet/dates.ts";
import { type ImageInput, type MediaType, isSupportedImageFile } from "../src/closet/vlm.ts";
import { scheduleDemoPhotos } from "../src/demo-seed.ts";

const DIR = "demo_images";
const MIME: Record<string, MediaType> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

const { values: args } = parseArgs({
  options: { skip: { type: "string", default: "" }, "dry-run": { type: "boolean", default: false } },
});
const skip = new Set(args.skip.split(",").map((s) => s.trim()).filter(Boolean));
const all = (await readdir(DIR).catch(() => [] as string[])).filter(isSupportedImageFile).sort();
const unknown = [...skip].filter((s) => !all.includes(s));
if (unknown.length) console.warn(`--skip: not in ${DIR}/: ${unknown.join(", ")}`);
const files = all.filter((f) => !skip.has(f));
if (!files.length) {
  console.error(`No photos to ingest in ${DIR}/ (see ${DIR}/README.md).`);
  process.exit(1);
}

if (args["dry-run"]) {
  console.log(`Would ingest ${files.length} photo${files.length === 1 ? "" : "s"}${all.length > files.length ? `, skipping ${all.length - files.length}` : ""}:`);
  for (const p of scheduleDemoPhotos(files, today())) {
    console.log(`  ${p.takenOn}  ${p.file}${p.shotOn ? `  (taken ${p.shotOn})` : "  (undated)"}`);
  }
  process.exit(0);
}

const userId = process.env.DEMO_PHONE?.trim();
if (!userId) {
  console.error("Set DEMO_PHONE to the demo phone's iMessage id, e.g. DEMO_PHONE=+15551234567 bun run seed:demo");
  process.exit(1);
}

const { addPhoto, db, photoAt, photoUrl, sql } = await import("../src/store.ts"); // connects and migrates
const { seedDemo } = await import("../src/demo-seed.ts");
const { PUBLIC_URL } = await import("../src/config.ts");

const started = Date.now();
const result = await seedDemo(db, {
  userId,
  name: process.env.DEMO_NAME?.trim() || undefined,
  city: process.env.DEMO_CITY?.trim() || undefined,
  files,
  savePhoto: async (file) => {
    const bytes = await readFile(join(DIR, file));
    const mediaType = MIME[extname(file).toLowerCase()] ?? "image/jpeg";
    const url = photoUrl(await addPhoto(userId, bytes, mediaType));
    return { url, image: { base64: bytes.toString("base64"), mediaType } };
  },
  // Earlier photos come straight from the database, so the web server needn't be running.
  loadPhoto: async (url): Promise<ImageInput> => {
    const photo = await photoAt(url);
    if (!photo) throw new Error(`no stored photo at ${url}`);
    return { base64: Buffer.from(photo.image).toString("base64"), mediaType: photo.mimeType as MediaType };
  },
  onPhoto: (photo, replies, kind) => {
    const said = replies.map((r) => (typeof r === "string" ? r : "[photo]")).join(" ");
    console.log(`${photo.takenOn}  ${photo.file}${kind === "fit_check" ? "" : `  [model said ${kind}]`}\n            ${said}`);
  },
});

console.log(`\nCloset for ${userId} (${result.closet.length} items, ${result.photos.length} fit checks, ${((Date.now() - started) / 1000).toFixed(0)}s):`);
const width = Math.max(...result.closet.map((r) => r.description.length));
for (const row of result.closet) {
  const where = row.photos.length ? row.photos.join(", ") : "not in any fit check";
  console.log(`  ${row.description.padEnd(width)}  ${row.category.padEnd(9)}  ${String(row.wears).padStart(2)}x  ${where}`);
}
console.log(`\nStored in the under-bed bin: ${result.stored ?? "nothing (no outerwear was found)"}`);
console.log(`Earlier skipped purchase: ${result.skipped ?? "none (no items were found)"}`);
console.log(`Unworn Zara order: green cropped utility jacket ("check returns" nudges it)`);
if (result.misread.length) {
  console.warn(`Ingested as fit checks although the model said otherwise: ${result.misread.map((m) => `${m.file} (${m.kind})`).join(", ")}`);
}
console.log(`Wardrobe page: ${PUBLIC_URL}/w/${result.webToken}`);

// What the bot would say to the two recommendation texts, from this closet and profile.
const { demoReplies } = await import("../src/demo-seed.ts");
const { climateFor } = await import("../src/climate.ts");
const { exactGroups, llmGroups } = await import("../src/match.ts");
const city = process.env.DEMO_CITY?.trim() || "Ann Arbor, Michigan";
const climate = await climateFor(db, city).catch((err) => {
  console.warn(`No climate for ${city} (${err}); seasonal picks are skipped.`);
  return undefined;
});
const replies = await demoReplies(db, userId, { climate, groups: (wears) => llmGroups(wears).catch(() => exactGroups) });
const show = (r: unknown) => (typeof r === "string" ? r : `[photo: ${(r as { photo: string }).photo}]`);
console.log(`\n> what should I buy for winter?\n${replies.buy}`);
console.log(`\n> what should I get rid of?\n${replies.declutter.map(show).join("\n")}`);
await sql.close();
process.exit(0);
