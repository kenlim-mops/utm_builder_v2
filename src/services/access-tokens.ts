import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { prefixedUlid } from "@/core/ids";
import {
  randomOpaqueToken,
  safeEqual,
  sha256,
  sha256Base64Url,
} from "@/core/tokens";
import type { Db } from "@/db/client";
import {
  apiAccessTokens,
  extensionAuthorizationCodes,
  users,
} from "@/db/schema";
import { recordAudit } from "./audit";
import type { ApiScope, SessionUser } from "./auth";

export const UTM_CLIENT_SCOPES: ApiScope[] = [
  "utm:read",
  "utm:preview",
  "utm:issue",
  "utm:campaigns:write",
  "utm:initiatives:write",
];

export const DEFAULT_USER_SCOPES: ApiScope[] = [
  ...UTM_CLIENT_SCOPES,
  "gtm:read",
  "gtm:templates",
];

const ALL_SCOPES = new Set<ApiScope>(DEFAULT_USER_SCOPES);

export function validateExtensionRedirect(redirectUri: string): URL {
  const url = new URL(redirectUri);
  const match = /^([a-p]{32})\.chromiumapp\.org$/.exec(url.hostname);
  if (url.protocol !== "https:" || !match || !url.pathname.startsWith("/callback")) {
    throw new Error("Invalid Chrome extension redirect URI.");
  }
  const configured = (process.env.EXTENSION_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (process.env.NODE_ENV === "production" && configured.length === 0) {
    throw new Error("EXTENSION_IDS must be configured in production.");
  }
  if (configured.length > 0 && !configured.includes(match[1])) {
    throw new Error("Chrome extension is not allowlisted.");
  }
  return url;
}

function normalizeScopes(requested?: string[]): ApiScope[] {
  const values = requested?.length ? requested : DEFAULT_USER_SCOPES;
  const scopes = [...new Set(values)] as ApiScope[];
  if (scopes.some((scope) => !ALL_SCOPES.has(scope))) throw new Error("Unsupported API scope.");
  return scopes;
}

async function insertToken(
  db: Db,
  actor: SessionUser,
  input: {
    label: string;
    scopes?: string[];
    clientType: "extension" | "mcp" | "api";
    ttlHours: number;
  },
) {
  const token = randomOpaqueToken("rpt");
  const expiresAt = new Date(Date.now() + input.ttlHours * 60 * 60 * 1000);
  const [row] = await db
    .insert(apiAccessTokens)
    .values({
      id: prefixedUlid("tok"),
      userId: actor.id,
      label: input.label.trim() || input.clientType,
      tokenHash: sha256(token),
      scopes: normalizeScopes(input.scopes),
      clientType: input.clientType,
      expiresAt,
    })
    .returning();
  await recordAudit(db, actor, {
    action: "api_token.created",
    entityType: "api_token",
    entityId: row.id,
    after: {
      label: row.label,
      scopes: row.scopes,
      clientType: row.clientType,
      expiresAt: row.expiresAt,
    },
  });
  return { token, metadata: safeToken(row) };
}

function safeToken(row: typeof apiAccessTokens.$inferSelect) {
  return {
    id: row.id,
    label: row.label,
    scopes: row.scopes,
    clientType: row.clientType,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

export async function createPersonalAccessToken(
  db: Db,
  actor: SessionUser,
  input: { label?: string; scopes?: string[]; expiresInDays?: number; clientType?: "mcp" | "api" },
) {
  const days = Math.min(Math.max(input.expiresInDays ?? 30, 1), 90);
  return insertToken(db, actor, {
    label: input.label ?? "Personal access token",
    scopes: input.scopes,
    clientType: input.clientType ?? "api",
    ttlHours: days * 24,
  });
}

export async function listPersonalAccessTokens(db: Db, actor: SessionUser) {
  const rows = await db
    .select()
    .from(apiAccessTokens)
    .where(eq(apiAccessTokens.userId, actor.id))
    .orderBy(desc(apiAccessTokens.createdAt));
  return rows.map(safeToken);
}

export async function revokePersonalAccessToken(db: Db, actor: SessionUser, tokenId: string) {
  const [before] = await db
    .select()
    .from(apiAccessTokens)
    .where(and(eq(apiAccessTokens.id, tokenId), eq(apiAccessTokens.userId, actor.id)));
  if (!before) throw new Error("Access token not found.");
  await db
    .update(apiAccessTokens)
    .set({ revokedAt: new Date() })
    .where(eq(apiAccessTokens.id, tokenId));
  await recordAudit(db, actor, {
    action: "api_token.revoked",
    entityType: "api_token",
    entityId: tokenId,
    before: safeToken(before),
  });
}

export async function createExtensionAuthorizationCode(
  db: Db,
  actor: SessionUser,
  input: { redirectUri: string; codeChallenge: string },
) {
  validateExtensionRedirect(input.redirectUri);
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.codeChallenge)) {
    throw new Error("Invalid PKCE S256 challenge.");
  }
  const code = randomOpaqueToken("rpcx");
  await db.insert(extensionAuthorizationCodes).values({
    id: prefixedUlid("xac"),
    codeHash: sha256(code),
    userId: actor.id,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });
  return code;
}

export async function exchangeExtensionAuthorizationCode(
  db: Db,
  input: { code: string; codeVerifier: string; redirectUri: string },
) {
  validateExtensionRedirect(input.redirectUri);
  const [match] = await db
    .select({ code: extensionAuthorizationCodes, user: users })
    .from(extensionAuthorizationCodes)
    .innerJoin(users, eq(extensionAuthorizationCodes.userId, users.id))
    .where(
      and(
        eq(extensionAuthorizationCodes.codeHash, sha256(input.code)),
        eq(extensionAuthorizationCodes.redirectUri, input.redirectUri),
        isNull(extensionAuthorizationCodes.usedAt),
        gt(extensionAuthorizationCodes.expiresAt, new Date()),
        eq(users.active, true),
      ),
    )
    .limit(1);
  if (!match) throw new Error("Authorization code is invalid, expired, or already used.");
  if (!safeEqual(sha256Base64Url(input.codeVerifier), match.code.codeChallenge)) {
    throw new Error("PKCE verification failed.");
  }

  const actor: SessionUser = {
    id: match.user.id,
    email: match.user.email,
    name: match.user.name,
    role: match.user.role,
  };
  return db.transaction(async (tx) => {
    // Consume conditionally inside the transaction. Concurrent exchanges race
    // on this UPDATE; only the first can transition usedAt from null.
    const consumed = await tx
      .update(extensionAuthorizationCodes)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(extensionAuthorizationCodes.id, match.code.id),
          isNull(extensionAuthorizationCodes.usedAt),
          gt(extensionAuthorizationCodes.expiresAt, new Date()),
        ),
      )
      .returning({ id: extensionAuthorizationCodes.id });
    if (consumed.length === 0) {
      throw new Error("Authorization code is invalid, expired, or already used.");
    }
    return insertToken(tx as Db, actor, {
      label: "Runpod UTM browser extension",
      clientType: "extension",
      ttlHours: 8,
      scopes: UTM_CLIENT_SCOPES,
    });
  });
}
