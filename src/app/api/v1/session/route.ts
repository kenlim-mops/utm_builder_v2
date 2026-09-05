import { capabilitiesFor, requireApiScope } from "@/services/auth";
import { apiJson, handlePublicApi, publicApiOptions } from "@/server/public-api";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: Request) {
  return publicApiOptions(req);
}

export async function GET(req: Request) {
  return handlePublicApi(req, async (requestId) => {
    const actor = await requireApiScope(req, "utm:read");
    return apiJson(req, { session: actor, capabilities: capabilitiesFor(actor), requestId });
  });
}
