# Tools — Windows setup for Sam-Harness

Prefer the **one-click installer** when possible:

```bat
..\scripts\install\install.cmd
```

See `docs/PHASE7_ARABIC_INSTALL.md`. Scripts below remain for step-by-step / legacy use.

Scripts for a **fresh Windows PC**. Run from this folder or via `SamHarness.bat`.

| Script | Purpose |
| --- | --- |
| `01-setup-prereqs.bat` | Check/install Node.js LTS, Git, pnpm (via winget / corepack), hint for Ollama |
| `02-install-deps.bat` | `pnpm install` in project root |
| `03-update.bat` | `git pull` + `pnpm install` |
| `04-build-check.bat` | Production gates: `pnpm run smoke:prod-gates` |
| `05-start-ui.bat` | Start Control Plane → http://127.0.0.1:8787/ |
| `06-pull-ollama-models.bat` | Pull default local models used by the agency |

## Order on a new machine

1. Install [Ollama](https://ollama.com/download) (GUI installer) if winget cannot.
2. `01-setup-prereqs.bat`
3. Copy `.env.example` → `.env` (optional cloud key: `OLLAMA_API_KEY`)
4. `02-install-deps.bat`
5. `06-pull-ollama-models.bat` (once)
6. `05-start-ui.bat` or double-click `..\SamHarness.bat`

## Requirements (summary)

- Windows 10/11
- Node.js 20+ LTS
- pnpm 9+ (Corepack)
- Git
- Ollama on `http://127.0.0.1:11434` for local models
