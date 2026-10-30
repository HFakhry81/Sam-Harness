# Security, approvals & audit

Sources: `src/lib/trust/*`, Phase 6, `.env.example`.

## Implemented principles

- No silent success: acceptance gates on sensitive steps (`SAM_TRUST_GATES=1` default)  
- Human-in-the-loop for: destructive FS outside output/cwd, outbound email, cloud spend above threshold, sensitive desktop apps  
- Hash-chained SQLite audit log + `pnpm run trust:verify`  
- Evidence packs under `SAM_OUTPUT_HOME`  

## Trust CLI

```bash
pnpm run trust:verify
pnpm run trust:approvals
pnpm run trust:approve
pnpm run trust:deny
pnpm run trust:evidence
pnpm run trust:policy
```

## Approval flags (CI / trusted shells only)

`APPROVE_TRUST`, `APPROVE_DESTRUCTIVE`, `APPROVE_SPEND`, `APPROVE_COMMS`, `APPROVE_DESKTOP`  
Do not set these in untrusted shells.

## Control Plane

`/api/trust/policy`, `/api/trust/approvals`, `/api/trust/audit`, `/api/trust/evidence/…`, `/api/trust/gates/…`  
Owner auth required for most `/api/*`. Bound to `127.0.0.1` with Origin/Host checks.

## Filesystem box & token

Sensitive paths are always denied. Never commit `.env`, `.controlplane-token`, or secret-bearing `mcp.json`.
