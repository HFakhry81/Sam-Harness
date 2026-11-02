# Sam-Harness IDE Bridge (VS Code / Cursor)

Thin, dependency-free extension that lets the Sam-Harness Control Plane drive your editor:

| Command | What it does |
| --- | --- |
| `openFile` | Opens a file, optionally at a line/column |
| `applyDiff` | Applies a **unified diff** through a `WorkspaceEdit` (undo-safe, saves the file) |
| `diagnostics` | Returns the editor's diagnostics for a file |
| `showMessage` | Shows an info/warn/error notification |

The harness never writes files directly for editor edits: `applyDiff` requires an approved
`ide_write` record **and** `SAM_IDE_ALLOW_WRITE=1` for paths inside prompt sources. The
Sam-Harness repository is never writable.

## Run it locally (no marketplace needed)

1. Start the Control Plane: `pnpm run ui`
2. In VS Code/Cursor: **File → Open Folder →** `ide/vscode`
3. Press **F5** (Run Extension) or:
   ```
   code --extensionDevelopmentPath="<repo>/ide/vscode"
   ```
4. Open your project in that window. The status bar shows *Sam-Harness: IDE bridge connected*.

Settings: `samHarness.baseUrl` (default `http://127.0.0.1:8787`), `samHarness.token`
(blank = read `.controlplane-token` from the workspace root), `samHarness.pollMs`.

## Agent-side tools

`ide_open_file`, `ide_diagnostics`, `ide_apply_diff` (rd/write-gated in the capability matrix).

## Protocol (any editor can implement it)

- `GET /api/ide/poll` → `{ ok, commands: [{ id, kind, params }] }`
- `POST /api/ide/result` → `{ id, ok, result | error }`

Both require `Authorization: Bearer <owner token>` and a loopback `Origin`.
