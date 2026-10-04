import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import { describeKg } from "./footprint.ts";
import { money } from "./orders.ts";
import type { Recap } from "./recap.ts";

// The recap as a shareable image (1080×1350, portrait, like a story post):
// laid out with Satori (flexbox to SVG, no browser), rendered to PNG by resvg.
// Styled to docs/DESIGN-nike.md: white canvas, one towering uppercase display
// figure, flat soft-gray tiles, photos staged on gray, black pills. Fonts (SIL
// Open Font License, assets/fonts): Bebas Neue for display, Inter 400/500.

const W = 1080;
const H = 1350;
const C = { canvas: "#ffffff", cloud: "#f5f5f5", ink: "#111111", charcoal: "#39393b", mute: "#707072", hairline: "#e5e5e5" };
const DISPLAY = "Bebas Neue";
const SANS = "Inter";

let fonts: { name: string; data: ArrayBuffer; weight: 400 | 500; style: "normal" }[] | undefined;
async function loadFonts() {
  const file = (name: string) => Bun.file(new URL(`../assets/fonts/${name}`, import.meta.url)).arrayBuffer();
  fonts ??= [
    { name: SANS, weight: 400, style: "normal", data: await file("Inter-400.ttf") }, // full glyph set: ₂, ≈, “ ”
    { name: SANS, weight: 500, style: "normal", data: await file("Inter-500.woff") },
    { name: DISPLAY, weight: 400, style: "normal", data: await file("BebasNeue-400.woff") },
  ];
  return fonts;
}
const display = { fontFamily: DISPLAY, fontWeight: 400, lineHeight: 0.9 };
const medium = { fontWeight: 500 };

// Where an item usually is in a full-length outfit photo.
const FOCUS: Record<string, string> = {
  shoes: "center 92%",
  bottom: "center 70%",
  dress: "center 45%",
  top: "center 30%",
  outerwear: "center 30%",
  accessory: "center 25%",
  jewelry: "center 25%",
};

type Node = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, ...children: (Node | string | null | false)[]): Node => ({
  type,
  props: { style: { display: "flex", ...style }, children: children.filter((c) => c !== null && c !== false) },
});
const text = (s: string, style: Record<string, unknown> = {}) => h("div", style, s);

function tile(value: string, label: string): Node {
  return h(
    "div",
    { flexDirection: "column", flex: 1, background: C.cloud, padding: "24px 26px 22px" },
    text(value, { ...display, fontSize: 84 }),
    text(label, { ...medium, fontSize: 24, color: C.mute, marginTop: 10 }),
  );
}

/** A photo the renderer can embed: PNG or JPEG only (resvg doesn't read HEIC or WebP). */
export type CardPhoto = { base64: string; mimeType: string };

const LABELS: Record<string, string> = {
  top: "TOPS",
  bottom: "BOTTOMS",
  outerwear: "OUTERWEAR",
  shoes: "SHOES",
  dress: "DRESSES",
  accessory: "ACCESSORIES",
  jewelry: "JEWELRY",
};

