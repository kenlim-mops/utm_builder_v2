import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("browser extension package", () => {
  it("is a least-privilege Manifest V3 side-panel client", async () => {
    const manifest = JSON.parse(await readFile(resolve("extension/manifest.json"), "utf8"));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toContain("activeTab");
    expect(manifest.permissions).toContain("identity");
    expect(manifest.side_panel.default_path).toBe("sidepanel.html");
    expect(manifest.storage.managed_schema).toBe("managed-storage-schema.json");
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.optional_host_permissions).toContain("https://*/*");
  });

  it("delegates generation to versioned registry endpoints", async () => {
    const source = await readFile(resolve("extension/sidepanel.js"), "utf8");
    expect(source).toContain("/api/v1/links/preview");
    expect(source).toContain("/api/v1/links");
    expect(source).toContain("Idempotency-Key");
    expect(source).not.toContain("utm_id=");
  });
});
