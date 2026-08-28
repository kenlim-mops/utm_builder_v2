/**
 * Campaigns: the canonical reporting unit. rpc_<ULID> is generated once at
 * creation, carried publicly in utm_id, and never changes on rename/edit.
 * Campaigns are created only explicitly — never implicitly from a typed name.
 */
import { asc, eq } from "drizzle-orm";
import { isValidId, newId } from "@/core/ids";
import { canonicalUtmValue } from "@/core/url";
import type { Db } from "@/db/client";
import { campaigns, externalCampaignMappings, initiatives } from "@/db/schema";
import { prefixedUlid } from "@/core/ids";
import { recordAudit } from "./audit";
import type { SessionUser } from "./auth";
import { enqueueOutboxEvent } from "./outbox";

export interface CampaignInput {
  name: string;
  utmCampaign?: string; // defaults to canonicalized name
  initiativeId?: string | null;
  product?: string | null;
  campaignType?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  description?: string | null;
}

export async function createCampaign(db: Db, actor: SessionUser, input: CampaignInput) {
  const name = input.name?.trim();
  if (!name) throw new Error("Campaign name is required.");
  const utmCampaign = canonicalUtmValue(input.utmCampaign?.trim() || name);
  if (input.initiativeId) {
    if (!isValidId("initiative", input.initiativeId)) throw new Error("Invalid initiative ID.");
    const found = await db
      .select({ id: initiatives.id })
      .from(initiatives)
      .where(eq(initiatives.id, input.initiativeId));
    if (found.length === 0) throw new Error("Initiative not found.");
  }

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(campaigns)
      .values({
        id: newId("campaign"),
        name,
        utmCampaign,
        initiativeId: input.initiativeId ?? null,
        ownerId: actor.id,
        product: input.product ?? null,
        campaignType: input.campaignType ?? null,
        startDate: input.startDate ? new Date(input.startDate) : null,
        endDate: input.endDate ? new Date(input.endDate) : null,
        description: input.description ?? null,
        createdBy: actor.id,
      })
      .returning();

    // External mapping shells + async sync via the outbox. A HubSpot outage
    // cannot roll back this transaction's registry writes — sync is queued.
    const [mapping] = await tx
      .insert(externalCampaignMappings)
      .values({
        id: prefixedUlid("map"),
        campaignId: row.id,
        system: "hubspot",
        externalType: "campaign",
        syncState: "pending",
      })
      .returning();
    await enqueueOutboxEvent(tx, {
      type: "hubspot.campaign.sync",
      payload: { campaignId: row.id, mappingId: mapping.id, name: row.name },
      idempotencyKey: `hubspot.campaign.sync:${row.id}`,
    });
    await enqueueOutboxEvent(tx, {
      type: "warehouse.snapshot.campaign",
      payload: { campaignId: row.id },
      idempotencyKey: `warehouse.snapshot.campaign:${row.id}:v1`,
    });

    await recordAudit(tx, actor, {
      action: "campaign.created",
      entityType: "campaign",
      entityId: row.id,
      after: row,
    });
    return row;
  });
}

export async function updateCampaign(
  db: Db,
  actor: SessionUser,
  id: string,
  patch: Partial<Omit<CampaignInput, "utmCampaign">> & {
    lifecycle?: "planned" | "active" | "completed" | "archived";
  },
  reason: string | null,
) {
  if (!isValidId("campaign", id)) throw new Error("Invalid campaign ID.");
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(campaigns).where(eq(campaigns.id, id));
    const before = existing[0];
    if (!before) throw new Error("Campaign not found.");
    // The canonical ID and utm_campaign slug are immutable after creation;
    // metadata (name, owner, dates, lifecycle) may change freely.
    const [row] = await tx
      .update(campaigns)
      .set({
        name: patch.name?.trim() || before.name,
        initiativeId: patch.initiativeId !== undefined ? patch.initiativeId : before.initiativeId,
        product: patch.product !== undefined ? patch.product : before.product,
        campaignType: patch.campaignType !== undefined ? patch.campaignType : before.campaignType,
        startDate: patch.startDate !== undefined ? (patch.startDate ? new Date(patch.startDate) : null) : before.startDate,
        endDate: patch.endDate !== undefined ? (patch.endDate ? new Date(patch.endDate) : null) : before.endDate,
        description: patch.description !== undefined ? patch.description : before.description,
        lifecycle: patch.lifecycle ?? before.lifecycle,
        updatedAt: new Date(),
      })
      .where(eq(campaigns.id, id))
      .returning();
    await enqueueOutboxEvent(tx, {
      type: "warehouse.snapshot.campaign",
      payload: { campaignId: row.id },
      idempotencyKey: `warehouse.snapshot.campaign:${row.id}:${row.updatedAt.toISOString()}`,
    });
    await recordAudit(tx, actor, {
      action: "campaign.updated",
      entityType: "campaign",
      entityId: id,
      before,
      after: row,
      reason,
    });
    return row;
  });
}

export async function listCampaigns(db: Db) {
  return db.select().from(campaigns).orderBy(asc(campaigns.name));
}

export async function campaignDetail(db: Db, id: string) {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id));
  if (!campaign) return null;
  const mappings = await db
    .select()
    .from(externalCampaignMappings)
    .where(eq(externalCampaignMappings.campaignId, id));
  return { campaign, mappings };
}
