import { getDb } from "@/db/client";
import { initiativeInputSchema } from "@/contracts/public-api";
import { requireUser } from "@/services/auth";
import { createInitiative, listInitiatives } from "@/services/initiatives";
import { handle, json } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    await requireUser();
    const db = await getDb();
    return json({ initiatives: await listInitiatives(db) });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const actor = await requireUser();
    const db = await getDb();
    const input = initiativeInputSchema.parse(await req.json());
    const initiative = await createInitiative(db, actor, input);
    return json({ initiative }, { status: 201 });
  });
}
