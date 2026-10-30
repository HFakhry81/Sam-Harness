# Sam-Harness

Hybrid AI agency for Windows: **Control Plane UI** + **LangGraph review** + **desktop operator tools** + numbered report packs under `docs/Sam-Harness no.X`.

## Quick start (Windows)

1. Open `Tools\README.md` and run **`Tools\01-setup-prereqs.bat`**
2. **`Tools\02-install-deps.bat`**
3. **`Tools\06-pull-ollama-models.bat`** (once)
4. Double-click **`SamHarness.bat`** → choose Control Plane UI  
   or run **`Tools\05-start-ui.bat`**

UI: http://127.0.0.1:8787/ (owner token required — see `.controlplane-token` or `CONTROL_PLANE_TOKEN`)

Filesystem tools use a **desktop-controller** sandbox: normal user environment (home, Desktop/Documents/Downloads, accessible drives) with a DENY list for OS/credential paths. Optional `WORKSPACE_ROOTS` restricts; `WORKSPACE_DENY` extends denies. Agent-generated packs/reports land under `~/Documents/Sam-Harness` (`SAM_OUTPUT_HOME`). Daily cloud cap defaults to **$0.50** (`$0` forbids cloud).

**Phase 2:** generic Level-3 (`level3-plan.json`), MCP client (`mcp.json`), `run_node_sandbox`, real email (SMTP/Resend or dry-run), Daily Ops cron scheduler.

**Phase 3:** embedded SQLite persistence (optional `DATABASE_URL` Postgres), durable/resumable runs + LangGraph checkpointer, tenant isolation groundwork, pino + optional OpenTelemetry, run timeline UI, `/healthz`. Default `EMAIL_PROVIDER=smtp` (dry-run until SMTP_* set).

**Phase 4:** Windows desktop operator — UI Automation (PowerShell/.NET) first with screenshot verify/vision fallback, window/input/clipboard/file-dialog tools, per-action approvals, dry-run, kill switch, run-timeline recording. macOS/Linux backends stubbed. See `docs/PHASE4_DESKTOP_OPERATOR.md`.

**Phase 5:** Near-zero model cost — difficulty-based routing (local → free → paid), exact SQLite prompt cache + provider cache hints, context compaction, accurate per-run/daily accounting with near-cap degradation (never exceed the $0.50 default daily cloud cap). See `docs/PHASE5_NEAR_ZERO_COST.md`.

## Layout

| Path | Role |
| --- | --- |
| `src/` | Agency, Control Plane, tools |
| `scripts/` | Evals + smoke gates |
| `docs/` | Product docs + archived packs `Sam-Harness no.X` |
| `Tools/` | Windows install / update / start scripts |
| `templates/` | Seed `task.ts` for first run |
| `mcp.example.json` | Example MCP server config (copy to `mcp.json`) |
| `SamHarness.bat` | Main launcher menu |

## Checks

```bat
pnpm typecheck
pnpm test
pnpm run smoke
pnpm run smoke:prod-gates
pnpm run test:desktop:windows
```

(`test:desktop:windows` is gated to Windows / CI `windows-latest` — drives Notepad via UIA.)

## Env

Copy `.env.example` → `.env`. Never commit `.env`, `.controlplane-token`, `mcp.json` (if it has secrets), `*.sqlite`, or legacy `cost-ledger.json`.

State defaults to SQLite under `SAM_OUTPUT_HOME/state/sam-harness.sqlite`. Set `DATABASE_URL` for Postgres. Liveness: `GET /healthz`.

## Docs

- `docs/AGENCY_PLATFORM_ROADMAP.md`
- `docs/PRODUCTION_HARDENING_P0.md`
- `docs/PHASE3_PRODUCTION_OPS.md`
- `docs/PHASE4_DESKTOP_OPERATOR.md`
- `docs/PHASE5_NEAR_ZERO_COST.md`
- `docs/AGENCY_OPS.md`
- `docs/engagements/EXAMPLE-CLIENT.md`
