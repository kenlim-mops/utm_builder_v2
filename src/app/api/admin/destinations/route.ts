import { getDb } from "@/db/client";
import { requireRole } from "@/services/auth";
import { listDestinationPolicies, upsertDestinationPolicy } from "@/services/destinations";
import { handle, json } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    await requireRole("admin", "investigator");
    const db = await getDb();
    return json({ policies: await listDestinationPolicies(db) });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const actor = await requireRole("admin");
    const db = await getDb();
    const { reason, ...input } = await req.json();
    return json({ policy: await upsertDestinationPolicy(db, actor, input, reason ?? null) });
  });
}
