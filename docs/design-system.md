# Second Thought design system

Borrowed from the team's TSA Webmaster 2025 site ("Maitso", github.com/ineshd/TSA-Webmaster-2025), values taken from its `tailwind.config.ts`, `globals.css` and components. Borrow the system, not the restaurant screens.

## Colors

| Token | Hex | Use |
| --- | --- | --- |
| `--bg` | `#f5fcef` | Page background (pale mint-cream) |
| `--bg-dim` | `#ebf2e5` | Feature cards, table row stripes |
| `--bg-dimmer` | `#e0e8d8` | Borders, dividers, empty photo placeholders |
| `--primary` | `#a1cc80` | Buttons, pills, highlights, headings on black |
| `--primary-darker` | `#789960` | Section headings on light, button hover |
| `--primary-darkest` | `#647f50` | Pressed states, links |
| `--primary-superdark` | `#506640` | Small strong text on light green |
| `--secondary` | `#95e8cf` | Second accent (e.g. "returnable" badge) |
| `--accent` | `#f29450` | Warnings and nudges ("return window closes") |
| `--neutral` | `#25400c` | Dark green text on primary |
| `--ink` | `#000000` / body text `#333333` | Hero sections are black with `--bg` text |

## Type

- Headings: **Merriweather 700** (serif). Body: **Inter 400**.
- Google Fonts: `https://fonts.googleapis.com/css?family=Merriweather:700|Inter:400&display=swap`
- Scale (ratio 1.414): sm 0.707rem · base 1rem · xl 1.414rem · 2xl 1.999rem · 3xl 2.827rem · 4xl 3.997rem · 5xl 5.652rem
- Body 16px, line-height 1.5. Only two weights: 400 and 700.

## Shape, depth, motion

- Radius: cards `rounded-lg` (8px) for item cards, `rounded-2xl` (16px) for feature panels and QR panel, `rounded-xl` (12px) for big buttons, `rounded-full` for pill buttons and tags.
- Shadows: sm `0 4px 8px rgba(0,0,0,.2)` · md `0 10px 30px rgba(0,0,0,.2)` · lg `0 10px 30px rgba(0,0,0,.3)`
- Spacing: 5 / 8 / 10 / 15 / 30px
- Motion: hover scale 1.05 on cards (photo inside scales 1.05 too), tap 0.95, fade-in 0.4s with small staggered delays, transitions 0.3s ease.
- Signature details: the **shine sweep** on primary buttons (a blurred white diagonal gradient that slides across on hover), the **dot-matrix background** (primary-colored 1px dots on black, 10px grid, faded at the edges) behind hero sections, and a subtle film **grain** texture.

## Component mapping

| Maitso | Second Thought |
| --- | --- |
| Black hero with dot-matrix, Merriweather headline in primary, pill CTA with shine | Landing page: "Stop buying what you already own." + "Text the bot" pill + QR code |
| Rewards page: black split layout, white rounded-2xl QR panel | Landing / onboarding QR panel |
| MenuCard: rounded-lg, shadow-xl, 128px photo, Merriweather title, gray subtitle, primary pill tags with icons, price / calories footer | Closet item card: fit check photo, item name, color + season subtitle, pill tags (category, season, "returnable"), footer "6 wears · last worn Oct 2" |
| Rewards feature cards: bg-dim rounded-2xl, 64px primary-darker icon tile | Impact stats: purchases skipped, money back, items worn this week |
| Locations / CityCard | "Where's my stuff": storage locations with their items |
| Testimonial cards: primary gradient rounded-2xl | Recap card |
