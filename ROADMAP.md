# Roadmap status

Where Second Thought stands against the [build plan](PLAN.md). Updated Oct 3, 2026, after PR #20 (CO₂ estimates, letting items go, store listings, deleting fit checks).

**Legend:** ✅ done · 🟡 partly done · ⬜ not started · ✂️ dropped by a plan change

## Summary

| Area | Status |
|---|---|
| P0: core (gate: hour 12) | ✅ 5 of 5 |
| P1: differentiator | ✅ 3 of 3 |
| P2: stretch | 🟡 1 of 4 |
| Submission checklist | 🟡 README only; **the repo is still private** |

**P0 is done, so the hour 12 gate is met** (built in code; still to be checked live end to end). P1 is done too, and misread fit checks can now be fixed on the wardrobe page or by text. Next: make the repo public, seed and rehearse the demo, then the rest of the submission checklist; P2 only if time is left.

## P0: core

| Feature | Status | Notes |
|---|---|---|
| **Closet intake** | ✅ | Fit check photos become items (type, color, pattern, fit, season) and log wears; repeat items match instead of duplicating (vision comparison, falling back to name matching). Items can also be added by text. HEIC works. When the model misreads a photo, it can be fixed on the wardrobe page (merge a split item, unlink, link or add by name) or by text about the latest fit check ("you missed my watch", "that's not a blouse, it's a polo"). |
| **"Do I already have this?"** | ✅ | "do I have this?" (or "shopping", "checking something") makes the next photo within 5 minutes a shopping photo: matched, not saved. Sent within 2 minutes *after* a photo, it takes that fit check back out and matches the same photo. Replies with up to 3 owned items (the model's reason, month owned) and the top match's photo (`src/shopping-mode.ts`). Screenshots of online listings count as product photos even with a model wearing the item, and only the garment for sale is read, named from the listing's title (a set reads every piece) (#19). |
| **Order intake** | ✅ | The fit check extraction also returns `image_kind` (fit_check / order_screenshot / product), so spotting an order screenshot costs no extra call. A screenshot comes back out of the fit checks, and one more vision call reads retailer, order date (today if none shown) and line items. Each line becomes a purchase (deadline = order date + the retailer's return days; unknown retailers get 30 days and the reply says so) and a closet item with `source = 'order'`. Dedup runs as for fit checks: ordering jeans you already own links the order to them and warns "Heads up: you already own…". Replies end "Verify on the retailer's site." A `product` photo (a listing or store shot) skips the fit checks too and gets the shopping match. (`src/orders.ts`, `src/photo-intake.ts`) |
| **Return nudges** | ✅ | Once a day from 10am, the scheduler nudges each `kept` purchase whose window closes within 3 days and whose item hasn't been in a fit check since the order: "You haven't worn the black jeans from Zara in any fit checks yet. Return window closes Oct 6. Keeping it? Reply keep or return." Claimed before sending (`purchases.nudged_at`), so each purchase is nudged once. "return" marks the purchase `returning` and the item `returned` and links the retailer's returns page (`return_policies.returns_url`); "keep" confirms; "returned it" marks it `returned`. "check returns" runs the check now, any deadline, for orders at least 7 days old, for the demo. (`src/returns.ts`) |
| **Impact counter** | ✅ | Counts skips (a shopping check found a match; counted right away, and the reply says to text "I didn't skip it" if they buy it anyway, which takes it back), returns, sales and donations, with money back from returns and sale prices. Each comes with an **estimated CO₂ saving** per item type: Carbonfact's category median for making a new item (#17), plus an EPA driving comparison. For returns, sales and donations the estimate assumes the item gets worn again instead of someone buying new, and the page says so. "my impact" replies e.g. "You've skipped 2 purchases and sold 1 item, and gotten $15.00 back. That saved ≈ 49 kg CO₂e (about 122 miles of driving)…"; the wardrobe page shows "Skipped 2 purchases · Sold 1 · ≈ 49 kg CO₂e saved · $15.00 back" and a **Here's what you saved** list (#18). (`src/impact.ts`, `src/footprint.ts`) |

## P1: differentiator

| Feature | Status | Notes |
|---|---|---|
| **The one thing worth buying** | ✅ | "what should I actually buy?" counts tops, bottoms and shoes worn in the last 90 days and names the bottleneck, a neutral color, and how many new outfits it opens up. Says "buy nothing" when balanced. Dresses and outerwear aren't counted. |
| **Season tags** | ✅ | Extracted with every item (`warm` / `cold` / `all`). |
| **Where did I put it?** | ✅ | "put my winter jacket in the under-bed bin" / "where's my winter jacket?" → "under-bed bin, since Oct 3". Finds items by other words ("grey sweater" → gray crewneck). Shown on the wardrobe page. |

## P2: stretch

| Feature | Status | Notes |
|---|---|---|
| Season-aware closet ghosts + resale drafts | ⬜ | Needs weather: `outfits.temperature` isn't stored yet. Cities are already real places (Open-Meteo geocoding), so adding the forecast is a small step. The selling side exists: sales are recorded (with price and CO₂) from the page or by text (#18), and wear history is there for "unworn in 60 days". |
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
- Wardrobe page shows which photos each item came from: thumbnails per item with a wear count, items listed under each fit check, linked both ways; tapping an item opens its photos large with a view transition (#11, #12)
- Fit check editor on the wardrobe page (`/w/<token>/fit/<id>`): "Same as this" merges an item the model split in two (suggestions ranked by type, LLM color groups, pattern and words), "Not in this photo" unlinks (and removes an item only that photo produced), and a search box suggests closet items as you describe one ("grey sweats", "pu…") or adds it as new (#13, #14)
- Corrections by text for the latest fit check: same as / relabel / missed / not there (#15)
- Letting items go: "got rid of the black jeans" asks whether it was returned, sold, donated or thrown away (unless the text says), and the wardrobe page has a Let it go menu per item; only thrown away counts nothing (#18)
- Deleting a fit check, on its edit page or by text ("delete my last fit check", confirmed with yes), taking the items only it added with it (#20)
- Find-by-name narrows by type and color in code before the model picks, so "sold my red hat" can't remove a gray crewneck (#8)
- Closet accuracy eval on 15 real photos (`bun run eval:closet`, results in `eval/closet-results.md`): 0 missed and 0 wrong merges on the 6 confidently repeated items, 100% of items found with the right category, 88% with the right color, and 6/6 shopping matches right at @1

## Plan changes since the first draft

- ✂️ **Embeddings / pgvector:** similarity is now SQL candidates by category plus a vision-model comparison (`src/closet/compare.ts`). The "enable pgvector" hour 0 task no longer applies.
- **CO₂ estimates:** the impact counter now shows estimated CO₂ savings (Carbonfact category medians, EPA driving comparison), always labeled as estimates. The first version deliberately had none (#17).
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
| items: photo, type, color, pattern, season, source, location, status | ✅ All there, plus fit, description, `location_set_at`. Status values are `active` / `returned` / `removed` (plan: owned / returned / sold); sold and donated are recorded in `impact_events` (kinds `avoided`, `recovered`, `sold`, `donated`). |
| outfits: photo, date, temperature | 🟡 No `temperature` yet (needed for closet ghosts) |
| wears | ✅ |
| purchases | ✅ Written by order intake, linked from `items.purchase_id` |
| return_policies | ✅ 15 retailers |
| users: phone, city | ✅ Plus name, daily fit check hour, wardrobe page token |

## Demo script readiness

| Beat | Ready? |
|---|---|
| Hook | ✅ |
| The closet (pre-loaded weeks of dated fit checks) | 🟡 `bun run seed:demo` builds it from 15 real photos through the live extraction and dedup (dates from filenames, squeezed into the last 21 days), plus the unworn Zara jacket, the red puffer in the under-bed bin and one skipped purchase. Not yet run on the Neon branch. The 15 photos were imported into Inesh's own account on the main database (38 items, 16 fit checks) to try the editor; a few duplicates show there (two grey sweatpants, two black dress shoes) and can be merged with "Same as this". |
| Shopping: photo of black pants → your near-identical pair, still returnable | ✅ Matches from an order with an open window say "still returnable until Oct 31" |
| Returns: order screenshot → "you haven't worn this" → "return" | ✅ "check returns" nudges the seeded Zara jacket; a live screenshot is only picked up if its order date is at least a week old |
| Worth buying | ✅ (needs the seeded fit checks to say something interesting) |
| Close on the impact counter | ✅ Text "my impact", or open the wardrobe page; it now ends on an estimated CO₂ number with sources |

## Submission checklist

| Item | Status |
|---|---|
| README for the LLM judge | 🟡 Models, matching and real-photo accuracy (`eval/closet-results.md`) are in; needs the fit check editor, text corrections and the photo links, then a final pass |
| Devpost page | ⬜ |
| Public repo with setup steps | 🟡 Setup steps in the README, but `mhack26-indey/photon-db` is **private**: make it public before submitting |
| Backup demo video | ⬜ |
| Figma file | ⬜ |
| iMessage screenshots | ⬜ |
| Sponsor requirements checked | ⬜ |
| Two pitch run-throughs | ⬜ |

## Known issues

| Issue | Impact | Fix |
|---|---|---|
| Repo is private | Submission requires a public repo | Flip visibility on GitHub (and check nothing sensitive is committed: demo photos and `.env` are gitignored) |
| Photo calls only go to Google Vertex's priority tier | If that tier fails, every photo fails (photos are still saved, just not read) | Add a fallback provider in `src/closet/vlm.ts` |
| Some duplicates get through | Closet eval: 36 items for 31 real ones | Fix by hand with the editor; for the eval, tune the comparison prompt |
| Muted colors read as grey/black/khaki in dim light | 6 of 50 colors wrong in the closet eval | Extraction prompt fix, rerun `bun run eval:closet` |
| "fit checks at 7:30" (no am/pm) means 7:30 PM | Every text model tried reads it that way | Default bare times for fit checks to the morning |
| "do I have this?" after a photo of one of your texted items | The texted item keeps details copied from the shopping photo | Delay filling in a texted item's details until the 2-minute undo window has passed (`src/ingest.ts`) |
| Waiting states live in memory | A restart drops an open "do I have this?" window, a new user's held first message, an unanswered "how did it go?" or "delete it?" | Acceptable for the demo; store them in the database if it matters |
| Deleting a fit check hard-deletes the items only it added | A skip that matched one of those items drops out of the impact counts | Rare; soft-delete instead if it matters |
| Listing detection tested only on rendered pages | Real retailer screenshots (Zara, Uniqlo apps) may look different | Try 3–4 real listing screenshots during the rehearsal |

## Suggested next steps, in order

1. **Make the repo public** (after a quick check that nothing sensitive is committed). Still private.
2. **Seed and rehearse.** Create the Neon branch, run `bun run seed:demo`, merge any duplicates with the fit check editor, and walk the demo script on a real phone: a fit check, a correction, a real order screenshot, a real store listing, "do I have this?" ending on the CO₂ line, and "my impact".
3. **README pass:** add the fit check editor (merge, search, delete), text corrections, letting items go, CO₂ estimates with their sources, and listing reading; final read for the LLM judge.
4. **Color names in bad light.** Try the extraction prompt fix and rerun `bun run eval:closet`.
5. **A fallback provider for photo calls**, so one provider outage doesn't stop photo reading during the demo.
6. Then the rest of the submission checklist (Devpost, backup video, Figma, screenshots, sponsor requirements, pitch run-throughs). If there's time for P2, "unworn in 60 days → want to sell it?" is the cheapest piece: wears and selling already exist.
