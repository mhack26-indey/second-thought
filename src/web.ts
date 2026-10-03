import { networkInterfaces } from "node:os";
import {
  CATEGORIES,
  DEFAULT_FIT_CHECK_HOUR,
  PHOTO_DIR,
  type User,
  getUserByToken,
  pendingReminders,
} from "./store.ts";

// Read-only wardrobe page, one per user at /w/<token>. The token is random so
// the URL doesn't expose a phone number and can't be guessed.

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

const fmtDate = (at: number) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const fmtWhen = (at: number) =>
  new Date(at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function page(user: User): string {
  const sections = CATEGORIES.map((cat) => {
    const items = user.items.filter((i) => i.category === cat);
    if (!items.length) return "";
    return `<section><h2>${cat} <span>${items.length}</span></h2><ul>${items
      .map((i) => `<li>${esc(i.name)}<time>${fmtDate(i.addedAt)}</time></li>`)
      .join("")}</ul></section>`;
  }).join("");

  const photos = [...user.photos]
    .reverse()
    .map((p) => `<figure><img src="/w/${user.webToken}/photos/${p.id}" loading="lazy" alt=""><figcaption>${fmtDate(p.at)}</figcaption></figure>`)
    .join("");

  const hour = user.fitCheckHour === undefined ? DEFAULT_FIT_CHECK_HOUR : user.fitCheckHour;
  const fitCheck = hour === null ? "off" : `${hour % 12 || 12}${hour < 12 ? "am" : "pm"}`;
  const reminders = pendingReminders(user)
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
</style></head><body>
<h1>${user.name ? `${esc(user.name)}'s` : "Your"} wardrobe</h1>
<p class="sub">${user.items.length} items · ${user.photos.length} fit checks${user.city ? ` · ${esc(user.city)}` : ""}</p>
${sections || `<p class="empty">No items yet. Text something like "I have black straight-leg jeans".</p>`}
<h2>Fit checks</h2>
${photos ? `<div class="grid">${photos}</div>` : `<p class="empty">No fit checks yet. Send a photo of today's outfit.</p>`}
<h2>Reminders</h2>
<ul><li>Daily fit check<time>${fitCheck}</time></li>${reminders}</ul>
</body></html>`;
}

export function startWebServer() {
  const server = Bun.serve({
    port: PORT,
    routes: {
      "/w/:token": (req) => {
        const user = getUserByToken(req.params.token);
        if (!user) return new Response("Not found", { status: 404 });
        return new Response(page(user), { headers: { "Content-Type": "text/html; charset=utf-8" } });
      },
      "/w/:token/photos/:id": (req) => {
        const user = getUserByToken(req.params.token);
        // Look the photo up by id so a request can't name an arbitrary file.
        const photo = user?.photos.find((p) => p.id === req.params.id);
        if (!photo) return new Response("Not found", { status: 404 });
        return new Response(Bun.file(`${PHOTO_DIR}/${photo.file}`), { headers: { "Content-Type": photo.mimeType } });
      },
    },
    fetch: () => new Response("Not found", { status: 404 }),
  });
  console.log(`Wardrobe pages on ${PUBLIC_URL} (listening on :${server.port})`);
}
