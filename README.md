# Runpod UTM Builder & Registry V2

Internal tool for issuing governed campaign URLs. Campaign managers create one link or a bulk batch; every link is recorded in a single authoritative registry with stable reporting identifiers, duplicate protection, and immutable audit records.

## Why it exists

Ad-hoc UTM tagging produces unjoinable campaign names, silent duplicates, and reports built on substring matching. V2 replaces that with:

- **One canonical campaign ID** (`rpc_...`) minted by the registry and carried publicly in `utm_id`. Names can change; the ID never does.
- **One generation service.** Every entry point (single builder, bulk grid, spreadsheet paste, CSV upload, future integrations) calls the same `previewLink`/`issueLink` implementation in `src/services/links.ts`. There is exactly one implementation of normalization, validation, fingerprinting, duplicate policy, and audit.
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

## Architecture

One registry, one generation API, multiple entry points:

```
  Single builder   Bulk grid / paste / CSV     /admin        Future clients
        │                    │                    │        (browser helper, APIs)
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

Health check: `GET /api/health` (checks API + database).

## Documentation

| Doc | Audience |
|---|---|
| [docs/user-manual.md](docs/user-manual.md) | Campaign managers: creating links, bulk flows, duplicates, reporting IDs |
| [docs/admin-manual.md](docs/admin-manual.md) | Administrators: taxonomy, policies, presets, roles, audit, incidents |
| [docs/deployment-vercel.md](docs/deployment-vercel.md) | Operators: Vercel setup, env vars, SSO contract, cron, backups |
| [docs/reporting-contract.md](docs/reporting-contract.md) | Analysts: ID hierarchy, GA4 setup, warehouse joins, sample SQL |
| [docs/decisions.md](docs/decisions.md) | Everyone: architecture decision records and open decisions |

## Known limitations (V2)

- **Validation is syntactic only.** No HTTP fetch, render, or tag-firing checks are executed; the data model reserves those evidence kinds for later, and nothing is ever labeled "live" or "verified" without executed evidence.
- **Export-first.** No live writes to ad platforms; presets produce platform-shaped output you paste into the platform yourself.
- **HubSpot sync requires `HUBSPOT_ACCESS_TOKEN`.** Without it, sync events stay safely queued in the outbox.
- **SSO pending.** The SSO provider is a stub awaiting Runpod IdP approval; production cannot ship until it is implemented (dev provider refuses production).
- **E2E coverage is API-level**, not browser-driven.

## Failure domains

| Failure | Existing links | New issuance | Notes |
|---|---|---|---|
| Registry (DB) down | Unaffected — URLs are self-describing | Blocked (fails closed) | No URL is ever handed out without a committed record |
| HubSpot down / token missing | Unaffected | Unaffected | Sync events queue in the outbox; retried with backoff; dead-lettered after max attempts; reconcilable |
| Warehouse ingestion down | Unaffected | Unaffected | Snapshot events queue in the outbox; reconciliation flags missing snapshots |
| Outbox worker (cron) down | Unaffected | Unaffected | Events accumulate as `pending`; processed when the worker resumes or via manual run |
