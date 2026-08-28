/** Process due outbox events once (for local dev / manual runs). */
import { getDb } from "@/db/client";
import { buildIntegrationClients } from "./integrations";
import { processOutbox } from "./outbox";

getDb()
  .then(async (db) => {
    const result = await processOutbox(db, buildIntegrationClients(db));
    console.log(JSON.stringify(result));
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
