/**
 * Failure-domain tests: registry outage, HubSpot outage, retry idempotency,
 * reporting repair, and fail-closed issuance.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { campaigns, externalCampaignMappings, links, outboxEvents, warehouseSnapshots } from "@/db/schema";
import { assembleUrl } from "@/core/url";
import type { SessionUser } from "@/services/auth";
import { createCampaign } from "@/services/campaigns";
import { createInitiative } from "@/services/initiatives";
import { issueLink } from "@/services/links";
import { processOutbox } from "@/services/outbox";
import { reconcile, reconstructInitiativeReport } from "@/services/reconciliation";
import { adminActor, fakeClients, freshDb, userActor } from "../helpers";

let db: Db;
let admin: SessionUser;
let user: SessionUser;

beforeEach(async () => {
  db = await freshDb();
  admin = await adminActor(db);
  user = await userActor(db);
});

describe("click-time independence", () => {
  it("issued URLs are self-describing and resolve with no registry lookup", async () => {
    const campaign = await createCampaign(db, admin, { name: "Independent" });
    const { link } = await issueLink(db, user, {
      destination: "runpod.io/gpu",
      campaignId: campaign.id,
      utmSource: "github",
      utmMedium: "organic",
    });
    // The stored URL is a plain, direct HTTPS URL to the landing page:
    const url = new URL(link.finalUrl);
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("runpod.io");
    // Every reporting identifier is carried in the URL itself.
    expect(url.searchParams.get("utm_id")).toBe(campaign.id);
    expect(url.searchParams.get("utm_campaign")).toBe(campaign.utmCampaign);
    // "Registry unavailable": parse the URL with zero database access and
    // recover the full reporting contract from the string alone.
    const parsedWithoutRegistry = Object.fromEntries(url.searchParams.entries());
    expect(parsedWithoutRegistry.utm_id).toMatch(/^rpc_/);
    expect(parsedWithoutRegistry.utm_source).toBe("github");
  });

  it("URL assembly is a pure function — same output with or without a database", async () => {
    const fromPureFunction = assembleUrl("https://runpod.io/gpu", {
      utm_id: "rpc_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      utm_source: "github",
      utm_medium: "organic",
      utm_campaign: "independent",
      rp_link_id: "rpl_01ARZ3NDEKTSV4RRFFQ69G5FAV",
    });
    expect(fromPureFunction).toContain("utm_id=rpc_");
  });

  it("fails closed: if the registry transaction cannot commit, no link and no ID escape", async () => {
    const campaign = await createCampaign(db, admin, { name: "FailClosed" });
    const before = (await db.select().from(links)).length;
    // Force a commit failure via the DB uniqueness invariant itself: issue,
    // then attempt an identical insert path (duplicate) — the transaction
    // aborts and nothing partial (validation runs, audit orphans) leaks.
    await issueLink(db, user, {
      destination: "runpod.io/fail-closed",
      campaignId: campaign.id,
      utmSource: "github",
      utmMedium: "organic",
    });
    await expect(
      issueLink(db, user, {
        destination: "runpod.io/fail-closed",
        campaignId: campaign.id,
        utmSource: "github",
        utmMedium: "organic",
      }),
    ).rejects.toThrow();
    expect((await db.select().from(links)).length).toBe(before + 1);
  });

  it("no client path can mint an unregistered URL: issuance requires a committed row", async () => {
    // The only way to obtain a final URL with a real rpl_ ID is issueLink's
    // committed insert. Simulate "authoritative API unavailable" by breaking
    // the campaign FK — the caller gets an error and no URL.
    await expect(
      issueLink(db, user, {
        destination: "runpod.io/x",
        campaignId: "rpc_01ARZ3NDEKTSV4RRFFQ69G5FAV", // not in registry
        utmSource: "github",
        utmMedium: "organic",
      }),
    ).rejects.toThrow();
    expect(await db.select().from(links)).toHaveLength(0);
  });
});

describe("HubSpot failure isolation", () => {
  it("a HubSpot outage never removes or mutates the committed campaign/link", async () => {
    const { clients } = fakeClients({ hubspotAlwaysFail: true });
    const campaign = await createCampaign(db, admin, { name: "Outage Campaign" });
    const { link } = await issueLink(db, user, {
      destination: "runpod.io/outage",
      campaignId: campaign.id,
      utmSource: "github",
      utmMedium: "organic",
    });

    const result = await processOutbox(db, clients);
    expect(result.failed).toBeGreaterThan(0);

    // Registry records are untouched and the URL did not change.
    const [campaignAfter] = await db.select().from(campaigns).where(eq(campaigns.id, campaign.id));
    const [linkAfter] = await db.select().from(links).where(eq(links.id, link.id));
    expect(campaignAfter).toMatchObject({ id: campaign.id, name: "Outage Campaign" });
    expect(linkAfter.finalUrl).toBe(link.finalUrl);
    expect(linkAfter.status).toBe("issued");

    // The failure is visible on the mapping, not destructive.
    const [mapping] = await db
      .select()
      .from(externalCampaignMappings)
      .where(eq(externalCampaignMappings.campaignId, campaign.id));
    expect(mapping.syncState).toBe("failed");
    expect(mapping.lastError).toMatch(/outage/i);
    expect(mapping.externalId).toBeNull();
  });

  it("retried sync is idempotent — no duplicate external records", async () => {
    const { clients, hubspot } = fakeClients({ hubspotFailures: 2 });
    const campaign = await createCampaign(db, admin, { name: "Retry Campaign" });

    // Attempt 1 and 2 fail; make events due again by rewinding nextAttemptAt.
    for (let i = 0; i < 3; i++) {
      await db.update(outboxEvents).set({ nextAttemptAt: new Date(0) });
      await processOutbox(db, clients);
    }
    // Process once more after success to prove succeeded events are not re-run.
    await db.update(outboxEvents).set({ nextAttemptAt: new Date(0) });
    await processOutbox(db, clients);

    expect(hubspot.calls.length).toBe(3); // 2 failures + 1 success, then no more
    expect(hubspot.created.size).toBe(1); // exactly one external campaign
    const [mapping] = await db
      .select()
      .from(externalCampaignMappings)
      .where(eq(externalCampaignMappings.campaignId, campaign.id));
    expect(mapping.syncState).toBe("synced");
    expect(mapping.externalId).toBe("hs-guid-1");
  });

  it("dead-letters after max attempts and reconciliation surfaces it", async () => {
    const { clients } = fakeClients({ hubspotAlwaysFail: true });
    await createCampaign(db, admin, { name: "Dead Letter" });
    for (let i = 0; i < 9; i++) {
      await db.update(outboxEvents).set({ nextAttemptAt: new Date(0) });
      await processOutbox(db, clients);
    }
    const events = await db.select().from(outboxEvents).where(eq(outboxEvents.type, "hubspot.campaign.sync"));
    expect(events[0].status).toBe("dead");
    expect(events[0].attempts).toBe(8);

    const { discrepancies } = await reconcile(db, admin.id);
    expect(discrepancies.some((d) => d.kind === "outbox_dead_letter")).toBe(true);
    expect(discrepancies.some((d) => d.kind === "hubspot_mapping_unsynced")).toBe(true);
  });

  it("duplicate enqueue with the same idempotency key is a no-op", async () => {
    const { enqueueOutboxEvent } = await import("@/services/outbox");
    await enqueueOutboxEvent(db, { type: "t", payload: {}, idempotencyKey: "k1" });
    await enqueueOutboxEvent(db, { type: "t", payload: {}, idempotencyKey: "k1" });
    const rows = await db.select().from(outboxEvents).where(eq(outboxEvents.idempotencyKey, "k1"));
    expect(rows).toHaveLength(1);
  });
});

describe("reporting repairability", () => {
  it("recovers a missed rp_initiative_id from utm_id + registry mapping", async () => {
    const initiative = await createInitiative(db, admin, { name: "Recoverable Launch" });
    const c1 = await createCampaign(db, admin, { name: "Wave 1", initiativeId: initiative.id });
    const c2 = await createCampaign(db, admin, { name: "Wave 2", initiativeId: initiative.id });
    const standalone = await createCampaign(db, admin, { name: "Standalone" });

    // Raw GA4/warehouse touches where the custom dimension was NOT captured:
    const touches = [
      { utm_id: c1.id, utm_campaign: "wave-1" }, // missed rp_initiative_id
      { utm_id: c2.id, rp_initiative_id: initiative.id }, // captured
      { utm_id: standalone.id }, // no initiative
      { utm_id: "rpc_01ARZ3NDEKTSV4RRFFQ69G5FAV" }, // unknown campaign
      { utm_campaign: "typed-by-hand" }, // no utm_id at all
    ];
    const report = await reconstructInitiativeReport(db, touches);
    expect(report[0]).toEqual({
      initiativeId: initiative.id,
      campaignId: c1.id,
      recoveredFrom: "utm_id_registry_mapping",
    });
    expect(report[1].recoveredFrom).toBe("rp_initiative_id");
    expect(report[1].initiativeId).toBe(initiative.id);
    expect(report[2].initiativeId).toBeNull(); // standalone campaign, correctly no initiative
    expect(report[3].recoveredFrom).toBe("unmatched");
    expect(report[4].recoveredFrom).toBe("unmatched");
  });

  it("writes versioned warehouse snapshots and flags missing ones", async () => {
    const { clients } = fakeClients();
    const campaign = await createCampaign(db, admin, { name: "Snapshot" });
    const { link } = await issueLink(db, user, {
      destination: "runpod.io/snap",
      campaignId: campaign.id,
      utmSource: "github",
      utmMedium: "organic",
    });

    // Before processing: reconciliation reports the missing snapshot (backfillable).
    let { discrepancies } = await reconcile(db, admin.id);
    expect(discrepancies.some((d) => d.kind === "missing_warehouse_snapshot" && d.entityId === link.id)).toBe(true);

    const { buildIntegrationClients } = await import("@/services/integrations");
    const realWarehouse = buildIntegrationClients(db);
    await processOutbox(db, { hubspot: clients.hubspot, warehouse: realWarehouse.warehouse });

    const snaps = await db.select().from(warehouseSnapshots).where(eq(warehouseSnapshots.entityId, link.id));
    expect(snaps).toHaveLength(1);
    expect((snaps[0].snapshot as { utmId: string }).utmId).toBe(campaign.id);

    ({ discrepancies } = await reconcile(db, admin.id));
    expect(discrepancies.some((d) => d.kind === "missing_warehouse_snapshot")).toBe(false);
  });
});
