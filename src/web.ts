import QRCode from "qrcode";
import { CATEGORIES, type Category } from "./closet/categories.ts";
import { publicGuideResponse, userGuideResponse } from "./guide-page.ts";
import { climateFor } from "./climate.ts";
import { type LetGoPick, declutterPicks } from "./declutter.ts";
import { AGE_RANGES, OCCASIONS, type Occasion, type ProfilePatch, saveProfile } from "./profile.ts";
import { BOT_NUMBER_DISPLAY, CATEGORY_NAMES, FONTS, PIN, SEASONS, START_LINK, STAT_ICONS, SECTION_TITLES, STYLE, TOKENS, esc, icon, svg, tabs } from "./web-style.ts";
import { cityFrom, findCities } from "./cities.ts";
import { PORT, PUBLIC_URL } from "./config.ts";
import { addItemToOutfit, deleteFitCheck, itemsOnlyIn, linkItem, mergeItems, unlinkItem } from "./fit-edits.ts";
import type { ExtractedItem } from "./closet/extract.ts";
import { colorIn, itemFromName } from "./llm.ts";
import { exactGroups, llmGroups, mostAlike, searchItems } from "./match.ts";
import { aNew, describeKg, footprintOf, isPlural } from "./footprint.ts";
import { wearCount } from "./closet/repo.ts";
import { last30Days } from "./recap.ts";
import { recapFor } from "./recaps.ts";
import { money } from "./orders.ts";
import { type Impact, type ImpactEntry, type LetGo, impactHistory, impactSummary, letGo, setQuantity, tossMessage } from "./impact.ts";
import {
  type Item,
  type Outfit,
  type Reminder,
  type User,
  db,
  deletePhoto,
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

export function guideUrl(user: User): string {
  return `${PUBLIC_URL}/w/${user.webToken}/guide`;
}

export function recapUrl(user: User): string {
  return `${PUBLIC_URL}/w/${user.webToken}/recap`;
}


const hourLabel = (hour: number) => `${hour % 12 || 12}${hour < 12 ? "am" : "pm"}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const MAX_FIELD = 60;

const fmtDate = (at: number) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const fmtWhen = (at: number) =>
  new Date(at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

interface PageData {
  user: User;
  items: Item[];
  outfits: Outfit[];
  reminders: Reminder[];
  impact: Impact;
  history: ImpactEntry[];
  letGoPicks: LetGoPick[]; // "what should I get rid of?" (declutter.ts)
  notice?: string;
  wears: { outfitId: number; itemId: number }[];
  saved: boolean;
  cityChoices?: { typed: string; options: string[] }; // several places matched what they typed
  cityNotFound?: string;
}

function page({ user, items: allItems, outfits, reminders: pending, impact, history, letGoPicks, notice, wears, saved, cityChoices, cityNotFound }: PageData): string {
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

  // Sold, donated, or thrown away: each leaves the closet; the first two count.
  // Identical pieces (three of the same tee): set on the page, never guessed in texts.
  const quantityForm = (item: Item) => `<details class="letgo qty"><summary>${item.quantity > 1 ? `×${item.quantity} · ` : ""}How many?</summary>
    <form method="post" action="/w/${user.webToken}/quantity"><input type="hidden" name="item" value="${item.id}">
      <div><input name="quantity" type="number" min="1" max="99" value="${item.quantity}" aria-label="How many you own"><button>Save</button></div>
    </form></details>`;

  const letGoForm = (item: Item) => `<details class="letgo"><summary>Let it go</summary>
    <form method="post" action="/w/${user.webToken}/let-go"><input type="hidden" name="item" value="${item.id}">
      <div><input name="price" inputmode="decimal" placeholder="$ (optional)" aria-label="Sold for"><button name="how" value="sold">Sold</button></div>
      <button name="how" value="donated" class="quiet">Donated</button>
      ${item.purchase_id ? `<button name="how" value="returned" class="quiet">Returned</button>` : ""}
      <button name="how" value="trashed" class="quiet">Threw it away</button>
    </form></details>`;

  const pieces = (items: Item[]) => items.reduce((n, i) => n + (i.quantity ?? 1), 0);

  // A closet item as a card: its latest photo, name, color and season, tags, wears.
  const itemCard = (i: Item, n: number) => {
    const fits = fitsOf.get(i.id) ?? [];
    const cover = [...fits].filter((o) => o.photoUrl).sort((a, b) => b.at - a.at)[0]?.photoUrl ?? i.photo_url;
    const lastWorn = fits.length ? Math.max(...fits.map((o) => o.at)) : null;
    const sub = [i.color_primary !== "unknown" ? i.color_primary : null, SEASONS[i.season], `added ${fmtDate(i.created_at.getTime())}`]
      .filter(Boolean)
      .join(" · ");
    const tags = [
      `<span class="tag">${icon(i.category, 12)}${CATEGORY_NAMES[i.category]}</span>`,
      i.location ? `<span class="tag loc">${svg(PIN, 12)}${esc(i.location)}</span>` : "",
    ].join("");
    const wornLine = fits.length ? `${plural(fits.length, "wear")} · last worn ${fmtDate(lastWorn!)}` : "Not in a fit check yet";
    return `<li id="item-${i.id}" class="card${fits.length ? " has-photos" : ""}"${fits.length ? ` data-item="${i.id}"` : ""} style="--i:${Math.min(n, 10)}">
      <div class="pic">${cover ? `<img src="${esc(cover)}" loading="lazy" alt="">` : icon(i.category, 40)}</div>
      <div class="card-body"><span class="card-title">${esc(i.description)}${i.quantity > 1 ? ` <b class="count">×${i.quantity}</b>` : ""}</span>
        <p class="card-sub">${esc(sub)}</p><div class="tags">${tags}</div>${thumbs(i)}
        <div class="card-foot"><span>${wornLine}</span><div class="actions">${quantityForm(i)}${letGoForm(i)}</div></div></div></li>`;
  };
  const present = CATEGORIES.filter((cat) => allItems.some((i) => i.category === cat));
  // Big square tiles, one per category and "All items" last. Each opens its list.
  const tiles = [...present, "all" as const]
    .map((cat, i) => {
      const count = cat === "all" ? pieces(allItems) : pieces(allItems.filter((i) => i.category === cat));
      const label = cat === "all" ? "All items" : SECTION_TITLES[cat].replace(/^./, (c) => c.toUpperCase());
      return `<button type="button" class="tile" data-cat="${cat}" style="--i:${i}"><i class="ico">${icon(cat)}</i><span>${label}</span><small>${count}</small></button>`;
    })
    .join("");

  const sections = CATEGORIES.map((cat) => {
    const items = allItems.filter((i) => i.category === cat);
    if (!items.length) return "";
    const title = SECTION_TITLES[cat].replace(/^./, (c) => c.toUpperCase());
    return `<section class="catlist" data-cat="${cat}"><h2>${title} <span>${pieces(items)}</span></h2><ul class="cards">${items
      .map((i, n) => itemCard(i, n))
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

  // Distinct items in fit checks from the last 7 days.
  const weekAgo = Date.now() - 7 * 86_400_000;
  const wornThisWeek = new Set(wears.filter((w) => (outfitById.get(w.outfitId)?.at ?? 0) >= weekAgo).map((w) => w.itemId)).size;
  const stat = (paths: string, value: string, label: string, i: number) =>
    `<div class="stat" style="--i:${i}"><i class="ico">${svg(paths, 28)}</i><div><b>${esc(value)}</b><small>${label}</small></div></div>`;

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
${FONTS}
<style>
${STYLE}</style></head><body>
${tabs(user.webToken, "closet")}
<h1>${user.name ? `${esc(user.name)}'s` : "Your"} wardrobe</h1>
<div class="stats" aria-label="${esc(impactSummary(impact))}">
  ${stat(STAT_ICONS.skipped, String(impact.skipped), impact.skipped === 1 ? "purchase skipped" : "purchases skipped", 0)}
  ${stat(STAT_ICONS.money, money(impact.recovered), "back from returns and sales", 1)}
  ${stat(STAT_ICONS.worn, String(wornThisWeek), wornThisWeek === 1 ? "item worn this week" : "items worn this week", 2)}
  ${stat(STAT_ICONS.co2, impact.co2Kg > 0 ? `≈ ${Math.round(impact.co2Kg)} kg` : "0 kg", "CO₂e saved, est.", 3)}
</div>
${impact.returned + impact.sold + impact.donated ? `<p class="sub">${esc(impactSummary(impact))}</p>` : ""}
<p class="links"><a class="edit" href="/w/${user.webToken}/recap">See your 30-day recap →</a></p>
${notice ? `<p class="notice">${esc(notice)}</p>` : ""}
${
  history.length
    ? `<details class="skipped"><summary>Here's what you saved</summary><ul class="rows">${history
        .map((k) => {
          const what =
            k.kind === "avoided"
              ? `Skipped ${esc(aNew(k.type))}, like your ${esc(k.description)}`
              : `${k.kind === "recovered" ? "Returned" : k.kind === "sold" ? "Sold" : "Donated"} your ${esc(k.description)}${k.amount ? ` for ${money(k.amount)}` : ""}`;
          return `<li><span>${what}${k.co2Kg === null ? "" : ` <small>${describeKg(k.co2Kg)}</small>`}</span><time>${fmtDate(k.at.getTime())}</time></li>`;
        })
        .join("")}</ul><p class="note">CO₂ figures are estimates for making a new item of that type, from <a href="https://www.carbonfact.com/carbon-footprint">Carbonfact's category averages</a>: for a skip, the new item that wasn't made; for a return, sale or donation, the new item someone else doesn't buy when this one gets worn again. Driving comparison from the <a href="https://www.epa.gov/greenvehicles/greenhouse-gas-emissions-typical-passenger-vehicle">EPA</a>.</p></details>`
    : ""
}
<p class="sub">${plural(allItems.reduce((n, i) => n + (i.quantity ?? 1), 0), "piece")} · ${plural(outfits.length, "fit check")}${user.city ? ` · ${esc(user.city)}` : ""}</p>
${
  sections
    ? `<div class="tiles" id="tiles">${tiles}</div>
<div class="closet" id="closet">
  <div class="closet-head"><button type="button" class="back" id="back">← All categories</button><h2 id="closet-title"></h2></div>
  ${sections}
</div>`
    : `<p class="empty">No items yet. Text something like "I have black straight-leg jeans".</p>`
}
${
  letGoPicks.length
    ? `<h2 id="let-go">Let go</h2><p class="sub">From what you wear and when. Text "sold 2" or "donated 2" when one's gone.</p><ul class="picks">${letGoPicks
        .map(
          (p, i) => `<li class="pick" style="--i:${i}"><i class="ico">${p.photoUrl ? `<img src="${esc(p.photoUrl)}" loading="lazy" alt="">` : svg(STAT_ICONS.skipped, 28)}</i>
            <div><h3><span class="n">${i + 1}</span> ${esc(p.description)}</h3><p>${esc(p.reasons.join("; "))}.</p>
            <p class="exit exit-${p.exit.kind}">${esc(p.exit.text)}.${p.exit.links.map((l) => ` <a href="${esc(l.url)}" rel="noopener">${esc(l.label)}</a>`).join("")}</p></div></li>`,
        )
        .join("")}</ul>`
    : ""
}
<h2 id="fits">Fit checks</h2>
${photos ? `<div class="grid">${photos}</div>` : `<p class="empty">No fit checks yet. Send a photo of today's outfit.</p>`}
<h2>Reminders</h2>
<ul class="rows"><li>Daily fit check<time>${fitCheck}</time></li>${reminders}</ul>
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
  <label>Age range<select name="ageRange"><option value="">Rather not say</option>${AGE_RANGES.map(
    (a) => `<option value="${a}"${user.ageRange === a ? " selected" : ""}>${a.replace("-", "–")}</option>`,
  ).join("")}</select></label>
  <fieldset class="week"><legend>Your week</legend>${OCCASIONS.map(
    (o) => `<label class="check"><input type="checkbox" name="occasions" value="${o}"${user.occasions?.includes(o) ? " checked" : ""}> ${o}</label>`,
  ).join("")}</fieldset>
  <div class="sizes">
    <label>Top size<input name="sizeTop" value="${esc(user.sizeTop ?? "")}" maxlength="12" placeholder="M"></label>
    <label>Bottom size<input name="sizeBottom" value="${esc(user.sizeBottom ?? "")}" maxlength="12" placeholder="32x30"></label>
    <label>Shoe size<input name="sizeShoe" value="${esc(user.sizeShoe ?? "")}" maxlength="12" placeholder="10"></label>
  </div>
  <p class="empty">Used to fit suggestions to your week and put your size in shopping links. An age range only, never your age.</p>
  <button type="submit">Save</button>
</form>
<script>
(() => {
  const root = document.documentElement;
  const tiles = document.getElementById("tiles");
  if (!tiles) return;
  root.classList.add("js");
  const closet = document.getElementById("closet");
  const title = document.getElementById("closet-title");
  const lists = [...closet.querySelectorAll(".catlist")];
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  const swap = (update) => (document.startViewTransition && !still.matches ? document.startViewTransition(update) : update());
  const labelOf = (cat) => tiles.querySelector('[data-cat="' + cat + '"] span').textContent;

  let current = null; // the open category, or null for the tiles

  function show(cat) {
    current = cat;
    root.classList.add("open");
    closet.classList.toggle("one", cat !== "all");
    lists.forEach((l) => l.classList.toggle("shown", cat === "all" || l.dataset.cat === cat));
    title.textContent = labelOf(cat);
    try { localStorage.setItem("closet-cat", cat); } catch {}
  }
  // The tapped tile and the list's title share a transition name in turn, so
  // one morphs into the other, opening and closing.
  function open(cat, tile) {
    tile.style.viewTransitionName = "closet-title";
    swap(() => {
      tile.style.viewTransitionName = "";
      title.style.viewTransitionName = "closet-title";
      show(cat);
    });
  }
  function close() {
    const tile = tiles.querySelector('[data-cat="' + current + '"]');
    title.style.viewTransitionName = "closet-title";
    swap(() => {
      title.style.viewTransitionName = "";
      if (tile) tile.style.viewTransitionName = "closet-title";
      root.classList.remove("open");
      current = null;
      try { localStorage.removeItem("closet-cat"); } catch {}
    });
    setTimeout(() => tile && (tile.style.viewTransitionName = ""), 700);
  }

  tiles.addEventListener("click", (e) => {
    const tile = e.target.closest(".tile");
    if (tile) open(tile.dataset.cat, tile);
  });
  document.getElementById("back").addEventListener("click", close);

  // A link to one item (from a fit check, or after an edit) opens its category.
  function revealHash() {
    const item = location.hash.startsWith("#item-") && document.getElementById(location.hash.slice(1));
    const list = item && item.closest(".catlist");
    if (list) { show(list.dataset.cat); item.scrollIntoView({ block: "center" }); return true; }
    return false;
  }
  window.addEventListener("hashchange", revealHash);
  if (!revealHash()) {
    let last = null;
    try { last = localStorage.getItem("closet-cat"); } catch {}
    if (last && (last === "all" || lists.some((l) => l.dataset.cat === last))) show(last);
  }
})();
</script>
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
    if (target && !e.target.closest("a, details, form")) {
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
  onlyHere: string[]; // items only this photo added, removed with it
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
function fitPage({ user, outfit, linked, sameAs, closet, notice, onlyHere }: FitPageData): string {
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
${FONTS}
<style>
${STYLE}</style></head><body class="fit">
${tabs(user.webToken, "closet")}
<a class="back" href="${base}#fit-${outfit.id}">← Back to your fit checks</a>
<h1>Fit check, ${fmtDate(outfit.at)}</h1>
${notice ? `<p class="notice">${esc(notice)}</p>` : ""}
${outfit.photoUrl ? `<img class="photo" src="${esc(outfit.photoUrl)}" alt="Fit check ${fmtDate(outfit.at)}">` : ""}
<h2>In this photo <span>${linked.length}</span></h2>
${rows ? `<ul class="rows">${rows}</ul>` : `<p class="empty">No items linked to this photo.</p>`}
<h2>Add something that's missing</h2>
<form class="add" method="post" action="${action}" id="add">
  <input type="hidden" name="op" value="add">
  <label for="q">Describe it, and pick from your closet as you type</label>
  <input id="q" name="name" maxlength="${MAX_FIELD}" autocomplete="off" placeholder="e.g. grey sweats, the puma ones"
    role="combobox" aria-expanded="false" aria-controls="suggest" aria-autocomplete="list">
  <ul class="suggest" id="suggest" role="listbox"></ul>
  <div><button id="as-new" disabled>Add as a new item</button></div>
  ${owned ? `<details><summary>Or browse your closet</summary><div><select name="existing"><option value="">Pick an item…</option>${owned}</select><button class="quiet">Link</button></div></details>` : ""}
</form>
<script>
(() => {
  const input = document.getElementById("q");
  const list = document.getElementById("suggest");
  const asNew = document.getElementById("as-new");
  let timer, pending, active = -1;
  const buttons = () => [...list.querySelectorAll("button")];
  function highlight(i) {
    const all = buttons();
    active = all.length ? Math.max(-1, Math.min(i, all.length - 1)) : -1;
    all.forEach((b, j) => b.setAttribute("aria-selected", String(j === active)));
    if (active >= 0) input.setAttribute("aria-activedescendant", all[active].id);
    else input.removeAttribute("aria-activedescendant");
  }
  function render(items) {
    list.replaceChildren(...items.map((it) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.name = "link"; b.value = it.id; b.id = "opt-" + it.id; b.setAttribute("role", "option");
      if (it.photo) { const img = document.createElement("img"); img.src = it.photo; img.alt = ""; b.append(img); }
      const label = document.createElement("span"); label.textContent = it.description;
      const cat = document.createElement("small"); cat.textContent = it.category;
      b.append(label, cat);
      li.append(b);
      return li;
    }));
    input.setAttribute("aria-expanded", String(items.length > 0));
    highlight(-1);
  }
  async function search() {
    const q = input.value.trim();
    asNew.disabled = !q;
    asNew.textContent = q ? 'Add "' + q + '" as a new item' : "Add as a new item";
    pending?.abort();
    if (!q) return render([]);
    pending = new AbortController();
    try {
      const res = await fetch(location.pathname + "/search?q=" + encodeURIComponent(q), { signal: pending.signal });
      render(await res.json());
    } catch (e) { if (e.name !== "AbortError") render([]); }
  }
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(search, 150); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); highlight(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); highlight(active - 1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const pick = buttons()[active];
      if (pick) input.form.requestSubmit(pick);
      else if (input.value.trim()) input.form.requestSubmit(asNew);
    } else if (e.key === "Escape") render([]);
  });
})();
</script>
<h2>Not a fit check?</h2>
<form method="post" action="${action}" onsubmit="return confirm('Delete this fit check${onlyHere.length ? ` and ${onlyHere.length} item${onlyHere.length === 1 ? "" : "s"} only seen in it` : ""}? This can\\'t be undone.')">
  <input type="hidden" name="op" value="delete">
  <p class="empty">${onlyHere.length ? `Deleting it also removes ${esc(onlyHere.join(", "))}, which only showed up in this photo.` : "Items you already had stay in your closet."}</p>
  <button class="danger">Delete this fit check</button>
