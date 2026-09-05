import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "@/db/client";
import type { Db } from "@/db/client";
import { createBatch } from "@/services/batches";
import { createCampaign, listCampaigns } from "@/services/campaigns";
import { createInitiative, listInitiatives } from "@/services/initiatives";
import { issueLink, previewLink } from "@/services/links";
import { listPresets } from "@/services/presets";
import { searchLinks } from "@/services/registry";
import { listTaxonomy } from "@/services/taxonomy";
import {
  checkReadiness,
  generateBulkTemplate,
  getCatalogRecord,
  listBulkTemplates,
  listSourceUpdates,
  resolveOwnership,
  searchCatalog,
  traceLineage,
  validateBulkChange,
  GTM_RECORD_TYPES,
} from "@/services/gtm-data";
import type { ApiScope, ApiSessionUser } from "@/services/auth";

const linkShape = {
  destination: z.string().min(1).describe("Landing-page URL. Scheme may be omitted; the registry normalizes it."),
  campaignId: z.string().min(1).describe("Canonical rpc_ campaign ID from the registry."),
  presetKey: z.string().optional().describe("Platform preset key, such as google_ads, linkedin, meta, reddit, or cm360."),
  utmSource: z.string().default("").describe("Governed source slug. A preset may supply this."),
  utmMedium: z.string().default("").describe("Governed medium slug. A preset may supply this."),
  utmContent: z.string().nullable().optional().describe("Creative, placement, or asset value."),
  utmTerm: z.string().nullable().optional().describe("Keyword or targeting value."),
};

function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function assertScope(actor: ApiSessionUser, scope: ApiScope) {
  if (!actor.scopes.includes(scope)) throw new Error(`Access token is missing scope: ${scope}.`);
}

/**
 * A fresh server is created for every stateless HTTP request. All tools call
 * the same services as the web UI and public API; no UTM logic is duplicated.
 */
