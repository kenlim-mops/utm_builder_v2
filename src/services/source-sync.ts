/**
 * Periodic external-source reconciliation for the GTM Data MCP.
 *
 * Polling never blindly mirrors a source into the catalog. It records source
 * evidence, computes a field-level proposal, and defaults to human review.
 * Auto-apply is possible only for an administrator-defined field allowlist.
 */
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { prefixedUlid } from "@/core/ids";
import { stableRequestHash } from "@/core/tokens";
import type { Db } from "@/db/client";
import {
  gtmCatalogRecords,
  gtmChangeProposals,
  gtmSourceConnectors,
  gtmSourceRecords,
  gtmSourceSyncRuns,
} from "@/db/schema";
import type { SessionUser } from "./auth";
import { upsertCatalogRecord, type GtmRecordType } from "./gtm-data";

export type SourceCandidate = {
  externalId: string;
  recordType: GtmRecordType;
  key: string;
  name: string;
  summary: string | null;
  attributes: Record<string, unknown>;
  sensitivity: "internal" | "restricted";
  lifecycle: "draft" | "active" | "inactive" | "deprecated";
  sourceUrl: string | null;
  sourceUpdatedAt: Date | null;
};

export type SourceAdapterResult = {
  records: SourceCandidate[];
  checkpoint?: Record<string, unknown> | null;
  findings?: Array<{ severity: "info" | "warning"; message: string }>;
};

export type SourceAdapter = (
  connector: typeof gtmSourceConnectors.$inferSelect,
  options?: { since?: Date | null },
) => Promise<SourceAdapterResult>;

type NotionConfig = {
  dataSourceId: string;
  recordType: GtmRecordType;
  titleProperty?: string;
  keyProperty?: string;
  summaryProperty?: string;
  attributeMap?: Record<string, string>;
  sensitivity?: "internal" | "restricted";
  lifecycleProperty?: string;
};

function slug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function richTextText(value: unknown) {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const part = item as { plain_text?: string; text?: { content?: string } };
      return part.plain_text ?? part.text?.content ?? "";
    })
    .join("");
}

/** Normalize current Notion property objects into JSON-safe catalog values. */
export function notionPropertyValue(property: unknown): unknown {
  if (!property || typeof property !== "object") return null;
  const p = property as Record<string, unknown>;
  switch (p.type) {
    case "title": return richTextText(p.title);
    case "rich_text": return richTextText(p.rich_text);
    case "number": return p.number ?? null;
    case "checkbox": return Boolean(p.checkbox);
    case "url":
    case "email":
    case "phone_number": return p[p.type as string] ?? null;
    case "select": return (p.select as { name?: string } | null)?.name ?? null;
    case "status": return (p.status as { name?: string } | null)?.name ?? null;
    case "multi_select": return Array.isArray(p.multi_select)
      ? p.multi_select.map((item) => (item as { name?: string }).name).filter(Boolean)
      : [];
    case "date": {
      const value = p.date as { start?: string; end?: string | null; time_zone?: string | null } | null;
      return value ? { start: value.start ?? null, end: value.end ?? null, timeZone: value.time_zone ?? null } : null;
    }
    case "people": return Array.isArray(p.people)
      ? p.people.map((person) => {
          const item = person as { id?: string; name?: string; person?: { email?: string } };
          return { id: item.id ?? null, name: item.name ?? null, email: item.person?.email ?? null };
        })
      : [];
    case "relation": return Array.isArray(p.relation)
      ? p.relation.map((item) => (item as { id?: string }).id).filter(Boolean)
      : [];
    case "unique_id": {
      const value = p.unique_id as { prefix?: string | null; number?: number } | null;
      return value ? `${value.prefix ?? ""}${value.number ?? ""}` : null;
    }
    case "created_time": return p.created_time ?? null;
    case "last_edited_time": return p.last_edited_time ?? null;
    case "formula": {
      const formula = p.formula as Record<string, unknown> | null;
      if (!formula || typeof formula.type !== "string") return null;
      return formula[formula.type] ?? null;
    }
    case "rollup": return p.rollup ?? null;
    default: return null;
  }
}

