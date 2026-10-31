import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import {
  assertAllowedPath,
  assertShellCommandPathsAllowed,
  ensureParentDir,
  isDriveRoot,
  resolveUserPath,
} from "../lib/paths.js";
import {
  assertWriteAllowed,
  isShellDisabled,
  gateWritePath,
} from "../lib/writePolicy.js";
import { agentDocumentPath } from "../lib/outputHome.js";

const execFileAsync = promisify(execFile);

export type ToolResult = {
  ok: boolean;
  tool: string;
  message: string;
  data?: unknown;
};

function asString(v: unknown, name: string): string {
  if (typeof v !== "string" || !v.trim()) {
    throw new Error(`Missing string param: ${name}`);
  }
  return v;
}

async function listDir(params: Record<string, unknown>): Promise<ToolResult> {
  const abs = resolveUserPath(asString(params.path, "path"));
  assertAllowedPath(abs);
  const entries = fs.readdirSync(abs, { withFileTypes: true }).map((e) => ({
    name: e.name,
    type: e.isDirectory() ? "dir" : "file",
  }));
  return {
    ok: true,
    tool: "list_dir",
    message: `Listed ${entries.length} entries in ${abs}`,
    data: { path: abs, entries: entries.slice(0, 100) },
  };
}

async function readFileTool(params: Record<string, unknown>): Promise<ToolResult> {
  const abs = resolveUserPath(asString(params.path, "path"));
  assertAllowedPath(abs);
  if (!fs.existsSync(abs)) {
    return { ok: false, tool: "read_file", message: `File not found: ${abs}` };
  }
  const maxBytes = Math.min(
    256_000,
    Math.max(1024, Number(params.maxBytes ?? params.max_bytes ?? 48_000) || 48_000)
  );
  const maxLines = Math.min(
    2000,
    Math.max(1, Number(params.maxLines ?? params.max_lines ?? 400) || 400)
  );
  const buf = fs.readFileSync(abs);
  const truncatedBytes = buf.length > maxBytes;
  const text = buf.slice(0, maxBytes).toString("utf-8");
  const lines = text.split(/\r?\n/);
  const truncatedLines = lines.length > maxLines;
  const preview = lines.slice(0, maxLines).join("\n");
  const note =
    truncatedBytes || truncatedLines
      ? `\n...(truncated bytes=${truncatedBytes} lines=${truncatedLines})`
      : "";
  return {
    ok: true,
    tool: "read_file",
    message: `Read ${abs} (${buf.length} bytes, showing <=${maxLines} lines)`,
    data: {
      path: abs,
      content: preview + note,
      bytes: buf.length,
      truncated: truncatedBytes || truncatedLines,
    },
  };
}

async function writeFileTool(params: Record<string, unknown>): Promise<ToolResult> {
  const { abs, gate } = gateWritePath(asString(params.path, "path"), "write");
  if (!gate.ok) {
    return { ok: false, tool: "write_file", message: gate.reason };
  }
  assertAllowedPath(abs);
  const content = asString(params.content, "content");
  ensureParentDir(abs);
  const existed = fs.existsSync(abs);
  fs.writeFileSync(abs, content, "utf-8");
  return {
    ok: true,
    tool: "write_file",
    message: `${existed ? "Updated" : "Created"} file ${abs} (${content.length} chars)`,
    data: { path: abs, created: !existed },
  };
}

