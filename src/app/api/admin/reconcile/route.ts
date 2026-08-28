import { getDb } from "@/db/client";
import { recordAudit } from "@/services/audit";
import { requireRole } from "@/services/auth";
import { listReconciliationRuns, reconcile } from "@/services/reconciliation";
import { handle, json } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    await requireRole("admin", "investigator");
    const db = await getDb();
    return json({ runs: await listReconciliationRuns(db) });
  });
}

export async function POST() {
  return handle(async () => {
    const actor = await requireRole("admin");
    const db = await getDb();
    const { run, discrepancies } = await reconcile(db, actor.id);
    await recordAudit(db, actor, {
      action: "reconciliation.run",
      entityType: "reconciliation_run",
      entityId: run.id,
      context: { discrepancyCount: discrepancies.length },
    });
    return json({ run, discrepancies });
  });
}
