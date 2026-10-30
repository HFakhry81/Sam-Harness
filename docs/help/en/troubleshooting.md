# Troubleshooting — doctor

```bash
pnpm run doctor
```

Local checks (no network required for the core suite): platform, Node≥20, pnpm field, `.env` presence, `node_modules`, `task.ts`, `SAM_OUTPUT_HOME`, i18n coverage, and an Ollama note (reachability not probed by default).

## Common failures

| Symptom | What to do |
| --- | --- |
| UI asks for token | Open `.controlplane-token` or set `CONTROL_PLANE_TOKEN` |
| Specialists stay local despite key | Check cap, `HYBRID_MODE=local`, `FORCE_LOCAL_SPECIALISTS`, or near-cap degradation |
| Level-3 refused | Authorize with `--go` / `IMPLEMENT_GO` / `go-nogo.json` |
| Desktop fails on Ubuntu | Expected — stub; use Windows or filesystem tools only |
| `pnpm test` path failures | Run from repo root after `pnpm install` |
| Ollama errors | Install Ollama and pull models (`Tools\06-pull-ollama-models.bat` or `ollama pull`) |

Service liveness: `GET /healthz` while Control Plane is running.
