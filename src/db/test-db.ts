import { PGlite } from "@electric-sql/pglite";
import { migrate, type Db } from "./client.ts";

/** A fresh, migrated in-process Postgres for tests: closet and bot tables. */
export async function testDb(): Promise<Db> {
  const pg = new PGlite();
  const db: Db = {
    query: async <T>(text: string, params: unknown[] = []) =>
      (await pg.query<T>(text, params)).rows,
  };
  await migrate(db);
  // The bot tables run whole, as store.ts runs them (inline comments hold semicolons).
  await pg.exec(await Bun.file(new URL("../schema.sql", import.meta.url)).text());
  return db;
}
