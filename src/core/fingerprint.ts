/**
 * Deterministic duplicate fingerprints.
 *
 * The exact fingerprint identifies "the same governed link" regardless of when
 * or by whom it was issued. It includes the normalized destination (governed
 * params stripped, remaining query sorted), initiative, campaign, canonical
 * UTM values, and platform/output type. It excludes generated link/batch/
 * revision IDs, timestamps, and query ordering.
 */
import { createHash } from "node:crypto";
import { canonicalUtmValue, looseDestination, looseUtmValue } from "./url";

export interface FingerprintInput {
  normalizedDestination: string;
  initiativeId: string | null;
  campaignId: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string | null;
  utmTerm: string | null;
  platformPresetKey: string;
  /** Preset static params relevant to identity (already-resolved key/value pairs). */
  staticParams?: Record<string, string>;
}

function sha256Hex(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** Exact fingerprint: byte-identical inputs after canonicalization → same hash. */
export function exactFingerprint(input: FingerprintInput): string {
  const material = {
    v: 1,
    destination: looseDestinationForExact(input.normalizedDestination),
    initiativeId: input.initiativeId ?? null,
    campaignId: input.campaignId,
    source: canonicalUtmValue(input.utmSource),
    medium: canonicalUtmValue(input.utmMedium),
    campaign: canonicalUtmValue(input.utmCampaign),
    content: input.utmContent ? canonicalUtmValue(input.utmContent) : null,
    term: input.utmTerm ? canonicalUtmValue(input.utmTerm) : null,
    preset: input.platformPresetKey,
    staticParams: input.staticParams ?? {},
  };
  return sha256Hex(canonicalJson(material));
}

// Exact fingerprint ignores query ordering but keeps trailing-slash and
// fragment distinctions out (looseDestination already sorts + trims both).
function looseDestinationForExact(dest: string): string {
  return looseDestination(dest);
}

/**
 * Near fingerprint: catches casing, punctuation (-, _, .), trailing slash,
 * reordered query, and alias-level variants of the same intent. Two links with
 * different exact fingerprints but the same near fingerprint trigger a warning.
 */
export function nearFingerprint(input: FingerprintInput): string {
  const material = {
    v: 1,
    destination: looseDestination(input.normalizedDestination),
    campaignId: input.campaignId,
    source: looseUtmValue(input.utmSource),
    medium: looseUtmValue(input.utmMedium),
    campaign: looseUtmValue(input.utmCampaign),
    content: input.utmContent ? looseUtmValue(input.utmContent) : null,
    term: input.utmTerm ? looseUtmValue(input.utmTerm) : null,
  };
  return sha256Hex(canonicalJson(material));
}

/**
 * Describe which single field differs between two inputs (used for the
 * "one-field difference" near-duplicate warning). Returns the differing field
 * name when exactly one governed field differs, else null.
 */
export function singleFieldDifference(a: FingerprintInput, b: FingerprintInput): string | null {
  const fields: [string, (i: FingerprintInput) => string][] = [
    ["destination", (i) => looseDestination(i.normalizedDestination)],
    ["source", (i) => looseUtmValue(i.utmSource)],
    ["medium", (i) => looseUtmValue(i.utmMedium)],
    ["campaign", (i) => looseUtmValue(i.utmCampaign)],
    ["content", (i) => (i.utmContent ? looseUtmValue(i.utmContent) : "")],
    ["term", (i) => (i.utmTerm ? looseUtmValue(i.utmTerm) : "")],
  ];
  const diffs = fields.filter(([, get]) => get(a) !== get(b)).map(([name]) => name);
  return diffs.length === 1 ? diffs[0] : null;
}
