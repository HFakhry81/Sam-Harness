# Tools — Sam-Harness Manager

Unified entry point for setup, run, and maintenance of Sam-Harness on Windows and Ubuntu/macOS.

**Console output is English-only** (Windows PowerShell 5.1-safe). App locale (`SAM_LOCALE=ar`) is separate and unchanged.

## Quick start

| Platform | Command |
| --- | --- |
| **Windows** (double-click or cmd) | `Tools\Sam-Harness-Manager.cmd` |
| **Windows** (PowerShell) | `powershell -ExecutionPolicy Bypass -File Tools\Sam-Harness-Manager.ps1` |
| **Ubuntu / macOS** | `bash Tools/sam-harness-manager.sh` |
| **pnpm** | `pnpm run tools` (Unix) · `pnpm run tools:win` (Windows) |

Interactive numbered menu. `-Lang` / `--lang` are accepted but ignored (backward compatible).

### Non-interactive

```bat
Tools\Sam-Harness-Manager.cmd -Action update -NonInteractive
```

```bash
bash Tools/sam-harness-manager.sh --action update --non-interactive
```

## Menu actions

| # | Action id | Purpose |
| --- | --- | --- |
| 1 | `install` | Fresh machine — clone (optional) + delegate to `scripts/install/*` |
| 2 | `setup-prereqs` | Git, Node LTS, pnpm (Corepack pinned), Ollama hint, `.env`, `SAM_OUTPUT_HOME` |
| 3 | `install-deps` | `pnpm install` |
| 4 | `update` | Refuse dirty tree → `git pull --ff-only` current branch → install → `migrate` → `doctor` |
| 5 | `build-check` | `typecheck` + `test` + `doctor` |
| 6 | `start-ui` | Control Plane → http://127.0.0.1:8787/ |
| 7 | `pull-models` | Unique **local** models from `config/team.json` via Ollama |
| 8 | `doctor` | `pnpm run doctor` |
| 9 | `help` | `pnpm run help` |
| 10 | `backup` | Zip DB + `config/*.json` + `.env` → `SAM_OUTPUT_HOME/exports/` |
| 11 | `restore` | Restore from zip/tar.gz |
| 12 | `repair` | Prereqs + deps + migrate + doctor |
| 13 | `uninstall` | Delegate to `scripts/install/uninstall.*` |
| 14 | `view-logs` | List/tail manager logs under `SAM_OUTPUT_HOME/logs` or `Tools/logs` |
| 15 | `cleanup-logs` | Delete logs older than 14 days |
| 16 | `health` | Doctor + optional `GET /healthz` |
| 0 | `exit` | Exit |

Canonical ids: `Tools/lib/actions.manifest`.

## Legacy numbered scripts

Still work as thin wrappers around the manager:

| Legacy | Calls |
| --- | --- |
| `01-setup-prereqs.bat` / `.sh` | `-Action setup-prereqs` |
| `02-install-deps.bat` / `.sh` | `-Action install-deps` |
| `03-update.bat` / `.sh` | `-Action update` |
| `04-build-check.bat` / `.sh` | `-Action build-check` |
| `05-start-ui.bat` / `.sh` | `-Action start-ui` |
| `06-pull-ollama-models.bat` / `.sh` | `-Action pull-models` |

## One-click install (Phase 7)

```bat
scripts\install\install.cmd
```

```bash
bash scripts/install/install.sh
```

The manager `install` action **delegates** to those scripts (no duplicated logic). Installer console messages are English-only; app locale prompts still default to `ar` for `SAM_LOCALE`.

## Output & logs

- Default output home: `~/Documents/Sam-Harness` (`SAM_OUTPUT_HOME`)
- Manager logs: `$SAM_OUTPUT_HOME/logs/manager-*.log` (fallback `Tools/logs/`)
- Colored tags: `[OK]` green · `[WARN]` yellow · `[FAIL]` red · `[INFO]` cyan
- Windows: `chcp 65001`; `.ps1` files use UTF-8 with BOM for PowerShell 5.1

## Requirements

- Node.js ≥ 20 LTS  
- pnpm pinned via `packageManager` (`pnpm@11.23.0`) + Corepack  
- Git  
- Ollama optional (local models from `config/team.json`)  
- **Windows PowerShell 5.1** supported (no pwsh 7 required)

After setup: `pnpm run doctor` then `pnpm run ui` (or menu item 6).

See also: `docs/help/en/install.md`, `docs/help/ar/install.md`, `docs/PHASE7_ARABIC_INSTALL.md`.
