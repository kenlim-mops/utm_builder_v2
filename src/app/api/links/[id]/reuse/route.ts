import { getDb } from "@/db/client";
import { requireUser } from "@/services/auth";
import { recordReuse } from "@/services/links";
import { handle, json } from "@/server/http";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireUser();
    const { id } = await params;
    const db = await getDb();
    await recordReuse(db, actor, id);
    return json({ ok: true });
  });
}
