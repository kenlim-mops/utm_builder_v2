/**
 * GTM Data MCP catalog services.
 *
 * These functions are shared by the admin UI, HTTP APIs, scheduled source
 * reconciliation, and MCP tools. The MCP is an access layer over this governed
 * catalog; it is not a second data store.
 */
import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { parseCsv, toCsv } from "@/core/csv";
import { prefixedUlid } from "@/core/ids";
import type { Db } from "@/db/client";
import {
  gtmBulkTemplates,
  gtmCatalogRecords,
  gtmCatalogRelationships,
  gtmChangeProposals,
  gtmSourceConnectors,
  gtmSourceRecords,
  gtmSourceSyncRuns,
} from "@/db/schema";
import { recordAudit } from "./audit";
import type { SessionUser } from "./auth";

export const GTM_RECORD_TYPES = [
  "person",
  "team",
  "agency",
  "vendor",
  "system",
  "account",
  "integration",
  "data_term",
  "data_field",
  "measurement_asset",
  "runbook",
  "policy",
  "report",
] as const;

export type GtmRecordType = (typeof GTM_RECORD_TYPES)[number];
type CatalogRow = typeof gtmCatalogRecords.$inferSelect;
type CatalogInput = {
  id?: string;
  recordType: GtmRecordType;
  key: string;
  name: string;
  summary?: string | null;
  attributes?: Record<string, unknown>;
  sensitivity?: "internal" | "restricted";
  lifecycle?: "draft" | "active" | "inactive" | "deprecated";
  verificationState?: "unverified" | "verified" | "stale" | "conflict";
  lastVerifiedAt?: Date | string | null;
  sourceUrl?: string | null;
  sourceUpdatedAt?: Date | string | null;
};

function dateOrNull(value: Date | string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date value.");
  return date;
}

function cleanKey(value: string) {
  const key = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!key) throw new Error("A catalog key is required.");
  return key;
}

function canReadRestricted(actor?: SessionUser) {
  return !actor || actor.role === "admin" || actor.role === "investigator";
}

export async function searchCatalog(
  db: Db,
  input: {
    query?: string;
    recordTypes?: GtmRecordType[];
    lifecycle?: CatalogRow["lifecycle"];
    verificationState?: CatalogRow["verificationState"];
    limit?: number;
  } = {},
  actor?: SessionUser,
) {
  const conditions = [];
  if (!canReadRestricted(actor)) conditions.push(ne(gtmCatalogRecords.sensitivity, "restricted"));
  if (input.recordTypes?.length) conditions.push(inArray(gtmCatalogRecords.recordType, input.recordTypes));
  if (input.lifecycle) conditions.push(eq(gtmCatalogRecords.lifecycle, input.lifecycle));
  if (input.verificationState) {
    conditions.push(eq(gtmCatalogRecords.verificationState, input.verificationState));
  }
  const query = input.query?.trim();
  if (query) {
    const pattern = `%${query}%`;
    conditions.push(
      or(
        ilike(gtmCatalogRecords.name, pattern),
        ilike(gtmCatalogRecords.key, pattern),
        ilike(gtmCatalogRecords.summary, pattern),
        sql`${gtmCatalogRecords.attributes}::text ilike ${pattern}`,
      )!,
    );
  }
  return db
    .select()
    .from(gtmCatalogRecords)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(gtmCatalogRecords.recordType), asc(gtmCatalogRecords.name))
    .limit(Math.min(Math.max(input.limit ?? 50, 1), 200));
}

export async function getCatalogRecord(
  db: Db,
  selector: { id?: string; key?: string; recordType?: GtmRecordType },
  actor?: SessionUser,
) {
  const conditions = [];
  if (selector.id) conditions.push(eq(gtmCatalogRecords.id, selector.id));
  if (selector.key) conditions.push(eq(gtmCatalogRecords.key, cleanKey(selector.key)));
  if (selector.recordType) conditions.push(eq(gtmCatalogRecords.recordType, selector.recordType));
  if (!conditions.length) throw new Error("A record id or key is required.");
  if (!canReadRestricted(actor)) conditions.push(ne(gtmCatalogRecords.sensitivity, "restricted"));
  const [record] = await db.select().from(gtmCatalogRecords).where(and(...conditions)).limit(1);
  if (!record) throw new Error("GTM catalog record not found.");
  const relationships = await listRelationships(db, record.id, actor);
  return { record, relationships };
}

