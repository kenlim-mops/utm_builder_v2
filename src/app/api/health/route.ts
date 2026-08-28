import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, string> = { api: "ok" };
  let status = 200;
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    checks.database = "ok";
  } catch (err) {
    checks.database = err instanceof Error ? err.message : "failed";
    status = 503;
  }
  return json({ status: status === 200 ? "healthy" : "degraded", checks }, { status });
}
