import { SQL } from "bun";
import type { ExtractedItem } from "./closet/extract.ts";
import { type Item, activeItems, createOutfit, insertItem, setItemStatus } from "./closet/repo.ts";
import { PUBLIC_URL } from "./config.ts";
import { type Db, migrate } from "./db/client.ts";

// Everything lives in Neon Postgres. The closet tables (items, outfits, wears)
// belong to the closet module (db/schema.sql, closet/repo.ts); the bot's own
// tables are in schema.sql. Each message reads fresh rows, so the vision and
// matching code can write to the same tables.

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set. Run `vercel env pull` or add it to .env.");
export const sql = new SQL(url);

// One connection pool for both: the closet repo talks through this adapter.
export const db: Db = {
  query: async (text, params = []) => [...(await sql.unsafe(text, params as any[]))],
};

await migrate(db);
await sql.unsafe(await Bun.file(new URL("./schema.sql", import.meta.url)).text());

export type Step = "city" | "done";

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

export async function createUser(id: string): Promise<User> {
  const token = crypto.randomUUID().replaceAll("-", "");
  await sql`insert into users (id, web_token) values (${id}, ${token}) on conflict (id) do nothing`;
  return (await getUser(id))!;
}

type UserPatch = Partial<Pick<User, "step" | "name" | "city" | "fitCheckHour" | "lastFitPhoto">>;
const COLUMNS: Record<keyof UserPatch, string> = {
  step: "step",
  name: "name",
  city: "city",
  fitCheckHour: "fit_check_hour",
  lastFitPhoto: "last_fit_photo",
};

export async function updateUser(id: string, patch: UserPatch): Promise<void> {
  const row = Object.fromEntries(
    Object.entries(patch).map(([key, value]) => [COLUMNS[key as keyof UserPatch], value]),
  );
  if (Object.keys(row).length) await sql`update users set ${sql(row)} where id = ${id}`;
}

/** Users who finished onboarding and have the daily fit check on. */
export async function fitCheckUsers(): Promise<User[]> {
  const rows = await sql`select * from users where step = 'done' and fit_check_hour is not null`;
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

// ---- photos and outfits ----

/** Public, unguessable URL for a stored photo; the vision model can fetch it. */
export const photoUrl = (photoId: string) => `${PUBLIC_URL}/photos/${photoId}`;

async function addPhoto(userId: string, image: Buffer, mimeType: string): Promise<string> {
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

/** Saves a fit check photo as today's outfit. Item extraction hooks in here. */
export async function addFitCheck(userId: string, image: Buffer, mimeType: string): Promise<void> {
  const photoId = await addPhoto(userId, image, mimeType);
  await createOutfit(db, { user_id: userId, taken_on: localDate(), photo_url: photoUrl(photoId) });
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
  await sql`insert into reminders (user_id, text, due_at) values (${userId}, ${text}, ${new Date(at)})`;
}

/** Deletes an unsent reminder; false if it was already sent or cancelled. */
export async function cancelReminder(userId: string, id: string): Promise<boolean> {
  const rows = await sql`delete from reminders where id = ${id} and user_id = ${userId} and not sent returning id`;
  return rows.length > 0;
}

/** Atomically marks due reminders as sent and returns them for delivery. */
export async function claimDueReminders(): Promise<(Reminder & { userId: string })[]> {
  const rows = await sql`
    update reminders set sent = true
    where not sent and due_at <= now()
    returning id, user_id, text, due_at`;
  return rows.map((r: any) => ({ id: r.id, userId: r.user_id, text: r.text, at: r.due_at.getTime() }));
}

export async function releaseReminder(id: string): Promise<void> {
  await sql`update reminders set sent = false where id = ${id}`;
}
