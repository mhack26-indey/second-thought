// Accuracy check for the LLM command router. Needs the model running (see src/llm.ts).
// Run: bun run eval
import { route } from "../src/llm.ts";
const ctx = {
  now: new Date(),
  reminders: ["return the green jacket (Sat Oct 4 1:00 PM)", "check zara refund (Mon Oct 6 9:00 AM)"],
  items: ["black straight-leg jeans", "gray crewneck", "white sneakers", "grey puma sweatpants", "dark charcoal sweatpants", "short-sleeve beige blouse", "red beanie"],
  lastFit: ["dark charcoal sweatpants", "short-sleeve beige blouse", "red beanie"],
};
// [text, expected action, optional check on the result]. A single message
// must produce exactly that one action.
const cases: [string, string, ((a: any) => boolean)?][] = [
  ["remind me in 3 hours to try on the boots", "add_reminder", (a) => Math.abs(a.at - Date.now() - 3 * 3600e3) < 60e3],
  ["remind me tonight at 9 to pack the gym bag", "add_reminder", (a) => new Date(a.at).getHours() === 21],
  ["can you ping me next week about the nordstrom return", "add_reminder", (a) => Math.round((a.at - Date.now()) / 86400e3) === 7],
  ["remind me friday at noon to drop off the uniqlo return", "add_reminder", (a) => new Date(a.at).getHours() === 12],
  ["what reminders do I have", "list_reminders"],
  ["whats on my schedule", "list_reminders"],
  ["cancel the jacket reminder", "cancel_reminder", (a) => a.number === 1],
  ["nvm about the zara refund, delete that", "cancel_reminder", (a) => a.number === 2],
  ["can you do fit checks at 7 in the morning instead", "set_fit_check_time", (a) => a.hour === 7],
  ["move my daily reminder to 10pm", "set_fit_check_time", (a) => a.hour === 22],
  ["stop asking me for fit checks", "stop_fit_checks"],
  ["what's in my closet", "show_wardrobe"],
  ["send me the wardrobe link", "show_wardrobe"],
  ["I bought a brown leather belt and olive cargo pants", "add_items",
    (a) => a.items.map((i: any) => i.type).join() === "belt,pants" && a.items[0].color_primary === "brown"],
  ["got a new rain jacket today", "add_items", (a) => a.items[0].type === "jacket" && a.items[0].category === "outerwear"],
  ["picked up a striped button down and some gold hoops", "add_items",
    (a) => a.items.map((i: any) => i.type).join() === "button-up shirt,earrings" && a.items[0].pattern === "striped"],
  ["I gave away the gray crewneck", "remove_item", (a) => a.name === "gray crewneck"],
  ["get rid of the white sneakers from my list", "remove_item", (a) => a.name === "white sneakers"],
  ["sold my black jeans on depop", "remove_item", (a) => /black/.test(a.name) && /jeans/.test(a.name)],
  ["I keep the white sneakers in the hall closet", "set_location",
    (a) => /white sneakers/.test(a.name) && /hall closet/.test(a.location)],
  ["moved my black jeans to the storage bin", "set_location", (a) => /jeans/.test(a.name) && /storage bin/.test(a.location)],
  ["where is my gray crewneck?", "find_item", (a) => /crewneck/.test(a.name)],
  ["cant find my white sneakers anywhere", "find_item", (a) => /sneakers/.test(a.name)],
  ["what's worth buying next", "worth_buying"],
  ["what should I get to have more outfits", "worth_buying"],
  ["should I buy more pants or tops", "worth_buying"],
  ["wait the charcoal sweatpants are actually my puma ones", "fit_same", (a) => /charcoal/.test(a.name) && /puma/.test(a.as)],
  ["those aren't new, that's my grey puma sweatpants", "fit_same", (a) => /puma/.test(a.as)],
  ["that's not a blouse it's a polo", "fit_relabel", (a) => /blouse/.test(a.name) && /polo/.test(a.as)],
  ["the blouse is actually a button up shirt", "fit_relabel", (a) => /button/.test(a.as)],
  ["you missed my silver watch", "fit_missing", (a) => /watch/.test(a.name)],
  ["I'm also wearing white sneakers in that one", "fit_missing", (a) => /sneakers/.test(a.name)],
  ["there's no beanie in that photo", "fit_not_there", (a) => /beanie/.test(a.name)],
  ["the red beanie isn't in the pic", "fit_not_there", (a) => /beanie/.test(a.name)],
  ["can you delete that last fit check", "delete_fit_check"],
  ["just got two more white tees", "add_items"],
  ["that pic was a mistake, remove the whole fit check", "delete_fit_check"],
  ["sold my red beanie", "remove_item", (a) => /beanie/.test(a.name)],
  ["just got a silver watch", "add_items", (a) => a.items[0].type === "watch"],
  ["what can you do", "help"],
  ["what do you know about me", "show_profile"],
  ["I moved to Seattle last week", "update_profile", (a) => a.city === "Seattle" && !a.name],
  ["can you update my location to Ann Arbor", "update_profile", (a) => a.city === "Ann Arbor"],
  ["can you change my city", "update_profile", (a) => !a.city && !a.name],
  ["I work in an office now", "update_details"],
  ["I'm a medium in tops and a 32 in jeans", "update_details"],
  ["my week is mostly class and the gym", "update_details"],
  ["i moved, update my location", "update_profile", (a) => !a.city],
  ["call me Inesh", "update_profile", (a) => a.name === "Inesh" && !a.city],
  ["call me tomorrow about the jacket return", "add_reminder"],
  ["thanks so much", "chat", (a) => a.kind === "thanks"],
  ["does this outfit look good", "chat", (a) => a.kind === "style"],
  ["what should I wear to a wedding", "chat", (a) => a.kind === "style"],
  ["do these shoes go with navy pants", "chat", (a) => a.kind === "style"],
  ["good evening", "chat", (a) => a.kind === "greeting"],
  ["who won the game last night", "chat", (a) => a.kind === "other"],
];