</form>
</body></html>`;
}

const html = (body: string) => new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });

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
  const feature = (n: string, title: string, body: string, i: number) =>
    `<li class="feature" style="--i:${i}"><span class="num">${n}</span><h3>${title}</h3><p>${body}</p></li>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Second Thought · the closet that texts back</title>
<meta name="description" content="An iMessage bot that remembers everything in your closet, so you stop buying clothes you already own.">
${FONTS}
<style>
${TOKENS}
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  html, body { overflow-x: clip; }
  body { margin: 0; font: 400 16px/1.5 var(--sans); color: var(--ink); background: var(--canvas); -webkit-font-smoothing: antialiased; }
  h1, h2, h3 { margin: 0; font-weight: 500; }
  a { color: inherit; text-underline-offset: 3px; }
  .bar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; justify-content: space-between; height: 56px; padding: 0 16px;
    background: rgba(255,255,255,.9); -webkit-backdrop-filter: saturate(1.8) blur(14px); backdrop-filter: saturate(1.8) blur(14px); box-shadow: inset 0 -1px 0 var(--hairline-soft); view-transition-name: nav; }
  .bar .brand { font-family: var(--display); font-size: 26px; letter-spacing: .02em; text-transform: uppercase; text-decoration: none; }
  .bar nav { display: flex; gap: 18px; font-size: 15px; font-weight: 500; }
  .bar nav a { text-decoration: none; color: var(--mute); transition: color .25s var(--ease); }
  .bar nav a:hover { color: var(--ink); }
  /* The campaign tile: black, the headline towering, one white pill. */
  .hero { background: var(--ink); color: var(--canvas); }
  .split { max-width: 1440px; margin: 0 auto; padding: 48px 16px 56px; display: grid; gap: 40px; align-items: end; }
  .hero h1 { font-family: var(--display); font-weight: 400; text-transform: uppercase; font-size: 72px; line-height: .9; letter-spacing: .005em; animation: rise .7s var(--ease) both; }
  .lede { font-size: 18px; color: var(--stone); margin: 18px 0 30px; max-width: 34ch; animation: rise .7s var(--ease) .08s both; }
  .lede b { color: var(--canvas); font-weight: 500; }
  .hero .pill { animation: rise .7s var(--ease) .16s both; }
  /* The QR code on a flat white panel. */
  .qr { background: var(--canvas); color: var(--ink); padding: 24px; width: 100%; max-width: 340px; animation: rise .7s var(--ease) .24s both; }
  .qr h2 { font-family: var(--display); font-weight: 400; text-transform: uppercase; font-size: 32px; line-height: .95; margin-bottom: 12px; }
  .qr a.code { display: block; width: 100%; max-width: 220px; margin: 0 0 12px; transition: transform .3s var(--ease); }
  .qr a.code:hover { transform: scale(1.02); }
  .qr svg { display: block; width: 100%; height: auto; }
  .hint { color: var(--mute); font-size: 14px; font-weight: 500; margin: 0; }
  .hint a { color: var(--ink); white-space: nowrap; }
  .phone { display: none; }
  @media (hover: none) and (pointer: coarse) { .desktop { display: none; } .phone { display: inline; } }
  /* What it does: flat soft-gray cards, numbered. */
  .section { max-width: 1440px; margin: 0 auto; padding: var(--section) 16px 0; }
  .section h2 { font-size: 24px; margin-bottom: 18px; }
  .features { display: grid; gap: 8px; list-style: none; margin: 0; padding: 0; }
  .feature { background: var(--cloud); padding: 24px; display: flex; flex-direction: column; gap: 8px; animation: rise .6s var(--ease) both; animation-delay: calc(.3s + var(--i) * 80ms); }
  .feature .num { font-family: var(--display); font-size: 40px; line-height: .9; }
  .feature h3 { font-size: 18px; }
  .feature p { margin: 0; color: var(--charcoal); }
  .more { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin: 30px 0 0; }
  footer { max-width: 1440px; margin: var(--section) auto 0; padding: 24px 16px 40px; border-top: 1px solid var(--hairline); color: var(--mute); font-size: 12px; font-weight: 500; display: flex; flex-wrap: wrap; gap: 8px 24px; justify-content: space-between; }
  footer a { color: var(--mute); text-decoration: none; }
  footer a:hover { color: var(--ink); }
  @media (min-width: 760px) {
    .bar { padding: 0 32px; }
    .split { grid-template-columns: 1.4fr 1fr; padding: 96px 32px; gap: 56px; }
    .hero h1 { font-size: 120px; }
    .qr { justify-self: end; }
    .section { padding-left: 32px; padding-right: 32px; }
    .features { grid-template-columns: repeat(3, 1fr); }
    footer { padding-left: 32px; padding-right: 32px; }
  }
