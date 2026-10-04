import type { Db } from "./db/client.ts";
import { addDays, isDate, today as localToday } from "./closet/dates.ts";
import { extractPhoto } from "./closet/extract.ts";
import type { ImageInput } from "./closet/vlm.ts";
import { visionMatcher } from "./ingest.ts";
import { matchSeenItems } from "./match.ts";
import { type PhotoDeps, readPhoto } from "./photo-intake.ts";
import type { Reply } from "./shopping-mode.ts";
import type { Climate } from "./climate.ts";
import { activeItems, recentWears } from "./closet/repo.ts";
import { declutterPicks, declutterReplies } from "./declutter.ts";
import { WINDOW_DAYS } from "./gaps.ts";
import { type Groups, exactGroups } from "./match.ts";
import { type Profile, buyAdvice, getProfile, saveProfile } from "./profile.ts";

// Demo data for one user (scripts/seed-demo.ts), built from real outfit
// photos the way a live fit check builds it: each photo goes through
// photo-intake.ts (extraction, then dedup against what's already in the
// closet), dated so the fit checks span the last three weeks. On top:
// - a green jacket from a Zara order 25 days ago, never worn and never
//   nudged, so "check returns" asks about it
// - a storage location on one real item (the red puffer if it's there)
// - one earlier skipped purchase on a real item, so "my impact" isn't zero
// Rerunning wipes that user's data first (and only theirs).

export const DEMO_DAYS = 21;

/** The demo user's profile (profile.ts): what "what should I buy?" and the links use. */
export const DEMO_PROFILE: Profile = {
  name: "Inesh",
  ageRange: "18-24",
  occasions: ["class", "gym", "going out"],
  sizeTop: "S",
  sizeBottom: "S",
  sizeShoe: null,
};

export interface DemoPhoto {
  file: string;
  takenOn: string; // YYYY-MM-DD, within the last DEMO_DAYS days
  shotOn: string | null; // the date in the filename, if any
}

// Pixel ("PXL_20260727_...") and WhatsApp ("IMG-20251214-WA...") names carry
// the day the photo was taken. Screenshots carry the day of the screenshot,
// not of the outfit, so they count as undated.
const DATE_IN_NAME = /^(?:PXL_|IMG-)(\d{4})(\d{2})(\d{2})/;

export function photoDate(file: string): string | null {
  const m = DATE_IN_NAME.exec(file);
  const date = m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  return isDate(date) ? date : null;
}

/**
 * Spreads the photos over the last `days` days, oldest first. Dated photos
 * keep their order, and photos from the same day stay on the same day;
 * undated ones are spaced evenly between them.
 */
export function scheduleDemoPhotos(files: string[], today: string, days = DEMO_DAYS): DemoPhoto[] {
  const dated = files
    .map((file) => ({ file, shotOn: photoDate(file) }))
    .filter((p): p is { file: string; shotOn: string } => p.shotOn !== null)
    .sort((a, b) => a.shotOn.localeCompare(b.shotOn) || a.file.localeCompare(b.file));
  const sameDay: { file: string; shotOn: string | null }[][] = [];
  for (const p of dated) {
    const last = sameDay.at(-1);
    if (last && last[0]!.shotOn === p.shotOn) last.push(p);
    else sameDay.push([p]);
  }
  const undated = files.filter((f) => !photoDate(f)).sort().map((file) => [{ file, shotOn: null }]);

  const total = sameDay.length + undated.length;
  const undatedAt = new Set(undated.map((_, k) => Math.floor(((k + 0.5) * total) / undated.length)));
  const slots: (typeof sameDay)[number][] = [];
  let d = 0;
  let u = 0;
  for (let i = 0; i < total; i++) slots.push(undatedAt.has(i) ? undated[u++]! : sameDay[d++]!);

  return slots.flatMap((group, i) => {
    const daysAgo = total === 1 ? 1 : Math.round(days - (i * (days - 1)) / (total - 1));
    return group.map((p) => ({ file: p.file, shotOn: p.shotOn, takenOn: addDays(today, -daysAgo) }));
  });
}

