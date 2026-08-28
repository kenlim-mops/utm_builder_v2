/**
 * User and role management (Administrator-only; audited).
 */
import { asc, eq } from "drizzle-orm";
import { newId } from "@/core/ids";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { recordAudit } from "./audit";
import type { Role, SessionUser } from "./auth";

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