</style></head><body>
<header class="bar"><a class="brand" href="/">Second Thought</a><nav><a href="/guide">Guide</a><a href="${esc(START_LINK)}">Start</a></nav></header>
<section class="hero"><div class="split">
  <div>
    <h1>Stop buying what you already own.</h1>
    <p class="lede"><b>The closet that texts back.</b> Send fit checks and order screenshots; it remembers everything you own.</p>
    <a class="pill pill-light" href="${esc(START_LINK)}">Text the bot <span class="arrow" aria-hidden="true">→</span></a>
  </div>
  <div class="qr">
    <h2>Scan to start</h2>
    <a class="code" href="${esc(START_LINK)}" aria-label="Text the bot">${await qrSvg}</a>
    <p class="hint"><span class="desktop">Scan with your phone camera, or text </span><span class="phone">Tap the code, or text </span><a href="${esc(START_LINK)}">${esc(BOT_NUMBER_DISPLAY)}</a></p>
  </div>
</div></section>
<section class="section">
  <h2>What it does</h2>
  <ul class="features">
    ${feature("01", "Do I already have this?", "Send a photo of something you&rsquo;re about to buy and get back the near-duplicates already hanging in your closet.", 0)}
    ${feature("02", "Return before the window closes.", "Order screenshots log the deadline, and you get a nudge if you still haven&rsquo;t worn it.", 1)}
    ${feature("03", "No app to install.", "It all happens in Messages.", 2)}
  </ul>
  <div class="more"><a class="pill" href="${esc(START_LINK)}">Text the bot</a><a class="pill pill-soft" href="/guide">See everything you can text it</a></div>
