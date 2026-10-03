// Creates the closet tables on the database in DATABASE_URL.
// Usage: bun run migrate

import { connect, migrate } from "../src/db/client.ts";

await migrate(connect());
console.log("Closet tables are up to date.");
process.exit(0);
