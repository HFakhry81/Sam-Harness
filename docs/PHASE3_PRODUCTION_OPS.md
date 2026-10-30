# Phase 3 — Production operations

**Goal:** Durable, resumable runs; per-client isolation groundwork; full observability.

## Persistence

| Item | Behavior |
| --- | --- |
| Default DB | SQLite via Node `node:sqlite` at `SAM_OUTPUT_HOME/state/sam-harness.sqlite` |
| Override | `SAM_DATABASE_PATH` (file path or `:memory:`) |
| Optional Postgres | `DATABASE_URL=postgres://…` — migrations + kv sync; local SQLite cache keeps sync APIs |
| Repository layer | `src/lib/db/` — `kv_docs`, `runs`, `run_events`, `approvals`, `cost_entries`, checkpoints |
| Migrations | Versioned in `src/lib/db/migrations.ts` |
| JSON import | One-time import of legacy cwd `*.json` state into DB (`json_import_log`) |
| Backups | SQLite file copies under `state/backups/` (boot + `POST /api/db/backup`) |

Stores no longer write runtime JSON into the repo cwd (markdown mirrors remain best-effort).

## Durable runs

- Run records in `runs` with `thread_id`, checkpoint step, attempt, cancel flag, idempotency key.
- LangGraph review loop uses `SamSqliteSaver` (`src/lib/db/checkpointer.ts`).
- Resume: `POST /api/runs/:id/resume` + `runReviewGraph({ resume: true, threadId })`.
- Steps: `runStepWithRetry` — exponential backoff, cancel-aware, timeline events.
- Cancel: `POST /api/stop` marks durable run cancelled then kills the child.

## Multi-tenancy groundwork

- `SAM_TENANT_ID` / Control Plane tenant switcher (default `local`).
- Every DB row is tenant-scoped; queries filter by `tenant_id`.
- Non-default tenants use `SAM_OUTPUT_HOME/workspaces/<tenantId>/`.
- Per-tenant `cost_cap_usd` on `tenants` (synced from hybrid profile).

Single-owner local use is unchanged when tenant stays `local`.

## Observability

| Signal | Detail |
| --- | --- |
| Logs | `pino` with run/trace/tenant ids (`src/lib/observability/logger.ts`) |
| Traces | OpenTelemetry spans for runs / LLM / graph — exporter only if `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_ENABLED=1` |
| Metrics | In-process cost/latency/errors — `GET /api/metrics` |
| Timeline | Control Plane → **التشغيلات** + `GET /api/runs/:id/timeline` |
| Health | `GET /healthz` (no auth) |

## Owner decisions (Phase 3)

| Decision | Value |
| --- | --- |
| Email provider | **SMTP** — `EMAIL_PROVIDER=smtp` default; dry-run until `SMTP_*` set |
| Database | SQLite default + optional Postgres via `DATABASE_URL` |
| Tracing | OTel only (optional exporter); no Langfuse required |
| Tenancy target | Multi-client on one machine (groundwork); not a shared SaaS yet |

## Exit checks

- Kill/resume path covered by checkpointer + durable run tests.
- Tenant A data not visible to tenant B (`tests/persistence.test.ts`).
- Every run can emit a timeline; `/healthz` returns ok.
- No new secrets in git; `*.sqlite` gitignored.
