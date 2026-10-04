import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import { describeKg } from "./footprint.ts";
import { money } from "./orders.ts";
import type { Recap } from "./recap.ts";

// The recap as a shareable image (1080×1350, portrait, like a story post):
// laid out with Satori (flexbox to SVG, no browser), rendered to PNG by resvg.
// Font: Inter (SIL Open Font License, assets/fonts/OFL.txt).

const W = 1080;
const H = 1350;
const C = { bg: "#F4EFE6", ink: "#1D1D1B", muted: "#6F6A61", line: "#E2DACB", card: "#FBF8F2", accent: "#2F6B4F" };

let fonts: { name: string; data: ArrayBuffer; weight: 400 | 600 | 800; style: "normal" }[] | undefined;
async function loadFonts() {
  fonts ??= await Promise.all(
    ([400, 600, 800] as const).map(async (weight) => ({
      name: "Inter",
      weight,
      style: "normal" as const,
      data: await Bun.file(new URL(`../assets/fonts/Inter-${weight}.ttf`, import.meta.url)).arrayBuffer(),
    })),
  );
  return fonts;
}

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
    { flexDirection: "column", flex: 1, background: C.card, borderRadius: 28, padding: "28px 30px", border: `2px solid ${C.line}` },
    text(value, { fontSize: 64, fontWeight: 800, lineHeight: 1 }),
    text(label, { fontSize: 26, color: C.muted, marginTop: 10 }),
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
          text(`≈ ${Math.round(r.co2Kg)} kg CO₂e`, { fontSize: 120, fontWeight: 800, color: C.accent, letterSpacing: -3, lineHeight: 1 }),
          text(`saved by not buying new · ${describeKg(r.co2Kg).replace(/^≈ \d+ kg CO₂e \(about (.*)\)$/, "about $1")}`, {
            fontSize: 30,
            color: C.muted,
            marginTop: 14,
          }),
        )
      : h(
          "div",
          { flexDirection: "column" },
          text(`${r.fitChecks} fit check${r.fitChecks === 1 ? "" : "s"}`, { fontSize: 120, fontWeight: 800, letterSpacing: -3, lineHeight: 1 }),
          text("and every piece remembered", { fontSize: 30, color: C.muted, marginTop: 14 }),
        );

  const third = r.moneyBack > 0 ? tile(money(r.moneyBack), "back from returns and sales") : tile(String(r.skipped), r.skipped === 1 ? "purchase skipped" : "purchases skipped");

  // The favorite in each category, two by two, each photo cropped to where that kind of item sits.
  const favorite = (f: Recap["favorites"][number]) => {
    const photo = f.photoUrl ? photos[f.photoUrl] : null;
    const usable = photo && /^image\/(png|jpe?g)$/.test(photo.mimeType);
    return h(
      "div",
      { width: 450, height: 190, background: C.card, borderRadius: 24, border: `2px solid ${C.line}`, overflow: "hidden" },
      usable
        ? {
            type: "img",
            props: {
              src: `data:${photo!.mimeType};base64,${photo!.base64}`,
              width: 142,
              height: 190,
              style: { objectFit: "cover", objectPosition: FOCUS[f.category] ?? "center" },
            },
          }
        : null,
      h(
        "div",
        { flexDirection: "column", justifyContent: "center", padding: "0 24px", flex: 1 },
        text(LABELS[f.category] ?? f.category.toUpperCase(), { fontSize: 18, fontWeight: 600, letterSpacing: 3, color: C.muted }),
        text(f.description, { fontSize: 26, fontWeight: 800, marginTop: 8, lineHeight: 1.15 }),
        text(`worn ${f.wears}×`, { fontSize: 22, color: C.accent, fontWeight: 600, marginTop: 8 }),
      ),
    );
  };
  const mostWorn = r.favorites.length
    ? h(
        "div",
        { flexDirection: "column", gap: 16 },
        text("MOST WORN", { fontSize: 22, fontWeight: 600, letterSpacing: 4, color: C.muted }),
        h("div", { flexWrap: "wrap", gap: 20 }, ...r.favorites.map(favorite)),
      )
    : null;

  const shown = r.ghosts.slice(0, 3);
  const fresh =
    !r.ghosts.length && r.newItems
      ? h(
          "div",
          { flexDirection: "column" },
          text("NEW IN YOUR CLOSET", { fontSize: 22, fontWeight: 600, letterSpacing: 4, color: C.muted }),
          text(`${r.newItems} piece${r.newItems === 1 ? "" : "s"} logged from your fit checks`, { fontSize: 32, marginTop: 12 }),
          text("Every one of them counts toward what you already own.", { fontSize: 26, color: C.muted, marginTop: 8 }),
        )
      : null;
  const ghosts = r.ghosts.length
    ? h(
        "div",
        { flexDirection: "column" },
        text("DIDN'T GET WORN", { fontSize: 22, fontWeight: 600, letterSpacing: 4, color: C.muted }),
        text(shown.join(" · ") + (r.ghosts.length > shown.length ? ` · +${r.ghosts.length - shown.length} more` : ""), {
          fontSize: 32,
          marginTop: 12,
          lineHeight: 1.3,
        }),
        text("Wear it, or let it go to someone who will.", { fontSize: 26, color: C.muted, marginTop: 8 }),
      )
    : null;

  const card = h(
    "div",
    { width: W, height: H, background: C.bg, color: C.ink, fontFamily: "Inter", flexDirection: "column", padding: "64px 80px", gap: 36 },
    h(
      "div",
      { justifyContent: "space-between", alignItems: "center" },
      text("SECOND THOUGHT", { fontSize: 24, fontWeight: 800, letterSpacing: 6 }),
      text(r.title, { fontSize: 28, color: C.muted, fontWeight: 600 }),
    ),
    hero,
    h("div", { gap: 20 }, tile(String(r.fitChecks), r.fitChecks === 1 ? "fit check" : "fit checks"), tile(`${r.itemsWorn}/${r.closetSize}`, "pieces worn"), third),
    mostWorn,
    ghosts ?? fresh,
    h(
      "div",
      { flexDirection: "column", marginTop: "auto", borderTop: `2px solid ${C.line}`, paddingTop: 28 },
      text("The most sustainable clothes are the ones you already own.", { fontSize: 30, fontWeight: 600 }),
      text("CO₂ is an estimate: Carbonfact category averages; driving from the EPA.", { fontSize: 20, color: C.muted, marginTop: 10 }),
    ),
  );

  const svg = await satori(card as any, { width: W, height: H, fonts: await loadFonts() });
  return new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
}
