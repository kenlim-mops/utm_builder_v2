import { linkRequestSchema } from "@/contracts/public-api";
import { getDb } from "@/db/client";
import { requireUser } from "@/services/auth";
import { issueLink } from "@/services/links";
import { searchLinks } from "@/services/registry";
import { handle, json } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    await requireUser();
    const db = await getDb();
    const url = new URL(req.url);
    const p = Object.fromEntries(url.searchParams.entries());
    const result = await searchLinks(db, {
      ...p,
      duplicateOverride:
        p.duplicateOverride === undefined ? undefined : p.duplicateOverride === "true",
      page: p.page ? Number(p.page) : undefined,
      pageSize: p.pageSize ? Number(p.pageSize) : undefined,
      status: p.status as never,
    });
    return json(result);
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const actor = await requireUser();
    const db = await getDb();
    // Same validated shape as /api/v1/links; batch/correlation/idempotency
    // fields are server-assigned and never accepted from this entry point.
    const input = linkRequestSchema.parse(await req.json());
    const result = await issueLink(db, actor, input);
    return json(result, { status: 201 });
  });
}
