# Reporting Contract

The stable interface between issued URLs, GA4, HubSpot, and the warehouse. Analysts can rely on everything in this document; anything not stated here (especially name formats) is *not* contractual.

---

## 1. Identifier hierarchy

```
Initiative  (rpi_...)   optional grouping — launches, GTM motions
    └── Campaign (rpc_...)   the canonical reporting unit — carried in utm_id
            └── Link (rpl_...)   one governed URL / placement — carried in rp_link_id (policy-gated)
```

- All IDs are prefixed ULIDs: 128-bit, non-sequential, immutable. They never encode business meaning and are never reused.
- `utm_id` **is** the campaign ID. The campaign's display name and `utm_campaign` slug are human conveniences; the ID is the join key.
- The campaign→initiative mapping lives in the registry (`campaigns.initiative_id`) and is snapshotted to the warehouse — so initiative rollups never require the initiative ID to have been captured at click time.

## 2. URL parameter contract

Governed parameters, always in this order:

| Position | Param | Content | Presence |
|---|---|---|---|
| 1 | `utm_id` | Canonical campaign ID (`rpc_...`) | Always |
| 2 | `utm_source` | Canonical taxonomy source slug | Always |
| 3 | `utm_medium` | Canonical taxonomy medium slug | Always |
| 4 | `utm_campaign` | Canonical campaign slug (human-readable) | Always |
| 5 | `utm_content` | Canonicalized content value | If provided |
| 6 | `utm_term` | Canonicalized term value | If provided |
| 7 | `rp_initiative_id` | Initiative ID (`rpi_...`) | Policy-gated, default **OFF** |
| 8 | `rp_link_id` | Link ID (`rpl_...`) | Policy-gated, default **ON** |

Full example (initiative param enabled for illustration):

```
https://runpod.io/gpu-cloud?ref=partner
  &utm_id=rpc_01J9V5DQ3E8Z4Y2W1XKQGT7MNB
  &utm_source=google-ads
  &utm_medium=paid
  &utm_campaign=h100-summer-launch
  &utm_content=exact-h100
  &utm_term=h100-rental
  &rp_initiative_id=rpi_01J9V5AHXW3T9RQZKM2C4B8DFE
  &rp_link_id=rpl_01J9V5F2N7PXH6GJWB3YQ0K9SC
```

Guarantees:

- Pre-existing non-governed params (`ref=partner`) and fragments are preserved; governed params on the input destination are **replaced, never duplicated**.
- URLs are self-describing: no redirect, registry, HubSpot, or warehouse lookup happens at click time.
- Each link row records exactly which `rp_*` params it emitted, so policy changes over time stay interpretable.

## 3. GA4

### Native (no setup)

- **`utm_id` → Session campaign ID / campaign ID** (`sessionCampaignId` / `campaignId`). Campaign reporting = equality filter on this dimension.
- **`utm_campaign` → Session campaign name.** Use for display labels, not joins.

### `rp_initiative_id` custom dimension (setup required)

GA4 ignores non-utm params unless captured explicitly:

