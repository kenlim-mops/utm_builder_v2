import { desc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { outboxEvents } from "@/db/schema";
import { recordAudit } from "@/services/audit";
import { requireRole } from "@/services/auth";
import { buildIntegrationClients } from "@/services/integrations";
import { processOutbox, retryOutboxEvent } from "@/services/outbox";
import { handle, json } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    await requireRole("admin", "investigator");
    const db = await getDb();
    const events = await db
      .select()
      .from(outboxEvents)
      .orderBy(desc(outboxEvents.createdAt))
      .limit(200);
    return json({ events });
  });
}

/** Manual retry of one event, or process the due queue. */
export async function POST(req: Request) {
  return handle(async () => {
    const actor = await requireRole("admin");
    const db = await getDb();
    const { eventId, action } = await req.json();
    if (action === "retry" && eventId) {
      await retryOutboxEvent(db, eventId);
      await recordAudit(db, actor, {
        action: "outbox.retry_requested",
        entityType: "outbox_event",
        entityId: eventId,
      });
    }
    const result = await processOutbox(db, buildIntegrationClients(db));
    return json({ result });
  });
}
