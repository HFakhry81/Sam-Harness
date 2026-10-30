# Phase 4 — Windows desktop operator

**Goal:** Production-grade local Windows control (UIA-first) that competitors do not ship by default — with approvals, verify-after-act, recording, kill switch, and dry-run.

## Architecture

```text
registry / safeExecute (role matrix)
        │
        ▼
src/tools/desktop/operator.ts
  ├─ dry-run plan
  ├─ kill switch / pause
  ├─ risk → approval (destructive / financial / sending)
  ├─ backend.act(...)
  ├─ verify-after-act (UIA state + screenshot diff, retries)
  └─ timeline + screenshots under SAM_OUTPUT_HOME/runs/.../desktop/
        │
        ▼
DesktopBackend
  ├─ win32  → PowerShell + .NET UI Automation (UIAutomationClient)
  ├─ darwin → Accessibility stub (not implemented)
  └─ linux  → AT-SPI stub (not implemented)
       + mock backend for unit tests on every OS
```

UIA is preferred for find/invoke/set-value. On failure, the operator captures screenshots under the run folder for vision fallback / human inspection.

## Tools

| Tool | Purpose |
| --- | --- |
| `desktop_list_windows` / `desktop_focus_window` / `desktop_launch_app` / `desktop_close_window` | Window management |
| `desktop_uia_tree` / `desktop_uia_find` / `desktop_uia_invoke` / `desktop_uia_set_value` | Accessibility tree |
| `desktop_type_text` / `desktop_key` / `desktop_click` / `desktop_move_mouse` | Input |
| `desktop_clipboard_get` / `desktop_clipboard_set` | Clipboard |
| `desktop_file_dialog` | Drive Open/Save dialogs via UIA |
| `desktop_screenshot` / `desktop_verify` | Capture + verify-after-act |
| `open_media` / `ffmpeg` | Play media / ffmpeg CLI (path-sandboxed) |

Existing file tools (`move_file`, `screenshot`, `open_path`, …) remain unchanged.

## Safety

| Control | Behavior |
| --- | --- |
| Role matrix | Operator / implementer only (`capabilities.ts`) |
| Approval | `destructive` / `financial` / `sending` → pending approval unless `approved:true` or `APPROVE_DESKTOP=1` |
| Dry-run | `SAM_DESKTOP_DRY_RUN=1` or `dryRun:true` — plan only |
| Kill / pause | `SAM_DESKTOP_PAUSED=1`, `SAM_DESKTOP_KILLED=1`, kill flag file (`SAM_DESKTOP_KILL_FILE` or `~/.sam-harness-desktop-kill`), API `POST /api/desktop/pause` |
| Hotkey | Optional `SAM_DESKTOP_HOTKEY_WATCHER=1` (Windows) — Ctrl+Shift+Alt+K writes the kill flag |
| Path sandbox | `open_media` / screenshot paths still go through `assertAllowedPath` |

## Control Plane APIs

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/desktop/status` | Backend + dry-run + kill switch |
| POST | `/api/desktop/pause` | `{ pause, kill, reason }` |
| GET | `/api/desktop/approvals` | Pending/decided desktop approvals |
| POST | `/api/desktop/approvals` | `{ id, approve }` |

Timeline events use `kind: "desktop"` on the durable run (Runs → timeline UI).

## Owner decisions (Phase 4)

| Decision | Value |
| --- | --- |
| First target apps | **Notepad** (CI), Explorer file dialogs; Excel/Word COM later |
| Autonomy | Read/ops_safe free for operator; **destructive / financial / sending require approval** |
| UIA transport | **PowerShell + .NET UIAutomationClient** (no native Node addon) |
| Non-Windows | **Stubs** for macOS Accessibility / Linux AT-SPI — same `DesktopBackend` interface |
| Vision fallback | Screenshot capture on UIA/verify failure (LLM vision optional later) |

## Tests / CI

| Suite | Command | Where |
| --- | --- | --- |
| Unit (mock backend) | `pnpm test` / `pnpm test:desktop` | ubuntu + windows |
| Smoke | `pnpm smoke:desktop` (in `pnpm smoke`) | both |
| Integration | `pnpm test:desktop:windows` | **windows-latest only** (drives Notepad) |

## Env (see `.env.example`)

- `APPROVE_DESKTOP=1` — auto-approve gated desktop actions (CI / trusted local)
- `SAM_DESKTOP_DRY_RUN=1` — plan only
- `SAM_DESKTOP_PAUSED` / `SAM_DESKTOP_KILLED` / `SAM_DESKTOP_KILL_FILE`
- `SAM_DESKTOP_BACKEND=mock` — force mock backend
- `SAM_DESKTOP_HOTKEY_WATCHER=1` — start Windows hotkey watcher
- `SAM_DESKTOP_RECORD_SHOTS=0` — disable automatic before/after screenshots
