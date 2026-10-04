import type { Category } from "./closet/categories.ts";

// Shared by every web page (web.ts, guide-page.ts): the design system
// (docs/DESIGN-nike.md) as CSS, icons, escaping, and the bot's number.
// Nothing here touches the database, so pages built from it can be tested.

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// docs/DESIGN-nike.md, with its open-source substitutes: Inter 400/500 for
// Helvetica Now, Bebas Neue for the uppercase campaign display tier.
export const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500&display=swap">`;

export const TOKENS = `  :root {
    color-scheme: light;
    /* Black, white and one soft gray carry the chrome; color is for signals only. */
    --canvas: #ffffff; --cloud: #f5f5f5; --cloud-press: #ebebeb; --ink: #111111; --charcoal: #39393b;
    --mute: #707072; --stone: #9e9ea0; --hairline: #cacacb; --hairline-soft: #e5e5e5;
    --sale: #d30005; --success: #007d48;
    --display: "Bebas Neue", "Anton", Impact, "Arial Narrow", sans-serif;
    --sans: "Inter", "Helvetica Neue", Helvetica, Arial, sans-serif;
    --r-search: 24px; --r-pill: 30px; --r-full: 9999px;
    --section: 48px;
    --ease: cubic-bezier(.2, .8, .2, 1);
  }
  @media (max-width: 599px) { :root { --section: 32px; } }
  /* Pages cross-fade into each other (tabs, links), the nav staying put. */
  @view-transition { navigation: auto; }
  ::view-transition-old(root), ::view-transition-new(root) { animation-duration: .28s; animation-timing-function: var(--ease); }
  @keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
  /* Pills: black on light, white on dark, soft gray as the quiet alternative. */
  .pill { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 48px; padding: 0 28px; border: 0; border-radius: var(--r-pill);
    background: var(--ink); color: var(--canvas); font: 500 16px/1.5 var(--sans); text-decoration: none; cursor: pointer; white-space: nowrap;
    transition: opacity .25s var(--ease), transform .2s var(--ease), background-color .25s var(--ease); }
  .pill:hover { opacity: .82; }
  .pill:active { transform: scale(.96); opacity: .7; }
  .pill-light { background: var(--canvas); color: var(--ink); }
  .pill-soft { background: var(--cloud); color: var(--ink); }
  .pill-sm { height: 40px; padding: 0 18px; font-size: 14px; }
  .pill .arrow { transition: transform .25s var(--ease); }
  .pill:hover .arrow { transform: translateX(3px); }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
    ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation: none !important; }
  }
`;