const JACKET = {
  category: "outerwear",
  type: "jacket",
  color_primary: "green",
  color_secondary: null,
  pattern: "solid",
  fit: "cropped",
  season: "all",
  description: "green cropped utility jacket",
} as const;
const JACKET_ORDER = { retailer: "Zara", price: 69.9, daysAgo: 25 }; // Zara: 30 days, so 5 left
const LOCATION = "under-bed bin";

export interface DemoOptions {
  userId: string;
  name?: string;
  city?: string;
  today?: string; // YYYY-MM-DD
  files: string[]; // photos to ingest, by filename
  /** Stores a photo (for the wardrobe page) and returns its URL and the image the vision model reads. */
  savePhoto: (file: string) => Promise<{ url: string; image: ImageInput }>;
  /** Loads an earlier photo by URL for the dedup comparison (default: fetch it). */
  loadPhoto?: (url: string) => Promise<ImageInput>;
  /** The vision steps; tests stub them. Default: the live ones. */
  extract?: PhotoDeps["extract"];
  matcher?: PhotoDeps["matcher"];
  onPhoto?: (photo: DemoPhoto, replies: Reply[], kind: string) => void;
}

export interface ClosetRow {
  description: string;
  category: string;
  wears: number;
  photos: string[]; // filenames, in fit check order
}

export interface DemoResult {
  webToken: string;
  photos: DemoPhoto[];
  closet: ClosetRow[];
  misread: { file: string; kind: string }[]; // photos the model didn't call a fit check
  stored: string | null; // the item given the storage location
  skipped: string | null; // the item the earlier skipped purchase points at
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
  const at = (date: string, time = "08:30:00") => new Date(`${date}T${time}`);

  await wipeUser(db, opts.userId);
  // Onboarded, with today's fit check ping already "sent" so none fires mid-demo.
  // An existing user keeps their wardrobe page token, so the link stays the same.
  const [user] = await db.query<{ web_token: string }>(
    `INSERT INTO users (id, web_token, step, name, city, fit_check_hour, last_fit_ping, last_fit_photo, city_options)
     VALUES ($1, $2, 'done', $3, $4, 9, $5, $6, NULL)
     ON CONFLICT (id) DO UPDATE SET step = 'done', name = $3, city = $4, fit_check_hour = 9,
       last_fit_ping = $5, last_fit_photo = $6, city_options = NULL
     RETURNING web_token`,
    [opts.userId, crypto.randomUUID().replaceAll("-", ""), opts.name ?? DEMO_PROFILE.name, opts.city ?? "Ann Arbor, Michigan", today, day(1)],
  );
  const { name: _, ...details } = DEMO_PROFILE;
  await saveProfile(db, opts.userId, details, { replaceOccasions: true });

