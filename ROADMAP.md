# Roadmap status

Where Second Thought stands against the [build plan](PLAN.md). Updated Oct 3, 2026, after the demo seed script.

**Legend:** ✅ done · 🟡 partly done · ⬜ not started · ✂️ dropped by a plan change

## Summary

| Area | Status |
|---|---|
| P0: core (gate: hour 12) | ✅ 5 of 5 |
| P1: differentiator | ✅ 3 of 3 |
| P2: stretch | 🟡 1 of 4 |
| Submission checklist | 🟡 README only |

**P0 is done, so the hour 12 gate is met** (built in code; still to be checked live end to end). P1 is done too. Next: demo data, then the submission checklist; P2 only if time is left.

## P0: core

| Feature | Status | Notes |
|---|---|---|
| **Closet intake** | ✅ | Fit check photos become items (type, color, pattern, fit, season) and log wears; repeat items match instead of duplicating (vision comparison, falling back to name matching). Items can also be added by text. HEIC works. |
| **"Do I already have this?"** | ✅ | "do I have this?" (or "shopping", "checking something") makes the next photo within 5 minutes a shopping photo: matched, not saved. Sent within 2 minutes *after* a photo, it takes that fit check back out and matches the same photo. Replies with up to 3 owned items (the model's reason, month owned) and the top match's photo (`src/shopping-mode.ts`). |
| **Order intake** | ✅ | The fit check extraction also returns `image_kind` (fit_check / order_screenshot / product), so spotting an order screenshot costs no extra call. A screenshot comes back out of the fit checks, and one more vision call reads retailer, order date (today if none shown) and line items. Each line becomes a purchase (deadline = order date + the retailer's return days; unknown retailers get 30 days and the reply says so) and a closet item with `source = 'order'`. Dedup runs as for fit checks: ordering jeans you already own links the order to them and warns "Heads up: you already own…". Replies end "Verify on the retailer's site." A `product` photo (a listing or store shot) skips the fit checks too and gets the shopping match. (`src/orders.ts`, `src/photo-intake.ts`) |
| **Return nudges** | ✅ | Once a day from 10am, the scheduler nudges each `kept` purchase whose window closes within 3 days and whose item hasn't been in a fit check since the order: "You haven't worn the black jeans from Zara in any fit checks yet. Return window closes Oct 6. Keeping it? Reply keep or return." Claimed before sending (`purchases.nudged_at`), so each purchase is nudged once. "return" marks the purchase `returning` and the item `returned` and links the retailer's returns page (`return_policies.returns_url`); "keep" confirms; "returned it" marks it `returned`. "check returns" runs the check now, any deadline, for orders at least 7 days old, for the demo. (`src/returns.ts`) |
| **Impact counter** | ✅ | `impact_events` records an `avoided` event each time a shopping check (shopping mode or a product photo) finds a match (at most once per item per day, so re-checking the same jacket doesn't inflate it), with the top match's order price if it came from an order, and a `recovered` event with the price when a purchase goes `returning` or `returned`, once per purchase. "my impact" (or "my stats", "how am I doing") replies "You've skipped 2 purchases and gotten $49.90 back." plus "That's 2 fewer things in your closet you didn't need." The wardrobe page shows the same totals at the top. No estimated CO₂ or water numbers. (`src/impact.ts`) |

## P1: differentiator

| Feature | Status | Notes |
|---|---|---|
| **The one thing worth buying** | ✅ | "what should I actually buy?" counts tops, bottoms and shoes worn in the last 90 days and names the bottleneck, a neutral color, and how many new outfits it opens up. Says "buy nothing" when balanced. Dresses and outerwear aren't counted. |
| **Season tags** | ✅ | Extracted with every item (`warm` / `cold` / `all`). |
| **Where did I put it?** | ✅ | "put my winter jacket in the under-bed bin" / "where's my winter jacket?" → "under-bed bin, since Oct 3". Finds items by other words ("grey sweater" → gray crewneck). Shown on the wardrobe page. |

## P2: stretch

| Feature | Status | Notes |
|---|---|---|
| Season-aware closet ghosts + resale drafts | ⬜ | Needs weather: `outfits.temperature` isn't stored yet. Cities are already real places (Open-Meteo geocoding), so adding the forecast is a small step. |
| Nessie transaction detection | ⬜ | Decide at hour 12 per the plan; currently out of reach. |
| Secondhand search links | ✅ | The shopping check's "no match" reply links a Depop search built from the extracted description. |
| Monthly recap card | ⬜ | |

## Built beyond the plan

These weren't features in the plan, but the flows need them:

- Onboarding with a real city: looked up, with a numbered list to pick from when ambiguous ("Detroit, Michigan / Detroit, Texas…")
- One-off reminders ("remind me friday at 5pm…"), a daily fit check prompt, "my reminders" / "cancel 1"
- Remove items in plain words ("sold my grey sweater")
- Wardrobe page (`/w/<token>`): items with locations, fit check photos, reminders, an editable profile. This is the plan's "one closet page".
- Landing page with a QR code that texts the bot
- Typing bubble while the bot works

## Plan changes since the first draft

- ✂️ **Embeddings / pgvector:** similarity is now SQL candidates by category plus a vision-model comparison (`src/closet/compare.ts`). The "enable pgvector" hour 0 task no longer applies.
- **Models:** photos go through OpenRouter (`google/gemini-3.8-flash`, Google Vertex priority tier). Texts go to Llama 3.1 8B on OpenRouter, chosen over local qwen2.5:7b, Mistral Small and Qwen3 30B on accuracy and speed (~0.3s per text); see PR #8.

## Hour 0 tasks

| Task | Status |
|---|---|
| Photon sending and receiving a photo | ✅ iMessage and RCS both work |
| Neon database live | ✅ (pgvector ✂️ no longer needed) |
| Extraction prompt run on real fit checks | ✅ `bun run extract` on 10 attributed test photos, plus a live JPEG/HEIC check |
| Return-policy table for the top 15 retailers | ✅ Seeded in `src/schema.sql` (Amazon, Target, H&M, Zara, Uniqlo, Nike, Adidas, Abercrombie, American Eagle, Urban Outfitters, Lululemon, Gap, Old Navy, Nordstrom, Shein) |

## Data model vs plan

| Plan | Now |
|---|---|
| items: photo, type, color, pattern, season, source, location, status | ✅ All there, plus fit, description, `location_set_at`. Status values are `active` / `returned` / `removed` (plan: owned / returned / sold). |
| outfits: photo, date, temperature | 🟡 No `temperature` yet (needed for closet ghosts) |
| wears | ✅ |
| purchases | ✅ Written by order intake, linked from `items.purchase_id` |
| return_policies | ✅ 15 retailers |
| users: phone, city | ✅ Plus name, daily fit check hour, wardrobe page token |

## Demo script readiness

| Beat | Ready? |
|---|---|
| Hook | ✅ |
| The closet (pre-loaded weeks of dated fit checks) | 🟡 `bun run seed:demo` seeds 3 weeks (12 fit checks, the black jeans, an unworn Zara jacket, a stored coat, one skipped purchase) on a Neon branch; the 12 photos for `demo_images/` still need taking |
| Shopping: photo of black pants → your near-identical pair, still returnable | ✅ Matches from an order with an open window say "still returnable until Oct 31" |
| Returns: order screenshot → "you haven't worn this" → "return" | ✅ "check returns" nudges the seeded Zara jacket; a live screenshot is only picked up if its order date is at least a week old |
| Worth buying | ✅ (needs the seeded fit checks to say something interesting) |
| Close on the impact counter | ✅ Text "my impact", or open the wardrobe page |

## Submission checklist

| Item | Status |
|---|---|
| README for the LLM judge | 🟡 Written; needs the vision-comparison matching and model choices folded in, plus final accuracy numbers |
| Devpost page | ⬜ |
| Public repo with setup steps | 🟡 Setup steps in the README; the repo's visibility hasn't been checked |
| Backup demo video | ⬜ |
| Figma file | ⬜ |
| iMessage screenshots | ⬜ |
| Sponsor requirements checked | ⬜ |
| Two pitch run-throughs | ⬜ |

## Suggested next steps, in order

1. **Demo photos and a rehearsal.** Take the 12 photos listed in `demo_images/README.md`, create the Neon branch, run `bun run seed:demo`, and walk the demo script on a real phone (plus one real order screenshot).
2. Then the submission checklist; P2 only if time is left.