export function createGtmDataMcpServer(
  actor: ApiSessionUser,
  dbProvider: () => Promise<Db> = getDb,
) {
  const server = new McpServer({ name: "runpod-gtm-data", version: "1.0.0" });

  if (actor.scopes.includes("gtm:read")) {
  server.registerTool(
    "gtm_search_catalog",
    {
      title: "Search GTM data catalog",
      description: "Search Runpod's governed GTM operating context: people, teams, agencies, vendors, accounts, systems, integrations, definitions, measurement assets, runbooks, policies, and reports.",
      inputSchema: {
        query: z.string().optional(),
        recordTypes: z.array(z.enum(GTM_RECORD_TYPES)).optional(),
        lifecycle: z.enum(["draft", "active", "inactive", "deprecated"]).optional(),
        verificationState: z.enum(["unverified", "verified", "stale", "conflict"]).optional(),
        limit: z.number().int().min(1).max(200).default(50),
      },
    },
    async (input) => {
      assertScope(actor, "gtm:read");
      return textResult(await searchCatalog(await dbProvider(), input, actor));
    },
  );

  server.registerTool(
    "gtm_get_record",
    {
      title: "Get GTM catalog record",
      description: "Get one governed GTM record by stable ID or key, including its active ownership and system relationships.",
      inputSchema: {
        id: z.string().optional(),
        key: z.string().optional(),
        recordType: z.enum(GTM_RECORD_TYPES).optional(),
      },
    },
    async (input) => {
      assertScope(actor, "gtm:read");
      return textResult(await getCatalogRecord(await dbProvider(), input, actor));
    },
  );

  server.registerTool(
    "gtm_resolve_ownership",
    {
      title: "Resolve GTM ownership",
      description: "Find the people, teams, agencies, or vendors that own, operate, approve, back up, or receive escalations for a GTM record.",
      inputSchema: {
        recordId: z.string().optional(),
        query: z.string().optional(),
      },
    },
    async (input) => {
      assertScope(actor, "gtm:read");
      return textResult(await resolveOwnership(await dbProvider(), input, actor));
    },
  );

  server.registerTool(
    "gtm_get_personnel_map",
    {
      title: "Get GTM personnel map",
      description: "Find internal people and teams plus supporting agencies/vendors, with their active ownership, membership, backup, approval, and escalation relationships.",
      inputSchema: { query: z.string().optional(), limit: z.number().int().min(1).max(50).default(25) },
    },
    async ({ query, limit }) => {
      assertScope(actor, "gtm:read");
      const db = await dbProvider();
      const records = await searchCatalog(db, { query, recordTypes: ["person", "team", "agency", "vendor"], lifecycle: "active", limit }, actor);
      const details = await Promise.all(records.map((record) => getCatalogRecord(db, { id: record.id }, actor)));
      return textResult(details);
    },
  );

  server.registerTool(
    "gtm_get_account_context",
    {
      title: "Get GTM account context",
      description: "Find a platform account and its governed IDs, contacts, APIs, owners, agencies/vendors, integrations, runbooks, and related systems.",
      inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(25).default(10) },
    },
    async ({ query, limit }) => {
      assertScope(actor, "gtm:read");
      const db = await dbProvider();
      const records = await searchCatalog(db, { query, recordTypes: ["account", "system", "integration"], limit }, actor);
      const details = await Promise.all(records.map((record) => getCatalogRecord(db, { id: record.id }, actor)));
      return textResult(details);
    },
  );

  server.registerTool(
    "gtm_get_measurement_inventory",
    {
      title: "Get GTM measurement inventory",
      description: "Search measurement assets, systems, integrations, and reports and return their active lineage and ownership relationships.",
      inputSchema: { query: z.string().optional(), limit: z.number().int().min(1).max(50).default(25) },
    },
    async ({ query, limit }) => {
      assertScope(actor, "gtm:read");
      const db = await dbProvider();
      const records = await searchCatalog(db, { query, recordTypes: ["measurement_asset", "system", "integration", "report"], lifecycle: "active", limit }, actor);
      const details = await Promise.all(records.map((record) => getCatalogRecord(db, { id: record.id }, actor)));
      return textResult(details);
    },
  );

  server.registerTool(
    "gtm_trace_lineage",
    {
      title: "Trace GTM data lineage",
      description: "Trace governed upstream and downstream relationships among platforms, integrations, data fields, measurement assets, and reports.",
      inputSchema: {
        recordId: z.string().min(1),
        direction: z.enum(["upstream", "downstream", "both"]).default("both"),
        depth: z.number().int().min(1).max(4).default(2),
      },
    },
    async ({ recordId, direction, depth }) => {
      assertScope(actor, "gtm:read");
      return textResult(await traceLineage(await dbProvider(), recordId, direction, depth, actor));
    },
  );

  server.registerTool(
    "gtm_get_data_definition",
    {
      title: "Get data definition",
      description: "Find governed definitions for business terms and technical data fields, including authority, type, grouping level, and linked consumers.",
      inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(50).default(20) },
    },
    async ({ query, limit }) => {
      assertScope(actor, "gtm:read");
      return textResult(await searchCatalog(await dbProvider(), { query, recordTypes: ["data_term", "data_field"], limit }, actor));
    },
  );

  server.registerTool(
    "gtm_find_runbooks",
    {
      title: "Find GTM runbooks",
      description: "Find operating, troubleshooting, escalation, and recovery runbooks in the governed GTM catalog.",
      inputSchema: { query: z.string().optional(), limit: z.number().int().min(1).max(50).default(20) },
    },
    async ({ query, limit }) => {
      assertScope(actor, "gtm:read");
      return textResult(await searchCatalog(await dbProvider(), { query, recordTypes: ["runbook"], lifecycle: "active", limit }, actor));
    },
  );

  server.registerTool(
    "gtm_check_readiness",
    {
      title: "Check GTM readiness",
      description: "Check whether a GTM system, account, integration, measurement asset, or report has an owner, verification, runbook, and no unreviewed source changes.",
      inputSchema: { recordId: z.string().min(1) },
    },
    async ({ recordId }) => {
      assertScope(actor, "gtm:read");
      return textResult(await checkReadiness(await dbProvider(), recordId, actor));
    },
  );

  server.registerTool(
    "gtm_list_source_updates",
    {
      title: "List detected source updates",
      description: "List reviewable changes detected by scheduled source reconciliation. This is read-only and never approves or applies a proposal.",
      inputSchema: {
        status: z.enum(["pending", "approved", "rejected", "applied", "superseded"]).default("pending"),
        connectorId: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      },
    },
    async (input) => {
      assertScope(actor, "gtm:read");
      if (actor.role === "user") throw new Error("Detected source updates require investigator or admin access.");
      return textResult(await listSourceUpdates(await dbProvider(), input));
    },
  );
  }

  if (actor.scopes.includes("gtm:templates")) {
  server.registerTool(
    "gtm_list_bulk_templates",
    {
      title: "List GTM bulk-change templates",
      description: "List governed Runpod templates for platform mass changes, including availability constraints and verification state.",
      inputSchema: { platformKey: z.string().optional(), operation: z.string().optional() },
    },
    async (input) => {
      assertScope(actor, "gtm:templates");
      return textResult(await listBulkTemplates(await dbProvider(), input));
    },
  );

  server.registerTool(
    "gtm_generate_bulk_template",
    {
      title: "Generate bulk-change CSV",
      description: "Generate a governed CSV header and examples for a cataloged bulk-change template. Draft templates must be verified against a current platform export before upload.",
      inputSchema: { templateKey: z.string().min(1) },
    },
    async ({ templateKey }) => {
      assertScope(actor, "gtm:templates");
      return textResult(await generateBulkTemplate(await dbProvider(), templateKey));
    },
  );

  server.registerTool(
    "gtm_validate_bulk_change",
    {
      title: "Validate bulk-change CSV",
      description: "Validate CSV columns, required cells, allowed values, and row limits against a governed bulk-change template without uploading or changing a platform.",
      inputSchema: { templateKey: z.string().min(1), csv: z.string().min(1).max(2_000_000) },
    },
    async ({ templateKey, csv }) => {
      assertScope(actor, "gtm:templates");
      return textResult(await validateBulkChange(await dbProvider(), templateKey, csv));
    },
  );
  }

  if (actor.scopes.includes("utm:read")) {
  server.registerTool(
    "utm_list_reference_data",
    {
      title: "List UTM reference data",
      description: "List canonical initiatives, campaigns, platform presets, sources, and mediums before composing a link.",
      inputSchema: {},
    },
    async () => {
      assertScope(actor, "utm:read");
      const db = await dbProvider();
      const [initiatives, campaigns, presets, taxonomy] = await Promise.all([
        listInitiatives(db),
        listCampaigns(db),
        listPresets(db),
        listTaxonomy(db),
      ]);
      return textResult({ initiatives, campaigns, presets, ...taxonomy });
    },
  );

  server.registerTool(
    "utm_search_links",
    {
      title: "Search governed links",
      description: "Search the canonical registry by URL, ID, UTM value, campaign, initiative, source, medium, or status. Use this before creating a possible duplicate.",
      inputSchema: {
        query: z.string().optional().describe("Free-text URL, ID, campaign, or UTM query."),
        campaignId: z.string().optional(),
        initiativeId: z.string().optional(),
        utmSource: z.string().optional(),
        utmMedium: z.string().optional(),
        status: z.enum(["draft", "issued", "retired"]).optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(200).default(25),
      },
    },
    async ({ query, ...filters }) => {
      assertScope(actor, "utm:read");
      return textResult(await searchLinks(await dbProvider(), { q: query, ...filters }));
    },
  );
  }

  if (actor.scopes.includes("utm:initiatives:write")) {
  server.registerTool(
    "utm_create_initiative",
    {
      title: "Create UTM initiative",
      description: "Create an optional top-level grouping for a launch or GTM motion. This writes to the registry and is audited.",
      inputSchema: {
        name: z.string().min(1).max(160),
        ownerId: z.string().optional().describe("Administrator-only when assigning another user."),
        product: z.string().nullable().optional(),
        initiativeType: z.string().nullable().optional(),
        startDate: z.string().nullable().optional(),
        endDate: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        confirmed: z.boolean().describe("Must be true to confirm this registry write."),
      },
    },
    async ({ confirmed, ...input }) => {
      assertScope(actor, "utm:initiatives:write");
      if (!confirmed) throw new Error("Set confirmed=true after the user approves creating the initiative.");
      return textResult({ initiative: await createInitiative(await dbProvider(), actor, input) });
    },
  );
  }

  if (actor.scopes.includes("utm:campaigns:write")) {
  server.registerTool(
    "utm_create_campaign",
    {
      title: "Create UTM campaign",
      description: "Create the canonical campaign record and immutable rpc_ ID used as utm_id. Semantic duplicates return candidates to reuse; an administrator may use a reason-required audited override. This writes to the registry.",
      inputSchema: {
        name: z.string().min(1).max(160),
        ownerId: z.string().optional().describe("Administrator-only when assigning another user."),
        utmCampaign: z.string().optional(),
        initiativeId: z.string().nullable().optional(),
        product: z.string().nullable().optional(),
        campaignType: z.string().nullable().optional(),
        startDate: z.string().nullable().optional(),
        endDate: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        duplicateAction: z.enum(["override"]).nullable().optional().describe("Administrator-only. Use only after reviewing returned duplicate candidates."),
        duplicateReason: z.string().max(1000).nullable().optional().describe("Required justification when duplicateAction=override."),
        confirmed: z.boolean().describe("Must be true to confirm this registry write."),
      },
    },
    async ({ confirmed, ...input }) => {
      assertScope(actor, "utm:campaigns:write");
      if (!confirmed) throw new Error("Set confirmed=true after the user approves creating the campaign.");
      return textResult({ campaign: await createCampaign(await dbProvider(), actor, input) });
    },
  );
  }

  if (actor.scopes.includes("utm:preview")) {
  server.registerTool(
    "utm_preview_link",
    {
      title: "Preview governed UTM link",
      description: "Normalize and validate a prospective URL and check exact and near duplicates without writing anything.",
      inputSchema: linkShape,
    },
    async (input) => {
      assertScope(actor, "utm:preview");
      return textResult(await previewLink(await dbProvider(), input));
    },
  );
  }

  if (actor.scopes.includes("utm:issue")) {
  server.registerTool(
    "utm_issue_link",
    {
      title: "Issue governed UTM link",
      description: "Issue one validated link, mint its rpl_ link ID, and record it in the registry. Preview first. Exact duplicates are blocked.",
      inputSchema: {
        ...linkShape,
        idempotencyKey: z.string().min(8).max(200).describe("Stable unique key for this issuance attempt; reuse it only to safely retry the same request."),
        confirmed: z.boolean().describe("Must be true after the user approves issuance."),
      },
    },
    async ({ confirmed, idempotencyKey, ...input }) => {
      assertScope(actor, "utm:issue");
      if (!confirmed) throw new Error("Set confirmed=true after the user approves issuing this link.");
      return textResult(await issueLink(await dbProvider(), actor, { ...input, idempotencyKey }));
    },
  );

  server.registerTool(
    "utm_issue_batch",
    {
      title: "Issue governed UTM batch",
      description: "Issue 1–200 links through the same validation, duplicate, ID, and audit services as the web builder. Returns row-level results.",
      inputSchema: {
        rows: z.array(z.object(linkShape)).min(1).max(200),
        source: z.enum(["grid", "paste", "csv"]).default("grid"),
        confirmed: z.boolean().describe("Must be true after the user approves the entire batch."),
      },
    },
    async ({ rows, source, confirmed }) => {
      assertScope(actor, "utm:issue");
      if (!confirmed) throw new Error("Set confirmed=true after the user approves issuing the batch.");
      return textResult(await createBatch(await dbProvider(), actor, rows, source));
    },
  );
  }

  return server;
}

/** Compatibility export for code that adopted the original name. */
export const createUtmMcpServer = createGtmDataMcpServer;
