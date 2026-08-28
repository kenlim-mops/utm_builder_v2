import { describe, expect, it } from "vitest";
import {
  assembleUrl,
  canonicalUtmValue,
  DestinationError,
  looseDestination,
  normalizeDestination,
} from "@/core/url";

describe("normalizeDestination", () => {
  it("accepts bare domains and normalizes to https", () => {
    expect(normalizeDestination("runpod.io/product").url).toBe("https://runpod.io/product");
  });

  it("accepts www and http URLs, upgrading to https", () => {
    expect(normalizeDestination("www.runpod.io").url).toBe("https://www.runpod.io/");
    expect(normalizeDestination("http://runpod.io/gpu").url).toBe("https://runpod.io/gpu");
  });

  it("lowercases host, strips default ports", () => {
    expect(normalizeDestination("HTTPS://RunPod.IO:443/Path").url).toBe("https://runpod.io/Path");
  });

  it("preserves unrelated query params and fragments", () => {
    const n = normalizeDestination("runpod.io/gpu?ref=abc&x=1#pricing");
    expect(n.url).toBe("https://runpod.io/gpu?ref=abc&x=1#pricing");
    expect(n.preservedParams).toEqual([
      ["ref", "abc"],
      ["x", "1"],
    ]);
  });

  it("strips existing governed params and records them", () => {
    const n = normalizeDestination("runpod.io/gpu?utm_source=old&ref=abc&utm_id=rpc_x");
    expect(n.url).toBe("https://runpod.io/gpu?ref=abc");
    expect(n.strippedGoverned).toEqual({ utm_source: "old", utm_id: "rpc_x" });
  });

  it("rejects empty, unparseable, credentialed, and private-network destinations", () => {
    expect(() => normalizeDestination("")).toThrow(DestinationError);
    expect(() => normalizeDestination("ht tp://x")).toThrow(DestinationError);
    expect(() => normalizeDestination("https://user:pass@runpod.io")).toThrow(DestinationError);
    expect(() => normalizeDestination("http://localhost:3000")).toThrow(DestinationError);
    expect(() => normalizeDestination("http://192.168.1.1/x")).toThrow(DestinationError);
    expect(() => normalizeDestination("http://10.0.0.1/x")).toThrow(DestinationError);
    expect(() => normalizeDestination("ftp://runpod.io")).toThrow(DestinationError);
  });
});

describe("assembleUrl", () => {
  const params = {
    utm_id: "rpc_01ABC",
    utm_source: "linkedin-paid",
    utm_medium: "paid",
    utm_campaign: "2026-q3-launch",
    utm_content: "founder-video",
    utm_term: null,
    rp_initiative_id: "rpi_01DEF",
    rp_link_id: "rpl_01GHI",
  };

  it("emits governed params in contract order", () => {
    const url = assembleUrl("https://runpod.io/product", params);
    const keys = [...new URL(url).searchParams.keys()];
    expect(keys).toEqual([
      "utm_id",
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "rp_initiative_id",
      "rp_link_id",
    ]);
    expect(new URL(url).searchParams.get("utm_id")).toBe("rpc_01ABC");
  });

  it("omits policy-disabled and empty params", () => {
    const url = assembleUrl("https://runpod.io/", {
      ...params,
      utm_content: null,
      rp_initiative_id: null,
      rp_link_id: null,
    });
    const keys = [...new URL(url).searchParams.keys()];
    expect(keys).toEqual(["utm_id", "utm_source", "utm_medium", "utm_campaign"]);
  });

  it("preserves unrelated params and fragment; replaces stray governed keys", () => {
    const url = assembleUrl("https://runpod.io/gpu?ref=abc#pricing", params);
    const u = new URL(url);
    expect(u.searchParams.get("ref")).toBe("abc");
    expect(u.hash).toBe("#pricing");
    expect(u.searchParams.getAll("utm_id")).toHaveLength(1);
  });

  it("encodes values correctly", () => {
    const url = assembleUrl("https://runpod.io/", {
      ...params,
      utm_content: "a b&c",
    });
    expect(new URL(url).searchParams.get("utm_content")).toBe("a b&c");
    expect(url).toContain("utm_content=a+b%26c");
  });

  it("is a pure function of its inputs (click-time independence)", () => {
    const a = assembleUrl("https://runpod.io/product", params);
    const b = assembleUrl("https://runpod.io/product", params);
    expect(a).toBe(b);
  });
});

describe("canonicalization helpers", () => {
  it("canonicalUtmValue lowercases and hyphenates whitespace", () => {
    expect(canonicalUtmValue("  Q3 Product Launch ")).toBe("q3-product-launch");
  });

  it("looseDestination trims trailing slash and sorts query", () => {
    expect(looseDestination("https://runpod.io/gpu/?b=2&a=1")).toBe(
      looseDestination("https://runpod.io/gpu?a=1&b=2"),
    );
  });
});
