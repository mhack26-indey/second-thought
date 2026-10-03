// Seeds the demo user on the database in DATABASE_URL: three weeks of fit
// checks (photos from demo_images/), the unworn Zara jacket, a coat in
// storage and one earlier skipped purchase (see src/demo-seed.ts). Wipes and
// recreates only that user's data, so it's safe to rerun before every
// rehearsal. Run it against a Neon branch, not production (README, "Demo data").
//
// Usage: DEMO_PHONE=+15551234567 bun run seed:demo
//   DEMO_PHONE  the demo phone's iMessage id, exactly as the bot sees it (+1 and 10 digits, or an email)
//   DEMO_NAME, DEMO_CITY  optional (default Sam, Ann Arbor, Michigan)

import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { isSupportedImageFile } from "../src/closet/vlm.ts";

const userId = process.env.DEMO_PHONE?.trim();
if (!userId) {
  console.error("Set DEMO_PHONE to the demo phone's iMessage id, e.g. DEMO_PHONE=+15551234567 bun run seed:demo");
  process.exit(1);
}

const { addPhoto, db, photoUrl, sql } = await import("../src/store.ts"); // connects and migrates
const { seedDemo } = await import("../src/demo-seed.ts");
const { PUBLIC_URL } = await import("../src/config.ts");

const DIR = "demo_images";
const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
};
const files = (await readdir(DIR).catch(() => [] as string[])).filter(isSupportedImageFile);

const result = await seedDemo(db, {
  userId,
  name: process.env.DEMO_NAME?.trim() || undefined,
  city: process.env.DEMO_CITY?.trim() || undefined,
  // fit-01.jpg, fit-01.heic... whichever is there
  savePhoto: async (name) => {
    const file = files.find((f) => f.slice(0, -extname(f).length) === name);
    if (!file) return null;
    const mimeType = MIME[extname(file).toLowerCase()] ?? "image/jpeg";
    return photoUrl(await addPhoto(userId, await readFile(join(DIR, file)), mimeType));
  },
});

console.log(`Seeded ${userId}: ${result.outfits} fit checks, ${result.items} items, 1 Zara order, 1 skipped purchase.`);
console.log(`Wardrobe page: ${PUBLIC_URL}/w/${result.webToken}`);
if (result.missingPhotos.length) {
  console.warn(
    `No photo in ${DIR}/ for ${result.missingPhotos.join(", ")}: those fit checks have no photo, so the vision model ` +
      `compares against descriptions only. See ${DIR}/README.md.`,
  );
}
await sql.close();
process.exit(0);
