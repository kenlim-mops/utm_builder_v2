import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AuthError } from "@/services/auth";
import { CampaignDuplicateError } from "@/services/campaigns";
import { DuplicateError, IssueError } from "@/services/links";

function allowedOrigin(req: Request): string | null {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  const match = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin);
  if (!match) return null;
  const configured = (process.env.EXTENSION_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (process.env.NODE_ENV === "production" && configured.length === 0) return null;
  return configured.length === 0 || configured.includes(match[1]) ? origin : null;
}

function decorate(req: Request, response: NextResponse, requestId: string): NextResponse {
  response.headers.set("X-Request-ID", requestId);
  response.headers.set("Cache-Control", "no-store");
  const origin = allowedOrigin(req);
  if (origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Credentials", "true");
    response.headers.set("Vary", "Origin");
  }
  return response;
}

export function publicApiOptions(req: Request): NextResponse {
  const response = new NextResponse(null, { status: 204 });
  const origin = allowedOrigin(req);
  if (origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    response.headers.set(
      "Access-Control-Allow-Headers",
      "Authorization,Content-Type,Idempotency-Key,X-Request-ID",
    );
    response.headers.set("Access-Control-Max-Age", "600");
    response.headers.set("Vary", "Origin");
  }
  return response;
}

export function apiJson(
  req: Request,
  data: unknown,
  init: ResponseInit = {},
  requestId = req.headers.get("x-request-id") || randomUUID(),
): NextResponse {
  return decorate(req, NextResponse.json(data, init), requestId);
}

export async function handlePublicApi(
  req: Request,
  fn: (requestId: string) => Promise<NextResponse>,
): Promise<NextResponse> {
  const requestId = req.headers.get("x-request-id") || randomUUID();
  try {
    return decorate(req, await fn(requestId), requestId);
  } catch (error) {
    if (error instanceof AuthError) {
      return apiJson(req, { error: { code: error.status === 401 ? "unauthorized" : "forbidden", message: error.message }, requestId }, { status: error.status }, requestId);
    }
    if (error instanceof DuplicateError) {
      return apiJson(req, {
        error: { code: "exact_duplicate", message: error.message },
        existingLinkId: error.existingLinkId,
        existingUrl: error.existingUrl,
        requestId,
      }, { status: 409 }, requestId);
    }
    if (error instanceof CampaignDuplicateError) {
      return apiJson(req, {
        error: { code: "campaign_duplicate", message: error.message },
        candidates: error.candidates,
        requestId,
      }, { status: 409 }, requestId);
    }
    if (error instanceof IssueError) {
      return apiJson(req, {
        error: { code: "validation_failed", message: error.message },
        findings: error.findings,
        requestId,
      }, { status: 422 }, requestId);
    }
    if (error instanceof ZodError) {
      return apiJson(req, {
        error: { code: "invalid_request", message: "Request body is invalid." },
        issues: error.issues,
        requestId,
      }, { status: 400 }, requestId);
    }
    const message = error instanceof Error ? error.message : "Internal error";
    const status = /not found/i.test(message)
      ? 404
      : /different request|processing/i.test(message)
        ? 409
        : /invalid|required|unsupported|must be|cannot|exceeds|not allowed|allowlisted/i.test(message)
          ? 400
          : 500;
    if (status === 500) {
      console.error(JSON.stringify({ event: "public_api.error", requestId, message }));
    }
    return apiJson(req, {
      error: {
        code: status === 404 ? "not_found" : status === 500 ? "internal_error" : "request_failed",
        message: status === 500 ? "Internal server error." : message,
      },
      requestId,
    }, { status }, requestId);
  }
}
