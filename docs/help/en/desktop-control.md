# Machine control & desktop tools

Question: can the agency control the local machine and do daily Windows / Ubuntu tasks?  
**Short answer:** partially — strong on **Windows UIA**; on **Ubuntu/macOS** filesystem, email, and scheduler work, but GUI desktop automation is **not implemented (stubs)**.

## Operator tools

From `OPERATOR_CAPABILITIES` + `registry.ts`:

| Group | Tools | Limits |
| --- | --- | --- |
| Files | `list_dir`, `read_file`, `write_file`, `mkdir`, `copy_file`, `move_file`, `delete_path`, `open_path` | allowlisted roots; delete needs `confirm:true`; system paths denied |
| Sheets | `write_excel` | simple XLS/CSV — not full Excel |
| Simple capture | `screenshot` | **Windows only** |
| Shell | `run_shell` | allowlisted prefixes only — no arbitrary installs |
| Sandbox | `run_node_sandbox` | secrets stripped; timeout; optional Docker |
| MCP | `mcp_call` | from `mcp.json` |
| Desktop | `desktop_*` (windows, UIA, input, clipboard, file dialog, screenshot, verify, media, ffmpeg) | approvals for sensitive actions; dry-run; kill switch |

## Desktop backend by OS

| Platform | Backend | Reality |
| --- | --- | --- |
| Windows | `windows-uia` (PowerShell + UIAutomation) | list/focus/launch/UIA/input/clipboard/shots; optional Ctrl+Shift+Alt+K watcher |
| Linux (Ubuntu etc.) | `linux-atspi-stub` | every method throws not-implemented |
| macOS | `macos-accessibility-stub` | not implemented |
| Tests | `SAM_DESKTOP_BACKEND=mock` | works on any OS |

## Filesystem sandbox

- Default allow: home, Desktop/Documents/Downloads, accessible Windows drives; on Unix also `/tmp`, `/home`, `/media`, `/mnt`, `/Volumes`  
- Restrict: `WORKSPACE_ROOTS` or `workspace-roots.json`  
- Always deny: System32, `/etc`, `.ssh`, credential files, `.controlplane-token`, …  
- Agent outputs: `SAM_OUTPUT_HOME` (default `~/Documents/Sam-Harness`)

## Email

- Default `EMAIL_PROVIDER=smtp`; dry-run until `SMTP_*` set  
- Or `resend` + `RESEND_API_KEY`  
- Send path: draft → `APPROVE_COMMS=1` + UI/trust approval

## Scheduler (Daily Ops)

- Runs inside Control Plane; tick interval `DAILY_OPS_TICK_MS` (default 30000)  
- Default tick records a ledger summary — **full agent spawn** is via Run / API, not every tick (**current behaviour**)

## Daily tasks — what works where?

| Typical daily task | Ubuntu | Windows | macOS |
| --- | --- | --- | --- |
| Copy/move files in allowlist | yes | yes | yes |
| Create Excel/text | yes | yes | yes |
| Open a path | yes | yes | yes |
| Simple screenshot tool | no | yes | no |
| Launch app and click UIA controls | no (stub) | yes | no (stub) |
| Send email after approval | yes if SMTP set | yes | yes |
| Scheduled Daily Ops job | yes (Control Plane running) | yes | yes |
| PowerShell `Get-*` via run_shell | limited/unsuitable | yes within allowlist | limited |

Safety flags: `APPROVE_DESKTOP`, `SAM_DESKTOP_DRY_RUN`, `SAM_DESKTOP_PAUSED`, `SAM_DESKTOP_KILLED`, file `~/.sam-harness-desktop-kill`.
