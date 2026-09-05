import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import type { SessionUser } from "./auth";
import { listPresets } from "./presets";
import { listTaxonomy } from "./taxonomy";

export interface SlackRequestIdentity {
  userId: string;
  teamId: string | null;
  enterpriseId: string | null;
}

type SlackOption = { text: { type: "plain_text"; text: string }; value: string };

function configuredIds(value: string | undefined) {
  return new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean));
}

export function verifySlackRequest(input: {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  signingSecret?: string;
  nowSeconds?: number;
}) {
  if (!input.signingSecret || !input.timestamp || !input.signature) return false;
  const timestamp = Number(input.timestamp);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 300) return false;
  const expected = `v0=${createHmac("sha256", input.signingSecret)
    .update(`v0:${input.timestamp}:${input.rawBody}`)
    .digest("hex")}`;
  const supplied = Buffer.from(input.signature);
  const wanted = Buffer.from(expected);
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}

export function slackIdentityAllowed(identity: SlackRequestIdentity) {
  const teams = configuredIds(process.env.SLACK_ALLOWED_TEAM_IDS);
  const enterprises = configuredIds(process.env.SLACK_ALLOWED_ENTERPRISE_IDS);
  // Local/test environments stay easy to exercise. Production fails closed so
  // a missed deployment variable cannot authorize an arbitrary workspace.
  if (!teams.size && !enterprises.size) return process.env.NODE_ENV !== "production";
  return Boolean(
    (identity.teamId && teams.has(identity.teamId)) ||
      (identity.enterpriseId && enterprises.has(identity.enterpriseId)),
  );
}

function emailMap() {
  try {
    return JSON.parse(process.env.SLACK_USER_EMAIL_MAP_JSON ?? "{}") as Record<string, string>;
  } catch {
    throw new Error("SLACK_USER_EMAIL_MAP_JSON must be a JSON object of Slack user IDs to Runpod email addresses.");
  }
}

export async function slackApi<T = Record<string, unknown>>(
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN is not configured.");
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as T & { ok?: boolean; error?: string };
  if (!response.ok || payload.ok === false) throw new Error(`Slack ${method} failed: ${payload.error ?? response.status}`);
  return payload;
}

export async function resolveSlackActor(db: Db, identity: SlackRequestIdentity): Promise<SessionUser> {
  if (!slackIdentityAllowed(identity)) throw new Error("This Slack workspace or organization is not allowed.");
  let email: string | undefined = emailMap()[identity.userId]?.trim().toLowerCase();
  if (!email) {
    const info = await slackApi<{ user?: { profile?: { email?: string } } }>("users.info", { user: identity.userId });
    email = info.user?.profile?.email?.trim().toLowerCase();
  }
  if (!email) throw new Error("Your Slack profile does not expose a work email and no administrator mapping exists.");
  const [actor] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!actor?.active) throw new Error(`No active UTM Builder account is mapped to ${email}.`);
  return { id: actor.id, email: actor.email, name: actor.name, role: actor.role };
}

const plain = (text: string) => ({ type: "plain_text" as const, text: text.slice(0, 75) });
const option = (label: string, value: string): SlackOption => ({ text: plain(label), value: value.slice(0, 150) });

export async function singleUtmModal(db: Db, initialDestination = "") {
  const [presets, taxonomy] = await Promise.all([listPresets(db), listTaxonomy(db)]);
  const presetOptions = presets
    .filter((item) => item.verificationState !== "deprecated")
    .slice(0, 100)
    .map((item) => option(item.name, item.key));
  const sourceOptions = taxonomy.sources
    .filter((item) => item.status === "active")
    .slice(0, 100)
    .map((item) => option(item.label, item.slug));
  const mediumOptions = taxonomy.mediums
    .filter((item) => item.status === "active")
    .slice(0, 100)
    .map((item) => option(item.label, item.slug));
  return {
    type: "modal",
    callback_id: "utm_single_preview",
    title: plain("Create governed UTM"),
    submit: plain("Preview"),
    close: plain("Cancel"),
    blocks: [
      {
        type: "input", block_id: "destination", label: plain("Destination URL"),
        element: { type: "plain_text_input", action_id: "value", max_length: 2000, initial_value: initialDestination.slice(0, 2000), placeholder: plain("runpod.io/path or full URL") },
      },
      {
        type: "input", block_id: "campaign", label: plain("Campaign"),
        element: { type: "external_select", action_id: "value", min_query_length: 0, placeholder: plain("Search governed campaigns") },
      },
      {
        type: "input", block_id: "preset", label: plain("Platform preset"),
        element: { type: "static_select", action_id: "value", options: presetOptions, initial_option: presetOptions.find((item) => item.value === "generic") ?? presetOptions[0] },
      },
      {
        type: "input", block_id: "source", label: plain("utm_source"),
        element: { type: "static_select", action_id: "value", options: sourceOptions },
      },
      {
        type: "input", block_id: "medium", label: plain("utm_medium"),
        element: { type: "static_select", action_id: "value", options: mediumOptions },
      },
      {
        type: "input", block_id: "content", optional: true, label: plain("utm_content (optional)"),
        element: { type: "plain_text_input", action_id: "value", max_length: 300, placeholder: plain("Creative or placement") },
      },
      {
        type: "input", block_id: "term", optional: true, label: plain("utm_term (optional)"),
        element: { type: "plain_text_input", action_id: "value", max_length: 300, placeholder: plain("Keyword or audience") },
      },
    ],
  };
}

