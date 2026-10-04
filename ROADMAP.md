# Roadmap status

## Handoff (Oct 4, 2026)

For whoever tests next. Everything below is on `main`; `bun test` (150 tests), `bunx tsc --noEmit` and `bun run smoke:demo` all pass.

### Built tonight
- **Closet dump onboarding:** photos of a closet rail, pile or drawer add every item (no wears); "add my closet" opens 10 minutes of it; onboarding offers it.
- **Usage guide:** onboarding ends with the three-photo loop; `/w/<token>/guide` and public `/guide` list every command with Copy buttons; a test fails if a router intent has no entry.
- **"What should I get rid of?":** up to 5 picks from wears, seasons, near-duplicates and never-worn; return / resell / donate exits; "sold 2", "donated 2", "returned 1".
- **Profile details:** name, age range, week, sizes, asked in onboarding and editable by text or on the page; sizes go into every Depop/eBay link.
- **Nike-style redesign** of every page and the recap card (`docs/DESIGN-nike.md`), with page cross-fades.
- **Demo seed from real photos,** as Inesh (18–24; class, gym, going out; S); it prints the closet and both recommendation replies.
- **"Show my closet" / "show my fit checks"** by text.
- **`bun run smoke:demo`:** the whole demo conversation on a throwaway database with the models stubbed, every reply printed.

### Not built
- **Season-aware "what should I buy for winter?"** It goes to the existing "what should I buy?" (outfit gap, notes for their week, budget line, sized secondhand links), which doesn't look at the coming season.
- **Weekly recap push.** The monthly one (on the 1st) exists; "my recap" sends one on demand.
- **CSV export** of the closet.

### How to run the live test
1. Create (or reuse) the Neon branch and point this shell at it:
   ```sh
   npx neonctl branches create --name demo        # skip if it exists
   export DATABASE_URL="$(npx neonctl connection-string demo)"
   ```
2. Find the demo phone's sender ID. The bot doesn't log it, so: run `bun start`, text the bot once from the demo phone, stop the bot, then read the ID:
   ```sh
   bun -e 'const { sql } = await import("./src/store.ts"); console.log(await sql`select id, created_at from users order by created_at desc limit 3`); await sql.close()'
   ```
   Use it exactly as shown (`+1…`, or an email for iMessage, a number for Telegram).
