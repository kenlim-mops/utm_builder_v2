import { getDb } from "@/db/client";
import { appSettings, destinationPolicies, platformPresets, taxonomyMediums, taxonomySources } from "@/db/schema";
import { recordAudit } from "@/services/audit";
import { requireRole } from "@/services/auth";
import { handle, json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Configuration export for backup/recovery (admin only). */
export async function GET() {
  return handle(async () => {
    const actor = await requireRole("admin");
    const db = await getDb();
    const payload = {
      exportedAt: new Date().toISOString(),
      settings: await db.select().from(appSettings),
      taxonomyMediums: await db.select().from(taxonomyMediums),
      taxonomySources: await db.select().from(taxonomySources),
      destinationPolicies: await db.select().from(destinationPolicies),
      platformPresets: await db.select().from(platformPresets),
    };
    await recordAudit(db, actor, {
      action: "config.exported",
      entityType: "export",
      entityId: "configuration",
    });
    return json(payload);
  });
}