function envCredential(ref: string | null) {
  // Explicit allowlist prevents a connector definition from becoming an
  // arbitrary environment-variable reader.
  if (!ref || !["env:NOTION_API_TOKEN", "NOTION_API_TOKEN"].includes(ref)) {
    throw new Error("Notion connector credentialRef must be env:NOTION_API_TOKEN.");
  }
  const token = process.env.NOTION_API_TOKEN;
  if (!token) throw new Error("NOTION_API_TOKEN is not configured.");
  return token;
}

export function createNotionAdapter(fetcher: typeof fetch = fetch): SourceAdapter {
  return async (connector, options) => {
    const config = connector.config as Partial<NotionConfig>;
    if (!config.dataSourceId || !config.recordType) {
      throw new Error("Notion connector requires dataSourceId and recordType.");
    }
    const token = envCredential(connector.credentialRef);
    const records: SourceCandidate[] = [];
    let cursor: string | null = null;
    do {
      const filter = options?.since
        ? { timestamp: "last_edited_time", last_edited_time: { after: options.since.toISOString() } }
        : undefined;
      const response = await fetcher(
        `https://api.notion.com/v1/data_sources/${encodeURIComponent(config.dataSourceId)}/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Notion-Version": "2026-03-11",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}), ...(filter ? { filter } : {}) }),
        },
      );
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Notion query failed (${response.status}): ${body.slice(0, 500)}`);
      }
      const page = await response.json() as {
        results?: Array<Record<string, unknown>>;
        has_more?: boolean;
        next_cursor?: string | null;
      };
      for (const raw of page.results ?? []) {
        if (raw.object !== "page" || typeof raw.id !== "string") continue;
        const properties = (raw.properties ?? {}) as Record<string, unknown>;
        const titleProperty = config.titleProperty ?? "Name";
        const name = String(notionPropertyValue(properties[titleProperty]) ?? "").trim();
        if (!name) continue;
        const rawKey = config.keyProperty
          ? String(notionPropertyValue(properties[config.keyProperty]) ?? "")
          : name;
        const attributes: Record<string, unknown> = {};
        for (const [sourceProperty, targetKey] of Object.entries(config.attributeMap ?? {})) {
          attributes[targetKey] = notionPropertyValue(properties[sourceProperty]);
        }
        const sourceUpdatedAt = typeof raw.last_edited_time === "string"
          ? new Date(raw.last_edited_time)
          : null;
        const lifecycleValue = config.lifecycleProperty
          ? String(notionPropertyValue(properties[config.lifecycleProperty]) ?? "active").toLowerCase()
          : "active";
        const lifecycle = ["draft", "active", "inactive", "deprecated"].includes(lifecycleValue)
          ? lifecycleValue as SourceCandidate["lifecycle"]
          : "active";
        records.push({
          externalId: raw.id,
          recordType: config.recordType,
          key: slug(rawKey) || slug(name) || raw.id.replace(/-/g, ""),
          name,
          summary: config.summaryProperty
            ? String(notionPropertyValue(properties[config.summaryProperty]) ?? "").trim() || null
            : null,
          attributes,
          sensitivity: config.sensitivity ?? "internal",
          lifecycle: raw.archived === true || raw.in_trash === true ? "inactive" : lifecycle,
          sourceUrl: typeof raw.url === "string" ? raw.url : null,
          sourceUpdatedAt: sourceUpdatedAt && !Number.isNaN(sourceUpdatedAt.getTime()) ? sourceUpdatedAt : null,
        });
      }
      cursor = page.has_more && page.next_cursor ? page.next_cursor : null;
    } while (cursor);
    return {
      records,
      checkpoint: { completedAt: new Date().toISOString(), source: "notion", dataSourceId: config.dataSourceId },
    };
  };
}

function canonicalPayload(candidate: SourceCandidate) {
  return {
    recordType: candidate.recordType,
    key: candidate.key,
    name: candidate.name,
    summary: candidate.summary,
    attributes: candidate.attributes,
    sensitivity: candidate.sensitivity,
    lifecycle: candidate.lifecycle,
    verificationState: "unverified" as const,
    sourceUrl: candidate.sourceUrl,
    sourceUpdatedAt: candidate.sourceUpdatedAt?.toISOString() ?? null,
  };
}

function comparableRecord(record: typeof gtmCatalogRecords.$inferSelect | null) {
  if (!record) return null;
  return {
    recordType: record.recordType,
    key: record.key,
    name: record.name,
    summary: record.summary,
    attributes: record.attributes,
    sensitivity: record.sensitivity,
    lifecycle: record.lifecycle,
    verificationState: record.verificationState,
    sourceUrl: record.sourceUrl,
    sourceUpdatedAt: record.sourceUpdatedAt?.toISOString() ?? null,
    version: record.version,
  };
}

