import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bulkUtmModal,
  singleUtmModal,
  slackIdentityAllowed,
  slackIdentityFromPayload,
  slackStateFileId,
  slackStateValue,
  verifySlackRequest,
} from "@/services/slack";
import { freshDb } from "../helpers";

afterEach(() => vi.unstubAllEnvs());

describe("Slack request handling", () => {
  it("verifies a current Slack HMAC and rejects stale timestamps", () => {
    const rawBody = "command=%2Futm&text=runpod.io";
    const timestamp = "1700000000";
    const signature = `v0=${createHmac("sha256", "secret").update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
    expect(verifySlackRequest({ rawBody, timestamp, signature, signingSecret: "secret", nowSeconds: 1700000000 })).toBe(true);
    expect(verifySlackRequest({ rawBody, timestamp, signature, signingSecret: "secret", nowSeconds: 1700000600 })).toBe(false);
  });

  it("extracts modal text, selected options, and uploaded files", () => {
    const state = { values: {
      destination: { value: { value: "runpod.io/pricing" } },
      campaign: { value: { selected_option: { value: "rpc_123" } } },
      csv: { value: { files: [{ id: "F123" }] } },
    } };
    expect(slackStateValue(state, "destination")).toBe("runpod.io/pricing");
    expect(slackStateValue(state, "campaign")).toBe("rpc_123");
    expect(slackStateFileId(state)).toBe("F123");
  });

  it("builds single and bulk modals from governed reference data", async () => {
    const db = await freshDb();
    const single = await singleUtmModal(db, "runpod.io/pricing");
    const bulk = await bulkUtmModal(db);

    expect(single.callback_id).toBe("utm_single_preview");
    expect(JSON.stringify(single)).toContain("runpod.io/pricing");
    expect(JSON.stringify(single)).toContain("Generic URL");
    expect(JSON.stringify(single)).toContain("google-ads");
    expect(bulk.callback_id).toBe("utm_bulk_issue");
    expect(JSON.stringify(bulk)).toContain("destination,source,medium,content,term");
    expect(JSON.stringify(bulk)).toContain("file_input");
  });

  it("requires a Slack user ID and retains tenant identity", () => {
    expect(slackIdentityFromPayload({
      user: { id: "U1" },
      team: { id: "T1" },
      enterprise: { id: "E1" },
    })).toEqual({ userId: "U1", teamId: "T1", enterpriseId: "E1" });
    expect(() => slackIdentityFromPayload({ team: { id: "T1" } })).toThrow(/user identity/i);
  });

  it("fails closed when production has no workspace allowlist", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SLACK_ALLOWED_TEAM_IDS", "");
    vi.stubEnv("SLACK_ALLOWED_ENTERPRISE_IDS", "");
    expect(slackIdentityAllowed({ userId: "U1", teamId: "T1", enterpriseId: null })).toBe(false);
  });

  it("allows unconfigured local/test use but enforces configured identities", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("SLACK_ALLOWED_TEAM_IDS", "");
    vi.stubEnv("SLACK_ALLOWED_ENTERPRISE_IDS", "");
    expect(slackIdentityAllowed({ userId: "U1", teamId: "T1", enterpriseId: null })).toBe(true);

    vi.stubEnv("SLACK_ALLOWED_TEAM_IDS", "T_ALLOWED");
    vi.stubEnv("SLACK_ALLOWED_ENTERPRISE_IDS", "E_ALLOWED");
    expect(slackIdentityAllowed({ userId: "U1", teamId: "T_ALLOWED", enterpriseId: null })).toBe(true);
    expect(slackIdentityAllowed({ userId: "U1", teamId: "T_OTHER", enterpriseId: "E_ALLOWED" })).toBe(true);
    expect(slackIdentityAllowed({ userId: "U1", teamId: "T_OTHER", enterpriseId: null })).toBe(false);
  });
});
