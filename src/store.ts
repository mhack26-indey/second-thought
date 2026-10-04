import { SQL } from "bun";
import type { ExtractedItem } from "./closet/extract.ts";
import {
  type Item,
  activeItems,
  createOutfit,
  insertItem,
  recentWears,
  setItemLocation,
  setItemStatus,
} from "./closet/repo.ts";
import { PUBLIC_URL } from "./config.ts";
import { type Db, migrate } from "./db/client.ts";
import { type AgeRange, type Occasion, deleteUserRows } from "./profile.ts";
import { type Impact, impactTotals } from "./impact.ts";

// Everything lives in Neon Postgres. The closet tables (items, outfits, wears)
// belong to the closet module (db/schema.sql, closet/repo.ts); the bot's own
// tables are in schema.sql. Each message reads fresh rows, so the vision and
// matching code can write to the same tables.

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set. Run `vercel env pull` or add it to .env.");
// No prepared statements: Neon's pooler keeps server connections (and their
// cached plans) across restarts, so after a migration adds a column, an old
// cached `select * from users` fails with "cached plan must not change result
// type" on every message.
export const sql = new SQL(url, { prepare: false });

// Without prepared statements, Bun sends a Date as its toString() ("Sat Oct 03
// 2026 19:40:00 GMT-0400"), which Postgres rejects. Send ISO strings instead.
const param = (v: unknown) => (v instanceof Date ? v.toISOString() : v);

// One connection pool for both: the closet repo talks through this adapter.
export const db: Db = {
  query: async (text, params = []) => [...(await sql.unsafe(text, params.map(param) as any[]))],
};

await migrate(db);
await sql.unsafe(await Bun.file(new URL("./schema.sql", import.meta.url)).text());

export type Step = "city" | "city_pick" | "profile" | "profile_again" | "done";

export type { Item } from "./closet/repo.ts";

export const DEFAULT_FIT_CHECK_HOUR = 9; // matches the column default in schema.sql

export interface User {
  id: string; // platform user id (phone number / email on iMessage)
  step: Step;
  name: string | null;
  city: string | null;
  webToken: string; // unguessable id for the wardrobe page URL
  fitCheckHour: number | null; // daily ping hour in server local time; null = off
  lastFitPing: string | null; // local date (YYYY-MM-DD) of the last ping
  lastFitPhoto: string | null; // local date of the last photo they sent
  cityOptions: string[] | null; // places to pick from while step is "city_pick"
  paused: boolean; // "stop": the bot starts nothing until they text again
  platform: string; // "imessage" | "telegram": where the bot's own messages go
  // Optional profile details (profile.ts); null when not given.
  ageRange: AgeRange | null;
  occasions: Occasion[] | null;
  sizeTop: string | null;
  sizeBottom: string | null;
  sizeShoe: string | null;
}

export interface Outfit {
  id: number;
  photoUrl: string | null;
  at: number; // when it was sent
}

export interface Reminder {
  id: string;
  at: number; // epoch ms
  text: string;
}

export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const toUser = (r: any): User => ({
  id: r.id,
  step: r.step,
  name: r.name,
  city: r.city,
  webToken: r.web_token,
  fitCheckHour: r.fit_check_hour,
  lastFitPing: r.last_fit_ping,
  lastFitPhoto: r.last_fit_photo,
  paused: r.paused ?? false,
  platform: r.platform ?? "imessage",
  cityOptions: r.city_options ? JSON.parse(r.city_options) : null,
  ageRange: r.age_range ?? null,
  occasions: r.occasions ?? null,
  sizeTop: r.size_top ?? null,
  sizeBottom: r.size_bottom ?? null,
  sizeShoe: r.size_shoe ?? null,
});

// ---- users ----

export async function getUser(id: string): Promise<User | undefined> {
  const [row] = await sql`select * from users where id = ${id}`;
  return row && toUser(row);
}

export async function getUserByToken(token: string): Promise<User | undefined> {
  const [row] = await sql`select * from users where web_token = ${token}`;
  return row && toUser(row);
}

