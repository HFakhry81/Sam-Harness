#Requires -Version 5.1
<#
.SYNOPSIS
  Shared helpers for Sam-Harness Tools (Windows PowerShell 5.1 + pwsh 7).
#>

$script:SamHarnessLang = if ($env:SAM_TOOLS_LANG) { $env:SAM_TOOLS_LANG } else { "ar" }
$script:SamHarnessLogFile = $null
$script:SamHarnessStartTime = Get-Date
$script:SamHarnessStep = 0
$script:SamHarnessOk = 0
$script:SamHarnessWarn = 0
$script:SamHarnessFail = 0

function Get-SamProjectRoot {
  $toolsDir = Split-Path -Parent $PSScriptRoot
  if (-not $toolsDir) { $toolsDir = $PSScriptRoot }
  # Tools/lib -> Tools -> repo root
  $root = Resolve-Path (Join-Path $PSScriptRoot "..\..") -ErrorAction SilentlyContinue
  if (-not $root) {
    $root = Resolve-Path (Join-Path (Split-Path -Parent $PSScriptRoot) "..")
  }
  return [string]$root
}

function Get-SamOutputHome {
  param([string]$ProjectRoot)
  if ($env:SAM_OUTPUT_HOME -and $env:SAM_OUTPUT_HOME.Trim()) {
    return $env:SAM_OUTPUT_HOME.Trim()
  }
  $envFile = Join-Path $ProjectRoot ".env"
  if (Test-Path -LiteralPath $envFile) {
    $line = Get-Content -LiteralPath $envFile -ErrorAction SilentlyContinue |
      Where-Object { $_ -match '^\s*SAM_OUTPUT_HOME\s*=\s*(.+)\s*$' } |
      Select-Object -First 1
    if ($line -match '^\s*SAM_OUTPUT_HOME\s*=\s*(.+)\s*$') {
      $v = $Matches[1].Trim().Trim('"').Trim("'")
      if ($v) { return $v }
    }
  }
  return (Join-Path $env:USERPROFILE "Documents\Sam-Harness")
}

function Get-SamLogsDir {
  param([string]$ProjectRoot)
  $outputHome = Get-SamOutputHome -ProjectRoot $ProjectRoot
  $dir = Join-Path $outputHome "logs"
  if (-not (Test-Path -LiteralPath $dir)) {
    $fallback = Join-Path $ProjectRoot "Tools\logs"
    if (-not (Test-Path -LiteralPath $fallback)) {
      New-Item -ItemType Directory -Path $fallback -Force | Out-Null
    }
    return $fallback
  }
  return $dir
}

function Initialize-SamConsole {
  try {
    # UTF-8 console for Arabic
    cmd /c "chcp 65001 >nul" | Out-Null
  } catch { }
  try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
  } catch { }
}

function Initialize-SamLogging {
  param([string]$ProjectRoot, [string]$ActionName)
  $logs = Get-SamLogsDir -ProjectRoot $ProjectRoot
  if (-not (Test-Path -LiteralPath $logs)) {
    New-Item -ItemType Directory -Path $logs -Force | Out-Null
  }
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $safe = ($ActionName -replace '[^a-zA-Z0-9_-]', '_')
  $script:SamHarnessLogFile = Join-Path $logs "manager-$safe-$stamp.log"
  $script:SamHarnessStartTime = Get-Date
  $script:SamHarnessStep = 0
  $script:SamHarnessOk = 0
  $script:SamHarnessWarn = 0
  $script:SamHarnessFail = 0
  "Sam-Harness Manager log · $ActionName · $(Get-Date -Format o)" |
    Set-Content -LiteralPath $script:SamHarnessLogFile -Encoding UTF8
  return $script:SamHarnessLogFile
}

function Write-SamLog([string]$line) {
  if ($script:SamHarnessLogFile) {
    Add-Content -LiteralPath $script:SamHarnessLogFile -Value $line -Encoding UTF8
  }
}

function T {
  param([string]$Ar, [string]$En)
  if ($script:SamHarnessLang -eq "en") { return $En }
  return $Ar
}

function Set-SamLang([string]$Lang) {
  if ($Lang -eq "en" -or $Lang -eq "ar") {
    $script:SamHarnessLang = $Lang
    $env:SAM_TOOLS_LANG = $Lang
  }
}

function Write-SamBanner {
  param([string]$Subtitle = "")
  $title = T -Ar "مدير Sam-Harness" -En "Sam-Harness Manager"
  Write-Host ""
  Write-Host "  ================================================================" -ForegroundColor DarkCyan
  Write-Host ("   " + $title) -ForegroundColor White
  Write-Host "   Arabic-first · Control Plane · Hybrid Agency · Phases 0-9" -ForegroundColor Gray
  if ($Subtitle) {
    Write-Host ("   " + $Subtitle) -ForegroundColor Cyan
  }
  Write-Host "  ================================================================" -ForegroundColor DarkCyan
  Write-Host ""
}

function Write-SamInfo([string]$Msg) {
  Write-Host "  [INFO] $Msg" -ForegroundColor Cyan
  Write-SamLog "[INFO] $Msg"
}

function Write-SamOk([string]$Msg) {
  $script:SamHarnessOk++
  Write-Host "  [OK]   $Msg" -ForegroundColor Green
  Write-SamLog "[OK] $Msg"
}

function Write-SamWarn([string]$Msg) {
  $script:SamHarnessWarn++
  Write-Host "  [WARN] $Msg" -ForegroundColor Yellow
  Write-SamLog "[WARN] $Msg"
}

