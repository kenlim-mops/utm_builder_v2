/**
 * Minimal fixed-window, per-instance in-memory rate limiter.
 *
 * DoS hardening for auth-adjacent endpoints; not a distributed limiter (each
 * serverless instance keeps its own window, which is acceptable for this
 * purpose — credential entropy already makes brute force infeasible).
 */
const windows = new Map<string, { count: number; resetAt: number }>();

export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
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
  const entry = windows.get(key);
  if (!entry || entry.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  entry.count += 1;
  if (entry.count > limit) throw new RateLimitError();
  if (windows.size > 10_000) {
    for (const [k, v] of windows) if (v.resetAt <= now) windows.delete(k);
  }
}
