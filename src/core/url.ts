/**
 * URL normalization and deterministic assembly.
 *
 * Issued URLs are self-describing: assembly is a pure function of its inputs
 * and requires no registry, HubSpot, warehouse, or redirect lookup at click
 * time. Governed parameters are replaced (never duplicated); unrelated query
 * parameters and fragments are preserved.
 */

export const GOVERNED_PARAMS = [
  "utm_id",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "rp_initiative_id",
  "rp_link_id",
] as const;

export type GovernedParam = (typeof GOVERNED_PARAMS)[number];

export interface NormalizedDestination {
  /** Normalized HTTPS URL with governed params stripped, other params/fragment preserved. */
  url: string;
  /** Governed params found on the raw input (they get replaced, not duplicated). */
  strippedGoverned: Record<string, string>;
  /** Non-governed query params preserved on the destination. */
  preservedParams: [string, string][];
}

export class DestinationError extends Error {
  constructor(
    public code:
      | "empty"
      | "unparseable"
      | "unsupported_scheme"
      | "credentials_in_url"
      | "private_network"
      | "invalid_host",
    message: string,
  ) {
    super(message);
    this.name = "DestinationError";
  }
}

const PRIVATE_HOST_RE =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[?::1\]?$|172\.(1[6-9]|2\d|3[01])\.)/i;

/**
 * Accepts bare domains ("runpod.io/gpu"), www URLs, http and https URLs.
 * Normalizes safely to HTTPS, lowercases host, strips default ports and
 * credentials rejection, strips governed UTM/rp params (recorded), preserves
 * everything else including fragments.
 */
export function normalizeDestination(raw: string): NormalizedDestination {
  const input = (raw ?? "").trim();
  if (!input) throw new DestinationError("empty", "Destination URL is required.");

  let candidate = input;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new DestinationError("unparseable", `Destination is not a valid URL: ${input}`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new DestinationError(
      "unsupported_scheme",
      `Only http/https destinations are supported (got ${url.protocol}).`,
    );
  }
  if (url.username || url.password) {
    throw new DestinationError("credentials_in_url", "Destinations must not embed credentials.");
  }
  if (!url.hostname || !url.hostname.includes(".")) {
    if (url.hostname !== "localhost") {
      throw new DestinationError("invalid_host", `Destination host looks invalid: "${url.hostname}"`);
    }
  }
  if (PRIVATE_HOST_RE.test(url.hostname)) {
    throw new DestinationError(
      "private_network",
      "Destinations must be public URLs, not localhost or private-network addresses.",
    );
  }

  // Normalize to HTTPS.
  url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase();
  if (url.port === "443" || url.port === "80") url.port = "";

  const strippedGoverned: Record<string, string> = {};
  const preservedParams: [string, string][] = [];
  const governed = new Set<string>(GOVERNED_PARAMS);
  for (const [key, value] of url.searchParams.entries()) {
    if (governed.has(key.toLowerCase())) {
      strippedGoverned[key.toLowerCase()] = value;
    } else {
      preservedParams.push([key, value]);
    }
  }
  // Rebuild the query with only preserved params, in original order.
  url.search = "";
  for (const [k, v] of preservedParams) url.searchParams.append(k, v);

  return { url: url.toString(), strippedGoverned, preservedParams };
}

export interface UtmParams {
  utm_id: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content?: string | null;
  utm_term?: string | null;
  rp_initiative_id?: string | null;
  rp_link_id?: string | null;
}

/**
 * Deterministic assembly in the contract order:
 * utm_id, utm_source, utm_medium, utm_campaign, utm_content?, utm_term?,
 * rp_initiative_id? (policy-gated), rp_link_id? (policy-gated).
 *
 * `normalizedDestination` must come from normalizeDestination (governed params
 * already stripped). Fragment position is preserved (query precedes fragment).
 */
export function assembleUrl(normalizedDestination: string, params: UtmParams): string {
  const url = new URL(normalizedDestination);
  const ordered: [GovernedParam, string | null | undefined][] = [
    ["utm_id", params.utm_id],
    ["utm_source", params.utm_source],
    ["utm_medium", params.utm_medium],
    ["utm_campaign", params.utm_campaign],
    ["utm_content", params.utm_content],
    ["utm_term", params.utm_term],
    ["rp_initiative_id", params.rp_initiative_id],
    ["rp_link_id", params.rp_link_id],
  ];
  // Defensive: strip any governed keys that slipped through, then append in order.
  for (const key of GOVERNED_PARAMS) url.searchParams.delete(key);
  for (const [key, value] of ordered) {
    if (value !== null && value !== undefined && value !== "") {
      url.searchParams.append(key, value);
    }
  }
  return url.toString();
}

/** Canonicalize a UTM value: trim, lowercase, collapse whitespace to hyphens. */
export function canonicalUtmValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

/** Loose form used for near-duplicate comparison: also strips punctuation variance. */
export function looseUtmValue(value: string): string {
  return canonicalUtmValue(value).replace(/[_.]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

/** Near-duplicate normalization of a destination (trailing slash, sorted query). */
export function looseDestination(normalizedDestination: string): string {
  const url = new URL(normalizedDestination);
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  const entries = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [k, v] of entries) url.searchParams.append(k, v);
  url.hash = "";
  return url.toString();
}