export async function createUser(id: string, platform = "imessage"): Promise<User> {
  const token = crypto.randomUUID().replaceAll("-", "");
  await sql`insert into users (id, web_token, platform) values (${id}, ${token}, ${platform}) on conflict (id) do nothing`;
  return (await getUser(id))!;
}

type UserPatch = Partial<Pick<User, "step" | "name" | "city" | "fitCheckHour" | "lastFitPhoto" | "cityOptions">>;
const COLUMNS: Record<keyof UserPatch, string> = {
  cityOptions: "city_options",
  step: "step",
  name: "name",
  city: "city",
  fitCheckHour: "fit_check_hour",
  lastFitPhoto: "last_fit_photo",
};

export async function updateUser(id: string, patch: UserPatch): Promise<void> {
  const row = Object.fromEntries(
    Object.entries(patch).map(([key, value]) => [
      COLUMNS[key as keyof UserPatch],
      key === "cityOptions" && value ? JSON.stringify(value) : value,
    ]),
  );
  if (Object.keys(row).length) await sql`update users set ${sql(row)} where id = ${id}`;
}

/** Users who finished onboarding and have the daily fit check on. */
export async function fitCheckUsers(): Promise<User[]> {
  const rows = await sql`select * from users where step = 'done' and fit_check_hour is not null and not paused`;
  return rows.map(toUser);
}

/** Atomically claim today's ping, so two workers or a slow send can't double-fire. */
export async function claimFitPing(id: string, today: string): Promise<boolean> {
  const rows = await sql`
    update users set last_fit_ping = ${today}
    where id = ${id}
      and last_fit_ping is distinct from ${today}
      and last_fit_photo is distinct from ${today}
    returning id`;
  return rows.length > 0;
}

/** Users with a fit check in [from, to) who haven't had this month's recap; claims them. */
export async function claimRecaps(month: string, from: string, to: string): Promise<string[]> {
  const rows = await sql`
    update users u set last_recap = ${month}
    where u.step = 'done' and not u.paused and u.last_recap is distinct from ${month}
      and exists (select 1 from outfits o where o.user_id = u.id and o.taken_on >= ${from}::date and o.taken_on < ${to}::date)
    returning u.id`;
  return rows.map((r: any) => r.id);
}

/** Users not asked "what happened to this?" in the last week; claims today for them. */
export async function claimCheckinUsers(today: string): Promise<string[]> {
  const rows = await sql`
    update users set last_checkin_ask = ${today}::date
    where step = 'done' and city is not null and not paused
      and (last_checkin_ask is null or last_checkin_ask <= ${today}::date - 7)
    returning id`;
  return rows.map((r: any) => r.id);
}

/** "stop": hold everything the bot would start; any message they send turns it back on. */
/**
 * Moves everything from one account into another (linking iMessage and
 * Telegram): the closet, fit checks and photos, reminders, purchases, impact
 * and check-ins. The target keeps its id and platform, takes the source's
 * profile and wardrobe link, and the source account is removed. One
 * transaction: all of it moves or none of it does.
 */
export async function mergeUsers(fromId: string, toId: string): Promise<{ items: number; fitChecks: number }> {
  return sql.begin(async (tx) => {
    const [from] = await tx`select * from users where id = ${fromId} for update`;
    if (!from || fromId === toId) throw new Error("nothing to link");
    const [counts] = await tx`
      select (select coalesce(sum(quantity), 0)::int from items where user_id = ${fromId} and status = 'active') as items,
             (select count(*)::int from outfits where user_id = ${fromId}) as fit_checks`;
    for (const table of ["items", "outfits", "photos", "reminders", "purchases", "impact_events", "item_checkins"]) {
      await tx.unsafe(`update ${table} set user_id = $2 where user_id = $1`, [fromId, toId]);
    }
    // Dates go as YYYY-MM-DD strings: without prepared statements, Bun sends a
    // Date as its toString() ("… GMT-0400"), which Postgres rejects.
    const day = (d: unknown) => (d instanceof Date ? localDate(d) : (d as string | null));
    await tx`
      update users set step = 'done',
        name = coalesce(name, ${from.name}), city = coalesce(city, ${from.city}),
        fit_check_hour = ${from.fit_check_hour}, last_fit_photo = ${day(from.last_fit_photo)},
        last_recap = ${from.last_recap}, last_checkin_ask = ${day(from.last_checkin_ask)}::date, city_options = null
      where id = ${toId}`;
    // The wardrobe link moves too: free it from the old account first (it's unique).
    await tx`delete from users where id = ${fromId}`;
    await tx`update users set web_token = ${from.web_token} where id = ${toId}`;
    return { items: counts.items, fitChecks: counts.fit_checks };
  });
}

