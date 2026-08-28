/** Run migrations (and seed if the database is empty). */
import { getDb } from "./client";

getDb()
  .then(() => {
    console.log("Migrations applied.");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
