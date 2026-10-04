import { GUIDE, type GuideEntry, LOOP } from "./guide.ts";
import { BOT_NUMBER_DISPLAY, FONTS, START_LINK, STYLE, TELEGRAM_HANDLE, TELEGRAM_LINK, esc, publicNav, svg, tabs } from "./web-style.ts";

// The usage guide as a page: per user at /w/<token>/guide (a tab next to the
// closet), and public at /guide for people who haven't signed up, with the
// same content and nothing personal. The content lives in guide.ts.

const LOOP_ICONS: Record<(typeof LOOP)[number]["icon"], string> = {
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4Z"/><circle cx="12" cy="13" r="3.5"/>',
  bag: '<path d="M5 8h14l-1 13H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  receipt: '<path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
};

const CSS = `
  .lede { color: var(--charcoal); margin: 0 0 18px; font-size: 18px; max-width: 36ch; animation: rise .5s var(--ease) .06s both; }
  /* The three-photo loop: numbered soft-gray cards. */
  .loop { display: grid; gap: 8px; margin: 0 0 12px; padding: 0; list-style: none; }
  .loop li { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 18px; align-items: start; padding: 24px; background: var(--cloud); animation: rise .5s var(--ease) both; animation-delay: calc(var(--i) * 70ms + 100ms); }
  .loop .num { grid-row: span 2; font-family: var(--display); font-size: 44px; line-height: .85; }
  .loop .ico { display: none; }
  .loop h3 { font-size: 18px; }
  .loop p { margin: 0; color: var(--charcoal); font-size: 15px; }
  @media (min-width: 680px) { .loop { grid-template-columns: repeat(3, 1fr); } .loop li { grid-template-columns: 1fr; } .loop .num { grid-row: auto; margin-bottom: 12px; } }
  /* Section jump links: outlined chips that scroll sideways on a phone. */
  .toc { display: flex; gap: 8px; margin: 18px -16px 0; padding: 0 16px 4px; overflow-x: auto; scrollbar-width: none; }
  .toc a { flex: none; display: inline-flex; align-items: center; height: 40px; padding: 0 16px; border: 1px solid var(--hairline); border-radius: var(--r-pill); font-size: 14px; font-weight: 500; text-decoration: none;
    transition: border-color .2s var(--ease), background-color .2s var(--ease), color .2s var(--ease); }
  .toc a:hover { border-color: var(--ink); }
  .toc a:active { background: var(--ink); color: var(--canvas); }
  section { scroll-margin-top: 64px; }
  /* Commands: hairline rows; the command as a chip, a round copy button. */
  .cmds { border-top: 1px solid var(--hairline-soft); }
  .cmds li { padding: 18px 0; border-bottom: 1px solid var(--hairline-soft); }
  .cmd-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .cmd { display: inline-block; padding: 7px 16px; border: 1px solid var(--hairline); border-radius: 20px; background: var(--canvas); color: var(--ink); font: 500 15px/1.4 var(--sans); overflow-wrap: anywhere; }
  .cmd.photo { background: var(--cloud); border-color: var(--cloud); }
  .copy { flex: none; height: 36px; padding: 0 14px; font-size: 13px; background: var(--cloud); color: var(--ink); }
  .copy:hover { opacity: 1; background: var(--cloud-press); }
  .copy.done { background: var(--success); color: var(--canvas); }
  .does { margin: 8px 0 0; color: var(--charcoal); }
  /* An example reply, like an incoming message. */
  .reply { margin: 8px 0 0; padding: 8px 14px; border-radius: 18px 18px 18px 4px; background: var(--cloud); color: var(--ink); font-size: 14px; width: fit-content; max-width: 100%; }
  .reply::before { content: "Bot · "; color: var(--mute); font-weight: 500; }
  /* Signing up: a black campaign tile. */
  .start { margin: var(--section) -16px 0; padding: 40px 16px; background: var(--ink); color: var(--canvas); }
  .start h2 { font-family: var(--display); font-weight: 400; text-transform: uppercase; font-size: 56px; line-height: .9; color: var(--canvas); margin: 0 0 12px; }
  .start p { margin: 0 0 24px; color: var(--stone); }
  @media (min-width: 760px) { .start { margin-left: 0; margin-right: 0; padding: 48px; } }
`;

