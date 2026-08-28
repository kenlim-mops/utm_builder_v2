import { describe, expect, it } from "vitest";
import { lengthWarning, validateLink, type ValidationContext } from "@/core/validation";

const ctx: ValidationContext = {
  destinationPolicies: [
    { domain: "runpod.io", kind: "approved" },
    { domain: "partner.example.com", kind: "exception" },
  ],
  taxonomy: {
    mediums: [
      { slug: "paid", status: "active" },
      { slug: "email", status: "active" },
      { slug: "fax", status: "disabled" },
    ],
    sources: [
      { slug: "linkedin-paid", mediumSlug: "paid", status: "active", aliases: [] },
      { slug: "facebook-paid", mediumSlug: "paid", status: "active", aliases: ["meta-paid"] },
      { slug: "hubspot-email", mediumSlug: "email", status: "active", aliases: [] },
    ],
  },
  preset: { key: "google_ads", verificationState: "draft", supportedMacros: ["keyword"], requiredFields: [] },
  requiredFields: [],
  recommendedMaxLength: 100,
};

const good = {
  destination: "runpod.io/gpu",
  utmSource: "linkedin-paid",
  utmMedium: "paid",
  utmCampaign: "q3-launch",
  campaignId: "rpc_X",
  presetKey: "google_ads",
};

describe("validateLink", () => {
  it("passes a clean input (draft preset yields only a warning)", () => {
    const r = validateLink(good, ctx);
    expect(r.ok).toBe(true);
    expect(r.findings.map((f) => f.code)).toContain("preset_draft");
  });

  it("blocks unapproved domains, warns for exceptions", () => {
    expect(validateLink({ ...good, destination: "evil.com" }, ctx).ok).toBe(false);
    const r = validateLink({ ...good, destination: "partner.example.com/x" }, ctx);
    expect(r.ok).toBe(true);
    expect(r.findings.some((f) => f.code === "domain_exception")).toBe(true);
  });

  it("blocks missing required fields and missing campaign", () => {
    expect(validateLink({ ...good, utmSource: "" }, ctx).ok).toBe(false);
    const r = validateLink({ ...good, campaignId: null }, ctx);
    expect(r.findings.some((f) => f.code === "missing_campaign")).toBe(true);
    const ctx2 = { ...ctx, requiredFields: ["utm_content"] };
    expect(validateLink(good, ctx2).ok).toBe(false);
  });

  it("enforces taxonomy membership, status, and medium/source relationship", () => {
    expect(validateLink({ ...good, utmSource: "myspace" }, ctx).ok).toBe(false);
    expect(validateLink({ ...good, utmMedium: "fax", utmSource: "linkedin-paid" }, ctx).ok).toBe(false);
    const mismatch = validateLink({ ...good, utmSource: "hubspot-email" }, ctx);
    expect(mismatch.findings.some((f) => f.code === "source_medium_mismatch")).toBe(true);
  });

  it("resolves aliases with a warning instead of an error", () => {
    const r = validateLink({ ...good, utmSource: "meta-paid" }, ctx);
    expect(r.ok).toBe(true);
    expect(r.findings.some((f) => f.code === "source_alias")).toBe(true);
  });

  it("blocks unsupported and malformed macros, allows supported ones", () => {
    expect(validateLink({ ...good, utmTerm: "{keyword}" }, ctx).ok).toBe(true);
    expect(validateLink({ ...good, utmTerm: "{placement}" }, ctx).ok).toBe(false);
    expect(validateLink({ ...good, utmTerm: "{}" }, ctx).ok).toBe(false);
  });

  it("warns when governed params already exist on the destination", () => {
    const r = validateLink({ ...good, destination: "runpod.io/x?utm_source=old" }, ctx);
    expect(r.findings.some((f) => f.code === "governed_params_replaced")).toBe(true);
  });

  it("length warning fires above the recommended maximum", () => {
    expect(lengthWarning("https://runpod.io/" + "a".repeat(200), 100)?.code).toBe("url_length");
    expect(lengthWarning("https://runpod.io/", 100)).toBeNull();
  });
});
