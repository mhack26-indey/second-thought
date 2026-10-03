# Second Thought: MHacks Build Plan

Oct 3, 2026 · @Sath S

**Status:** what's built and what's left is tracked in [ROADMAP.md](ROADMAP.md).

## Overview

We're building Second Thought, an iMessage bot that knows your closet: what not to buy, what to return, the one thing worth buying, and what to let go, season by season.

**The problem:** you buy new pants, then realize you bought nearly identical ones three months ago. Duplicate and regret purchases waste money, and clothing is one of the most wasteful consumer categories.

**The pitch:** text it fit checks and order screenshots and it remembers everything you own. No new app to open, and it never has to judge style. It learns from what you actually wear.

**Hackathon rule for this team:** core features first, a hard feature freeze, and nothing gets added that isn't in the Features section below.

## Track decisions

Go with Sustainability as the main track. The core of the product is not buying clothes you already own, which is a waste story. FinTech judges will expect money movement, and the returns feature alone is a weaker FinTech entry than the full product is a Sustainability one. Keep the honest framing: prevention first, refunds as the safety net, since returns themselves often create waste.

| Track | Decision | Why |
|---|---|---|
| Sustainability (main) | Yes | The most sustainable clothes are the ones you already own |
| Judged by an LLM (fun) | Yes | Vision extraction, vision-model matching, and gap logic are technically strong; a clear README matters most here |
| Photon | Yes, core | The whole product lives in iMessage; 1st place also fast-tracks to Photon's final interview |
| Neon | Yes | One Postgres database holds the closet, wears, and purchases; a Neon branch keeps the seeded demo data safe |
| Best Design (Figma) | Yes, if time | Needs Figma screens plus polished recap cards and a small closet page; one person for about 3 hours |
| Nessie | Stretch, decide at hour 12 | Auto-detecting purchases from transactions is a real use, but it's not core |
| SpacetimeDB | No | The friends feature is dropped, and it would compete with Neon as the core backend |

## Features

Five core features must work by hour 12; everything else is earned after that.

### P0: core (must work by hour 12)

- **Closet intake:** fit checks and closet photos become saved items (type, color, pattern, season).
- **"Do I already have this?"** A shopping photo or link returns your similar items, with photos.
- **Order intake:** an order screenshot adds the item to the closet and logs its return window.
- **Return nudges:** a reminder before the deadline, plus "you haven't worn this yet" if it hasn't shown up in a fit check.
- **Impact counter:** purchases avoided and money recovered.

### P1: the differentiator (hours 12–16)

- **The one thing worth buying:** from the items you wear together, find the bottleneck category. Example: you wear 8 pants with the same 2 tops, so a top would unlock the most new outfits.
- **Season tags:** added during extraction from the start, since it's one more field.
- **Where did I put it?** "Winter jacket is in the under-bed bin" saves a location; "where's my jacket?" returns it.

### P2: stretch (only after P1 works)

- **Season-aware closet ghosts:** an item counts as unworn only on days the weather suited it, then the bot drafts a resale listing timed to the season.
- **Nessie transaction detection:** "What was this $64 at Nordstrom?"
- **Secondhand search links** when nothing matches.
- **Monthly recap card** (move this up if going for Best Design).

### Cut: do not build

- Friends' closets (hygiene objection, needs many seeded closets)
- Price-drop tracking, Gmail integration
- Style advice or outfit generation
- A full web app beyond one closet page

## User flows

Every flow starts with a text or a photo; the bot replies in one or two short messages.

1. **Build the closet**
   - You: [mirror selfie]
   - Bot: Logged 3 items: black straight-leg jeans, gray crewneck, white sneakers.
2. **While shopping**
   - You: [photo of pants] do I have something like this?
   - Bot: You have 2 similar pairs [photos]. The ones from August are still returnable until Oct 18.
   - No match: Nothing like it in your closet. Here's a secondhand search for it.
3. **After buying**
   - You: [order confirmation screenshot]
   - Bot: Added the green jacket. Return window closes Oct 31.
4. **Before the deadline**
   - Bot: The green jacket hasn't shown up in any fit checks. Keeping it?
   - You: return
   - Bot: Here's the return link and the nearest drop-off.
5. **Worth buying (P1)**
   - You: what should I actually buy?
   - Bot: You wear 8 pants with the same 2 tops. A neutral top would go with all of them.
6. **Where is it (P1)**
   - You: put my winter jacket in the under-bed bin
   - Later: where's my winter jacket? → Under-bed bin, since Sept 12.

## Architecture

One app server receives every iMessage through Photon, calls the vision model, and keeps everything in Neon.

The scheduler is the only thing that messages first; everything else is a reply. Nessie is dashed because it's a stretch goal.

