# Sam-Harness

Hybrid AI agency (Arabic-first): **Control Plane UI** + **LangGraph review** + **desktop operator tools** + numbered report packs under `~/Documents/Sam-Harness/reports/Sam-Harness no.X` (`SAM_OUTPUT_HOME`).

## Quick start

### One-click install (recommended)

**Windows**

```bat
scripts\install\install.cmd
:: or: powershell -ExecutionPolicy Bypass -File scripts\install\install.ps1
```

**macOS / Linux**

```bash
bash scripts/install/install.sh
```

The installer checks/installs Node + pnpm, runs `pnpm install`, creates `.env` from `.env.example` (prompts for locale), sets up `~/Documents/Sam-Harness`, optionally registers startup, then runs `pnpm run doctor`.

Uninstall: `scripts\install\uninstall.ps1` / `bash scripts/install/uninstall.sh`

### Manual (Windows Tools)

1. Open `Tools\README.md` and run **`Tools\01-setup-prereqs.bat`**
2. **`Tools\02-install-deps.bat`**
3. **`Tools\06-pull-ollama-models.bat`** (once)
4. Double-click **`SamHarness.bat`** → choose Control Plane UI  
   or run **`Tools\05-start-ui.bat`**

UI: http://127.0.0.1:8787/ (owner token required — see `.controlplane-token` or `CONTROL_PLANE_TOKEN`)

Default UI locale is **Arabic (RTL)**. Switch to English in the header, or set `SAM_LOCALE=en` in `.env`. Health check: `pnpm run doctor`.

**Intent router (chat-first):** every Control Plane / CLI message is classified *before* any pipeline into **chat** (greetings & simple Q&A — no reports), **research**, **task**, or **complex** (full agency). UI is a single chat input + Send; `--force-agency` still forces the pipeline. See `docs/help/en/quick-path.md`.

Filesystem tools use a **desktop-controller** sandbox: normal user environment (home, Desktop/Documents/Downloads, accessible drives) with a DENY list for OS/credential paths. Optional `WORKSPACE_ROOTS` restricts; `WORKSPACE_DENY` extends denies. Agent-generated packs/reports land under `~/Documents/Sam-Harness` (`SAM_OUTPUT_HOME`). Daily cloud cap defaults to **$0.50** (`$0` forbids cloud).

**Phase 2:** generic Level-3 (`level3-plan.json`), MCP client (`mcp.json`), `run_node_sandbox`, real email (SMTP/Resend or dry-run), Daily Ops cron scheduler.

**Phase 3:** embedded SQLite persistence (optional `DATABASE_URL` Postgres), durable/resumable runs + LangGraph checkpointer, tenant isolation groundwork, pino + optional OpenTelemetry, run timeline UI, `/healthz`. Default `EMAIL_PROVIDER=smtp` (dry-run until SMTP_* set).

**Phase 4:** Windows desktop operator — UI Automation (PowerShell/.NET) first with screenshot verify/vision fallback, window/input/clipboard/file-dialog tools, per-action approvals, dry-run, kill switch, run-timeline recording. macOS/Linux backends stubbed. See `docs/PHASE4_DESKTOP_OPERATOR.md`.

**Phase 5:** Near-zero model cost — difficulty-based routing (local → free → paid), exact SQLite prompt cache + provider cache hints, context compaction, accurate per-run/daily accounting with near-cap degradation (never exceed the $0.50 default daily cloud cap). See `docs/PHASE5_NEAR_ZERO_COST.md`.

**Phase 6:** Verifiable gates & trust — acceptance gates per step (never silent success), HITL approvals for destructive FS / email / spend / sensitive desktop apps, hash-chained SQLite audit log + `pnpm run trust:verify`, run evidence bundles under `SAM_OUTPUT_HOME`. See `docs/PHASE6_GATES_TRUST.md`.

**Phase 7:** Arabic-first i18n (RTL UI, Arabic agent/reports, intent cues) + one-click install (Windows PowerShell + macOS/Linux shell) + `pnpm run doctor`. See `docs/PHASE7_ARABIC_INSTALL.md`.

**Self-learning memory:** lessons + skills persist under `SAM_OUTPUT_HOME/memory/` (deduped, retrieved into Strategist/Auditor prompts, promotable to deterministic pre-checks). CLI: `pnpm run memory -- list|show|prune`. See `docs/SELF_LEARNING_MEMORY.md`.

## Layout

| Path | Role |
| --- | --- |
| `src/` | Agency, Control Plane, tools |
| `scripts/` | Evals + smoke gates |
| `docs/` | Product docs only (run packs never land here) |
| `~/Documents/Sam-Harness/` | Output home — `reports/`, `tasks/`, `state/`, `memory/`, `conversations/`, `backups/`, `logs/` |
| `Tools/` | Windows install / update / start scripts |
| `templates/` | Seed `task.ts` for first run |
| `mcp.example.json` | Example MCP server config (copy to `mcp.json`) |
| `SamHarness.bat` | Main launcher menu |

## Checks

```bat
pnpm typecheck
pnpm test
pnpm run doctor
pnpm run smoke
pnpm run smoke:prod-gates
pnpm run test:desktop:windows
```

(`test:desktop:windows` is gated to Windows / CI `windows-latest` — drives Notepad via UIA.)

## Env

Copy `.env.example` → `.env`. Never commit `.env`, `.controlplane-token`, `mcp.json` (if it has secrets), `*.sqlite`, or legacy `cost-ledger.json`.

State defaults to SQLite under `SAM_OUTPUT_HOME/state/sam-harness.sqlite`. Set `DATABASE_URL` for Postgres. Liveness: `GET /healthz`.

## Help (in-agency + export)

```bash
pnpm run help                 # index (locale from SAM_LOCALE)
pnpm run help workflow        # topic
pnpm run help --search "cost" # keyword search
pnpm run help:export          # HTML + PDF-ready HTML + MD → SAM_OUTPUT_HOME/documents/help and dist/help
```

Control Plane: **Help** tab · API `GET /api/help` · bilingual docs under `docs/help/ar` and `docs/help/en` (Arabic primary). Unimplemented roadmap items are marked **planned / not yet implemented**.

## Docs

- `docs/help/ar/` · `docs/help/en/` — owner Help (workflow, models, hybrid, desktop, customize, …)
- `docs/AGENCY_PLATFORM_ROADMAP.md`
- `docs/PRODUCTION_HARDENING_P0.md`
- `docs/PHASE3_PRODUCTION_OPS.md`
- `docs/PHASE4_DESKTOP_OPERATOR.md`
- `docs/PHASE5_NEAR_ZERO_COST.md`
- `docs/PHASE6_GATES_TRUST.md`
- `docs/PHASE7_ARABIC_INSTALL.md`
- `docs/SELF_LEARNING_MEMORY.md`
- `docs/AGENCY_OPS.md`
- `docs/engagements/EXAMPLE-CLIENT.md`