async function writeReportTool(params: Record<string, unknown>): Promise<ToolResult> {
  const name = String(params.name || params.filename || "report.md").replace(
    /[<>:"|?*]/g,
    "_"
  );
  const content = asString(params.content, "content");
  const preferred =
    typeof params.path === "string" && params.path.trim()
      ? resolveUserPath(params.path)
      : agentDocumentPath(name);
  const gate = assertWriteAllowed(preferred, "write");
  if (!gate.ok) {
    // Force under output home documents/
    const fallback = agentDocumentPath(path.basename(name));
    const g2 = assertWriteAllowed(fallback, "write");
    if (!g2.ok) {
      return { ok: false, tool: "write_report", message: gate.reason };
    }
    ensureParentDir(fallback);
    fs.writeFileSync(fallback, content, "utf-8");
    return {
      ok: true,
      tool: "write_report",
      message: `Report written under output home: ${fallback}`,
      data: { path: fallback, redirected: true },
    };
  }
  assertAllowedPath(preferred);
  ensureParentDir(preferred);
  fs.writeFileSync(preferred, content, "utf-8");
  return {
    ok: true,
    tool: "write_report",
    message: `Report written: ${preferred}`,
    data: { path: preferred },
  };
}

async function searchCodeTool(params: Record<string, unknown>): Promise<ToolResult> {
  const root = resolveUserPath(asString(params.path || params.root || ".", "path"));
  assertAllowedPath(root);
  const pattern = asString(params.pattern || params.query, "pattern");
  let re: RegExp;
  try {
    re = new RegExp(pattern, params.caseInsensitive === false ? "" : "i");
  } catch {
    return { ok: false, tool: "search_code", message: `Invalid pattern: ${pattern}` };
  }
  const maxFiles = Math.min(200, Number(params.maxFiles ?? 80) || 80);
  const maxHits = Math.min(200, Number(params.maxHits ?? 40) || 40);
  const hits: { file: string; line: number; text: string }[] = [];
  const stack = [root];
  let filesScanned = 0;
  while (stack.length && filesScanned < maxFiles && hits.length < maxHits) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!/\.(ts|tsx|js|jsx|md|json|yaml|yml|txt|css|html)$/i.test(e.name)) continue;
      filesScanned += 1;
      let text = "";
      try {
        text = fs.readFileSync(full, "utf-8").slice(0, 200_000);
      } catch {
        continue;
      }
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length && hits.length < maxHits; i++) {
        if (re.test(lines[i])) {
          hits.push({ file: full, line: i + 1, text: lines[i].slice(0, 200) });
        }
      }
      if (filesScanned >= maxFiles) break;
    }
  }
  return {
    ok: true,
    tool: "search_code",
    message: `search_code: ${hits.length} hit(s) in ${filesScanned} file(s) under ${root}`,
    data: { root, pattern, hits, filesScanned },
  };
}

async function mkdirTool(params: Record<string, unknown>): Promise<ToolResult> {
  const { abs, gate } = gateWritePath(asString(params.path, "path"), "mkdir");
  if (!gate.ok) {
    return { ok: false, tool: "mkdir", message: gate.reason };
  }
  assertAllowedPath(abs);
  if (isDriveRoot(abs)) {
    return { ok: false, tool: "mkdir", message: `Refusing to mkdir drive/root: ${abs}` };
  }
  fs.mkdirSync(abs, { recursive: true });
  return {
    ok: true,
    tool: "mkdir",
    message: `Directory ready: ${abs}`,
    data: { path: abs },
  };
}

/**
 * Destructive delete — requires confirm:true (and recursive:true for non-empty dirs).
 * Policy: allowlisted user paths only; never OS roots.
 */
async function deletePathTool(params: Record<string, unknown>): Promise<ToolResult> {
  if (params.confirm !== true && params.confirm !== "true") {
    return {
      ok: false,
      tool: "delete_path",
      message:
        "Delete blocked: pass confirm:true explicitly. Destructive ops require conscious confirmation.",
    };
  }
  const abs = resolveUserPath(asString(params.path, "path"));
  const writeGate = assertWriteAllowed(abs, "delete");
  if (!writeGate.ok) {
    return { ok: false, tool: "delete_path", message: writeGate.reason };
  }
  assertAllowedPath(abs);
  // Phase 6 — HITL when deleting outside agent output home / cwd
  {
    const { requireDestructiveFsApproval, appendAudit } = await import(
      "../lib/trust/index.js"
    );
    const decision = requireDestructiveFsApproval({
      tool: "delete_path",
      path: abs,
      approved:
        params.approved === true || params.approved === "true"
          ? true
          : typeof params.approved === "string"
            ? params.approved
            : undefined,
      runId: typeof params.runId === "string" ? params.runId : undefined,
    });
    if (!decision.ok) {
      return {
        ok: false,
        tool: "delete_path",
        message: decision.message || "Approval required for destructive delete outside output home",
        data: {
          requiresApproval: true,
          approvalId: decision.approvalId,
          pendingApproval: true,
        },
      };
    }
    appendAudit({
      category: "action",
      action: "delete_path",
      runId: typeof params.runId === "string" ? params.runId : null,
      detail: { path: abs, approvalId: decision.approvalId },
    });
  }
  if (isDriveRoot(abs)) {
    return { ok: false, tool: "delete_path", message: `Refusing to delete drive/root: ${abs}` };
  }
  if (!fs.existsSync(abs)) {
    return { ok: false, tool: "delete_path", message: `Path not found: ${abs}` };
  }
  const st = fs.statSync(abs);
  if (st.isDirectory()) {
    const recursive = params.recursive === true || params.recursive === "true";
    const entries = fs.readdirSync(abs);
    if (entries.length && !recursive) {
      return {
        ok: false,
        tool: "delete_path",
        message: `Directory not empty (${entries.length} entries). Pass recursive:true to remove.`,
        data: { path: abs },
      };
    }
    fs.rmSync(abs, { recursive: true, force: false });
    return {
      ok: true,
      tool: "delete_path",
      message: `Deleted directory: ${abs}`,
      data: { path: abs, kind: "dir", warning: "permanent delete" },
    };
  }
  fs.unlinkSync(abs);
  return {
    ok: true,
    tool: "delete_path",
    message: `Deleted file: ${abs}`,
    data: { path: abs, kind: "file", warning: "permanent delete" },
  };
}

