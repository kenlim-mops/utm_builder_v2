/**
 * End-to-end tests at the HTTP boundary: real Next.js route handlers invoked
 * with real Request objects against an isolated in-memory database, with the
 * auth cookie layer mocked to select seeded identities.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

let currentIdentity = "dev-admin@runpod.io";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "rp_dev_identity" ? { name, value: currentIdentity } : undefined,
    set: () => {},
  }),
}));

process.env.PGLITE_DATA_DIR = ":memory:";
process.env.OUTBOX_PROCESS_TOKEN = "test-cron-token";

const asUser = (email: string) => {
  currentIdentity = email;
};

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeAll(async () => {
  const { getDb } = await import("@/db/client");
  await getDb(); // migrate + seed the shared in-memory database once
});

describe("API end-to-end", () => {
  let campaignId: string;
  let linkId: string;

  it("health endpoint reports database status", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).checks.database).toBe("ok");
  });

  it("creates a campaign and issues a link through the shared API", async () => {
    asUser("dev-user@runpod.io");
    const campaignsRoute = await import("@/app/api/campaigns/route");
    const created = await campaignsRoute.POST(
      jsonRequest("/api/campaigns", "POST", { name: "E2E Campaign" }),
    );
    expect(created.status).toBe(201);
    campaignId = (await created.json()).campaign.id;
    expect(campaignId).toMatch(/^rpc_/);

    const linksRoute = await import("@/app/api/links/route");
    const issued = await linksRoute.POST(
      jsonRequest("/api/links", "POST", {
        destination: "runpod.io/e2e?ref=keep",
        campaignId,
        utmSource: "github",
        utmMedium: "organic",
      }),
    );
    expect(issued.status).toBe(201);
    const body = await issued.json();
    linkId = body.link.id;
    expect(body.link.finalUrl).toContain(`utm_id=${campaignId}`);
    expect(body.link.finalUrl).toContain("ref=keep");
  });

  it("returns 409 with the existing record for exact duplicates", async () => {
    asUser("dev-user@runpod.io");
    const linksRoute = await import("@/app/api/links/route");
    const dup = await linksRoute.POST(
      jsonRequest("/api/links", "POST", {
        destination: "runpod.io/e2e?ref=keep",
        campaignId,
        utmSource: "github",
        utmMedium: "organic",
      }),
    );
    expect(dup.status).toBe(409);
    const body = await dup.json();
    expect(body.code).toBe("exact_duplicate");
    expect(body.existingLinkId).toBe(linkId);
  });

  it("returns 422 with findings for validation failures", async () => {
    const linksRoute = await import("@/app/api/links/route");
    const bad = await linksRoute.POST(
      jsonRequest("/api/links", "POST", {
        destination: "http://192.168.0.1/internal",
        campaignId,
        utmSource: "github",
        utmMedium: "organic",
      }),
    );
    expect(bad.status).toBe(422);
    expect((await bad.json()).findings.length).toBeGreaterThan(0);
  });

  it("searches the registry by free text and by ID", async () => {
    const linksRoute = await import("@/app/api/links/route");
    const byId = await linksRoute.GET(jsonRequest(`/api/links?q=${linkId}`, "GET"));
    expect((await byId.json()).rows).toHaveLength(1);
    const byText = await linksRoute.GET(jsonRequest("/api/links?q=e2e", "GET"));
    expect((await byText.json()).rows.length).toBeGreaterThan(0);
  });

  it("exports CSV with formula-injection protection headers", async () => {
    const exportRoute = await import("@/app/api/export/links/route");
    const res = await exportRoute.GET(jsonRequest("/api/export/links", "GET"));
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const csv = await res.text();
    expect(csv.split("\r\n")[0]).toContain("link_id");
    expect(csv).toContain(linkId);
  });

  it("enforces roles server-side: non-admins get 403 on admin mutations", async () => {
    asUser("dev-user@runpod.io");
    const settings = await import("@/app/api/admin/settings/route");
    const denied = await settings.POST(
      jsonRequest("/api/admin/settings", "POST", { key: "bulk_limit", value: 5 }),
    );
    expect(denied.status).toBe(403);

    const usersRoute = await import("@/app/api/admin/users/route");
    expect((await usersRoute.GET()).status).toBe(403);

    // Investigator can read audit but not mutate settings.
    asUser("dev-investigator@runpod.io");
    const audit = await import("@/app/api/admin/audit/route");
    expect((await audit.GET(jsonRequest("/api/admin/audit", "GET"))).status).toBe(200);
    expect(
      (await settings.POST(jsonRequest("/api/admin/settings", "POST", { key: "bulk_limit", value: 5 }))).status,
    ).toBe(403);

    asUser("dev-admin@runpod.io");
    const allowed = await settings.POST(
      jsonRequest("/api/admin/settings", "POST", { key: "bulk_limit", value: 150, reason: "e2e" }),
    );
    expect(allowed.status).toBe(200);
  });

  it("processes bulk batches through the same API surface", async () => {
    asUser("dev-user@runpod.io");
    const batchesRoute = await import("@/app/api/batches/route");
    const res = await batchesRoute.POST(
      jsonRequest("/api/batches", "POST", {
        source: "paste",
        rows: [
          { destination: "runpod.io/b1", campaignId, utmSource: "github", utmMedium: "organic" },
          { destination: "invalid domain", campaignId, utmSource: "github", utmMedium: "organic" },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.batchId).toMatch(/^rpb_/);
    expect(body.rows[0].status).toBe("issued");
    expect(body.rows[1].status).toBe("error");
  });

  it("protects the outbox worker with a bearer token", async () => {
    const worker = await import("@/app/api/outbox/process/route");
    const denied = await worker.POST(jsonRequest("/api/outbox/process", "POST"));
    expect(denied.status).toBe(401);
    const allowed = await worker.POST(
      new Request("http://localhost/api/outbox/process", {
        method: "POST",
        headers: { Authorization: "Bearer test-cron-token" },
      }),
    );
    expect(allowed.status).toBe(200);
  });

  it("audit trail is queryable and exportable by investigators", async () => {
    asUser("dev-investigator@runpod.io");
    const audit = await import("@/app/api/admin/audit/route");
    const res = await audit.GET(jsonRequest(`/api/admin/audit?entityId=${linkId}`, "GET"));
    const body = await res.json();
    expect(body.events.some((e: { action: string }) => e.action === "link.issued")).toBe(true);
    const csv = await audit.GET(jsonRequest(`/api/admin/audit?format=csv`, "GET"));
    expect(csv.headers.get("Content-Type")).toContain("text/csv");
  });
});
