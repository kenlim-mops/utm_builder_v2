import { linkRequestSchema } from "@/contracts/public-api";
import { getDb } from "@/db/client";
import { apiJson, handlePublicApi, publicApiOptions } from "@/server/public-api";
import { requireApiScope } from "@/services/auth";
import { issueLink } from "@/services/links";
import { searchLinks } from "@/services/registry";

export const dynamic = "force-dynamic";
export async function OPTIONS(req: Request) { return publicApiOptions(req); }

export async function GET(req: Request) {
  return handlePublicApi(req, async (requestId) => {
    await requireApiScope(req, "utm:read");
    const params = Object.fromEntries(new URL(req.url).searchParams.entries());
    const result = await searchLinks(await getDb(), {
      ...params,
      page: params.page ? Number(params.page) : undefined,
      pageSize: params.pageSize ? Number(params.pageSize) : undefined,
      status: params.status as "draft" | "issued" | "retired" | undefined,
      duplicateOverride: params.duplicateOverride === undefined ? undefined : params.duplicateOverride === "true",
    });
    return apiJson(req, { ...result, requestId });
  });
}

export async function POST(req: Request) {
  return handlePublicApi(req, async (requestId) => {
    const actor = await requireApiScope(req, "utm:issue");
    const input = linkRequestSchema.parse(await req.json());
    const idempotencyKey = req.headers.get("idempotency-key");
    if (!idempotencyKey) throw new Error("Idempotency-Key header is required for link issuance.");
    const result = await issueLink(await getDb(), actor, {
      ...input,
      idempotencyKey,
      correlationId: requestId,
    });
    return apiJson(req, { ...result, requestId }, { status: 201 });
  });
}
