import { tokenCreateSchema } from "@/contracts/public-api";
import { getDb } from "@/db/client";
import { apiJson, handlePublicApi } from "@/server/public-api";
import { requireUser } from "@/services/auth";
import {
  createPersonalAccessToken,
  listPersonalAccessTokens,
  revokePersonalAccessToken,
} from "@/services/access-tokens";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handlePublicApi(req, async (requestId) => {
    const actor = await requireUser();
    return apiJson(req, { tokens: await listPersonalAccessTokens(await getDb(), actor), requestId });
  });
}

export async function POST(req: Request) {
  return handlePublicApi(req, async (requestId) => {
    const actor = await requireUser();
    const result = await createPersonalAccessToken(await getDb(), actor, tokenCreateSchema.parse(await req.json()));
    return apiJson(req, { ...result, requestId }, { status: 201 });
  });
}

export async function DELETE(req: Request) {
  return handlePublicApi(req, async (requestId) => {
    const actor = await requireUser();
    const tokenId = new URL(req.url).searchParams.get("id");
    if (!tokenId) throw new Error("Token id is required.");
    await revokePersonalAccessToken(await getDb(), actor, tokenId);
    return apiJson(req, { ok: true, requestId });
  });
}