3. Seed (about 5 minutes; real vision calls): `DEMO_PHONE='<that id>' bun run seed:demo`. Check the printed closet and the two replies.
4. `bun start` in the same shell, then the demo on the real phone: a fit check; "show my closet"; "do I have this?" then a photo of something you own, reply "skip"; an order screenshot; "what should I get rid of?" (the Zara jacket: **before** "return", or it's gone); "check returns", then "return"; "my impact"; "show my fit checks"; "my recap".
5. Notes:
   - "check returns" skips orders placed in the last 7 days, so a fresh screenshot won't be nudged on the spot. The seeded Zara jacket (25 days old) is the one it asks about.
   - **Rerun the seed before each rehearsal.** It wipes and recreates only the demo user.

### Remaining submission tasks, in order
1. Live run on a real phone, noting reply timings (the bot logs `[timing]` per message).
2. Backup video of the demo.
3. README pass for the LLM judge.
4. Devpost.
5. Figma frames from the current design: no Nike names or logos anywhere visible (the style is borrowed from their design analysis; our name and type only).
6. Screenshots, including the recap card.
7. Make the repo public right before submitting (check `.env` and `demo_images/` photos aren't committed; both are gitignored).

### Known issues found tonight
- **The bot doesn't log sender IDs,** hence step 2 above.
- **The seeded closet has one declutter pick.** It was all worn in the last 3 weeks, so "what should I get rid of?" shows only the never-worn Zara jacket, and "Nothing to clear out" once it's returned.
- **"Do I have this?" now asks "Skip it?" before counting** (#36). Reply "skip" during the demo, or "my impact" won't show the new skip.
- **Short names use the item type,** so chinos read as "beige pants" in "show my closet" and fit check lists.
- **A city must be in their words.** One the router's model fills in without it appearing in the text is dropped and asked again ("moved to NYC" read as "New York" gets asked). This guards against cities copied from prompt examples.
- **The smoke test stubs the text model with empty answers,** so it covers every command handled before the router, not free-form routing. `bun run eval` covers that: 64/65, the miss being one item dropped from a long chained message.
- **The seed takes about 5 minutes** for 15 photos.
- **Cosmetic:** one merge commit message on `main` has stray quotes (left alone: fixing it needs a force-push). `flows.ts` has two unused imports from upstream.

---

Where Second Thought stands against the [build plan](PLAN.md). Updated Oct 4, 2026, after the handoff.

**Legend:** ✅ done · 🟡 partly done · ⬜ not started · ✂️ dropped by a plan change

## Summary

| Area | Status |
|---|---|
| P0: core (gate: hour 12) | ✅ 5 of 5 |
| P1: differentiator | ✅ 3 of 3 |
| P2: stretch | 🟡 3 of 4 (Nessie left) |
| Submission checklist | 🟡 README only; **the repo is still private** |

**P0 is done, so the hour 12 gate is met** (built in code; still to be checked live end to end). P1 is done too, and misread fit checks can now be fixed on the wardrobe page or by text. Next: make the repo public, seed and rehearse the demo, then the rest of the submission checklist; P2 only if time is left.

## MVP: the three-photo loop

The product, as pitched: **a fit check most mornings, a screenshot when shopping, the receipt after buying.** Built end to end; two pieces still unproven on a real phone.

| Step | Built | Proven live |
|---|---|---|
| Fit check → closet (dedup, wears) | ✅ | ✅ real photos, HEIC, closet eval |
| Screenshot → "do I have this?" (matches, CO₂, skip) | ✅ | 🟡 only on rendered store pages, not real store apps |
| Receipt / order → return window → "return it?" | ✅ | 🟡 online order screenshots in tests; **paper receipts untried** |
| Payoff: impact counter, recap | ✅ | ✅ real data |
| When it's wrong: corrections, fit check editor | ✅ | ✅ test users |
| Trust: "stop" pauses all notifications, "delete my data" erases everything (#29) | ✅ | ✅ test user |

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
| Season-aware closet ghosts + resale drafts | ✅ | Seasons come from each city's **climate** (10 years of Open-Meteo daily highs, averaged per month, cached), not daily weather: heavy outerwear when the average high is ≤ 50°F, mid layers ≤ 65°F, warm pieces ≥ 72°F, the rest all year. After ~3 weeks of an item's season unworn (while they keep sending fit checks), the bot asks "what happened to this?" with six numbered answers: keep (snooze), occasion-only, in storage (saves the location), doesn't fit (suggests listing it now, with a Depop price check), sold/donated/returned (counted), broke or tossed (removed, with how long it lasted and a quality note if under a year). At most one question a week; "check my closet" for demos (#26). |
| Nessie transaction detection | ⬜ | Decide at hour 12 per the plan; currently out of reach. |
| Secondhand search links | ✅ | The shopping check's "no match" reply links a Depop search built from the extracted description. |
| Monthly recap card | ✅ | A 1080×1350 image: estimated CO₂ saved, fit checks, pieces worn out of the closet, skips or money back, the most-worn piece **per category** with its photo, and pieces that didn't get worn. "my recap" texts it for the last 30 days; the wardrobe page links to `/w/<token>/recap`; the scheduler sends last month's on the 1st, once per user. Drawn server-side with Satori + resvg (#22). |

## Built beyond the plan

These weren't features in the plan, but the flows need them:

- Onboarding with a real city: looked up, with a numbered list to pick from when ambiguous ("Detroit, Michigan / Detroit, Texas…")
- One-off reminders ("remind me friday at 5pm…"), a daily fit check prompt, "my reminders" / "cancel 1"
- Remove items in plain words ("sold my grey sweater")
- Wardrobe page (`/w/<token>`): items with locations, fit check photos, reminders, an editable profile. This is the plan's "one closet page".
- Landing page with a QR code that texts the bot
- Typing bubble while the bot works
- Demo seed profile: Inesh, 18–24, class/gym/going out, tops and bottoms S; the seed prints both recommendation replies. "What should I buy?" now links a secondhand search (Depop, then eBay) for each thing it suggests, in their size; sneakers from sports brands count as athletic shoes; a returnable order needs only a week (not 30 days) before "what should I get rid of?" offers it back, whatever the season. Occasions are now saved as JSON, since Bun's Postgres client doesn't encode JS arrays (PGlite does, so tests missed it)
- Profile details: onboarding asks once (after the city, before the closet offer) for first name, age range, what their week looks like and sizes, all optional; the text model reads the free-form answer into fields, code checks every value, and only unclear fields are asked again, once. Stored as `users.age_range` (18-24 / 25-34 / 35+ only: under 18 is stored as null and not asked again), `occasions`, `size_top/bottom/shoe`; editable on the wardrobe page and by text ("my shoe size is 10" with no model; "I work in an office now" via a new `update_details` router intent). Occasions add notes to "what should I buy?" (gym without athletic shoes, office days without office pieces, after checking everything owned, storage included); sizes go into every Depop/eBay link (in the search text, since URL size filters need per-category ids); the age range only adds a budget line. The name appears in greetings, fit check replies and the recap. "Delete my data" removes it all with the user row. Router eval 64/65 with the new intent; a city the model copied from an example is now dropped (`src/profile.ts`)
- "What should I get rid of?" (also "declutter", "clean out my closet", "what don't I wear"): up to 5 picks computed from their own data, no model: closet ghosts (reusing `ghosts.ts`, so nothing is flagged off-season), near-duplicates where one is worn ≥3× less (pairs the vision comparison rated "similar", now recorded at ingest in `item_alike`), and pieces never worn since added; anything added or worn in the last 30 days is skipped. Exits: return while the purchase window is open (listed first), else resell timed to the season (warm pieces in spring, cold ones in fall, with the resale draft and Depop/eBay links) or donate plain basics. "sold 2" / "donated 2" lets the item go and counts it in the impact counter. Shown as a "Let go" section of feature cards on the wardrobe page (`src/declutter.ts`)
- Usage guide: onboarding ends with the three-photo loop in one short message plus the guide and wardrobe links, and "help" ends with the guide link. The guide page (`/w/<token>/guide`, a tab beside the closet; public at `/guide`, linked from the landing page) shows the loop as feature cards and every command by section, each with a Copy button and an example reply. Its entries are keyed by router intent (`ACTION_NAMES` in `src/llm.ts`), and a test fails if an intent has none (`src/guide.ts`, `src/guide-page.ts`)
- Design: every page (landing, wardrobe, guide, fit check editor, recap) and the recap card follow `docs/DESIGN-nike.md`: black, white and one soft gray; Inter 400/500 with Bebas Neue for the uppercase display tier; black pill CTAs (white on dark); flat zero-radius product cards with photos staged on gray; hairline rows; a sticky nav with an underlined active tab; no shadows. Motion: pages cross-fade (view transitions, nav held in place), content rises in with a short stagger, photos zoom gently on hover, presses shrink slightly; all off under reduced motion. Checked at 390px with device emulation, no horizontal overflow
- Closet dump onboarding: a photo of a closet rail, a pile on the bed or an open drawer (`image_kind: "closet_dump"`, read in the same extraction call) adds every item through the usual dedup with `source = 'closet'`, logging no outfit or wears and not counting as the day's fit check. "add my closet" / "closet dump" opens 10 minutes in which every photo counts as one; "done" (or time running out) sends "Your closet has n items…". Onboarding offers it right after the city step (`src/closet-mode.ts`)
- Wardrobe page shows which photos each item came from: thumbnails per item with a wear count, items listed under each fit check, linked both ways; tapping an item opens its photos large with a view transition (#11, #12)
- Fit check editor on the wardrobe page (`/w/<token>/fit/<id>`): "Same as this" merges an item the model split in two (suggestions ranked by type, LLM color groups, pattern and words), "Not in this photo" unlinks (and removes an item only that photo produced), and a search box suggests closet items as you describe one ("grey sweats", "pu…") or adds it as new (#13, #14)
- Corrections by text for the latest fit check: same as / relabel / missed / not there (#15)
- Letting items go: "got rid of the black jeans" asks whether it was returned, sold, donated or thrown away (unless the text says), and the wardrobe page has a Let it go menu per item; only thrown away counts nothing (#18)
- Item quantities: "plain white tee ×3", set with "How many?" on the wardrobe page; letting go of one of several leaves the rest; "how many … do I have" by text links to the item (#28)
- "stop" pauses everything the bot starts until they text again (reminders are held); "delete my data" asks, then erases everything and starts them over (#29)
- Deleting a fit check, on its edit page or by text ("delete my last fit check", confirmed with yes), taking the items only it added with it (#20)
- Find-by-name narrows by type and color in code before the model picks, so "sold my red hat" can't remove a gray crewneck (#8)
- Closet accuracy eval on 15 real photos (`bun run eval:closet`, results in `eval/closet-results.md`): 0 missed and 0 wrong merges on the 6 confidently repeated items, 100% of items found with the right category, 88% with the right color, and 6/6 shopping matches right at @1

## Plan changes since the first draft

- ✂️ **Embeddings / pgvector:** similarity is now SQL candidates by category plus a vision-model comparison (`src/closet/compare.ts`). The "enable pgvector" hour 0 task no longer applies.
- **Seasons from climate, not weather:** closet ghosts use each city's monthly climate normals instead of daily temperature per fit check (#26).
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
| outfits: photo, date, temperature | ✂️ No per-outfit temperature: seasons use city climate instead (`city_climate`), which is steadier and needs no daily weather calls |
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
| Close on the impact counter | ✅ Text "my impact", or open the wardrobe page; it now ends on an estimated CO₂ number with sources. "my recap" is a stronger closing visual: one shareable card |

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
| Waiting states live in memory | A restart drops an open "do I have this?" window, a new user's held first message, an unanswered "how did it go?", "delete it?" or "delete my data?" (the season check-ins are stored) | Acceptable for the demo; store them in the database if it matters |
| Deleting a fit check hard-deletes the items only it added | A skip that matched one of those items drops out of the impact counts | Rare; soft-delete instead if it matters |
| Seasonal check-ins in early October | In Ann Arbor, cold-weather pieces only came into season this month and puffers start in November, so only all-year items can be asked about in the demo | Expected behavior; show it with an all-year item, or explain the season months on stage |
| Help text is 15 bullets | A new user sees everything at once instead of the three-photo loop | Show the loop first, the rest behind "help more" |
| Paper receipts untested | Order intake was built for online order screenshots; store receipts abbreviate item names | Try one real receipt; tune the order prompt if needed |
| Listing detection tested only on rendered pages | Real retailer screenshots (Zara, Uniqlo apps) may look different | Try 3–4 real listing screenshots during the rehearsal |

## Suggested next steps, in order

**Feature freeze.** The MVP is built; what's left is proving it live and the submission.

1. **Live run on a real phone (team):** a fit check and a correction; a real store-app screenshot (Zara, Uniqlo, Depop) and "I didn't skip it"; a **paper receipt** and an online order screenshot, then "check returns"; "my recap", "check my closet", "my impact", "stop". Note anything odd.
2. **Simplify the help text** to the three-photo loop, with the rest behind "help more" (Claude, ~15 min).
3. **Fallback provider for photo calls** (Claude, ~30 min).
4. **Seed demo data** on a Neon branch (`bun run seed:demo`), merge duplicates with the editor.
5. **README pass** for the LLM judge: the three-photo loop, architecture (models perceive, code remembers and counts), evals (router 61/62, closet 50/50 found, 6/6 shopping matches, model comparison), failures found and fixed, CO₂ sources, "why not just ask ChatGPT?".
6. **Demo script** (the confession, the sweatpants, the screenshot, the recap) and two run-throughs; record the backup video.
7. **Devpost** (then make the repo public), Figma, screenshots incl. the recap card, sponsor requirements. Nessie only if entering that track.
