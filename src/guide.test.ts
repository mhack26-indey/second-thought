import { expect, test } from "bun:test";
import { isClosetModeStart } from "./closet-mode.ts";
import { isDeclutterAsk } from "./declutter.ts";
import { quickProfileEdit } from "./profile.ts";
import { isShowCloset, isShowFitChecks } from "./show.ts";
import { GUIDE, UNDOCUMENTED, helpText, onboardingIntro, wardrobeLinkMessage } from "./guide.ts";
import { guidePage, publicGuideResponse, userGuideResponse } from "./guide-page.ts";
import { isImpactAsk, isUnskip } from "./impact.ts";
import { ACTION_NAMES } from "./llm.ts";
import { isShoppingAsk } from "./shopping-mode.ts";

const GUIDE_LINK = "https://example.test/w/tok123/guide";
const entries = GUIDE.flatMap((s) => s.entries);
const entryFor = (intent: string) => entries.find((e) => e.intent === intent)!;

test("the onboarding intro is the three-photo loop and the guide link, short", () => {
  const intro = onboardingIntro(GUIDE_LINK);
  expect(intro).toStartWith("You're set! Here's how it works:");
  expect(intro).toContain("📸 Getting dressed? Send a fit check.");
  expect(intro).toContain('🛍️ Shopping? Send a screenshot and ask "do I have this?"');
  expect(intro).toContain("🧾 Bought something? Send the receipt and I'll watch the return window.");
  expect(intro).toEndWith(`Every command is here: ${GUIDE_LINK}`);
  expect(intro.split(/\s+/).length).toBeLessThan(60);
  expect(wardrobeLinkMessage("https://example.test/w/tok123")).toEndWith("https://example.test/w/tok123");
});

test('"help" ends with the guide link', () => {
  const help = helpText(GUIDE_LINK);
  expect(help).toStartWith("You can text me things like:");
  expect(help).toEndWith(`Every command is here: ${GUIDE_LINK}`);
});

test("every router intent has a guide entry", () => {
  const documented = new Set(entries.map((e) => e.intent));
  const missing = ACTION_NAMES.filter((a) => !documented.has(a) && !UNDOCUMENTED.includes(a));
  expect(missing).toEqual([]);
  // ...and each intent is documented once, in a section with something in it.
  expect(documented.size).toBe(entries.length);
  expect(GUIDE.every((s) => s.entries.length > 0)).toBe(true);
});

test("the guide's commands for pre-router features are ones the bot recognizes", () => {
  expect(isShoppingAsk(entryFor("shopping_check").command)).toBe(true);
  expect(isClosetModeStart(entryFor("closet_dump").command)).toBe(true);
  expect(isImpactAsk(entryFor("impact").command)).toBe(true);
  expect(isUnskip(entryFor("unskip").command)).toBe(true);
  expect(isDeclutterAsk(entryFor("declutter").command)).toBe(true);
  expect(isShowCloset(entryFor("show_closet").command)).toBe(true);
  expect(isShowFitChecks(entryFor("show_fit_checks").command)).toBe(true);
  expect(quickProfileEdit(entryFor("profile_size").command)).toEqual({ patch: { sizeShoe: "10" }, under18: false });
});

test("the guide page lists every entry with a copy button for each text command", () => {
  const html = guidePage();
  for (const e of entries) expect(html).toContain(`data-intent="${e.intent}"`);
  const copyable = entries.filter((e) => !e.photo).length;
  expect(html.match(/class="copy"/g)).toHaveLength(copyable);
  for (const s of GUIDE) expect(html).toContain(`<h2>${s.title}</h2>`);
});

test("the per-user guide needs a real wardrobe token", async () => {
  const userByToken = async (token: string) => (token === "tok123" ? { webToken: "tok123" } : undefined);

  const missing = await userGuideResponse("nope", userByToken);
  expect(missing.status).toBe(404);

  const ok = await userGuideResponse("tok123", userByToken);
  expect(ok.status).toBe(200);
  const html = await ok.text();
  expect(html).toContain('href="/w/tok123"'); // the tabs back to their closet
  expect(html).toContain('href="/w/tok123/guide" aria-current="page"');
});

test("the public guide has the same commands and nothing personal", async () => {
  const res = publicGuideResponse();
  const html = await res.text();
  expect(res.status).toBe(200);
  expect(html).not.toContain("/w/"); // no wardrobe links or tokens
  expect(html).not.toContain('class="tabs"');
  for (const e of entries) expect(html).toContain(`data-intent="${e.intent}"`);
  expect(html).toContain('href="sms:'); // a way to sign up instead
});
