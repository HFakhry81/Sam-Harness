# Customize workflow & team

Yes — owners can change behaviour via config, env, and code. There is no drag-and-drop “add teammate” UI; extension uses the files below.

## 1) Environment (`.env`)

Copy `.env.example` → `.env`. Key knobs for team/path:

- `AGENCY_MODE=1|0` — LangGraph vs legacy swarm  
- `HYBRID_MODE`, `FORCE_LOCAL_SPECIALISTS`, models `CEO_MODEL` / `SAM_*`  
- `IMPLEMENT_GO`, `RUN_LEVEL3`, `TARGET_REPO`  
- Approvals `APPROVE_*` and `SAM_TRUST_*`  
- Desktop `SAM_DESKTOP_*`  
- `SAM_LOCALE=ar|en`

## 2) Hybrid profile (UI or API)

Control Plane → Hybrid tab, or:

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8787/api/hybrid-profile
```

Sets `mode`, `costCapUsd`, notes. The profile `roles` map exists but **live routing does not read it yet** (`cloudAllowedForRole` unused) — **planned / partial**.

## 3) Go/No-Go authorization

```json
{ "decision": "GO", "by": "owner", "at": "2026-01-01T00:00:00.000Z", "reason": "…" }
```

From `go-nogo.example.json`. Or `--go` / `IMPLEMENT_GO=1`.

## 4) MCP — add external tools

```bash
cp mcp.example.json mcp.json
# add stdio or HTTP servers under mcpServers
```

Surfaces to operator/implementer after the capability matrix.

## 5) Workspace roots

`workspace-roots.example.json` → `workspace-roots.json` or `WORKSPACE_ROOTS` / `WORKSPACE_DENY`.

## 6) Extend roles in code (step-by-step)

1. Add a `RoleId` in `src/agency/types.ts`  
2. Add a contract to `AGENCY_ROLES` in `roles.ts`  
3. Define tools in `ROLE_CAPABILITIES` (`capabilities.ts`)  
4. Invoke the model from `runner.ts` or a new path via `makeSpecialistModel({ role: "…" })`  
5. Add a test in `tests/capabilities.test.ts` or smoke  
6. Document the capability in `docs/help` so later sessions do not invent it  

## 7) Change task route

- UI: auto / architecture / operational / implement  
- `task.ts`: `route` field  
- CLI: task text + `--implement` / `--implement-only` / `--go`

## 8) Level-3 plan

Place `level3-plan.json` in the pack folder:

```json
{
  "title": "patch",
  "branchPrefix": "sam-harness/l3",
  "writes": [{ "path": "src/x.ts", "content": "…" }],
  "patches": [],
  "testCommand": "pnpm",
  "testArgs": ["test"]
}
```

## 9) Daily Ops / memory / comms

From the Control Plane — no code changes needed to add a daily job, memory note, or email draft.

## Not implemented

- Graphical LangGraph editor  
- Per-role model picker in the UI  
- Enforcing hybrid profile `roles` map on live routing (data only today)
