# Second Thought

An iMessage bot that knows your closet. Text it fit checks and order screenshots and it remembers what you own and what you actually wear, so you stop buying things you already have and send back what you never wear. No app to install: everything happens in iMessage, plus one private wardrobe page.

Built for MHacks on [Spectrum](https://photon.codes/docs/spectrum-ts) (Photon's iMessage SDK) and Neon Postgres. The build plan is in [`PLAN.md`](PLAN.md).

## What it does

| You send | The bot |
|---|---|
| Your first text | Welcomes you and asks for your city, then a few optional profile questions in one message (first name, age range, what your week looks like, sizes; "skip" for any, and only unclear answers get asked again, once), offers to add your closet from a few photos (or skip), then explains the three-photo loop (fit check, "do I have this?" screenshot, receipt) with a link to the guide, and sends your wardrobe page link |
| 👕 A photo of your closet rail, a drawer or a pile of clothes | Reads every item and adds the new ones to your closet, with no wears logged: "Added 6 items: navy polo, black jeans, … 2 you already had." "add my closet" (or "closet dump") makes every photo for the next 10 minutes count as one; "done" ends it with "Your closet has 23 items…" |
| 📸 A fit check photo | Replies right away, then lists what you're wearing: items it already knows get a wear logged, new ones are added to your closet |
| "do I have this?", then a photo (or the photo, then "do I have this?") | Checks the photo against your closet without saving it: "You already have 1 like this:" with the model's reason, how long you've owned it and whether it's still returnable, then that item's photo. No match: a Depop search link. A product photo sent on its own gets the same check. |
| 🧾 An order screenshot | Adds each item to your closet and logs the purchase: "Added black jeans from Zara ($49.90). Return window closes Oct 31." Warns if you already own it. |
| (3 days before a return window closes) | "You haven't worn the black jeans from Zara in any fit checks yet. Return window closes Oct 6. Keeping it? Reply keep or return." |
| "return" / "keep" / "returned it" | Marks the return and links the retailer's returns page, or confirms you're keeping it. "check returns" runs this check right away, for any order at least a week old. |
| "my impact" | "You've skipped 2 purchases and gotten $49.90 back." Also at the top of the wardrobe page. |
| "just got black jeans and a gray crewneck" | Adds both, with no photo needed |
| "sold the gray sweater" | Finds the item even when it was logged under other words (a "grey crewneck") and removes it |
| "put my winter jacket in the under-bed bin" | Remembers where it is |
| "where's my winter jacket?" | "Your winter jacket: under-bed bin, since Oct 3." |
| "what should I get rid of?" (or "declutter") | Up to 5 pieces you don't wear, worked out from your own fit checks: unworn through their whole season (a puffer is never flagged in July), the one of two near-duplicates you skip ("You have 2 navy polos; you wear the other one 5× more"), or never worn since added. Nothing added or worn in the last 30 days. Each gets an exit: return it while the window's open, otherwise resell (timed to when people buy it: "list it in March, when people buy shorts", with Depop and eBay links) or donate a plain basic. "sold 2" or "donated 2" takes it out and counts it in your impact. Also a "Let go" section on the wardrobe page. |
| "what should I actually buy?" | Finds the gap in what you wear: "You wear 6 bottoms with the same 2 tops. A gray top would go with all of them: 6 new outfits." If nothing stands out, it says to buy nothing. |
| "remind me friday at 5pm to return the jacket" | Sends the reminder at that time |
| "fit check at 8am" / "stop fit checks" | Moves or turns off the daily fit check prompt |
| "my wardrobe" | A link to your wardrobe page: items by category, where they're kept, fit check photos, reminders, and an editable profile |
| "my shoe size is 10", "I work in an office now" | Updates your profile (also editable on the wardrobe page). Your week shapes "what should I buy?" (the gym with no athletic shoes, office days with no office pieces, checked against what you already own, storage included), your sizes go into every Depop/eBay link, and your age range only changes the budget line (secondhand first when younger), never what's suggested. Your name shows up in greetings, fit check replies and the recap. An age range is stored, never an age; under 18 is stored as nothing. |
| "help" | The short list of things it understands, ending with a link to the full guide: every command with an example reply and a Copy button, at `/w/<token>/guide` (a tab next to your closet) and publicly at `/guide` |

One text can carry several requests ("got a black puffer, remind me friday to return the green jacket"). The bot never gives style advice: "what should I wear?" gets a fixed reply saying so.

## How it works

```
iMessage ──► Spectrum (Photon) ──► src/index.ts ── message loop + scheduler (every 15s:
                                        │           reminders, fit check pings, return nudges)
                     ┌──────────────────┼───────────────────────┐
                 text│                  │photo                  │
                     ▼                  ▼                       ▼
             src/llm.ts router    src/flows.ts             src/web.ts
          (Llama 3.1 8B on        save photo, reply now;   landing page + QR,
           OpenRouter → JSON      read it in the           wardrobe page /w/<token>,
           actions)               background (Gemini 3.8   photos /photos/<id>
                     │            Flash on OpenRouter)
                     ▼                  │
             src/flows.ts               ▼
             runs the actions     src/photo-intake.ts: fit check → ingest + match;
                     │            order screenshot → src/orders.ts;
                     │            product photo → shopping match
                     │            closet dump → closet items, no wears
                     └────────┬─────────┘
                              ▼
                 Neon Postgres (src/store.ts, src/closet/repo.ts)
```

**Two models, both through OpenRouter, each doing what it's good at.**

- **Vision: `google/gemini-3.8-flash`** on Google Vertex's priority tier (`src/closet/vlm.ts`, `src/closet/extract.ts`). One call says what kind of photo it is (fit check, order screenshot, product photo or closet dump) and turns it into a list of items, each with type (from a fixed list of 42), category, colors, pattern, fit, season and a short description. Output is forced into a JSON schema and validated with zod. HEIC photos straight from an iPhone work.
- **Text: `meta-llama/llama-3.1-8b-instruct`** (`src/llm.ts`), chosen in PR #8 over Mistral Small, Qwen3 30B and a local qwen2.5:7b for accuracy and speed (about 0.3s per text). Any OpenAI-compatible endpoint works instead, including local Ollama. It turns a free-form text into validated actions, using a prompt with few-shot examples. Exact commands like `my wardrobe` and `help` skip the model entirely. It also handles the naming judgments (below), which are cheap single-word calls that don't need a vision model.

**Matching: is this the item they already own?** (`src/closet/compare.ts`, `src/match.ts`, `src/ingest.ts`)

For a fit check photo, the vision model decides. SQL pulls the closet items in the same categories as what's in the photo. One call then sends the new photo, up to 6 earlier photos those candidates came from, and the candidate list ("12: black ballet flats (flats, black, solid) [in photo B]"). The model rates each candidate `near_identical`, `similar` or `different`, with a short reason. Earlier photos are chosen by taking turns between items in the new photo, so a busy outfit can't crowd out one item's only match. Only `near_identical` logs a wear. Because the model looks at the actual garments, wording drift between extractions ("blouse" one day, "t-shirt" the next) doesn't create duplicates, and two black woven bags described the same way can still be told apart. Comparisons run at medium reasoning effort: at low effort, the model merged a flap bag with a tote every time.

If the vision call fails, or for items added by text, matching falls back to names:

The same jeans get described differently from photo to photo ("grey", then "charcoal"), and people text names that differ from what was logged. String equality creates duplicates, and asking a small text model "is this the same item?" outright turned out unreliable: it paired a white graphic tee with a plain white tee even when told not to. So name matching is split:

1. The text model sorts each color and pattern *name* into a fixed group (charcoal → gray, off-white → cream, gingham → plaid, logo → graphic). This is a single-word judgment, which a small model does reliably. Results are cached.
2. Code compares: same type, same color group (or a neighboring shade such as cream/beige or blue/navy, because the vision model drifts between them), and same pattern group. "unknown" (a detail the user never mentioned) matches anything.
3. Among several candidates, an exact color group wins, then the same fit. Each owned item matches at most once per photo, so two black tees in one photo stay two tees.

A matched item gets a wear logged. If it was added by text, it also picks up the details and photo it was missing. An unmatched item is added to the closet. If the text model is down, names are compared exactly, so an outage causes a few duplicates but never loses a photo.

Finding an item by name ("where's my gray sweater?") tries the exact name, then matching words, then asks the text model to pick from the closet.

**What to buy next** (`src/gaps.ts`) counts the distinct tops, bottoms and shoes worn in the last 90 days of fit checks. If one slot has half as many pieces as the largest (or fewer), one more piece there goes with every combination of the others. The bot names that slot, a neutral color you don't already have there, and how many new outfits it would give you. The answer is plain code over the `wears` table, not model output.

**Reliability.** The scheduler claims each reminder and daily ping in the database before sending, so a slow send or a second process can't fire it twice. A failed send releases the claim. Slow vision calls run off the message loop, and fit check matching runs one photo at a time per user.

## Data model

All in Neon Postgres. Tables are created on startup (or with `bun run migrate`).

| Table | Owner | Holds |
|---|---|---|
| `items` | closet module (`src/db/schema.sql`) | type, category, colors, pattern, fit, season, description, photo, source (`fit_check` / `text` / `order` / `closet`), location, status (active / returned / removed) |
| `outfits` | closet module | one row per fit check: photo URL, date |
| `wears` | closet module | which items were worn in which outfit; powers wear counts and the outfit-gap logic |
| `users` | bot (`src/schema.sql`) | iMessage id, onboarding step, name, city, wardrobe page token, daily fit check hour |
| `photos` | bot | image bytes for fit checks, served at `/photos/<uuid>` |
| `reminders` | bot | one-off reminders and whether they've been sent |
| `purchases` | bot | one row per ordered item: retailer, price, order date, return deadline, status (kept / returning / returned), when it was nudged and the answer; `items.purchase_id` links back |
| `return_policies` | bot | return days and returns page for 15 retailers, seeded on startup |
| `impact_events` | bot | purchases skipped (a shopping check found a match) and money back (a return), for "my impact" |

## Accuracy

### Real photos (`bun run eval:closet`)

15 real outfit photos of one person, ingested in order through the live fit check path (extraction, then vision dedup against the closet so far) and scored against hand labels in `demo_images/labels.json` (31 items, 50 appearances; 16 items appear in 2+ photos, 6 of them with confident labels). Run Oct 3, 2026 on `google/gemini-3.8-flash`; full output in [`eval/closet-results.md`](eval/closet-results.md).

| Metric | Result |
|---|---|
| Unique items created vs true unique labels | 36 vs 31 |
| Missed merges (one item split into several) | 0 of 6 confidently repeated items |
| Wrong merges (different items merged) | 0 |
| Extraction: labeled items found, right category | 50/50 (100%) |
| Extraction: right category and color | 44/50 (88%) |
| Shopping match ("do I have this?" on a held-out photo): right item first | 6/6 |
| Shopping match: right item in top 3 | 6/6 |

What the numbers hide:

- **Color is the weak spot.** All 6 extraction misses are color names, and all 6 are muted colors in bad light: sage read as grey (twice), olive as khaki under purple light, navy shorts as black in a dark photo, black joggers as charcoal, and white sneakers as black under colored light. Dedup doesn't suffer (the comparison looks at the photos, not the names), but the closet's descriptions and "what should I buy?" color suggestions do.
- **Uncertain repeats stay separate.** 4 of the 5 extra items are repeats the labels mark as unsure (black joggers with the cargo pocket hidden, a pinned blazer that may belong to a suit, two pairs of black dress shoes, shorts in purple light). The model kept them apart, which is the cheaper mistake: a duplicate in the closet rather than two items merged. The fifth is a bag the labels missed.
- **The sample is small.** Only 6 items repeat with confident labels, and 4 of the 6 shopping checks come from two photos taken the same afternoon. One run; answers vary between runs.

### Earlier checks

- **Text router:** 64 of 65 sample texts routed correctly as of Oct 4 (earlier: 48 of 49) with Llama 3.1 8B (`bun run eval`), including chained requests, at about 0.3s per text; 15 of 16 on phrasings it hadn't seen. Local qwen2.5:7b scored 49 of 49 but took about 1.1s, and 14s for name grouping (comparison in `src/llm.ts`).
- **Name grouping:** 9 of 9 tricky color and pattern names sorted correctly (charcoal, heather grey, dark blue, khaki, maroon, sage, pinstripe, gingham, logo). The matcher kept a graphic tee, a plain tee, navy jeans and black jeans apart while matching grey with charcoal.
- **Extraction:** on a real outfit photo sent twice (once as HEIC, once as JPEG), Gemini found the same 6 items both times in about 2s. Two of them came back with drifted names (off-white → beige, plus a second color on the sunglasses), which is why neighboring shades now match.
- **Vision matching** (10 street-style test photos, 6 of the same person on different days, run end to end on a local database): resending a photo added no duplicates (5 of 5 items, then 8 of 8 on a 54-item closet). The same leather-panel top was recognized across two days although its descriptions differed, and different people's items never merged. A cropped "shopping photo" of camo pants matched the owned pants as `near_identical`, and matched nothing before they were in the closet. On 5 hard cases run 5 times each: 19 of 25 right. The misses: two woven black bags (a flap bag and a tote) merged in 4 of 5 runs, and a resent top in a crowded closet was missed in 2 of 5.
- **Tests:** 143 unit and database tests (`bun test`, using in-process Postgres via PGlite).

## Setup

You need [Bun](https://bun.sh), a Photon project, an OpenRouter API key (both models run on it), and a Neon database.

```sh
bun install
cp .env.example .env            # then fill it in (below)
vercel env pull                 # writes DATABASE_URL to .env.local (Neon via the Vercel Marketplace)
bun start
```

| Variable | Needed | What it is |
|---|---|---|
| `PROJECT_ID`, `PROJECT_SECRET` | yes | Spectrum credentials from the [Photon dashboard](https://app.photon.codes) |
| `DATABASE_URL` | yes | Neon Postgres connection string |
| `OPENROUTER_API_KEY` | yes | Both models. Without it, photos are saved but not read, and texts need `LLM_BASE_URL` pointing at another model |
| `VISION_MODEL` | no | Any OpenRouter vision model with structured outputs. Defaults to `google/gemini-3.8-flash` (about $0.004 per extraction; a comparison with earlier photos costs a few cents). |
| `COMPARE_MODEL` | no | Model for the matching comparison only. Defaults to `VISION_MODEL`. |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` | no | Text model; defaults to `meta-llama/llama-3.1-8b-instruct` on OpenRouter (or local Ollama with `qwen2.5:7b` when there's no OpenRouter key) |
| `LLM_PROVIDERS` | no | OpenRouter only: comma-separated providers allowed to serve the text model (e.g. `google-vertex`). Vision calls always use Google Vertex's priority tier. |
| `PORT`, `PUBLIC_URL` | no | Web server; links default to this machine's LAN address on port 3000, so phones on the same Wi-Fi can open them |
| `BOT_NUMBER` | no | The number on the landing page's QR code |

### Scripts

| Command | Does |
|---|---|
| `bun start` / `bun run dev` | Run the bot (`dev` restarts on file changes) |
| `bun test` | Unit and database tests (no network) |
| `bun run eval` | Router accuracy against the configured text model |
| `bun run extract` | Run extraction on the photos in `test_images/` (not checked in; see `test_images/ATTRIBUTION.md`) |
| `bun run migrate` | Create or update tables on `DATABASE_URL` |
| `bun run seed:demo` | Reset the demo user to a closet built from the real photos in `demo_images/` (below) |
| `bun run eval:closet` | Closet accuracy on the real photos against `demo_images/labels.json` (about 18 minutes; writes `eval/closet-results.md`) |

### Demo data

`bun run seed:demo` builds one phone's closet from real outfit photos in `demo_images/` (not checked in; see its README). Each photo goes through the same extraction and dedup as a live fit check, oldest first, so the closet, wear counts and repeat items are what the bot would really have made. Fit check dates come from the filenames (Pixel `PXL_2026…` and WhatsApp `IMG-2025…-WA…`), squeezed into the last 21 days in order; photos without a date are spaced evenly between them. On top of that it adds an unworn green jacket from a Zara order 25 days ago, puts the red puffer (or another jacket, if there's no puffer) in the under-bed bin, and records one earlier skipped purchase on the most-worn item. The demo user is Inesh (18–24; class, gym and going out; tops and bottoms in S, no shoe size). At the end it prints the closet (each item, its category, wear count and the photos it appeared in), then what the bot would answer to "what should I buy for winter?" and "what should I get rid of?" for that closet.

It wipes and recreates only that user's data (items, fit checks, photos, purchases, reminders, impact events), so run it before every rehearsal. The wardrobe page link stays the same across reruns. It makes real vision calls: one extraction and one comparison per photo, about 15–20 seconds each, so 15 photos take around 5 minutes.

```sh
bun run seed:demo --dry-run                     # which photos, on which days; no database, no model
DEMO_PHONE=+15551234567 bun run seed:demo --skip P7143138.jpg,IMG-20260114-WA0005.jpg   # leave photos out
```

Run it, and the bot, against a Neon branch so the demo never touches real users' data:

```sh
npx neonctl branches create --name demo         # a copy of main; add --project-id if you have several
npx neonctl connection-string demo              # copy this
export DATABASE_URL='postgresql://…'           # the branch's connection string
DEMO_PHONE=+15551234567 bun run seed:demo       # the demo phone's iMessage id, exactly as the bot sees it
bun start                                       # same shell, so the bot uses the branch too
```

`DEMO_NAME` and `DEMO_CITY` are optional (Sam, Ann Arbor). Photo links are saved with the current `PUBLIC_URL`, so seed with the same `PUBLIC_URL` the bot runs with. The script prints the wardrobe page link.

Then, from the demo phone: "do I have this?" and a new photo of a repeat item (the navy polo, say); "what should I buy?"; "where's my red puffer?"; "check returns", then "return"; "my impact". Check the printed closet first: these answers depend on what the model made of the photos. An order screenshot needs a real screenshot.

"check returns" skips orders placed in the last 7 days, since a new order hasn't had a chance to show up in a fit check. So a screenshot of something you just ordered won't be nudged on the spot; "check returns" nudges the seeded Zara jacket (ordered 25 days ago) instead. To show screenshot → nudge with your own screenshot, use one whose order date is at least a week old. The bot reads the date from the screenshot, and uses today only when none is visible.

## Project layout

```
src/
  index.ts          Spectrum setup, message loop, reminder scheduler
  flows.ts          Onboarding, commands, replies, photo handling
  llm.ts            Text router (Llama 3.1 8B on OpenRouter) and llmJson helper
  ingest.ts         Fit check items → wears or new items
  match.ts          Name grouping, item matching, find by name
  gaps.ts           "What should I buy?"
  shopping-mode.ts  "Do I have this?": shopping photo vs. fit check, match replies
  photo-intake.ts   Reads a saved photo: fit check ingest, closet dump, order screenshot → order intake, product → shopping match
  closet-mode.ts    "add my closet": 10 minutes of closet dump photos, "done", the onboarding offer
  declutter.ts      "What should I get rid of?": ghosts, near-duplicates, never worn; return, resell or donate; "sold 2"
  profile.ts        Profile details: onboarding question, parsing, sizes in links, occasion notes, budget framing
  guide.ts          The usage guide's content (every command, keyed by router intent), help text, onboarding intro
  guide-page.ts     The guide as a page: /w/<token>/guide and the public /guide
  web-style.ts      Shared page styling: design system tokens, icons, tabs
  orders.ts         Order intake: return policies, purchases, closet items, reply
  returns.ts        Return nudges, keep/return/"returned it", "check returns"
  impact.ts         Impact counter: skipped purchases and money back, "my impact"
  demo-seed.ts      Demo closet from real photos, via the live fit check path
  store.ts          Database access for the bot
  web.ts            Landing page, wardrobe page, photo serving
  config.ts         Port and public URL
  schema.sql        Bot tables
  closet/           Closet module: categories, extraction, visual comparison, shopping match, repo
  db/               Closet schema, migration, test database
scripts/            eval-router, eval-closet, extract-test-images, migrate, seed-demo
demo_images/        Real outfit photos (not checked in) and their labels; see its README
eval/               Eval results
```

## Roadmap

Against [`PLAN.md`](PLAN.md):

- **Done:** closet intake from fit checks and texts (P0), "do I already have this?" (P0), order screenshot intake with return deadlines (P0), return nudges (P0), the impact counter (P0), season tags, "where did I put it?", "what should I buy?" (P1), secondhand search links when nothing matches (P2), plus reminders, daily fit checks, the wardrobe page and onboarding.
  - "Do I have this?" (`src/shopping-mode.ts`): texting it (or "shopping", "checking something") makes the next photo within 5 minutes a shopping photo, matched and not saved. Texting it within 2 minutes after a photo takes that fit check back out (the outfit, its wears and the items only it added) and matches the same photo. The reply lists up to 3 owned items with the model's reason and month owned, then the top match's photo; with no match, a Depop search link.
- **Next:** demo data on a Neon branch, then the submission checklist.
- **Later (P2):** season-aware closet ghosts and resale drafts, Nessie transaction detection, a monthly recap card.
- **Not yet:** CLIP embeddings with pgvector. SQL narrows by category and the vision model judges, which is enough for a closet of this size.
