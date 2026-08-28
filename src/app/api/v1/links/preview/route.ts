import { linkRequestSchema } from "@/contracts/public-api";
import { getDb } from "@/db/client";
import { apiJson, handlePublicApi, publicApiOptions } from "@/server/public-api";
import { requireApiScope } from "@/services/auth";
import { previewLink } from "@/services/links";

export const dynamic = "force-dynamic";
export async function OPTIONS(req: Request) { return publicApiOptions(req); }
export async function POST(req: Request) {
  return handlePublicApi(req, async (requestId) => {
    await requireApiScope(req, "utm:preview");
    const input = linkRequestSchema.parse(await req.json());
    return apiJson(req, { ...(await previewLink(await getDb(), input)), requestId });
  });
}
