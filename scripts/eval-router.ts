// Accuracy check for the LLM command router. Needs the model running (see src/llm.ts).
// Run: bun run eval
import { route } from "../src/llm.ts";
const ctx = {
  now: new Date(),
  reminders: ["return the green jacket (Sat Oct 4 1:00 PM)", "check zara refund (Mon Oct 6 9:00 AM)"],
  items: ["black straight-leg jeans", "gray crewneck", "white sneakers"],
};
// [text, expected action, optional check on the result]
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
  ["I bought a brown leather belt and olive cargo pants", "add_items", (a) => a.items.length === 2],
  ["got a new rain jacket today", "add_items"],
  ["I gave away the gray crewneck", "remove_item", (a) => a.name === "gray crewneck"],
  ["get rid of the white sneakers from my list", "remove_item", (a) => a.name === "white sneakers"],
  ["sold my black jeans on depop", "remove_item", (a) => /black/.test(a.name) && /jeans/.test(a.name)],
  ["what can you do", "help"],
  ["thanks so much", "chat", (a) => a.kind === "thanks"],
  ["does this outfit look good", "chat", (a) => a.kind === "style"],
  ["what should I wear to a wedding", "chat", (a) => a.kind === "style"],
  ["do these shoes go with navy pants", "chat", (a) => a.kind === "style"],
  ["good evening", "chat", (a) => a.kind === "greeting"],
  ["who won the game last night", "chat", (a) => a.kind === "other"],
];
let pass = 0;
for (const [text, want, check] of cases) {
  const t0 = performance.now();
  const a = await route(text, ctx).catch((e) => ({ action: `ERROR ${e.message}` }) as any);
  const ok = a?.action === want && (!check || check(a));
  if (ok) pass++;
  const shown = a?.at ? { ...a, at: new Date(a.at).toLocaleString() } : a;
  console.log(`${ok ? "✓" : "✗"} ${Math.round(performance.now() - t0)}ms  ${text}\n    ${JSON.stringify(shown)}`);
}
console.log(`${pass}/${cases.length}  (now: ${new Date().toLocaleString()})`);
