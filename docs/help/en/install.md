# Install

## Unified Tools Manager (recommended)

One menu for install, update, doctor, backup, Ollama pulls, and more (console output is **English-only**; `-Lang` is ignored):

**Windows**

```bat
Tools\Sam-Harness-Manager.cmd
:: non-interactive:
Tools\Sam-Harness-Manager.cmd -Action install -NonInteractive
```

**macOS / Linux (Ubuntu)**

```bash
bash Tools/sam-harness-manager.sh
# non-interactive:
bash Tools/sam-harness-manager.sh --action install --non-interactive
```

See `Tools/README.md` for the full action list (`install`, `setup-prereqs`, `update`, `build-check`, `pull-models`, `backup`, …).

## One-click installer (Phase 7)

The manager’s `install` action delegates here:

**Windows**

```bat
scripts\install\install.cmd
:: or: powershell -ExecutionPolicy Bypass -File scripts\install\install.ps1
```

**macOS / Linux (Ubuntu)**

```bash
bash scripts/install/install.sh
```

Checks/installs Node + pnpm (Corepack, pinned in `packageManager`), runs `pnpm install`, creates `.env` from the example (locale prompt), sets up `~/Documents/Sam-Harness` (`SAM_OUTPUT_HOME`), optionally registers startup, then `pnpm run doctor`.

Uninstall: manager action `uninstall`, or `uninstall.ps1` / `uninstall.sh`.

Non-interactive: `pnpm run install:unix` or `pnpm run install:win`.

## Manual / legacy Tools wrappers

Numbered scripts still work; they call the manager:

1. `Tools\01-setup-prereqs.bat` (or `.sh`)  
2. `Tools\02-install-deps.bat`  
3. `Tools\06-pull-ollama-models.bat` (local models from `config/team.json`)  
4. `SamHarness.bat` or `Tools\05-start-ui.bat`  

UI: http://127.0.0.1:8787/ — owner token required (`.controlplane-token` or `CONTROL_PLANE_TOKEN`).

## Update flow

```bash
bash Tools/sam-harness-manager.sh --action update
# refuses dirty git tree → pull current branch (ff-only) → pnpm install → pnpm run migrate → doctor
```

## Requirements

- Node ≥ 20, pnpm ≥ 9 (`packageManager` pins pnpm@11.23.0)  
- Local Ollama for local models (optional but recommended)  
- `OLLAMA_API_KEY` for cloud within the cap  

After install: `pnpm run doctor` then `pnpm run ui`.
