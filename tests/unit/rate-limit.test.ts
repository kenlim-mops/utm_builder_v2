import { beforeEach, describe, expect, it } from "vitest";
import { assertRateLimit, clientIp, RateLimitError, resetRateLimitsForTest } from "@/server/rate-limit";

beforeEach(() => resetRateLimitsForTest());

describe("rate-limit helpers", () => {
  it("normalizes trusted proxy IP headers and rejects arbitrary text", () => {
    expect(clientIp(new Request("https://example.test", {
      headers: { "x-real-ip": "203.0.113.7" },
    }))).toBe("203.0.113.7");
    expect(clientIp(new Request("https://example.test", {
      headers: { "x-forwarded-for": "spoofed-value" },
    }))).toBe("unknown");
  });

  it("blocks calls beyond a fixed window limit", () => {
    assertRateLimit("test-key", 2, 60_000);
    assertRateLimit("test-key", 2, 60_000);
    expect(() => assertRateLimit("test-key", 2, 60_000)).toThrow(RateLimitError);
  });
});