const anchor = (title: string) => title.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");

function entry(e: GuideEntry): string {
  const pill = e.photo
    ? `<span class="cmd photo">${esc(e.command)}</span>`
    : `<code class="cmd">${esc(e.command)}</code><button type="button" class="copy" data-copy="${esc(e.command)}" aria-label="Copy &ldquo;${esc(e.command)}&rdquo;">Copy</button>`;
  return `<li data-intent="${e.intent}"><div class="cmd-row">${pill}</div><p class="does">${esc(e.does)}</p>${e.reply ? `<p class="reply">${esc(e.reply)}</p>` : ""}</li>`;
}

/** The guide; `token` makes it the wardrobe tab, without it it's the public page. */
export function guidePage(token?: string): string {
  const header = token
    ? `${tabs(token, "guide")}<h1>How it works</h1>`
    : `${publicNav()}<h1>How it works</h1>`;
  const loop = LOOP.map(
    (l, i) => `<li style="--i:${i}"><span class="num">0${i + 1}</span><i class="ico">${svg(LOOP_ICONS[l.icon], 28)}</i><div><h3>${esc(l.title)}</h3><p>${esc(l.line)}</p></div></li>`,
  ).join("");
  const sections = GUIDE.map(
    (s) => `<section id="${anchor(s.title)}"><h2>${esc(s.title)}</h2><ul class="cmds">${s.entries.map(entry).join("")}</ul></section>`,
  ).join("");
  const toc = GUIDE.map((s) => `<a href="#${anchor(s.title)}">${esc(s.title)}</a>`).join("");
  const signup = token
    ? ""
    : `<div class="start"><h2>Try it.</h2><p>No app, no account. Text the bot and send your first fit check.</p><a class="pill pill-light" href="${esc(START_LINK)}">Text ${esc(BOT_NUMBER_DISPLAY)} <span class="arrow" aria-hidden="true">→</span></a> <a class="pill pill-light" href="${esc(TELEGRAM_LINK)}">Open ${esc(TELEGRAM_HANDLE)} in Telegram <span class="arrow" aria-hidden="true">→</span></a></div>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Guide · Second Thought</title>
<meta name="description" content="Everything you can text Second Thought: fit checks, do I have this?, returns, and more.">
${FONTS}
<style>
${STYLE}${CSS}</style></head><body>
${header}
<p class="lede">Three photos do most of the work:</p>
<ul class="loop">${loop}</ul>
<p class="lede">Everything else is a text. Tap Copy, then paste it into Messages.</p>
<nav class="toc" aria-label="Sections">${toc}</nav>
${sections}
${signup}
<script>
(() => {
  document.addEventListener("click", async (e) => {
    const button = e.target.closest("button.copy");
    if (!button) return;
    const text = button.dataset.copy;
    try { await navigator.clipboard.writeText(text); }
    catch {
      // Older browsers: copy from a hidden field.
      const field = Object.assign(document.createElement("textarea"), { value: text });
      document.body.append(field); field.select(); document.execCommand("copy"); field.remove();
    }
    button.textContent = "Copied";
    button.classList.add("done");
    setTimeout(() => { button.textContent = "Copy"; button.classList.remove("done"); }, 1500);
  });
})();
</script>
</body></html>`;
}

const page = (body: string) => new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });

/** /w/<token>/guide: only for a real wardrobe token, like the other tabs. */
export async function userGuideResponse(token: string, userByToken: (token: string) => Promise<{ webToken: string } | undefined>): Promise<Response> {
  const user = await userByToken(token);
  if (!user) return new Response("Not found", { status: 404 });
  return page(guidePage(user.webToken));
}

/** /guide: the same guide for anyone, with nothing personal on it. */
export const publicGuideResponse = () => page(guidePage());
