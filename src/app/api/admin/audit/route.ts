import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { toCsv } from "@/core/csv";
import { getDb } from "@/db/client";
import { auditEvents } from "@/db/schema";
import { requireRole } from "@/services/auth";
import { handle, json } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    await requireRole("admin", "investigator");
    const db = await getDb();
    const url = new URL(req.url);
    const q = url.searchParams.get("q");
    const action = url.searchParams.get("action");
    const entityType = url.searchParams.get("entityType");
    const entityId = url.searchParams.get("entityId");
    const actor = url.searchParams.get("actor");
    const after = url.searchParams.get("after");
    const before = url.searchParams.get("before");
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const pageSize = Math.min(200, Number(url.searchParams.get("pageSize") ?? 50));

    const conditions: SQL[] = [];
    if (q) conditions.push(or(ilike(auditEvents.action, `%${q}%`), ilike(auditEvents.entityId, `%${q}%`))!);
    if (action) conditions.push(eq(auditEvents.action, action));
    if (entityType) conditions.push(eq(auditEvents.entityType, entityType));
    if (entityId) conditions.push(eq(auditEvents.entityId, entityId));
    if (actor) conditions.push(or(eq(auditEvents.actorId, actor), ilike(auditEvents.actorEmail, `%${actor}%`))!);
    if (after) conditions.push(sql`${auditEvents.ts} >= ${new Date(after)}`);
    if (before) conditions.push(sql`${auditEvents.ts} <= ${new Date(before)}`);
    const where = conditions.length ? and(...conditions) : undefined;

    const events = await db
      .select()
      .from(auditEvents)
      .where(where)
      .orderBy(desc(auditEvents.ts))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    if (url.searchParams.get("format") === "csv") {
      const csv = toCsv([
        ["id", "ts", "actor", "action", "entity_type", "entity_id", "reason", "config_version"],
        ...events.map((e) => [
          e.id,
          e.ts.toISOString(),
          e.actorEmail,
          e.action,
          e.entityType,
          e.entityId,
          e.reason,
          e.configVersion === null ? "" : String(e.configVersion),
        ]),
      ]);
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="audit-events.csv"',
        },
      }) as never;
    }

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditEvents)
      .where(where);
    return json({ events, total: count, page, pageSize });
  });
}
