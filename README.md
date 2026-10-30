# Sam-Harness

Hybrid AI agency for Windows: **Control Plane UI** + **LangGraph review** + **desktop operator tools** + numbered report packs under `docs/Sam-Harness no.X`.

## Quick start (Windows)

1. Open `Tools\README.md` and run **`Tools\01-setup-prereqs.bat`**
2. **`Tools\02-install-deps.bat`**
3. **`Tools\06-pull-ollama-models.bat`** (once)
4. Double-click **`SamHarness.bat`** → choose Control Plane UI  
   or run **`Tools\05-start-ui.bat`**

UI: http://127.0.0.1:8787/ (owner token required — see `.controlplane-token` or `CONTROL_PLANE_TOKEN`)

Filesystem tools are sandboxed to `process.cwd()` plus `WORKSPACE_ROOTS` / `workspace-roots.json` (deny-by-default). Daily cloud spend is enforced via `costCapUsd` in the Hybrid UI.

## Layout

| Path | Role |
| --- | --- |
| `src/` | Agency, Control Plane, tools |
| `scripts/` | Evals + smoke gates |
| `docs/` | Product docs + archived packs `Sam-Harness no.X` |
| `Tools/` | Windows install / update / start scripts |
| `templates/` | Seed `task.ts` for first run |
| `SamHarness.bat` | Main launcher menu |

## Checks

```bat
pnpm typecheck
pnpm test
pnpm run smoke:prod-gates
```

## Env

Copy `.env.example` → `.env`. Never commit `.env`, `.controlplane-token`, or `cost-ledger.json`.

## Docs

- `docs/AGENCY_PLATFORM_ROADMAP.md`
- `docs/PRODUCTION_HARDENING_P0.md`
- `docs/AGENCY_OPS.md`