function Write-SamFail([string]$Msg) {
  $script:SamHarnessFail++
  Write-Host "  [FAIL] $Msg" -ForegroundColor Red
  Write-SamLog "[FAIL] $Msg"
}

function Write-SamStep {
  param([string]$Msg)
  $script:SamHarnessStep++
  $n = $script:SamHarnessStep
  Write-Host ""
  Write-Host "  [$n] $Msg" -ForegroundColor Cyan
  Write-SamLog "[STEP $n] $Msg"
}

function Write-SamSummary {
  param([int]$ExitCode = 0)
  $elapsed = (Get-Date) - $script:SamHarnessStartTime
  $secs = [math]::Round($elapsed.TotalSeconds, 1)
  Write-Host ""
  Write-Host "  ----------------------------------------------------------------" -ForegroundColor DarkGray
  $summary = T -Ar "الملخص" -En "Summary"
  Write-Host ("  {0}: OK={1}  WARN={2}  FAIL={3}  time={4}s  exit={5}" -f `
      $summary, $script:SamHarnessOk, $script:SamHarnessWarn, $script:SamHarnessFail, $secs, $ExitCode)
  if ($script:SamHarnessLogFile) {
    Write-Host ("  log: " + $script:SamHarnessLogFile) -ForegroundColor DarkGray
  }
  Write-Host "  ----------------------------------------------------------------" -ForegroundColor DarkGray
  Write-Host ""
  Write-SamLog "SUMMARY ok=$($script:SamHarnessOk) warn=$($script:SamHarnessWarn) fail=$($script:SamHarnessFail) exit=$ExitCode secs=$secs"
}

function Get-SamPinnedPnpm {
  param([string]$ProjectRoot)
  $pkg = Join-Path $ProjectRoot "package.json"
  if (Test-Path -LiteralPath $pkg) {
    try {
      $raw = Get-Content -LiteralPath $pkg -Raw -Encoding UTF8
      if ($raw -match '"packageManager"\s*:\s*"pnpm@([^"]+)"') {
        return $Matches[1]
      }
    } catch { }
  }
  return "11.23.0"
}

function Get-SamTeamLocalModels {
  param([string]$ProjectRoot)
  $path = Join-Path $ProjectRoot "config\team.json"
  $models = New-Object System.Collections.Generic.List[string]
  if (-not (Test-Path -LiteralPath $path)) {
    return @("qwen2.5-coder:1.5b", "gemma3:1b", "qwen2.5:1.5b")
  }
  try {
    $json = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($role in $json.roles) {
      $local = $null
      if ($role.models -and $role.models.local) { $local = [string]$role.models.local }
      if ($local -and $local.Trim() -and -not $models.Contains($local.Trim())) {
        [void]$models.Add($local.Trim())
      }
    }
  } catch {
    return @("qwen2.5-coder:1.5b", "gemma3:1b", "qwen2.5:1.5b")
  }
  if ($models.Count -eq 0) {
    return @("qwen2.5-coder:1.5b", "gemma3:1b", "qwen2.5:1.5b")
  }
  return $models.ToArray()
}

function Invoke-SamNative {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [string]$WorkingDirectory = ""
  )
  if ($WorkingDirectory) {
    Push-Location $WorkingDirectory
  }
  try {
    & $FilePath @ArgumentList
    return [int]$LASTEXITCODE
  } finally {
    if ($WorkingDirectory) { Pop-Location }
  }
}

function Test-SamCommand([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Ensure-SamEnvFile {
  param([string]$ProjectRoot)
  $envPath = Join-Path $ProjectRoot ".env"
  $example = Join-Path $ProjectRoot ".env.example"
  if (-not (Test-Path -LiteralPath $envPath)) {
    if (Test-Path -LiteralPath $example) {
      Copy-Item -LiteralPath $example -Destination $envPath
      Write-SamOk (T -Ar "تم إنشاء .env من .env.example" -En "Created .env from .env.example")
    } else {
      Write-SamWarn ".env.example missing"
    }
  } else {
    Write-SamOk (T -Ar ".env موجود" -En ".env already present")
  }
}

function Ensure-SamOutputHomeDirs {
  param([string]$ProjectRoot)
  $outputHome = Get-SamOutputHome -ProjectRoot $ProjectRoot
  $subs = @("reports", "documents", "exports", "runs", "memory", "temp", "state", "logs")
  if (-not (Test-Path -LiteralPath $outputHome)) {
    New-Item -ItemType Directory -Path $outputHome -Force | Out-Null
  }
  foreach ($s in $subs) {
    $p = Join-Path $outputHome $s
    if (-not (Test-Path -LiteralPath $p)) {
      New-Item -ItemType Directory -Path $p -Force | Out-Null
    }
  }
  if (-not $env:SAM_OUTPUT_HOME) { $env:SAM_OUTPUT_HOME = $outputHome }
  Write-SamOk ("SAM_OUTPUT_HOME → $outputHome")
  return $outputHome
}

function Get-SamManifestActions {
  $manifest = Join-Path $PSScriptRoot "actions.manifest"
  $list = @()
  if (Test-Path -LiteralPath $manifest) {
    Get-Content -LiteralPath $manifest -Encoding UTF8 | ForEach-Object {
      $line = $_.Trim()
      if ($line -and -not $line.StartsWith("#")) { $list += $line }
    }
  }
  return $list
}
