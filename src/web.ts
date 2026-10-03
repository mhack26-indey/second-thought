import QRCode from "qrcode";
import { CATEGORIES, type Category } from "./closet/categories.ts";
import { cityFrom, findCities } from "./cities.ts";
import { PORT, PUBLIC_URL } from "./config.ts";
import { addItemToOutfit, linkItem, mergeItems, unlinkItem } from "./fit-edits.ts";
import { itemFromName } from "./llm.ts";
import { exactGroups, llmGroups, mostAlike } from "./match.ts";
import { type Impact, impactSummary } from "./impact.ts";
import {
  type Item,
  type Outfit,
  type Reminder,
  type User,
  db,
  getOutfit,
  getPhoto,
  getUserByToken,
  impactFor,
  listItems,
  listOutfits,
  listWears,
  pendingReminders,
  updateUser,
} from "./store.ts";

// Wardrobe page, one per user at /w/<token>. The token is random so the URL
// doesn't expose a phone number and can't be guessed. Whoever has the link can
// view the closet and edit the profile, same as texting from that number.

export function wardrobeUrl(user: User): string {
  return `${PUBLIC_URL}/w/${user.webToken}`;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const hourLabel = (hour: number) => `${hour % 12 || 12}${hour < 12 ? "am" : "pm"}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const MAX_FIELD = 60;

const fmtDate = (at: number) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const fmtWhen = (at: number) =>
  new Date(at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const SECTION_TITLES: Record<Category, string> = {
  top: "tops",
  bottom: "bottoms",
  dress: "dresses",
  outerwear: "outerwear",
  shoes: "shoes",
  accessory: "accessories",
  jewelry: "jewelry",
};

const STYLE = `  :root { color-scheme: light dark; --muted: #888; --line: #8883; }
  body { font: 16px/1.4 -apple-system, system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  .sub { color: var(--muted); margin: 0 0 24px; }
  .impact { font-size: 18px; font-weight: 600; margin: 0 0 4px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 28px 0 8px; }
  h2 span { font-weight: normal; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); }
  li small { color: var(--muted); }
  time { color: var(--muted); white-space: nowrap; font-size: 14px; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px 10px; }
  figure { margin: 0; min-width: 0; scroll-margin-top: 16px; }
  img { width: 100%; aspect-ratio: 3/4; object-fit: cover; border-radius: 8px; background: var(--line); }
  figcaption { font-size: 12px; color: var(--muted); text-align: center; margin: 4px 0 2px; }
  .found li { display: block; padding: 3px 0; border: 0; font-size: 13px; line-height: 1.3; }
  .found a, .thumbs a { color: inherit; }
  .thumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 6px; padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; text-align: left; }
  li.has-photos { cursor: pointer; }
  li.has-photos:hover > div > span { text-decoration: underline; text-underline-offset: 3px; }
  dialog.viewer { width: 100%; max-width: 560px; height: 100%; max-height: 100%; margin: 0 auto; padding: 0; border: 0; background: Canvas; color: CanvasText; }
  dialog.viewer::backdrop { background: #000a; }
  .viewer header { position: sticky; top: 0; display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 16px; background: Canvas; border-bottom: 1px solid var(--line); z-index: 1; }
  .viewer header h3 { margin: 0; font-size: 17px; }
  .viewer header button { font-size: 20px; line-height: 1; padding: 6px 10px; background: transparent; color: inherit; border: 1px solid var(--line); }
  .viewer .shots { display: grid; gap: 20px; padding: 16px; }
  .viewer figure img { aspect-ratio: auto; max-height: 75vh; object-fit: contain; background: transparent; }
  .viewer figcaption a { color: inherit; }
  ::view-transition-group(*) { animation-duration: .35s; animation-timing-function: cubic-bezier(.2, .8, .2, 1); }
  @media (prefers-reduced-motion: reduce) { ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation: none !important; } }
  .thumbs img { width: 32px; height: 42px; aspect-ratio: auto; border-radius: 4px; display: block; }
  .thumbs small { color: var(--muted); font-size: 12px; margin-left: 4px; }
  li[id] { scroll-margin-top: 16px; }
  :target { animation: flash 2s ease-out; }
  @keyframes flash { from { background: #f5c54266; } to { background: transparent; } }
  .empty { color: var(--muted); }
  form { display: grid; gap: 12px; }
  label { display: grid; gap: 4px; font-size: 14px; color: var(--muted); }
  input, select, button { font: inherit; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: inherit; }
  button { background: CanvasText; color: Canvas; border: 0; font-weight: 600; cursor: pointer; }
  .saved { color: #2a9d5c; font-size: 14px; margin: 0; }
  .error { color: #d1495b; font-size: 14px; margin: 0; }
  .edit { font-size: 12px; color: var(--muted); }
  .fit img.photo { aspect-ratio: auto; max-height: 70vh; object-fit: contain; background: transparent; }
  .fit li { align-items: center; flex-wrap: wrap; }
  .fit form { display: flex; gap: 6px; align-items: center; margin: 0; }
  .fit li > form select { max-width: 190px; padding: 6px 8px; font-size: 14px; }
  .fit li > div { display: flex; gap: 6px; flex-wrap: wrap; }
  .fit button.quiet { background: transparent; color: inherit; border: 1px solid var(--line); font-weight: normal; padding: 6px 10px; font-size: 14px; }
  .fit .add { display: grid; gap: 8px; }
  .fit .add div { display: flex; gap: 6px; flex-wrap: wrap; }
  .notice { padding: 10px 12px; border-radius: 8px; background: #2a9d5c22; margin: 0 0 16px; }
  .back { color: inherit; display: inline-block; margin-bottom: 12px; }
`;

interface PageData {
  user: User;
  items: Item[];
  outfits: Outfit[];
  reminders: Reminder[];
  impact: Impact;
  wears: { outfitId: number; itemId: number }[];
  saved: boolean;
  cityChoices?: { typed: string; options: string[] }; // several places matched what they typed
  cityNotFound?: string;
}

function page({ user, items: allItems, outfits, reminders: pending, impact, wears, saved, cityChoices, cityNotFound }: PageData): string {
  // Items link to the fit checks they were seen in, and each fit check lists
  // its items, so you can check what the vision model matched.
  const outfitById = new Map(outfits.map((o) => [o.id, o]));
  const itemById = new Map(allItems.map((i) => [i.id, i]));
  const fitsOf = new Map<number, Outfit[]>();
  const itemsOf = new Map<number, Item[]>();
  for (const w of wears) {
    const outfit = outfitById.get(w.outfitId);
    const item = itemById.get(w.itemId);
    if (!outfit || !item) continue;
    fitsOf.set(item.id, [...(fitsOf.get(item.id) ?? []), outfit]);
    itemsOf.set(outfit.id, [...(itemsOf.get(outfit.id) ?? []), item]);
  }
  // Photos per item for the viewer script: clicking an item enlarges just its photos.
  const viewerPhotos: Record<number, { url: string; date: string; fit: number }[]> = {};
  const thumbs = (item: Item) => {
    const fits = (fitsOf.get(item.id) ?? []).filter((o) => o.photoUrl).sort((a, b) => a.at - b.at);
    if (!fits.length) return "";
    viewerPhotos[item.id] = fits.map((o) => ({ url: o.photoUrl!, date: fmtDate(o.at), fit: o.id }));
    return `<button type="button" class="thumbs" data-item="${item.id}" aria-label="Show ${plural(fits.length, "photo")} of ${esc(item.description)}">${fits
      .map((o) => `<img src="${esc(o.photoUrl!)}" loading="lazy" alt="">`)
      .join("")}<small>worn ${fits.length}×</small></button>`;
  };

  const sections = CATEGORIES.map((cat) => {
    const items = allItems.filter((i) => i.category === cat);
    if (!items.length) return "";
    return `<section><h2>${SECTION_TITLES[cat]} <span>${items.length}</span></h2><ul>${items
      .map(
        (i) =>
          `<li id="item-${i.id}"${fitsOf.has(i.id) ? ` class="has-photos" data-item="${i.id}"` : ""}><div><span>${esc(i.description)}${i.location ? ` <small>· ${esc(i.location)}</small>` : ""}</span>${thumbs(i)}</div><time>${fmtDate(i.created_at.getTime())}</time></li>`,
      )
      .join("")}</ul></section>`;
  }).join("");

  const photos = outfits
    .filter((p) => p.photoUrl)
    .map((p) => {
      const found = itemsOf.get(p.id) ?? [];
      const list = found.length
        ? `<ul class="found">${found.map((i) => `<li><a href="#item-${i.id}">${esc(i.description)}</a></li>`).join("")}</ul>`
        : "";
      return `<figure id="fit-${p.id}"><img src="${esc(p.photoUrl!)}" loading="lazy" alt="Fit check ${fmtDate(p.at)}"><figcaption>${fmtDate(p.at)} · <a class="edit" href="/w/${user.webToken}/fit/${p.id}">Edit</a></figcaption>${list}</figure>`;
    })
    .join("");

  const hour = user.fitCheckHour;
  const fitCheck = hour === null ? "off" : hourLabel(hour);
  const hourOptions = [
    `<option value="off"${hour === null ? " selected" : ""}>Off</option>`,
    ...Array.from({ length: 24 }, (_, h) => `<option value="${h}"${h === hour ? " selected" : ""}>${hourLabel(h)}</option>`),
  ].join("");
  const reminders = pending
    .map((r) => `<li>${esc(r.text)}<time>${fmtWhen(r.at)}</time></li>`)
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${user.name ? `${esc(user.name)}'s` : "Your"} wardrobe · Second Thought</title>
<style>
${STYLE}</style></head><body>
<h1>${user.name ? `${esc(user.name)}'s` : "Your"} wardrobe</h1>
<p class="impact">${impactSummary(impact)}</p>
<p class="sub">${plural(allItems.length, "item")} · ${plural(outfits.length, "fit check")}${user.city ? ` · ${esc(user.city)}` : ""}</p>
${sections || `<p class="empty">No items yet. Text something like "I have black straight-leg jeans".</p>`}
<h2>Fit checks</h2>
${photos ? `<div class="grid">${photos}</div>` : `<p class="empty">No fit checks yet. Send a photo of today's outfit.</p>`}
<h2>Reminders</h2>
<ul><li>Daily fit check<time>${fitCheck}</time></li>${reminders}</ul>
<h2 id="profile">Profile</h2>
<form method="post" action="/w/${user.webToken}/profile">
  ${saved ? `<p class="saved">Saved.</p>` : ""}
  <label>Name<input name="name" value="${esc(user.name ?? "")}" maxlength="${MAX_FIELD}" placeholder="What should I call you?"></label>
  ${
    cityChoices
      ? `<label>Which ${esc(cityChoices.typed)}?<select name="city">${cityChoices.options
          .map((o) => `<option>${esc(o)}</option>`)
          .join("")}</select></label>`
      : `<label>City<input name="city" value="${esc(user.city ?? "")}" maxlength="${MAX_FIELD}" placeholder="Used for season-aware reminders"></label>`
  }
  ${cityNotFound ? `<p class="error">I couldn't find a city called "${esc(cityNotFound)}". Adding the state helps, like "Springfield, Illinois".</p>` : ""}
  <label>Daily fit check<select name="fitCheck">${hourOptions}</select></label>
  <button type="submit">Save</button>
</form>
<dialog class="viewer" aria-labelledby="viewer-title">
  <header><h3 id="viewer-title"></h3><button type="button" class="close" aria-label="Close">✕</button></header>
  <div class="shots"></div>
</dialog>
<script type="application/json" id="item-photos">${JSON.stringify(viewerPhotos).replace(/</g, "\\u003c")}</script>
<script>
(() => {
  const photos = JSON.parse(document.getElementById("item-photos").textContent);
  const dialog = document.querySelector("dialog.viewer");
  const shots = dialog.querySelector(".shots");
  const title = dialog.querySelector("h3");
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  // Morph the clicked item's thumbnails into the big photos (and back) when
  // the browser has view transitions; otherwise just open and close.
  const transition = (update) =>
    document.startViewTransition && !still.matches ? document.startViewTransition(update).finished : Promise.resolve(update());
  let open = null; // the item's thumbnail images while the viewer is up

  function name(imgs, on) {
    imgs.forEach((img, i) => (img.style.viewTransitionName = on ? "shot-" + i : ""));
  }

  async function show(id) {
    const list = photos[id];
    const row = document.getElementById("item-" + id);
    if (!list || !row) return;
    const thumbs = [...row.querySelectorAll(".thumbs img")];
    name(thumbs, true);
    await transition(() => {
      name(thumbs, false);
      title.textContent = row.querySelector("span").firstChild.textContent.trim();
      shots.replaceChildren(
        ...list.map((p, i) => {
          const fig = document.createElement("figure");
          const img = document.createElement("img");
          img.src = p.url;
          img.alt = "Fit check " + p.date;
          img.style.viewTransitionName = "shot-" + i;
          const cap = document.createElement("figcaption");
          const link = document.createElement("a");
          link.href = "#fit-" + p.fit;
          link.textContent = p.date + " · see the fit check";
          cap.append(link);
          fig.append(img, cap);
          return fig;
        }),
      );
      dialog.showModal();
    });
    open = thumbs;
  }

  async function hide() {
    if (!dialog.open) return;
    const big = [...shots.querySelectorAll("img")];
    const thumbs = open ?? [];
    open = null;
    await transition(() => {
      big.forEach((img) => (img.style.viewTransitionName = ""));
      name(thumbs, true);
      dialog.close();
    });
    name(thumbs, false);
  }

  document.addEventListener("click", (e) => {
    const target = e.target.closest("[data-item]");
    if (target && !e.target.closest("a")) {
      e.preventDefault();
      show(target.dataset.item);
    }
  });
  dialog.querySelector(".close").addEventListener("click", hide);
  dialog.addEventListener("click", (e) => e.target === dialog && hide()); // the backdrop
  dialog.addEventListener("cancel", (e) => (e.preventDefault(), hide())); // Esc
  shots.addEventListener("click", (e) => e.target.closest("a") && hide());
})();
</script>
</body></html>`;
}

interface FitPageData {
  user: User;
  outfit: Outfit;
  linked: Item[];
  sameAs: Map<number, Item[]>; // per linked item: closet items it might really be
  closet: Item[]; // everything else they own, to link by hand
  notice?: string;
}

/**
 * One fit check, to fix what the vision model got wrong: merge a split item
 * into the one it really is, unlink what isn't there, link or add what's missing.
 */
function fitPage({ user, outfit, linked, sameAs, closet, notice }: FitPageData): string {
  const base = `/w/${user.webToken}`;
  const action = `${base}/fit/${outfit.id}`;
  const rows = linked
    .map((i) => {
      const options = sameAs.get(i.id) ?? [];
      const merge = options.length
        ? `<form method="post" action="${action}"><input type="hidden" name="op" value="merge"><input type="hidden" name="item" value="${i.id}">
            <select name="into" aria-label="Same as">${options.map((o) => `<option value="${o.id}">${esc(o.description)}</option>`).join("")}</select>
            <button class="quiet">Same as this</button></form>`
        : "";
      return `<li id="item-${i.id}"><span>${esc(i.description)}</span><div>${merge}
        <form method="post" action="${action}"><input type="hidden" name="op" value="unlink"><input type="hidden" name="item" value="${i.id}"><button class="quiet">Not in this photo</button></form></div></li>`;
    })
    .join("");
  const owned = closet
    .map((i) => `<option value="${i.id}">${esc(i.description)} (${esc(i.category)})</option>`)
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fit check ${fmtDate(outfit.at)} · Second Thought</title>
<style>
${STYLE}</style></head><body class="fit">
<a class="back" href="${base}#fit-${outfit.id}">← Wardrobe</a>
<h1>Fit check, ${fmtDate(outfit.at)}</h1>
${notice ? `<p class="notice">${esc(notice)}</p>` : ""}
${outfit.photoUrl ? `<img class="photo" src="${esc(outfit.photoUrl)}" alt="Fit check ${fmtDate(outfit.at)}">` : ""}
<h2>In this photo <span>${linked.length}</span></h2>
${rows ? `<ul>${rows}</ul>` : `<p class="empty">No items linked to this photo.</p>`}
<h2>Add something that's missing</h2>
<form class="add" method="post" action="${action}">
  <input type="hidden" name="op" value="add">
  <label>Something you already own${owned ? `<select name="existing"><option value="">Pick an item…</option>${owned}</select>` : ` <small>(nothing else in your closet)</small>`}</label>
  <label>Or a new item<input name="name" maxlength="${MAX_FIELD}" placeholder="e.g. grey puma sweatpants"></label>
  <div><button>Add to this photo</button></div>
</form>
</body></html>`;
}

const html = (body: string) => new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });

// The number people text to start. Defaults to our Spectrum line; override
// with BOT_NUMBER if the line changes (`photon spectrum lines list`).
const BOT_NUMBER = process.env.BOT_NUMBER?.trim() || "+16282679185";
const START_LINK = `sms:${BOT_NUMBER}`;
// Pretty-printed for the page; the sms: link keeps the E.164 form.
const BOT_NUMBER_DISPLAY = /^\+1\d{10}$/.test(BOT_NUMBER)
  ? BOT_NUMBER.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3")
  : BOT_NUMBER;

// One QR code, encoded once at startup. Transparent background so only the
// dark modules are drawn; the card behind them supplies the white and the
// quiet zone is baked in so phone cameras lock on.
const qrSvg = QRCode.toString(START_LINK, {
  type: "svg",
  margin: 4,
  errorCorrectionLevel: "M",
  color: { dark: "#111111ff", light: "#00000000" },
});

async function landingPage(): Promise<string> {
  const start = `<a class="card" href="${esc(START_LINK)}">${await qrSvg}</a>
<p class="hint"><span class="desktop">Scan with your phone camera, or text </span><span class="phone">Tap the code above, or text </span><a href="${esc(START_LINK)}">${esc(BOT_NUMBER_DISPLAY)}</a></p>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Second Thought · the closet that texts back</title>
<meta name="description" content="An iMessage bot that remembers everything in your closet, so you stop buying clothes you already own.">
<style>
  :root { color-scheme: light dark; --muted: #888; --line: #8883; }
  body { font: 16px/1.5 -apple-system, system-ui, sans-serif; max-width: 420px; margin: 0 auto;
         padding: 12vh 20px 48px; text-align: center; }
  h1 { font-size: 34px; line-height: 1.1; margin: 0 0 12px; letter-spacing: -0.02em; }
  .lede { font-size: 18px; margin: 0 0 8px; }
  .sub { color: var(--muted); margin: 0 0 36px; }
  .card { display: block; width: 220px; margin: 0 auto 16px; padding: 12px; border-radius: 16px;
          background: #fff; box-shadow: 0 1px 3px #0002; }
  .card svg { display: block; width: 100%; height: auto; }
  .hint { color: var(--muted); font-size: 14px; margin: 0 0 40px; }
  a { color: inherit; }
  .hint a { font-weight: 600; white-space: nowrap; }
  ul { list-style: none; padding: 0; margin: 0; text-align: left; display: grid; gap: 10px; }
  li { padding: 10px 0; border-top: 1px solid var(--line); color: var(--muted); font-size: 15px; }
  li b { color: CanvasText; font-weight: 600; }
  .phone { display: none; }
  @media (hover: none) and (pointer: coarse) { .desktop { display: none; } .phone { display: inline; } }
</style></head><body>
<h1>Second Thought</h1>
<p class="lede">The closet that texts back.</p>
<p class="sub">Send fit checks and order screenshots. It remembers everything you own, so you stop buying clothes you already have.</p>
${start}
<ul>
  <li><b>Do I already have this?</b> Send a photo of something you&rsquo;re about to buy and get back the near-duplicates already hanging in your closet.</li>
  <li><b>Return before the window closes.</b> Order screenshots log the deadline, and you get a nudge if you still haven&rsquo;t worn it.</li>
  <li><b>No app to install.</b> It all happens in Messages.</li>
</ul>
</body></html>`;
}

export function startWebServer() {
  const server = Bun.serve({
    port: PORT,
    routes: {
      "/": async () =>
        new Response(await landingPage(), { headers: { "Content-Type": "text/html; charset=utf-8" } }),
      "/w/:token": async (req) => {
        const user = await getUserByToken(req.params.token);
        if (!user) return new Response("Not found", { status: 404 });
        const [items, outfits, reminders, impact, wears] = await Promise.all([
          listItems(user.id),
          listOutfits(user.id),
          pendingReminders(user.id),
          impactFor(user.id),
          listWears(user.id),
        ]);
        const params = new URL(req.url).searchParams;
        const saved = params.has("saved");
        const typed = params.get("pickCity");
        // Several places matched the city they typed: list them again to pick from.
        const options = typed ? (await findCities(typed).catch(() => [])).map((c) => c.label) : [];
        const cityChoices = typed && options.length > 1 ? { typed, options } : undefined;
        const cityNotFound = params.get("cityNotFound") ?? undefined;
        return new Response(page({ user, items, outfits, reminders, impact, wears, saved, cityChoices, cityNotFound }), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      },
      "/w/:token/profile": {
        POST: async (req) => {
          const user = await getUserByToken(req.params.token);
          if (!user) return new Response("Not found", { status: 404 });
          const form = await req.formData();
          const field = (key: string) => String(form.get(key) ?? "").trim().slice(0, MAX_FIELD);

          // Empty name clears it; empty city keeps the old one (the bot relies on it).
          const patch: Parameters<typeof updateUser>[1] = { name: field("name") || null };
          // A city is saved only once it's a real place; several matches send
          // them back to pick one.
          const city = cityFrom(field("city"));
          let redirect = `/w/${user.webToken}?saved#profile`;
          if (city && city !== user.city) {
            const found = await findCities(city).catch((err) => {
              console.error("city lookup failed; saving it as typed", err);
              return [{ label: city, population: 0 }];
            });
            const exact = found.find((c) => c.label.toLowerCase() === city.toLowerCase());
            if (exact || found.length === 1) patch.city = (exact ?? found[0])!.label;
            else if (found.length) redirect = `/w/${user.webToken}?pickCity=${encodeURIComponent(city)}#profile`;
            else redirect = `/w/${user.webToken}?cityNotFound=${encodeURIComponent(city)}#profile`;
          }
          const fitCheck = field("fitCheck");
          const hour = Number(fitCheck);
          if (fitCheck === "off") patch.fitCheckHour = null;
          else if (fitCheck !== "" && Number.isInteger(hour) && hour >= 0 && hour <= 23) patch.fitCheckHour = hour;

          await updateUser(user.id, patch);
          // Post/redirect/get so a refresh doesn't resubmit the form.
          return new Response(null, { status: 303, headers: { Location: redirect } });
        },
      },
      "/w/:token/fit/:id": {
        GET: async (req) => {
          const user = await getUserByToken(req.params.token);
          const outfit = user && (await getOutfit(user.id, Number(req.params.id)));
          if (!user || !outfit) return new Response("Not found", { status: 404 });
          const [items, wears] = await Promise.all([listItems(user.id), listWears(user.id)]);
          const linkedIds = new Set(wears.filter((w) => w.outfitId === outfit.id).map((w) => w.itemId));
          const linked = items.filter((i) => linkedIds.has(i.id));
          const groups = await llmGroups(items).catch(() => exactGroups);
          const sameAs = new Map(linked.map((i) => [i.id, mostAlike(i, items, groups)]));
          const closet = items.filter((i) => !linkedIds.has(i.id));
          const notice = new URL(req.url).searchParams.get("msg") ?? undefined;
          return html(fitPage({ user, outfit, linked, sameAs, closet, notice }));
        },
        POST: async (req) => {
          const user = await getUserByToken(req.params.token);
          const outfit = user && (await getOutfit(user.id, Number(req.params.id)));
          if (!user || !outfit) return new Response("Not found", { status: 404 });
          const form = await req.formData();
          const field = (key: string) => String(form.get(key) ?? "").trim().slice(0, MAX_FIELD);
          const itemId = Number(field("item"));
          const items = await listItems(user.id);
          const nameOf = (id: number) => items.find((i) => i.id === id)?.description ?? "that item";

          let msg = "";
          switch (field("op")) {
            case "unlink": {
              const { removed } = await unlinkItem(db, user.id, outfit.id, itemId);
              msg = removed
                ? `Removed ${nameOf(itemId)}: it was only ever seen in this photo.`
                : `${nameOf(itemId)} is no longer linked to this photo.`;
              break;
            }
            case "merge": {
              const into = Number(field("into"));
              msg = (await mergeItems(db, user.id, itemId, into))
                ? `Merged: ${nameOf(itemId)} is now ${nameOf(into)}.`
                : "Couldn't merge those two.";
              break;
            }
            case "add": {
              const existing = Number(field("existing"));
              const name = field("name");
              if (existing) {
                msg = (await linkItem(db, user.id, outfit.id, existing)) ? `Linked ${nameOf(existing)}.` : "Couldn't link that item.";
              } else if (name) {
                const item = await itemFromName(name).catch(() => undefined);
                if (item) {
                  const saved = await addItemToOutfit(db, user.id, outfit, item);
                  msg = `Added ${saved.description} (${saved.type}) to your closet and this photo.`;
                } else msg = `I couldn't tell what kind of item "${name}" is. Try naming the type, like "grey sweatpants".`;
              } else msg = "Pick an item or type a name.";
              break;
            }
          }
          const back = `/w/${user.webToken}/fit/${outfit.id}${msg ? `?msg=${encodeURIComponent(msg)}` : ""}`;
          return new Response(null, { status: 303, headers: { Location: back } });
        },
      },
      // Photo ids are random UUIDs, so the URL itself is the access check. It
      // has to be fetchable without a session so the vision model can load it.
      "/photos/:id": async (req) => {
        const photo = await getPhoto(req.params.id);
        if (!photo) return new Response("Not found", { status: 404 });
        return new Response(photo.image, {
          headers: { "Content-Type": photo.mimeType, "Cache-Control": "private, max-age=86400" },
        });
      },
    },
    fetch: () => new Response("Not found", { status: 404 }),
  });
  console.log(`Wardrobe pages on ${PUBLIC_URL} (listening on :${server.port})`);
}
