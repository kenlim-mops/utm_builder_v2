/**
 * Minimal fixed-window, per-instance in-memory rate limiter.
 *
 * Bounded fallback protection for auth-adjacent endpoints. Each serverless
 * instance keeps its own window, so production should also enforce a shared
 * rate limit at the identity proxy/WAF. Credential entropy remains the
 * primary defense against guessing.
 */
import { isIP } from "node:net";

const windows = new Map<string, { count: number; resetAt: number }>();
const MAX_WINDOWS = 10_000;
let callsSinceCleanup = 0;

function normalizedIp(value: string | null): string | null {
  const candidate = value?.split(",")[0]?.trim() ?? "";
  const withoutPort = /^\[([^\]]+)\](?::\d+)?$/.exec(candidate)?.[1]
    ?? (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(candidate) ? candidate.replace(/:\d+$/, "") : candidate);
  return isIP(withoutPort) ? withoutPort : null;
}

export function clientIp(req: Request): string {
  // Prefer headers written by the hosting platform/reverse proxy. Invalid or
  // user-controlled-looking values collapse to one conservative bucket.
  return normalizedIp(req.headers.get("x-vercel-forwarded-for"))
    ?? normalizedIp(req.headers.get("x-real-ip"))
    ?? normalizedIp(req.headers.get("x-forwarded-for"))
    ?? "unknown";
}

export class RateLimitError extends Error {
  status = 429 as const;
  constructor() {
    super("Too many requests. Try again shortly.");
    this.name = "RateLimitError";
  }
}

/** Throws RateLimitError when `key` exceeds `limit` calls per `windowMs`. */
export function assertRateLimit(key: string, limit: number, windowMs = 60_000): void {
  const now = Date.now();
  callsSinceCleanup += 1;
  if (callsSinceCleanup >= 256 || windows.size >= MAX_WINDOWS) {
    for (const [candidate, value] of windows) {
      if (value.resetAt <= now) windows.delete(candidate);
    }
    callsSinceCleanup = 0;
  }

  // Keep memory bounded even during a burst of unique source identifiers.
  if (!windows.has(key) && windows.size >= MAX_WINDOWS) {
    const oldest = windows.keys().next().value as string | undefined;
    if (oldest) windows.delete(oldest);
  }

  const entry = windows.get(key);
  if (!entry || entry.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  entry.count += 1;
  if (entry.count > limit) throw new RateLimitError();
}

/** Test-only reset; avoids state leaking between deterministic unit tests. */
export function resetRateLimitsForTest(): void {
  if (process.env.NODE_ENV !== "test") return;
  windows.clear();
  callsSinceCleanup = 0;
}
