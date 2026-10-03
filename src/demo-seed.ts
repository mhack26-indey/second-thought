import type { Db } from "./db/client.ts";
import { addDays, today as localToday } from "./closet/dates.ts";
import type { ExtractedItem } from "./closet/extract.ts";

// Demo data for one user (scripts/seed-demo.ts): three weeks of dated fit
// checks, inserted directly so no vision calls are needed. Every demo beat
// has something to find:
// - black straight-leg jeans in half the fit checks: "do I have this?" with a
//   photo of black jeans matches them
// - a green jacket from a Zara order 25 days ago, never worn and never
//   nudged: "check returns" asks about it, and the window is still open
// - 5 bottoms worn with 2 tops: "what should I buy?" names a top
// - a winter coat in the under-bed bin: "where's my winter coat?"
// - one earlier skipped purchase, so "my impact" isn't zero
// Rerunning wipes that user's data first (and only theirs).

type Seeded = Omit<ExtractedItem, "color_secondary"> & { color_secondary?: string | null };

const item = (category: ExtractedItem["category"], type: ExtractedItem["type"], color: string, fit: string, season: ExtractedItem["season"], description: string): Seeded => ({
  category,
  type,
  color_primary: color,
  pattern: "solid",
  fit,
  season,
  description,
});

export const DEMO_ITEMS = {
  tee: item("top", "t-shirt", "white", "boxy", "all", "white boxy t-shirt"),
  crewneck: item("top", "crewneck", "black", "regular", "cold", "black crewneck sweatshirt"),
  jeans: item("bottom", "jeans", "black", "straight-leg", "all", "black straight-leg jeans"),
  wideJeans: item("bottom", "jeans", "light blue", "wide-leg", "all", "light blue wide-leg jeans"),
  cargo: item("bottom", "pants", "olive", "relaxed", "all", "olive cargo pants"),
  sweatpants: item("bottom", "sweatpants", "gray", "relaxed", "cold", "gray fleece sweatpants"),
  skirt: item("bottom", "skirt", "beige", "a-line", "warm", "beige pleated midi skirt"),
  sneakers: item("shoes", "sneakers", "white", "n/a", "all", "white leather sneakers"),
  boots: item("shoes", "boots", "black", "n/a", "cold", "black leather chelsea boots"),
  loafers: item("shoes", "loafers", "brown", "n/a", "all", "brown leather loafers"),
  bag: item("accessory", "bag", "black", "n/a", "all", "black leather shoulder bag"),
} satisfies Record<string, Seeded>;
type Key = keyof typeof DEMO_ITEMS;

/** Fit checks by days ago, with the photo each one expects in demo_images/ (see its README). */
export const DEMO_OUTFITS: { photo: string; daysAgo: number; wearing: Key[] }[] = [
  { photo: "fit-01", daysAgo: 20, wearing: ["tee", "jeans", "sneakers", "bag"] },
  { photo: "fit-02", daysAgo: 19, wearing: ["crewneck", "cargo", "boots"] },
  { photo: "fit-03", daysAgo: 17, wearing: ["tee", "jeans", "loafers"] },
  { photo: "fit-04", daysAgo: 16, wearing: ["crewneck", "sweatpants", "sneakers"] },
  { photo: "fit-05", daysAgo: 14, wearing: ["tee", "skirt", "sneakers", "bag"] },
  { photo: "fit-06", daysAgo: 13, wearing: ["crewneck", "jeans", "boots"] },
  { photo: "fit-07", daysAgo: 11, wearing: ["tee", "wideJeans", "sneakers"] },
  { photo: "fit-08", daysAgo: 9, wearing: ["crewneck", "jeans", "sneakers", "bag"] },
  { photo: "fit-09", daysAgo: 7, wearing: ["tee", "cargo", "loafers"] },
  { photo: "fit-10", daysAgo: 5, wearing: ["crewneck", "jeans", "boots"] },
  { photo: "fit-11", daysAgo: 3, wearing: ["tee", "wideJeans", "loafers", "bag"] },
  { photo: "fit-12", daysAgo: 1, wearing: ["crewneck", "jeans", "sneakers"] },
];

const JACKET = item("outerwear", "jacket", "green", "cropped", "all", "green cropped utility jacket");
const JACKET_ORDER = { retailer: "Zara", price: 69.9, daysAgo: 25 }; // Zara: 30 days, so 5 left
const COAT = item("outerwear", "coat", "camel", "long", "cold", "camel wool coat");
const COAT_LOCATION = "under-bed bin";

export interface DemoOptions {
  userId: string;
  name?: string;
  city?: string;
  today?: string; // YYYY-MM-DD
  /** Stores a demo_images/ photo and returns its URL; null if the file is missing. */
  savePhoto: (name: string) => Promise<string | null>;
}

export interface DemoResult {
  webToken: string;
  outfits: number;
  items: number;
  missingPhotos: string[];
}

