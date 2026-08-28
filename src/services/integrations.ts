/**
 * Production wiring for integration clients.
 *
 * Without credentials the clients fail with a clear error, which leaves events
 * safely queued/failed in the outbox for later retry — never blocking or
 * rolling back registry writes.
 */
import { eq } from "drizzle-orm";
import { prefixedUlid } from "@/core/ids";
import type { Db } from "@/db/client";
import { campaigns, links, warehouseSnapshots } from "@/db/schema";
import type { IntegrationClients } from "./outbox";

const HUBSPOT_BASE = "https://api.hubapi.com";

export function buildIntegrationClients(db: Db): IntegrationClients {
  return {
    hubspot: {
      async ensureCampaign({ idempotencyKey, name }) {
        const token = process.env.HUBSPOT_ACCESS_TOKEN;
        if (!token) {
          throw new Error("HUBSPOT_ACCESS_TOKEN is not configured; sync remains queued.");
        }
        // Idempotency: look up by exact governed name before creating, so a
        // retried event never creates a second HubSpot campaign.
        void idempotencyKey; // registry-side dedupe; API-side dedupe is the name lookup below
        const searchRes = await fetch(
          `${HUBSPOT_BASE}/marketing/v3/campaigns?name=${encodeURIComponent(name)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (searchRes.ok) {
          const data = (await searchRes.json()) as {
            results?: { id: string; properties?: { hs_name?: string } }[];
          };
          const match = data.results?.find((r) => r.properties?.hs_name === name);
          if (match) return { campaignGuid: match.id };
        }
        const createRes = await fetch(`${HUBSPOT_BASE}/marketing/v3/campaigns`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ properties: { hs_name: name } }),
        });
        if (!createRes.ok) {
          throw new Error(`HubSpot campaign create failed (${createRes.status}).`);
        }
        const created = (await createRes.json()) as { id: string };
        return { campaignGuid: created.id };
      },
    },
    warehouse: {
      // Versioned snapshots land in warehouse_snapshots, which the warehouse
      // ingests to build conformed dimensions (docs/reporting-contract.md).
      async writeSnapshot({ idempotencyKey, payload }) {
        const p = payload as { campaignId?: string; linkId?: string };
        let entityType = "unknown";
        let entityId = "unknown";
        let snapshot: unknown = payload;
        if (p.campaignId) {
          entityType = "campaign";
          entityId = p.campaignId;
          const rows = await db.select().from(campaigns).where(eq(campaigns.id, p.campaignId));
          snapshot = rows[0] ?? payload;
        } else if (p.linkId) {
          entityType = "link";
          entityId = p.linkId;
          const rows = await db.select().from(links).where(eq(links.id, p.linkId));
          snapshot = rows[0] ?? payload;
        }
        await db
          .insert(warehouseSnapshots)
          .values({
            id: prefixedUlid("snp"),
            idempotencyKey,
            entityType,
            entityId,
            snapshot,
          })
          .onConflictDoNothing({ target: warehouseSnapshots.idempotencyKey });
      },
    },
  };
}
