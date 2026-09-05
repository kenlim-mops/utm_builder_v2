/**
 * Bulk issuance: one batch ID, up to the configured limit of rows, each row
 * processed through the same issueLink service as the single builder. A bad
 * row records a row-level error and never erases or blocks other rows.
 */
import { eq } from "drizzle-orm";
import { newId, prefixedUlid } from "@/core/ids";
import type { Db } from "@/db/client";
import { batchRows, batches } from "@/db/schema";
import { recordAudit } from "./audit";
import { assertCanWrite, type SessionUser } from "./auth";
import { getConfig } from "./config";
import { DuplicateError, IssueError, issueLink, type LinkRequest } from "./links";

export interface BatchRowInput extends Omit<LinkRequest, "batchId" | "correlationId"> {}

export interface BatchRowResult {
  rowIndex: number;
  status: "issued" | "error" | "skipped_duplicate";
  linkId: string | null;
  finalUrl: string | null;
  errors: { code: string; message: string }[];
}

export interface BatchResult {
  batchId: string;
  status: "completed" | "completed_with_errors";
  rows: BatchRowResult[];
  succeeded: number;
  failed: number;
}

export async function createBatch(
  db: Db,
  actor: SessionUser,
  rows: BatchRowInput[],
  source: "grid" | "paste" | "csv",
): Promise<BatchResult> {
  assertCanWrite(actor);
  const config = await getConfig(db);
  if (rows.length === 0) throw new Error("Batch contains no rows.");
  if (rows.length > config.bulkLimit) {
    throw new Error(`Batch exceeds the configured limit of ${config.bulkLimit} rows.`);
  }

  const batchId = newId("batch");
  await db.insert(batches).values({
    id: batchId,
    createdBy: actor.id,
    rowCount: rows.length,
    source,
  });
  await recordAudit(db, actor, {
    action: "batch.created",
    entityType: "batch",
    entityId: batchId,
    context: { rowCount: rows.length, source },
  });

  const results: BatchRowResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let result: BatchRowResult;
    try {
      // Each row is its own transaction inside issueLink, so one failure
      // cannot roll back sibling rows.
      const issued = await issueLink(db, actor, {
        ...row,
        batchId,
        correlationId: `${batchId}:${i}`,
      });
      result = {
        rowIndex: i,
        status: "issued",
        linkId: issued.link.id,
        finalUrl: issued.link.finalUrl,
        errors: [],
      };
    } catch (err) {
      if (err instanceof DuplicateError) {
        result = {
          rowIndex: i,
          status: "skipped_duplicate",
          linkId: err.existingLinkId,
          finalUrl: err.existingUrl,
          errors: [{ code: "exact_duplicate", message: err.message }],
        };
      } else if (err instanceof IssueError) {
        result = {
          rowIndex: i,
          status: "error",
          linkId: null,
          finalUrl: null,
          errors: err.findings
            .filter((f) => f.severity === "error")
            .map((f) => ({ code: f.code, message: f.message })),
        };
      } else {
        result = {
          rowIndex: i,
          status: "error",
          linkId: null,
          finalUrl: null,
          errors: [{ code: "row_failed", message: err instanceof Error ? err.message : String(err) }],
        };
      }
    }
    await db.insert(batchRows).values({
      id: prefixedUlid("brw"),
      batchId,
      rowIndex: i,
      linkId: result.status === "issued" ? result.linkId : null,
      status: result.status,
      input: row,
      errors: result.errors.length ? result.errors : null,
    });
    results.push(result);
  }

  const succeeded = results.filter((r) => r.status === "issued").length;
  const failed = results.length - succeeded;
  const status = failed > 0 ? "completed_with_errors" : "completed";
  await db
    .update(batches)
    .set({ succeededCount: succeeded, failedCount: failed, status })
    .where(eq(batches.id, batchId));
  await recordAudit(db, actor, {
    action: "batch.completed",
    entityType: "batch",
    entityId: batchId,
    context: { succeeded, failed },
  });

  return { batchId, status, rows: results, succeeded, failed };
}

export async function batchDetail(db: Db, batchId: string) {
  const [batch] = await db.select().from(batches).where(eq(batches.id, batchId));
  if (!batch) return null;
  const rows = await db.select().from(batchRows).where(eq(batchRows.batchId, batchId));
  return { batch, rows: rows.sort((a, b) => a.rowIndex - b.rowIndex) };
}