export async function upsertCatalogRecord(
  db: Db,
  actor: SessionUser,
  input: CatalogInput,
  reason: string | null = null,
) {
  if (!GTM_RECORD_TYPES.includes(input.recordType)) throw new Error("Unsupported GTM record type.");
  const key = cleanKey(input.key);
  if (!input.name?.trim()) throw new Error("Record name is required.");
  return db.transaction(async (tx) => {
    const [before] = input.id
      ? await tx.select().from(gtmCatalogRecords).where(eq(gtmCatalogRecords.id, input.id)).limit(1)
      : await tx
          .select()
          .from(gtmCatalogRecords)
          .where(and(eq(gtmCatalogRecords.recordType, input.recordType), eq(gtmCatalogRecords.key, key)))
          .limit(1);
    let row: CatalogRow;
    if (before) {
      [row] = await tx
        .update(gtmCatalogRecords)
        .set({
          recordType: input.recordType,
          key,
          name: input.name.trim(),
          summary: input.summary !== undefined ? input.summary?.trim() || null : before.summary,
          attributes: input.attributes ?? (before.attributes as Record<string, unknown>),
          sensitivity: input.sensitivity ?? before.sensitivity,
          lifecycle: input.lifecycle ?? before.lifecycle,
          verificationState: input.verificationState ?? before.verificationState,
          lastVerifiedAt: dateOrNull(input.lastVerifiedAt) ?? before.lastVerifiedAt,
          sourceUrl: input.sourceUrl !== undefined ? input.sourceUrl : before.sourceUrl,
          sourceUpdatedAt: dateOrNull(input.sourceUpdatedAt) ?? before.sourceUpdatedAt,
          updatedBy: actor.id,
          updatedAt: new Date(),
          version: sql`${gtmCatalogRecords.version} + 1`,
        })
        .where(eq(gtmCatalogRecords.id, before.id))
        .returning();
    } else {
      [row] = await tx
        .insert(gtmCatalogRecords)
        .values({
          id: input.id ?? prefixedUlid("gdr"),
          recordType: input.recordType,
          key,
          name: input.name.trim(),
          summary: input.summary?.trim() || null,
          attributes: input.attributes ?? {},
          sensitivity: input.sensitivity ?? "internal",
          lifecycle: input.lifecycle ?? "active",
          verificationState: input.verificationState ?? "unverified",
          lastVerifiedAt: dateOrNull(input.lastVerifiedAt) ?? null,
          sourceUrl: input.sourceUrl ?? null,
          sourceUpdatedAt: dateOrNull(input.sourceUpdatedAt) ?? null,
          createdBy: actor.id,
          updatedBy: actor.id,
        })
        .returning();
    }
    await recordAudit(tx, actor, {
      action: before ? "gtm_catalog.updated" : "gtm_catalog.created",
      entityType: "gtm_catalog_record",
      entityId: row.id,
      before,
      after: row,
      reason,
    });
    return row;
  });
}

