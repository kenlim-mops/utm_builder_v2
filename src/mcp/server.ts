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
export function createUtmMcpServer(
  actor: ApiSessionUser,
  dbProvider: () => Promise<Db> = getDb,
) {
  const server = new McpServer({ name: "runpod-utm-registry", version: "1.0.0" });

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

  server.registerTool(
    "utm_create_initiative",
    {
      title: "Create UTM initiative",
      description: "Create an optional top-level grouping for a launch or GTM motion. This writes to the registry and is audited.",
      inputSchema: {
        name: z.string().min(1).max(160),
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

  server.registerTool(
    "utm_create_campaign",
    {
      title: "Create UTM campaign",
      description: "Create the canonical campaign record and immutable rpc_ ID used as utm_id. This writes to the registry and is audited.",
      inputSchema: {
        name: z.string().min(1).max(160),
        utmCampaign: z.string().optional(),
        initiativeId: z.string().nullable().optional(),
        product: z.string().nullable().optional(),
        campaignType: z.string().nullable().optional(),
        startDate: z.string().nullable().optional(),
        endDate: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        confirmed: z.boolean().describe("Must be true to confirm this registry write."),
      },
    },
    async ({ confirmed, ...input }) => {
      assertScope(actor, "utm:campaigns:write");
      if (!confirmed) throw new Error("Set confirmed=true after the user approves creating the campaign.");
      return textResult({ campaign: await createCampaign(await dbProvider(), actor, input) });
    },
  );

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

  return server;
}
