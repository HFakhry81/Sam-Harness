# Troubleshooting — doctor

```bash
pnpm run doctor
```

Or from the Tools manager:

```bat
Tools\Sam-Harness-Manager.cmd -Action doctor
```

```bash
bash Tools/sam-harness-manager.sh --action doctor
```

Local checks (no network required for the core suite): platform, Node≥20, pnpm field, `.env` presence, `node_modules`, `task.ts`, `SAM_OUTPUT_HOME`, i18n coverage, team config / per-role routing, and an Ollama note (reachability not probed by default).

Live check (doctor + Control Plane `/healthz` if running):

```bash
bash Tools/sam-harness-manager.sh --action health
```

## Common failures

| Symptom | What to do |
| --- | --- |
| UI asks for token | Open `.controlplane-token` or set `CONTROL_PLANE_TOKEN` |
| Specialists stay local despite key | Check cap, `HYBRID_MODE=local`, `FORCE_LOCAL_SPECIALISTS`, or near-cap degradation |
| Level-3 refused | Authorize with `--go` / `IMPLEMENT_GO` / `go-nogo.json` |
| Desktop fails on Ubuntu | Expected — stub; use Windows or filesystem tools only |
| `pnpm test` path failures | Run from repo root after `pnpm install` |
| Ollama errors | Install Ollama and pull models (`Tools` → `pull-models`, or `06-pull-ollama-models.*` — models from `config/team.json`) |
| Update refused | Working tree dirty — commit/stash, then manager `update` |
| Migrations / DB oddities | `pnpm run migrate` or manager `repair` |
| Need a snapshot | Manager `backup` / `restore` (DB + config + `.env`) |
| PowerShell `ParserError` / missing `}` on Windows 5.1 | `.ps1` must be UTF-8 **with BOM** (repo commits BOM). Re-pull; do not re-save as UTF-8 without BOM in Notepad “UTF-8”. Use `Tools\Sam-Harness-Manager.cmd` |
| `Cannot overwrite variable HOME` / `VariableNotWritable` | Do not assign `$home`/`$HOME`/`$args`/other automatic vars in `.ps1` — use `$outputHome`, `$installerArgs`, etc. |
| `ExitCode` Object[] / `ParameterArgumentTransformationError` | Native command stdout polluted a function return — managers capture via `Invoke-SamNative` (Write-Host + int only) |
| `health` shows healthz WARN then FAIL | Unreachable `/healthz` is WARN only; overall exit follows `doctor`. Re-pull if FAIL after doctor PASS |
| `bash` fails on Windows (`execvpe(/bin/bash)`) | WSL stub with no distro — use the `.cmd`/`.ps1` manager, or install Git for Windows (Git Bash) |

Manager logs: `SAM_OUTPUT_HOME/logs/manager-*.log` (fallback `Tools/logs/`). View via menu **view-logs**.

Service liveness: `GET /healthz` while Control Plane is running.
