/**
 * Local/syntactic validation policy (V2 scope).
 *
 * Produces blocking errors and non-blocking warnings. The evidence model is
 * designed for future executed checks (HTTP status, redirects, render,
 * soft-404, tag firing, parameter persistence) — those produce validation runs
 * with kind !== "syntactic" and stored evidence. A link is never labeled
 * "live"/"verified" from syntactic validation alone.
 */
import { DestinationError, normalizeDestination } from "./url";

export type ValidationSeverity = "error" | "warning";

export interface ValidationFinding {
  code: string;
  severity: ValidationSeverity;
  field: string | null;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  findings: ValidationFinding[];
}

export interface DestinationPolicyRule {
  domain: string;
  kind: "approved" | "exception";
}

export interface TaxonomyView {
  mediums: { slug: string; status: string }[];
  sources: { slug: string; mediumSlug: string; status: string; aliases: string[] }[];
}

export interface PresetView {
  key: string;
  verificationState: string; // draft | verified | deprecated
  supportedMacros: string[];
  requiredFields: string[];
}

export interface ValidateLinkInput {
  destination: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent?: string | null;
  utmTerm?: string | null;
  campaignId?: string | null;
  presetKey: string;
}

export interface ValidationContext {
  destinationPolicies: DestinationPolicyRule[];
  taxonomy: TaxonomyView;
  preset: PresetView | null;
  requiredFields: string[]; // admin-configured, e.g. ["utm_content"]
  recommendedMaxLength: number; // final URL length recommendation
}

const MACRO_RE = /\{([^{}]*)\}|\{\{([^{}]*)\}\}/g;

