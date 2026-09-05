import { z } from "zod";
import { getDb } from "@/db/client";
import { apiJson, handlePublicApi, publicApiOptions } from "@/server/public-api";
import { assertRateLimit, clientIp } from "@/server/rate-limit";
import { exchangeExtensionAuthorizationCode } from "@/services/access-tokens";

const exchangeSchema = z.object({
  code: z.string().min(20).max(200),
  codeVerifier: z.string().min(43).max(128),
  redirectUri: z.string().url(),
});

export const dynamic = "force-dynamic";
export async function OPTIONS(req: Request) { return publicApiOptions(req); }
export async function POST(req: Request) {
  return handlePublicApi(req, async (requestId) => {
    // DoS hardening on code-guess attempts (code entropy already defeats
    // brute force; this just caps DB work per source).
    assertRateLimit(`ext-token:${clientIp(req)}`, 20);
    const input = exchangeSchema.parse(await req.json());
    const result = await exchangeExtensionAuthorizationCode(await getDb(), input);
    const expiresAt = new Date(result.metadata.expiresAt);
    return apiJson(req, {
      access_token: result.token,
      token_type: "Bearer",
      expires_in: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
      scope: (result.metadata.scopes as string[]).join(" "),
      requestId,
    });
  });
}
