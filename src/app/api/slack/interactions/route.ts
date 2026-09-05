import { after } from "next/server";
import { getDb } from "@/db/client";
import { parseCsv } from "@/core/csv";
import { createBatch } from "@/services/batches";
import { listCampaigns } from "@/services/campaigns";
import { issueLink, previewLink, recordReuse, type LinkRequest } from "@/services/links";
import {
  bulkUtmModal,
  downloadSlackFile,
  postSlackDm,
  resolveSlackActor,
  singleUtmModal,
  slackApi,
  slackErrorMessage,
  slackIdentityAllowed,
  slackIdentityFromPayload,
  slackStateFileId,
  slackStateValue,
  verifySlackRequest,
} from "@/services/slack";

export const dynamic = "force-dynamic";

const plain = (text: string) => ({ type: "plain_text" as const, text: text.slice(0, 75) });
const json = (value: unknown, status = 200) => Response.json(value, { status });

function linkInput(state: unknown): LinkRequest {
  return {
    destination: slackStateValue(state, "destination"),
    campaignId: slackStateValue(state, "campaign"),
    presetKey: slackStateValue(state, "preset") || "generic",
    utmSource: slackStateValue(state, "source"),
    utmMedium: slackStateValue(state, "medium"),
    utmContent: slackStateValue(state, "content") || null,
    utmTerm: slackStateValue(state, "term") || null,
  };
}

function confirmationView(input: LinkRequest, preview: Awaited<ReturnType<typeof previewLink>>) {
  const exact = preview.duplicates.exact;
  const warnings = preview.validation.findings.filter((item) => item.severity === "warning");
  const metadata = JSON.stringify({ mode: exact ? "reuse" : "issue", input, existingLinkId: exact?.linkId ?? null });
  return {
    type: "modal",
    callback_id: "utm_single_issue",
    private_metadata: metadata,
    title: plain(exact ? "Duplicate found" : "Confirm governed UTM"),
    submit: plain(exact ? "Record reuse" : "Issue & log"),
    close: plain("Cancel"),
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: exact
        ? `An identical governed URL already exists. Reuse and record that decision:\n<${exact.finalUrl}|Open existing governed URL>`
        : `<${preview.finalUrlPreview}|Open URL preview>\n\n*Campaign ID:* \`${preview.utm?.utm_id}\`` } },
      ...(warnings.length ? [{ type: "section", text: { type: "mrkdwn", text: `*Warnings*\n${warnings.map((item) => `• ${item.message}`).join("\n").slice(0, 2700)}` } }] : []),
      { type: "context", elements: [{ type: "mrkdwn", text: "No registry record is created until you confirm. Exact duplicates are reused, not reissued." }] },
    ],
  };
}

function successView(title: string, message: string) {
  return { type: "modal", callback_id: "utm_complete", title: plain(title), close: plain("Done"), blocks: [{ type: "section", text: { type: "mrkdwn", text: message.slice(0, 2950) } }] };
}

function bulkRows(csv: string, campaignId: string, presetKey: string, defaultSource: string, defaultMedium: string) {
  const parsed = parseCsv(csv);
  if (!parsed.length) throw new Error("The CSV is empty.");
  const expected = ["destination", "source", "medium", "content", "term"];
  const first = parsed[0].map((cell) => cell.trim().toLowerCase());
  const hasHeader = first[0] === "destination" || first[0] === "url";
  const body = hasHeader ? parsed.slice(1) : parsed;
  if (hasHeader && first.some((value, index) => value && value !== expected[index] && !(index === 0 && value === "url"))) {
    throw new Error("CSV columns must be destination,source,medium,content,term in that order.");
  }
  return body.filter((row) => row.some((cell) => cell.trim())).map((row) => ({
    destination: row[0]?.trim() ?? "",
    campaignId,
    presetKey,
    utmSource: row[1]?.trim() || defaultSource,
    utmMedium: row[2]?.trim() || defaultMedium,
    utmContent: row[3]?.trim() || null,
    utmTerm: row[4]?.trim() || null,
  }));
}