function hostMatchesDomain(host: string, domain: string): boolean {
  const h = host.toLowerCase();
  const d = domain.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

export function validateLink(input: ValidateLinkInput, ctx: ValidationContext): ValidationResult {
  const findings: ValidationFinding[] = [];
  const err = (code: string, field: string | null, message: string) =>
    findings.push({ code, severity: "error", field, message });
  const warn = (code: string, field: string | null, message: string) =>
    findings.push({ code, severity: "warning", field, message });

  // Destination
  let host: string | null = null;
  try {
    const normalized = normalizeDestination(input.destination);
    host = new URL(normalized.url).hostname;
    if (Object.keys(normalized.strippedGoverned).length > 0) {
      warn(
        "governed_params_replaced",
        "destination",
        `Existing governed parameters on the destination will be replaced: ${Object.keys(normalized.strippedGoverned).join(", ")}.`,
      );
    }
  } catch (e) {
    if (e instanceof DestinationError) {
      err(`destination_${e.code}`, "destination", e.message);
    } else {
      err("destination_invalid", "destination", "Destination could not be normalized.");
    }
  }

  // Approved-domain policy
  if (host) {
    const approved = ctx.destinationPolicies.filter((p) => p.kind === "approved");
    const exceptions = ctx.destinationPolicies.filter((p) => p.kind === "exception");
    const isApproved = approved.some((p) => hostMatchesDomain(host!, p.domain));
    const isException = exceptions.some((p) => hostMatchesDomain(host!, p.domain));
    if (!isApproved && !isException && approved.length > 0) {
      err(
        "domain_not_approved",
        "destination",
        `"${host}" is not an approved destination domain. Ask an administrator to add it.`,
      );
    } else if (!isApproved && isException) {
      warn(
        "domain_exception",
        "destination",
        `"${host}" is a permitted external-domain exception, not a standard approved domain.`,
      );
    }
  }

  // Required fields
  const requiredAlways: [string, string][] = [
    ["utm_source", input.utmSource],
    ["utm_medium", input.utmMedium],
    ["utm_campaign", input.utmCampaign],
  ];
  for (const [field, value] of requiredAlways) {
    if (!value || !value.trim()) err("missing_required_field", field, `${field} is required.`);
  }
  for (const field of ctx.requiredFields) {
    const value =
      field === "utm_content" ? input.utmContent : field === "utm_term" ? input.utmTerm : null;
    if (!value || !value.trim()) {
      err("missing_required_field", field, `${field} is required by current policy.`);
    }
  }
  if (!input.campaignId) {
    err(
      "missing_campaign",
      "campaignId",
      "A governed campaign must be selected or explicitly created — links cannot be issued without a canonical campaign ID.",
    );
  }

  // Taxonomy
  const mediumValue = (input.utmMedium ?? "").trim().toLowerCase();
  const sourceValue = (input.utmSource ?? "").trim().toLowerCase();
  const medium = ctx.taxonomy.mediums.find((m) => m.slug === mediumValue);
  if (mediumValue && !medium) {
    err("medium_not_in_taxonomy", "utm_medium", `Medium "${mediumValue}" is not in the governed taxonomy.`);
  } else if (medium && medium.status !== "active") {
    err("medium_disabled", "utm_medium", `Medium "${mediumValue}" is currently ${medium.status}.`);
  }
  if (sourceValue) {
    const source = ctx.taxonomy.sources.find((s) => s.slug === sourceValue);
    const aliasOf = ctx.taxonomy.sources.find((s) => s.aliases.includes(sourceValue));
    if (!source && aliasOf) {
      warn(
        "source_alias",
        "utm_source",
        `"${sourceValue}" is an alias of canonical source "${aliasOf.slug}" — the canonical value will be used.`,
      );
    } else if (!source) {
      err("source_not_in_taxonomy", "utm_source", `Source "${sourceValue}" is not in the governed taxonomy.`);
    } else {
      if (source.status !== "active") {
        err("source_disabled", "utm_source", `Source "${sourceValue}" is currently ${source.status}.`);
      }
      if (medium && source.mediumSlug !== mediumValue) {
        err(
          "source_medium_mismatch",
          "utm_source",
          `Source "${sourceValue}" belongs to medium "${source.mediumSlug}", not "${mediumValue}".`,
        );
      }
    }
  }

  // Value hygiene
  for (const [field, value] of [
    ["utm_campaign", input.utmCampaign],
    ["utm_content", input.utmContent ?? ""],
    ["utm_term", input.utmTerm ?? ""],
  ] as [string, string][]) {
    if (value && /\s/.test(value.trim())) {
      warn("value_contains_whitespace", field, `${field} contains whitespace; it will be canonicalized with hyphens.`);
    }
    if (value && value !== value.toLowerCase()) {
      warn("value_not_lowercase", field, `${field} contains uppercase characters; it will be lowercased.`);
    }
  }

  // Platform preset & macros
  if (!ctx.preset) {
    err("unknown_preset", "presetKey", `Platform preset "${input.presetKey}" does not exist.`);
  } else {
    if (ctx.preset.verificationState === "draft") {
      warn(
        "preset_draft",
        "presetKey",
        `Preset "${ctx.preset.key}" is a draft and has not been verified against platform documentation.`,
      );
    }
    if (ctx.preset.verificationState === "deprecated") {
      err("preset_deprecated", "presetKey", `Preset "${ctx.preset.key}" is deprecated.`);
    }
    const macroFields: [string, string][] = [
      ["utm_content", input.utmContent ?? ""],
      ["utm_term", input.utmTerm ?? ""],
      ["utm_campaign", input.utmCampaign ?? ""],
      ["utm_source", input.utmSource ?? ""],
    ];
    for (const [field, value] of macroFields) {
      for (const match of value.matchAll(MACRO_RE)) {
        const macro = (match[2] ?? match[1] ?? "").trim();
        if (!macro) {
          err("malformed_macro", field, `${field} contains an empty macro placeholder.`);
        } else if (!ctx.preset.supportedMacros.includes(macro)) {
          err(
            "unsupported_macro",
            field,
            `Macro "{${macro}}" is not supported by preset "${ctx.preset.key}". Supported: ${
              ctx.preset.supportedMacros.length ? ctx.preset.supportedMacros.join(", ") : "none"
            }.`,
          );
        }
      }
    }
  }

  return { ok: !findings.some((f) => f.severity === "error"), findings };
}

/** Recommended-length warning computed on the final assembled URL. */
export function lengthWarning(finalUrl: string, recommendedMax: number): ValidationFinding | null {
  if (finalUrl.length > recommendedMax) {
    return {
      code: "url_length",
      severity: "warning",
      field: null,
      message: `Final URL is ${finalUrl.length} characters (recommended maximum ${recommendedMax}). Some channels truncate long URLs.`,
    };
  }
  return null;
}
