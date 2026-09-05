import { getDb } from "@/db/client";
import {
  bulkUtmModal,
  resolveSlackActor,
  singleUtmModal,
  slackApi,
  slackErrorMessage,
  slackIdentityAllowed,
  verifySlackRequest,
} from "@/services/slack";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rawBody = await req.text();
  if (!verifySlackRequest({
    rawBody,
    timestamp: req.headers.get("x-slack-request-timestamp"),
    signature: req.headers.get("x-slack-signature"),
    signingSecret: process.env.SLACK_SIGNING_SECRET,
  })) return new Response("Invalid Slack signature.", { status: 401 });

  const form = new URLSearchParams(rawBody);
  const identity = {
    userId: form.get("user_id") ?? "",
    teamId: form.get("team_id"),
    enterpriseId: form.get("enterprise_id"),
  };
  if (!identity.userId || !slackIdentityAllowed(identity)) return new Response("Slack workspace is not allowed.", { status: 403 });
  // Require a mapped, active registry account before serving any modal or
  // registry-derived data (campaigns, taxonomy, presets).
  try {
    await resolveSlackActor(await getDb(), identity);
  } catch (error) {
    return Response.json({
      response_type: "ephemeral",
      text: `You do not have UTM Builder access: ${slackErrorMessage(error)}`,
    });
  }
  const text = (form.get("text") ?? "").trim();
  const isBulk = /^bulk(?:\s|$)/i.test(text);
  const destination = isBulk ? "" : text.replace(/^single\s+/i, "");
  const view = isBulk ? await bulkUtmModal(await getDb()) : await singleUtmModal(await getDb(), destination);
  await slackApi("views.open", { trigger_id: form.get("trigger_id"), view });
  return new Response("", { status: 200 });
}
