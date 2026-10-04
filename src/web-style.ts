import type { Category } from "./closet/categories.ts";

// Shared by every web page (web.ts, guide-page.ts): the design system
// (docs/design-system.md) as CSS, icons, escaping, and the bot's number.
// Nothing here touches the database, so pages built from it can be tested.

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// The design system (docs/design-system.md): tokens as CSS variables,
// Merriweather 700 headings, Inter 400 body, a 1.414 type scale.
export const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Merriweather:700|Inter:400&display=swap">`;

export const TOKENS = `  :root {
    color-scheme: light;
    --bg: #f5fcef; --bg-dim: #ebf2e5; --bg-dimmer: #e0e8d8;
    --primary: #a1cc80; --primary-darker: #789960; --primary-darkest: #647f50; --primary-superdark: #506640;
    --secondary: #95e8cf; --accent: #f29450; --neutral: #25400c; --ink: #000; --text: #333; --muted: #5d6658;
    --serif: "Merriweather", Georgia, serif; --sans: "Inter", -apple-system, system-ui, sans-serif;
    --text-sm: .707rem; --text-xl: 1.414rem; --text-2xl: 1.999rem; --text-3xl: 2.827rem; --text-4xl: 3.997rem;
    --r-card: 8px; --r-btn: 12px; --r-panel: 16px; --r-pill: 9999px;
    --shadow-sm: 0 4px 8px rgba(0,0,0,.2); --shadow-md: 0 10px 30px rgba(0,0,0,.2); --shadow-lg: 0 10px 30px rgba(0,0,0,.3);
    --ease: .3s ease;
  }
  /* Film grain over everything, very faint. */
  body::before { content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 100; opacity: .05;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
  /* Primary buttons: a blurred white sheen slides across on hover. */
  .shine { position: relative; overflow: hidden; isolation: isolate; }
  .shine::after { content: ""; position: absolute; top: -50%; left: -60%; width: 40%; height: 200%; z-index: -1;
    background: linear-gradient(100deg, transparent, rgba(255,255,255,.75), transparent); filter: blur(6px);
    transform: translateX(-120%) rotate(12deg); transition: transform .6s ease; }
  .shine:hover::after { transform: translateX(420%) rotate(12deg); }
  @keyframes fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { *, *::after { animation: none !important; transition: none !important; } }
`;

