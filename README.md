# Second Thought

An iMessage bot that knows your closet. Text it fit checks and it remembers what you own and what you actually wear, so you stop buying things you already have. No app to install: everything happens in iMessage, plus one private wardrobe page.

Built for MHacks on [Spectrum](https://photon.codes/docs/spectrum-ts) (Photon's iMessage SDK) and Neon Postgres. The build plan is in [`PLAN.md`](PLAN.md).

## What it does

| You send | The bot |
|---|---|
| Your first text | Welcomes you and asks for your city |
| 📸 A fit check photo | Replies right away, then lists what you're wearing: items it already knows get a wear logged, new ones are added to your closet |
| "just got black jeans and a gray crewneck" | Adds both, with no photo needed |
| "sold the gray sweater" | Finds the item even when it was logged under other words (a "grey crewneck") and removes it |
| "put my winter jacket in the under-bed bin" | Remembers where it is |
| "where's my winter jacket?" | "Your winter jacket: under-bed bin, since Oct 3." |
| "what should I actually buy?" | Finds the gap in what you wear: "You wear 6 bottoms with the same 2 tops. A gray top would go with all of them: 6 new outfits." If nothing stands out, it says to buy nothing. |
| "remind me friday at 5pm to return the jacket" | Sends the reminder at that time |
| "fit check at 8am" / "stop fit checks" | Moves or turns off the daily fit check prompt |
| "my wardrobe" | A link to your wardrobe page: items by category, where they're kept, fit check photos, reminders, and an editable profile |
| "help" | The list of things it understands |

One text can carry several requests ("got a black puffer, remind me friday to return the green jacket"). The bot never gives style advice: "what should I wear?" gets a fixed reply saying so.

## How it works

```
iMessage ──► Spectrum (Photon) ──► src/index.ts ── message loop + reminder scheduler (every 15s)
                                        │
                     ┌──────────────────┼──────────────────────┐
                 text│                  │photo                 │
                     ▼                  ▼                      ▼
             src/llm.ts router    src/flows.ts            src/web.ts
          (local qwen2.5:7b via   save photo, reply now;  landing page + QR,
           Ollama → JSON actions) extract items in the    wardrobe page /w/<token>,
                     │            background (Gemini)     photos /photos/<id>
                     ▼                  │
             src/flows.ts               ▼
             runs the actions     src/ingest.ts + src/match.ts
                     │            match each item to the closet
                     └────────┬─────────┘
                              ▼
                 Neon Postgres (src/store.ts, src/closet/repo.ts)
```

**Two models, each doing what it's good at.**

- **Vision: Gemini through OpenRouter** (`src/closet/vlm.ts`, `src/closet/extract.ts`). A fit check photo becomes a list of items, each with type (from a fixed list of 42), category, colors, pattern, fit, season and a short description. Output is forced into a JSON schema and validated with zod. HEIC photos straight from an iPhone work.
- **Text: a local `qwen2.5:7b`** through Ollama (`src/llm.ts`), or any OpenAI-compatible endpoint. It turns a free-form text into validated actions, using a prompt with few-shot examples. Exact commands like `my wardrobe` and `help` skip the model entirely. It also handles every naming judgment (below), so those don't use up the vision model's small free-tier quota.

**Matching: is this the item they already own?** (`src/closet/compare.ts`, `src/match.ts`, `src/ingest.ts`)

For a fit check photo, the vision model decides. SQL pulls the closet items in the same categories as what's in the photo. One call then sends the new photo, up to 6 earlier photos those candidates came from, and the candidate list ("12: black ballet flats (flats, black, solid) [in photo B]"). The model rates each candidate `near_identical`, `similar` or `different`, with a short reason. Earlier photos are chosen by taking turns between items in the new photo, so a busy outfit can't crowd out one item's only match. Only `near_identical` logs a wear. Because the model looks at the actual garments, wording drift between extractions ("blouse" one day, "t-shirt" the next) doesn't create duplicates, and two black woven bags described the same way can still be told apart. Comparisons run at medium reasoning effort: at low effort, the model merged a flap bag with a tote every time.

If the vision call fails, or for items added by text, matching falls back to names:

The same jeans get described differently from photo to photo ("grey", then "charcoal"), and people text names that differ from what was logged. String equality creates duplicates, and asking a 7B model "is this the same item?" outright turned out unreliable: it paired a white graphic tee with a plain white tee even when told not to. So name matching is split:

1. The local model sorts each color and pattern *name* into a fixed group (charcoal → gray, off-white → cream, gingham → plaid, logo → graphic). This is a single-word judgment, which a small model does reliably. Results are cached.
2. Code compares: same type, same color group (or a neighboring shade such as cream/beige or blue/navy, because the vision model drifts between them), and same pattern group. "unknown" (a detail the user never mentioned) matches anything.
3. Among several candidates, an exact color group wins, then the same fit. Each owned item matches at most once per photo, so two black tees in one photo stay two tees.

A matched item gets a wear logged. If it was added by text, it also picks up the details and photo it was missing. An unmatched item is added to the closet. If the local model is down, names are compared exactly, so an outage causes a few duplicates but never loses a photo.

Finding an item by name ("where's my gray sweater?") tries the exact name, then matching words, then asks the local model to pick from the closet.

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
| `purchases`, `return_policies` | bot | created, not used yet (order intake) |

## Accuracy so far

- **Text router:** 47 of 47 sample texts routed correctly (`bun run eval`), including chained requests. That's about 1.7s per text on an M-series Mac.
- **Name grouping:** 9 of 9 tricky color and pattern names sorted correctly (charcoal, heather grey, dark blue, khaki, maroon, sage, pinstripe, gingham, logo). The matcher kept a graphic tee, a plain tee, navy jeans and black jeans apart while matching grey with charcoal.
- **Extraction:** on a real outfit photo sent twice (once as HEIC, once as JPEG), Gemini found the same 6 items both times in about 2s. Two of them came back with drifted names (off-white → beige, plus a second color on the sunglasses), which is why neighboring shades now match.
- **Vision matching** (10 street-style test photos, 6 of the same person on different days, run end to end on a local database): resending a photo added no duplicates (5 of 5 items, then 8 of 8 on a 54-item closet). The same leather-panel top was recognized across two days although its descriptions differed, and different people's items never merged. A cropped "shopping photo" of camo pants matched the owned pants as `near_identical`, and matched nothing before they were in the closet. On 5 hard cases run 5 times each: 19 of 25 right. The misses: two woven black bags (a flap bag and a tote) merged in 4 of 5 runs, and a resent top in a crowded closet was missed in 2 of 5.
- **Tests:** 41 unit and database tests (`bun test`, using in-process Postgres via PGlite).

## Setup

You need [Bun](https://bun.sh), [Ollama](https://ollama.com), a Photon project, an OpenRouter API key, and a Neon database.

```sh
bun install
ollama pull qwen2.5:7b
cp .env.example .env            # then fill it in (below)
vercel env pull                 # writes DATABASE_URL to .env.local (Neon via the Vercel Marketplace)
bun start
```

| Variable | Needed | What it is |
|---|---|---|
| `PROJECT_ID`, `PROJECT_SECRET` | yes | Spectrum credentials from the [Photon dashboard](https://app.photon.codes) |
| `DATABASE_URL` | yes | Neon Postgres connection string |
| `OPENROUTER_API_KEY` | for photos | Without it, photos are saved but not read |
| `VISION_MODEL` | no | Any OpenRouter vision model with structured outputs. Defaults to `google/gemini-3.8-flash` (about $0.004 per extraction; a comparison with earlier photos costs a few cents). |
| `COMPARE_MODEL` | no | Model for the matching comparison only. Defaults to `VISION_MODEL`. |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` | no | Text model; defaults to local Ollama with `qwen2.5:7b` |
| `LLM_PROVIDERS` | no | OpenRouter only: comma-separated providers allowed to serve the text model (e.g. `google-vertex`). |
| `PORT`, `PUBLIC_URL` | no | Web server; links default to this machine's LAN address on port 3000, so phones on the same Wi-Fi can open them |
| `BOT_NUMBER` | no | The number on the landing page's QR code |

### Scripts

| Command | Does |
|---|---|
| `bun start` / `bun run dev` | Run the bot (`dev` restarts on file changes) |
| `bun test` | Unit and database tests (no network) |
| `bun run eval` | Router accuracy against the local model |
| `bun run extract` | Run extraction on the photos in `test_images/` (not checked in; see `test_images/ATTRIBUTION.md`) |
| `bun run migrate` | Create or update tables on `DATABASE_URL` |

## Project layout

```
src/
  index.ts          Spectrum setup, message loop, reminder scheduler
  flows.ts          Onboarding, commands, replies, photo handling
  llm.ts            Text router (local model) and llmJson helper
  ingest.ts         Fit check items → wears or new items
  match.ts          Name grouping, item matching, find by name
  gaps.ts           "What should I buy?"
  store.ts          Database access for the bot
  web.ts            Landing page, wardrobe page, photo serving
  config.ts         Port and public URL
  schema.sql        Bot tables
  closet/           Closet module: categories, extraction, visual comparison, shopping match, repo
  db/               Closet schema, migration, test database
scripts/            eval-router, extract-test-images, migrate
```

## Roadmap

Against [`PLAN.md`](PLAN.md):

- **Done:** closet intake from fit checks and texts (P0), season tags, "where did I put it?", "what should I buy?" (P1), plus reminders, daily fit checks, the wardrobe page and onboarding.
- **Next (P0):** "Do I already have this?" in the bot (`matchShoppingPhoto` in `src/closet/shopping.ts` returns the top 3 owned items with reasons and photos; it needs a way to tell a shopping photo from a fit check); order screenshot intake with return deadlines; return nudges ("you haven't worn this yet"); the impact counter.
- **Later (P2):** season-aware closet ghosts and resale drafts, Nessie transaction detection, secondhand search links, a monthly recap card.
- **Not yet:** CLIP embeddings with pgvector. SQL narrows by category and the vision model judges, which is enough for a closet of this size.
