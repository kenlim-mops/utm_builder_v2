/**
 * Append-only audit trail. Events are written inside the same transaction as
 * the change they describe; the application exposes no update/delete path.
 */
import { newId } from "@/core/ids";
import type { Db, Tx } from "@/db/client";
import { auditEvents } from "@/db/schema";
import type { SessionUser } from "./auth";

const REDACT_KEYS = /token|secret|password|authorization|api[_-]?key|cookie/i;

/** Recursively drop obviously sensitive keys from audit payloads. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEYS.test(k) ? "[redacted]" : redact(v);
    }
    return out;
  }
  return value;
}

export interface AuditInput {
  action: string;
  entityType: string;
  entityId: string;
  correlationId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  configVersion?: number | null;
  context?: Record<string, unknown> | null;
}

export async function recordAudit(
  db: Db | Tx,
  actor: SessionUser & { authMethod?: "bearer"; tokenId?: string },
  input: AuditInput,
): Promise<string> {
  const id = newId("audit");
  const clientContext = actor.authMethod
    ? { authMethod: actor.authMethod, credentialId: actor.tokenId }
    : {};
  const context = { ...clientContext, ...(input.context ?? {}) };
  await db.insert(auditEvents).values({
    id,
    actorId: actor.id,
    actorEmail: actor.email,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    correlationId: input.correlationId ?? null,
    before: input.before === undefined ? null : redact(input.before),
    after: input.after === undefined ? null : redact(input.after),
    reason: input.reason ?? null,
    configVersion: input.configVersion ?? null,
    context: Object.keys(context).length ? (redact(context) as Record<string, unknown>) : null,
  });
  return id;
}
