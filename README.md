# Runpod UTM Builder & Registry V2

Internal tool for issuing governed campaign URLs. Campaign managers create one link or a bulk batch; every link is recorded in a single authoritative registry with stable reporting identifiers, duplicate protection, and immutable audit records.

## Why it exists

Ad-hoc UTM tagging produces unjoinable campaign names, silent duplicates, and reports built on substring matching. V2 replaces that with:

- **One canonical campaign ID** (`rpc_...`) minted by the registry and carried publicly in `utm_id`. Names can change; the ID never does.
- **One generation service.** Every entry point (single builder, bulk grid, spreadsheet paste, CSV upload, browser extension, versioned API, and MCP server) calls the same `previewLink`/`issueLink` implementation in `src/services/links.ts`. There is exactly one implementation of normalization, validation, fingerprinting, duplicate policy, and audit.
- **Self-describing URLs.** Issued links carry all identifiers in their query string. Nothing is looked up at click time — a registry outage never breaks an existing link.

## Features

- Single-link builder with live preview, validation, and duplicate detection
- Bulk issuance (grid entry, spreadsheet paste, CSV upload) up to a configurable limit (default 200 rows); row-level errors never block sibling rows
- Prefixed-ULID identifier scheme (`rpi_`, `rpc_`, `rpl_`, ... — see [ID glossary](docs/user-manual.md#id-glossary)); 128-bit, non-sequential, immutable; DB sequences never exposed
- Deterministic URL contract: `utm_id, utm_source, utm_medium, utm_campaign, utm_content?, utm_term?, rp_initiative_id?, rp_link_id?` in that order; governed params replaced, never duplicated; unrelated params and fragments preserved
- Exact-duplicate blocking via SHA-256 fingerprint + DB partial unique index; role-gated, reason-required, audited override; near-duplicate warnings
- Immutable revisions (`rpr_`) for issued links — link ID and `utm_id` never change
- Governed taxonomy (mediums, sources, aliases), destination-domain policies, platform presets — all versioned and audited
- Local/syntactic validation V2: destination safety (incl. private-network blocking), approved domains, taxonomy membership, alias resolution, source↔medium relationship, preset macros, required fields
- HubSpot campaign sync via transactional outbox (idempotent, retried with backoff, dead-lettered, reconcilable)
- Versioned registry snapshots for warehouse conformed dimensions
- Append-only audit trail with before/after diffs and secret redaction
- Roles: `user`, `admin`, `investigator` (read-only audit/integration access); all enforcement server-side
- Fail-closed issuance: a URL exists only if the registry transaction committed
- Manifest V3 Chrome side panel: capture the current page or right-click a link, preview, issue, log, and copy without leaving the platform workflow
- Supported `/api/v1` surface with bearer scopes, stable error envelopes, CORS allowlisting, OpenAPI, and idempotent single-link issuance
- Authenticated remote MCP endpoint with read, preview, search, campaign/initiative creation, single issuance, and batch issuance tools

## Ways to use it

All entry points use the same server-side generation and registry service, so validation, identifiers, duplicate rules, authorization, and audit behavior stay consistent.

| Entry point | Best for | What it adds |
|---|---|---|
| **Web application** | One-off links, bulk grids, spreadsheet paste, CSV upload, administration, and investigations | Full guided workflow, previews, exception handling, registry search, exports, and admin controls |
| **Chrome extension** | Creating a governed link while working in HubSpot, Google Ads, LinkedIn, Meta, Reddit, CM360, or another browser-based platform | Captures the current page or a selected link, then previews, issues, logs, and copies the URL from a Manifest V3 side panel without leaving the platform workflow |
| **Versioned API** | Repeatable system integrations and automation | Supported `/api/v1` endpoints, scoped bearer tokens, stable error envelopes, OpenAPI documentation, CORS allowlisting, and idempotent issuance |
| **MCP server** | Governed AI-assisted and conversational workflows | Authenticated tools for reference data, preview, search, campaign/initiative creation, and single or batch issuance; writes remain attributable to the user and normal audit trail |

The Chrome extension, API, and MCP server do not contain separate UTM logic. They call the same preview and issuance service as the web app, preventing interface-specific rules or records from drifting apart.

## Architecture

One registry, one generation API, multiple entry points:

```
  Single builder   Bulk grid / paste / CSV     /admin      Extension / API / MCP
        │                    │                    │                    │
        └────────────┬───────┴──────────┬─────────┘                │
                     ▼                  ▼                          ▼
             ┌──────────────────────────────────────────────────────────┐
             │            Next.js route handlers (/api/*)              │
             │   server-side auth (requireUser / requireRole)          │
             └───────────────────────────┬──────────────────────────────┘
                                         ▼
             ┌──────────────────────────────────────────────────────────┐
             │        Generation service  (src/services/links.ts)      │
             │  normalize → validate → fingerprint → mint IDs → commit │
             │  (fail-closed: no URL without a committed record)       │
             └───────────────┬─────────────────────────┬────────────────┘
                             ▼                         ▼
             ┌────────────────────────┐   ┌───────────────────────────┐
             │  PostgreSQL registry   │   │  Transactional outbox     │
             │  campaigns/links/      │   │  (same transaction)       │
             │  revisions/audit/...   │   └────────────┬──────────────┘
             └────────────────────────┘                │ cron worker
                                                       ▼
                                     ┌─────────────────────────────────┐
                                     │  Async integrations (retried,   │
                                     │  idempotent, dead-lettered):    │
                                     │  HubSpot campaigns, warehouse   │
                                     │  snapshots                      │
                                     └─────────────────────────────────┘
```

Issued URLs are self-describing; clicks never touch this system.

## Reporting and measurement options

V2 is designed to expand reporting choices without changing the canonical identity contract:

- **Campaign reporting:** every campaign receives an immutable `rpc_...` ID carried in the standard `utm_id` parameter. GA4 can report on that campaign ID natively, and warehouse models can join on exact equality instead of campaign-name substrings.
- **Initiative reporting:** an optional `rpi_...` initiative groups multiple campaigns into a larger launch, program, audience, product, or GTM motion. Teams can report at initiative level either by capturing the optional `rp_initiative_id` parameter or by recovering the campaign-to-initiative relationship from registry snapshots using `utm_id`.
- **Link and placement reporting:** the optional `rp_link_id` identifies the exact governed URL or placement, enabling more granular analysis than campaign-level UTMs alone.
- **HubSpot reporting:** HubSpot campaign GUIDs are synchronized asynchronously and stored as external mappings; they supplement rather than replace the Runpod campaign ID.
- **Warehouse reporting:** versioned campaign, initiative, and link snapshots support conformed dimensions, historical reconstruction, reconciliation, and reporting without querying a live application API.
- **Operational access:** the web registry, exports, versioned API, and MCP search tools provide additional ways to inspect and use governed campaign metadata.

These options are additive. Human-readable UTM names remain available for interpretation, while stable IDs provide durable joins and allow campaign-, initiative-, or link-level reporting according to the business question. See the [reporting contract](docs/reporting-contract.md) for GA4 setup, warehouse mappings, recovery paths, and sample SQL.

## Durability and failure isolation

The system assumes individual components will sometimes fail and isolates those failures so they do not cascade:

- **No click-time dependency:** issued URLs are direct and self-describing. An application, database, integration, extension, API, or MCP outage cannot interrupt traffic through existing links.
- **Fail-closed issuance:** a new URL is returned only after its registry record, identifiers, and audit event commit successfully in one database transaction.
- **Asynchronous integrations:** HubSpot and warehouse work is written to a transactional outbox, retried with exponential backoff, dead-lettered visibly, and reconcilable. An integration outage does not block link issuance.
- **Idempotent retries:** fingerprints, database constraints, outbox idempotency keys, and API idempotency prevent duplicate records when clients or workers retry.
- **Multiple reporting recovery paths:** raw identifiers remain in issued URLs and registry records, versioned snapshots feed the warehouse, and initiative membership can be reconstructed from `utm_id` even when an optional custom parameter was not captured.
- **Versioned, reversible configuration:** taxonomy, presets, destination policies, and settings are versioned and audited. Bad configuration is rolled back by applying the prior value as a new audited change; affected links remain identifiable by configuration version.
- **Separate application and data recovery:** operators can promote a previous application build for bad code releases, use PostgreSQL point-in-time recovery for data incidents, and use config/audit exports for comparison and reconstruction.
- **Health and reconciliation controls:** the health endpoint, cron/outbox status, dead-letter alerts, and reconciliation runs make silent partial failure visible.

Durability comes from independent failure domains and tested recovery paths—not from assuming every dependency will always be available. See the [deployment guide](docs/deployment-vercel.md) and [administrator incident procedures](docs/admin-manual.md#12-incident-procedures).

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router, route handlers), React 19 |
| Language | TypeScript |
| ORM / migrations | Drizzle ORM + drizzle-kit (`./drizzle`) |
| Database (prod) | PostgreSQL via `DATABASE_URL` (node-postgres) |
| Database (local dev) | PGlite — embedded Postgres (WASM) at `.data/pglite`, zero infrastructure |
| IDs | `ulidx` (prefixed ULIDs) |
| Tests | Vitest (unit / integration / API-level e2e under `tests/`) |

## Local setup

```bash
git clone <repo>
cd utm_builder_v2
npm install
npm run dev
```

No database setup required: with `DATABASE_URL` unset, the app auto-provisions an embedded PGlite database at `.data/pglite`, applies migrations, and seeds the default taxonomy, presets, destination policies, settings, and three dev identities:

| Email | Role |
|---|---|
| `dev-admin@runpod.io` | admin |
| `dev-user@runpod.io` | user |
| `dev-investigator@runpod.io` | investigator |

The dev auth provider (`AUTH_PROVIDER=dev`, the default) selects the identity from the `rp_dev_identity` cookie (set via `POST /api/session {"email": ...}`); it defaults to the dev admin and refuses to run in production.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server (PGlite auto-provisioned when `DATABASE_URL` unset) |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm test` | Run the Vitest suite once |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:generate` | Generate a new migration from schema changes (drizzle-kit) |
| `npm run db:migrate` | Apply migrations to the configured database |
| `npm run db:seed` | Apply the idempotent seed (no-op if already seeded) |
| `npm run outbox:process` | Process due outbox events once (manual/local worker run) |
| `npm run extension:check` | Validate the Chrome manifest and extension JavaScript syntax |

Health check: `GET /api/health` (checks API + database).

## Documentation

| Doc | Audience |
|---|---|
| [docs/user-manual.md](docs/user-manual.md) | Campaign managers: creating links, bulk flows, duplicates, reporting IDs |
| [docs/admin-manual.md](docs/admin-manual.md) | Administrators: taxonomy, policies, presets, roles, audit, incidents |
| [docs/deployment-vercel.md](docs/deployment-vercel.md) | Operators: Vercel setup, env vars, SSO contract, cron, backups |
| [docs/reporting-contract.md](docs/reporting-contract.md) | Analysts: ID hierarchy, GA4 setup, warehouse joins, sample SQL |
| [docs/api.md](docs/api.md) | Developers: `/api/v1`, bearer scopes, idempotency, errors, examples |
| [docs/browser-extension.md](docs/browser-extension.md) | Users/operators: extension workflow, installation, security, rollout |
| [docs/mcp.md](docs/mcp.md) | AI-tool users/operators: MCP setup, tool safety, token rotation |
| [docs/decisions.md](docs/decisions.md) | Everyone: architecture decision records and open decisions |

## Known limitations (V2)

- **Validation is syntactic only.** No HTTP fetch, render, or tag-firing checks are executed; the data model reserves those evidence kinds for later, and nothing is ever labeled "live" or "verified" without executed evidence.
- **Export-first.** No live writes to ad platforms; presets produce platform-shaped output you paste into the platform yourself.
- **HubSpot sync requires `HUBSPOT_ACCESS_TOKEN`.** Without it, sync events stay safely queued in the outbox.
- **SSO pending.** The SSO provider is a stub awaiting Runpod IdP approval; production cannot ship until it is implemented (dev provider refuses production).
- **E2E coverage is API-level**, not browser-driven.
- **Extension distribution is not automated.** The source package is ready for a private Chrome Web Store or managed-enterprise release after Runpod assigns and allowlists the production extension ID.
- **MCP currently uses personal bearer tokens.** Tokens are user-scoped, hashed at rest, expire within 90 days, and can be revoked; replace with organization-standard OAuth when that provider is approved.

## Failure domains

| Failure | Existing links | New issuance | Recovery / containment |
|---|---|---|---|
| Web application or bad deployment | Unaffected | Temporarily unavailable or paused | Promote the previous verified build; the database and existing links are untouched |
| Registry database unavailable | Unaffected — URLs are self-describing | Blocked (fails closed) | Restore service/fail over; no URL is handed out without a committed registry record |
| Bad database migration or data change | Unaffected | Paused until integrity is verified | Use provider point-in-time recovery only for data incidents, then reconcile HubSpot and warehouse state |
| Bad taxonomy, preset, destination, or settings change | Unaffected | Pause affected issuance | Reapply the audited prior configuration; identify affected links by configuration version |
| HubSpot unavailable or token missing | Unaffected | Unaffected | Events queue in the outbox, retry with backoff, dead-letter visibly, and remain reconcilable |
| Warehouse ingestion unavailable | Unaffected | Unaffected | Snapshot events queue; reconciliation identifies and backfills missing snapshots |
| Outbox worker or cron unavailable | Unaffected | Unaffected | Events accumulate as `pending` and process when the worker resumes or through a manual run |
| Chrome extension unavailable | Unaffected | Web, API, or MCP entry points remain available | The extension is a client of the shared service, not a separate registry |
| API or MCP client unavailable | Unaffected | Other approved entry points remain available | All interfaces share the same records and generation rules |
| Optional GA4 custom parameter not captured | Unaffected | Unaffected | Recover initiative membership from `utm_id` through registry/warehouse campaign mappings |
