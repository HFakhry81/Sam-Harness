# Specialty & capability limits

## Agency specialty (as implemented)

Sam-Harness is a hybrid agency for:

1. **Repo / product analysis** → numbered report packs (strategy, audit, architecture, help-spec, marketing, verify) with a review gate  
2. **Bounded desktop ops** on allowlisted paths (files, simple Excel, Windows screenshots, Windows UIA)  
3. **Level-3 code implement** only after owner GO + JSON plan + tests + rollback  
4. **Scheduled Daily Ops** inside the Control Plane (default tick logs; full agent via Run)  
5. **Draft communications** via SMTP/Resend with strict approvals  

It is not a “full-service app builder” and not “general desktop automation on every OS”.

## Honest matrix

| Capability | Status | From code |
| --- | --- | --- |
| Write specs / plans / review reports | yes | architecture path + LangGraph |
| Build a web page from scratch as a product | partial | `write_file` / L3 in an authorized repo — **not** a page builder |
| Create a full app (UI+server+deploy) | partial / limited | planning yes; implement needs GO + plan + heavily restricted shell |
| Edit files in allowlisted workspace | yes | operator / implementer by role |
| Create simple Excel/CSV | yes | `write_excel` (SpreadsheetML / CSV) |
| Windows UI automation (Notepad etc. via UIA) | yes on Windows | Phase 4; Notepad CI on windows-latest |
| Ubuntu/macOS GUI automation | no | backends are stubs throwing not-implemented |
| Send real email | partial | SMTP/Resend implemented; default dry-run until SMTP + approvals |
| Schedule daily tasks | yes | Daily Ops; default tick is a ledger note, not a full agent |
| MCP for external tools | yes | after `mcp.json` |
| Isolate code with `run_node_sandbox` | yes | subprocess; optional Docker `SAM_SANDBOX_DOCKER=1` |
| Arbitrary shell / system package installs | no | allowlist: `dir`/`type`/`echo`/`where`/`Get-*` only |
| Cloud without key or budget | no | needs `OLLAMA_API_KEY` + remaining cap |
| In-product Help (this guide) | yes | `docs/help` + CLI/API/UI/export |
| Agency `help` role → `help-system-spec.md` only | yes | planning artifact after APPROVED — distinct from product Help |

## Role limits (short)

- Planners (strategist/architect/help/marketer): workspace reports — **no** client code without GO  
- auditor/verifier: read + audit/verify reports  
- implementer: nearly full tools but **requires GO**  
- operator: safe ops on allowlisted roots + desktop with approvals  
