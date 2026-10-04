import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import { describeKg } from "./footprint.ts";
import { money } from "./orders.ts";
import type { Recap } from "./recap.ts";

// The recap as a shareable image (1080×1350, portrait, like a story post):
// laid out with Satori (flexbox to SVG, no browser), rendered to PNG by resvg.
// Styled to docs/design-system.md: a primary-gradient rounded panel (the
// testimonial card), Merriweather 700 for figures and titles, Inter 400 for
// everything else. Fonts: SIL Open Font License (assets/fonts/OFL.txt,
// assets/fonts/Merriweather-OFL.txt).

const W = 1080;
const H = 1350;
const C = {
  bg: "#f5fcef",
  bgDim: "#ebf2e5",
  primary: "#a1cc80",
  secondary: "#95e8cf",
  darker: "#789960",
  superdark: "#506640",
  ink: "#25400c", // --neutral: dark green text on primary
  muted: "#506640",
  card: "rgba(245, 252, 239, 0.82)",
};
const SERIF = "Merriweather";
const SANS = "Inter";

let fonts: { name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" }[] | undefined;
async function loadFonts() {
  const file = (name: string) => Bun.file(new URL(`../assets/fonts/${name}`, import.meta.url)).arrayBuffer();
  fonts ??= [
    { name: SANS, weight: 400, style: "normal", data: await file("Inter-400.ttf") },
    { name: SERIF, weight: 700, style: "normal", data: await file("Merriweather-700.woff") },
    // Glyphs Merriweather's Latin subset lacks (₂, ≈) fall back to Inter.
    { name: SANS, weight: 700, style: "normal", data: await file("Inter-800.ttf") },
  ];
  return fonts;
}
const serif = { fontFamily: SERIF, fontWeight: 700 };

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
    { flexDirection: "column", flex: 1, background: C.card, borderRadius: 32, padding: "28px 30px" },
    text(value, { ...serif, fontSize: 60, lineHeight: 1 }),
    text(label, { fontSize: 26, color: C.muted, marginTop: 12 }),
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
          text(`≈ ${Math.round(r.co2Kg)} kg CO₂e`, { ...serif, fontSize: 96, color: C.ink, letterSpacing: -2, lineHeight: 1.05 }),
          text(`saved by not buying new · ${describeKg(r.co2Kg).replace(/^≈ \d+ kg CO₂e \(about (.*)\)$/, "about $1")}`, {
            fontSize: 30,
            color: C.muted,
            marginTop: 14,
          }),
        )
      : h(
          "div",
          { flexDirection: "column" },
          text(`${r.fitChecks} fit check${r.fitChecks === 1 ? "" : "s"}`, { ...serif, fontSize: 96, letterSpacing: -2, lineHeight: 1.05 }),
          text("and every piece remembered", { fontSize: 30, color: C.muted, marginTop: 14 }),
        );

  const third = r.moneyBack > 0 ? tile(money(r.moneyBack), "back from returns and sales") : tile(String(r.skipped), r.skipped === 1 ? "purchase skipped" : "purchases skipped");

  // The favorite in each category, two by two, each photo cropped to where that kind of item sits.
  const favorite = (f: Recap["favorites"][number]) => {
    const photo = f.photoUrl ? photos[f.photoUrl] : null;
    const usable = photo && /^image\/(png|jpe?g)$/.test(photo.mimeType);
    return h(
      "div",
      { width: 432, height: 176, background: C.card, borderRadius: 16, overflow: "hidden" },
      usable
        ? {
            type: "img",
            props: {
              src: `data:${photo!.mimeType};base64,${photo!.base64}`,
              width: 132,
              height: 176,
              style: { objectFit: "cover", objectPosition: FOCUS[f.category] ?? "center" },
            },
          }
        : null,
      h(
        "div",
        { flexDirection: "column", justifyContent: "center", padding: "0 24px", flex: 1 },
        text(LABELS[f.category] ?? f.category.toUpperCase(), { fontSize: 18, letterSpacing: 3, color: C.muted }),
        text(f.description, { ...serif, fontSize: 24, marginTop: 8, lineHeight: 1.25 }),
        h("div", { marginTop: 10 }, text(`worn ${f.wears}×`, { fontSize: 20, color: C.ink, background: C.primary, borderRadius: 999, padding: "4px 16px" })),
      ),
    );
  };
  const mostWorn = r.favorites.length
    ? h(
        "div",
        { flexDirection: "column", gap: 16 },
        text("MOST WORN", { fontSize: 22, letterSpacing: 4, color: C.muted }),
        h("div", { flexWrap: "wrap", gap: 20 }, ...r.favorites.map(favorite)),
      )
    : null;

  const shown = r.ghosts.slice(0, 3);
  const fresh =
    !r.ghosts.length && r.newItems
      ? h(
          "div",
          { flexDirection: "column" },
          text("NEW IN YOUR CLOSET", { fontSize: 22, letterSpacing: 4, color: C.muted }),
          text(`${r.newItems} piece${r.newItems === 1 ? "" : "s"} logged from your fit checks`, { fontSize: 32, marginTop: 12 }),
          text("Every one of them counts toward what you already own.", { fontSize: 26, color: C.muted, marginTop: 8 }),
        )
      : null;
  const ghosts = r.ghosts.length
    ? h(
        "div",
        { flexDirection: "column" },
        text("DIDN'T GET WORN", { fontSize: 22, letterSpacing: 4, color: C.muted }),
        text(shown.join(" · ") + (r.ghosts.length > shown.length ? ` · +${r.ghosts.length - shown.length} more` : ""), {
          fontSize: 32,
          marginTop: 12,
          lineHeight: 1.3,
        }),
        text("Wear it, or let it go to someone who will.", { fontSize: 26, color: C.muted, marginTop: 8 }),
      )
    : null;

  // A mint page with the gradient panel on it, rounded like a testimonial card.
  const panel = h(
    "div",
    {
      flex: 1,
      flexDirection: "column",
      gap: 24,
      padding: "46px 60px 40px",
      borderRadius: 48,
      backgroundImage: `linear-gradient(150deg, ${C.primary} 0%, ${C.secondary} 100%)`,
      boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
    },
    h(
      "div",
      { justifyContent: "space-between", alignItems: "center" },
      text("Second Thought", { ...serif, fontSize: 30 }),
      text(r.title, { fontSize: 28, color: C.muted }),
    ),
    hero,
    h("div", { gap: 20 }, tile(String(r.fitChecks), r.fitChecks === 1 ? "fit check" : "fit checks"), tile(`${r.itemsWorn}/${r.closetSize}`, "pieces worn"), third),
    mostWorn,
    ghosts ?? fresh,
    h(
      "div",
      { flexDirection: "column", marginTop: "auto", borderTop: `2px solid rgba(37, 64, 12, 0.18)`, paddingTop: 22 },
      text("“The most sustainable garment is the one already in your wardrobe.”", { ...serif, fontSize: 24, lineHeight: 1.35 }),
      text("— Orsola de Castro, co-founder of Fashion Revolution", { fontSize: 22, color: C.muted, marginTop: 8 }),
      text("CO₂ is an estimate: Carbonfact category averages; driving from the EPA.", { fontSize: 20, color: C.muted, marginTop: 10 }),
    ),
  );
  const card = h("div", { width: W, height: H, background: C.bg, color: C.ink, fontFamily: SANS, padding: 36 }, panel);

  const svg = await satori(card as any, { width: W, height: H, fonts: await loadFonts() });
  return new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
}