async function moveFileTool(params: Record<string, unknown>): Promise<ToolResult> {
  const source = resolveUserPath(asString(params.source, "source"));
  let destination = resolveUserPath(asString(params.destination, "destination"));
  // If destination is a bare drive (D:\), place file under that root with source basename
  if (/^[A-Za-z]:\\?$/.test(destination.replace(/\\+$/, "") + "\\") || /^[A-Za-z]:\\$/.test(destination)) {
    destination = path.join(destination.endsWith("\\") ? destination : destination + "\\", path.basename(source));
  }
  const srcGate = assertWriteAllowed(source, "move");
  if (!srcGate.ok) {
    return { ok: false, tool: "move_file", message: srcGate.reason };
  }
  const dstGate = assertWriteAllowed(destination, "move");
  if (!dstGate.ok) {
    return { ok: false, tool: "move_file", message: dstGate.reason };
  }
  assertAllowedPath(source);
  assertAllowedPath(destination);
  // Phase 6 — moving a source out of / deleting from outside home is destructive
  {
    const { requireDestructiveFsApproval } = await import("../lib/trust/index.js");
    const decision = requireDestructiveFsApproval({
      tool: "move_file",
      path: source,
      approved:
        params.approved === true || params.approved === "true"
          ? true
          : typeof params.approved === "string"
            ? params.approved
            : undefined,
      runId: typeof params.runId === "string" ? params.runId : undefined,
    });
    if (!decision.ok) {
      return {
        ok: false,
        tool: "move_file",
        message: decision.message || "Approval required for move outside output home",
        data: {
          requiresApproval: true,
          approvalId: decision.approvalId,
          pendingApproval: true,
        },
      };
    }
  }
  if (!fs.existsSync(source)) {
    return { ok: false, tool: "move_file", message: `Source not found: ${source}` };
  }
  ensureParentDir(destination);
  try {
    fs.renameSync(source, destination);
  } catch {
    // Cross-device rename often fails on Windows — copy then unlink
    fs.copyFileSync(source, destination);
    fs.unlinkSync(source);
  }
  return {
    ok: true,
    tool: "move_file",
    message: `Moved ${source} -> ${destination}`,
    data: { source, destination },
  };
}

async function copyFileTool(params: Record<string, unknown>): Promise<ToolResult> {
  const source = resolveUserPath(asString(params.source, "source"));
  let destination = resolveUserPath(asString(params.destination, "destination"));
  if (/^[A-Za-z]:\\$/.test(destination)) {
    destination = path.join(destination, path.basename(source));
  }
  const dstGate = assertWriteAllowed(destination, "copy");
  if (!dstGate.ok) {
    return { ok: false, tool: "copy_file", message: dstGate.reason };
  }
  assertAllowedPath(source);
  assertAllowedPath(destination);
  if (!fs.existsSync(source)) {
    return { ok: false, tool: "copy_file", message: `Source not found: ${source}` };
  }
  ensureParentDir(destination);
  fs.copyFileSync(source, destination);
  return {
    ok: true,
    tool: "copy_file",
    message: `Copied ${source} -> ${destination}`,
    data: { source, destination },
  };
}

