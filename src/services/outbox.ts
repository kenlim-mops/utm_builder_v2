/**
 * Transactional outbox for asynchronous integrations (HubSpot, warehouse).
 *
 * Events are enqueued inside the same transaction as the registry write, so a
 * committed record always has its sync intent recorded, and an integration
 * failure can never roll back a committed registry record. Processing is
 * idempotent (unique idempotency keys + idempotent external clients), retried
 * with bounded exponential backoff, and dead-lettered after maxAttempts.
 */
import { and, eq, lte, sql } from "drizzle-orm";
import { newId, prefixedUlid } from "@/core/ids";
import type { Db, Tx } from "@/db/client";
import { externalCampaignMappings, outboxEvents, syncAttempts } from "@/db/schema";

export interface OutboxEventInput {
  type: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  maxAttempts?: number;
}

/** Enqueue inside the caller's transaction. Duplicate keys are no-ops. */
export async function enqueueOutboxEvent(db: Db | Tx, input: OutboxEventInput): Promise<void> {
  await db
    .insert(outboxEvents)
    .values({
      id: newId("outbox"),
      type: input.type,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      maxAttempts: input.maxAttempts ?? 8,
    })
    .onConflictDoNothing({ target: outboxEvents.idempotencyKey });
}

/**
 * External integration clients. Injected so tests can simulate outages and
 * verify idempotency; production wiring lives in integrations.ts.
 */
export interface IntegrationClients {
  hubspot: {
    /**
     * Create-or-get a HubSpot campaign for this idempotency key.
     * MUST be idempotent: calling twice with the same key returns the same GUID.
     */
    ensureCampaign(args: {
      idempotencyKey: string;
      name: string;
    }): Promise<{ campaignGuid: string }>;
  };
  warehouse: {
    /** Persist a versioned registry snapshot row. MUST be idempotent per key. */
    writeSnapshot(args: { idempotencyKey: string; payload: unknown }): Promise<void>;
  };
}

const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000; // 6h cap

export function backoffMs(attempt: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
}

export interface ProcessResult {
  processed: number;
  succeeded: number;
  failed: number;
  dead: number;
}

/**
 * Process due pending/failed events. Called by the cron worker route,
 * the CLI, or manual retry from /admin.
 */
export async function processOutbox(
  db: Db,
  clients: IntegrationClients,
  opts: { limit?: number; now?: Date } = {},
): Promise<ProcessResult> {
  const now = opts.now ?? new Date();
  const due = await db
    .select()
    .from(outboxEvents)
    .where(
      and(
        sql`${outboxEvents.status} in ('pending', 'failed')`,
        lte(outboxEvents.nextAttemptAt, now),
      ),
    )
    .limit(opts.limit ?? 25);

  const result: ProcessResult = { processed: 0, succeeded: 0, failed: 0, dead: 0 };

  for (const event of due) {
    result.processed++;
    const attemptNumber = event.attempts + 1;
    const attemptId = prefixedUlid("att");
    await db.insert(syncAttempts).values({
      id: attemptId,
      outboxEventId: event.id,
      attemptNumber,
    });
    await db
      .update(outboxEvents)
      .set({ status: "processing", attempts: attemptNumber, updatedAt: new Date() })
      .where(eq(outboxEvents.id, event.id));

    try {
      await dispatch(db, clients, event.type, event.payload as Record<string, unknown>, event.idempotencyKey);
      await db
        .update(outboxEvents)
        .set({ status: "succeeded", lastError: null, updatedAt: new Date() })
        .where(eq(outboxEvents.id, event.id));
      await db
        .update(syncAttempts)
        .set({ finishedAt: new Date(), ok: true })
        .where(eq(syncAttempts.id, attemptId));
      result.succeeded++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const dead = attemptNumber >= event.maxAttempts;
      await db
        .update(outboxEvents)
        .set({
          status: dead ? "dead" : "failed",
          lastError: message,
          nextAttemptAt: new Date(now.getTime() + backoffMs(attemptNumber)),
          updatedAt: new Date(),
        })
        .where(eq(outboxEvents.id, event.id));
      await db
        .update(syncAttempts)
        .set({ finishedAt: new Date(), ok: false, error: message })
        .where(eq(syncAttempts.id, attemptId));
      if (event.type === "hubspot.campaign.sync") {
        const mappingId = (event.payload as { mappingId?: string }).mappingId;
        if (mappingId) {
          await db
            .update(externalCampaignMappings)
            .set({
              syncState: dead ? "dead" : "failed",
              lastAttemptAt: new Date(),
              lastError: message,
              updatedAt: new Date(),
            })
            .where(eq(externalCampaignMappings.id, mappingId));
        }
      }
      if (dead) result.dead++;
      else result.failed++;
    }
  }
  return result;
}

async function dispatch(
  db: Db,
  clients: IntegrationClients,
  type: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
): Promise<void> {
  switch (type) {
    case "hubspot.campaign.sync": {
      const { mappingId, name } = payload as { mappingId: string; name: string };
      await db
        .update(externalCampaignMappings)
        .set({ syncState: "syncing", lastAttemptAt: new Date(), updatedAt: new Date() })
        .where(eq(externalCampaignMappings.id, mappingId));
      const { campaignGuid } = await clients.hubspot.ensureCampaign({ idempotencyKey, name });
      await db
        .update(externalCampaignMappings)
        .set({
          externalId: campaignGuid,
          syncState: "synced",
          lastSuccessAt: new Date(),
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(externalCampaignMappings.id, mappingId));
      return;
    }
    case "warehouse.snapshot.campaign":
    case "warehouse.snapshot.link": {
      await clients.warehouse.writeSnapshot({ idempotencyKey, payload });
      return;
    }
    default:
      throw new Error(`Unknown outbox event type: ${type}`);
  }
}

/** Manual retry: make a failed/dead event due immediately. */
export async function retryOutboxEvent(db: Db, eventId: string): Promise<void> {
  await db
    .update(outboxEvents)
    .set({ status: "failed", nextAttemptAt: new Date(), updatedAt: new Date() })
    .where(and(eq(outboxEvents.id, eventId), sql`${outboxEvents.status} in ('failed', 'dead')`));
}