  // Each photo as a live fit check, oldest first: saved, then read and
  // matched against the closet so far. These are known outfit photos, so a
  // model that calls one a product shot is noted, and it's ingested anyway.
  const photos = scheduleDemoPhotos(opts.files, today);
  const fileByUrl = new Map<string, string>();
  const misread: DemoResult["misread"] = [];
  const extract = opts.extract ?? extractPhoto;
  const matcher = opts.matcher ?? ((image: ImageInput) => visionMatcher(image, matchSeenItems, undefined, opts.loadPhoto));
  for (const photo of photos) {
    const { url, image } = await opts.savePhoto(photo.file);
    fileByUrl.set(url, photo.file);
    const created = at(photo.takenOn);
    const [outfit] = await db.query<{ id: number }>(
      `INSERT INTO outfits (user_id, photo_url, taken_on, created_at) VALUES ($1, $2, $3, $4) RETURNING id`,
      [opts.userId, url, photo.takenOn, created],
    );
    let kind = "fit_check";
    const replies = await readPhoto(
      opts.userId,
      { id: outfit!.id, photoUrl: url },
      image,
      { outfitId: outfit!.id, image, at: created.getTime(), cancelled: false },
      {
        db,
        extract: async (img) => {
          const read = await extract(img);
          kind = read.kind;
          return { ...read, kind: "fit_check" };
        },
        matcher,
        shop: async () => [],
      },
    );
    if (kind !== "fit_check") misread.push({ file: photo.file, kind });
    // Items first seen in this photo date from it ("since July").
    await db.query(`UPDATE items SET created_at = $3 WHERE user_id = $1 AND source = 'fit_check' AND photo_url = $2`, [
      opts.userId,
      url,
      created,
    ]);
    opts.onPhoto?.(photo, replies, kind);
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
  await db.query(
    `INSERT INTO items (user_id, category, type, color_primary, color_secondary, pattern, fit, season, description,
       source, purchase_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'order', $10, $11)`,
    [
      opts.userId,
      JACKET.category,
      JACKET.type,
      JACKET.color_primary,
      JACKET.color_secondary,
      JACKET.pattern,
      JACKET.fit,
      JACKET.season,
      JACKET.description,
      purchase.id,
      at(orderDate, "19:10:00"),
    ],
  );

  const closetRows = await db.query<{ id: number; description: string; category: string; color_primary: string; type: string; urls: string[] | null }>(
    `SELECT i.id, i.description, i.category, i.color_primary, i.type,
       array_agg(o.photo_url ORDER BY o.taken_on, o.id) FILTER (WHERE o.id IS NOT NULL) AS urls
     FROM items i LEFT JOIN wears w ON w.item_id = i.id LEFT JOIN outfits o ON o.id = w.outfit_id
     WHERE i.user_id = $1 AND i.status = 'active'
     GROUP BY i.id ORDER BY count(o.id) DESC, i.id`,
    [opts.userId],
  );
  const worn = closetRows.filter((r) => r.urls?.length);

  // Stored away: the red puffer if the closet has it, else the warmest-looking outerwear.
  const stored =
    worn.find((r) => r.category === "outerwear" && /red/.test(r.color_primary) && /puffer|jacket/.test(`${r.type} ${r.description}`)) ??
    worn.find((r) => r.category === "outerwear");
  if (stored) {
    await db.query(`UPDATE items SET location = $2, location_set_at = $3 WHERE id = $1`, [stored.id, LOCATION, at(day(12), "18:45:00")]);
  }

  // An earlier "do I have this?" that found their most-worn item.
  const favorite = worn[0];
  if (favorite) {
    await db.query(`INSERT INTO impact_events (user_id, kind, amount, item_id, created_at) VALUES ($1, 'avoided', NULL, $2, $3)`, [
      opts.userId,
      favorite.id,
      at(day(6), "16:20:00"),
    ]);
  }

  return {
    webToken: user!.web_token,
    photos,
    misread,
    stored: stored?.description ?? null,
    skipped: favorite?.description ?? null,
    closet: closetRows.map((r) => ({
      description: r.description,
      category: r.category,
      wears: r.urls?.length ?? 0,
      photos: (r.urls ?? []).map((u) => fileByUrl.get(u) ?? u),
    })),
  };
}

/**
 * What the bot would answer the demo user, computed the same way: "what
 * should I buy?" (buyAdvice, which "what should I buy for winter?" also
 * routes to) and "what should I get rid of?" (declutter.ts, with their sizes
 * in the links). The live bot groups colors with the text model; pass that
 * in as `groups` to match it exactly.
 */
export async function demoReplies(
  db: Db,
  userId: string,
  opts: { climate?: Climate; groups?: (wears: Awaited<ReturnType<typeof recentWears>>) => Promise<Groups>; today?: Date } = {},
): Promise<{ buy: string; declutter: Reply[] }> {
  const profile = (await getProfile(db, userId))!;
  const wears = await recentWears(db, userId, WINDOW_DAYS);
  const groups = opts.groups ? await opts.groups(wears) : exactGroups;
  const buy = buyAdvice(wears, await activeItems(db, userId), groups, profile, { climate: opts.climate, today: opts.today });
  const declutter = declutterReplies(await declutterPicks(db, userId, opts.climate, opts.today ?? new Date(), profile));
  return { buy, declutter };
}