/** `photos` maps each favorite's photo URL to its image. */
export async function recapPng(r: Recap, photos: Record<string, CardPhoto> = {}): Promise<Uint8Array> {
  const hero =
    r.co2Kg > 0
      ? h(
          "div",
          { flexDirection: "column" },
          h("div", { alignItems: "flex-end", gap: 24 }, text(`${Math.round(r.co2Kg)}`, { ...display, fontSize: 220 }), text("KG CO2E SAVED", { ...display, fontSize: 76, marginBottom: 18 })),
          text(`by not buying new · ${describeKg(r.co2Kg).replace(/^≈ \d+ kg CO₂e \(about (.*)\)$/, "about $1")}`, { ...medium, fontSize: 28, color: C.mute, marginTop: 4 }),
        )
      : h(
          "div",
          { flexDirection: "column" },
          h("div", { alignItems: "flex-end", gap: 24 }, text(String(r.fitChecks), { ...display, fontSize: 220 }), text(r.fitChecks === 1 ? "FIT CHECK" : "FIT CHECKS", { ...display, fontSize: 76, marginBottom: 18 })),
          text("and every piece remembered", { ...medium, fontSize: 28, color: C.mute, marginTop: 4 }),
        );

  const third = r.moneyBack > 0 ? tile(money(r.moneyBack), "back from returns and sales") : tile(String(r.skipped), r.skipped === 1 ? "purchase skipped" : "purchases skipped");

  const label = (s: string) => text(s, { ...medium, fontSize: 22, letterSpacing: 3, color: C.mute });

  // The favorite in each category, two by two: the photo staged on gray, cropped to where that kind of item sits.
  const favorite = (f: Recap["favorites"][number]) => {
    const photo = f.photoUrl ? photos[f.photoUrl] : null;
    const usable = photo && /^image\/(png|jpe?g)$/.test(photo.mimeType);
    return h(
      "div",
      { width: 448, height: 156, gap: 20, alignItems: "center" },
      h(
        "div",
        { width: 124, height: 156, background: C.cloud, overflow: "hidden" },
        usable
          ? {
              type: "img",
              props: {
                src: `data:${photo!.mimeType};base64,${photo!.base64}`,
                width: 124,
                height: 156,
                style: { objectFit: "cover", objectPosition: FOCUS[f.category] ?? "center" },
              },
            }
          : null,
      ),
      h(
        "div",
        { flexDirection: "column", flex: 1 },
        text(LABELS[f.category] ?? f.category.toUpperCase(), { ...medium, fontSize: 18, letterSpacing: 3, color: C.mute }),
        text(f.description, { ...medium, fontSize: 26, marginTop: 6, lineHeight: 1.2 }),
        h("div", { marginTop: 12 }, text(`WORN ${f.wears}×`, { ...medium, fontSize: 18, letterSpacing: 1, color: C.canvas, background: C.ink, borderRadius: 999, padding: "6px 16px" })),
      ),
    );
  };
  const mostWorn = r.favorites.length
    ? h("div", { flexDirection: "column", gap: 16 }, label("MOST WORN"), h("div", { flexWrap: "wrap", gap: 20 }, ...r.favorites.map(favorite)))
    : null;

  const shown = r.ghosts.slice(0, 3);
  const fresh =
    !r.ghosts.length && r.newItems
      ? h(
          "div",
          { flexDirection: "column" },
          label("NEW IN YOUR CLOSET"),
          text(`${r.newItems} piece${r.newItems === 1 ? "" : "s"} logged from your fit checks`, { ...medium, fontSize: 32, marginTop: 12 }),
          text("Every one of them counts toward what you already own.", { fontSize: 26, color: C.mute, marginTop: 8 }),
        )
      : null;
  const ghosts = r.ghosts.length
    ? h(
        "div",
        { flexDirection: "column" },
        label("DIDN'T GET WORN"),
        text(shown.join(" · ") + (r.ghosts.length > shown.length ? ` · +${r.ghosts.length - shown.length} more` : ""), {
          ...medium,
          fontSize: 32,
          marginTop: 12,
          lineHeight: 1.3,
        }),
        text("Wear it, or let it go to someone who will.", { fontSize: 26, color: C.mute, marginTop: 8 }),
      )
    : null;

  const card = h(
    "div",
    { width: W, height: H, background: C.canvas, color: C.ink, fontFamily: SANS, flexDirection: "column", padding: "44px 72px 40px", gap: 26 },
    h(
      "div",
      { justifyContent: "space-between", alignItems: "center", paddingBottom: 22, borderBottom: `2px solid ${C.hairline}` },
      text("SECOND THOUGHT", { ...display, fontSize: 44, letterSpacing: 1 }),
      text(r.title, { ...medium, fontSize: 26, color: C.mute }),
    ),
    hero,
    h("div", { gap: 12 }, tile(String(r.fitChecks), r.fitChecks === 1 ? "fit check" : "fit checks"), tile(`${r.itemsWorn}/${r.closetSize}`, "pieces worn"), third),
    mostWorn,
    ghosts ?? fresh,
    h(
      "div",
      { flexDirection: "column", marginTop: "auto", borderTop: `2px solid ${C.hairline}`, paddingTop: 22 },
      text("“The most sustainable garment is the one already in your wardrobe.”", { ...medium, fontSize: 24, lineHeight: 1.35 }),
      text("— Orsola de Castro, co-founder of Fashion Revolution", { fontSize: 21, color: C.mute, marginTop: 6 }),
      text("CO₂ is an estimate: Carbonfact category averages; driving from the EPA.", { fontSize: 19, color: C.mute, marginTop: 8 }),
    ),
  );

  const svg = await satori(card as any, { width: W, height: H, fonts: await loadFonts() });
  return new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
}
