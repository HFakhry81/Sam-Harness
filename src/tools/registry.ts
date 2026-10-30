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
  const content = fs.readFileSync(abs, "utf-8");
  const preview = content.length > 4000 ? content.slice(0, 4000) + "\n...(truncated)" : content;
  return {
    ok: true,
    tool: "read_file",
    message: `Read ${abs} (${content.length} chars)`,
    data: { path: abs, content: preview },
  };
}

async function writeFileTool(params: Record<string, unknown>): Promise<ToolResult> {
  const abs = resolveUserPath(asString(params.path, "path"));
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

async function mkdirTool(params: Record<string, unknown>): Promise<ToolResult> {
  const abs = resolveUserPath(asString(params.path, "path"));
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
  assertAllowedPath(abs);
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
  assertAllowedPath(source);
  assertAllowedPath(destination);
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
  if (process.platform !== "win32") {
    return {
      ok: false,
      tool: "screenshot",
      message: "screenshot tool currently supports Windows only",
    };
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

async function runShellTool(params: Record<string, unknown>): Promise<ToolResult> {
  const command = asString(params.command, "command").trim();
  const allowedPrefixes = [
    "dir ",
    "type ",
    "echo ",
    "where ",
    "powershell -noprofile -command get-",
    "powershell.exe -noprofile -command get-",
  ];
  const okCmd = allowedPrefixes.some((p) => command.toLowerCase().startsWith(p.toLowerCase()));
  if (!okCmd) {
    return {
      ok: false,
      tool: "run_shell",
      message:
        "Shell blocked. For screenshots use tool screenshot. Allowed shell: dir, type, echo, where, powershell Get-* only.",
    };
  }

  // Sandbox: every filesystem path referenced by the command must be under workspace roots
  try {
    assertShellCommandPathsAllowed(command);
  } catch (e: any) {
    return {
      ok: false,
      tool: "run_shell",
      message: e?.message || String(e),
    };
  }

  let stdout = "";
  let stderr = "";
  // Never pipe PowerShell through cmd.exe — `|` breaks (Select-Object runs in cmd).
  if (/^powershell(\.exe)?\b/i.test(command)) {
    const m = command.match(/-Command\s+([\s\S]+)$/i);
    const psBody = (m?.[1] || command.replace(/^powershell(\.exe)?\s+/i, "")).trim();
    const r = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", psBody],
      {
        windowsHide: true,
        timeout: 60000,
        maxBuffer: 1024 * 512,
      }
    );
    stdout = r.stdout;
    stderr = r.stderr;
  } else {
    const r = await execFileAsync("cmd", ["/c", command], {
      windowsHide: true,
      timeout: 20000,
      maxBuffer: 1024 * 256,
    });
    stdout = r.stdout;
    stderr = r.stderr;
  }

  return {
    ok: true,
    tool: "run_shell",
    message: "Shell command finished",
    data: { stdout: stdout.slice(0, 6000), stderr: stderr.slice(0, 1000) },
  };
}

export const TOOL_CATALOG = `
Available tools (ONE JSON — follow USER GOAL verbs; paths work on Windows/macOS/Linux user environment):
1) move_file    { "source":"Desktop/file.xls", "destination":"D:/file.xls" }
2) copy_file    { "source":"...", "destination":"..." }
3) write_file   { "path":"Desktop/note.txt", "content":"..." }   // create or update
4) mkdir        { "path":"Desktop/NewFolder" }
5) delete_path  { "path":"Desktop/old.txt", "confirm":true }  // dirs need recursive:true if not empty
6) write_excel  { "path":"Desktop/report.xls", "a1":"..." }  // ONLY create new sheet — not for "report ABOUT excel files"
7) open_path / list_dir / read_file
8) run_shell    { "command":"powershell -NoProfile -Command Get-ChildItem D:\\\\ -Recurse -Include *.xls,*.xlsx,*.xlsm -File -ErrorAction SilentlyContinue | Select-Object -First 80 FullName" }
9) screenshot   { "filename":"capture.png" }  // ONLY if Goal asks
10) run_node_sandbox { "code":"console.log(1+1)" }  // isolated Node REPL (timeout/memory; optional Docker)
11) mcp_call    { "server":"name", "tool":"toolName", "arguments":{...} }  // from mcp.json
12) finish       { "summary":"...", "success":true|false }

Rules:
- انقل/move → move_file. اعمل مجلد → mkdir. احذف → delete_path with confirm:true (role matrix + confirm; required outside agent workspace).
- Agent-generated reports/docs default under Documents/Sam-Harness (SAM_OUTPUT_HOME): reports/, documents/, runs/.
- تقرير/جرد ملفات Excel على محرك → run_shell Get-ChildItem أو list_dir ثم write_file تقرير نصي (.txt) — لا تستخدم write_excel.
- Never delete without confirm:true. Never touch OS system folders, .ssh, browser profiles, or harness secrets.
- MCP tools require mcp.json; sandboxed code never receives secret env vars.
- Use real names from the Goal — do not copy catalog examples blindly.
`;

type ToolFn = (params: Record<string, unknown>) => Promise<ToolResult>;

const TOOLS: Record<string, ToolFn> = {
  list_dir: listDir,
  read_file: readFileTool,
  write_file: writeFileTool,
  write_excel: writeExcelTool,
  mkdir: mkdirTool,
  delete_path: deletePathTool,
  move_file: moveFileTool,
  copy_file: copyFileTool,
  open_path: openPathTool,
  screenshot: screenshotTool,
  run_shell: runShellTool,
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
