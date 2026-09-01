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
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { apiAccessTokens, users } from "@/db/schema";
import { sha256 } from "@/core/tokens";

export type Role = "user" | "admin" | "investigator";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export type ApiScope =
  | "utm:read"
  | "utm:preview"
  | "utm:issue"
  | "utm:campaigns:write"
  | "utm:initiatives:write"
  | "gtm:read"
  | "gtm:templates";

export interface ApiSessionUser extends SessionUser {
  authMethod: "bearer";
  tokenId: string;
  scopes: ApiScope[];
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

async function bearerProvider(req: Request): Promise<ApiSessionUser | null> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const raw = header.slice("Bearer ".length).trim();
  if (!raw) throw new AuthError(401, "Bearer token is missing.");
  const db = await getDb();
  const rows = await db
    .select({ token: apiAccessTokens, user: users })
    .from(apiAccessTokens)
    .innerJoin(users, eq(apiAccessTokens.userId, users.id))
    .where(
      and(
        eq(apiAccessTokens.tokenHash, sha256(raw)),
        isNull(apiAccessTokens.revokedAt),
        gt(apiAccessTokens.expiresAt, new Date()),
        eq(users.active, true),
      ),
    )
    .limit(1);
  const match = rows[0];
  if (!match) throw new AuthError(401, "Bearer token is invalid, expired, or revoked.");
  await db
    .update(apiAccessTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiAccessTokens.id, match.token.id));
  return {
    id: match.user.id,
    email: match.user.email,
    name: match.user.name,
    role: match.user.role,
    authMethod: "bearer",
    tokenId: match.token.id,
    scopes: (match.token.scopes as ApiScope[]) ?? [],
  };
}

export async function getSession(req?: Request): Promise<SessionUser | ApiSessionUser | null> {
  if (req?.headers.get("authorization")) return bearerProvider(req);
  const provider = process.env.AUTH_PROVIDER ?? "dev";
  if (provider === "sso") return ssoProvider();
  return devProvider();
}

export async function requireUser(req?: Request): Promise<SessionUser | ApiSessionUser> {
  const session = await getSession(req);
  if (!session) throw new AuthError(401, "Not authenticated.");
  return session;
}

export async function requireApiScope(req: Request, ...required: ApiScope[]): Promise<SessionUser | ApiSessionUser> {
  const session = await requireUser(req);
  if (!("authMethod" in session)) return session; // authenticated first-party web session
  const missing = required.filter((scope) => !session.scopes.includes(scope));
  if (missing.length) throw new AuthError(403, `Token is missing scope: ${missing.join(", ")}.`);
  return session;
}

/** Machine-facing endpoints must never fall back to a browser cookie session. */
export async function requireBearerApiScope(
  req: Request,
  ...required: ApiScope[]
): Promise<ApiSessionUser> {
  const session = await requireApiScope(req, ...required);
  if (!("authMethod" in session)) {
    throw new AuthError(401, "A bearer access token is required.");
  }
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
