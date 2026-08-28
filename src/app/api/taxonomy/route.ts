import { getDb } from "@/db/client";
import { requireUser } from "@/services/auth";
import { listTaxonomy } from "@/services/taxonomy";
import { handle, json } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    await requireUser();
    const db = await getDb();
    return json(await listTaxonomy(db));
  });
}
