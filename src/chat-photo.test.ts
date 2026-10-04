import { expect, test } from "bun:test";
import { Resvg } from "@resvg/resvg-js";
import { fitForChat, imageSize } from "./chat-photo.ts";

const png = (w: number, h: number) =>
  new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#888"/></svg>`).render().asPng();

test("photos within chat limits are sent as they are", () => {
  const ok = png(660, 3024);
  expect(imageSize(ok)).toEqual([660, 3024]);
  expect(fitForChat(ok, "image/png").image).toBe(ok);
});

test("a 50-megapixel photo is scaled down to fit", () => {
  const big = png(6144, 8160); // width + height over Telegram's 10,000
  const out = fitForChat(big, "image/png");
  expect(imageSize(out.image)).toEqual([1205, 1600]);
  expect(out.mimeType).toBe("image/png");
});