export async function upsertRelationship(
  db: Db,
  actor: SessionUser,
  input: {
    fromRecordId: string;
    toRecordId: string;
    relationshipType: string;
    isPrimary?: boolean;
    context?: Record<string, unknown>;
    status?: "active" | "inactive";
    startsAt?: string | Date | null;
    endsAt?: string | Date | null;
  },
  reason: string | null = null,
) {
  if (input.fromRecordId === input.toRecordId) throw new Error("A record cannot relate to itself.");
  const relationshipType = cleanKey(input.relationshipType);
  return db.transaction(async (tx) => {
    const records = await tx
      .select({ id: gtmCatalogRecords.id })
      .from(gtmCatalogRecords)
      .where(inArray(gtmCatalogRecords.id, [input.fromRecordId, input.toRecordId]));
    if (records.length !== 2) throw new Error("Both relationship records must exist.");
    const [before] = await tx
      .select()
      .from(gtmCatalogRelationships)
      .where(
        and(
          eq(gtmCatalogRelationships.fromRecordId, input.fromRecordId),
          eq(gtmCatalogRelationships.toRecordId, input.toRecordId),
          eq(gtmCatalogRelationships.relationshipType, relationshipType),
        ),
      )
      .limit(1);
    const [row] = before
      ? await tx
          .update(gtmCatalogRelationships)
          .set({
            isPrimary: input.isPrimary ?? before.isPrimary,
            context: input.context ?? (before.context as Record<string, unknown>),
            status: input.status ?? before.status,
            startsAt: dateOrNull(input.startsAt) ?? before.startsAt,
            endsAt: dateOrNull(input.endsAt) ?? before.endsAt,
          })
          .where(eq(gtmCatalogRelationships.id, before.id))
          .returning()
      : await tx
          .insert(gtmCatalogRelationships)
          .values({
            id: prefixedUlid("gre"),
            fromRecordId: input.fromRecordId,
            toRecordId: input.toRecordId,
            relationshipType,
            isPrimary: input.isPrimary ?? false,
            context: input.context ?? {},
            status: input.status ?? "active",
            startsAt: dateOrNull(input.startsAt) ?? null,
            endsAt: dateOrNull(input.endsAt) ?? null,
            createdBy: actor.id,
          })
          .returning();
    await recordAudit(tx, actor, {
      action: before ? "gtm_relationship.updated" : "gtm_relationship.created",
      entityType: "gtm_catalog_relationship",
      entityId: row.id,
      before,
      after: row,
      reason,
    });
    return row;
  });
}

export async function listRelationships(db: Db, recordId: string, actor?: SessionUser) {
  const edges = await db
    .select()
    .from(gtmCatalogRelationships)
    .where(
      and(
        or(
          eq(gtmCatalogRelationships.fromRecordId, recordId),
          eq(gtmCatalogRelationships.toRecordId, recordId),
        ),
        eq(gtmCatalogRelationships.status, "active"),
      ),
    )
    .orderBy(asc(gtmCatalogRelationships.relationshipType));
  const ids = [...new Set(edges.flatMap((edge) => [edge.fromRecordId, edge.toRecordId]))];
  const records = ids.length
    ? await db.select().from(gtmCatalogRecords).where(inArray(gtmCatalogRecords.id, ids))
    : [];
  const readable = new Map(
    records
      .filter((record) => canReadRestricted(actor) || record.sensitivity !== "restricted")
      .map((record) => [record.id, record]),
  );
  return edges
    .filter((edge) => readable.has(edge.fromRecordId) && readable.has(edge.toRecordId))
    .map((edge) => ({ edge, from: readable.get(edge.fromRecordId)!, to: readable.get(edge.toRecordId)! }));
}

const OWNERSHIP_RELATIONSHIPS = new Set([
  "owns",
  "operates",
  "approves",
  "backup_for",
  "member_of",
  "agency_for",
  "vendor_for",
  "escalates_to",
]);

export async function resolveOwnership(
  db: Db,
  input: { recordId?: string; query?: string },
  actor?: SessionUser,
) {
  let target: CatalogRow;
  if (input.recordId) {
    target = (await getCatalogRecord(db, { id: input.recordId }, actor)).record;
  } else {
    const matches = await searchCatalog(db, { query: input.query, limit: 10 }, actor);
    if (matches.length !== 1) return { matches, ownership: [] };
    target = matches[0];
  }
  const relationships = await listRelationships(db, target.id, actor);
  return {
    target,
    ownership: relationships.filter(({ edge }) => OWNERSHIP_RELATIONSHIPS.has(edge.relationshipType)),
  };
}

