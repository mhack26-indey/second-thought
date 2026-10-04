import { buildRecap, recapText } from "./recap.ts";
import { type CardPhoto, recapPng } from "./recap-card.ts";
import { db, photoAt } from "./store.ts";

// Makes a user's recap for a period: the card (PNG) and the same numbers as
// text. Used by "my recap", the monthly send, and the wardrobe page.

/** The recap card (PNG) and its text for a period; the card is skipped if it can't be drawn. */
export async function recapFor(userId: string, period: { from: string; to: string; title: string }, name?: string | null) {
  const recap = await buildRecap(db, userId, period.from, period.to, period.title);
  let card: Uint8Array | undefined;
  try {
    const photos: Record<string, CardPhoto> = {};
    for (const f of recap.favorites) {
      if (!f.photoUrl || photos[f.photoUrl]) continue;
      const photo = await photoAt(f.photoUrl);
      if (photo) photos[f.photoUrl] = { base64: Buffer.from(photo.image).toString("base64"), mimeType: photo.mimeType };
    }
    card = await recapPng(recap, photos);
  } catch (err) {
    console.error(`recap card for ${userId} failed`, err);
  }
  return { card, summary: name ? `Here's your recap, ${name}.\n${recapText(recap)}` : recapText(recap) };
}

