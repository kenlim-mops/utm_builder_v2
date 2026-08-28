/**
 * Approved destination domains and permitted exceptions — versioned + audited.
 */
import { asc, eq } from "drizzle-orm";
import { prefixedUlid } from "@/core/ids";
import type { DestinationPolicyRule } from "@/core/validation";
import type { Db, Tx } from "@/db/client";
import { destinationPolicies } from "@/db/schema";
import { recordAudit } from "./audit";
import type { SessionUser } from "./auth";
import { bumpConfigVersion } from "./config";

export async function getDestinationPolicies(db: Db | Tx): Promise<DestinationPolicyRule[]> {
  const rows = await db
    .select()
    .from(destinationPolicies)
    .where(eq(destinationPolicies.status, "active"));
  return rows.map((r) => ({ domain: r.domain, kind: r.kind }));
}

export async function listDestinationPolicies(db: Db) {
  return db.select().from(destinationPolicies).orderBy(asc(destinationPolicies.domain));
}

export async function upsertDestinationPolicy(
  db: Db,
  actor: SessionUser,
  input: { domain: string; kind: "approved" | "exception"; notes?: string | null; status?: "active" | "disabled" },
  reason: string | null,
) {
  const domain = input.domain.trim().toLowerCase();
  if (!domain || !domain.includes(".")) throw new Error("A valid domain is required.");
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(destinationPolicies)
      .where(eq(destinationPolicies.domain, domain));
    const before = existing.find((r) => r.kind === input.kind) ?? null;
    let row;
    if (before) {
      [row] = await tx
        .update(destinationPolicies)
        .set({
          notes: input.notes ?? before.notes,
          status: input.status ?? before.status,
          version: before.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(destinationPolicies.id, before.id))
        .returning();
    } else {
      [row] = await tx
        .insert(destinationPolicies)
        .values({
          id: prefixedUlid("dst"),
          domain,
          kind: input.kind,
          notes: input.notes ?? null,
          status: input.status ?? "active",
        })
        .returning();
    }
    const configVersion = await bumpConfigVersion(tx);
    await recordAudit(tx, actor, {
      action: before ? "destination_policy.updated" : "destination_policy.created",
      entityType: "destination_policy",
      entityId: row.id,
      before,
      after: row,
      reason,
      configVersion,
    });
    return row;
  });
}
