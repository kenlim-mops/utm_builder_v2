/**
 * Authoritative registry schema (PostgreSQL via Drizzle).
 *
 * Invariants enforced at the database layer:
 *  - Canonical IDs (rp*_ULID) are primary keys; no DB sequence IDs are exposed.
 *  - One HubSpot campaignGuid maps to at most one Runpod campaign
 *    (partial unique index on non-null mappings).
 *  - Exact duplicate links are blocked by a partial unique index on
 *    fingerprint for active, non-override links.
 *  - Outbox idempotency keys are unique.
 *  - Audit events are append-only (no update/delete paths in the app; see
 *    docs/admin-manual.md for DB-level hardening in production).
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------- users
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(), // rpu_<ULID>
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: text("role", { enum: ["user", "admin", "investigator"] })
      .notNull()
      .default("user"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

// ----------------------------------------------------------- initiatives
export const initiatives = pgTable(
  "initiatives",
  {
    id: text("id").primaryKey(), // rpi_<ULID>, immutable
    name: text("name").notNull(),
    ownerId: text("owner_id").references(() => users.id),
    product: text("product"),
    initiativeType: text("initiative_type"), // launch | gtm-motion | evergreen | other
    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),
    lifecycle: text("lifecycle", { enum: ["planned", "active", "completed", "archived"] })
      .notNull()
      .default("active"),
    description: text("description"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("initiatives_name_uq").on(t.name)],
);

// ------------------------------------------------------------- campaigns
export const campaigns = pgTable(
  "campaigns",
  {
    id: text("id").primaryKey(), // rpc_<ULID>, immutable, carried in utm_id
    name: text("name").notNull(), // human-readable display name
    utmCampaign: text("utm_campaign").notNull(), // canonical slug carried in utm_campaign
    initiativeId: text("initiative_id").references(() => initiatives.id),
    ownerId: text("owner_id").references(() => users.id),
    product: text("product"),
    campaignType: text("campaign_type"),
    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),
    lifecycle: text("lifecycle", { enum: ["planned", "active", "completed", "archived"] })
      .notNull()
      .default("active"),
    description: text("description"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("campaigns_utm_campaign_uq").on(t.utmCampaign),
    index("campaigns_initiative_idx").on(t.initiativeId),
  ],
);

// ----------------------------------------- external campaign mappings
export const externalCampaignMappings = pgTable(
  "external_campaign_mappings",
  {
    id: text("id").primaryKey(), // rpo-free: use rpx? keep generic ULID with rpe? -> use audit-safe text id
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    system: text("system").notNull(), // hubspot | google_ads | linkedin | meta | reddit | cm360 | warehouse
    externalType: text("external_type").notNull().default("campaign"), // campaign | ad_group | ad | placement | site | publisher
    externalId: text("external_id"), // e.g. HubSpot campaignGuid; null while sync pending
    externalName: text("external_name"),
    syncState: text("sync_state", {
      enum: ["pending", "syncing", "synced", "failed", "dead", "detached"],
    })
      .notNull()
      .default("pending"),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A given external identity (e.g. HubSpot campaignGuid) maps to exactly one campaign.
    uniqueIndex("ext_map_system_external_uq")
      .on(t.system, t.externalType, t.externalId)
      .where(sql`${t.externalId} is not null`),
    index("ext_map_campaign_idx").on(t.campaignId),
  ],
);

// ----------------------------------------------------------------- links
export const links = pgTable(
  "links",
  {
    id: text("id").primaryKey(), // rpl_<ULID>, immutable
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id),
    initiativeId: text("initiative_id").references(() => initiatives.id),
    batchId: text("batch_id"),
    destinationRaw: text("destination_raw").notNull(),
    destinationNormalized: text("destination_normalized").notNull(),
    finalUrl: text("final_url").notNull(),
    // Raw governed values retained verbatim for reporting repairability.
    utmId: text("utm_id").notNull(), // == campaignId, stored raw on purpose
    utmSource: text("utm_source").notNull(),
    utmMedium: text("utm_medium").notNull(),
    utmCampaign: text("utm_campaign").notNull(),
    utmContent: text("utm_content"),
    utmTerm: text("utm_term"),
    rpInitiativeIdParam: text("rp_initiative_id_param"), // value actually emitted on the URL (null when policy-disabled)
    rpLinkIdParam: text("rp_link_id_param"),
    platformPresetKey: text("platform_preset_key").notNull(),
    fingerprint: text("fingerprint").notNull(),
    nearFingerprint: text("near_fingerprint").notNull(),
    duplicateOverride: boolean("duplicate_override").notNull().default(false),
    status: text("status", { enum: ["draft", "issued", "retired"] })
      .notNull()
      .default("issued"),
    currentRevision: integer("current_revision").notNull().default(0),
    configVersion: integer("config_version").notNull(),
    validationState: text("validation_state", {
      enum: ["unvalidated", "passed_syntactic", "warnings", "failed"],
    })
      .notNull()
      .default("unvalidated"),
    createdBy: text("created_by").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Exact-duplicate protection: only one active non-override link per fingerprint.
    uniqueIndex("links_fingerprint_active_uq")
      .on(t.fingerprint)
      .where(sql`${t.status} <> 'retired' and ${t.duplicateOverride} = false`),
    index("links_campaign_idx").on(t.campaignId),
    index("links_initiative_idx").on(t.initiativeId),
    index("links_batch_idx").on(t.batchId),
    index("links_near_fp_idx").on(t.nearFingerprint),
    index("links_created_at_idx").on(t.createdAt),
  ],
);

// ------------------------------------------------------------- revisions
export const linkRevisions = pgTable(
  "link_revisions",
  {
    id: text("id").primaryKey(), // rpr_<ULID>
    linkId: text("link_id")
      .notNull()
      .references(() => links.id),
    revisionNumber: integer("revision_number").notNull(),
    snapshot: jsonb("snapshot").notNull(), // full link state at this revision
    diff: jsonb("diff"), // changed fields {field: {before, after}}
    reason: text("reason"),
    actorId: text("actor_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("link_rev_uq").on(t.linkId, t.revisionNumber)],
);

// --------------------------------------------------------------- batches
export const batches = pgTable("batches", {
  id: text("id").primaryKey(), // rpb_<ULID>
  createdBy: text("created_by").notNull(),
  rowCount: integer("row_count").notNull(),
  succeededCount: integer("succeeded_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  status: text("status", { enum: ["processing", "completed", "completed_with_errors"] })
    .notNull()
    .default("processing"),
  source: text("source", { enum: ["grid", "paste", "csv"] }).notNull().default("grid"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const batchRows = pgTable(
  "batch_rows",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id")
      .notNull()
      .references(() => batches.id),
    rowIndex: integer("row_index").notNull(),
    linkId: text("link_id").references(() => links.id),
    status: text("status", { enum: ["issued", "error", "skipped_duplicate"] }).notNull(),
    input: jsonb("input").notNull(),
    errors: jsonb("errors"),
  },
  (t) => [uniqueIndex("batch_rows_uq").on(t.batchId, t.rowIndex)],
);

// -------------------------------------------------------------- taxonomy
export const taxonomyMediums = pgTable(
  "taxonomy_mediums",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    status: text("status", { enum: ["active", "deprecated", "disabled"] })
      .notNull()
      .default("active"),
    sortOrder: integer("sort_order").notNull().default(0),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("taxonomy_mediums_slug_uq").on(t.slug)],
);

export const taxonomySources = pgTable(
  "taxonomy_sources",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    mediumSlug: text("medium_slug").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    aliases: jsonb("aliases").notNull().default([]), // string[] of accepted aliases
    status: text("status", { enum: ["active", "deprecated", "disabled"] })
      .notNull()
      .default("active"),
    severity: text("severity", { enum: ["info", "warning", "error"] })
      .notNull()
      .default("error"), // severity when a non-canonical value is used
    sortOrder: integer("sort_order").notNull().default(0),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("taxonomy_sources_slug_uq").on(t.slug)],
);

// -------------------------------------------------- destination policies
export const destinationPolicies = pgTable(
  "destination_policies",
  {
    id: text("id").primaryKey(),
    domain: text("domain").notNull(),
    kind: text("kind", { enum: ["approved", "exception"] }).notNull(),
    notes: text("notes"),
    status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("destination_policies_domain_uq").on(t.domain, t.kind)],
);

// ------------------------------------------------------ platform presets
export const platformPresets = pgTable(
  "platform_presets",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(), // generic | google_ads | linkedin | meta | reddit | cm360 | hubspot_email | event_qr
    name: text("name").notNull(),
    outputType: text("output_type").notNull(), // url | tracking_template | email_link | qr_target
    defaults: jsonb("defaults").notNull().default({}), // {utm_medium?, utm_source?}
    supportedMacros: jsonb("supported_macros").notNull().default([]), // string[]
    requiredFields: jsonb("required_fields").notNull().default([]), // string[]
    staticParams: jsonb("static_params").notNull().default({}), // extra identity-relevant params
    validationRules: jsonb("validation_rules").notNull().default({}),
    verificationState: text("verification_state", { enum: ["draft", "verified", "deprecated"] })
      .notNull()
      .default("draft"),
    docsUrl: text("docs_url"),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("platform_presets_key_uq").on(t.key)],
);

// ------------------------------------------------------- validation runs
export const validationRuns = pgTable(
  "validation_runs",
  {
    id: text("id").primaryKey(), // rpv_<ULID>
    linkId: text("link_id")
      .notNull()
      .references(() => links.id),
    kind: text("kind").notNull().default("syntactic"), // syntactic | http | render | tag (future)
    passed: boolean("passed").notNull(),
    findings: jsonb("findings").notNull(),
    evidence: jsonb("evidence"), // reserved for executed checks
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("validation_runs_link_idx").on(t.linkId)],
);

// -------------------------------------------------- duplicate resolutions
export const duplicateResolutions = pgTable("duplicate_resolutions", {
  id: text("id").primaryKey(),
  linkId: text("link_id"), // null when user chose reuse (no new link created)
  existingLinkId: text("existing_link_id").notNull(),
  action: text("action", { enum: ["reuse", "override"] }).notNull(),
  reason: text("reason"),
  actorId: text("actor_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ----------------------------------------------------------- audit events
export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(), // rpa_<ULID>, immutable
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
    actorId: text("actor_id").notNull(),
    actorEmail: text("actor_email").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    correlationId: text("correlation_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    configVersion: integer("config_version"),
    context: jsonb("context"),
  },
  (t) => [
    index("audit_entity_idx").on(t.entityType, t.entityId),
    index("audit_ts_idx").on(t.ts),
    index("audit_actor_idx").on(t.actorId),
  ],
);

// -------------------------------------------------------- outbox / sync
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: text("id").primaryKey(), // rpo_<ULID>
    type: text("type").notNull(), // hubspot.campaign.sync | warehouse.snapshot | ...
    payload: jsonb("payload").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status", { enum: ["pending", "processing", "succeeded", "failed", "dead"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(8),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("outbox_idempotency_uq").on(t.idempotencyKey),
    index("outbox_status_idx").on(t.status, t.nextAttemptAt),
  ],
);

export const syncAttempts = pgTable(
  "sync_attempts",
  {
    id: text("id").primaryKey(),
    outboxEventId: text("outbox_event_id")
      .notNull()
      .references(() => outboxEvents.id),
    attemptNumber: integer("attempt_number").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ok: boolean("ok"),
    error: text("error"),
  },
  (t) => [index("sync_attempts_event_idx").on(t.outboxEventId)],
);

// -------------------------------------------- warehouse registry snapshots
/**
 * Versioned registry snapshots the warehouse ingests to build conformed
 * campaign/initiative dimensions — reporting never joins live APIs.
 */
export const warehouseSnapshots = pgTable(
  "warehouse_snapshots",
  {
    id: text("id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    entityType: text("entity_type").notNull(), // campaign | link | initiative
    entityId: text("entity_id").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("warehouse_snapshots_key_uq").on(t.idempotencyKey),
    index("warehouse_snapshots_entity_idx").on(t.entityType, t.entityId),
  ],
);

// -------------------------------------------------------- reconciliation
export const reconciliationRuns = pgTable("reconciliation_runs", {
  id: text("id").primaryKey(), // rpx_<ULID>
  kind: text("kind").notNull(), // hubspot | warehouse | full
  triggeredBy: text("triggered_by").notNull(), // user id or "schedule"
  result: jsonb("result").notNull(),
  discrepancyCount: integer("discrepancy_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ------------------------------------------------- versioned app settings
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(), // e.g. public_param_policy, bulk_limit, required_fields
  value: jsonb("value").notNull(),
  version: integer("version").notNull().default(1),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Global configuration version counter (bumped on every admin config change). */
export const configVersions = pgTable("config_versions", {
  id: integer("id").primaryKey(), // always row id=1
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