1. **GTM:** create a URL variable reading query key `rp_initiative_id`; send it as an event parameter `rp_initiative_id` on page_view (e.g. via the GA4 configuration tag's fields/parameters).
   Or **gtag:**

   ```js
   gtag('config', 'G-XXXXXXX', {
     rp_initiative_id: new URLSearchParams(location.search).get('rp_initiative_id')
   });
   ```

2. **Register the custom dimension** in GA4 Admin → Custom definitions: dimension name `rp_initiative_id`, **event-scoped**, event parameter `rp_initiative_id`.

**Caveats:** custom dimensions populate only from registration time forward (no backfill), and any capture gap (tag misconfiguration, param disabled at issuance — it is OFF by default) produces empty values. This is why the parameter is optional and the recovery path below is the contract, not the custom dimension.

### Recovery path (contractual)

Initiative attribution is always reconstructable from `utm_id` alone: `utm_id` → registry campaign → `initiative_id`. Implemented as `reconstructInitiativeReport()` in `src/services/reconciliation.ts`, which attributes each raw touch as `rp_initiative_id` (when captured), `utm_id_registry_mapping` (recovered), or `unmatched`.

## 4. Warehouse mappings

| Table | Contents | Use |
|---|---|---|
| `warehouse_snapshots` | Versioned JSON snapshots of campaigns/links/initiatives, written idempotently via the outbox on create/update | Build conformed campaign/link dimensions; reporting never joins live APIs |
| `external_campaign_mappings` | `campaign_id` ↔ external system IDs (HubSpot campaignGuid, etc.), with sync state | Join registry campaigns to HubSpot attribution objects; one non-null external ID maps to at most one campaign (DB-enforced) |
| `campaigns` | `id` (= `utm_id`), `utm_campaign` slug, `initiative_id`, lifecycle, ownership | The campaign→initiative mapping for rollups |
| `links` | Full per-link record incl. raw governed values | Per-placement dimensions; repair joins |

## 5. Raw retention guarantee

The `links` table stores, verbatim and permanently:

- `destination_raw` (exactly what the user typed) and `destination_normalized`
- `final_url` exactly as issued
- Raw `utm_id`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` values as emitted
- `rp_initiative_id_param` and `rp_link_id_param` — the `rp_*` values *actually emitted* (null when policy-disabled at issuance)
- `config_version`, revision number, preset, fingerprints

Retiring a link, revising it (prior state snapshotted in `link_revisions`), disabling taxonomy values, or changing policy never destroys these values. Any historical report can therefore be rebuilt or repaired from observed raw params + the registry.

## 6. Failure-recovery narratives

- **Custom dimension never registered / tag broken for a month:** initiative rollups are unaffected in substance — run the recovery join (§7, query C). Only touches missing `utm_id` entirely are unrecoverable.
- **HubSpot sync backlog or dead-letters:** campaign attribution in HubSpot lags, but registry reporting by `utm_id` is complete. After mappings sync (retry/reconcile), HubSpot joins backfill via `external_campaign_mappings` — the GUID is a mapping, not the identity.
- **Warehouse snapshot missing for some links:** reconciliation flags `missing_warehouse_snapshot`; an outbox retry backfills it. Raw GA4/warehouse touches remain joinable to `links`/`campaigns` directly in the meantime.
- **Registry DB restored to an earlier point:** issued URLs in the wild still carry their full identifiers; re-ingesting observed touches plus warehouse snapshots reconstructs the affected window. Run reconciliation to enumerate gaps.

## 7. Sample SQL

Table names below refer to warehouse-conformed copies of the registry tables (via `warehouse_snapshots`) plus an `observed_touches` table of raw captured params (GA4 export or equivalent: one row per session/touch with `utm_id`, `utm_campaign`, `rp_initiative_id`, `rp_link_id`, `sessions`, `conversions`).

**A. Campaign performance by exact `utm_id`:**

```sql
SELECT
  c.id            AS campaign_id,
  c.name          AS campaign_name,   -- label only, never a join key
  SUM(t.sessions)    AS sessions,
  SUM(t.conversions) AS conversions
FROM observed_touches t
JOIN campaigns c ON c.id = t.utm_id   -- exact equality on the canonical ID
WHERE t.utm_id = 'rpc_01J9V5DQ3E8Z4Y2W1XKQGT7MNB'
GROUP BY c.id, c.name;
```

**B. Launch rollup via campaign→initiative mapping:**

```sql
SELECT
  i.id   AS initiative_id,
  i.name AS initiative_name,
  SUM(t.sessions)    AS sessions,
  SUM(t.conversions) AS conversions
FROM observed_touches t
JOIN campaigns   c ON c.id = t.utm_id
JOIN initiatives i ON i.id = c.initiative_id
WHERE i.id = 'rpi_01J9V5AHXW3T9RQZKM2C4B8DFE'
GROUP BY i.id, i.name;
```

**C. Repair query for missed `rp_initiative_id` captures:**

```sql
SELECT
  t.*,
  COALESCE(t.rp_initiative_id, c.initiative_id) AS initiative_id_repaired,
  CASE
    WHEN t.rp_initiative_id IS NOT NULL THEN 'rp_initiative_id'
    WHEN c.initiative_id    IS NOT NULL THEN 'utm_id_registry_mapping'
    ELSE 'unmatched'
  END AS recovered_from
FROM observed_touches t
LEFT JOIN campaigns c ON c.id = t.utm_id;
```

**D. Reconciliation: registry vs. observed touches** (issued links never seen, and observed campaign IDs unknown to the registry):

```sql
-- Issued links with zero observed traffic in the window
SELECT l.id, l.final_url, l.issued_at
FROM links l
LEFT JOIN observed_touches t ON t.rp_link_id = l.id
WHERE l.status = 'issued'
  AND l.issued_at < CURRENT_DATE - INTERVAL '7 days'
  AND t.rp_link_id IS NULL;

-- Observed utm_id values that don't exist in the registry (rogue/hand-built tags)
SELECT t.utm_id, COUNT(*) AS touches
FROM observed_touches t
LEFT JOIN campaigns c ON c.id = t.utm_id
WHERE t.utm_id IS NOT NULL
  AND c.id IS NULL
GROUP BY t.utm_id
ORDER BY touches DESC;
```

## 8. Anti-patterns

- **Never build reporting on `utm_campaign` substring matching** (`LIKE '%launch%'`, "contains" filters). Names drift, get reused, and collide; only IDs are contractual. Name filters are for interactive exploration only.
- Don't join on HubSpot GUIDs as if they were canonical — map back to `rpc_` via `external_campaign_mappings`.
- Don't infer volume or ordering across entities from ULIDs beyond creation-time sorting.
- Don't query live application APIs from warehouse jobs — use `warehouse_snapshots`.
