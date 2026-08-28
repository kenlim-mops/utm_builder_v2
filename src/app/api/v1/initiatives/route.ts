import { initiativeInputSchema } from "@/contracts/public-api";
import { getDb } from "@/db/client";
import { apiJson, handlePublicApi, publicApiOptions } from "@/server/public-api";
import { requireApiScope } from "@/services/auth";
import { createInitiative, listInitiatives } from "@/services/initiatives";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: Request) { return publicApiOptions(req); }

export async function GET(req: Request) {
  return handlePublicApi(req, async (requestId) => {
    await requireApiScope(req, "utm:read");
    return apiJson(req, { initiatives: await listInitiatives(await getDb()), requestId });
  });
}

export async function POST(req: Request) {
  return handlePublicApi(req, async (requestId) => {
    const actor = await requireApiScope(req, "utm:initiatives:write");
    const initiative = await createInitiative(await getDb(), actor, initiativeInputSchema.parse(await req.json()));
    return apiJson(req, { initiative, requestId }, { status: 201 });
  });
}
