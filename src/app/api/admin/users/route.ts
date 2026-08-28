import { getDb } from "@/db/client";
import { requireRole } from "@/services/auth";
import { listUsers, upsertUser } from "@/services/users";
import { handle, json } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    await requireRole("admin");
    const db = await getDb();
    return json({ users: await listUsers(db) });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const actor = await requireRole("admin");
    const db = await getDb();
    const { reason, ...input } = await req.json();
    return json({ user: await upsertUser(db, actor, input, reason ?? null) });
  });
}
