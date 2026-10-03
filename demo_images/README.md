# Demo photos

Real outfit photos for the demo closet (`bun run seed:demo`) and the accuracy eval (`bun run eval:closet`). The photos are ignored by git; only this README and `labels.json` are checked in. Use photos you took or have permission to use. One person wearing repeat pieces across days is the point: it's what the dedup has to get right.

## How the seed uses them

Every image here (`.jpg`, `.jpeg`, `.png`, `.webp`, `.heic`) goes through the same extraction and dedup as a live fit check, oldest first. Leave some out with `--skip a.jpg,b.jpg`; `--dry-run` lists what would be ingested, with dates, without calling the model.

Fit check dates come from the filename, then get squeezed into the last 21 days with their order kept:

- `PXL_20260727_...` (Pixel) and `IMG-20251214-WA...` (WhatsApp) carry the day the photo was taken. Photos from the same day stay on the same day.
- Anything else counts as undated (screenshots carry the day of the screenshot, not of the outfit) and is spaced evenly between the dated ones.

## labels.json

Hand labels for the eval: for each photo, the clothing items in it, each with a label that's shared across photos only when it's confidently the same physical item (`navy-polo`, `red-puffer`). `"unsure": true` marks an appearance that might be a different item; the eval leaves those out of merge and shopping scoring. Items outside the closet vocabulary (ties, lanyards) and anything cropped or hidden aren't labeled.

When you add or replace photos, update `labels.json` too, or the eval warns that a photo is unlabeled and leaves it out.
