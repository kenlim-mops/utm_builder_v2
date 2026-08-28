import { getDb } from "@/db/client";
import { requireRole } from "@/services/auth";
import { upsertMedium, upsertSource } from "@/services/taxonomy";
import { handle, json } from "@/server/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    const actor = await requireRole("admin");
    const db = await getDb();
    const { kind, reason, ...input } = await req.json();
    if (kind === "medium") return json({ medium: await upsertMedium(db, actor, input, reason ?? null) });
    if (kind === "source") return json({ source: await upsertSource(db, actor, input, reason ?? null) });
    return json({ error: 'kind must be "medium" or "source"' }, { status: 400 });
  });
}
