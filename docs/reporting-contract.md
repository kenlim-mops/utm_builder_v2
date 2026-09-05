# Reporting Contract

The stable interface between governed URLs, GA4, PostHog, HubSpot, Snowflake, and Mode. Analysts may rely on the identifiers and relationships below. Names and label formats are descriptive, not durable join keys.

## 1. Identifier hierarchy

```text
Initiative  (rpi_...)       optional launch / GTM-motion grouping
    └── Campaign (rpc_...)  canonical reporting unit; emitted as utm_id
            └── Link (rpl_...)  exact governed URL/placement; optionally emitted as rp_link_id
```

- IDs are immutable, non-sequential prefixed ULIDs and are never reassigned.
- `utm_id` equals the registry campaign ID. `utm_campaign` is a human-readable slug.
- Campaign-to-initiative membership is stored in the registry and its snapshots. Initiative rollups are recoverable from `utm_id` even when `rp_initiative_id` was not captured.
- `rp_link_id` supports URL/placement-level QA. It is not a platform click ID and does not replace `gclid`, `fbclid`, or equivalent identifiers.

## 2. URL and capture contract

| Parameter | Meaning | URL presence | GA4 | PostHog | Snowflake role |
|---|---|---|---|---|---|
| `utm_id` | `rpc_` campaign ID | Always | Native campaign ID | Explicitly persist as `utm_id` and `initial_utm_id` | Primary governed campaign join |
| `utm_source` | Governed source slug | Always | Native source | Persist observed and initial value | Channel dimension |
| `utm_medium` | Governed medium slug | Always | Native medium | Persist observed and initial value | Channel dimension |
| `utm_campaign` | Human campaign slug | Always | Native campaign name | Persist observed and initial value | Label/diagnostic, not primary join |
| `utm_content` | Creative/content distinction | When supplied | Native ad content | Persist observed value | Creative breakdown |
| `utm_term` | Keyword/targeting distinction | When supplied | Native term | Persist observed value | Search/targeting breakdown |
| `rp_initiative_id` | `rpi_` initiative ID | Policy-gated; default off | Custom event dimension | Explicitly persist when present | Direct initiative evidence; registry mapping remains fallback |
| `rp_link_id` | `rpl_` governed link ID | Policy-gated; default on | Custom event dimension if needed | Explicitly persist when present | Placement/link join and QA |

The builder replaces pre-existing governed keys rather than duplicating them, preserves unrelated parameters and fragments, and returns direct landing URLs. No click-time registry lookup occurs.

## 3. Measurement implementation

### GA4

GA4 recognizes `utm_id` as campaign ID and standard UTM fields as manual traffic-source dimensions. Runpod must still test actual collection and reporting scope in its property, especially where ad-platform auto-tagging is also present.

For `rp_initiative_id` and `rp_link_id`, read the query parameter on the first landing page, attach it to the relevant GA4 event(s), and register event-scoped custom dimensions if UI reporting is required. Custom definitions are forward-only; Snowflake recovery must not depend on them.

Required GA4 QA evidence for each pilot channel:

1. browser/network event shows the original `page_location` and expected parameters;
2. DebugView/realtime evidence shows campaign ID and required custom event parameters;
3. exported/ingested GA4 row retains the observed campaign ID;
4. Snowflake row joins that value to exactly one registry campaign.