export async function traceLineage(
  db: Db,
  recordId: string,
  direction: "upstream" | "downstream" | "both" = "both",
  depth = 2,
  actor?: SessionUser,
) {
  const maxDepth = Math.min(Math.max(depth, 1), 4);
  await getCatalogRecord(db, { id: recordId }, actor);
  const seen = new Set([recordId]);
  let frontier = [recordId];
  const levels: Array<{ depth: number; relationships: Awaited<ReturnType<typeof listRelationships>> }> = [];
  for (let level = 1; level <= maxDepth && frontier.length; level++) {
    const gathered = (await Promise.all(frontier.map((id) => listRelationships(db, id, actor)))).flat();
    const filtered = gathered.filter(({ edge }) => {
      if (direction === "both") return true;
      if (direction === "downstream") return frontier.includes(edge.fromRecordId);
      return frontier.includes(edge.toRecordId);
    });
    const unique = [...new Map(filtered.map((rel) => [rel.edge.id, rel])).values()];
    levels.push({ depth: level, relationships: unique });
    const next: string[] = [];
    for (const { edge } of unique) {
      for (const id of [edge.fromRecordId, edge.toRecordId]) {
        if (!seen.has(id)) {
          seen.add(id);
          next.push(id);
        }
      }
    }
    frontier = next;
  }
  return { rootRecordId: recordId, direction, levels };
}

export async function checkReadiness(db: Db, recordId: string, actor?: SessionUser) {
  const { record, relationships } = await getCatalogRecord(db, { id: recordId }, actor);
  const findings: Array<{ severity: "error" | "warning" | "info"; code: string; message: string }> = [];
  if (record.lifecycle !== "active") {
    findings.push({ severity: "warning", code: "not_active", message: `Lifecycle is ${record.lifecycle}.` });
  }
  if (record.verificationState !== "verified") {
    findings.push({ severity: "warning", code: "not_verified", message: `Verification is ${record.verificationState}.` });
  }
  if (!relationships.some(({ edge }) => ["owns", "operates"].includes(edge.relationshipType))) {
    findings.push({ severity: "error", code: "owner_missing", message: "No active owner or operator is mapped." });
  }
  if (!relationships.some(({ edge, from, to }) => edge.relationshipType === "documented_by" || from.recordType === "runbook" || to.recordType === "runbook")) {
    findings.push({ severity: "warning", code: "runbook_missing", message: "No runbook is linked." });
  }
  const pending = await db
    .select({ id: gtmChangeProposals.id })
    .from(gtmChangeProposals)
    .where(and(eq(gtmChangeProposals.internalRecordId, record.id), eq(gtmChangeProposals.status, "pending")));
  if (pending.length) {
    findings.push({ severity: "warning", code: "pending_source_updates", message: `${pending.length} source update(s) await review.` });
  }
  return { record, ready: !findings.some((f) => f.severity === "error"), findings };
}

// -------------------------------------------------------------- templates

export type BulkTemplateColumn = {
  key: string;
  label?: string;
  required?: boolean;
  description?: string;
  allowedValues?: string[];
};

export async function listBulkTemplates(
  db: Db,
  input: { platformKey?: string; operation?: string; lifecycle?: "active" | "inactive" | "deprecated" } = {},
) {
  const conditions = [];
  if (input.platformKey) conditions.push(eq(gtmBulkTemplates.platformKey, input.platformKey));
  if (input.operation) conditions.push(eq(gtmBulkTemplates.operation, input.operation));
  conditions.push(eq(gtmBulkTemplates.lifecycle, input.lifecycle ?? "active"));
  return db
    .select()
    .from(gtmBulkTemplates)
    .where(and(...conditions))
    .orderBy(asc(gtmBulkTemplates.platformKey), asc(gtmBulkTemplates.name));
}

