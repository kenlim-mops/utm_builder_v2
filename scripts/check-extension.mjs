import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const manifest = JSON.parse(readFileSync(resolve(root, "extension/manifest.json"), "utf8"));
if (manifest.manifest_version !== 3) throw new Error("Extension must use Manifest V3.");
const managedSchema = JSON.parse(
  readFileSync(resolve(root, "extension", manifest.storage.managed_schema), "utf8"),
);
if (managedSchema.type !== "object" || managedSchema.additionalProperties !== false) {
  throw new Error("Managed storage schema must be a closed top-level object.");
}
for (const file of ["extension/service-worker.js", "extension/sidepanel.js"]) {
  execFileSync(process.execPath, ["--check", resolve(root, file)], { stdio: "inherit" });
}
console.log(`Extension ${manifest.version} manifest and JavaScript syntax are valid.`);