Google recommends setting the relevant UTM set together and documents `utm_id` as the campaign identifier. See [Google Analytics manual tagging](https://support.google.com/analytics/answer/11242870?hl=en) and [URL parameter guidance](https://support.google.com/analytics/answer/10917952?hl=en).

### PostHog

Do not assume that a custom query parameter is automatically retained with the desired first-touch/session semantics. The marketing-site implementation must explicitly parse governed parameters at landing and attach them to the landing `$pageview` (or a dedicated `marketing landing viewed` event). It should then:

- use event properties for the observed landing values: `utm_id`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `rp_initiative_id`, `rp_link_id`, and `landing_url`;
- register current-session campaign properties when downstream events need the same touch context;
- use one-time properties such as `initial_utm_id` for first-touch analysis, without overwriting them on later visits;
- clear or intentionally refresh session-level values at the agreed session boundary;
- preserve the raw landing URL so lost or malformed parsing can be repaired.

PostHog documents event properties, super properties, and `register_once`; these are implementation primitives, not evidence that the Runpod site already captures the contract. See [PostHog JavaScript usage](https://posthog.com/docs/libraries/js/usage).

Required PostHog QA evidence mirrors GA4: captured event payload, PostHog event/property visibility, downstream export visibility, and exact Snowflake registry join.

### HubSpot

HubSpot campaign GUID is an external mapping, not the canonical identity. `external_campaign_mappings` maintains `rpc_ campaign_id ↔ HubSpot campaignGuid` with sync state. A HubSpot outage may delay that mapping but must not change `utm_id` or block issued traffic.

## 4. Delivery boundary: application PostgreSQL is not Snowflake

The application currently creates versioned snapshot rows in its own PostgreSQL `warehouse_snapshots` table through the transactional outbox. That is a durable staging boundary. **This repository does not implement or operate the final PostgreSQL-to-Snowflake transfer.**

Before production reporting, Runpod must approve and operate a delivery job or managed connector with:

- incremental watermark plus overlap window;
- idempotent merge/deduplication by snapshot ID and entity version;
- raw payload retention and load metadata;
- retry/dead-letter visibility;
- schema-change handling;
- freshness and completeness monitoring;
- a named owner and backfill runbook.

The outbox event being `succeeded` proves the PostgreSQL snapshot was written. It does not prove Snowflake or Mode received it.

## 5. Recommended Snowflake layers

| Layer/object | Grain and purpose |
|---|---|
| `RAW.UTM_REGISTRY_SNAPSHOTS` | One delivered application snapshot; immutable raw JSON plus load metadata |
| `RAW.GA4_EVENTS` | Existing GA4 export/ingestion grain; preserve campaign fields and page location |
| `RAW.POSTHOG_EVENTS` | Existing PostHog export/ingestion grain; preserve event properties and landing URL |
| `GOVERNANCE.LEGACY_UTM_CROSSWALK` | One approved time-bounded historical mapping; see migration guide |
| `ANALYTICS.DIM_GTM_INITIATIVE` | One current initiative plus history strategy |
| `ANALYTICS.DIM_GTM_CAMPAIGN` | One `rpc_` campaign with initiative and external mappings |
| `ANALYTICS.DIM_GTM_LINK` | One `rpl_` link/revision context |
| `ANALYTICS.FCT_MARKETING_TOUCH` | One analytically defined touch/event/session with raw and resolved identifiers |
| `ANALYTICS.UTM_DATA_QUALITY_DAILY` | Daily adoption, capture, join, invalid-ID, rogue-tag, and freshness measures |

Dimension models must be deterministic and re-runnable. Preserve `valid_from`, `valid_to`, `is_current`, source snapshot version, and ingestion timestamp where history matters. Reject one-to-many matches for `rpc_` and `rpl_` as data-quality failures.

## 6. Conformed touch fields

Every downstream touch model should expose:

- source event/session identifier and timestamp;
- `source_system` (`ga4`, `posthog`, or another approved producer);
- raw landing URL and all raw observed UTM/`rp_*` values;
- `observed_campaign_id` and `observed_link_id` exactly as captured;
- `resolved_campaign_id`, `resolved_initiative_id`, and `resolved_link_id` after registry resolution;
- `resolution_method`: `observed_utm_id`, `registry_campaign_mapping`, `legacy_crosswalk`, or `unmatched`;
- `governance_status`: `governed_v2`, `legacy_mapped`, `legacy_unmapped`, `unregistered`, or `invalid_id`;
- source/medium taxonomy status and registry snapshot version used;
- business metrics appropriate to the grain (sessions, events, signups, pipeline, revenue), without mixing grains.

Resolution order: valid observed `utm_id` → campaign dimension → initiative relationship. Use the historical crosswalk only for records without a valid V2 identity. Never use `utm_campaign LIKE '%...%'` as the default attribution join.

## 7. Mode contract

Mode reports should query certified Snowflake views, not the live application API or PostgreSQL. Publish at least:

1. campaign performance keyed by `resolved_campaign_id`;
2. initiative rollup keyed by `resolved_initiative_id`;
3. cross-source GA4/PostHog capture and metric reconciliation;
4. UTM operating-quality scorecard;
5. exceptions for unknown `rpc_`, missing `utm_id`, invalid taxonomy, and unobserved issued links.

Every report must display data freshness, source systems, governance-status filters, and metric grain. Human-readable campaign and initiative names are labels fetched from the dimensions.

## 8. Quality checks and operating thresholds

| Check | Pilot threshold | Failure owner |
|---|---|---|
| Registry snapshot freshness in Snowflake | Within agreed SLA; recommended ≤4 hours for pilot | Data platform |
| Valid observed `rpc_` joins | ≥98%; never one-to-many | Analytics + MOPS |
| GA4 governed-landing `utm_id` capture | ≥98% | Analytics implementation owner |
| PostHog governed-landing `utm_id` capture | ≥98% | Analytics implementation owner |
| Unknown `rpc_` identifiers | 0 expected; every occurrence triaged | MOPS |
| Exact duplicate issuance | 0 non-overrides | MOPS |
| Campaign duplicate overrides | 100% have admin, reason, and candidate IDs | MOPS |
| Cross-source volume variance | Threshold defined per comparable grain before pilot | Analytics |

The scorecard denominator must be explicit. For capture completeness, use known governed landing URLs/IDs rather than all site traffic.

## 9. Recovery narratives

- If a GA4 custom dimension or PostHog custom property is missed, recover initiative membership from captured `utm_id` and the campaign dimension. If `utm_id` itself was not captured, use raw landing URL only as repair evidence and label the result accordingly.
- If HubSpot sync lags, reporting by `utm_id` remains available. Backfill the external mapping after retry/reconciliation.
- If PostgreSQL snapshots exist but Snowflake is stale, replay the delivery job idempotently; do not mark the application outbox as evidence of Snowflake delivery.
- If the registry is restored, existing links keep working. Reconcile observed IDs, snapshots, and audit history before resuming issuance.
- For pre-V2 traffic, apply the confidence-scored process in [historical-migration.md](historical-migration.md).

## 10. Example Snowflake SQL

Campaign and initiative performance use exact ID joins:

```sql
select
  c.campaign_id,
  c.campaign_name,
  c.initiative_id,
  i.initiative_name,
  count_if(t.source_system = 'ga4') as ga4_touches,
  count_if(t.source_system = 'posthog') as posthog_touches,
  sum(t.pipeline_amount) as pipeline_amount
from analytics.fct_marketing_touch t
join analytics.dim_gtm_campaign c
  on c.campaign_id = t.resolved_campaign_id
left join analytics.dim_gtm_initiative i
  on i.initiative_id = c.initiative_id
where t.governance_status = 'governed_v2'
group by 1, 2, 3, 4;
```

Unknown or malformed governed identifiers become an operating queue:

```sql
select
  source_system,
  observed_campaign_id,
  count(*) as touch_count,
  min(touch_at) as first_seen,
  max(touch_at) as last_seen
from analytics.fct_marketing_touch
where governance_status in ('unregistered', 'invalid_id')
group by 1, 2
order by touch_count desc;
```

## 11. Anti-patterns

- Do not join on campaign names, substrings, HubSpot GUIDs, or platform labels when a stable Runpod ID is available.
- Do not overwrite raw observed parameters with normalized values.
- Do not claim PostHog/GA4 capture because the URL was generated correctly; inspect the emitted event and downstream row.
- Do not claim Snowflake delivery because a PostgreSQL snapshot or outbox success exists.
- Do not combine GA4 sessions, PostHog events, and pipeline records without declaring and reconciling grain.
- Do not query live application APIs from Mode.
