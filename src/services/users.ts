/**
 * User and role management (Administrator-only; audited).
 */
import { asc, eq } from "drizzle-orm";
import { newId } from "@/core/ids";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { recordAudit } from "./audit";
import { AuthError, type Role, type SessionUser } from "./auth";

/** Resolve an active write-capable owner. Only admins may assign another user. */
export async function resolveRecordOwner(
  db: Db,
  actor: SessionUser,
  requestedOwnerId: string | undefined,
  fallbackOwnerId = actor.id,
): Promise<string> {
  const ownerId = requestedOwnerId ?? fallbackOwnerId;
  if (ownerId !== actor.id && actor.role !== "admin") {
    throw new AuthError(403, "Only an administrator can assign or transfer record ownership.");
  }
  const [owner] = await db.select().from(users).where(eq(users.id, ownerId)).limit(1);
  if (!owner?.active) throw new Error("The selected owner is not an active user.");
  if (owner.role === "investigator") throw new Error("Read-only investigators cannot own writable records.");
  return owner.id;
}

export async function listUsers(db: Db) {
  return db.select().from(users).orderBy(asc(users.email));
}

export async function upsertUser(
  db: Db,
  actor: SessionUser,
  input: { email: string; name?: string; role?: Role; active?: boolean },
  reason: string | null,
) {
  const email = input.email?.trim().toLowerCase();
  if (!email || !email.includes("@")) throw new Error("A valid email is required.");
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(users).where(eq(users.email, email));
    const before = existing[0] ?? null;
    let row;
    if (before) {
      [row] = await tx
        .update(users)
        .set({
          name: input.name ?? before.name,
          role: input.role ?? before.role,
          active: input.active ?? before.active,
        })
        .where(eq(users.email, email))
        .returning();
    } else {
      [row] = await tx
        .insert(users)
        .values({
          id: newId("user"),
          email,
          name: input.name ?? email,
          role: input.role ?? "user",
          active: input.active ?? true,
        })
        .returning();
    }
    await recordAudit(tx, actor, {
      action: before
        ? before.role !== row.role
          ? "user.role_changed"
          : "user.updated"
        : "user.created",
      entityType: "user",
      entityId: row.id,
      before: before ? { role: before.role, active: before.active, name: before.name } : null,
      after: { role: row.role, active: row.active, name: row.name },
      reason,
    });
    return row;
  });
}
