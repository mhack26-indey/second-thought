import { GUIDE, type GuideEntry, LOOP } from "./guide.ts";
import { BOT_NUMBER_DISPLAY, FONTS, START_LINK, STYLE, esc, svg, tabs } from "./web-style.ts";

// The usage guide as a page: per user at /w/<token>/guide (a tab next to the
// closet), and public at /guide for people who haven't signed up, with the
// same content and nothing personal. The content lives in guide.ts.

const LOOP_ICONS: Record<(typeof LOOP)[number]["icon"], string> = {
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4Z"/><circle cx="12" cy="13" r="3.5"/>',
  bag: '<path d="M5 8h14l-1 13H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  receipt: '<path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
};

const CSS = `
  .lede { color: var(--muted); margin: 0 0 15px; }
  .loop { display: grid; gap: 10px; margin: 0 0 15px; padding: 0; list-style: none; }
  .loop li { display: flex; gap: 15px; align-items: flex-start; padding: 15px; border-radius: var(--r-panel); background: var(--bg-dim); animation: fade .4s ease both; animation-delay: calc(var(--i) * 60ms); }
  .loop .ico { flex: none; width: 48px; height: 48px; display: grid; place-items: center; border-radius: var(--r-btn); background: var(--primary-darker); color: var(--bg); }
  .loop h3 { font-size: 1rem; margin: 2px 0 2px; }
  .loop p { margin: 0; font-size: .9375rem; }
  @media (min-width: 560px) { .loop .ico { width: 64px; height: 64px; border-radius: var(--r-panel); } }
  .toc { display: flex; flex-wrap: wrap; gap: 5px; margin: 10px 0 0; }
  .toc a { font-size: .8125rem; padding: 4px 12px; border-radius: var(--r-pill); background: var(--bg-dim); color: var(--neutral); text-decoration: none; }
  .cmds { display: grid; gap: 0; }
  .cmds li { padding: 12px 15px; border-radius: var(--r-card); }
  .cmds li:nth-child(odd) { background: var(--bg-dim); }
  .cmd-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  .cmd { display: inline-block; padding: 4px 14px; border-radius: 18px; background: var(--primary); color: var(--neutral); font-family: var(--sans); font-weight: 700; font-size: .9375rem; line-height: 1.45; overflow-wrap: anywhere; }
  .cmd.photo { background: var(--secondary); font-weight: 400; }
  .copy { flex: none; margin-top: 2px; padding: 3px 10px; font-size: .75rem; font-weight: 400; border-radius: var(--r-pill); background: transparent; color: var(--primary-darkest); border: 1px solid var(--bg-dimmer); }
  .copy:hover { background: #fff; color: var(--neutral); }
  .copy.done { background: var(--primary-superdark); color: var(--bg); border-color: transparent; }
  .does { margin: 6px 0 0; }
  .reply { margin: 6px 0 0; padding: 6px 12px; border-radius: 14px 14px 14px 4px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.08); color: var(--text); font-size: .875rem; width: fit-content; max-width: 100%; }
  .reply::before { content: "Bot: "; color: var(--muted); }
  .brandbar { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin: 0 0 15px; }
  .brandbar a.home { font-family: var(--serif); font-weight: 700; color: var(--neutral); text-decoration: none; }
  .pill { display: inline-flex; align-items: center; gap: 6px; padding: 8px 18px; border-radius: var(--r-pill); background: var(--primary); color: var(--neutral); font-weight: 700; text-decoration: none; box-shadow: var(--shadow-sm); transition: transform var(--ease); }
  .pill:active { transform: scale(.95); }
  .start { margin: 30px 0 0; padding: 20px; border-radius: var(--r-panel); background: var(--ink); color: var(--bg); text-align: center; }
  .start h2 { color: var(--primary); margin: 0 0 10px; }
  .start p { margin: 0 0 15px; }
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
    : `<div class="brandbar"><a class="home" href="/">Second Thought</a><a class="pill shine" href="${esc(START_LINK)}">Text the bot</a></div><h1>How it works</h1>`;
  const loop = LOOP.map(
    (l, i) => `<li style="--i:${i}"><i class="ico">${svg(LOOP_ICONS[l.icon], 28)}</i><div><h3>${esc(l.title)}</h3><p>${esc(l.line)}</p></div></li>`,
  ).join("");
  const sections = GUIDE.map(
    (s) => `<section id="${anchor(s.title)}"><h2>${esc(s.title)}</h2><ul class="cmds">${s.entries.map(entry).join("")}</ul></section>`,
  ).join("");
  const toc = GUIDE.map((s) => `<a href="#${anchor(s.title)}">${esc(s.title)}</a>`).join("");
  const signup = token
    ? ""
    : `<div class="start"><h2>Try it</h2><p>No app, no account. Text the bot and send your first fit check.</p><a class="pill shine" href="${esc(START_LINK)}">Text ${esc(BOT_NUMBER_DISPLAY)}</a></div>`;

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
