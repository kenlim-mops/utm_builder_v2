/**
 * Idempotent seed: initial taxonomy, platform presets, destination policy,
 * app settings, config version, and local-development identities.
 *
 * Everything seeded here is editable in /admin afterwards — none of it is
 * hard-coded into UI or generation logic.
 */
import { newId, prefixedUlid } from "@/core/ids";
import type { Db } from "./client";
import {
  appSettings,
  configVersions,
  destinationPolicies,
  platformPresets,
  taxonomyMediums,
  taxonomySources,
  users,
} from "./schema";

const TAXONOMY: Record<string, string[]> = {
  paid: [
    "google-ads",
    "bing-ads",
    "linkedin-paid",
    "twitter-paid",
    "reddit-paid",
    "facebook-paid",
    "google-display",
    "programmatic",
    "partner-sponsored",
  ],
  organic: [
    "linkedin-organic",
    "twitter-organic",
    "reddit-organic",
    "github",
    "blog",
    "youtube",
    "documentation",
  ],
  email: ["hubspot-email", "transactional-email", "sales-email", "product-email"],
  referral: [
    "hackernews",
    "producthunt",
    "discord-community",
    "techcrunch",
    "venturebeat",
    "medium",
    "partner-referral",
    "integration",
  ],
  event: ["conference", "webinar", "virtual-conference", "hackathon"],
  program: ["nvidia-startup-program", "microsoft-startups", "aws-activate", "yc-startup-school"],
  product: ["console-banner", "dashboard-widget", "usage-threshold"],
  support: ["support-portal", "intercom-bot"],
};

// Aliases preserved for known rename churn (notably Meta/Facebook/Instagram).
const SOURCE_ALIASES: Record<string, string[]> = {
  "facebook-paid": ["meta-paid", "instagram-paid", "fb-paid", "meta"],
  "twitter-paid": ["x-paid"],
  "twitter-organic": ["x-organic"],
};

interface PresetSeed {
  key: string;
  name: string;
  outputType: string;
  defaults: Record<string, string>;
  supportedMacros: string[];
  requiredFields: string[];
  verificationState: "draft" | "verified";
  docsUrl: string | null;
}

const PRESETS: PresetSeed[] = [
  {
    key: "generic",
    name: "Generic URL",
    outputType: "url",
    defaults: {},
    supportedMacros: [],
    requiredFields: [],
    verificationState: "verified",
    docsUrl: null,
  },
  {
    key: "google_ads",
    name: "Google Ads",
    outputType: "url",
    defaults: { utm_medium: "paid", utm_source: "google-ads" },
    supportedMacros: ["keyword", "creative", "matchtype", "device", "adgroupid", "campaignid", "gclid"],
    requiredFields: ["utm_content"],
    verificationState: "draft",
    docsUrl: "https://support.google.com/google-ads/answer/6305348",
  },
  {
    key: "linkedin",
    name: "LinkedIn Ads",
    outputType: "url",
    defaults: { utm_medium: "paid", utm_source: "linkedin-paid" },
    supportedMacros: [],
    requiredFields: ["utm_content"],
    verificationState: "draft",
    docsUrl: "https://www.linkedin.com/help/lms/answer/a418880",
  },
  {
    key: "meta",
    name: "Meta Ads",
    outputType: "url",
    defaults: { utm_medium: "paid", utm_source: "facebook-paid" },
    supportedMacros: ["ad.id", "adset.id", "campaign.id", "ad.name", "adset.name", "campaign.name", "placement", "site_source_name"],
    requiredFields: ["utm_content"],
    verificationState: "draft",
    docsUrl: "https://www.facebook.com/business/help/2360940870872492",
  },
  {
    key: "reddit",
    name: "Reddit Ads",
    outputType: "url",
    defaults: { utm_medium: "paid", utm_source: "reddit-paid" },
    supportedMacros: [],
    requiredFields: [],
    verificationState: "draft",
    docsUrl: "https://business.reddithelp.com/",
  },
  {
    key: "cm360",
    name: "Campaign Manager 360",
    outputType: "tracking_template",
    defaults: { utm_medium: "paid", utm_source: "programmatic" },
    supportedMacros: ["%epid!", "%esid!", "%ecid!", "%eaid!", "%ebuy!"],
    requiredFields: [],
    verificationState: "draft",
    docsUrl: "https://support.google.com/campaignmanager/",
  },
  {
    key: "hubspot_email",
    name: "HubSpot / Email",
    outputType: "email_link",
    defaults: { utm_medium: "email", utm_source: "hubspot-email" },
    supportedMacros: [],
    requiredFields: ["utm_content"],
    verificationState: "draft",
    docsUrl: "https://knowledge.hubspot.com/",
  },
  {
    key: "event_qr",
    name: "Event / QR code",
    outputType: "qr_target",
    defaults: { utm_medium: "event" },
    supportedMacros: [],
    requiredFields: [],
    verificationState: "verified",
    docsUrl: null,
  },
];

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  // Administrator-controlled public inclusion of generated identifiers.
  public_param_policy: { rp_link_id: true, rp_initiative_id: false },
  bulk_limit: 200,
  required_fields: [], // extra required link fields, e.g. ["utm_content"]
  duplicate_override_roles: ["admin"],
  recommended_max_url_length: 900,
  feature_flags: {},
};

export async function ensureSeed(db: Db): Promise<void> {
  const existing = await db.select().from(configVersions);
  if (existing.length > 0) return;

  await db.insert(configVersions).values({ id: 1, version: 1 });

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.insert(appSettings).values({ key, value, version: 1 });
  }

  let order = 0;
  for (const [medium, sources] of Object.entries(TAXONOMY)) {
    await db.insert(taxonomyMediums).values({
      id: prefixedUlid("med"),
      slug: medium,
      label: medium.charAt(0).toUpperCase() + medium.slice(1),
      sortOrder: order++,
    });
    let srcOrder = 0;
    for (const source of sources) {
      await db.insert(taxonomySources).values({
        id: prefixedUlid("src"),
        slug: source,
        mediumSlug: medium,
        label: source,
        aliases: SOURCE_ALIASES[source] ?? [],
        sortOrder: srcOrder++,
      });
    }
  }

  for (const preset of PRESETS) {
    await db.insert(platformPresets).values({
      id: prefixedUlid("pre"),
      key: preset.key,
      name: preset.name,
      outputType: preset.outputType,
      defaults: preset.defaults,
      supportedMacros: preset.supportedMacros,
      requiredFields: preset.requiredFields,
      staticParams: {},
      validationRules: {},
      verificationState: preset.verificationState,
      docsUrl: preset.docsUrl,
    });
  }

  await db.insert(destinationPolicies).values([
    { id: prefixedUlid("dst"), domain: "runpod.io", kind: "approved" },
    { id: prefixedUlid("dst"), domain: "runpod.ai", kind: "approved" },
    { id: prefixedUlid("dst"), domain: "docs.runpod.io", kind: "approved" },
  ]);

  // Local-development identities only; production uses the SSO provider.
  await db.insert(users).values([
    {
      id: newId("user"),
      email: "dev-admin@runpod.io",
      name: "Dev Admin",
      role: "admin",
    },
    {
      id: newId("user"),
      email: "dev-user@runpod.io",
      name: "Dev User",
      role: "user",
    },
    {
      id: newId("user"),
      email: "dev-investigator@runpod.io",
      name: "Dev Investigator",
      role: "investigator",
    },
  ]);
}
