# Phase 6 — Verifiable gates & trust

**Goal:** No silent success. Every plan/task step has explicit acceptance checks; risky actions need human approval; actions/gates/approvals/costs are recorded in a tamper-evident audit log; each run leaves an evidence bundle under `SAM_OUTPUT_HOME`.

## Architecture

```text
plan / tool step
      │
      ▼
src/lib/trust/
  ├─ config.ts      policy (env + trust-policy.json)
  ├─ gates.ts       command / file / desktop postcondition checks
  ├─ approvals.ts   HITL for destructive FS, email, spend, sensitive desktop
  ├─ auditLog.ts    hash-chained SQLite audit_log (migration v3)
  └─ evidence.ts    runs/<day>/<runId>/evidence/ + reports/ mirror
      │
      ▼
Control Plane /api/trust/*  ·  pnpm run trust:*
```

## Quality gates

A step is **never** marked done until all gates pass. Failed gates retry (`SAM_TRUST_GATE_RETRIES`, default 2 → 3 attempts) then **escalate** — they do not become success.

| Kind | Purpose |
| --- | --- |
| `command` / `typecheck` / `lint` / `test` | Shell exit code 0 (defaults: `pnpm run typecheck`, `pnpm test`) |
| `file_exists` / `file_absent` / `file_contains` | Output assertions |
| `output_match` | Match against step stdout/summary |
| `desktop_postcondition` | Phase 4 verify expectations after a desktop action |

API: `assertStepDone({ runId, stepId, gates })` → `{ done, result }`. Empty gate lists refuse silent success.

## Approval policy

| Risk | Default | Auto-approve env |
| --- | --- | --- |
| Destructive FS **outside** cwd / `SAM_OUTPUT_HOME` | Require approval | `APPROVE_DESTRUCTIVE=1` or `APPROVE_TRUST=1` |
| Email send (SMTP/Resend) | Require + existing `APPROVE_COMMS` | `APPROVE_COMMS=1` |
| Cloud charge **>** `SAM_TRUST_SPEND_APPROVAL_USD` (default $0.25) | Require approval | `APPROVE_SPEND=1` |
| Desktop on sensitive apps (Outlook, bank, password managers, …) | Require approval | `APPROVE_DESKTOP=1` |
| Desktop destructive/financial/sending (Phase 4) | Unchanged | `APPROVE_DESKTOP=1` |

Hard **cost cap** ($0.50/day default) still blocks spend regardless of approvals.

Optional `trust-policy.json` in the project root can override defaults (env wins).

## Tamper-evident audit log

SQLite table `audit_log` (migration **v3**): each row stores `prev_hash` + `entry_hash` where

```text
entry_hash = SHA-256(seq|at|category|action|runId|actor|canonicalDetail|prevHash)
```

Genesis `prev_hash` is 64 zero hex digits. Categories: `action` · `gate` · `approval` · `cost` · `system` · `evidence`.

```bash
pnpm run trust:verify
# GET /api/trust/audit/verify
```

## Evidence bundle

On durable run finish (and via CLI/API):

```text
SAM_OUTPUT_HOME/runs/<YYYY-MM-DD>/<runId>/evidence/
  report.json
  report.md
  gates.json
  diffs/          # optional patches
# mirrored:
SAM_OUTPUT_HOME/reports/evidence-<runId>.md
```

Contents: steps (timeline), gate outcomes, approvals, cost snapshot, screenshot refs, audit head hash.

## Control plane & CLI

| Endpoint / command | Role |
| --- | --- |
| `GET /api/trust/approvals?status=pending` | List approvals |
| `POST /api/trust/approvals` `{ id, approve }` | Approve / deny |
| `GET /api/trust/audit/verify` | Integrity check |
| `GET /api/trust/audit` | List entries |
| `GET\|POST /api/trust/evidence/:runId` | Fetch / write bundle |
| `GET /api/trust/gates/:runId` | Gate results |
| `GET /api/trust/policy` | Effective policy |
| `pnpm run trust:verify` | CLI verify |
| `pnpm run trust:approvals` | CLI pending list |
| `pnpm run trust:approve -- <id>` | CLI approve |
| `pnpm run trust:deny -- <id>` | CLI deny |
| `pnpm run trust:evidence -- <runId>` | CLI evidence |

All `/api/trust/*` routes require the existing Control Plane session / Bearer token.

## Env (see `.env.example`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `SAM_TRUST_GATES` | `1` | Enable quality gates |
| `SAM_TRUST_AUDIT` | `1` | Write hash-chained audit log |
| `SAM_TRUST_EVIDENCE` | `1` | Write evidence bundles |
| `SAM_TRUST_REQUIRE_DESTRUCTIVE_APPROVAL` | `1` | HITL outside output home |
| `SAM_TRUST_REQUIRE_EMAIL_APPROVAL` | `1` | HITL email send |
| `SAM_TRUST_SPEND_APPROVAL_USD` | `0.25` | Spend approval threshold |
| `SAM_TRUST_SENSITIVE_APPS` | _(built-in list)_ | Sensitive desktop hints |
| `SAM_TRUST_GATE_RETRIES` | `2` | Retries before escalate |
| `SAM_TRUST_ESCALATE_ON_GATE_FAIL` | `1` | Escalate (not fake pass) |

## Tests

`tests/gates-trust.test.ts` — gates, approvals, hash-chain verify (detects tampering), evidence write — **no network**.

## Owner decisions

| Decision | Value |
| --- | --- |
| Silent success | Forbidden — empty/failed gates never mark done |
| Audit store | Embedded SQLite (`audit_log`, hash chain) |
| Evidence home | `SAM_OUTPUT_HOME` runs/ + reports/ |
| Daily cloud cap | Still **$0.50** (Phase 1); spend approval is an extra soft gate |
