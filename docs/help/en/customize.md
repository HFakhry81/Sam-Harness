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

## 1b) Visual workflow editor (Phase 9)

Control Plane → **Workflow graph** tab: offline SVG canvas (no CDN) showing router, operational path, intake, evidence, review loop, GO gate, specialists, delivery, and Level-3.

- Drag nodes, reorder specialists, add custom roles, enable/disable, delete custom only
- Side panel edits prompt / models / prefersCloud / tools with validation
- **Locked:** review loop and GO gate — clear errors on bypass attempts
- Draft vs apply, undo/redo, export/import JSON, reset to defaults
- Layout file `config/workflow-layout.json` is separate from semantic `team.json`
- Live routing badges from `/api/routing/effective`

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8787/api/workflow
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://127.0.0.1:8787/api/workflow/graph \
  -d '{"graph":{…}}'
```

See `docs/PHASE9_VISUAL_EDITOR.md`.

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

## 11) Self-learning memory (lessons + skills)

Harness runs accumulate non-duplicate lessons (auditor / gate failures) and skills (approved strategy shapes) under `SAM_OUTPUT_HOME/memory/`. Relevant entries are injected into Strategist and Auditor prompts; recurring expressible lessons become deterministic pre-checks.

```bash
pnpm run memory -- list
pnpm run memory -- show <id>
pnpm run memory -- prune --min-hits 2
pnpm run memory -- promote
```

See `docs/SELF_LEARNING_MEMORY.md`. Do not edit `config/team.json` for this feature (owner-managed).

## Still not implemented

- Full AT-SPI / Accessibility parity with Windows UIA on every distro without installing OS packages
- Free-form editing of every LangGraph edge outside the allowed post-GO specialist chain
