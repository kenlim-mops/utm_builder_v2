import { cookies } from "next/headers";
import { DEV_IDENTITY_COOKIE, getSession } from "@/services/auth";
import { handle, json } from "@/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => {
    const session = await getSession();
    return json({ session });
  });
}

/** Dev-only identity switcher; the SSO provider ignores this endpoint. */
export async function POST(req: Request) {
  return handle(async () => {
    if ((process.env.AUTH_PROVIDER ?? "dev") !== "dev") {
      return json({ error: "Identity switching is only available with the dev provider." }, { status: 400 });
    }
    const { email } = (await req.json()) as { email?: string };
    if (!email) return json({ error: "email is required" }, { status: 400 });
    const jar = await cookies();
    jar.set(DEV_IDENTITY_COOKIE, email, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
    return json({ ok: true });
  });
}