async function openPathTool(params: Record<string, unknown>): Promise<ToolResult> {
  const abs = resolveUserPath(asString(params.path, "path"));
  assertAllowedPath(abs);
  if (!fs.existsSync(abs)) {
    return { ok: false, tool: "open_path", message: `Path not found: ${abs}` };
  }
  if (process.platform === "win32") {
    await execFileAsync("cmd", ["/c", "start", "", abs], { windowsHide: true });
  } else if (process.platform === "darwin") {
    await execFileAsync("open", [abs]);
  } else {
    await execFileAsync("xdg-open", [abs]);
  }
  return {
    ok: true,
    tool: "open_path",
    message: `Opened with default app: ${abs}`,
    data: { path: abs, platform: process.platform },
  };
}

function sanitizeScreenshotName(raw: string): string {
  let name = raw.trim().replace(/^["']|["']$/g, "").trim();
  if (!name) name = "screenshot";
  name = name.replace(/[<>:"/\\|?*]/g, "-").replace(/\s+/g, " ").trim();
  if (!/\.(png|jpg|jpeg|bmp)$/i.test(name)) name += ".png";
  return name;
}

async function screenshotTool(params: Record<string, unknown>): Promise<ToolResult> {
  const filename = sanitizeScreenshotName(
    typeof params.filename === "string" && params.filename.trim()
      ? params.filename
      : typeof params.name === "string"
        ? params.name
        : "screenshot.png"
  );
  const destRaw =
    typeof params.path === "string" && params.path.trim()
      ? params.path
      : path.join("Desktop", filename);
  const abs = resolveUserPath(destRaw.endsWith(".png") || destRaw.endsWith(".jpg") ? destRaw : path.join(destRaw, filename));
  // If user passed only a folder-ish path without extension, put file on Desktop with filename
  const finalPath = /\.(png|jpg|jpeg|bmp)$/i.test(abs)
    ? abs
    : resolveUserPath(path.join("Desktop", filename));
  assertAllowedPath(finalPath);
  ensureParentDir(finalPath);

  // Phase 8: route through desktop backend on all OS (Windows GDI / Linux grim|scrot / macOS screencapture)
  if (process.platform !== "win32") {
    try {
      const { runDesktopAction } = await import("./desktop/index.js");
      const result = await runDesktopAction({
        action: "screenshot",
        params: { path: finalPath },
      });
      if (!result.ok) {
        return {
          ok: false,
          tool: "screenshot",
          message: result.message || "screenshot failed",
        };
      }
      return {
        ok: true,
        tool: "screenshot",
        message: `Screenshot saved -> ${finalPath}`,
        data: result.data,
      };
    } catch (e: any) {
      return {
        ok: false,
        tool: "screenshot",
        message: e?.message || String(e),
      };
    }
  }

  // Controlled PowerShell capture (no free-form shell from the model)
  const ps = `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save('${finalPath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output 'OK'
`.trim();

  const { stdout, stderr } = await execFileAsync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
    { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 64 }
  );

  if (!fs.existsSync(finalPath)) {
    return {
      ok: false,
      tool: "screenshot",
      message: `Screenshot failed. stderr=${stderr || stdout || "unknown"}`,
    };
  }

  const size = fs.statSync(finalPath).size;
  return {
    ok: true,
    tool: "screenshot",
    message: `Screenshot saved (${size} bytes) -> ${finalPath}`,
    data: { path: finalPath, bytes: size },
  };
}

/**
 * Write a simple Excel-compatible spreadsheet (SpreadsheetML .xls).
 * params: path (Desktop\\name.xls), a1 or content (cell A1 value), optional sheet
 */
async function writeExcelTool(params: Record<string, unknown>): Promise<ToolResult> {
  const rawPath = asString(params.path, "path");
  let abs = resolveUserPath(rawPath);
  if (!/\.(xls|xlsx|csv)$/i.test(abs)) {
    abs = `${abs}.xls`;
  }
  const gate = assertWriteAllowed(abs, "write");
  if (!gate.ok) {
    return { ok: false, tool: "write_excel", message: gate.reason };
  }
  assertAllowedPath(abs);
  const a1 = String(
    params.a1 ?? params.content ?? params.value ?? new Date().toLocaleString()
  );
  ensureParentDir(abs);

  if (/\.csv$/i.test(abs)) {
    const csv = `"${a1.replace(/"/g, '""')}"\n`;
    fs.writeFileSync(abs, csv, "utf-8");
  } else {
    const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="${String(params.sheet || "Sheet1").replace(/[<>&"]/g, "")}">
  <Table>
   <Row>
    <Cell><Data ss:Type="String">${a1
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")}</Data></Cell>
   </Row>
  </Table>
 </Worksheet>
</Workbook>
`;
    // .xlsx as zip is heavy; Excel opens SpreadsheetML when saved as .xls
    const out = abs.replace(/\.xlsx$/i, ".xls");
    fs.writeFileSync(out, xml, "utf-8");
    abs = out;
  }

  return {
    ok: true,
    tool: "write_excel",
    message: `Excel sheet written -> ${abs} (A1=${a1.slice(0, 80)})`,
    data: { path: abs, a1 },
  };
}

/** Cross-platform allowlisted shell prefixes (same policy, OS-appropriate shells). */
export function shellAllowlistPrefixes(platform: NodeJS.Platform = process.platform): string[] {
  if (platform === "win32") {
    return [
      "dir ",
      "type ",
      "echo ",
      "where ",
      "powershell -noprofile -command get-",
      "powershell.exe -noprofile -command get-",
    ];
  }
  // Linux / macOS — bash-oriented read-only / listing helpers
  return [
    "ls ",
    "echo ",
    "pwd",
    "which ",
    "cat ",
    "head ",
    "tail ",
    "file ",
    "basename ",
    "dirname ",
    "realpath ",
    "printenv ",
    "uname ",
    "df ",
    "du ",
    "find ",
    "wc ",
    "test ",
    "[",
  ];
}

export function isShellCommandAllowed(
  command: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  const c = command.trim();
  const lower = c.toLowerCase();
  if (platform === "win32") {
    return shellAllowlistPrefixes(platform).some((p) => lower.startsWith(p.toLowerCase()));
  }
  // Exact single-token safe commands
  if (lower === "pwd" || lower === "ls" || lower === "uname" || lower === "df") return true;
  // Block chaining / redirection / subshells
  if (/[;&`|<>]/.test(c)) return false;
  if (/\n|\r/.test(c)) return false;
  return shellAllowlistPrefixes(platform).some((p) => {
    const pl = p.toLowerCase();
    return lower === pl.trim() || lower.startsWith(pl);
  });
}