async function handlePayload(payload: Record<string, unknown>) {
  const identity = slackIdentityFromPayload(payload);
  if (!slackIdentityAllowed(identity)) return new Response("Slack workspace is not allowed.", { status: 403 });
  // Every interaction type — including typeahead and modal opens — requires a
  // mapped registry account, so workspace members without UTM Builder access
  // cannot enumerate campaigns, presets, or taxonomy.
  try {
    await resolveSlackActor(await getDb(), identity);
  } catch (error) {
    if (payload.type === "block_suggestion") return json({ options: [] });
    if (payload.type === "view_submission") {
      return json({
        response_action: "errors",
        errors: { destination: `You do not have UTM Builder access: ${slackErrorMessage(error)}`.slice(0, 200) },
      });
    }
    await postSlackDm(identity.userId, `You do not have UTM Builder access: ${slackErrorMessage(error)}`).catch(() => undefined);
    return new Response("", { status: 200 });
  }
  if (payload.type === "block_suggestion") {
    const value = ((payload.value as string | undefined) ?? "").trim().toLowerCase();
    const campaigns = (await listCampaigns(await getDb()))
      .filter((campaign) => campaign.lifecycle !== "archived")
      .filter((campaign) => !value || campaign.name.toLowerCase().includes(value) || campaign.utmCampaign.includes(value) || campaign.id.toLowerCase().includes(value))
      .slice(0, 100);
    return json({ options: campaigns.map((campaign) => ({ text: plain(`${campaign.name} · ${campaign.id}`), value: campaign.id })) });
  }

  if (payload.type === "shortcut") {
    const view = payload.callback_id === "utm_bulk_upload"
      ? await bulkUtmModal(await getDb())
      : await singleUtmModal(await getDb());
    await slackApi("views.open", { trigger_id: payload.trigger_id, view });
    return new Response("", { status: 200 });
  }

  if (payload.type !== "view_submission") return new Response("", { status: 200 });
  const view = payload.view as { id?: string; callback_id?: string; state?: unknown; private_metadata?: string };
  if (view.callback_id === "utm_single_preview") {
    const input = linkInput(view.state);
    try {
      const preview = await previewLink(await getDb(), input);
      const errors = preview.validation.findings.filter((item) => item.severity === "error" && item.code !== "exact_duplicate");
      if (errors.length) {
        const byBlock: Record<string, string> = {};
        for (const finding of errors) {
          const block = finding.field === "utm_source" ? "source" : finding.field === "utm_medium" ? "medium" : finding.field === "destination" ? "destination" : "destination";
          byBlock[block] = [byBlock[block], finding.message].filter(Boolean).join(" ").slice(0, 200);
        }
        return json({ response_action: "errors", errors: byBlock });
      }
      return json({ response_action: "update", view: confirmationView(input, preview) });
    } catch (error) {
      return json({ response_action: "errors", errors: { destination: slackErrorMessage(error).slice(0, 200) } });
    }
  }

  if (view.callback_id === "utm_single_issue") {
    try {
      const metadata = JSON.parse(view.private_metadata ?? "{}") as { mode?: string; input?: LinkRequest; existingLinkId?: string };
      const db = await getDb();
      const actor = await resolveSlackActor(db, identity);
      if (metadata.mode === "reuse" && metadata.existingLinkId) {
        await recordReuse(db, actor, metadata.existingLinkId);
        return json({ response_action: "update", view: successView("Existing URL reused", `Reuse was recorded in the audit log for \`${metadata.existingLinkId}\`.`) });
      }
      if (!metadata.input) throw new Error("The preview request expired. Start again with /utm.");
      const result = await issueLink(db, actor, {
        ...metadata.input,
        idempotencyKey: `slack:${identity.userId}:${view.id ?? "submission"}`,
        correlationId: `slack:${view.id ?? "submission"}`,
      });
      return json({ response_action: "update", view: successView("UTM issued", `<${result.link.finalUrl}|Open governed URL>\n\n*Link ID:* \`${result.link.id}\`\n*Campaign ID:* \`${result.link.utmId}\``) });
    } catch (error) {
      return json({ response_action: "update", view: successView("Could not issue URL", `${slackErrorMessage(error)}\n\nNo registry record was created.`) });
    }
  }

  if (view.callback_id === "utm_bulk_issue") {
    const campaignId = slackStateValue(view.state, "campaign");
    const presetKey = slackStateValue(view.state, "preset") || "generic";
    const defaultSource = slackStateValue(view.state, "source");
    const defaultMedium = slackStateValue(view.state, "medium");
    const fileId = slackStateFileId(view.state);
    if (!fileId) return json({ response_action: "errors", errors: { csv: "Choose one CSV file." } });
    after(async () => {
      try {
        const db = await getDb();
        const actor = await resolveSlackActor(db, identity);
        const csv = await downloadSlackFile(fileId);
        const rows = bulkRows(csv, campaignId, presetKey, defaultSource, defaultMedium);
        const result = await createBatch(db, actor, rows, "csv");
        const appUrl = (process.env.APP_URL ?? "https://utm.runpod.io").replace(/\/$/, "");
        await postSlackDm(identity.userId, `UTM batch ${result.batchId} completed: ${result.succeeded} issued, ${result.failed} exceptions.`, [
          { type: "section", text: { type: "mrkdwn", text: `*UTM batch complete*\n${result.succeeded} issued · ${result.failed} exceptions\nBatch ID: \`${result.batchId}\`` } },
          { type: "actions", elements: [{ type: "button", text: plain("Review batch"), url: `${appUrl}/registry?batchId=${encodeURIComponent(result.batchId)}`, action_id: "open_batch" }] },
        ]);
      } catch (error) {
        await postSlackDm(identity.userId, `UTM batch failed: ${slackErrorMessage(error)}`);
      }
    });
    return json({ response_action: "update", view: successView("Batch accepted", "Your CSV is being validated and issued through the governed registry. Results and exceptions will arrive in a direct message.") });
  }
  return new Response("", { status: 200 });
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  if (!verifySlackRequest({
    rawBody,
    timestamp: req.headers.get("x-slack-request-timestamp"),
    signature: req.headers.get("x-slack-signature"),
    signingSecret: process.env.SLACK_SIGNING_SECRET,
  })) return new Response("Invalid Slack signature.", { status: 401 });
  const form = new URLSearchParams(rawBody);
  try {
    return await handlePayload(JSON.parse(form.get("payload") ?? "{}") as Record<string, unknown>);
  } catch (error) {
    return json({ response_action: "errors", errors: { destination: slackErrorMessage(error).slice(0, 200) } });
  }
}
