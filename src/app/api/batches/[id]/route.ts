import { getDb } from "@/db/client";
import { requireUser } from "@/services/auth";
import { batchDetail } from "@/services/batches";
import { handle, json } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireUser();
    const { id } = await params;
    const db = await getDb();
    const detail = await batchDetail(db, id);
    if (!detail) return json({ error: "Batch not found." }, { status: 404 });
    return json(detail);
  });
}
