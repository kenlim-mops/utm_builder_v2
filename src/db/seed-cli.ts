/** Apply the idempotent seed to the configured database. */
import { getDb } from "./client";
import { ensureSeed } from "./seed";

getDb()
  .then(async (db) => {
    await ensureSeed(db);
    console.log("Seed ensured.");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
