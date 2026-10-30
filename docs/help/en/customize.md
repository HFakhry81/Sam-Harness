# Customize workflow & team

Yes — owners can change behaviour via **team config**, env, Control Plane UI/API, and (advanced) code.

## 1) Team config (Phase 8 — no code)

File: `config/team.json` (schema: `config/team.schema.json`).

- Add / edit / disable roles (custom roles need `prompt`, models, optional tools)
- Per-role models: local + cloud + optional free
- Reorder or disable **downstream** specialist steps after APPROVED
- **Invariants:** review loop (strategist ↔ auditor ≤5) and GO gate stay required

Control Plane → **Team** tab (Arabic RTL via i18n), or:

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8787/api/team
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://127.0.0.1:8787/api/team/roles \
  -d '{"id":"research_analyst","title":"Research","prompt":"…","models":{"local":"qwen2.5:1.5b","cloud":"gemma4:cloud"}}'
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://127.0.0.1:8787/api/team/pipeline \
  -d '{"downstreamOrder":["architect","research_analyst","help","marketer","verifier"]}'
```

Audit log entries: `team_config.save`, `team_role.upsert`, `team_role.delete`.

Env model overrides: `SAM_ROLE_<ROLE>_MODEL` / `_CLOUD_MODEL` / `_FREE_MODEL`.

## 2) Environment (`.env`)

Copy `.env.example` → `.env`. Key knobs:

- `AGENCY_MODE=1|0` — LangGraph vs legacy swarm  
- `HYBRID_MODE`, `FORCE_LOCAL_SPECIALISTS`, `CEO_MODEL` / `SAM_*` / `SAM_ROLE_*`  
- `IMPLEMENT_GO`, `RUN_LEVEL3`, `TARGET_REPO`  
- Approvals `APPROVE_*` and `SAM_TRUST_*`  
- Desktop `SAM_DESKTOP_*`  
- `SAM_LOCALE=ar|en`

## 3) Hybrid profile (UI or API)

Control Plane → Hybrid tab, or:

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8787/api/hybrid-profile
```

Sets `mode`, `costCapUsd`, notes, and optional per-role `roles` map — **live routing reads this map** (cap still wins). See also `GET /api/routing/effective`.

## 4) Go/No-Go authorization

```json
{ "decision": "GO", "by": "owner", "at": "2026-01-01T00:00:00.000Z", "reason": "…" }
```

From `go-nogo.example.json`. Or `--go` / `IMPLEMENT_GO=1`.

## 5) MCP — add external tools

```bash
cp mcp.example.json mcp.json
# add stdio or HTTP servers under mcpServers
```

## 6) Workspace roots

`workspace-roots.example.json` → `workspace-roots.json` or `WORKSPACE_ROOTS` / `WORKSPACE_DENY`.

## 7) Extend roles in code (advanced)

Prefer team config for new specialist steps. For deep capability changes:

1. Add contract / tools in `roles.ts` / `capabilities.ts` if builtin  
2. Or add a custom role via API/UI with prompt + models  
3. Document in `docs/help`

## 8) Change task route

- UI: auto / architecture / operational / implement  
- `task.ts`: `route` field  
- CLI: task text + `--implement` / `--implement-only` / `--go`

## 9) Level-3 plan

Place `level3-plan.json` in the pack folder (see example in prior docs).

## 10) Daily Ops / memory / comms

From the Control Plane — no code changes needed.

## Still not implemented

- Graphical LangGraph node editor (drag-and-drop graph canvas)  
- Full AT-SPI / Accessibility parity with Windows UIA on every distro without installing OS packages
