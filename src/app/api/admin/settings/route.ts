import { getDb } from "@/db/client";
import { requireRole } from "@/services/auth";
import { getConfig, updateSetting } from "@/services/config";
import { handle, json } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    await requireRole("admin", "investigator");
    const db = await getDb();
    return json({ config: await getConfig(db) });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const actor = await requireRole("admin");
    const db = await getDb();
    const { key, value, reason } = await req.json();
    if (!key) return json({ error: "key is required" }, { status: 400 });
    return json({ config: await updateSetting(db, actor, key, value, reason ?? null) });
  });
}
