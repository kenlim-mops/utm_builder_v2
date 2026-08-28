import { batchRequestSchema } from "@/contracts/public-api";
import { getDb } from "@/db/client";
import { apiJson, handlePublicApi, publicApiOptions } from "@/server/public-api";
import { requireApiScope } from "@/services/auth";
import { createBatch } from "@/services/batches";

export const dynamic = "force-dynamic";
export async function OPTIONS(req: Request) { return publicApiOptions(req); }
export async function POST(req: Request) {
  return handlePublicApi(req, async (requestId) => {
    const actor = await requireApiScope(req, "utm:issue");
    const input = batchRequestSchema.parse(await req.json());
    return apiJson(req, { ...(await createBatch(await getDb(), actor, input.rows, input.source)), requestId }, { status: 201 });
  });
}
