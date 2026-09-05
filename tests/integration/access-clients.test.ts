import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createCampaign } from "@/services/campaigns";
import {
  createExtensionAuthorizationCode,
  createPersonalAccessToken,
  exchangeExtensionAuthorizationCode,
  listPersonalAccessTokens,
  revokePersonalAccessToken,
} from "@/services/access-tokens";
import { issueLink } from "@/services/links";
import { sha256Base64Url } from "@/core/tokens";
import { createUtmMcpServer } from "@/mcp/server";
import type { ApiSessionUser } from "@/services/auth";
import { adminActor, freshDb, investigatorActor, userActor } from "../helpers";

const linkRequest = (campaignId: string) => ({
  destination: "runpod.io/integrated-client",
  campaignId,
  presetKey: "generic",
  utmSource: "github",
  utmMedium: "organic",
});

describe("API access and integrated clients", () => {
  it("stores personal tokens as hashes, lists metadata, and revokes them", async () => {
    const db = await freshDb();
    const actor = await userActor(db);
    const created = await createPersonalAccessToken(db, actor, { label: "MCP test", clientType: "mcp" });
    expect(created.token).toMatch(/^rpt_/);
    expect(JSON.stringify(created.metadata)).not.toContain(created.token);
    expect(await listPersonalAccessTokens(db, actor)).toHaveLength(1);
    await revokePersonalAccessToken(db, actor, created.metadata.id);
    expect((await listPersonalAccessTokens(db, actor))[0].revokedAt).toBeInstanceOf(Date);
  });

  it("exchanges a one-time PKCE extension code for an eight-hour token", async () => {
    const db = await freshDb();
    const actor = await userActor(db);
    const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
    const redirectUri = "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/callback";
    const code = await createExtensionAuthorizationCode(db, actor, {
      redirectUri,
      codeChallenge: sha256Base64Url(verifier),
    });
    const exchanges = await Promise.allSettled([
      exchangeExtensionAuthorizationCode(db, { code, codeVerifier: verifier, redirectUri }),
      exchangeExtensionAuthorizationCode(db, { code, codeVerifier: verifier, redirectUri }),
    ]);
    expect(exchanges.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(exchanges.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    const result = exchanges.find((attempt) => attempt.status === "fulfilled");
    if (!result || result.status !== "fulfilled") throw new Error("Expected one successful exchange.");
    expect(result.value.token).toMatch(/^rpt_/);
    expect(result.value.metadata.clientType).toBe("extension");
    await expect(
      exchangeExtensionAuthorizationCode(db, { code, codeVerifier: verifier, redirectUri }),
    ).rejects.toThrow(/invalid|expired|used/i);
  });

  it("returns the original link for a safe idempotent retry and rejects key reuse with different input", async () => {
    const db = await freshDb();
    const actor = await userActor(db);
    const admin = await adminActor(db);
    const campaign = await createCampaign(db, admin, { name: "Idempotent client campaign" });
    const request = { ...linkRequest(campaign.id), idempotencyKey: "same-client-request-001" };
    const first = await issueLink(db, actor, request);
    const retry = await issueLink(db, actor, request);
    expect(retry.link.id).toBe(first.link.id);
    await expect(
      issueLink(db, actor, { ...request, destination: "runpod.io/different" }),
    ).rejects.toThrow(/different request/i);
  });

  it("exposes governed read and preview tools through MCP", async () => {
    const db = await freshDb();
    const actor = await userActor(db);
    const apiActor: ApiSessionUser = {
      ...actor,
      authMethod: "bearer",
      tokenId: "tok_test",
      scopes: ["utm:read", "utm:preview", "utm:issue", "utm:campaigns:write", "utm:initiatives:write", "gtm:read", "gtm:templates"],
    };
    const server = createUtmMcpServer(apiActor, async () => db);
    const client = new Client({ name: "utm-registry-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("utm_issue_link");
    expect(tools.tools.map((tool) => tool.name)).toContain("gtm_resolve_ownership");
    const references = await client.callTool({ name: "utm_list_reference_data", arguments: {} });
    expect(references.isError).not.toBe(true);
    expect(JSON.stringify(references.content)).toContain("google_ads");
    const definitions = await client.callTool({ name: "gtm_get_data_definition", arguments: { query: "utm_id" } });
    expect(definitions.isError).not.toBe(true);
    expect(JSON.stringify(definitions.content)).toContain("Immutable Runpod campaign identifier");

    await client.close();
    await server.close();
  });

  it("does not advertise MCP write tools to a read-only investigator", async () => {
    const db = await freshDb();
    const investigator = await investigatorActor(db);
    const apiActor: ApiSessionUser = {
      ...investigator,
      authMethod: "bearer",
      tokenId: "tok_read_only",
      scopes: ["utm:read", "utm:preview", "gtm:read"],
    };
    const server = createUtmMcpServer(apiActor, async () => db);
    const client = new Client({ name: "utm-registry-read-only-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain("utm_preview_link");
    expect(names).toContain("utm_search_links");
    expect(names).not.toContain("utm_issue_link");
    expect(names).not.toContain("utm_issue_batch");
    expect(names).not.toContain("utm_create_campaign");

    await client.close();
    await server.close();
  });
});
