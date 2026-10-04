import { Resvg } from "@resvg/resvg-js";

// Photos sent back into a chat (match photos) must fit messaging limits:
// Telegram rejects a photo whose width + height is over 10,000 pixels or
// that's more than 20 times as tall as wide, and 50-megapixel phone photos
// (6144×8160) go over. Only those are scaled down (to 1600 on the long side,
// as a PNG) with resvg, already used for the recap card, so no image library
// is needed; everything else is sent as it is.

const MAX_SIDE = 1600;
const fits = (w: number, h: number) => w + h <= 10_000 && Math.max(w, h) / Math.min(w, h) <= 20;

/** Width and height from a PNG or JPEG header, or null. */
export function imageSize(b: Uint8Array): [number, number] | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b.length > 24) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return [v.getUint32(16), v.getUint32(20)];
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1]!;
      const length = (b[i + 2]! << 8) | b[i + 3]!;
      // Start-of-frame markers carry the size (not DHT c4, JPG c8, DAC cc).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return [(b[i + 7]! << 8) | b[i + 8]!, (b[i + 5]! << 8) | b[i + 6]!];
      }
      i += 2 + length;
    }
  }
  return null;
}

/** The photo as-is if it fits chat limits, else scaled down to MAX_SIDE as a PNG. */
export function fitForChat(image: Uint8Array, mimeType: string): { image: Uint8Array; mimeType: string } {
  const size = imageSize(image);
  if (!size) return { image, mimeType };
  const [w, h] = size;
  if (fits(w, h)) return { image, mimeType };
  const scale = MAX_SIDE / Math.max(w, h);
  const [sw, sh] = [Math.round(w * scale), Math.round(h * scale)];
  const href = `data:${mimeType};base64,${Buffer.from(image).toString("base64")}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${sh}"><image href="${href}" width="${sw}" height="${sh}"/></svg>`;
  return { image: new Resvg(svg).render().asPng(), mimeType: "image/png" };
}
