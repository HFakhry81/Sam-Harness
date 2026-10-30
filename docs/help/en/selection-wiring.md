# OS selection & wiring

## How the model is chosen

1. `FORCE_LOCAL_SPECIALISTS=1` → always local  
2. Else `HYBRID_MODE` from env if set (`local` | `cloud` | `auto`)  
3. Else hybrid profile from DB / `hybrid-profile.json`  
4. Default: `auto`  
5. Then `resolveModelRoute` using difficulty, API key, remaining budget, and `SAM_COST_NEAR_CAP_RATIO`

The hybrid profile stores a per-role map (`ceo_router`→local, specialists→auto) but `cloudAllowedForRole` is **defined and unused** by live routing — routing is global + difficulty.

## Providers & base URLs

| Tier | Base URL | Key | Cost |
| --- | --- | --- | --- |
| local | `SAM_LOCAL_BASE_URL` | none | $0 |
| free | `SAM_FREE_BASE_URL` | `SAM_FREE_API_KEY` | $0 when configured |
| paid | `SAM_PAID_BASE_URL` | `OLLAMA_API_KEY` | charged against daily cap |

Wiring: `ChatOllama` from `@langchain/ollama` in `makeCeoModel` / `makeSpecialistModel`.

## MCP

- Config: copy `mcp.example.json` → `mcp.json` or set `MCP_CONFIG`
- Client: `src/tools/mcp.ts` (stdio + HTTP)
- Tools surface as `mcp_call` or `mcp:server:name`
- Gated by role matrix; child env strips secrets

## Tools registry

`src/tools/registry.ts` executes tools after `assertToolAllowed`. Includes: filesystem, Excel, allowlisted shell, `run_node_sandbox`, MCP, and `desktop_*`.

## OS differences in wiring

| Component | Ubuntu/Linux | Windows | macOS |
| --- | --- | --- | --- |
| Local Ollama on 11434 | if installed | if installed | if installed |
| UIA operator | **stub — not implemented** | PowerShell/.NET UIA | **stub — not implemented** |
| Simple `screenshot` tool | no | yes (GDI) | no |
| `open_path` | `xdg-open` | `start` | `open` |
| `run_shell` | allowlist is Windows/PowerShell-oriented — limited on Unix | yes within allowlist | limited like Linux |
| One-click install | `scripts/install/install.sh` | `install.ps1` / `.cmd` | `install.sh` |
| Database | SQLite default; optional Postgres via `DATABASE_URL` | same | same |

There is no separate “pick agent by OS” switch — the same roles run everywhere; **tool backends** differ (especially desktop).
