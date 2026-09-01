# GTM Source Reconciliation

Source reconciliation detects changes in internal sources—initially Notion—without making those sources capable of silently overwriting governed GTM data.

## Why this is reconciliation, not synchronization

Internal knowledge has overlapping authority. A Notion owner directory may be authoritative for a person's team, but not for a platform account ID; the GTM registry may be authoritative for a data field, while Notion carries the explanatory runbook. Blind two-way synchronization would turn an accidental edit into trusted operating metadata.

The pipeline is therefore:

```text
source scan → normalize → preserve evidence → hash/compare → propose diff
                                                        ├─ review → apply/reject
                                                        └─ safe allowlisted auto-apply
```

Every source row/page is retained with external ID, URL, payload, content hash, source update time, and last-seen time. Proposals preserve before/after values and a field-level diff. Applied changes use the same versioned catalog and append-only audit trail as manual changes.

## Notion connector setup

In **Admin → GTM Data MCP → Source connectors**, create a connector with:

- a stable connector key and display name;
- the Notion data source ID;
- the target catalog record type;
- the title, key, and optional summary property names;
- a JSON mapping from Notion property names to catalog attribute keys;
- a scan interval (minimum five minutes; hourly is the default);
- credential reference `env:NOTION_API_TOKEN`.

New connectors are created `paused`, with `autoApply=false`. An administrator should run a manual scan, review sample proposals, and verify property mapping before activating it.

Example mapping:

```json
{
  "Account ID": "accountId",
  "Account rep": "accountRep",
  "CSM": "csm",
  "APIs in use": "apis",
  "Escalation channel": "escalationChannel"
}
```

The integration token must be stored as `NOTION_API_TOKEN` in Vercel. Share each source data source with the Notion integration. The implementation uses Notion's current data-source query endpoint and `last_edited_time` filtering after the first successful scan; Notion recommends webhooks to reduce polling where real-time responsiveness is needed. See [Query a data source](https://developers.notion.com/reference/query-a-data-source) and [Notion webhooks](https://developers.notion.com/reference/webhooks).

## Scheduling and overlap safety

Vercel invokes `/api/source-sync` hourly at minute 17. The route accepts only `Authorization: Bearer $CRON_SECRET` or `$SOURCE_SYNC_TOKEN`.

Each invocation selects active connectors whose configured interval has elapsed. A database lease prevents overlapping scans of the same connector. Incremental scans deliberately overlap the prior successful checkpoint by five minutes to tolerate source indexing/clock skew; content hashes make repeated pages idempotent, and a newer source version supersedes an older pending proposal. This is important because scheduled jobs can overlap or be delivered more than once; see [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs) and [Managing cron jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

## Review and application

The **Detected updates** table shows:

- connector and external source identity;
- create/update/deactivate intent;
- field-level difference;
- source URL;
- proposal status and timestamp.

Approval and rejection require a reason and are audited. Approval is optimistic: if the catalog record changed after the proposal was created, the proposal is marked superseded/conflicted and must be regenerated. Deletion from a source never deletes catalog history; it proposes an `inactive` lifecycle.

## Auto-apply policy

Auto-apply is off by default. Enabling it requires both:

1. `autoApply=true` on the connector; and
2. an explicit allowlist of authoritative top-level fields.

Only updates to an existing matched record can auto-apply. New records still require review. If any changed field is outside the allowlist, the entire source change becomes a proposal. Never allowlist `attributes` merely to authorize one nested attribute; use review-first mode until attribute-level policy is introduced.

Recommended initial policy: keep every connector review-first for at least two clean review cycles, then consider narrow fields such as `name` or `summary`. Do not auto-apply lifecycle, sensitivity, ownership relationships, account IDs, or data definitions without separate owner approval.

## Connector states and failure behavior

- `paused`: ignored by schedule; manual scans are allowed for testing.
- `active`: considered by the scheduled job when due.
- `error`: reserved for an administrator to deliberately quarantine a connector.

Transient scan failures set `lastError` and record a failed sync run but do not disable an active connector, so the next schedule retries it. Existing catalog data remains unchanged. A Notion outage or bad token therefore affects freshness detection only; it cannot delete or corrupt the GTM registry.

## Adding another source

Implement a `SourceAdapter` that returns normalized candidates and a checkpoint, then register it in `syncSourceConnector`. Preserve the same controls:

- credentials referenced, not stored;
- pagination and incremental checkpoints;
- source evidence retained;
- deterministic content hash;
- connector lease;
- proposals by default;
- explicit field authority for auto-apply;
- reasoned, audited decisions;
- no hard delete from external source state.
