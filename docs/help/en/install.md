# Install

## One-click (recommended)

**Windows**

```bat
scripts\install\install.cmd
:: or: powershell -ExecutionPolicy Bypass -File scripts\install\install.ps1
```

**macOS / Linux (Ubuntu)**

```bash
bash scripts/install/install.sh
```

Checks/installs Node + pnpm, runs `pnpm install`, creates `.env` from the example (locale prompt), sets up `~/Documents/Sam-Harness`, optionally registers startup, then `pnpm run doctor`.

Uninstall: `uninstall.ps1` / `uninstall.sh`.

Non-interactive: `pnpm run install:unix` or `pnpm run install:win`.

## Manual (Windows Tools)

1. `Tools\01-setup-prereqs.bat`  
2. `Tools\02-install-deps.bat`  
3. `Tools\06-pull-ollama-models.bat` (once)  
4. `SamHarness.bat` or `Tools\05-start-ui.bat`  

UI: http://127.0.0.1:8787/ — owner token required (`.controlplane-token` or `CONTROL_PLANE_TOKEN`).

## Requirements

- Node ≥ 20, pnpm ≥ 9 (`packageManager` pins pnpm@11)  
- Local Ollama for local models (optional but recommended)  
- `OLLAMA_API_KEY` for cloud within the cap  

After install: `pnpm run doctor` then `pnpm run ui`.