</section>
<footer><span>Second Thought · the closet that texts back</span><span><a href="/guide">Guide</a></span></footer>
</body></html>`;
}

export function startWebServer() {
  const server = Bun.serve({
    port: PORT,
    routes: {
      "/": async () =>
        new Response(await landingPage(), { headers: { "Content-Type": "text/html; charset=utf-8" } }),
      "/guide": () => publicGuideResponse(),
      "/w/:token/guide": (req) => userGuideResponse(req.params.token, getUserByToken),
      "/w/:token": async (req) => {
        const user = await getUserByToken(req.params.token);
        if (!user) return new Response("Not found", { status: 404 });
        const [items, outfits, reminders, impact, wears, history] = await Promise.all([
          listItems(user.id),
          listOutfits(user.id),
          pendingReminders(user.id),
          impactFor(user.id),
          listWears(user.id),
          impactHistory(db, user.id),
        ]);
        const climate = user.city ? await climateFor(db, user.city).catch(() => undefined) : undefined;
        const letGoPicks = await declutterPicks(db, user.id, climate, new Date(), user).catch((err) => {
          console.error(`let-go picks for ${user.id} failed`, err);
          return [];
        });
        const params = new URL(req.url).searchParams;
        const saved = params.has("saved");
        const typed = params.get("pickCity");
        // Several places matched the city they typed: list them again to pick from.
        const options = typed ? (await findCities(typed).catch(() => [])).map((c) => c.label) : [];
        const cityChoices = typed && options.length > 1 ? { typed, options } : undefined;
        const cityNotFound = params.get("cityNotFound") ?? undefined;
        return new Response(page({ user, items, outfits, reminders, impact, history, letGoPicks, notice: params.get("msg") ?? undefined, wears, saved, cityChoices, cityNotFound }), {
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
          // Profile details (profile.ts): blank clears a field; the week is replaced by what's checked.
          const size = (key: string) => field(key).slice(0, 12) || null;
          const age = field("ageRange");
          const details: ProfilePatch = {
            ageRange: (AGE_RANGES as readonly string[]).includes(age) ? (age as ProfilePatch["ageRange"]) : null,
            occasions: form.getAll("occasions").map(String).filter((o): o is Occasion => (OCCASIONS as readonly string[]).includes(o)),
            sizeTop: size("sizeTop"),
            sizeBottom: size("sizeBottom"),
            sizeShoe: size("sizeShoe"),
          };
          await saveProfile(db, user.id, details, { replaceOccasions: true });
          // Post/redirect/get so a refresh doesn't resubmit the form.
          return new Response(null, { status: 303, headers: { Location: redirect } });
        },
      },
      "/w/:token/recap": async (req) => {
        const user = await getUserByToken(req.params.token);
        if (!user) return new Response("Not found", { status: 404 });
        const { summary } = await recapFor(user.id, last30Days(), user.name);
        return html(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Recap · Second Thought</title>
<meta property="og:title" content="My last 30 days on Second Thought"><meta property="og:image" content="${recapUrl(user)}.png">
${FONTS}
<style>
${STYLE}</style></head><body class="recap">
${tabs(user.webToken, "closet")}
<h1>Your last 30 days</h1>
<img src="/w/${user.webToken}/recap.png" alt="${esc(summary)}">
<p class="links"><a class="pill" href="/w/${user.webToken}/recap.png" download="second-thought-recap.png">Download the image</a></p>
<pre>${esc(summary)}</pre>
</body></html>`);
      },
      "/w/:token/recap.png": async (req) => {
        const user = await getUserByToken(req.params.token);
        if (!user) return new Response("Not found", { status: 404 });
        const { card } = await recapFor(user.id, last30Days());
        if (!card) return new Response("Couldn't draw the recap", { status: 500 });
        return new Response(card, { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=300" } });
      },
      "/w/:token/quantity": {
        POST: async (req) => {
          const user = await getUserByToken(req.params.token);
          if (!user) return new Response("Not found", { status: 404 });
          const form = await req.formData();
          const itemId = Number(form.get("item"));
          const quantity = Number(form.get("quantity"));
          const item = (await listItems(user.id)).find((i) => i.id === itemId);
          const ok = item && (await setQuantity(db, user.id, itemId, quantity));
          const msg = ok ? `You have ${quantity} × ${item!.description}.` : "Pick a number from 1 to 99.";
          return new Response(null, { status: 303, headers: { Location: `/w/${user.webToken}?msg=${encodeURIComponent(msg)}#item-${itemId}` } });
        },
      },
      "/w/:token/let-go": {
        POST: async (req) => {
          const user = await getUserByToken(req.params.token);
          if (!user) return new Response("Not found", { status: 404 });
          const form = await req.formData();
          const itemId = Number(form.get("item"));
          const how = String(form.get("how")) as LetGo;
          const price = Number(String(form.get("price") ?? "").replace(/[^0-9.]/g, "")) || null;
          const item = (await listItems(user.id)).find((i) => i.id === itemId);
          let msg = "Couldn't update that item.";
          if (item && ["returned", "sold", "donated", "trashed"].includes(how) && (await letGo(db, user.id, itemId, how, price))) {
            const kg = footprintOf(item.type);
            const saved = how !== "trashed" && kg !== null ? ` That's ${describeKg(kg)} saved, est.` : "";
            const several = item.quantity > 1 ? ` (${item.quantity - 1} left)` : "";
            const one = item.quantity > 1 ? `one ${item.description}` : `your ${item.description}`;
            msg =
              how === "trashed" && item.quantity === 1
                ? tossMessage(item.description, isPlural(item.type), item.created_at, await wearCount(db, item.id))
                : {
                    returned: `Marked ${one} as returned${several}.`,
                    sold: `Sold ${one}${price ? ` for ${money(price)}` : ""}${several}.`,
                    donated: `Donated ${one}${several}.`,
                    trashed: `Removed ${one}${several}.`,
                  }[how] + saved;
          }
          return new Response(null, { status: 303, headers: { Location: `/w/${user.webToken}?msg=${encodeURIComponent(msg)}` } });
        },
      },
      "/w/:token/fit/:id/search": async (req) => {
        const user = await getUserByToken(req.params.token);
        const outfit = user && (await getOutfit(user.id, Number(req.params.id)));
        if (!user || !outfit) return new Response("Not found", { status: 404 });
        const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, MAX_FIELD);
        const [items, wears] = await Promise.all([listItems(user.id), listWears(user.id)]);
        const linked = new Set(wears.filter((w) => w.outfitId === outfit.id).map((w) => w.itemId));
        const pool = items.filter((i) => !linked.has(i.id));
        // The typed color joins the groups cache (one model call per new color word).
        const asked = { color_primary: colorIn(q) ?? "unknown", color_secondary: null, pattern: "unknown" } as ExtractedItem;
        const groups = await llmGroups([...pool, asked]).catch(() => exactGroups);
        return Response.json(
          searchItems(q, pool, groups).map((i) => ({ id: i.id, description: i.description, category: i.category, photo: i.photo_url })),
        );
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
          const onlyHere = await itemsOnlyIn(db, user.id, outfit.id);
          return html(fitPage({ user, outfit, linked, sameAs, closet, notice, onlyHere }));
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
            case "delete": {
              const removed = await deleteFitCheck(db, user.id, outfit.id);
              if (removed && outfit.photoUrl) await deletePhoto(user.id, outfit.photoUrl);
              const gone = removed?.length ? ` Also removed ${removed.join(", ")}.` : "";
              const done = removed ? `Deleted your fit check from ${fmtDate(outfit.at)}.${gone}` : "Couldn't delete that fit check.";
              return new Response(null, { status: 303, headers: { Location: `/w/${user.webToken}?msg=${encodeURIComponent(done)}#fits` } });
            }
            case "add": {
              const existing = Number(field("link") || field("existing"));
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
