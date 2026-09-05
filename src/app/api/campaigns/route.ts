import { campaignInputSchema } from "@/contracts/public-api";
import { getDb } from "@/db/client";
import { requireUser } from "@/services/auth";
import { createCampaign, listCampaigns } from "@/services/campaigns";
import { handle, json } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    await requireUser();
    const db = await getDb();
    return json({ campaigns: await listCampaigns(db) });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const actor = await requireUser();
    const db = await getDb();
    const input = campaignInputSchema.parse(await req.json());
    const campaign = await createCampaign(db, actor, input);
    return json({ campaign }, { status: 201 });
  });
}
