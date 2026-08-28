import { getDb } from "@/db/client";
import { requireUser } from "@/services/auth";
import { previewLink } from "@/services/links";
import { handle, json } from "@/server/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    await requireUser();
    const db = await getDb();
    const input = await req.json();
    return json(await previewLink(db, input));
  });
}
