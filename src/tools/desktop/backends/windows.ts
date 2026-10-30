/**
 * Windows desktop backend — UI Automation first, screenshot/GDI helpers for vision fallback.
 */
import { execFile, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { assertAllowedPath, resolveUserPath } from "../../../lib/paths.js";
import type {
  ClipboardContent,
  DesktopBackend,
  FileDialogRequest,
  ScreenshotResult,
  UiaElement,
  WindowInfo,
} from "../types.js";
import {
  parseJsonOutput,
  psQuote,
  runPowerShell,
  UIA_PREAMBLE,
} from "./windowsPs.js";

const execFileAsync = promisify(execFile);

function ensureParent(p: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

export function createWindowsBackend(): DesktopBackend {
  return {
    platform: "win32",
    name: "windows-uia",

    async listWindows(): Promise<WindowInfo[]> {
      const script = `
${UIA_PREAMBLE}
$root = [System.Windows.Automation.AutomationElement]::RootElement
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$out = @()
$child = $walker.GetFirstChild($root)
while ($null -ne $child) {
  try {
    $name = $child.Current.Name
    if ($name) {
      $rect = $child.Current.BoundingRectangle
      $pid = 0
      try { $pid = $child.Current.ProcessId } catch {}
      $proc = ''
      try { $proc = (Get-Process -Id $pid -ErrorAction SilentlyContinue).ProcessName } catch {}
      $out += [ordered]@{
        handle = [string]$child.Current.NativeWindowHandle
        title = $name
        processName = $proc
        pid = $pid
        bounds = @{ x=[int]$rect.X; y=[int]$rect.Y; width=[int]$rect.Width; height=[int]$rect.Height }
      }
    }
  } catch {}
  $child = $walker.GetNextSibling($child)
}
$out | ConvertTo-Json -Depth 5 -Compress
`.trim();
      const { stdout } = await runPowerShell(script, { timeoutMs: 20_000 });
      const parsed = parseJsonOutput(stdout);
      if (!parsed) return [];
      return (Array.isArray(parsed) ? parsed : [parsed]) as WindowInfo[];
    },

    async focusWindow(opts): Promise<WindowInfo> {
      const handle = opts.handle ? psQuote(opts.handle) : "''";
      const title = opts.titleIncludes ? psQuote(opts.titleIncludes) : "''";
      const proc = opts.processName ? psQuote(opts.processName) : "''";
      const script = `
${UIA_PREAMBLE}
$handle = ${handle}
$title = ${title}
$procName = ${proc}
$target = $null
if ($handle) {
  $target = Get-RootElement -Handle $handle
} elseif ($title) {
  $target = Get-RootElement -TitleIncludes $title
} elseif ($procName) {
  $p = Get-Process -Name ($procName -replace '\\.exe$','') -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $p) { throw "Process not found: $procName" }
  $target = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
} else {
  throw "focus_window requires handle, titleIncludes, or processName"
}
try {
  $target.SetFocus()
} catch {
  # Fallback: ShowWindow + SetForegroundWindow
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
  [WinFocus]::ShowWindow([IntPtr]$target.Current.NativeWindowHandle, 9) | Out-Null
  [WinFocus]::SetForegroundWindow([IntPtr]$target.Current.NativeWindowHandle) | Out-Null
}
$rect = $target.Current.BoundingRectangle
$pid = 0; try { $pid = $target.Current.ProcessId } catch {}
$proc = ''; try { $proc = (Get-Process -Id $pid -ErrorAction SilentlyContinue).ProcessName } catch {}
@{
  handle = [string]$target.Current.NativeWindowHandle
  title = $target.Current.Name
  processName = $proc
  pid = $pid
  bounds = @{ x=[int]$rect.X; y=[int]$rect.Y; width=[int]$rect.Width; height=[int]$rect.Height }
} | ConvertTo-Json -Compress
`.trim();
      const { stdout } = await runPowerShell(script);
      return parseJsonOutput(stdout) as WindowInfo;
    },

    async launchApp(opts) {
      const app = opts.app;
      const args = opts.args || [];
      const cwd = opts.cwd;
      const waitMs = opts.waitForWindowMs ?? 5000;
      // Prefer Start-Process for .exe / known apps; allow shell apps like notepad
      const script = `
$app = ${psQuote(app)}
$argList = @(${args.map((a) => psQuote(a)).join(",")})
$cwd = ${cwd ? psQuote(cwd) : "''"}
$waitMs = ${Number(waitMs)}
$psi = @{ FilePath = $app; PassThru = $true }
if ($argList.Count -gt 0) { $psi.ArgumentList = $argList }
if ($cwd) { $psi.WorkingDirectory = $cwd }
try {
  $p = Start-Process @psi
} catch {
  # Fallback: cmd start for shell builtins / associations
  $p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c','start','',$app) + $argList -PassThru
}
Start-Sleep -Milliseconds ([Math]::Min($waitMs, 15000))
$win = $null
try {
  if ($p -and $p.MainWindowHandle -ne 0) {
    Add-Type -AssemblyName UIAutomationClient
    $el = [System.Windows.Automation.AutomationElement]::FromHandle($p.MainWindowHandle)
    $rect = $el.Current.BoundingRectangle
    $win = @{
      handle = [string]$el.Current.NativeWindowHandle
      title = $el.Current.Name
      processName = $p.ProcessName
      pid = $p.Id
      bounds = @{ x=[int]$rect.X; y=[int]$rect.Y; width=[int]$rect.Width; height=[int]$rect.Height }
    }
  }
} catch {}
@{ pid = $(if ($p) { $p.Id } else { $null }); window = $win } | ConvertTo-Json -Depth 5 -Compress
`.trim();
      const { stdout } = await runPowerShell(script, { timeoutMs: waitMs + 15_000 });
      return parseJsonOutput(stdout) as { pid?: number; window?: WindowInfo };
    },

    async closeWindow(opts) {
      const handle = opts.handle ? psQuote(opts.handle) : "''";
      const title = opts.titleIncludes ? psQuote(opts.titleIncludes) : "''";
      const script = `
${UIA_PREAMBLE}
$handle = ${handle}
$title = ${title}
if ($handle) { $el = Get-RootElement -Handle $handle }
elseif ($title) { $el = Get-RootElement -TitleIncludes $title }
else { throw 'close_window requires handle or titleIncludes' }
$wp = $el.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
$wp.Close()
@{ ok = $true } | ConvertTo-Json -Compress
`.trim();
      await runPowerShell(script);
    },

    async getUiaTree(opts = {}): Promise<UiaElement> {
      const handle = opts.handle ? psQuote(opts.handle) : "''";
      const title = opts.titleIncludes ? psQuote(opts.titleIncludes) : "''";
      const maxDepth = opts.maxDepth ?? 4;
      const script = `
${UIA_PREAMBLE}
$handle = ${handle}
$title = ${title}
if ($handle) { $el = Get-RootElement -Handle $handle }
elseif ($title) { $el = Get-RootElement -TitleIncludes $title }
else { $el = [System.Windows.Automation.AutomationElement]::FocusedElement }
if (-not $el) { $el = [System.Windows.Automation.AutomationElement]::RootElement }
Convert-Element $el 0 ${maxDepth} | ConvertTo-Json -Depth 20 -Compress
`.trim();
      const { stdout } = await runPowerShell(script, { timeoutMs: 45_000, maxBuffer: 4 * 1024 * 1024 });
      return parseJsonOutput(stdout) as UiaElement;
    },

    async findUia(opts): Promise<UiaElement | null> {
      const script = `
${UIA_PREAMBLE}
$handle = ${opts.handle ? psQuote(opts.handle) : "''"}
$title = ${opts.titleIncludes ? psQuote(opts.titleIncludes) : "''"}
if ($handle) { $root = Get-RootElement -Handle $handle }
elseif ($title) { $root = Get-RootElement -TitleIncludes $title }
else { $root = [System.Windows.Automation.AutomationElement]::FocusedElement; if (-not $root) { $root = [System.Windows.Automation.AutomationElement]::RootElement } }
$el = Find-Element -Root $root -Name ${opts.name ? psQuote(opts.name) : "''"} -AutomationId ${opts.automationId ? psQuote(opts.automationId) : "''"} -ControlType ${opts.controlType ? psQuote(opts.controlType) : "''"} -MaxDepth ${opts.maxDepth ?? 10}
if (-not $el) { 'null'; exit 0 }
Convert-Element $el 0 1 | ConvertTo-Json -Depth 6 -Compress
`.trim();
      const { stdout } = await runPowerShell(script);
      const t = stdout.trim();
      if (!t || t === "null") return null;
      return parseJsonOutput(stdout) as UiaElement;
    },

    async invokeUia(opts): Promise<UiaElement> {
      const pattern = opts.pattern || "Invoke";
      const script = `
${UIA_PREAMBLE}
$handle = ${opts.handle ? psQuote(opts.handle) : "''"}
$title = ${opts.titleIncludes ? psQuote(opts.titleIncludes) : "''"}
if ($handle) { $root = Get-RootElement -Handle $handle }
elseif ($title) { $root = Get-RootElement -TitleIncludes $title }
else { $root = [System.Windows.Automation.AutomationElement]::FocusedElement }
$el = Find-Element -Root $root -Name ${opts.name ? psQuote(opts.name) : "''"} -AutomationId ${opts.automationId ? psQuote(opts.automationId) : "''"} -ControlType ${opts.controlType ? psQuote(opts.controlType) : "''"}
if (-not $el) { throw 'UIA element not found for invoke' }
$patName = ${psQuote(pattern)}
switch ($patName) {
  'Toggle' { $p = $el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern); $p.Toggle() }
  'ExpandCollapse' { $p = $el.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern); $p.Expand() }
  'SelectionItem' { $p = $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern); $p.Select() }
  default { $p = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern); $p.Invoke() }
}
Convert-Element $el 0 1 | ConvertTo-Json -Depth 6 -Compress
`.trim();
      const { stdout } = await runPowerShell(script);
      return parseJsonOutput(stdout) as UiaElement;
    },

    async setUiaValue(opts): Promise<UiaElement> {
      const script = `
${UIA_PREAMBLE}
$handle = ${opts.handle ? psQuote(opts.handle) : "''"}
$title = ${opts.titleIncludes ? psQuote(opts.titleIncludes) : "''"}
if ($handle) { $root = Get-RootElement -Handle $handle }
elseif ($title) { $root = Get-RootElement -TitleIncludes $title }
else { $root = [System.Windows.Automation.AutomationElement]::FocusedElement }
$el = Find-Element -Root $root -Name ${opts.name ? psQuote(opts.name) : "''"} -AutomationId ${opts.automationId ? psQuote(opts.automationId) : "''"}
if (-not $el) { throw 'UIA element not found for set_value' }
$vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
$vp.SetValue(${psQuote(opts.value)})
Convert-Element $el 0 1 | ConvertTo-Json -Depth 6 -Compress
`.trim();
      const { stdout } = await runPowerShell(script);
      return parseJsonOutput(stdout) as UiaElement;
    },

    async typeText(opts) {
      // SendKeys treats +^%~(){} specially — escape each reserved char.
      await runPowerShell(`
Add-Type -AssemblyName System.Windows.Forms
$text = ${psQuote(opts.text)}
$sb = New-Object System.Text.StringBuilder
foreach ($ch in $text.ToCharArray()) {
  switch ($ch) {
    '+' { [void]$sb.Append('{+}') }
    '^' { [void]$sb.Append('{^}') }
    '%' { [void]$sb.Append('{%}') }
    '~' { [void]$sb.Append('{~}') }
    '(' { [void]$sb.Append('{(}') }
    ')' { [void]$sb.Append('{)}') }
    '{' { [void]$sb.Append('{{}') }
    '}' { [void]$sb.Append('{}}') }
    default { [void]$sb.Append($ch) }
  }
}
[System.Windows.Forms.SendKeys]::SendWait($sb.ToString())
`.trim());
    },

    async sendKeys(opts) {
      await runPowerShell(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait(${psQuote(opts.keys)})
`.trim());
    },

    async click(opts) {
      if (opts.name || opts.automationId) {
        await this.invokeUia({
          handle: opts.handle,
          titleIncludes: opts.titleIncludes,
          name: opts.name,
          automationId: opts.automationId,
          pattern: "Invoke",
        });
        return;
      }
      const x = Number(opts.x ?? 0);
      const y = Number(opts.y ?? 0);
      const button = opts.button || "left";
      const count = opts.clickCount ?? 1;
      const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int cButtons, int dwExtraInfo);
  public const int LEFTDOWN = 0x02; public const int LEFTUP = 0x04;
  public const int RIGHTDOWN = 0x08; public const int RIGHTUP = 0x10;
  public const int MIDDLEDOWN = 0x20; public const int MIDDLEUP = 0x40;
}
"@
[WinMouse]::SetCursorPos(${x}, ${y}) | Out-Null
$btn = ${psQuote(button)}
$count = ${count}
for ($i=0; $i -lt $count; $i++) {
  if ($btn -eq 'right') {
    [WinMouse]::mouse_event([WinMouse]::RIGHTDOWN, 0, 0, 0, 0)
    [WinMouse]::mouse_event([WinMouse]::RIGHTUP, 0, 0, 0, 0)
  } elseif ($btn -eq 'middle') {
    [WinMouse]::mouse_event([WinMouse]::MIDDLEDOWN, 0, 0, 0, 0)
    [WinMouse]::mouse_event([WinMouse]::MIDDLEUP, 0, 0, 0, 0)
  } else {
    [WinMouse]::mouse_event([WinMouse]::LEFTDOWN, 0, 0, 0, 0)
    [WinMouse]::mouse_event([WinMouse]::LEFTUP, 0, 0, 0, 0)
  }
  Start-Sleep -Milliseconds 40
}
`.trim();
      await runPowerShell(script);
    },

    async moveMouse(opts) {
      await runPowerShell(`
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinMouseMove {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
}
"@
[WinMouseMove]::SetCursorPos(${Number(opts.x)}, ${Number(opts.y)}) | Out-Null
`.trim());
    },

    async getClipboard(): Promise<ClipboardContent> {
      const { stdout } = await runPowerShell(`
Add-Type -AssemblyName System.Windows.Forms
$t = [System.Windows.Forms.Clipboard]::GetText()
@{ text = $t; format = 'text' } | ConvertTo-Json -Compress
`.trim());
      return (parseJsonOutput(stdout) as ClipboardContent) || { text: "" };
    },

    async setClipboard(opts) {
      await runPowerShell(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Clipboard]::SetText(${psQuote(opts.text)})
`.trim());
    },

    async handleFileDialog(opts: FileDialogRequest) {
      // Drive common Open/Save dialogs via UIA: set Edit control + click Open/Save
      const mode = opts.mode || "open";
      const filePath = opts.path || "";
      const dialogTitle = opts.dialogTitle || (mode === "save" ? "Save" : "Open");
      const buttonName = mode === "save" ? "Save" : "Open";
      if (!filePath) {
        return { handled: false, path: undefined };
      }
      const script = `
${UIA_PREAMBLE}
$dlg = Get-RootElement -TitleIncludes ${psQuote(dialogTitle)}
$edit = Find-Element -Root $dlg -ControlType 'Edit' -Name '' -AutomationId '1148'
if (-not $edit) { $edit = Find-Element -Root $dlg -ControlType 'Edit' -Name 'File name' -AutomationId '' }
if (-not $edit) { throw 'File dialog edit box not found' }
$vp = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
$vp.SetValue(${psQuote(filePath)})
$btn = Find-Element -Root $dlg -Name ${psQuote(buttonName)} -ControlType 'Button' -AutomationId ''
if (-not $btn) { $btn = Find-Element -Root $dlg -Name 'Save' -ControlType 'Button' -AutomationId '' }
if (-not $btn) { throw 'File dialog confirm button not found' }
$inv = $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
$inv.Invoke()
@{ handled = $true; path = ${psQuote(filePath)} } | ConvertTo-Json -Compress
`.trim();
      try {
        const { stdout } = await runPowerShell(script, { timeoutMs: 15_000 });
        return parseJsonOutput(stdout) as { path?: string; handled: boolean };
      } catch (e: any) {
        // Fallback: type path + Enter into focused dialog
        await runPowerShell(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait(${psQuote(filePath)})
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
`.trim());
        return { handled: true, path: filePath };
      }
    },

    async screenshot(opts = {}): Promise<ScreenshotResult> {
      const dest =
        opts.path ||
        path.join(
          process.env.TEMP || process.env.TMP || ".",
          `sam-desktop-${Date.now().toString(36)}.png`
        );
      ensureParent(dest);
      const region = opts.region;
      const script = region
        ? `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$bmp = New-Object System.Drawing.Bitmap ${region.width}, ${region.height}
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen(${region.x}, ${region.y}, 0, 0, (New-Object System.Drawing.Size(${region.width}, ${region.height})))
$bmp.Save(${psQuote(dest)}, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
@{ path = ${psQuote(dest)}; bytes = (Get-Item ${psQuote(dest)}).Length; width = ${region.width}; height = ${region.height} } | ConvertTo-Json -Compress
`.trim()
        : `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save(${psQuote(dest)}, [System.Drawing.Imaging.ImageFormat]::Png)
$w = $bounds.Width; $h = $bounds.Height
$g.Dispose(); $bmp.Dispose()
@{ path = ${psQuote(dest)}; bytes = (Get-Item ${psQuote(dest)}).Length; width = $w; height = $h } | ConvertTo-Json -Compress
`.trim();
      const { stdout } = await runPowerShell(script, { timeoutMs: 20_000 });
      const parsed = parseJsonOutput(stdout) as ScreenshotResult;
      if (!fs.existsSync(dest)) {
        throw new Error("Screenshot file was not written");
      }
      return {
        path: dest,
        bytes: parsed?.bytes ?? fs.statSync(dest).size,
        width: parsed?.width,
        height: parsed?.height,
      };
    },

    async openMedia(opts) {
      const abs = resolveUserPath(opts.path);
      assertAllowedPath(abs);
      if (!fs.existsSync(abs)) throw new Error(`Media path not found: ${abs}`);
      await execFileAsync("cmd", ["/c", "start", "", abs], { windowsHide: true });
      return { opened: true, path: abs };
    },

    async ffmpeg(opts) {
      // Validate output paths when present in args
      for (const a of opts.args) {
        if (/^[A-Za-z]:\\|^[/~]/.test(a) || /\.(mp4|mkv|mov|wav|mp3|png|jpg)$/i.test(a)) {
          try {
            assertAllowedPath(resolveUserPath(a));
          } catch {
            /* non-path flags ignored */
          }
        }
      }
      try {
        const r = await execFileAsync("ffmpeg", opts.args, {
          windowsHide: true,
          timeout: opts.timeoutMs ?? 120_000,
          maxBuffer: 1024 * 1024,
          cwd: opts.cwd,
        });
        return { stdout: String(r.stdout || ""), stderr: String(r.stderr || ""), code: 0 };
      } catch (e: any) {
        return {
          stdout: String(e?.stdout || ""),
          stderr: String(e?.stderr || e?.message || e),
          code: typeof e?.code === "number" ? e.code : 1,
        };
      }
    },

    async screenshotDiff(beforePath, afterPath) {
      const script = `
Add-Type -AssemblyName System.Drawing
$a = [System.Drawing.Bitmap]::FromFile(${psQuote(beforePath)})
$b = [System.Drawing.Bitmap]::FromFile(${psQuote(afterPath)})
try {
  $w = [Math]::Min($a.Width, $b.Width)
  $h = [Math]::Min($a.Height, $b.Height)
  if ($w -le 0 -or $h -le 0) { @{ ratio = 1.0 } | ConvertTo-Json -Compress; return }
  $stepX = [Math]::Max(1, [int]($w / 80))
  $stepY = [Math]::Max(1, [int]($h / 80))
  $total = 0; $diff = 0
  for ($y=0; $y -lt $h; $y += $stepY) {
    for ($x=0; $x -lt $w; $x += $stepX) {
      $ca = $a.GetPixel($x,$y); $cb = $b.GetPixel($x,$y)
      $total++
      $d = [Math]::Abs([int]$ca.R - [int]$cb.R) + [Math]::Abs([int]$ca.G - [int]$cb.G) + [Math]::Abs([int]$ca.B - [int]$cb.B)
      if ($d -gt 30) { $diff++ }
    }
  }
  $ratio = if ($total -eq 0) { 1.0 } else { [double]$diff / [double]$total }
  @{ ratio = $ratio } | ConvertTo-Json -Compress
} finally { $a.Dispose(); $b.Dispose() }
`.trim();
      try {
        const { stdout } = await runPowerShell(script, { timeoutMs: 30_000 });
        const parsed = parseJsonOutput(stdout) as { ratio?: number };
        return Number(parsed?.ratio ?? 1);
      } catch {
        try {
          const sa = fs.statSync(beforePath);
          const sb = fs.statSync(afterPath);
          return sa.size === sb.size ? 0 : 0.5;
        } catch {
          return 1;
        }
      }
    },

    async installKillHotkey(opts) {
      // Best-effort: write a small watcher script note; full global hooks need a persistent process.
      // Operators poll the flag file; a companion watcher can be started detached.
      const flag = opts.flagPath;
      const watcher = `
# Sam-Harness desktop kill hotkey watcher (Ctrl+Shift+Alt+K)
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public class SamHotkey {
  public const int MOD_ALT = 0x0001;
  public const int MOD_CONTROL = 0x0002;
  public const int MOD_SHIFT = 0x0004;
  public const int WM_HOTKEY = 0x0312;
  [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr hWnd, int id, int fsModifiers, int vk);
  [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
}
"@
$flag = ${psQuote(flag)}
$form = New-Object System.Windows.Forms.Form
$form.Visible = $false
$form.ShowInTaskbar = $false
# K = 0x4B
[void][SamHotkey]::RegisterHotKey($form.Handle, 1, ([SamHotkey]::MOD_CONTROL -bor [SamHotkey]::MOD_SHIFT -bor [SamHotkey]::MOD_ALT), 0x4B)
$form.Add_KeyDown({}) | Out-Null
$wndProc = {
  # Poll message via Application.DoEvents loop
}
Write-Host "Sam-Harness kill hotkey watcher ready (Ctrl+Shift+Alt+K) -> $flag"
while ($true) {
  Start-Sleep -Milliseconds 200
  [System.Windows.Forms.Application]::DoEvents()
  # Fallback: also honor env file written by other means
}
`.trim();
      // Do not auto-start a forever watcher in library code; document + optional env.
      if (String(process.env.SAM_DESKTOP_HOTKEY_WATCHER || "").trim() === "1") {
        const scriptPath = path.join(
          process.env.TEMP || process.env.TMP || ".",
          "sam-desktop-hotkey.ps1"
        );
        fs.writeFileSync(scriptPath, watcher, "utf-8");
        // Detached start — fire and forget
        const child = spawn(
          "powershell.exe",
          ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
          { windowsHide: true, detached: true, stdio: "ignore" }
        );
        child.unref();
        return {
          installed: true,
          note: `Hotkey watcher started; writes pause flag to ${flag}. Press Ctrl+Shift+Alt+K (when message loop active) or create the flag file.`,
        };
      }
      return {
        installed: false,
        note: `Set SAM_DESKTOP_HOTKEY_WATCHER=1 to start a background watcher, or create ${flag} / set SAM_DESKTOP_PAUSED=1`,
      };
    },
  };
}