export const STYLE = `${TOKENS}
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; }
  html, body { overflow-x: clip; }
  body { font: 400 16px/1.5 var(--sans); color: var(--ink); background: var(--canvas); max-width: 760px; margin: 0 auto; padding: 0 16px 64px;
    -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
  h1, h2, h3 { font-weight: 500; color: var(--ink); margin: 0; }
  /* The page's one campaign moment: towering uppercase display. */
  h1 { font-family: var(--display); font-weight: 400; text-transform: uppercase; font-size: 56px; line-height: .9; letter-spacing: .005em; margin: 8px 0 18px; animation: rise .5s var(--ease) both; }
  @media (min-width: 600px) { h1 { font-size: 80px; } }
  h2 { font-size: 24px; line-height: 1.2; margin: var(--section) 0 18px; }
  h2 span { font-size: 16px; color: var(--mute); font-weight: 400; margin-left: 4px; }
  h3 { font-size: 16px; line-height: 1.5; }
  a { color: var(--ink); text-underline-offset: 3px; text-decoration-thickness: 1px; }
  b, strong { font-weight: 500; }
  img { display: block; }
  .sub { color: var(--mute); font-size: 14px; font-weight: 500; margin: 0 0 18px; }
  ul { list-style: none; padding: 0; margin: 0; }
  time { color: var(--mute); white-space: nowrap; font-size: 14px; font-weight: 500; }
  .empty { color: var(--mute); }

  /* Sticky primary nav: brand left, tabs right, the active one underlined. */
  .nav { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; justify-content: space-between; gap: 12px; height: 56px; margin: 0 0 8px; view-transition-name: nav; }
  .nav::before { content: ""; position: absolute; inset: 0 -100vmax; z-index: -1; background: rgba(255, 255, 255, .9);
    -webkit-backdrop-filter: saturate(1.8) blur(14px); backdrop-filter: saturate(1.8) blur(14px); box-shadow: inset 0 -1px 0 var(--hairline-soft); }
  .nav .brand { font-family: var(--display); font-size: 26px; line-height: 1; letter-spacing: .02em; text-transform: uppercase; color: var(--ink); text-decoration: none; white-space: nowrap; }
  .tabs { display: flex; gap: 18px; height: 100%; overflow-x: auto; scrollbar-width: none; }
  .tabs a { display: flex; align-items: center; height: 100%; font-size: 15px; font-weight: 500; color: var(--mute); text-decoration: none; white-space: nowrap;
    box-shadow: inset 0 -2px 0 transparent; transition: color .25s var(--ease), box-shadow .25s var(--ease); }
  .tabs a:hover { color: var(--ink); }
  .tabs a[aria-current="page"] { color: var(--ink); box-shadow: inset 0 -2px 0 var(--ink); }

  /* Plain lists (reminders, what you saved, the fit check editor): hairline rows. */
  .rows { border-top: 1px solid var(--hairline-soft); }
  .rows li { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 18px 0; border-bottom: 1px solid var(--hairline-soft); }
  .rows li small { color: var(--mute); }

  /* Impact stats: flat soft-gray tiles, the number large. */
  .stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 0 0 12px; }
  .stat { display: flex; flex-direction: column; gap: 12px; padding: 18px; background: var(--cloud); animation: rise .5s var(--ease) both; animation-delay: calc(var(--i, 0) * 60ms + 80ms); }
  .stat .ico { display: block; width: 28px; height: 28px; color: var(--ink); }
  .stat .ico svg { width: 28px; height: 28px; }
  .stat b { display: block; font-size: 28px; line-height: 1.1; font-weight: 500; letter-spacing: -.01em; }
  .stat small { display: block; color: var(--mute); font-size: 13px; font-weight: 500; line-height: 1.35; margin-top: 2px; }
  @media (min-width: 600px) { .stats { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
  .links { display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center; margin: 12px 0; font-weight: 500; }

  /* Category tiles: icon cards on soft gray. */
  .tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 12px 0 0; }
  .tile { aspect-ratio: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 8px; border: 0; border-radius: 0;
    background: var(--cloud); color: var(--ink); font: inherit; cursor: pointer;
    transition: background-color .25s var(--ease), transform .2s var(--ease); animation: rise .5s var(--ease) both; animation-delay: calc(var(--i, 0) * 45ms + 120ms); }
  .tile .ico { display: block; color: var(--ink); margin-bottom: 4px; }
  .tile .ico svg { width: 36px; height: 36px; }
  .tile span { font-weight: 500; font-size: 14px; }
  .tile small { color: var(--mute); font-size: 12px; font-weight: 500; }
  .tile:hover { background: var(--cloud-press); }
  .tile:active { transform: scale(.96); }
  @media (min-width: 600px) { .tiles { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
  .closet-head { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; margin: 8px 0 18px; }
  .closet-head h2 { font-family: var(--display); font-weight: 400; text-transform: uppercase; font-size: 44px; line-height: .9; margin: 0; }
  .back { display: inline-flex; align-items: center; gap: 6px; background: transparent; color: var(--ink); border: 0; padding: 8px 0; font: 500 14px/1.5 var(--sans); cursor: pointer; text-decoration: none; }
  .back:hover { text-decoration: underline; }
  /* With JavaScript: tiles first, one category at a time. Without it, every list shows. */
  .js .closet { display: none; }
  .js.open .tiles { display: none; }
  .js.open .closet { display: block; }
  .js .catlist { display: none; }
  .js .catlist.shown { display: block; }
  .js .closet.one .catlist h2 { display: none; }

  /* Closet items: product cards. Flat, no padding, the photo full-bleed on soft gray. */
  .cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 30px 8px; }
  @media (min-width: 680px) { .cards { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  .card { display: flex; flex-direction: column; gap: 8px; min-width: 0; background: var(--canvas); animation: rise .5s var(--ease) both; animation-delay: calc(var(--i, 0) * 45ms); scroll-margin-top: 72px; }
  .card.has-photos { cursor: pointer; }
  .pic { aspect-ratio: 4 / 5; width: 100%; overflow: hidden; background: var(--cloud); display: grid; place-items: center; color: var(--stone); }
  .pic img { width: 100%; height: 100%; object-fit: cover; transition: transform .7s var(--ease); }
  @media (hover: hover) { .card:hover .pic img { transform: scale(1.04); } }
  .card:active .pic { opacity: .85; }
  .card-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .card-title { font-weight: 500; line-height: 1.35; overflow-wrap: anywhere; }
  .card-sub { margin: 0; color: var(--mute); font-size: 13px; font-weight: 500; line-height: 1.4; }
  .tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
  .tag { display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px; border: 1px solid var(--hairline); border-radius: var(--r-pill); background: var(--canvas); color: var(--ink); font-size: 12px; font-weight: 500; }
  .tag svg { width: 12px; height: 12px; }
  .card-foot { display: flex; flex-direction: column; gap: 4px; margin-top: 2px; font-size: 13px; color: var(--mute); font-weight: 500; }
  .card-foot .actions { display: flex; gap: 12px; flex-wrap: wrap; }
  .count { color: var(--mute); font-weight: 500; }
  .thumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; text-align: left; }
  .thumbs img { width: 22px; height: 28px; object-fit: cover; background: var(--cloud); }
  .thumbs small { color: var(--mute); font-size: 12px; font-weight: 500; margin-left: 4px; }
  :target { animation: flash 1.6s var(--ease); }
  @keyframes flash { from { box-shadow: 0 0 0 3px var(--ink); } to { box-shadow: 0 0 0 3px transparent; } }

  /* Closet table (one section per category): hairline rows. */
  .table-wrap { overflow-x: auto; margin: 0 -16px; padding: 0 16px; }
  table.closet-table { width: 100%; border-collapse: collapse; font-size: 14px; }
  .closet-table caption { text-align: left; font-size: 24px; font-weight: 500; padding: var(--section) 0 12px; }
  .closet-table th { text-align: left; font-weight: 500; color: var(--mute); padding: 12px 8px; border-bottom: 1px solid var(--hairline); white-space: nowrap; }
  .closet-table td { padding: 12px 8px; border-bottom: 1px solid var(--hairline-soft); vertical-align: middle; }
  .closet-table img { width: 36px; height: 45px; object-fit: cover; background: var(--cloud); }

  /* Fit check photos: a 2-up grid, photos on soft gray. */
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 30px 8px; }
  @media (min-width: 680px) { .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  figure { margin: 0; min-width: 0; scroll-margin-top: 72px; animation: rise .5s var(--ease) both; }
  figure > img { width: 100%; aspect-ratio: 4 / 5; object-fit: cover; background: var(--cloud); transition: opacity .3s var(--ease); }
  figure > img:hover { opacity: .9; }
  figcaption { font-size: 14px; color: var(--ink); font-weight: 500; margin: 8px 0 2px; }
  figcaption .edit { color: var(--mute); font-weight: 500; }
  .found li { padding: 1px 0; font-size: 13px; line-height: 1.4; }
  .found a { color: var(--mute); text-decoration: none; }
  .found a:hover { color: var(--ink); text-decoration: underline; }
  .edit { font-size: 14px; font-weight: 500; }

  /* The photo viewer. */
  dialog.viewer { width: 100%; max-width: 760px; height: 100%; max-height: 100%; margin: 0 auto; padding: 0; border: 0; background: var(--canvas); color: var(--ink); }
  dialog.viewer[open] { animation: fade .25s var(--ease); }
  dialog.viewer::backdrop { background: rgba(17, 17, 17, .6); }
  .viewer header { position: sticky; top: 0; display: flex; justify-content: space-between; align-items: center; gap: 12px; height: 56px; padding: 0 16px; background: rgba(255,255,255,.92);
    backdrop-filter: blur(14px); box-shadow: inset 0 -1px 0 var(--hairline-soft); z-index: 1; }
  .viewer header h3 { margin: 0; font-size: 16px; }
  .viewer header button { width: 40px; height: 40px; padding: 0; display: grid; place-items: center; font-size: 18px; line-height: 1; background: var(--cloud); color: var(--ink); border: 0; border-radius: var(--r-full); }
  .viewer .shots { display: grid; gap: var(--section); padding: 16px; }
  .viewer figure img { aspect-ratio: auto; max-height: 78vh; width: 100%; object-fit: contain; background: var(--cloud); }
  .viewer figcaption a { color: var(--ink); }
  ::view-transition-group(*) { animation-duration: .35s; animation-timing-function: var(--ease); }

  /* Forms: search-pill fields, pill buttons. */
  form { display: grid; gap: 18px; }
  label { display: grid; gap: 8px; font-size: 14px; font-weight: 500; color: var(--charcoal); }
  input, select { font: 400 16px/1.5 var(--sans); height: 48px; padding: 0 18px; border: 2px solid transparent; border-radius: var(--r-search); background: var(--cloud); color: var(--ink);
    transition: background-color .2s var(--ease), border-color .2s var(--ease), box-shadow .2s var(--ease); -webkit-appearance: none; appearance: none; }
  select { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' fill='none' stroke='%23111' stroke-width='1.6'%3E%3Cpath d='m1 1.5 5 5 5-5'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 18px center; padding-right: 40px; }
  input:focus, select:focus { outline: none; background-color: var(--canvas); border-color: var(--ink); box-shadow: 0 0 0 6px var(--cloud); }
  button { font: 500 16px/1.5 var(--sans); height: 48px; padding: 0 28px; border: 0; border-radius: var(--r-pill); background: var(--ink); color: var(--canvas); cursor: pointer;
    transition: opacity .25s var(--ease), transform .2s var(--ease), background-color .25s var(--ease); }
  button:hover { opacity: .82; }
  button:active { transform: scale(.96); opacity: .7; }
  button:focus-visible, a:focus-visible, summary:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
  /* Buttons that aren't pills: tiles, photo strips, the back link, the viewer's close. */
  button.tile, button.thumbs, button.back { height: auto; border-radius: 0; }
  button.tile:hover, button.thumbs:hover, button.back:hover { opacity: 1; }
  button.thumbs { padding: 0; background: none; color: inherit; }
  button.back { padding: 8px 0; background: transparent; color: var(--ink); }
  button.quiet, .letgo button.quiet, .fit button.quiet { background: var(--cloud); color: var(--ink); }
  button.quiet:hover { opacity: 1; background: var(--cloud-press); }
  button.danger { background: var(--ink); color: var(--canvas); }
  button:disabled { opacity: .35; cursor: default; transform: none; }
  .saved { color: var(--success); font-size: 14px; font-weight: 500; margin: 0; animation: fade .3s var(--ease); }
  .error { color: var(--sale); font-size: 14px; font-weight: 500; margin: 0; }
  .notice { padding: 14px 18px; background: var(--cloud); color: var(--ink); font-weight: 500; margin: 0 0 18px; animation: rise .4s var(--ease) both; }
  details > summary { list-style: none; }
  details > summary::-webkit-details-marker { display: none; }
  details[open] > form, details[open] > ul, details[open] > div, details[open] > p { animation: rise .3s var(--ease) both; }
  .letgo summary { cursor: pointer; color: var(--ink); font-size: 13px; font-weight: 500; text-decoration: underline; text-underline-offset: 3px; }
  .letgo form { display: grid; gap: 8px; margin-top: 8px; min-width: 0; }
  .letgo form div { display: flex; gap: 8px; }
  .letgo input { width: 100%; min-width: 0; height: 40px; padding: 0 14px; font-size: 14px; }
  .letgo button { height: 40px; padding: 0 16px; font-size: 14px; }
  .skipped { margin: 0 0 12px; }
  .skipped summary { cursor: pointer; font-size: 14px; font-weight: 500; text-decoration: underline; text-underline-offset: 3px; margin-bottom: 12px; }
  .skipped li small { display: block; }
  .skipped .note { color: var(--mute); font-size: 12px; margin: 12px 0 0; }
  fieldset.week { border: 0; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 8px; }
  fieldset.week legend { font-size: 14px; font-weight: 500; color: var(--charcoal); margin-bottom: 8px; padding: 0; }
  /* Filter chips: outlined, flipping to black when picked. */
  label.check { position: relative; display: inline-flex; align-items: center; height: 40px; padding: 0 16px; border: 1px solid var(--hairline); border-radius: var(--r-pill); background: var(--canvas);
    color: var(--ink); font-size: 14px; font-weight: 500; cursor: pointer; transition: background-color .2s var(--ease), color .2s var(--ease), border-color .2s var(--ease); }
  label.check:hover { border-color: var(--ink); }
  label.check:has(input:checked) { background: var(--ink); border-color: var(--ink); color: var(--canvas); }
  label.check:has(input:focus-visible) { outline: 2px solid var(--ink); outline-offset: 3px; }
  label.check input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .sizes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .sizes input { width: 100%; min-width: 0; }

  /* The fit check editor. */
  .fit img.photo { width: 100%; max-height: 72vh; object-fit: contain; background: var(--cloud); animation: fade .4s var(--ease); }
  .fit .rows li { align-items: center; flex-wrap: wrap; }
  .fit form { display: flex; gap: 8px; align-items: center; margin: 0; }
  .fit form:has(> .danger) { flex-direction: column; align-items: flex-start; gap: 12px; }
  .fit li > form select { max-width: 200px; height: 40px; font-size: 14px; }
  .fit li > div { display: flex; gap: 8px; flex-wrap: wrap; }
  .fit button.quiet { height: 40px; padding: 0 16px; font-size: 14px; }
  .fit .add { display: grid; gap: 12px; }
  .fit .add div { display: flex; gap: 8px; flex-wrap: wrap; }
  .fit .add > input { width: 100%; }
  .suggest { margin: 0; }
  .suggest button { display: flex; align-items: center; gap: 12px; width: 100%; height: auto; padding: 8px; background: transparent; color: var(--ink); border-radius: 0; font-weight: 400; text-align: left; }
  .suggest button:hover, .suggest button[aria-selected="true"] { background: var(--cloud); opacity: 1; }
  .suggest img { width: 36px; height: 45px; object-fit: cover; flex: none; background: var(--cloud); }
  .suggest span { flex: 1; }
  .suggest small { color: var(--mute); }
  .fit details summary { cursor: pointer; font-size: 14px; font-weight: 500; text-decoration: underline; text-underline-offset: 3px; }
  .fit details div { display: flex; gap: 8px; margin-top: 8px; }

  /* Recommendation rows ("Let go", "Before winter"): photo on soft gray, then the case and the way out. */
  .picks { border-top: 1px solid var(--hairline-soft); }
  .pick { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 18px; padding: 18px 0; border-bottom: 1px solid var(--hairline-soft); animation: rise .5s var(--ease) both; animation-delay: calc(var(--i, 0) * 60ms); }
  .pick .ico { width: 76px; height: 95px; display: grid; place-items: center; overflow: hidden; background: var(--cloud); color: var(--stone); }
  .pick .ico img { width: 100%; height: 100%; object-fit: cover; }
  .pick h3 { font-size: 16px; margin: 0 0 4px; overflow-wrap: anywhere; display: flex; align-items: baseline; gap: 8px; }
  .pick .n { flex: none; display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: var(--r-full); background: var(--ink); color: var(--canvas); font-size: 12px; font-weight: 500; transform: translateY(-1px); }
  .pick p { margin: 0 0 4px; font-size: 14px; color: var(--charcoal); }
  .pick .exit { color: var(--ink); font-weight: 500; }
  .pick .exit-return { color: var(--success); }
  .pick .exit a { margin-left: 4px; }

  /* The recap page. */
  .recap img { width: 100%; height: auto; background: var(--cloud); animation: rise .5s var(--ease) both; }
  .recap pre { white-space: pre-wrap; font: inherit; color: var(--charcoal); }
`;

