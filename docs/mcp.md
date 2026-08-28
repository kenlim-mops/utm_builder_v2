# MCP Server

The remote MCP server lets approved AI clients search, preview, and create governed UTM records through the same registry services as the web app. It complements the browser extension: the extension minimizes clicks for people working in web platforms; MCP helps with conversational and multi-row preparation.

## Endpoint and authentication

- Streamable HTTP endpoint: `https://<registry-host>/api/mcp`
- Authentication: `Authorization: Bearer rpt_...`
- Create/revoke the token under **API access** in the web app; choose **MCP client**.
- The endpoint is stateless and POST-only. It requires bearer auth and does not accept a browser cookie session.

Generic client configuration:

```json
{
  "mcpServers": {
    "runpod-utm": {
      "url": "https://utm.runpod.io/api/mcp",
      "headers": {
        "Authorization": "Bearer ${RUNPOD_UTM_TOKEN}"
      }
    }
  }
}
```

Use the secret-management syntax supported by the chosen client; do not paste a production token into a checked-in configuration file.

## Tools

| Tool | Behavior |
|---|---|
| `utm_list_reference_data` | Lists initiatives, campaigns, presets, sources, and mediums |
| `utm_search_links` | Searches the canonical registry; useful before creating a possible duplicate |
| `utm_create_initiative` | Creates and audits an initiative; requires `confirmed=true` |
| `utm_create_campaign` | Creates and audits a campaign and canonical `rpc_` ID; requires `confirmed=true` |
| `utm_preview_link` | Normalizes, validates, and checks duplicates; never writes |
| `utm_issue_link` | Issues one link, mints `rpl_`, and logs it; requires confirmation and an idempotency key |
| `utm_issue_batch` | Issues 1–200 rows with row-level isolation; requires confirmation |

No MCP tool can edit governance settings, roles, audit records, or external mappings.

## Safe operating pattern

1. List reference data; never invent campaign/source/medium IDs.
2. Search for the expected destination/campaign combination.
3. Preview and show the normalized URL, warnings, and duplicates to the user.
4. Ask for explicit approval before a write.
5. For single issuance, create one stable idempotency key and reuse it only when retrying the identical request.
6. Return the registered ID and final URL from the issuance response.

`confirmed=true` is a server-enforced guard against accidental tool calls, not a substitute for the MCP client's own approval UX.

## Token operations

- Prefer a dedicated token per client/device so it can be revoked independently.
- Use the shortest practical expiry (7 or 30 days for pilots).
- Rotate before expiry and revoke the replaced token.
- Investigate unexpected `lastUsedAt` activity and revoke immediately.
- Production should migrate from personal bearer tokens to Runpod-approved OAuth when the organization selects a provider that supports MCP clients.