export async function setPlatform(id: string, platform: string): Promise<void> {
  await sql`update users set platform = ${platform} where id = ${id}`;
}

export async function setPaused(id: string, paused: boolean): Promise<void> {
  await sql`update users set paused = ${paused} where id = ${id}`;
}

/**
 * "delete my data": everything the bot keeps about them, the user row last,
 * so their next text starts over as a new user. Wears go with items and
 * outfits; photos, reminders, purchases, impact and check-ins with the user.
 */
export async function deleteUserData(id: string): Promise<void> {
  await sql.begin(async (tx) => {
    await deleteUserRows({ query: async (text, params = []) => [...(await tx.unsafe(text, params as any[]))] }, id);
  });
}

export async function releaseRecap(id: string): Promise<void> {
  await sql`update users set last_recap = null where id = ${id}`;
}

export async function releaseFitPing(id: string): Promise<void> {
  await sql`update users set last_fit_ping = null where id = ${id}`;
}

// ---- items (closet module tables) ----

export async function listItems(userId: string): Promise<Item[]> {
  return activeItems(db, userId);
}

/** Items described in a text, so there's no photo. */
export async function addTextItems(userId: string, items: ExtractedItem[]): Promise<void> {
  for (const item of items) await insertItem(db, { ...item, user_id: userId, source: "text" });
}

export async function removeItem(userId: string, itemId: number): Promise<void> {
  await setItemStatus(db, userId, itemId, "removed");
}

export async function setLocation(userId: string, itemId: number, location: string): Promise<void> {
  await setItemLocation(db, userId, itemId, location);
}

/** Items worn in fit checks from the last `days` days, one row per wear. */
export async function wornLately(userId: string, days: number) {
  return recentWears(db, userId, days);
}

export async function impactFor(userId: string): Promise<Impact> {
  return impactTotals(db, userId);
}

// ---- photos and outfits ----

/** Public, unguessable URL for a stored photo; the vision model can fetch it. */
export const photoUrl = (photoId: string) => `${PUBLIC_URL}/photos/${photoId}`;

export async function addPhoto(userId: string, image: Buffer, mimeType: string): Promise<string> {
  const [row] = await sql`
    insert into photos (user_id, image, mime_type) values (${userId}, ${image}, ${mimeType}) returning id`;
  return row.id;
}

export async function getPhoto(id: string): Promise<{ image: Uint8Array; mimeType: string } | undefined> {
  // Reject non-UUIDs up front; Postgres would throw on the cast.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const [row] = await sql`select image, mime_type from photos where id = ${id}`;
  return row && { image: row.image, mimeType: row.mime_type };
}

const photoIdOf = (url: string) => url.slice(url.lastIndexOf("/") + 1);

/** A stored photo by the URL photoUrl() gave it. */
export async function photoAt(url: string): Promise<{ image: Uint8Array; mimeType: string } | undefined> {
  return getPhoto(photoIdOf(url));
}

export async function deletePhoto(userId: string, url: string): Promise<void> {
  const id = photoIdOf(url);
  if (/^[0-9a-f-]{36}$/i.test(id)) await sql`delete from photos where id = ${id} and user_id = ${userId}`;
}

/** Saves a fit check photo as today's outfit. */
export async function addFitCheck(
  userId: string,
  image: Buffer,
  mimeType: string,
): Promise<{ id: number; photoUrl: string }> {
  const url = photoUrl(await addPhoto(userId, image, mimeType));
  const outfit = await createOutfit(db, { user_id: userId, taken_on: localDate(), photo_url: url });
  return { id: outfit.id, photoUrl: url };
}

// ---- fixing a fit check by hand (wardrobe page) ----

