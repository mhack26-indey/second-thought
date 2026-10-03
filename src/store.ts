import { mkdir } from "node:fs/promises";

// Tiny JSON-file store so onboarding state and reminders survive restarts.
// Swap for Neon once the schema from PLAN.md lands.

export type Step = "city" | "done";

export interface Reminder {
  id: string;
  at: number; // epoch ms
  text: string;
  sent: boolean;
}

export const CATEGORIES = ["tops", "bottoms", "outerwear", "shoes", "dresses", "accessories", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Item {
  id: string;
  name: string;
  category: Category;
  addedAt: number;
}

export interface Photo {
  id: string;
  file: string; // file name inside PHOTO_DIR
  mimeType: string;
  at: number;
}

export interface User {
  id: string; // platform user id (phone number / email on iMessage)
  step: Step;
  name?: string;
  city?: string;
  createdAt: number;
  reminders: Reminder[];
  items: Item[];
  photos: Photo[];
  webToken: string; // unguessable id for the wardrobe page URL
  // Daily fit-check ping. Hour is in the server's local time; null = opted out.
  // Undefined (older saved users) means the default hour.
  fitCheckHour?: number | null;
  lastFitPing?: string; // local date (YYYY-MM-DD) of the last ping
  lastFitPhoto?: string; // local date of the last photo they sent
}

export const DEFAULT_FIT_CHECK_HOUR = 9;

export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DIR = "data";
const FILE = `${DIR}/users.json`;
export const PHOTO_DIR = `${DIR}/photos`;

const users = new Map<string, User>();
const byToken = new Map<string, User>();

function newToken(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

function index(user: User) {
  users.set(user.id, user);
  byToken.set(user.webToken, user);
}

const existing = Bun.file(FILE);
if (await existing.exists()) {
  const saved = (await existing.json()) as Record<string, Partial<User> & { id: string }>;
  for (const raw of Object.values(saved)) {
    // Fill fields added after a user was first saved.
    index({ items: [], photos: [], reminders: [], webToken: newToken(), ...raw } as User);
  }
}

export function getUser(id: string): User | undefined {
  return users.get(id);
}

export function getUserByToken(token: string): User | undefined {
  return byToken.get(token);
}

export function createUser(id: string): User {
  const user: User = {
    id,
    step: "city",
    createdAt: Date.now(),
    reminders: [],
    items: [],
    photos: [],
    webToken: newToken(),
  };
  index(user);
  return user;
}

export function allUsers(): User[] {
  return [...users.values()];
}

/** Unsent reminders, soonest first. Their 1-based position is what users refer to. */
export function pendingReminders(user: User): Reminder[] {
  return user.reminders.filter((r) => !r.sent).sort((a, b) => a.at - b.at);
}

export async function save(): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await Bun.write(FILE, JSON.stringify(Object.fromEntries(users), null, 2));
}
