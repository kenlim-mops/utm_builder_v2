import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { campaigns, linkRevisions, links, validationRuns } from "@/db/schema";
import { canManage, requireUser } from "@/services/auth";
import { retireLink, reviseLink } from "@/services/links";
import { handle, json } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireUser();
    const { id } = await params;
    const db = await getDb();
    const [link] = await db.select().from(links).where(eq(links.id, id));
    if (!link) return json({ error: "Link not found." }, { status: 404 });
    const revisions = await db.select().from(linkRevisions).where(eq(linkRevisions.linkId, id));
    const validations = await db.select().from(validationRuns).where(eq(validationRuns.linkId, id));
    const [campaign] = await db
      .select({ ownerId: campaigns.ownerId })
      .from(campaigns)
      .where(eq(campaigns.id, link.campaignId));
    return json({
      link,
      revisions,
      validations,
      permissions: { canManage: canManage(actor, { createdBy: link.createdBy, ownerId: campaign?.ownerId }) },
    });
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireUser();
    const { id } = await params;
    const db = await getDb();
    const { reason, ...patch } = await req.json();
    const result = await reviseLink(db, actor, id, patch, reason);
    return json(result);
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireUser();
    const { id } = await params;
    const db = await getDb();
    const url = new URL(req.url);
    const reason = url.searchParams.get("reason") ?? "";
    const link = await retireLink(db, actor, id, reason);
    return json({ link });
  });
}