### Stack

- **Messaging:** Photon (use whichever language its SDK supports best; confirm in the handbook in hour 0)
- **Extraction:** a vision-capable LLM API that returns structured JSON per item
- **Similarity:** SQL pulls same-category candidates, then the VLM compares the photo against them (no embeddings)
- **Weather:** Open-Meteo (free, no API key) for season-aware logic
- **Reminders:** a scheduled job that checks deadlines every hour

### Data model

| Table | Key fields |
|---|---|
| items | photo, type, color, pattern, season, source (fit check, order, closet photo), location, status (owned, returned, sold) |
| outfits | fit check photo, date, temperature |
| wears | item, outfit (which items were worn together; this powers outfit gaps) |
| purchases | item, retailer, price, order date, return deadline, status |
| return_policies | retailer, return days, notes |
| users | phone number, city for weather |

## Team roles

Split along the two halves of the system so nobody blocks anyone after hour 2.

| Role | Owns | Default owner |
|---|---|---|
| Vision and matching | Item extraction prompt, VLM comparison, similarity search, outfit-gap logic | Sath |
| Messaging and flows | Photon setup, intent routing, conversation replies, reminder scheduler | q |
| Data and returns | Neon schema, order screenshot parsing, return-policy table | Whoever finishes their P0 piece first |
| Design and pitch | Figma screens, recap card, closet page, demo script, Devpost | Shared from hour 16 |

With a third or fourth teammate, give them Data and returns, then Design and pitch.

**Sleep:** take turns. One person naps 2–3 hours while the other builds, swapping around hours 13–18, so someone is always awake and both are rested for the demo.

## Timeline

Hour 0 is when hacking starts; map these onto MHacks' actual clock once you have the schedule.

The hour 12 gate is the one that matters: if the five core features don't all work by then, spend hours 12–16 finishing them instead of starting the differentiator.

### Hour 0 tasks (do these before anything else)

- [x] Get Photon sending and receiving a photo (find their mentor if stuck)
- [x] Create the Neon database ~~and enable pgvector~~ (no longer needed: matching uses the vision model)
- [x] Run the extraction prompt on 5 real fit checks and check the JSON
- [x] Write the return-policy table for the top 15 retailers

## Demo script

The demo runs about 2 minutes and ends on the impact number.

1. **Hook (15 sec):** "Who's bought something, then realized they already owned it?" Show of hands.
2. **The closet (15 sec):** show the pre-loaded closet built from a few weeks of real, dated fit checks.
3. **Shopping (30 sec):** text a photo of black pants. The bot replies with your near-identical pair and notes they're still returnable.
4. **Returns (30 sec):** text an order screenshot for a jacket. Fast-forward: "You haven't worn this jacket. Return by Friday?" Reply "return" and get the drop-off info.
5. **Worth buying (15 sec):** "What should I actually buy?" The bot names the bottleneck category.
6. **Close (15 sec):** the counter: purchases avoided and money saved. "The most sustainable clothes are the ones you already own."

If the live iMessage demo fails, switch to the backup video without apologizing.

## Submission checklist

Start the Devpost draft at hour 19, not hour 23.

- [ ] Devpost page: problem, solution, how it works, tracks entered (Sustainability, Judged by an LLM, Photon, Neon, Best Design, Nessie if built)
- [ ] README written for the LLM judge: architecture, how matching works, what's real versus seeded, one or two accuracy numbers from testing
- [ ] Public repo with setup steps
- [ ] Backup demo video, 2 minutes, recorded by hour 22
- [ ] Figma file link (for Best Design)
- [ ] Screenshots of the key iMessage moments for the Devpost gallery
- [ ] Check each sponsor's submission requirements in the Hacker Handbook
- [ ] Two full pitch run-throughs

## Risks and fallbacks

Photon setup is the biggest risk, so it's the first thing built.

| Risk | Fallback |
|---|---|
| Photon setup takes hours or images don't come through | Hit it in hour 0 with a sponsor mentor; build the backend against a test endpoint meanwhile |
| Mirror selfies with several items extract badly | Test with real fit checks by hour 4; fall back to one item per photo |
| Similarity matches look wrong | Narrow candidates by category first, then fix the VLM comparison prompt using the eval set; show the top matches with photos so near-misses still help |
| Return policies are wrong | Hardcoded table for about 15 retailers, plus "verify on the retailer's site" in every reminder |
| Cold start makes the demo thin | Seed a few weeks of dated fit checks and orders from your own closet |
| Scope creep | Hour 12 gate and hour 19 feature freeze; anything not in Features waits for after MHacks |
| Live demo fails on venue Wi-Fi | Backup video recorded by hour 22 |