/** Deletes everything the bot keeps for one user, except the user row itself. */
export async function wipeUser(db: Db, userId: string): Promise<void> {
  for (const table of ["impact_events", "purchases", "reminders", "photos", "items", "outfits"]) {
    await db.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]); // wears go with items and outfits
  }
}

export async function seedDemo(db: Db, opts: DemoOptions): Promise<DemoResult> {
  const today = opts.today ?? localToday();
  const day = (daysAgo: number) => addDays(today, -daysAgo);
  const at = (daysAgo: number, time = "08:30:00") => new Date(`${day(daysAgo)}T${time}`);

  await wipeUser(db, opts.userId);
  // Onboarded, with today's fit check ping already "sent" so none fires mid-demo.
  // An existing user keeps their wardrobe page token, so the link stays the same.
  const [user] = await db.query<{ web_token: string }>(
    `INSERT INTO users (id, web_token, step, name, city, fit_check_hour, last_fit_ping, last_fit_photo, city_options)
     VALUES ($1, $2, 'done', $3, $4, 9, $5, $6, NULL)
     ON CONFLICT (id) DO UPDATE SET step = 'done', name = $3, city = $4, fit_check_hour = 9,
       last_fit_ping = $5, last_fit_photo = $6, city_options = NULL
     RETURNING web_token`,
    [opts.userId, crypto.randomUUID().replaceAll("-", ""), opts.name ?? "Sam", opts.city ?? "Ann Arbor, Michigan", today, day(1)],
  );

  const insertItem = async (
    seeded: Seeded,
    fields: { source: string; photo_url?: string | null; created_at: Date; purchase_id?: string; location?: string; location_set_at?: Date },
  ) => {
    const [row] = await db.query<{ id: number }>(
      `INSERT INTO items (user_id, category, type, color_primary, color_secondary, pattern, fit, season, description,
         photo_url, source, purchase_id, location, location_set_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
      [
        opts.userId,
        seeded.category,
        seeded.type,
        seeded.color_primary,
        seeded.color_secondary ?? null,
        seeded.pattern,
        seeded.fit,
        seeded.season,
        seeded.description,
        fields.photo_url ?? null,
        fields.source,
        fields.purchase_id ?? null,
        fields.location ?? null,
        fields.location_set_at ?? null,
        fields.created_at,
      ],
    );
    return row!.id;
  };

  // Fit checks, oldest first. Each item is added the first time it's worn,
  // with that photo, the way a real fit check adds it.
  const ids = new Map<Key, number>();
  const missingPhotos: string[] = [];
  for (const outfit of [...DEMO_OUTFITS].sort((a, b) => b.daysAgo - a.daysAgo)) {
    const photoUrl = await opts.savePhoto(outfit.photo);
    if (!photoUrl) missingPhotos.push(outfit.photo);
    const [row] = await db.query<{ id: number }>(
      `INSERT INTO outfits (user_id, photo_url, taken_on, created_at) VALUES ($1, $2, $3, $4) RETURNING id`,
      [opts.userId, photoUrl, day(outfit.daysAgo), at(outfit.daysAgo)],
    );
    for (const key of outfit.wearing) {
      let id = ids.get(key);
      if (id === undefined) {
        id = await insertItem(DEMO_ITEMS[key], { source: "fit_check", photo_url: photoUrl, created_at: at(outfit.daysAgo) });
        ids.set(key, id);
      }
      await db.query(`INSERT INTO wears (item_id, outfit_id) VALUES ($1, $2)`, [id, row!.id]);
    }
  }

  // The unworn Zara jacket. nudged_at stays empty, so "check returns" asks about it.
  const orderDate = day(JACKET_ORDER.daysAgo);
  const [purchase] = await db.query<{ id: string }>(
    `INSERT INTO purchases (user_id, retailer, price, order_date, return_deadline, status)
     SELECT $1, retailer, $3, $4::date, $4::date + return_days, 'kept' FROM return_policies WHERE retailer = $2
     RETURNING id`,
    [opts.userId, JACKET_ORDER.retailer, JACKET_ORDER.price, orderDate],
  );
  if (!purchase) throw new Error(`No return policy for ${JACKET_ORDER.retailer}; run the bot or bun run migrate first.`);
  await insertItem(JACKET, { source: "order", purchase_id: purchase.id, created_at: at(JACKET_ORDER.daysAgo, "19:10:00") });

  // Texted in ("I have a camel wool coat"), then put away.
  await insertItem(COAT, {
    source: "text",
    created_at: at(18, "21:00:00"),
    location: COAT_LOCATION,
    location_set_at: at(12, "18:45:00"),
  });

  // An earlier "do I have this?" that found the black jeans.
  await db.query(
    `INSERT INTO impact_events (user_id, kind, amount, item_id, created_at) VALUES ($1, 'avoided', NULL, $2, $3)`,
    [opts.userId, ids.get("jeans"), at(6, "16:20:00")],
  );

  return { webToken: user!.web_token, outfits: DEMO_OUTFITS.length, items: ids.size + 2, missingPhotos };
}
