# Slack User and Administration Guide

## What Slack adds

The shared **Runpod GTM Ops** Slack app gives campaign managers two low-friction UTM entry points and one GTM knowledge entry point:

| Entry point | Intended use | Result |
| --- | --- | --- |
| `/utm [destination]` | One governed URL | Opens a prefilled modal, searches governed campaigns, applies a platform preset/taxonomy, previews, checks duplicates, then issues and logs only after confirmation |
| `/utm bulk` | 1–200 URLs | Opens a CSV upload modal, applies shared campaign/preset/default fields, runs every row through the same batch service, then DMs counts and a registry link |
| Global shortcuts | The same single and bulk flows without remembering a command | “Create governed UTM” and “Bulk UTM upload” |
| Slackbot + GTM Data | Ownership, accounts, definitions, lineage, runbooks, templates, and optional UTM discovery | Calls the independent GTM Data MCP through Slack identity auth |

The Slack layer does not reimplement URL logic. The UTM Builder remains authoritative for normalization, validation, taxonomy, presets, `rpc_` campaign IDs, `rpl_` link IDs, optional `rpi_` initiative IDs, duplicate detection, registry writes, and audit events.

## Single-link workflow

1. Run `/utm`, optionally followed by a destination such as `runpod.io/serverless`.
2. Search and select an existing governed campaign.
3. Select the platform preset, source, and medium; optionally add content and term.
4. Choose **Preview**. No record is created.
5. Review the normalized URL, stable campaign ID, validation warnings, and duplicate result.
6. Choose **Issue & log**. The app returns the final governed URL and link ID.

When an exact duplicate exists, the confirmation step changes to **Record reuse**. It returns the existing URL and records the decision instead of minting a duplicate. Near duplicates are warnings and can still be issued.

## Bulk CSV workflow

Run `/utm bulk` or use **Bulk UTM upload**. The CSV supports this exact column order:

```csv
destination,source,medium,content,term
https://www.runpod.io/serverless,linkedin,paid_social,video_a,
runpod.io/gpu-cloud,reddit,paid_social,static_b,
```

The campaign and preset apply to every row. Source and medium can be shared defaults; non-empty row values override them. Slack accepts one `.csv` file up to 1 MB, and the governed application limit remains 200 rows. The modal acknowledges immediately so Slack's three-second interaction deadline is met; processing continues inside the deployed function and a direct message reports issued rows, exceptions, batch ID, and a registry link.

Every row uses `createBatch` → `issueLink`. Invalid rows and exact duplicates are isolated as row exceptions; successful siblings remain issued and logged.

## Identity and authorization

Slack requests are accepted only after HMAC verification with `SLACK_SIGNING_SECRET` and rejection of timestamps older/newer than five minutes. Production should set Runpod's enterprise ID in `SLACK_ALLOWED_ENTERPRISE_IDS`; workspace IDs can also be allowlisted.

For issuance, the app maps the signed Slack user to an active UTM Builder account:

1. preferred: `users.info` and the Slack work email;
2. fallback: `SLACK_USER_EMAIL_MAP_JSON`, for example `{"U123":"person@runpod.io"}`.

The app never auto-creates a UTM user or grants a role from Slack. Roles remain server-side in the Builder. Slack-originated link/reuse/batch actions therefore use the same permissions and immutable audit trail as the web app, API, extension, and MCP.

## Shared Slack app manifest

The canonical template is [slack/manifest.json](../slack/manifest.json). Before importing it, replace the two illustrative production domains if the approved hostnames differ:

- `https://utm.runpod.io` — slash-command and interaction endpoints;
- `https://gtm-data.runpod.io` — Slackbot MCP endpoint.

Requested bot scopes:

| Scope | Why it is needed |
| --- | --- |
| `commands` | `/utm` |
| `chat:write` | Send batch completion/failure DMs |
| `files:read` | Read the CSV selected in Slack's modal file input |
| `mcp:connect` | Declare the GTM Data MCP to Slackbot |
| `users:read`, `users:read.email` | Resolve a signed Slack user to an existing Runpod account |

Interactivity uses HTTPS request URLs; Socket Mode is intentionally disabled. `org_deploy_enabled` is true so administrators can make one internal app available across the enterprise organization.

## Deployment configuration

Add these Vercel variables to the UTM Builder project:

| Variable | Required | Purpose |
| --- | --- | --- |
| `SLACK_SIGNING_SECRET` | Yes | Verify slash-command and interaction requests |
| `SLACK_BOT_TOKEN` | Yes | Open modals, resolve profiles, download selected CSV files, and send DMs |
| `SLACK_ALLOWED_ENTERPRISE_IDS` | Production | Limit requests to the Runpod enterprise org |
| `SLACK_ALLOWED_TEAM_IDS` | Optional | Limit or supplement approved workspace IDs |
| `SLACK_USER_EMAIL_MAP_JSON` | Optional | Explicit Slack-user-to-Builder-email fallback mappings |
| `APP_URL` | Yes | Canonical Builder URL used in registry links sent to Slack |

After importing/updating the manifest:

1. set the Request URLs to the production Builder domain;
2. set the MCP server URL to the production GTM Data domain with Slack identity auth;
3. install or update the app at organization level;
4. have a Slack administrator approve scopes, the MCP server domain, and audience;
5. copy the app's signing secret and bot token into Vercel;
6. deploy both services;
7. run the smoke tests below.

The exact commercial Slack billing SKU was not visible during inspection. Internal evidence shows `runpod.enterprise.slack.com`, organization-owner sign-in, Google/Okta SSO, Slack Connect, and active **Agents & tools / AgentExchange** interfaces with installed agents. This strongly supports an Enterprise organization with the required agent/app surfaces, but an administrator still must approve the new app and MCP connection.

## Production smoke tests

1. Send an unsigned request to each Slack endpoint; expect `401`.
2. Run `/utm runpod.io` as a mapped active user; verify the modal opens.
3. Search campaigns with a partial name and select one.
4. Preview a valid URL; confirm no link is logged yet.
5. Issue it; verify `link.issued`, Slack correlation ID, stable IDs, and final URL in the registry/audit log.
6. Repeat the same inputs; verify reuse is offered and no duplicate link is issued.
7. Upload a two-row CSV with one invalid row; verify one success, one exception, a completion DM, and batch audit events.
8. Test an unmapped/inactive user and an outside-org request; both must be denied.
9. Connect GTM Data in Slackbot and call `gtm_module_status` plus one catalog search.

## Failure behavior

- Slack unavailable: web, browser extension, API, MCP clients, and existing links remain unaffected.
- UTM Builder unavailable: `/utm` fails closed; no URL is returned without a committed registry record.
- GTM Data MCP unavailable: `/utm` still works; only Slackbot GTM queries and optional MCP UTM tools fail.
- Slack profile lookup unavailable: an administrator-provided user/email mapping can preserve issuance access.
- Batch partially invalid: row errors are isolated and reported; successful rows remain committed.
- Completion DM fails after issuance: registry and audit data remain authoritative; search by batch ID in the web registry.

Official references: [Slack request verification](https://docs.slack.dev/authentication/verifying-requests-from-slack/), [slash commands](https://docs.slack.dev/interactivity/implementing-slash-commands/), [modals](https://docs.slack.dev/surfaces/modals/), [file input](https://docs.slack.dev/reference/block-kit/block-elements/file-input-element/), [Slackbot MCP Client](https://docs.slack.dev/ai/slackbot-mcp-client/), and [MCP admin approval](https://docs.slack.dev/ai/slackbot-mcp-client/admin-approval).