export async function getBulkTemplate(db: Db, key: string) {
  const [template] = await db
    .select()
    .from(gtmBulkTemplates)
    .where(eq(gtmBulkTemplates.key, cleanKey(key)))
    .limit(1);
  if (!template) throw new Error("Bulk template not found.");
  return template;
}

export async function generateBulkTemplate(db: Db, key: string) {
  const template = await getBulkTemplate(db, key);
  const columns = template.columns as BulkTemplateColumn[];
  const exampleRows = (template.examples as Record<string, unknown>[]).map((example) =>
    columns.map((column) => String(example[column.key] ?? "")),
  );
  const csv = toCsv([
    columns.map((column) => column.label ?? column.key),
    ...exampleRows,
  ]);
  return { template, csv };
}

export async function validateBulkChange(db: Db, key: string, csv: string) {
  const template = await getBulkTemplate(db, key);
  const columns = template.columns as BulkTemplateColumn[];
  const rows = parseCsv(csv);
  if (!rows.length) throw new Error("CSV is empty.");
  const headers = rows[0].map((header) => header.trim());
  const expected = new Map(columns.map((column) => [column.label ?? column.key, column]));
  const findings: Array<{ row: number; column: string | null; severity: "error" | "warning"; message: string }> = [];
  for (const column of columns.filter((item) => item.required)) {
    const label = column.label ?? column.key;
    if (!headers.includes(label)) findings.push({ row: 1, column: label, severity: "error", message: "Required column is missing." });
  }
  headers.forEach((header) => {
    if (!expected.has(header)) findings.push({ row: 1, column: header, severity: "warning", message: "Column is not defined by this template." });
  });
  rows.slice(1).forEach((row, index) => {
    columns.forEach((column) => {
      const label = column.label ?? column.key;
      const position = headers.indexOf(label);
      const value = position >= 0 ? (row[position] ?? "").trim() : "";
      if (column.required && !value) findings.push({ row: index + 2, column: label, severity: "error", message: "Required value is missing." });
      if (value && column.allowedValues?.length && !column.allowedValues.includes(value)) {
        findings.push({ row: index + 2, column: label, severity: "error", message: `Value must be one of: ${column.allowedValues.join(", ")}.` });
      }
    });
  });
  const rowLimit = template.maxRows;
  if (rowLimit && rows.length - 1 > rowLimit) {
    findings.push({ row: 1, column: null, severity: "error", message: `Template permits at most ${rowLimit} data rows.` });
  }
  return { templateKey: template.key, rowCount: Math.max(rows.length - 1, 0), valid: !findings.some((finding) => finding.severity === "error"), findings };
}

export async function upsertBulkTemplate(
  db: Db,
  actor: SessionUser,
  input: Omit<typeof gtmBulkTemplates.$inferInsert, "id" | "createdBy" | "updatedBy" | "createdAt" | "updatedAt" | "version"> & { id?: string },
  reason: string | null = null,
) {
  const key = cleanKey(input.key);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(gtmBulkTemplates).where(eq(gtmBulkTemplates.key, key)).limit(1);
    const values = {
      key,
      name: input.name,
      platformKey: input.platformKey,
      objectType: input.objectType,
      operation: input.operation,
      format: input.format ?? "csv" as const,
      columns: input.columns ?? [],
      defaults: input.defaults ?? {},
      validations: input.validations ?? {},
      examples: input.examples ?? [],
      maxRows: input.maxRows ?? null,
      availabilityNotes: input.availabilityNotes ?? null,
      docsUrl: input.docsUrl ?? null,
      verificationState: input.verificationState ?? "draft" as const,
      lifecycle: input.lifecycle ?? "active" as const,
      updatedBy: actor.id,
      updatedAt: new Date(),
    };
    const [row] = before
      ? await tx
          .update(gtmBulkTemplates)
          .set({ ...values, version: sql`${gtmBulkTemplates.version} + 1` })
          .where(eq(gtmBulkTemplates.id, before.id))
          .returning()
      : await tx
          .insert(gtmBulkTemplates)
          .values({ ...values, id: input.id ?? prefixedUlid("gbt"), createdBy: actor.id })
          .returning();
    await recordAudit(tx, actor, { action: before ? "gtm_bulk_template.updated" : "gtm_bulk_template.created", entityType: "gtm_bulk_template", entityId: row.id, before, after: row, reason });
    return row;
  });
}

