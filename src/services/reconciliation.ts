/**
 * Reconciliation and reporting repairability.
 *
 * - reconcile(): compares registry records, external mappings, outbox state,
 *   and PostgreSQL snapshot staging; stores a reconciliation run with discrepancies.
 * - reconstructInitiativeReport(): repairs a missed rp_initiative_id capture
 *   using only raw utm_id values plus the registry's campaign-to-initiative
 *   mapping — the documented recovery path.
 */
import { eq, sql } from "drizzle-orm";
import { newId } from "@/core/ids";
import type { Db } from "@/db/client";
import {
  campaigns,
  externalCampaignMappings,
  links,
  outboxEvents,
  reconciliationRuns,
  warehouseSnapshots,
} from "@/db/schema";

export interface Discrepancy {
  kind: string;
  entityType: string;
  entityId: string;
  detail: string;
}

export async function reconcile(db: Db, triggeredBy: string) {
  const discrepancies: Discrepancy[] = [];

  // 1. Campaigns whose HubSpot mapping never reached synced state.
  const mappings = await db.select().from(externalCampaignMappings);
  for (const m of mappings) {
    if (m.system === "hubspot" && m.syncState !== "synced" && m.syncState !== "detached") {
      discrepancies.push({
        kind: "hubspot_mapping_unsynced",
        entityType: "campaign",
        entityId: m.campaignId,
        detail: `Mapping ${m.id} is ${m.syncState}${m.lastError ? `: ${m.lastError}` : ""}`,
      });
    }
  }

  // 2. Issued links without an application snapshot (downstream delivery cannot proceed).
  const issuedLinks = await db.select().from(links).where(eq(links.status, "issued"));
  const snapshots = await db.select().from(warehouseSnapshots);
  const snapshotIds = new Set(snapshots.map((s) => `${s.entityType}:${s.entityId}`));
  for (const link of issuedLinks) {
    if (!snapshotIds.has(`link:${link.id}`)) {
      discrepancies.push({
        kind: "missing_warehouse_snapshot",
        entityType: "link",
        entityId: link.id,
        detail: "Issued link has no PostgreSQL staging snapshot yet (backfillable via outbox retry).",
      });
    }
  }

  // 3. Dead outbox events (require manual attention).
  const dead = await db.select().from(outboxEvents).where(eq(outboxEvents.status, "dead"));
  for (const e of dead) {
    discrepancies.push({
      kind: "outbox_dead_letter",
      entityType: "outbox_event",
      entityId: e.id,
      detail: `${e.type} failed permanently after ${e.attempts} attempts: ${e.lastError ?? "unknown"}`,
    });
  }

  const [run] = await db
    .insert(reconciliationRuns)
    .values({
      id: newId("reconciliation"),
      kind: "full",
      triggeredBy,
      result: { discrepancies },
      discrepancyCount: discrepancies.length,
    })
    .returning();
  return { run, discrepancies };
}

export interface RawTouch {
  utm_id?: string | null;
  utm_campaign?: string | null;
  rp_initiative_id?: string | null;
  [key: string]: unknown;
}

export interface InitiativeAttribution {
  initiativeId: string | null;
  campaignId: string | null;
  recoveredFrom: "rp_initiative_id" | "utm_id_registry_mapping" | "unmatched";
}

/**
 * Attribute raw observed touches to initiatives. When rp_initiative_id was not
 * captured (missed custom dimension), recover it from utm_id (the canonical
 * campaign ID) joined to the registry's campaign→initiative mapping.
 */
export async function reconstructInitiativeReport(
  db: Db,
  touches: RawTouch[],
): Promise<InitiativeAttribution[]> {
  const allCampaigns = await db
    .select({ id: campaigns.id, initiativeId: campaigns.initiativeId })
    .from(campaigns);
  const byId = new Map(allCampaigns.map((c) => [c.id, c.initiativeId]));

  return touches.map((touch) => {
    if (touch.rp_initiative_id) {
      return {
        initiativeId: touch.rp_initiative_id,
        campaignId: touch.utm_id ?? null,
        recoveredFrom: "rp_initiative_id",
      };
    }
    if (touch.utm_id && byId.has(touch.utm_id)) {
      return {
        initiativeId: byId.get(touch.utm_id) ?? null,
        campaignId: touch.utm_id,
        recoveredFrom: "utm_id_registry_mapping",
      };
    }
    return { initiativeId: null, campaignId: touch.utm_id ?? null, recoveredFrom: "unmatched" };
  });
}

export async function listReconciliationRuns(db: Db) {
  return db
    .select()
    .from(reconciliationRuns)
    .orderBy(sql`${reconciliationRuns.createdAt} desc`)
    .limit(50);
}
