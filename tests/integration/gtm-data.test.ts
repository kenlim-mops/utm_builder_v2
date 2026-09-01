import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { gtmCatalogRecords, gtmSourceConnectors } from "@/db/schema";
import {
  checkReadiness,
  decideSourceUpdate,
  generateBulkTemplate,
  listBulkTemplates,
  listSourceUpdates,
  resolveOwnership,
  searchCatalog,
  traceLineage,
  upsertCatalogRecord,
  upsertRelationship,
  upsertSourceConnector,
  validateBulkChange,
} from "@/services/gtm-data";
import { notionPropertyValue, syncSourceConnector, type SourceAdapter } from "@/services/source-sync";
import { adminActor, freshDb } from "../helpers";

describe("GTM Data MCP catalog", () => {
  it("governs catalog records, ownership, lineage, and readiness", async () => {
    const db = await freshDb();
    const actor = await adminActor(db);
    const team = await upsertCatalogRecord(db, actor, {
      recordType: "team", key: "growth_marketing", name: "Growth Marketing", verificationState: "verified",
    });
    const system = await upsertCatalogRecord(db, actor, {
      recordType: "system", key: "google_ads", name: "Google Ads", verificationState: "verified",
    });
    const runbook = await upsertCatalogRecord(db, actor, {
      recordType: "runbook", key: "google_ads_incident", name: "Google Ads incident runbook", verificationState: "verified",
    });
    await upsertRelationship(db, actor, { fromRecordId: team.id, toRecordId: system.id, relationshipType: "owns", isPrimary: true });
    await upsertRelationship(db, actor, { fromRecordId: system.id, toRecordId: runbook.id, relationshipType: "documented_by" });

    expect((await searchCatalog(db, { query: "Google Ads" }, actor)).map((row) => row.id)).toContain(system.id);
    const ownership = await resolveOwnership(db, { recordId: system.id }, actor);
    expect(ownership.ownership[0].from.id).toBe(team.id);
    const lineage = await traceLineage(db, system.id, "both", 2, actor);
    expect(lineage.levels[0].relationships).toHaveLength(2);
    expect((await checkReadiness(db, system.id, actor)).ready).toBe(true);
  });

  it("seeds, generates, and validates governed bulk templates", async () => {
    const db = await freshDb();
    const templates = await listBulkTemplates(db, { platformKey: "google_ads" });
    expect(templates[0].key).toBe("google_ads_editor_url_updates");
    const generated = await generateBulkTemplate(db, templates[0].key);
    expect(generated.csv).toContain("Final URL");
    const valid = await validateBulkChange(
      db,
      templates[0].key,
      "Campaign,Ad group,Final URL,Tracking template,Custom parameter\r\nLaunch,Core,https://runpod.io/x,,",
    );
    expect(valid.valid).toBe(true);
    const invalid = await validateBulkChange(db, templates[0].key, "Campaign,Final URL\r\n,https://runpod.io/x");
    expect(invalid.valid).toBe(false);
  });
});

describe("GTM source reconciliation", () => {
  it("proposes Notion changes without overwriting, then applies an approved change", async () => {
    const db = await freshDb();
    const actor = await adminActor(db);
    const connector = await upsertSourceConnector(db, actor, {
      key: "notion_systems",
      name: "Notion GTM systems",
      sourceType: "notion",
      status: "active",
      config: { dataSourceId: "test", recordType: "system" },
      credentialRef: "env:NOTION_API_TOKEN",
      autoApply: false,
      authoritativeFields: [],
    });
    const adapter: SourceAdapter = async () => ({
      records: [{
        externalId: "notion-page-1",
        recordType: "system",
        key: "ga4",
        name: "Google Analytics 4",
        summary: "Web analytics",
        attributes: { accountId: "123" },
        sensitivity: "internal",
        lifecycle: "active",
        sourceUrl: "https://notion.so/page-1",
        sourceUpdatedAt: new Date("2026-08-01T00:00:00Z"),
      }],
    });
    const sync = await syncSourceConnector(db, connector.id, "manual", adapter);
    expect(sync.skipped).toBe(false);
    expect(await db.select().from(gtmCatalogRecords).where(eq(gtmCatalogRecords.key, "ga4"))).toHaveLength(0);
    const pending = await listSourceUpdates(db, { status: "pending" });
    expect(pending).toHaveLength(1);
    const applied = await decideSourceUpdate(db, actor, pending[0].proposal.id, "approve", "Verified against the Notion owner page");
    expect(applied.record?.key).toBe("ga4");
    expect((await listSourceUpdates(db, { status: "applied" }))).toHaveLength(1);

    const retry = await syncSourceConnector(db, connector.id, "manual", adapter);
    expect(retry.skipped).toBe(false);
    expect((await listSourceUpdates(db, { status: "pending" }))).toHaveLength(0);
  });

  it("auto-applies only explicitly allowlisted fields on an existing record", async () => {
    const db = await freshDb();
    const actor = await adminActor(db);
    const record = await upsertCatalogRecord(db, actor, {
      recordType: "vendor", key: "example_vendor", name: "Example Vendor", summary: "Managed service",
    });
    const connector = await upsertSourceConnector(db, actor, {
      key: "notion_vendors",
      name: "Notion vendor directory",
      sourceType: "notion",
      status: "active",
      config: { dataSourceId: "test", recordType: "vendor" },
      credentialRef: "env:NOTION_API_TOKEN",
      autoApply: true,
      authoritativeFields: ["name"],
    });
    const unchanged = {
      externalId: "vendor-page-1",
      recordType: "vendor" as const,
      key: "example_vendor",
      name: "Example Vendor LLC",
      summary: "Managed service",
      attributes: {},
      sensitivity: "internal" as const,
      lifecycle: "active" as const,
      sourceUrl: null,
      sourceUpdatedAt: null,
    };
    await syncSourceConnector(db, connector.id, "manual", async () => ({ records: [unchanged] }));
    const [updated] = await db.select().from(gtmCatalogRecords).where(eq(gtmCatalogRecords.id, record.id));
    expect(updated.name).toBe("Example Vendor LLC");
    expect(await listSourceUpdates(db, { status: "pending" })).toHaveLength(0);
  });

  it("normalizes common Notion property types", () => {
    expect(notionPropertyValue({ type: "title", title: [{ plain_text: "Owner" }] })).toBe("Owner");
    expect(notionPropertyValue({ type: "select", select: { name: "Active" } })).toBe("Active");
    expect(notionPropertyValue({ type: "multi_select", multi_select: [{ name: "GA4" }, { name: "Ads" }] })).toEqual(["GA4", "Ads"]);
  });
});
