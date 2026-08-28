/**
 * Authentication provider abstraction.
 *
 * Runpod SSO is not yet approved/configured, so V2 ships with:
 *  - "dev" provider: cookie-selected identity from the seeded users table.
 *    Local development only; it refuses to run in production.
 *  - "sso" provider stub: the integration point for the approved Runpod IdP
 *    (see docs/deployment-vercel.md). It must map the verified principal to a
 *    row in `users` — roles are always read server-side from the database.
 *
 * There are no client-only role checks anywhere: every mutation route calls
 * requireUser/requireRole on the server.
 */
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";

export type Role = "user" | "admin" | "investigator";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export const DEV_IDENTITY_COOKIE = "rp_dev_identity";

export class AuthError extends Error {
  constructor(
    public status: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

async function devProvider(): Promise<SessionUser | null> {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_AUTH !== "true") {
    throw new AuthError(
      401,
      "Dev auth provider is disabled in production. Configure AUTH_PROVIDER=sso.",
    );
  }
  const jar = await cookies();
  const email = jar.get(DEV_IDENTITY_COOKIE)?.value ?? "dev-admin@runpod.io";
  const db = await getDb();
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const row = rows[0];
  if (!row || !row.active) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

async function ssoProvider(): Promise<SessionUser | null> {
  // Integration point: verify the SSO session (e.g. via the IdP SDK or a
  // signed header from the Runpod-approved proxy), then map to `users`.
  throw new AuthError(
    401,
    "SSO provider is not configured. See docs/deployment-vercel.md for the integration contract.",
  );
}

export async function getSession(): Promise<SessionUser | null> {
  const provider = process.env.AUTH_PROVIDER ?? "dev";
  if (provider === "sso") return ssoProvider();
  return devProvider();
}

export async function requireUser(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw new AuthError(401, "Not authenticated.");
  return session;
}

export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const session = await requireUser();
  if (!roles.includes(session.role)) {
    throw new AuthError(403, `This action requires role: ${roles.join(" or ")}.`);
  }
  return session;
}

/** Investigators and admins may read audit data; only admins mutate config. */
export const CAN_READ_AUDIT: Role[] = ["admin", "investigator"];
