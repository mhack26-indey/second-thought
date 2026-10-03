// Creates all tables on the database in DATABASE_URL: the closet tables
// (src/db/schema.sql) and the bot's tables (src/schema.sql).
// Usage: bun run migrate. The bot also does this on startup.

const { sql } = await import("../src/store.ts"); // migrates on import
await sql.close();
console.log("Tables are up to date.");
process.exit(0);
