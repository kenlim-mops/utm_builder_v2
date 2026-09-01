import { getDb } from "@/db/client";
import { requireRole } from "@/services/auth";
import {
  decideSourceUpdate,
  generateBulkTemplate,
  listBulkTemplates,
  listSourceConnectors,
  listSourceSyncRuns,
  listSourceUpdates,
  searchCatalog,
  upsertBulkTemplate,
  upsertCatalogRecord,
  upsertRelationship,
  upsertSourceConnector,
} from "@/services/gtm-data";
import { syncSourceConnector } from "@/services/source-sync";
import { handle, json } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const actor = await requireRole("admin", "investigator");
    const db = await getDb();
    const templateKey = new URL(req.url).searchParams.get("templateKey");
    if (templateKey) return json(await generateBulkTemplate(db, templateKey));
    const [records, templates, connectors, updates, syncRuns] = await Promise.all([
      searchCatalog(db, { limit: 200 }, actor),
      listBulkTemplates(db),
      listSourceConnectors(db),
      listSourceUpdates(db, { limit: 200 }),
      listSourceSyncRuns(db, undefined, 100),
    ]);
    return json({ records, templates, connectors, updates, syncRuns });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const actor = await requireRole("admin");
    const db = await getDb();
    const body = await req.json() as Record<string, unknown>;
    const action = String(body.action ?? "");
    switch (action) {
      case "upsert_record":
        return json({ record: await upsertCatalogRecord(db, actor, body.record as Parameters<typeof upsertCatalogRecord>[2], String(body.reason ?? "") || null) });
      case "upsert_relationship":
        return json({ relationship: await upsertRelationship(db, actor, body.relationship as Parameters<typeof upsertRelationship>[2], String(body.reason ?? "") || null) });
      case "upsert_template":
        return json({ template: await upsertBulkTemplate(db, actor, body.template as Parameters<typeof upsertBulkTemplate>[2], String(body.reason ?? "") || null) });
      case "upsert_connector":
        return json({ connector: await upsertSourceConnector(db, actor, body.connector as Parameters<typeof upsertSourceConnector>[2], String(body.reason ?? "") || null) });
      case "run_connector":
        return json({ result: await syncSourceConnector(db, String(body.connectorId ?? ""), "manual") });
      case "decide_update":
        return json(await decideSourceUpdate(db, actor, String(body.proposalId ?? ""), body.decision === "reject" ? "reject" : "approve", String(body.reason ?? "")));
      default:
        throw new Error("Unsupported GTM data admin action.");
    }
  });
}
