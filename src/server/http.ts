/**
 * Shared route-handler plumbing: JSON responses, error mapping, auth guards.
 */
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthError } from "@/services/auth";
import { CampaignDuplicateError } from "@/services/campaigns";
import { DuplicateError, IssueError } from "@/services/links";
import { RateLimitError } from "@/server/rate-limit";

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof DuplicateError) {
    return NextResponse.json(
      {
        error: err.message,
        code: "exact_duplicate",
        existingLinkId: err.existingLinkId,
        existingUrl: err.existingUrl,
      },
      { status: 409 },
    );
  }
  if (err instanceof CampaignDuplicateError) {
    return NextResponse.json(
      { error: err.message, code: "campaign_duplicate", candidates: err.candidates },
      { status: 409 },
    );
  }
  if (err instanceof IssueError) {
    return NextResponse.json(
      { error: err.message, code: "validation_failed", findings: err.findings },
      { status: 422 },
    );
  }
  if (err instanceof RateLimitError) {
    return NextResponse.json({ error: err.message }, { status: 429 });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: "Request body is invalid.", code: "invalid_request", issues: err.issues },
      { status: 400 },
    );
  }
  // Only plain `Error` instances thrown by our services carry user-facing
  // messages. Subclasses (driver errors, TypeError, connector failures) are
  // internal — log them server-side and return a generic message.
  if (err instanceof Error && err.constructor === Error) {
    const status = /not found/i.test(err.message) ? 404 : 400;
    return NextResponse.json({ error: err.message }, { status });
  }
  console.error(
    JSON.stringify({
      event: "api.internal_error",
      name: err instanceof Error ? err.name : typeof err,
      message: err instanceof Error ? err.message : String(err),
    }),
  );
  return NextResponse.json({ error: "Internal server error." }, { status: 500 });
}

export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    return errorResponse(err);
  }
}
