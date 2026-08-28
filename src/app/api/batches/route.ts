import { getDb } from "@/db/client";
import { requireUser } from "@/services/auth";
import { createBatch } from "@/services/batches";
import { handle, json } from "@/server/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    const actor = await requireUser();
    const db = await getDb();
    const { rows, source } = await req.json();
    if (!Array.isArray(rows)) return json({ error: "rows must be an array" }, { status: 400 });
    const result = await createBatch(db, actor, rows, source ?? "grid");
    return json(result, { status: 201 });
  });
}