// Category icons: simple line drawings (24×24, drawn in the text color).
export const ICONS: Record<Category | "all", string> = {
  top: '<path d="M8 3 4 6l2 4 2-1v12h8V9l2 1 2-4-4-3c-.5 1.5-2 2.5-4 2.5S8.5 4.5 8 3Z"/>',
  bottom: '<path d="M7 3h10l1 18h-4.5L12 10l-1.5 11H6L7 3Z"/><path d="M7 6h10"/>',
  dress: '<path d="M9 3h6l-1 5 4 13H6l4-13-1-5Z"/><path d="M10 8h4"/>',
  outerwear: '<path d="M8 3 3 6v15h5v-9M16 3l5 3v15h-5v-9"/><path d="M8 3c1 2 2.5 3 4 3s3-1 4-3M8 21h8V9M12 6v15"/>',
  shoes: '<path d="M3 17v-5l5-1 3-4c1 1 1.5 3 1.5 3l7.5 3c1 .5 1.5 1.5 1.5 2.5V17Z"/><path d="M3 17v2h18v-2"/>',
  accessory: '<path d="M5 9h14l-1 12H6L5 9Z"/><path d="M9 9V7a3 3 0 0 1 6 0v2"/>',
  jewelry: '<circle cx="12" cy="14" r="6"/><path d="m10 5 2-2 2 2-2 3-2-3Z"/>',
  all: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
};
export const svg = (paths: string, size = 36) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${paths}</svg>`;
export const icon = (cat: Category | "all", size = 36) => svg(ICONS[cat], size);

// Icons for the impact cards and tags.
export const STAT_ICONS = {
  skipped: '<path d="M5 8h14l-1 13H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/><path d="m4 4 16 16"/>',
  money: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9v.01M18 15v.01"/>',
  worn: '<path d="M12 5a2 2 0 1 1 2 2c-1 0-2 .7-2 1.6V9l8.5 6.2c.8.6.4 1.8-.6 1.8H4.1c-1 0-1.4-1.2-.6-1.8L12 9"/>',
  co2: '<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14Z"/><path d="M5 19 13 11"/>',
};
export const PIN = '<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11Z"/><circle cx="12" cy="10" r="2"/>';
export const SEASONS: Record<string, string> = { warm: "warm weather", cold: "cold weather", all: "all seasons" };
export const CATEGORY_NAMES: Record<Category, string> = {
  top: "top",
  bottom: "bottom",
  dress: "dress",
  outerwear: "outerwear",
  shoes: "shoes",
  accessory: "accessory",
  jewelry: "jewelry",
};

// The number people text to start. Defaults to our Spectrum line; override
// with BOT_NUMBER if the line changes (`photon spectrum lines list`).
export const BOT_NUMBER = process.env.BOT_NUMBER?.trim() || "+16282679185";
export const START_LINK = `sms:${BOT_NUMBER}`;
// Pretty-printed for the page; the sms: link keeps the E.164 form.
export const BOT_NUMBER_DISPLAY = /^\+1\d{10}$/.test(BOT_NUMBER)
  ? BOT_NUMBER.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3")
  : BOT_NUMBER;

/** The wardrobe pages' nav: the brand, then the closet, its fit checks, and the guide. */
export function tabs(token: string, current: "closet" | "guide"): string {
  const base = `/w/${encodeURIComponent(token)}`;
  const tab = (href: string, label: string, here: boolean) => `<a href="${href}"${here ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<header class="nav"><a class="brand" href="${base}">Second Thought</a><nav class="tabs" aria-label="Wardrobe">${tab(base, "Closet", current === "closet")}${tab(`${base}#fits`, "Fit checks", false)}${tab(`${base}/guide`, "Guide", current === "guide")}</nav></header>`;
}

/** The nav for public pages: the brand and one way in. */
export function publicNav(): string {
  return `<header class="nav"><a class="brand" href="/">Second Thought</a><a class="pill pill-sm" href="${esc(START_LINK)}">Text the bot</a></header>`;
}
