import { readFile } from "node:fs/promises";
import { SQL } from "bun";

// Minimal query interface so the closet code runs on Neon (via Bun's built-in
// Postgres client) in the app and on PGlite (in-process Postgres) in tests.
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

export function connect(url = process.env.DATABASE_URL): Db {
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = new SQL(url);
  return {
    query: async (text, params = []) => [...(await sql.unsafe(text, params))],
  };
}

const SCHEMA_PATH = new URL("./schema.sql", import.meta.url);

/** Creates the closet tables if they don't exist. */
export async function migrate(db: Db): Promise<void> {
  const schema = (await readFile(SCHEMA_PATH, "utf8")).replace(/^\s*--.*$/gm, "");
  for (const statement of schema.split(";")) {
    if (statement.trim()) await db.query(statement);
  }
}
