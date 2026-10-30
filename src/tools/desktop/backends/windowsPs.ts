/**
 * Shared PowerShell helpers for the Windows desktop backend.
 * Uses .NET UI Automation (UIAutomationClient) — no native Node addons.
 */
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export async function runPowerShell(
  script: string,
  opts: { timeoutMs?: number; maxBuffer?: number } = {}
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      windowsHide: true,
      timeout: opts.timeoutMs ?? 30_000,
      maxBuffer: opts.maxBuffer ?? 1024 * 1024,
      encoding: "utf-8",
    }
  );
  return { stdout: String(stdout || ""), stderr: String(stderr || "") };
}

export function psQuote(s: string): string {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

/** Compact UIA helpers embedded into each script. */
export const UIA_PREAMBLE = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Get-RootElement {
  param([string]$Handle, [string]$TitleIncludes)
  if ($Handle) {
    $h = [IntPtr]::new([int64]$Handle)
    return [System.Windows.Automation.AutomationElement]::FromHandle($h)
  }
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  if ($TitleIncludes) {
    $cond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::NameProperty, $TitleIncludes
    )
    # Prefer contains via walker scan (NameProperty is exact); fall back to desktop children
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $child = $walker.GetFirstChild($root)
    while ($null -ne $child) {
      if ($child.Current.Name -and $child.Current.Name.IndexOf($TitleIncludes, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
        return $child
      }
      $child = $walker.GetNextSibling($child)
    }
    throw "Window not found for titleIncludes=$TitleIncludes"
  }
  return $root
}

function Convert-Element([System.Windows.Automation.AutomationElement]$el, [int]$depth, [int]$maxDepth) {
  if ($null -eq $el) { return $null }
  $rect = $el.Current.BoundingRectangle
  $obj = [ordered]@{
    name = $el.Current.Name
    automationId = $el.Current.AutomationId
    className = $el.Current.ClassName
    controlType = $el.Current.ControlType.ProgrammaticName
    boundingRectangle = @{
      x = [int]$rect.X; y = [int]$rect.Y
      width = [int]$rect.Width; height = [int]$rect.Height
    }
  }
  try {
    $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    if ($vp) { $obj.value = $vp.Current.Value }
  } catch {}
  if ($depth -lt $maxDepth) {
    $kids = @()
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $child = $walker.GetFirstChild($el)
    $count = 0
    while ($null -ne $child -and $count -lt 80) {
      $kids += (Convert-Element $child ($depth+1) $maxDepth)
      $child = $walker.GetNextSibling($child)
      $count++
    }
    if ($kids.Count -gt 0) { $obj.children = $kids }
  }
  return $obj
}

function Find-Element {
  param($Root, [string]$Name, [string]$AutomationId, [string]$ControlType, [int]$MaxDepth = 8)
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $stack = New-Object System.Collections.Stack
  $stack.Push(@{ el = $Root; depth = 0 })
  while ($stack.Count -gt 0) {
    $item = $stack.Pop()
    $el = $item.el
    $depth = $item.depth
    $ok = $true
    if ($AutomationId -and $el.Current.AutomationId -ne $AutomationId) { $ok = $false }
    if ($Name -and (-not $el.Current.Name -or $el.Current.Name.IndexOf($Name, [StringComparison]::OrdinalIgnoreCase) -lt 0)) { $ok = $false }
    if ($ControlType -and $el.Current.ControlType.ProgrammaticName -notmatch [regex]::Escape($ControlType)) { $ok = $false }
    if ($ok -and ($Name -or $AutomationId -or $ControlType)) { return $el }
    if ($depth -lt $MaxDepth) {
      $child = $walker.GetFirstChild($el)
      while ($null -ne $child) {
        $stack.Push(@{ el = $child; depth = ($depth+1) })
        $child = $walker.GetNextSibling($child)
      }
    }
  }
  return $null
}
`.trim();

export function parseJsonOutput(stdout: string): unknown {
  const text = stdout.trim();
  if (!text) return null;
  // Prefer last JSON object/array in case of warnings
  const startObj = text.indexOf("{");
  const startArr = text.indexOf("[");
  let start = -1;
  if (startObj < 0) start = startArr;
  else if (startArr < 0) start = startObj;
  else start = Math.min(startObj, startArr);
  if (start < 0) throw new Error(`PowerShell returned non-JSON: ${text.slice(0, 200)}`);
  const slice = text.slice(start);
  return JSON.parse(slice);
}
