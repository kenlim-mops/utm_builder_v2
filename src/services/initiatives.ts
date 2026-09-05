/**
 * Initiatives: optional grouping layer above campaigns for launches/GTM motions.
 * IDs (rpi_) are immutable; metadata edits never change the ID.
 */
import { asc, eq } from "drizzle-orm";
import { isValidId, newId } from "@/core/ids";
import type { Db } from "@/db/client";
import { campaigns, initiatives, links } from "@/db/schema";
import { recordAudit } from "./audit";
import { assertCanManage, assertCanWrite, type SessionUser } from "./auth";

export interface InitiativeInput {
  name: string;
  product?: string | null;
  initiativeType?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  description?: string | null;
}

export async function createInitiative(db: Db, actor: SessionUser, input: InitiativeInput) {
  assertCanWrite(actor);
  const name = input.name?.trim();
  if (!name) throw new Error("Initiative name is required.");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(initiatives)
      .values({
        id: newId("initiative"),
        name,
        ownerId: actor.id,
        product: input.product ?? null,
        initiativeType: input.initiativeType ?? null,
        startDate: input.startDate ? new Date(input.startDate) : null,
        endDate: input.endDate ? new Date(input.endDate) : null,
        description: input.description ?? null,
        createdBy: actor.id,
      })
      .returning();
    await recordAudit(tx, actor, {
      action: "initiative.created",
      entityType: "initiative",
      entityId: row.id,
      after: row,
    });
    return row;
  });
}

export async function updateInitiative(
  db: Db,
  actor: SessionUser,
  id: string,
  patch: Partial<InitiativeInput> & { lifecycle?: "planned" | "active" | "completed" | "archived" },
  reason: string | null,
) {
  if (!isValidId("initiative", id)) throw new Error("Invalid initiative ID.");
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(initiatives).where(eq(initiatives.id, id));
    const before = existing[0];
    if (!before) throw new Error("Initiative not found.");
    assertCanManage(actor, { createdBy: before.createdBy, ownerId: before.ownerId }, "initiative");
    const [row] = await tx
      .update(initiatives)
      .set({
        name: patch.name?.trim() || before.name,
        product: patch.product !== undefined ? patch.product : before.product,
        initiativeType:
          patch.initiativeType !== undefined ? patch.initiativeType : before.initiativeType,
        startDate: patch.startDate !== undefined ? (patch.startDate ? new Date(patch.startDate) : null) : before.startDate,
        endDate: patch.endDate !== undefined ? (patch.endDate ? new Date(patch.endDate) : null) : before.endDate,
        description: patch.description !== undefined ? patch.description : before.description,
        lifecycle: patch.lifecycle ?? before.lifecycle,
        updatedAt: new Date(),
      })
      .where(eq(initiatives.id, id))
      .returning();
    await recordAudit(tx, actor, {
      action: "initiative.updated",
      entityType: "initiative",
      entityId: id,
      before,
      after: row,
      reason,
    });
    return row;
  });
}

export async function listInitiatives(db: Db) {
  return db.select().from(initiatives).orderBy(asc(initiatives.name));
}

/** Everything related to one initiative: campaigns and links (for view/export). */
export async function initiativeDetail(db: Db, id: string) {
  const [initiative] = await db.select().from(initiatives).where(eq(initiatives.id, id));
  if (!initiative) return null;
  const relatedCampaigns = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.initiativeId, id))
    .orderBy(asc(campaigns.name));
  const relatedLinks = await db.select().from(links).where(eq(links.initiativeId, id));
  return { initiative, campaigns: relatedCampaigns, links: relatedLinks };
}