function diffValues(before: Record<string, unknown> | null, after: Record<string, unknown>) {
  const diff: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of new Set([...Object.keys(before ?? {}), ...Object.keys(after)])) {
    if (key === "version") continue; // concurrency metadata, not source content
    const left = before?.[key];
    const right = after[key];
    if (stableRequestHash({ value: left }) !== stableRequestHash({ value: right })) {
      diff[key] = { before: left ?? null, after: right ?? null };
    }
  }
  return diff;
}

function syncActor(connector: typeof gtmSourceConnectors.$inferSelect): SessionUser {
  return { id: connector.id, email: "gtm-data-sync@runpod.internal", name: `GTM source sync: ${connector.name}`, role: "admin" };
}

async function acquireLock(db: Db, connectorId: string, owner: string) {
  const now = new Date();
  const [connector] = await db
    .update(gtmSourceConnectors)
    .set({ lockOwner: owner, lockExpiresAt: new Date(now.getTime() + 10 * 60_000), lastStartedAt: now, updatedAt: now })
    .where(
      and(
        eq(gtmSourceConnectors.id, connectorId),
        or(isNull(gtmSourceConnectors.lockExpiresAt), lt(gtmSourceConnectors.lockExpiresAt, now)),
      ),
    )
    .returning();
  return connector ?? null;
}

async function releaseLock(db: Db, connectorId: string, owner: string, values: { success: boolean; checkpoint?: Record<string, unknown> | null; error?: string | null }) {
  await db
    .update(gtmSourceConnectors)
    .set({
      lockOwner: null,
      lockExpiresAt: null,
      lastSucceededAt: values.success ? new Date() : undefined,
      lastError: values.error ?? null,
      checkpoint: values.checkpoint ?? undefined,
      updatedAt: new Date(),
    })
    .where(and(eq(gtmSourceConnectors.id, connectorId), eq(gtmSourceConnectors.lockOwner, owner)));
}

