import { describe, expect, it } from "vitest";
import { exactFingerprint, nearFingerprint, singleFieldDifference, type FingerprintInput } from "@/core/fingerprint";

const base: FingerprintInput = {
  normalizedDestination: "https://runpod.io/gpu?ref=abc",
  initiativeId: "rpi_A",
  campaignId: "rpc_A",
  utmSource: "linkedin-paid",
  utmMedium: "paid",
  utmCampaign: "2026-q3-launch",
  utmContent: "founder-video",
  utmTerm: null,
  platformPresetKey: "linkedin",
  staticParams: {},
};

describe("exactFingerprint", () => {
  it("is deterministic and independent of query ordering", () => {
    const a = exactFingerprint(base);
    const b = exactFingerprint({
      ...base,
      normalizedDestination: "https://runpod.io/gpu?ref=abc",
    });
    expect(a).toBe(b);
    const reordered = exactFingerprint({
      ...base,
      normalizedDestination: "https://runpod.io/gpu?ref=abc&z=1",
    });
    const reordered2 = exactFingerprint({
      ...base,
      normalizedDestination: "https://runpod.io/gpu?z=1&ref=abc",
    });
    expect(reordered).toBe(reordered2);
  });

  it("normalizes casing and whitespace into the same fingerprint", () => {
    expect(exactFingerprint({ ...base, utmContent: "Founder Video" })).toBe(
      exactFingerprint({ ...base, utmContent: "founder-video" }),
    );
  });

  it("changes when any identity-relevant field changes", () => {
    const a = exactFingerprint(base);
    expect(exactFingerprint({ ...base, campaignId: "rpc_B" })).not.toBe(a);
    expect(exactFingerprint({ ...base, utmSource: "google-ads" })).not.toBe(a);
    expect(exactFingerprint({ ...base, platformPresetKey: "generic" })).not.toBe(a);
    expect(exactFingerprint({ ...base, normalizedDestination: "https://runpod.io/cpu" })).not.toBe(a);
  });

  it("excludes link/batch/revision IDs and timestamps by construction", () => {
    // The input type has no fields for those values; identical governed inputs
    // issued at different times by different links collide by design.
    expect(exactFingerprint({ ...base })).toBe(exactFingerprint({ ...base }));
  });
});

describe("nearFingerprint", () => {
  it("collapses punctuation and trailing-slash variants", () => {
    const a = nearFingerprint(base);
    expect(nearFingerprint({ ...base, utmContent: "founder_video" })).toBe(a);
    expect(nearFingerprint({ ...base, normalizedDestination: "https://runpod.io/gpu/?ref=abc" })).toBe(a);
  });
});

describe("singleFieldDifference", () => {
  it("names the single differing field", () => {
    expect(singleFieldDifference(base, { ...base, utmContent: "static-banner" })).toBe("content");
  });
  it("returns null when zero or multiple fields differ", () => {
    expect(singleFieldDifference(base, base)).toBeNull();
    expect(
      singleFieldDifference(base, { ...base, utmContent: "x", utmSource: "google-ads" }),
    ).toBeNull();
  });
});