// --------------------------------------------------------- sync administration

export async function listSourceConnectors(db: Db) {
  return db.select().from(gtmSourceConnectors).orderBy(asc(gtmSourceConnectors.name));
}

export async function upsertSourceConnector(
  db: Db,
  actor: SessionUser,
  input: {
    id?: string;
    key: string;
    name: string;
    sourceType: "notion" | "api" | "manual";
    mode?: "poll" | "webhook" | "hybrid";
    status?: "active" | "paused" | "error";
    config?: Record<string, unknown>;
    credentialRef?: string | null;
    authoritativeFields?: string[];
    autoApply?: boolean;
    scheduleMinutes?: number;
  },
  reason: string | null = null,
) {
  const key = cleanKey(input.key);
  if (!input.name.trim()) throw new Error("Connector name is required.");
  if (input.autoApply && !(input.authoritativeFields?.length)) {
    throw new Error("Auto-apply requires an explicit authoritative field allowlist.");
  }
  const minutes = Math.min(Math.max(input.scheduleMinutes ?? 60, 5), 10_080);
  return db.transaction(async (tx) => {
    const [before] = input.id
      ? await tx.select().from(gtmSourceConnectors).where(eq(gtmSourceConnectors.id, input.id)).limit(1)
      : await tx.select().from(gtmSourceConnectors).where(eq(gtmSourceConnectors.key, key)).limit(1);
    const values = {
      key,
      name: input.name.trim(),
      sourceType: input.sourceType,
      mode: input.mode ?? before?.mode ?? "poll" as const,
      status: input.status ?? before?.status ?? "paused" as const,
      config: input.config ?? (before?.config as Record<string, unknown> | undefined) ?? {},
      credentialRef: input.credentialRef !== undefined ? input.credentialRef : before?.credentialRef ?? null,
      authoritativeFields: input.authoritativeFields ?? (before?.authoritativeFields as string[] | undefined) ?? [],
      autoApply: input.autoApply ?? before?.autoApply ?? false,
      scheduleMinutes: minutes,
      updatedBy: actor.id,
      updatedAt: new Date(),
    };
    const [row] = before
      ? await tx.update(gtmSourceConnectors).set(values).where(eq(gtmSourceConnectors.id, before.id)).returning()
      : await tx.insert(gtmSourceConnectors).values({ ...values, id: input.id ?? prefixedUlid("gsc"), createdBy: actor.id }).returning();
    await recordAudit(tx, actor, { action: before ? "gtm_connector.updated" : "gtm_connector.created", entityType: "gtm_source_connector", entityId: row.id, before, after: row, reason });
    return row;
  });
}