export async function getOutfit(userId: string, outfitId: number): Promise<Outfit | undefined> {
  const [r] = await sql`select id, photo_url, created_at from outfits where id = ${outfitId} and user_id = ${userId}`;
  return r && { id: r.id, photoUrl: r.photo_url, at: r.created_at.getTime() };
}

/** Their most recent fit check and the items read from it, for corrections by text. */
export async function latestFitCheck(userId: string): Promise<{ outfit: Outfit; items: Item[] } | undefined> {
  const [o] = await sql`
    select id, photo_url, created_at from outfits where user_id = ${userId}
    order by created_at desc, id desc limit 1`;
  if (!o) return undefined;
  const items = await db.query<Item>(
    `SELECT i.* FROM items i JOIN wears w ON w.item_id = i.id
     WHERE w.outfit_id = $1 AND i.user_id = $2 AND i.status = 'active' ORDER BY i.id`,
    [o.id, userId],
  );
  return { outfit: { id: o.id, photoUrl: o.photo_url, at: o.created_at.getTime() }, items };
}

/** The most recent fit check an item was worn in, if any. */
export async function lastWorn(userId: string, itemId: number): Promise<{ on: Date; outfitId: number } | undefined> {
  const [r] = await sql`
    select o.id, o.taken_on from wears w join outfits o on o.id = w.outfit_id
    where w.item_id = ${itemId} and o.user_id = ${userId}
    order by o.taken_on desc, o.id desc limit 1`;
  if (!r) return undefined;
  // taken_on is a calendar date (midnight UTC from the driver): keep the day, not the instant.
  const [y, m, d] = (r.taken_on instanceof Date ? r.taken_on.toISOString() : String(r.taken_on)).slice(0, 10).split("-").map(Number);
  return { on: new Date(y!, m! - 1, d!), outfitId: r.id };
}

/** Which items were worn in which fit check: one row per wear. */
export async function listWears(userId: string): Promise<{ outfitId: number; itemId: number }[]> {
  const rows = await sql`
    select w.outfit_id, w.item_id from wears w join outfits o on o.id = w.outfit_id
    where o.user_id = ${userId}`;
  return rows.map((r: any) => ({ outfitId: r.outfit_id, itemId: r.item_id }));
}

/** Newest first. */
export async function listOutfits(userId: string): Promise<Outfit[]> {
  const rows = await sql`
    select id, photo_url, created_at from outfits where user_id = ${userId} order by created_at desc`;
  return rows.map((r: any) => ({ id: r.id, photoUrl: r.photo_url, at: r.created_at.getTime() }));
}

// ---- reminders ----

/** Unsent reminders, soonest first. Their 1-based position is what users refer to. */
export async function pendingReminders(userId: string): Promise<Reminder[]> {
  const rows = await sql`
    select id, text, due_at from reminders
    where user_id = ${userId} and not sent order by due_at`;
  return rows.map((r: any) => ({ id: r.id, text: r.text, at: r.due_at.getTime() }));
}

export async function addReminder(userId: string, at: number, text: string): Promise<void> {
  await sql`insert into reminders (user_id, text, due_at) values (${userId}, ${text}, ${new Date(at).toISOString()})`;
}

/** Deletes an unsent reminder; false if it was already sent or cancelled. */
export async function cancelReminder(userId: string, id: string): Promise<boolean> {
  const rows = await sql`delete from reminders where id = ${id} and user_id = ${userId} and not sent returning id`;
  return rows.length > 0;
}

/** Atomically marks due reminders as sent and returns them for delivery. */
export async function claimDueReminders(): Promise<(Reminder & { userId: string })[]> {
  const rows = await sql`
    update reminders r set sent = true
    where not r.sent and r.due_at <= now()
      and not exists (select 1 from users u where u.id = r.user_id and u.paused) -- held until they're back
    returning r.id, r.user_id, r.text, r.due_at`;
  return rows.map((r: any) => ({ id: r.id, userId: r.user_id, text: r.text, at: r.due_at.getTime() }));
}

export async function releaseReminder(id: string): Promise<void> {
  await sql`update reminders set sent = false where id = ${id}`;
}
