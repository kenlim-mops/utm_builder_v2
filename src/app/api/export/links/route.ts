import { getDb } from "@/db/client";
import { requireUser } from "@/services/auth";
import { recordAudit } from "@/services/audit";
import { exportLinksCsv } from "@/services/registry";
import { handle } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const actor = await requireUser();
    const db = await getDb();
    const url = new URL(req.url);
    const p = Object.fromEntries(url.searchParams.entries());
    const csv = await exportLinksCsv(db, { ...p, status: p.status as never });
    await recordAudit(db, actor, {
      action: "registry.exported",
      entityType: "export",
      entityId: "links",
      context: { filters: p },
    });
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="runpod-links.csv"',
      },
    }) as never;
  });
}
