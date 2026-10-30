# Machine control & desktop tools

Question: can the agency control the local machine and do daily Windows / Ubuntu tasks?  
**Short answer:** yes within allowlists — **Windows UIA** is strongest; **Ubuntu/Linux** and **macOS** use real backends (xdotool/wmctrl/osascript/…) that degrade gracefully when tools are missing.

## Operator tools

From `OPERATOR_CAPABILITIES` + `registry.ts`:

| Group | Tools | Limits |
| --- | --- | --- |
| Files | `list_dir`, `read_file`, `write_file`, `mkdir`, `copy_file`, `move_file`, `delete_path`, `open_path` | allowlisted roots; delete needs `confirm:true`; system paths denied |
| Sheets | `write_excel` | simple XLS/CSV — not full Excel |
| Simple capture | `screenshot` | Windows GDI · Linux grim/scrot/gnome-screenshot · macOS screencapture |
| Shell | `run_shell` | allowlisted prefixes only — bash on Unix, PowerShell/cmd on Windows |
| Sandbox | `run_node_sandbox` | secrets stripped; timeout; optional Docker |
| MCP | `mcp_call` | from `mcp.json` |
| Desktop | `desktop_*` | approvals for sensitive actions; dry-run; kill switch (Phase 6) |

## Desktop backend by OS

| Platform | Backend | Reality |
| --- | --- | --- |
| Windows | `windows-uia` (PowerShell + UIAutomation) | list/focus/launch/UIA/input/clipboard/shots; optional Ctrl+Shift+Alt+K watcher |
| Linux (Ubuntu etc.) | `linux-x11-wayland` | wmctrl/xdotool (X11) or ydotool (Wayland best-effort); screenshots via grim/scrot/gnome-screenshot; optional AT-SPI via python3-pyatspi |
| macOS | `macos-accessibility` | osascript/AppleScript + screencapture + pbcopy/pbpaste (Accessibility permission may be required) |
| Tests | `SAM_DESKTOP_BACKEND=mock` | works on any OS |

Missing tools throw clear errors with install hints (see doctor / `GET /api/desktop/backend`).

### Ubuntu packages

```bash
sudo apt install wmctrl xdotool scrot gnome-screenshot xclip python3-pyatspi
# Wayland optional:
sudo apt install grim wl-clipboard ydotool
```

## `run_shell` policy (cross-platform)

| OS | Shell | Allowlist examples |
| --- | --- | --- |
| Windows | `cmd` / `powershell.exe` | `dir`, `type`, `echo`, `where`, `powershell … Get-*` |
| Linux/macOS | `bash -lc` | `ls`, `cat`, `echo`, `pwd`, `which`, `find`, `head`, `file`, … — **no pipes/redirection/chaining** |

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
- Default tick records a ledger summary — **full agent spawn** is via Run / API, not every tick

## Daily tasks — what works where?

| Typical daily task | Ubuntu | Windows | macOS |
| --- | --- | --- | --- |
| Copy/move files in allowlist | yes | yes | yes |
| Create Excel/text | yes | yes | yes |
| Open a path | yes | yes | yes |
| Screenshot | yes if tools installed | yes | yes (`screencapture`) |
| Launch app / click / type | yes if xdotool/ydotool (+ AT-SPI optional) | yes (UIA) | yes (osascript; Accessibility) |
| Send email after approval | yes if SMTP set | yes | yes |
| Scheduled Daily Ops job | yes (Control Plane running) | yes | yes |
| Allowlisted shell | bash whitelist | PowerShell/`Get-*` | bash whitelist |

Safety flags: `APPROVE_DESKTOP`, `SAM_DESKTOP_DRY_RUN`, `SAM_DESKTOP_PAUSED`, `SAM_DESKTOP_KILLED`, file `~/.sam-harness-desktop-kill`. Sensitive apps still need Phase 6 approvals.
