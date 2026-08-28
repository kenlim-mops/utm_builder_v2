import { getDb } from "@/db/client";
import { requireUser } from "@/services/auth";
import { listPresets } from "@/services/presets";
import { handle, json } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    await requireUser();
    const db = await getDb();
    return json({ presets: await listPresets(db) });
  });
}
