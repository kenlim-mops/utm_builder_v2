import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { handlePublicApi } from "@/server/public-api";
import { requireUser } from "@/services/auth";
import { createExtensionAuthorizationCode } from "@/services/access-tokens";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handlePublicApi(req, async () => {
    const actor = await requireUser();
    const url = new URL(req.url);
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const challenge = url.searchParams.get("code_challenge") ?? "";
    if (url.searchParams.get("code_challenge_method") !== "S256") {
      throw new Error("Only PKCE S256 is supported.");
    }
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(state)) throw new Error("Invalid authorization state.");
    const code = await createExtensionAuthorizationCode(await getDb(), actor, {
      redirectUri,
      codeChallenge: challenge,
    });
    const destination = new URL(redirectUri);
    destination.searchParams.set("code", code);
    destination.searchParams.set("state", state);
    return NextResponse.redirect(destination);
  });
}
