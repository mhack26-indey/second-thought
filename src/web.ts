import { networkInterfaces } from "node:os";
import QRCode from "qrcode";
import {
  CATEGORIES,
  type Item,
  type Outfit,
  type Reminder,
  type User,
  getOutfitImage,
  getUserByToken,
  listItems,
  listOutfits,
  pendingReminders,
  updateUser,
} from "./store.ts";

// Wardrobe page, one per user at /w/<token>. The token is random so the URL
// doesn't expose a phone number and can't be guessed. Whoever has the link can
// view the closet and edit the profile, same as texting from that number.

const PORT = Number(process.env.PORT ?? 3000);

// Default to the LAN address so the link opens on a phone on the same Wi-Fi.
// Set PUBLIC_URL to a tunnel or deployed URL to reach it from anywhere.
function lanAddress(): string | undefined {
  for (const nets of Object.values(networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
}
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://${lanAddress() ?? "localhost"}:${PORT}`).replace(/\/$/, "");

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

interface PageData {
  user: User;
  items: Item[];
  outfits: Outfit[];
  reminders: Reminder[];
  saved: boolean;
}

function page({ user, items: allItems, outfits, reminders: pending, saved }: PageData): string {
  const sections = CATEGORIES.map((cat) => {
    const items = allItems.filter((i) => i.category === cat);
    if (!items.length) return "";
    return `<section><h2>${cat} <span>${items.length}</span></h2><ul>${items
      .map((i) => `<li>${esc(i.name)}<time>${fmtDate(i.addedAt)}</time></li>`)
      .join("")}</ul></section>`;
  }).join("");

  const photos = outfits
    .map((p) => `<figure><img src="/w/${user.webToken}/photos/${p.id}" loading="lazy" alt=""><figcaption>${fmtDate(p.at)}</figcaption></figure>`)
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
  :root { color-scheme: light dark; --muted: #888; --line: #8883; }
  body { font: 16px/1.4 -apple-system, system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px 16px 48px; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  .sub { color: var(--muted); margin: 0 0 24px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 28px 0 8px; }
  h2 span { font-weight: normal; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); }
  time { color: var(--muted); white-space: nowrap; font-size: 14px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  figure { margin: 0; }
  img { width: 100%; aspect-ratio: 3/4; object-fit: cover; border-radius: 8px; background: var(--line); }
  figcaption { font-size: 12px; color: var(--muted); text-align: center; }
  .empty { color: var(--muted); }
  form { display: grid; gap: 12px; }
  label { display: grid; gap: 4px; font-size: 14px; color: var(--muted); }
  input, select, button { font: inherit; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: inherit; }
  button { background: CanvasText; color: Canvas; border: 0; font-weight: 600; cursor: pointer; }
  .saved { color: #2a9d5c; font-size: 14px; margin: 0; }
</style></head><body>
<h1>${user.name ? `${esc(user.name)}'s` : "Your"} wardrobe</h1>
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
  <label>City<input name="city" value="${esc(user.city ?? "")}" maxlength="${MAX_FIELD}" placeholder="Used for season-aware reminders"></label>
  <label>Daily fit check<select name="fitCheck">${hourOptions}</select></label>
  <button type="submit">Save</button>
</form>
</body></html>`;
}

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
        const [items, outfits, reminders] = await Promise.all([
          listItems(user.id),
          listOutfits(user.id),
          pendingReminders(user.id),
        ]);
        const saved = new URL(req.url).searchParams.has("saved");
        return new Response(page({ user, items, outfits, reminders, saved }), {
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
          const city = field("city");
          if (city) patch.city = city;
          const fitCheck = field("fitCheck");
          const hour = Number(fitCheck);
          if (fitCheck === "off") patch.fitCheckHour = null;
          else if (fitCheck !== "" && Number.isInteger(hour) && hour >= 0 && hour <= 23) patch.fitCheckHour = hour;

          await updateUser(user.id, patch);
          // Post/redirect/get so a refresh doesn't resubmit the form.
          return new Response(null, { status: 303, headers: { Location: `/w/${user.webToken}?saved#profile` } });
        },
      },
      "/w/:token/photos/:id": async (req) => {
        const user = await getUserByToken(req.params.token);
        // Scoped to the token's user, so one link can't load another user's photos.
        const photo = user && (await getOutfitImage(user.id, req.params.id));
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
