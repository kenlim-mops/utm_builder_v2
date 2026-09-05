/**
 * Shared route-handler plumbing: JSON responses, error mapping, auth guards.
 */
import { NextResponse } from "next/server";
import { AuthError } from "@/services/auth";
import { CampaignDuplicateError } from "@/services/campaigns";
import { DuplicateError, IssueError } from "@/services/links";

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
  const message = err instanceof Error ? err.message : "Internal error";
  const status = /not found/i.test(message) ? 404 : 400;
  return NextResponse.json({ error: message }, { status });
}

export async function handle(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (err) {
    return errorResponse(err);
  }
}
