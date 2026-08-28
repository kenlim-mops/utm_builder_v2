import { getDb } from "@/db/client";
import { requireUser } from "@/services/auth";
import { initiativeDetail, updateInitiative } from "@/services/initiatives";
import { handle, json } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireUser();
    const { id } = await params;
    const db = await getDb();
    const detail = await initiativeDetail(db, id);
    if (!detail) return json({ error: "Initiative not found." }, { status: 404 });
    return json(detail);
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireUser();
    const { id } = await params;
    const db = await getDb();
    const { reason, ...patch } = await req.json();
    const initiative = await updateInitiative(db, actor, id, patch, reason ?? null);
    return json({ initiative });
  });
}
