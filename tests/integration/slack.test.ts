import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { slackStateFileId, slackStateValue, verifySlackRequest } from "@/services/slack";

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
});
