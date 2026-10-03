import { SQL } from "bun";
import type { Category } from "./categories.ts";

// Everything lives in Neon Postgres (schema in schema.sql). Each message reads
// fresh rows, so other services (vision, matching) can write to the same tables.

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set. Add your Neon connection string to .env.");
export const sql = new SQL(url);

await sql.unsafe(await Bun.file(new URL("./schema.sql", import.meta.url)).text());

export type Step = "city" | "done";

export { CATEGORIES, type Category } from "./categories.ts";

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

export interface Item {
  id: string;
  name: string;
  category: Category;
  addedAt: number;
}

export interface Outfit {
  id: string;
  mimeType: string;
  at: number;
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

// ---- items ----

export async function listItems(userId: string): Promise<Item[]> {
  const rows = await sql`
    select id, name, category, added_at from items
    where user_id = ${userId} and status = 'owned' order by added_at`;
  return rows.map((r: any) => ({ id: r.id, name: r.name, category: r.category, addedAt: r.added_at.getTime() }));
}

export async function addItems(userId: string, items: { name: string; category: Category }[]): Promise<void> {
  if (!items.length) return;
  await sql`insert into items ${sql(items.map((i) => ({ user_id: userId, name: i.name, category: i.category })))}`;
}

export async function removeItem(userId: string, itemId: string): Promise<void> {
  await sql`delete from items where id = ${itemId} and user_id = ${userId}`;
}

// ---- outfits (fit check photos) ----

export async function addOutfit(userId: string, image: Buffer, mimeType: string): Promise<void> {
  await sql`insert into outfits (user_id, image, mime_type) values (${userId}, ${image}, ${mimeType})`;
}

/** Newest first, without the image bytes. */
export async function listOutfits(userId: string): Promise<Outfit[]> {
  const rows = await sql`
    select id, mime_type, worn_at from outfits where user_id = ${userId} order by worn_at desc`;
  return rows.map((r: any) => ({ id: r.id, mimeType: r.mime_type, at: r.worn_at.getTime() }));
}

export async function getOutfitImage(userId: string, id: string): Promise<{ image: Uint8Array; mimeType: string } | undefined> {
  // Reject non-UUIDs up front; Postgres would throw on the cast.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const [row] = await sql`select image, mime_type from outfits where id = ${id} and user_id = ${userId}`;
  return row && { image: row.image, mimeType: row.mime_type };
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
