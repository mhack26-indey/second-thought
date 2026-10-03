// Runs extraction on every image in test_images/ and prints the JSON so it can
// be checked by hand. Usage: bun scripts/extract-test-images.ts [dir]

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { extractItems } from "../src/closet/extract.ts";
import { imageFromFile, isSupportedImageFile } from "../src/closet/vlm.ts";

const dir = process.argv[2] ?? "test_images";
const files = (await readdir(dir)).filter(isSupportedImageFile).sort();

if (files.length === 0) {
  console.error(`No .jpg/.jpeg/.png/.gif/.webp images found in ${dir}/`);
  process.exit(1);
}

let failures = 0;
for (const file of files) {
  const started = Date.now();
  try {
    const items = await extractItems(await imageFromFile(join(dir, file)));
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`\n=== ${file} (${items.length} items, ${secs}s) ===`);
    console.log(JSON.stringify(items, null, 2));
  } catch (err) {
    failures++;
    console.error(`\n=== ${file} FAILED ===\n${err}`);
  }
}

console.log(`\nDone: ${files.length - failures}/${files.length} succeeded.`);