export async function bulkUtmModal(db: Db) {
  const [presets, taxonomy] = await Promise.all([listPresets(db), listTaxonomy(db)]);
  const presetOptions = presets.filter((item) => item.verificationState !== "deprecated").slice(0, 100).map((item) => option(item.name, item.key));
  const sourceOptions = taxonomy.sources.filter((item) => item.status === "active").slice(0, 100).map((item) => option(item.label, item.slug));
  const mediumOptions = taxonomy.mediums.filter((item) => item.status === "active").slice(0, 100).map((item) => option(item.label, item.slug));
  return {
    type: "modal",
    callback_id: "utm_bulk_issue",
    title: plain("Bulk UTM request"),
    submit: plain("Start batch"),
    close: plain("Cancel"),
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: "Upload one CSV with up to 200 rows. Columns: `destination,source,medium,content,term`. Row source/medium values override the shared defaults." } },
      { type: "input", block_id: "campaign", label: plain("Campaign"), element: { type: "external_select", action_id: "value", min_query_length: 0, placeholder: plain("Search governed campaigns") } },
      { type: "input", block_id: "preset", label: plain("Platform preset"), element: { type: "static_select", action_id: "value", options: presetOptions, initial_option: presetOptions.find((item) => item.value === "generic") ?? presetOptions[0] } },
      { type: "input", block_id: "source", optional: true, label: plain("Default utm_source"), element: { type: "static_select", action_id: "value", options: sourceOptions } },
      { type: "input", block_id: "medium", optional: true, label: plain("Default utm_medium"), element: { type: "static_select", action_id: "value", options: mediumOptions } },
      { type: "input", block_id: "csv", label: plain("CSV file"), element: { type: "file_input", action_id: "value", filetypes: ["csv"], max_files: 1 } },
    ],
  };
}

export function slackStateValue(state: unknown, blockId: string): string {
  const item = (state as { values?: Record<string, Record<string, { value?: string; selected_option?: { value?: string } }>> })
    ?.values?.[blockId]?.value;
  return item?.value ?? item?.selected_option?.value ?? "";
}

export function slackStateFileId(state: unknown): string | null {
  const item = (state as { values?: Record<string, Record<string, Record<string, unknown>>> })?.values?.csv?.value;
  const candidates = item?.files ?? item?.selected_files;
  if (!Array.isArray(candidates) || !candidates.length) return null;
  const first = candidates[0];
  if (typeof first === "string") return first;
  return first && typeof first === "object" && typeof (first as { id?: unknown }).id === "string"
    ? (first as { id: string }).id
    : null;
}

export async function downloadSlackFile(fileId: string) {
  const info = await slackApi<{ file?: { name?: string; mimetype?: string; size?: number; url_private_download?: string; url_private?: string } }>("files.info", { file: fileId });
  const file = info.file;
  if (!file) throw new Error("Slack did not return the uploaded file.");
  if ((file.size ?? 0) > 1_000_000) throw new Error("Bulk CSV must be 1 MB or smaller.");
  if (file.name && !file.name.toLowerCase().endsWith(".csv")) throw new Error("Bulk upload must be a CSV file.");
  const url = file.url_private_download ?? file.url_private;
  if (!url) throw new Error("Slack did not provide a download URL for the CSV.");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` } });
  if (!response.ok) throw new Error(`Could not download Slack file (${response.status}).`);
  return response.text();
}

export function slackIdentityFromPayload(payload: Record<string, unknown>): SlackRequestIdentity {
  const user = payload.user as { id?: string } | undefined;
  const team = payload.team as { id?: string } | undefined;
  const enterprise = payload.enterprise as { id?: string } | undefined;
  if (!user?.id) throw new Error("Slack user identity is missing.");
  return { userId: user.id, teamId: team?.id ?? null, enterpriseId: enterprise?.id ?? null };
}

export async function postSlackDm(userId: string, text: string, blocks?: unknown[]) {
  return slackApi("chat.postMessage", { channel: userId, text, ...(blocks ? { blocks } : {}) });
}

export function slackErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
