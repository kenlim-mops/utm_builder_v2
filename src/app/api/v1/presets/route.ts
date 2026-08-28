import { getDb } from "@/db/client";
import { apiJson, handlePublicApi, publicApiOptions } from "@/server/public-api";
import { requireApiScope } from "@/services/auth";
import { listPresets } from "@/services/presets";

export const dynamic = "force-dynamic";
export async function OPTIONS(req: Request) { return publicApiOptions(req); }
export async function GET(req: Request) {
  return handlePublicApi(req, async (requestId) => {
    await requireApiScope(req, "utm:read");
    return apiJson(req, { presets: await listPresets(await getDb()), requestId });
  });
}