export async function syncSourceConnector(
  db: Db,
  connectorId: string,
  trigger: "schedule" | "manual" | "webhook" = "manual",
  adapterOverride?: SourceAdapter,
) {
  const lockOwner = prefixedUlid("lock");
  const connector = await acquireLock(db, connectorId, lockOwner);
  if (!connector) return { skipped: true, reason: "Connector is already running or does not exist." };
  const [run] = await db
    .insert(gtmSourceSyncRuns)
    .values({ id: prefixedUlid("gss"), connectorId, trigger })
    .returning();
  let seenCount = 0;
  let changedCount = 0;
  let appliedCount = 0;
  let proposedCount = 0;
  let conflictCount = 0;
  try {
    const adapter = adapterOverride ?? (connector.sourceType === "notion" ? createNotionAdapter() : null);
    if (!adapter) throw new Error(`No source adapter is implemented for ${connector.sourceType}.`);
    // Re-read a short overlap window to tolerate clock skew and eventual
    // indexing. Content hashes make the repeated pages harmless.
    const since = connector.lastSucceededAt
      ? new Date(connector.lastSucceededAt.getTime() - 5 * 60_000)
      : null;
    const result = await adapter(connector, { since });
    for (const candidate of result.records) {
      seenCount++;
      const payload = canonicalPayload(candidate);
      const contentHash = stableRequestHash(payload);
      const [priorSource] = await db
        .select()
        .from(gtmSourceRecords)
        .where(and(eq(gtmSourceRecords.connectorId, connector.id), eq(gtmSourceRecords.externalId, candidate.externalId)))
        .limit(1);
      if (priorSource?.contentHash === contentHash) {
        await db.update(gtmSourceRecords).set({ lastSeenAt: new Date() }).where(eq(gtmSourceRecords.id, priorSource.id));
        continue;
      }
      changedCount++;
      let internal = priorSource?.internalRecordId
        ? (await db.select().from(gtmCatalogRecords).where(eq(gtmCatalogRecords.id, priorSource.internalRecordId)).limit(1))[0] ?? null
        : null;
      if (!internal) {
        internal = (await db
          .select()
          .from(gtmCatalogRecords)
          .where(and(eq(gtmCatalogRecords.recordType, candidate.recordType), eq(gtmCatalogRecords.key, candidate.key)))
          .limit(1))[0] ?? null;
      }
      const before = comparableRecord(internal);
      const diff = diffValues(before, payload);
      const sourceId = priorSource?.id ?? prefixedUlid("gsr");
      if (priorSource) {
        await db
          .update(gtmSourceRecords)
          .set({ internalRecordId: internal?.id ?? null, sourceUrl: candidate.sourceUrl, contentHash, sourceUpdatedAt: candidate.sourceUpdatedAt, lastSeenAt: new Date(), payload, status: "proposed" })
          .where(eq(gtmSourceRecords.id, sourceId));
      } else {
        await db.insert(gtmSourceRecords).values({ id: sourceId, connectorId: connector.id, externalId: candidate.externalId, internalRecordId: internal?.id ?? null, sourceUrl: candidate.sourceUrl, contentHash, sourceUpdatedAt: candidate.sourceUpdatedAt, payload, status: "proposed" });
      }
      await db
        .update(gtmChangeProposals)
        .set({ status: "superseded", reason: "A newer source version was detected.", updatedAt: new Date() })
        .where(and(eq(gtmChangeProposals.sourceRecordId, sourceId), eq(gtmChangeProposals.status, "pending")));

      if (!Object.keys(diff).length) {
        await db.update(gtmSourceRecords).set({ status: "current" }).where(eq(gtmSourceRecords.id, sourceId));
        continue;
      }

      const allowed = new Set(connector.authoritativeFields as string[]);
      const changedFields = Object.keys(diff).filter((key) => key !== "version");
      const mayAutoApply = Boolean(internal && connector.autoApply && changedFields.every((key) => allowed.has(key)));
      if (mayAutoApply && internal) {
        try {
          await upsertCatalogRecord(db, syncActor(connector), { ...payload, id: internal.id }, "Auto-applied from an explicitly authoritative connector field allowlist.");
          await db.update(gtmSourceRecords).set({ status: "current", internalRecordId: internal.id }).where(eq(gtmSourceRecords.id, sourceId));
          appliedCount++;
          continue;
        } catch {
          conflictCount++;
          await db.update(gtmSourceRecords).set({ status: "conflict" }).where(eq(gtmSourceRecords.id, sourceId));
        }
      }
      await db.insert(gtmChangeProposals).values({
        id: prefixedUlid("gcp"),
        connectorId: connector.id,
        sourceRecordId: sourceId,
        internalRecordId: internal?.id ?? null,
        proposalType: internal ? "update" : "create",
        before,
        after: payload,
        diff,
        status: "pending",
      });
      proposedCount++;
    }
    const [finished] = await db
      .update(gtmSourceSyncRuns)
      .set({ status: "succeeded", finishedAt: new Date(), seenCount, changedCount, appliedCount, proposedCount, conflictCount, findings: result.findings ?? [], checkpoint: result.checkpoint ?? null })
      .where(eq(gtmSourceSyncRuns.id, run.id))
      .returning();
    await releaseLock(db, connector.id, lockOwner, { success: true, checkpoint: result.checkpoint });
    return { skipped: false, run: finished };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Source sync failed.";
    await db.update(gtmSourceSyncRuns).set({ status: "failed", finishedAt: new Date(), seenCount, changedCount, appliedCount, proposedCount, conflictCount, error: message }).where(eq(gtmSourceSyncRuns.id, run.id));
    await releaseLock(db, connector.id, lockOwner, { success: false, error: message });
    throw error;
  }
}

export async function syncDueSourceConnectors(db: Db) {
  const connectors = await db.select().from(gtmSourceConnectors).where(eq(gtmSourceConnectors.status, "active"));
  const now = Date.now();
  const due = connectors.filter((connector) => {
    if (!connector.lastStartedAt) return true;
    return now - connector.lastStartedAt.getTime() >= connector.scheduleMinutes * 60_000;
  });
  const results = [];
  // Sequential execution prevents a single cron invocation from creating a
  // burst against a shared external API. Connector-level locks handle overlap.
  for (const connector of due) {
    try {
      results.push({ connectorId: connector.id, result: await syncSourceConnector(db, connector.id, "schedule") });
    } catch (error) {
      results.push({ connectorId: connector.id, error: error instanceof Error ? error.message : "Sync failed." });
    }
  }
  return { checked: connectors.length, due: due.length, results };
}
