import { campaignInputSchema } from "@/contracts/public-api";
import { getDb } from "@/db/client";
import { apiJson, handlePublicApi, publicApiOptions } from "@/server/public-api";
import { requireApiScope } from "@/services/auth";
import { createCampaign, listCampaigns } from "@/services/campaigns";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: Request) { return publicApiOptions(req); }

export async function GET(req: Request) {
  return handlePublicApi(req, async (requestId) => {
    await requireApiScope(req, "utm:read");
    return apiJson(req, { campaigns: await listCampaigns(await getDb()), requestId });
  });
}

export async function POST(req: Request) {
  return handlePublicApi(req, async (requestId) => {
    const actor = await requireApiScope(req, "utm:campaigns:write");
    const campaign = await createCampaign(await getDb(), actor, campaignInputSchema.parse(await req.json()));
    return apiJson(req, { campaign, requestId }, { status: 201 });
  });
}
