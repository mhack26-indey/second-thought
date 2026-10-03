import { PGlite } from "@electric-sql/pglite";
import { migrate, type Db } from "./client.ts";

/** A fresh, migrated in-process Postgres for tests. */
export async function testDb(): Promise<Db> {
  const pg = new PGlite();
  const db: Db = {
    query: async <T>(text: string, params: unknown[] = []) =>
      (await pg.query<T>(text, params)).rows,
  };
  await migrate(db);
  return db;
}
