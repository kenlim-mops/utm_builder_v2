import { getDb } from "@/db/client";
import { buildIntegrationClients } from "@/services/integrations";
import { processOutbox } from "@/services/outbox";
import { json } from "@/server/http";
import { safeEqual } from "@/core/tokens";

export const dynamic = "force-dynamic";

/**
 * Cron-triggered outbox worker (see vercel.json). Protected by a bearer token
 * so only the scheduler (or an operator with the secret) can trigger it.
 */
async function run(req: Request) {
  // Vercel cron sends GET with Authorization: Bearer $CRON_SECRET; manual
  // operators use OUTBOX_PROCESS_TOKEN. Either secret authorizes processing.
  const auth = req.headers.get("authorization");
  const accepted = [process.env.OUTBOX_PROCESS_TOKEN, process.env.CRON_SECRET]
    .filter(Boolean)
    .map((t) => `Bearer ${t}`);
  if (accepted.length === 0 || !auth || !accepted.some((candidate) => safeEqual(auth, candidate))) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = await getDb();
  const result = await processOutbox(db, buildIntegrationClients(db));
  return json({ result });
}

export async function POST(req: Request) {
  return run(req);
}

export async function GET(req: Request) {
  return run(req);
}
