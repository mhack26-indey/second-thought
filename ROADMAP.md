# Roadmap status

Where Second Thought stands against the [build plan](PLAN.md). Updated Oct 3, 2026, after the shopping check was wired in.

**Legend:** ✅ done · 🟡 partly done · ⬜ not started · ✂️ dropped by a plan change

## Summary

| Area | Status |
|---|---|
| P0: core (gate: hour 12) | 🟡 2 of 5 done |
| P1: differentiator | ✅ 3 of 3 |
| P2: stretch | 🟡 1 of 4 |
| Submission checklist | 🟡 README only |

**The hour 12 gate isn't met.** The plan says to finish P0 before anything else. P1 is already done, so every remaining hour should go to P0: order intake, return nudges and the impact counter. The demo script depends on all three.

## P0: core

| Feature | Status | Notes |
|---|---|---|
| **Closet intake** | ✅ | Fit check photos become items (type, color, pattern, fit, season) and log wears; repeat items match instead of duplicating (vision comparison, falling back to name matching). Items can also be added by text. HEIC works. |
| **"Do I already have this?"** | ✅ | "do I have this?" (or "shopping", "checking something") makes the next photo within 5 minutes a shopping photo: matched, not saved. Sent within 2 minutes *after* a photo, it takes that fit check back out and matches the same photo. Replies with up to 3 owned items (the model's reason, month owned) and the top match's photo (`src/shopping-mode.ts`). |
| **Order intake** | ⬜ | The `purchases` and `return_policies` tables exist but nothing writes to them. Needed: parse an order screenshot (vision model), add the item with `source = 'order'`, log retailer, price and return deadline. |
| **Return nudges** | ⬜ | The reminder scheduler works (one-off reminders, daily fit checks, sent once even across restarts). Missing: a reminder before each return deadline, "you haven't worn this yet" from `wears`, and the "return" reply flow. |
| **Impact counter** | ⬜ | Nothing tracks purchases avoided or money recovered. Natural sources: a shopping check that found a match (avoided) and a purchase marked returned (recovered). |

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
| Return-policy table for the top 15 retailers | ⬜ Table exists, empty |

## Data model vs plan

| Plan | Now |
|---|---|
| items: photo, type, color, pattern, season, source, location, status | ✅ All there, plus fit, description, `location_set_at`. Status values are `active` / `returned` / `removed` (plan: owned / returned / sold). |
| outfits: photo, date, temperature | 🟡 No `temperature` yet (needed for closet ghosts) |
| wears | ✅ |
| purchases | 🟡 Table only |
| return_policies | 🟡 Table only, no rows |
| users: phone, city | ✅ Plus name, daily fit check hour, wardrobe page token |

## Demo script readiness

| Beat | Ready? |
|---|---|
| Hook | ✅ |
| The closet (pre-loaded weeks of dated fit checks) | ⬜ Needs seed data; the plan suggests a Neon branch to keep it safe |
| Shopping: photo of black pants → your near-identical pair, still returnable | 🟡 Match and photo reply work; "still returnable" needs order intake |
| Returns: order screenshot → "you haven't worn this" → "return" | ⬜ |
| Worth buying | ✅ (needs the seeded fit checks to say something interesting) |
| Close on the impact counter | ⬜ |

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

1. **Order screenshots → purchases.** Extract retailer, item, price and order date; compute the deadline from `return_policies` (fill in ~15 retailers); add the item with `source = 'order'`.
2. **Return nudges.** A reminder a few days before each deadline, and "hasn't shown up in a fit check" from `wears`; handle the "return" reply.
3. **Impact counter.** Count shopping checks that found a match, plus returned purchases and their prices; show it in a reply and on the wardrobe page.
4. **Seed demo data** on a Neon branch: a few weeks of dated fit checks and a couple of orders.
5. Then the submission checklist; P2 only if time is left.