// Chained requests: the exact list of actions, in order, plus an optional check.
const chained: [string, string[], ((a: any[]) => boolean)?][] = [
  ["add a navy blazer and remind me tomorrow at 10am to return the zara shirt", ["add_items", "add_reminder"],
    (a) => a[0].items[0].type === "blazer" && new Date(a[1].at).getHours() === 10],
  ["sold the white sneakers, also show me my closet", ["remove_item", "show_wardrobe"], (a) => a[0].name === "white sneakers"],
  ["cancel both my reminders", ["cancel_reminder", "cancel_reminder"], (a) => a[0].number === 1 && a[1].number === 2],
  ["I moved to Boston, change my fit check to 7am and show my reminders", ["update_profile", "set_fit_check_time", "list_reminders"],
    (a) => a[0].city === "Boston" && a[1].hour === 7],
  ["got a gray beanie. thanks!", ["add_items"]], // dropping the "thanks" is fine too
  ["got a gray beanie. thanks!", ["add_items", "chat"]],
  ["remind me in 1 hour to try on the boots and in 2 hours to post the depop listing", ["add_reminder", "add_reminder"],
    (a) => Math.round((a[1].at - a[0].at) / 3600e3) === 1],
  ["what's my schedule and what do you know about me", ["list_reminders", "show_profile"]],
  ["got black straight-leg jeans, a gray crewneck and gold hoops, remind me in 1 hour to return the zara shirt", ["add_items", "add_reminder"],
    (a) => a[0].items.map((i: any) => i.type).join() === "jeans,crewneck,earrings"],
  ["stop fit checks", ["stop_fit_checks"]],
];

const show = (a: any) => (a?.at ? { ...a, at: new Date(a.at).toLocaleString() } : a);
let pass = 0;
for (const [text, want, check] of cases) {
  const t0 = performance.now();
  const actions = await route(text, ctx).catch((e) => [{ action: `ERROR ${e.message}` }] as any[]);
  const ok = actions.length === 1 && actions[0].action === want && (!check || check(actions[0]));
  if (ok) pass++;
  console.log(`${ok ? "✓" : "✗"} ${Math.round(performance.now() - t0)}ms  ${text}\n    ${JSON.stringify(actions.map(show))}`);
}
for (const [text, want, check] of chained) {
  const t0 = performance.now();
  const actions = await route(text, ctx).catch((e) => [{ action: `ERROR ${e.message}` }] as any[]);
  const got = JSON.stringify(actions.map((a) => a.action));
  // Same text listed twice means either expected list is fine; count it once.
  const alts = chained.filter(([t]) => t === text);
  if (alts[0]![1] !== want) continue;
  const ok = alts.some(([, w, c]) => got === JSON.stringify(w) && (!c || c(actions)));
  if (ok) pass++;
  console.log(`${ok ? "✓" : "✗"} ${Math.round(performance.now() - t0)}ms  [chain] ${text}\n    ${JSON.stringify(actions.map(show))}`);
}
const total = cases.length + new Set(chained.map(([t]) => t)).size;
console.log(`${pass}/${total}  (now: ${new Date().toLocaleString()})`);
