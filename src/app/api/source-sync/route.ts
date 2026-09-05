import { getDb } from "@/db/client";
import { json } from "@/server/http";
import { safeEqual } from "@/core/tokens";
import { syncDueSourceConnectors } from "@/services/source-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function run(req: Request) {
  const auth = req.headers.get("authorization");
  const accepted = [process.env.SOURCE_SYNC_TOKEN, process.env.CRON_SECRET]
    .filter(Boolean)
    .map((token) => `Bearer ${token}`);
  if (accepted.length === 0 || !auth || !accepted.some((candidate) => safeEqual(auth, candidate))) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  return json({ result: await syncDueSourceConnectors(await getDb()) });
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