export const STYLE = `${TOKENS}
  * { box-sizing: border-box; }
  body { font: 400 16px/1.5 var(--sans); color: var(--text); background: var(--bg); max-width: 600px; margin: 0 auto; padding: 24px 16px 56px; }
  h1, h2, h3 { font-family: var(--serif); font-weight: 700; color: var(--neutral); }
  h1 { font-size: var(--text-2xl); line-height: 1.2; margin: 0 0 15px; }
  h2 { font-size: var(--text-xl); line-height: 1.3; color: var(--primary-darker); margin: 30px 0 10px; }
  h2 span { font-family: var(--sans); font-weight: 400; font-size: 1rem; color: var(--muted); }
  a { color: var(--primary-darkest); }
  b, strong { font-weight: 700; }
  .sub { color: var(--muted); margin: 0 0 15px; }
  ul { list-style: none; padding: 0; margin: 0; }
  time { color: var(--muted); white-space: nowrap; font-size: .875rem; }
  .empty { color: var(--muted); }

  /* Plain lists (reminders, what you saved, the fit check editor): striped rows. */
  .rows li { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; padding: 10px 15px; border-radius: var(--r-card); }
  .rows li:nth-child(odd) { background: var(--bg-dim); }
  .rows li small { color: var(--muted); }

  /* Impact stats: feature cards. */
  .stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 0 0 10px; }
  .stat { display: flex; align-items: center; gap: 10px; padding: 15px; border-radius: var(--r-panel); background: var(--bg-dim); animation: fade .4s ease both; animation-delay: calc(var(--i, 0) * 60ms); }
  .stat .ico { flex: none; width: 48px; height: 48px; display: grid; place-items: center; border-radius: var(--r-btn); background: var(--primary-darker); color: var(--bg); }
  .stat b { display: block; font-family: var(--serif); font-size: var(--text-xl); line-height: 1.1; color: var(--neutral); }
  .stat small { display: block; color: var(--muted); font-size: .8125rem; line-height: 1.3; }
  @media (min-width: 520px) { .stat .ico { width: 64px; height: 64px; border-radius: var(--r-panel); } }
  .links { display: flex; flex-wrap: wrap; gap: 8px 15px; align-items: center; margin: 15px 0; }

  /* Category tiles. */
  .tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 10px 0 30px; }
  .tile { aspect-ratio: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; padding: 8px;
    border: 0; border-radius: var(--r-panel); background: var(--bg-dim); color: var(--neutral); font: inherit; cursor: pointer;
    transition: transform var(--ease), box-shadow var(--ease); animation: fade .4s ease both; animation-delay: calc(var(--i, 0) * 40ms); }
  .tile .ico { width: 44px; height: 44px; display: grid; place-items: center; border-radius: var(--r-btn); background: var(--primary-darker); color: var(--bg); }
  .tile .ico svg { width: 28px; height: 28px; }
  .tile span { font-family: var(--serif); font-weight: 700; font-size: .875rem; }
  .tile small { color: var(--muted); }
  .tile:active { transform: scale(.95); }
  @media (hover: hover) { .tile:hover { transform: scale(1.05); box-shadow: var(--shadow-sm); } }
  @media (min-width: 520px) { .tiles { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
  .closet-head { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; margin: 10px 0; }
  .closet-head h2 { font-size: var(--text-2xl); color: var(--neutral); margin: 0; }
  .back { background: transparent; color: var(--primary-darkest); border: 0; padding: 0; font: inherit; font-size: .875rem; cursor: pointer; display: inline-block; margin-bottom: 10px; text-decoration: none; }
  /* With JavaScript: tiles first, one category at a time. Without it, every list shows. */
  .js .closet { display: none; }
  .js.open .tiles { display: none; }
  .js.open .closet { display: block; }
  .js .catlist { display: none; }
  .js .catlist.shown { display: block; }
  .js .closet.one .catlist h2 { display: none; }

  /* Closet items: cards (photo, name, color and season, tags, wears). */
  .cards { display: grid; gap: 15px; }
  .card { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 15px; padding: 10px; background: #fff; border-radius: var(--r-card);
    box-shadow: var(--shadow-sm); transition: transform var(--ease), box-shadow var(--ease); animation: fade .4s ease both; animation-delay: calc(var(--i, 0) * 40ms); scroll-margin-top: 16px; }
  .card.has-photos { cursor: pointer; }
  .card:active { transform: scale(.98); }
  @media (hover: hover) { .card:hover { transform: scale(1.05); box-shadow: var(--shadow-md); } .card:hover .pic img { transform: scale(1.05); } }
  .pic { width: 96px; height: 128px; border-radius: var(--r-card); overflow: hidden; background: var(--bg-dimmer); display: grid; place-items: center; color: var(--primary-darker); }
  .pic img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform var(--ease); }
  .card-body { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .card-title { font-family: var(--serif); font-weight: 700; color: var(--neutral); line-height: 1.3; overflow-wrap: anywhere; }
  .card-sub { margin: 0; color: var(--muted); font-size: .875rem; }
  .tags { display: flex; flex-wrap: wrap; gap: 5px; }
  .tag { display: inline-flex; align-items: center; gap: 4px; padding: 2px 10px; border-radius: var(--r-pill); background: var(--primary); color: var(--neutral); font-size: .75rem; }
  .tag.loc { background: var(--secondary); }
  .card-foot { margin-top: auto; padding-top: 5px; border-top: 1px solid var(--bg-dimmer); display: flex; flex-wrap: wrap; justify-content: space-between; gap: 5px 10px; align-items: center; font-size: .8125rem; color: var(--muted); }
  .card-foot .actions { display: flex; gap: 10px; }
  .count { color: var(--primary-superdark); font-family: var(--sans); }
  .thumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; text-align: left; }
  .thumbs img { width: 24px; height: 32px; object-fit: cover; border-radius: 4px; display: block; background: var(--bg-dimmer); }
  .thumbs small { color: var(--muted); font-size: .75rem; margin-left: 4px; }
  :target { animation: flash 2s ease-out; }
  @keyframes flash { from { box-shadow: 0 0 0 4px var(--accent); } to { box-shadow: var(--shadow-sm); } }

  /* Closet table (one section per category): striped rows, Merriweather headers. */
  .table-wrap { overflow-x: auto; margin: 0 -16px; padding: 0 16px; }
  table.closet-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: .875rem; }
  .closet-table caption { text-align: left; font-family: var(--serif); font-weight: 700; font-size: var(--text-xl); color: var(--primary-darker); padding: 15px 0 8px; }
  .closet-table th { text-align: left; font-weight: 700; color: var(--neutral); padding: 8px 10px; border-bottom: 2px solid var(--bg-dimmer); white-space: nowrap; }
  .closet-table td { padding: 8px 10px; vertical-align: middle; }
  .closet-table tbody tr:nth-child(odd) td { background: var(--bg-dim); }
  .closet-table td:first-child { border-radius: var(--r-card) 0 0 var(--r-card); }
  .closet-table td:last-child { border-radius: 0 var(--r-card) var(--r-card) 0; }
  .closet-table img { width: 36px; height: 48px; object-fit: cover; border-radius: 4px; display: block; }

  /* Fit check photos. */
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 15px 10px; }
  figure { margin: 0; min-width: 0; scroll-margin-top: 16px; animation: fade .4s ease both; }
  figure img { width: 100%; aspect-ratio: 3/4; object-fit: cover; border-radius: var(--r-card); background: var(--bg-dimmer); box-shadow: var(--shadow-sm); display: block; }
  figcaption { font-size: .8125rem; color: var(--muted); text-align: center; margin: 8px 0 2px; }
  .found li { padding: 2px 0; font-size: .8125rem; line-height: 1.35; }
  .found a { color: var(--text); }
  .edit { font-size: .8125rem; }

  /* The photo viewer. */
  dialog.viewer { width: 100%; max-width: 600px; height: 100%; max-height: 100%; margin: 0 auto; padding: 0; border: 0; background: var(--bg); color: var(--text); }
  dialog.viewer::backdrop { background: rgba(0,0,0,.7); }
  .viewer header { position: sticky; top: 0; display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 15px 16px; background: var(--bg); border-bottom: 1px solid var(--bg-dimmer); z-index: 1; }
  .viewer header h3 { margin: 0; font-size: 1.0625rem; }
  .viewer header button { font-size: 1.125rem; line-height: 1; padding: 8px 12px; background: var(--bg-dim); color: var(--neutral); border: 0; border-radius: var(--r-pill); }
  .viewer .shots { display: grid; gap: 30px; padding: 16px; }
  .viewer figure img { aspect-ratio: auto; max-height: 75vh; object-fit: contain; background: transparent; box-shadow: none; }
  ::view-transition-group(*) { animation-duration: .35s; animation-timing-function: cubic-bezier(.2, .8, .2, 1); }
  @media (prefers-reduced-motion: reduce) { ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation: none !important; } }

  /* Forms and buttons. */
  form { display: grid; gap: 15px; }
  label { display: grid; gap: 5px; font-size: .875rem; color: var(--muted); }
  input, select, button { font: inherit; padding: 10px 15px; border: 1px solid var(--bg-dimmer); border-radius: var(--r-btn); background: #fff; color: var(--text); }
  input:focus, select:focus { outline: 2px solid var(--primary); outline-offset: 1px; }
  button { background: var(--primary); color: var(--neutral); border: 0; font-weight: 700; cursor: pointer; transition: background var(--ease), transform var(--ease); }
  button:hover { background: var(--primary-darker); color: #fff; }
  button:active { transform: scale(.95); }
  button.quiet, .letgo button.quiet, .fit button.quiet { background: transparent; color: var(--neutral); border: 1px solid var(--bg-dimmer); font-weight: 400; }
  button.quiet:hover { background: var(--bg-dim); color: var(--neutral); }
  button.danger { background: var(--accent); color: var(--ink); }
  button.danger:hover { background: #d97a38; color: var(--ink); }
  button:disabled { opacity: .5; cursor: default; }
  .saved { color: var(--primary-superdark); font-size: .875rem; margin: 0; }
  fieldset.week { border: 0; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 8px; }
  fieldset.week legend { font-size: .875rem; color: var(--muted); margin-bottom: 5px; padding: 0; }
  label.check { display: inline-flex; flex-direction: row; align-items: center; gap: 6px; padding: 6px 12px; border-radius: var(--r-pill); background: var(--bg-dim); color: var(--neutral); font-size: .875rem; cursor: pointer; }
  label.check input { width: auto; margin: 0; padding: 0; accent-color: var(--primary-darker); }
  .sizes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .sizes input { width: 100%; }
  .error { color: #a4501a; font-size: .875rem; margin: 0; }
  .notice { padding: 10px 15px; border-radius: var(--r-btn); background: var(--bg-dim); border-left: 4px solid var(--primary-darker); color: var(--neutral); margin: 0 0 15px; }
  .letgo summary { cursor: pointer; color: var(--primary-darkest); font-size: .8125rem; list-style: none; }
  .letgo summary::-webkit-details-marker { display: none; }
  .letgo form { display: grid; gap: 5px; margin-top: 8px; min-width: 170px; }
  .letgo form div { display: flex; gap: 5px; }
  .letgo input { width: 90px; padding: 6px 10px; font-size: .875rem; }
  .letgo button { padding: 6px 12px; font-size: .875rem; border-radius: var(--r-pill); }
  .skipped { margin: 0 0 15px; }
  .skipped summary { cursor: pointer; color: var(--primary-darkest); font-size: .875rem; margin-bottom: 8px; }
  .skipped li small { display: block; }
  .skipped .note { color: var(--muted); font-size: .75rem; margin: 10px 0 0; }

  /* The fit check editor. */
  .fit img.photo { width: 100%; max-height: 70vh; object-fit: contain; border-radius: var(--r-panel); background: var(--bg-dim); display: block; }
  .fit .rows li { align-items: center; flex-wrap: wrap; }
  .fit form { display: flex; gap: 5px; align-items: center; margin: 0; }
  .fit form:has(> .danger) { flex-direction: column; align-items: flex-start; gap: 10px; }
  .fit li > form select { max-width: 190px; padding: 6px 10px; font-size: .875rem; }
  .fit li > div { display: flex; gap: 5px; flex-wrap: wrap; }
  .fit button.quiet { padding: 6px 12px; font-size: .875rem; border-radius: var(--r-pill); }
  .fit .add { display: grid; gap: 8px; }
  .fit .add div { display: flex; gap: 5px; flex-wrap: wrap; }
  .fit .add > input { width: 100%; }
  .suggest { margin: 0; }
  .suggest button { display: flex; align-items: center; gap: 10px; width: 100%; padding: 6px 8px; background: transparent; color: var(--text); border: 0; border-radius: var(--r-card); font-weight: 400; text-align: left; }
  .suggest button:hover, .suggest button[aria-selected="true"] { background: var(--bg-dim); color: var(--text); }
  .suggest img { width: 36px; height: 48px; object-fit: cover; border-radius: 4px; flex: none; }
  .suggest span { flex: 1; }
  .suggest small { color: var(--muted); }
  .fit details summary { cursor: pointer; color: var(--primary-darkest); font-size: .875rem; }
  .fit details div { display: flex; gap: 5px; margin-top: 8px; }

  /* Recommendation cards ("Let go", "Before winter"): feature cards with the item's photo as the tile. */
  .picks { display: grid; gap: 10px; }
  .pick { display: flex; gap: 15px; align-items: flex-start; padding: 15px; border-radius: var(--r-panel); background: var(--bg-dim); animation: fade .4s ease both; animation-delay: calc(var(--i, 0) * 60ms); }
  .pick .ico { flex: none; width: 64px; height: 80px; display: grid; place-items: center; border-radius: var(--r-btn); overflow: hidden; background: var(--primary-darker); color: var(--bg); }
  .pick .ico img { width: 100%; height: 100%; object-fit: cover; }
  .pick h3 { font-size: 1rem; margin: 0 0 4px; overflow-wrap: anywhere; }
  .pick .n { display: inline-grid; place-items: center; width: 22px; height: 22px; margin-right: 4px; border-radius: var(--r-pill); background: var(--primary); color: var(--neutral); font-family: var(--sans); font-size: .75rem; vertical-align: 2px; }
  .pick p { margin: 0 0 4px; font-size: .875rem; }
  .pick .exit { color: var(--neutral); font-weight: 700; }
  .pick .exit-return { color: #8a4313; }
  .pick .exit a { font-weight: 400; }

  /* Tabs across the wardrobe pages. */
  .tabs { display: flex; gap: 5px; margin: 0 0 15px; padding: 4px; background: var(--bg-dim); border-radius: var(--r-pill); width: fit-content; max-width: 100%; overflow-x: auto; }
  .tabs a { padding: 6px 15px; border-radius: var(--r-pill); color: var(--neutral); text-decoration: none; font-size: .875rem; white-space: nowrap; transition: background var(--ease); }
  .tabs a:hover { background: var(--bg-dimmer); }
  .tabs a[aria-current="page"] { background: var(--primary); font-weight: 700; }

  /* The recap page. */
  .recap img { width: 100%; height: auto; border-radius: var(--r-panel); box-shadow: var(--shadow-md); display: block; }
  .recap pre { white-space: pre-wrap; font: inherit; color: var(--muted); }
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

/** The wardrobe pages' tabs: the closet, its fit checks, and the guide. */
export function tabs(token: string, current: "closet" | "guide"): string {
  const base = `/w/${encodeURIComponent(token)}`;
  const tab = (href: string, label: string, here: boolean) => `<a href="${href}"${here ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<nav class="tabs" aria-label="Wardrobe">${tab(base, "Closet", current === "closet")}${tab(`${base}#fits`, "Fit checks", false)}${tab(`${base}/guide`, "Guide", current === "guide")}</nav>`;
}