/**
 * Quote a path for embedding inside a single PowerShell -Command string when unavoidable.
 * Prefer argv arrays so paths with spaces are never string-concatenated.
 */
export function quoteShellPath(p: string): string {
  const s = String(p || "");
  if (!/[\s&<>|^%]/.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}

/**
 * Build a safe argv for allowlisted shell ops.
 * Prefer params.argv (string[]) over params.command (legacy free-form string).
 */
export function resolveShellArgv(params: Record<string, unknown>): {
  ok: true;
  argv: string[];
  display: string;
} | { ok: false; message: string } {
  if (Array.isArray(params.argv) && params.argv.length) {
    const argv = params.argv.map((a) => String(a));
    // Gate every path-like arg for allowlist + write policy on redirects is N/A (no redirs in argv mode)
    for (const a of argv) {
      if (/^[A-Za-z]:[\\/]/.test(a) || a.startsWith("/") || /^(desktop|documents)/i.test(a)) {
        try {
          assertAllowedPath(resolveUserPath(a));
        } catch (e: any) {
          return { ok: false, message: e?.message || String(e) };
        }
        // Block argv that clearly target writing into source roots via Out-File/Export-Csv style
        // (analysis routes already disable shell entirely).
      }
    }
    return { ok: true, argv, display: argv.map(quoteShellPath).join(" ") };
  }

  if (typeof params.command === "string" && params.command.trim()) {
    const command = params.command.trim();
    // Reject unquoted paths-with-spaces followed by operators (Spendy failure mode)
    if (
      /[A-Za-z]:\\[^\n"']*\s+[^\n"']*[\\/][^\n"']*\s*(-Path|-LiteralPath|>|\|)/i.test(
        command
      ) &&
      !/"[^"]*\s[^"]*"/.test(command)
    ) {
      return {
        ok: false,
        message:
          "Shell blocked: path with spaces must be quoted, or pass params.argv as a string array (never concatenate paths into a command string).",
      };
    }
    if (!isShellCommandAllowed(command)) {
      const hint =
        process.platform === "win32"
          ? "Allowed shell: dir, type, echo, where, powershell Get-* only."
          : "Allowed shell: ls, echo, pwd, which, cat, head, tail, file, find (no pipes/redirs), uname, df, du, wc.";
      return {
        ok: false,
        message: `Shell blocked. Prefer list_dir / read_file / search_code. ${hint}`,
      };
    }
    try {
      assertShellCommandPathsAllowed(command);
    } catch (e: any) {
      return { ok: false, message: e?.message || String(e) };
    }
    // Block Export-Csv / Out-File / > redirects into likely source folders
    if (
      /Export-Csv|Out-File|Set-Content|Add-Content|Redirect|>>?/i.test(command)
    ) {
      return {
        ok: false,
        message:
          "Shell blocked: write redirects (Export-Csv/Out-File/>) are not allowed via run_shell. Use write_report / write_file under the output home.",
      };
    }
    if (process.platform === "win32") {
      if (/^powershell(\.exe)?\b/i.test(command)) {
        const m = command.match(/-Command\s+([\s\S]+)$/i);
        const psBody = (m?.[1] || command.replace(/^powershell(\.exe)?\s+/i, "")).trim();
        return {
          ok: true,
          argv: ["powershell.exe", "-NoProfile", "-Command", psBody],
          display: command,
        };
      }
      return { ok: true, argv: ["cmd.exe", "/c", command], display: command };
    }
    return { ok: true, argv: ["bash", "-lc", command], display: command };
  }

  return {
    ok: false,
    message:
      "run_shell requires params.argv (preferred) or params.command. Example argv: [\"powershell.exe\",\"-NoProfile\",\"-Command\",\"Get-ChildItem -LiteralPath 'D:\\\\My Documents\\\\Spendy'\"]",
  };
}

async function runShellTool(params: Record<string, unknown>): Promise<ToolResult> {
  if (isShellDisabled()) {
    return {
      ok: false,
      tool: "run_shell",
      message:
        "run_shell disabled for analysis/audit routes. Use list_dir, read_file, search_code, write_report instead.",
    };
  }

  const resolved = resolveShellArgv(params);
  if (!resolved.ok) {
    return { ok: false, tool: "run_shell", message: resolved.message };
  }

  const [file, ...args] = resolved.argv;
  let stdout = "";
  let stderr = "";
  try {
    const r = await execFileAsync(file, args, {
      windowsHide: true,
      timeout: 60000,
      maxBuffer: 1024 * 512,
    });
    stdout = r.stdout;
    stderr = r.stderr;
  } catch (e: any) {
    return {
      ok: false,
      tool: "run_shell",
      message: e?.message || String(e),
      data: {
        stdout: String(e?.stdout || "").slice(0, 4000),
        stderr: String(e?.stderr || "").slice(0, 1000),
        argv: resolved.argv,
      },
    };
  }

  return {
    ok: true,
    tool: "run_shell",
    message: "Shell command finished",
    data: {
      stdout: stdout.slice(0, 6000),
      stderr: stderr.slice(0, 1000),
      argv: resolved.argv,
    },
  };
}

export const TOOL_CATALOG = `
Available tools (ONE JSON — follow USER GOAL verbs; paths work on Windows/macOS/Linux user environment):
PREFER structured tools first; shell last (and disabled on analysis/audit routes):
1) list_dir     { "path":"E:/UpNexa.com/spendy" }
2) read_file    { "path":"...", "maxLines":200, "maxBytes":48000 }
3) search_code  { "path":"...", "pattern":"supabase|EGP" }   // alias: grep
4) write_report { "name":"gap-report.md", "content":"..." }  // ONLY under Documents/Sam-Harness
5) write_file   { "path":"<output-home>/documents/note.txt", "content":"..." }
6) move_file / copy_file / mkdir / delete_path(confirm:true) / write_excel
7) open_path / screenshot
8) run_shell    PREFER argv array (paths with spaces safe):
                { "argv":["powershell.exe","-NoProfile","-Command","Get-ChildItem -LiteralPath 'D:\\\\My Documents\\\\Spendy'"] }
                Legacy string command is allowlisted read-only; Export-Csv/Out-File/> blocked.
9) run_node_sandbox / mcp_call / desktop_* / ffmpeg / open_media
10) finish       { "summary":"...", "success":true|false }

Rules (English/ASCII):
- Prompt project + spec folders are READ-ONLY sources. Never write/delete/move into them.
- Agent reports go under Documents/Sam-Harness (SAM_OUTPUT_HOME): reports/, documents/, runs/.
- Analysis/audit routes: run_shell is disabled — use list_dir/read_file/search_code/write_report.
- After 2 identical tool failures, switch approach; do not retry the same broken command.
- Never delete without confirm:true. Never touch OS system folders or secrets.
- Use real names from the Goal — do not copy catalog examples blindly.
`;

/** Analysis-safe catalog (no shell / no desktop mutation emphasis). */
export const ANALYSIS_TOOL_CATALOG = `
Analysis tools only (run_shell DISABLED):
1) list_dir { "path":"..." }
2) read_file { "path":"...", "maxLines":200 }
3) search_code { "path":"...", "pattern":"..." }
4) write_report { "name":"report.md", "content":"..." }  // output home only
5) finish { "summary":"...", "success":true|false }
Source project/spec paths are READ-ONLY. Write only under Documents/Sam-Harness.
`;

type ToolFn = (params: Record<string, unknown>) => Promise<ToolResult>;

const TOOLS: Record<string, ToolFn> = {
  list_dir: listDir,
  read_file: readFileTool,
  write_file: writeFileTool,
  write_report: writeReportTool,
  write_excel: writeExcelTool,
  mkdir: mkdirTool,
  delete_path: deletePathTool,
  move_file: moveFileTool,
  copy_file: copyFileTool,
  open_path: openPathTool,
  screenshot: screenshotTool,
  run_shell: runShellTool,
  search_code: searchCodeTool,
  grep: searchCodeTool,
};

export async function executeTool(
  name: string,
  params: Record<string, unknown>
): Promise<ToolResult> {
  if (name === "finish") {
    return {
      ok: Boolean(params.success !== false),
      tool: "finish",
      message: String(params.summary || "Finished"),
      data: params,
    };
  }
  if (name === "run_node_sandbox") {
    const { runNodeSandboxTool } = await import("./sandbox.js");
    return runNodeSandboxTool(params);
  }
  if (name === "mcp_call" || /^mcp:/i.test(name)) {
    const { mcpCallTool, parseMcpToolName } = await import("./mcp.js");
    if (/^mcp:/i.test(name) && name !== "mcp_call") {
      const parsed = parseMcpToolName(name);
      if (!parsed) {
        return { ok: false, tool: name, message: `Invalid MCP tool id: ${name}` };
      }
      return mcpCallTool(
        {
          server: parsed.server,
          tool: parsed.name,
          arguments: params,
        },
        process.cwd()
      );
    }
    return mcpCallTool(params, process.cwd());
  }
  // Phase 4 desktop operator tools
  {
    const { desktopToolToAction, runDesktopAction } = await import("./desktop/index.js");
    const action = desktopToolToAction(name);
    if (action) {
      const result = await runDesktopAction({
        action,
        params,
        dryRun: params.dryRun === true || params.dryRun === "true",
        skipVerify: params.skipVerify === true || params.skipVerify === "true",
        approved:
          params.approved === true || params.approved === "true"
            ? true
            : typeof params.approved === "string"
              ? params.approved
              : undefined,
        runId: typeof params.runId === "string" ? params.runId : undefined,
        verify: Array.isArray(params.verify) ? (params.verify as any) : undefined,
        verifyRetries:
          params.verifyRetries != null ? Number(params.verifyRetries) : undefined,
      });
      return {
        ok: result.ok,
        tool: name,
        message: result.message,
        data: result,
      };
    }
  }
  const fn = TOOLS[name];
  if (!fn) {
    return { ok: false, tool: name, message: `Unknown tool: ${name}` };
  }
  try {
    return await fn(params);
  } catch (e: any) {
    return { ok: false, tool: name, message: e?.message || String(e) };
  }
}