export async function listSourceUpdates(
  db: Db,
  input: { status?: typeof gtmChangeProposals.$inferSelect.status; connectorId?: string; limit?: number } = {},
) {
  const conditions = [];
  if (input.status) conditions.push(eq(gtmChangeProposals.status, input.status));
  if (input.connectorId) conditions.push(eq(gtmChangeProposals.connectorId, input.connectorId));
  return db
    .select({ proposal: gtmChangeProposals, connector: gtmSourceConnectors, source: gtmSourceRecords })
    .from(gtmChangeProposals)
    .innerJoin(gtmSourceConnectors, eq(gtmChangeProposals.connectorId, gtmSourceConnectors.id))
    .innerJoin(gtmSourceRecords, eq(gtmChangeProposals.sourceRecordId, gtmSourceRecords.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(gtmChangeProposals.createdAt))
    .limit(Math.min(Math.max(input.limit ?? 100, 1), 500));
}

export async function listSourceSyncRuns(db: Db, connectorId?: string, limit = 50) {
  return db
    .select()
    .from(gtmSourceSyncRuns)
    .where(connectorId ? eq(gtmSourceSyncRuns.connectorId, connectorId) : undefined)
    .orderBy(desc(gtmSourceSyncRuns.startedAt))
    .limit(Math.min(Math.max(limit, 1), 200));
}

function proposalRecord(after: unknown): CatalogInput {
  const value = after as Partial<CatalogInput>;
  if (!value.recordType || !value.key || !value.name) throw new Error("Proposal does not contain a valid catalog record.");
  return value as CatalogInput;
}

export async function decideSourceUpdate(
  db: Db,
  actor: SessionUser,
  proposalId: string,
  decision: "approve" | "reject",
  reason: string,
) {
  if (!reason.trim()) throw new Error("A review reason is required.");
  return db.transaction(async (tx) => {
    const [proposal] = await tx.select().from(gtmChangeProposals).where(eq(gtmChangeProposals.id, proposalId)).limit(1);
    if (!proposal) throw new Error("Source update proposal not found.");
    if (proposal.status !== "pending" && proposal.status !== "approved") throw new Error(`Proposal is already ${proposal.status}.`);
    const now = new Date();
    if (decision === "reject") {
      const [row] = await tx
        .update(gtmChangeProposals)
        .set({ status: "rejected", reason: reason.trim(), decidedBy: actor.id, decidedAt: now, updatedAt: now })
        .where(eq(gtmChangeProposals.id, proposal.id))
        .returning();
      await tx.update(gtmSourceRecords).set({ status: "ignored" }).where(eq(gtmSourceRecords.id, proposal.sourceRecordId));
      await recordAudit(tx, actor, { action: "gtm_source_update.rejected", entityType: "gtm_change_proposal", entityId: proposal.id, before: proposal, after: row, reason });
      return { proposal: row, record: null };
    }

    const data = proposalRecord(proposal.after);
    let record: CatalogRow;
    if (proposal.proposalType === "create") {
      record = await upsertCatalogRecord(tx as Db, actor, data, reason);
    } else {
      if (!proposal.internalRecordId) throw new Error("Update proposal is missing an internal record id.");
      const [current] = await tx.select().from(gtmCatalogRecords).where(eq(gtmCatalogRecords.id, proposal.internalRecordId)).limit(1);
      if (!current) throw new Error("Target catalog record no longer exists.");
      const expectedVersion = (proposal.before as { version?: number } | null)?.version;
      if (expectedVersion && current.version !== expectedVersion) {
        await tx.update(gtmChangeProposals).set({ status: "superseded", reason: "The catalog record changed after this proposal was created.", updatedAt: now }).where(eq(gtmChangeProposals.id, proposal.id));
        await tx.update(gtmSourceRecords).set({ status: "conflict" }).where(eq(gtmSourceRecords.id, proposal.sourceRecordId));
        throw new Error("The catalog record changed after this proposal was created; rescan before applying.");
      }
      record = proposal.proposalType === "delete"
        ? await upsertCatalogRecord(tx as Db, actor, { ...data, id: current.id, lifecycle: "inactive" }, reason)
        : await upsertCatalogRecord(tx as Db, actor, { ...data, id: current.id }, reason);
    }
    const [row] = await tx
      .update(gtmChangeProposals)
      .set({ status: "applied", reason: reason.trim(), decidedBy: actor.id, decidedAt: now, appliedAt: now, internalRecordId: record.id, updatedAt: now })
      .where(eq(gtmChangeProposals.id, proposal.id))
      .returning();
    await tx.update(gtmSourceRecords).set({ status: "current", internalRecordId: record.id }).where(eq(gtmSourceRecords.id, proposal.sourceRecordId));
    await recordAudit(tx, actor, { action: "gtm_source_update.applied", entityType: "gtm_change_proposal", entityId: proposal.id, before: proposal, after: row, reason });
    return { proposal: row, record };
  });
}
