#Requires -Version 5.1
<#
.SYNOPSIS
  Sam-Harness unified Tools manager (Windows).

.PARAMETER Action
  Non-interactive action id (see Tools/lib/actions.manifest).

.PARAMETER Lang
  Ignored (English-only console; kept for backward compatibility).

.PARAMETER NonInteractive
  Skip prompts (for CI / automation).

.PARAMETER CloneUrl
  Git clone URL when installing on a fresh machine without a checkout.

.PARAMETER BackupPath
  Zip path for backup/restore.

.EXAMPLE
  .\Sam-Harness-Manager.ps1
  .\Sam-Harness-Manager.ps1 -Action update -NonInteractive
#>
[CmdletBinding()]
param(
  [string]$Action = "",
  [ValidateSet("ar", "en")]
  [string]$Lang = "",
  [switch]$NonInteractive,
  [string]$CloneUrl = "https://github.com/HFakhry81/Sam-Harness",
  [string]$BackupPath = "",
  [string]$RestorePath = ""
)

$ErrorActionPreference = "Stop"
$ToolsDir = $PSScriptRoot
$Common = Join-Path $ToolsDir "lib\SamHarness.Common.ps1"
. $Common

Initialize-SamConsole
# -Lang / SAM_TOOLS_LANG ignored (English-only console)
if ($Lang) { Set-SamLang $Lang }

$ProjectRoot = Resolve-Path (Join-Path $ToolsDir "..") | Select-Object -ExpandProperty Path
Set-Location $ProjectRoot

function Show-SamMenu {
  Write-SamBanner -Subtitle "Main menu"
  Write-Host ("  Project: $ProjectRoot") -ForegroundColor DarkGray
  Write-Host ""
  $items = @(
    @{ N = "1";  Id = "install";        En = "Install on a new machine" },
    @{ N = "2";  Id = "setup-prereqs";   En = "Setup prerequisites" },
    @{ N = "3";  Id = "install-deps";    En = "Install dependencies (pnpm)" },
    @{ N = "4";  Id = "update";         En = "Update (git + install + migrate + doctor)" },
    @{ N = "5";  Id = "build-check";    En = "Build/check (typecheck + tests + doctor)" },
    @{ N = "6";  Id = "start-ui";       En = "Start Control Plane UI" },
    @{ N = "7";  Id = "pull-models";    En = "Pull Ollama models (from team.json)" },
    @{ N = "8";  Id = "doctor";         En = "Doctor - health check" },
    @{ N = "9";  Id = "help";           En = "Help (pnpm help)" },
    @{ N = "10"; Id = "backup";         En = "Backup (DB + config + .env)" },
    @{ N = "11"; Id = "restore";        En = "Restore from backup" },
    @{ N = "12"; Id = "repair";         En = "Repair (deps + migrate + doctor)" },
    @{ N = "13"; Id = "uninstall";      En = "Uninstall" },
    @{ N = "14"; Id = "view-logs";      En = "View logs" },
    @{ N = "15"; Id = "cleanup-logs";   En = "Cleanup logs" },
    @{ N = "16"; Id = "health";         En = "Live health (doctor + /healthz)" },
    @{ N = "0";  Id = "exit";           En = "Exit" }
  )
  foreach ($it in $items) {
    Write-Host ("   [{0,2}]  {1}" -f $it.N, $it.En)
  }
  Write-Host ""
  return $items
}

function Resolve-SamMenuChoice {
  param([string]$Choice, $Items)
  $c = $Choice.Trim()
  if ($c -eq "") { return "" }
  foreach ($it in $Items) {
    if ($c -eq $it.N -or $c -eq $it.Id) { return $it.Id }
  }
  # also accept action names
  $manifest = Get-SamManifestActions
  if ($manifest -contains $c) { return $c }
  return ""
}

function Invoke-SamAction {
  param([string]$Id)
  if (-not $Id -or $Id -eq "exit") { return 0 }

  Initialize-SamLogging -ProjectRoot $ProjectRoot -ActionName $Id | Out-Null
  Write-SamBanner -Subtitle $Id
  Write-SamInfo "cwd=$ProjectRoot"
  $code = 0

  try {
    $raw = $null
    switch ($Id) {
      "install"        { $raw = Invoke-ActionInstall }
      "setup-prereqs"  { $raw = Invoke-ActionSetupPrereqs }
      "install-deps"   { $raw = Invoke-ActionInstallDeps }
      "update"         { $raw = Invoke-ActionUpdate }
      "build-check"    { $raw = Invoke-ActionBuildCheck }
      "start-ui"       { $raw = Invoke-ActionStartUi }
      "pull-models"    { $raw = Invoke-ActionPullModels }
      "doctor"         { $raw = Invoke-ActionDoctor }
      "help"           { $raw = Invoke-ActionHelp }
      "backup"         { $raw = Invoke-ActionBackup }
      "restore"        { $raw = Invoke-ActionRestore }
      "repair"         { $raw = Invoke-ActionRepair }
      "uninstall"      { $raw = Invoke-ActionUninstall }
      "view-logs"      { $raw = Invoke-ActionViewLogs }
      "cleanup-logs"   { $raw = Invoke-ActionCleanupLogs }
      "health"         { $raw = Invoke-ActionHealth }
      default {
        Write-SamFail ("Unknown action: $Id")
        $raw = 2
      }
    }
    # Belt-and-suspenders: never let Object[] reach Write-SamSummary -ExitCode
    $code = ConvertTo-SamExitCode $raw
  } catch {
    Write-SamFail $_.Exception.Message
    $code = 1
  }

  if ($code -ne 0 -and $script:SamHarnessFail -eq 0) {
    Write-SamFail (("Finished with failure (exit {0})" -f $code))
  }
  Write-SamSummary -ExitCode $code
  return $code
}

function Invoke-ActionInstall {
  Write-SamStep ("Fresh-machine install (delegate to scripts/install)")
  $pkg = Join-Path $ProjectRoot "package.json"
  $isRepo = $false
  if (Test-Path -LiteralPath $pkg) {
    $raw = Get-Content -LiteralPath $pkg -Raw -Encoding UTF8
    if ($raw -match '"name"\s*:\s*"Sam-Harness"') { $isRepo = $true }
  }

  if (-not $isRepo) {
    Write-SamWarn ("Current folder is not Sam-Harness - attempting clone")
    if (-not (Test-SamCommand "git")) {
      Write-SamFail "git missing"
      return 1
    }
    $parent = Split-Path -Parent $ProjectRoot
    $target = Join-Path $parent "Sam-Harness"
    if (-not (Test-Path -LiteralPath $target)) {
      Write-SamInfo "git clone $CloneUrl -> $target"
      $cloneEc = Invoke-SamNative -FilePath "git" -ArgumentList @("clone", $CloneUrl, $target)
      if ($cloneEc -ne 0) { Write-SamFail "git clone failed"; return $cloneEc }
    }
    $script:ProjectRoot = $target
    $ProjectRoot = $target
    Set-Location $ProjectRoot
  }

  $installer = Join-Path $ProjectRoot "scripts\install\install.ps1"
  if (-not (Test-Path -LiteralPath $installer)) {
    Write-SamFail "scripts/install/install.ps1 missing"
    return 1
  }
  $installerArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $installer)
  if ($NonInteractive) { $installerArgs += "-NonInteractive" }
  Write-SamInfo "-> $installer"
  $ps51 = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  if (-not (Test-Path -LiteralPath $ps51)) { $ps51 = "powershell" }
  $ec = Invoke-SamNative -FilePath $ps51 -ArgumentList $installerArgs
  if ($ec -eq 0) { Write-SamOk ("Install finished") }
  else { Write-SamFail "install.ps1 exit $ec" }
  return $ec
}

function Invoke-ActionSetupPrereqs {
  Write-SamStep ("Check Git / Node / pnpm / Ollama")

  if (-not (Test-SamCommand "git")) {
    Write-SamWarn "Git missing - trying winget"
    if (Test-SamCommand "winget") {
      [void](Invoke-SamNative -FilePath "winget" -ArgumentList @("install", "-e", "--id", "Git.Git", "--accept-package-agreements", "--accept-source-agreements"))
      $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                  [System.Environment]::GetEnvironmentVariable("Path", "User")
    }
  }
  if (Test-SamCommand "git") {
    $gv = Invoke-SamNativeCapture -FilePath "git" -ArgumentList @("--version")
    Write-SamOk $gv.Text
  } else { Write-SamFail "Git not in PATH" }

  if (-not (Test-SamCommand "node")) {
    Write-SamWarn "Node missing - trying winget OpenJS.NodeJS.LTS"
    if (Test-SamCommand "winget") {
      [void](Invoke-SamNative -FilePath "winget" -ArgumentList @("install", "-e", "--id", "OpenJS.NodeJS.LTS", "--accept-package-agreements", "--accept-source-agreements"))
      $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                  [System.Environment]::GetEnvironmentVariable("Path", "User")
    }
  }
  if (Test-SamCommand "node") {
    $nv = Invoke-SamNativeCapture -FilePath "node" -ArgumentList @("-v")
    Write-SamOk ("Node " + $nv.Text.Trim())
  } else { Write-SamFail "Node >= 20 required"; return 1 }

  $pnpmVer = Get-SamPinnedPnpm -ProjectRoot $ProjectRoot
  Write-SamStep "Corepack / pnpm@$pnpmVer"
  if (Test-SamCommand "corepack") {
    [void](Invoke-SamNative -FilePath "corepack" -ArgumentList @("enable") -Quiet)
    $prep = Invoke-SamNative -FilePath "corepack" -ArgumentList @("prepare", "pnpm@$pnpmVer", "--activate")
    if ($prep -ne 0) {
      Write-SamWarn "corepack prepare failed - npm i -g pnpm"
      [void](Invoke-SamNative -FilePath "npm" -ArgumentList @("install", "-g", "pnpm"))
    }
  }
  if (Test-SamCommand "pnpm") {
    $pv = Invoke-SamNativeCapture -FilePath "pnpm" -ArgumentList @("-v")
    Write-SamOk ("pnpm " + $pv.Text.Trim())
  } else { Write-SamFail "pnpm missing"; return 1 }

  if (Test-SamCommand "ollama") {
    Write-SamOk "Ollama CLI found"
  } else {
    Write-SamWarn ("Ollama not found - https://ollama.com/download or winget install Ollama.Ollama")
  }

  Write-SamStep ".env + SAM_OUTPUT_HOME"
  Ensure-SamEnvFile -ProjectRoot $ProjectRoot
  Ensure-SamOutputHomeDirs -ProjectRoot $ProjectRoot | Out-Null

  $task = Join-Path $ProjectRoot "task.ts"
  $seed = Join-Path $ProjectRoot "templates\task.seed.ts"
  if (-not (Test-Path -LiteralPath $task) -and (Test-Path -LiteralPath $seed)) {
    Copy-Item $seed $task
    Write-SamOk "Seeded task.ts"
  }

  if ($script:SamHarnessFail -gt 0) { return 1 }
  return 0
}

function Invoke-ActionInstallDeps {
  Write-SamStep "pnpm install"
  if (-not (Test-SamCommand "pnpm")) {
    Write-SamFail ("pnpm missing - run setup-prereqs first")
    return 1
  }
  $ec = Invoke-SamNative -FilePath "pnpm" -ArgumentList @("install")
  if ($ec -eq 0) { Write-SamOk "Dependencies installed" } else { Write-SamFail "pnpm install failed" }
  return $ec
}

function Invoke-ActionUpdate {
  Write-SamStep ("Safe update of current branch")
  if (-not (Test-SamCommand "git")) { Write-SamFail "git missing"; return 1 }

  $dirtyCap = Invoke-SamNativeCapture -FilePath "git" -ArgumentList @("status", "--porcelain")
  $dirty = @($dirtyCap.Lines | Where-Object { $_.Trim() -ne "" })
  if ($dirty.Count -gt 0) {
    Write-SamFail ("Dirty working tree - refusing update. Commit or stash first.")
    Write-SamInfo ($dirty -join "`n")
    return 1
  }
  Write-SamOk ("Working tree clean")

  $branchCap = Invoke-SamNativeCapture -FilePath "git" -ArgumentList @("rev-parse", "--abbrev-ref", "HEAD")
  $branch = ($branchCap.Text).Trim()
  Write-SamInfo "branch=$branch"
  if ($branch -eq "HEAD") {
    Write-SamFail ("detached HEAD - refusing pull")
    return 1
  }

  Write-SamStep "git pull --ff-only origin $branch"
  $pullEc = Invoke-SamNative -FilePath "git" -ArgumentList @("pull", "--ff-only", "origin", $branch)
  if ($pullEc -ne 0) {
    Write-SamWarn "ff-only failed - trying git pull --ff-only"
    $pullEc = Invoke-SamNative -FilePath "git" -ArgumentList @("pull", "--ff-only")
    if ($pullEc -ne 0) {
      Write-SamFail "git pull failed"
      return $pullEc
    }
  }
  Write-SamOk "git pull OK"

  $ec = ConvertTo-SamExitCode (Invoke-ActionInstallDeps)
  if ($ec -ne 0) { return $ec }

  Write-SamStep "pnpm run migrate"
  $mig = Invoke-SamNative -FilePath "pnpm" -ArgumentList @("run", "migrate")
  if ($mig -ne 0) { Write-SamFail "migrate failed"; return $mig }
  Write-SamOk "migrate OK"

  return (ConvertTo-SamExitCode (Invoke-ActionDoctor))
}

function Invoke-ActionBuildCheck {
  if (-not (Test-SamCommand "pnpm")) { Write-SamFail "pnpm missing"; return 1 }
  Write-SamStep "pnpm run typecheck"
  $tc = Invoke-SamNative -FilePath "pnpm" -ArgumentList @("run", "typecheck")
  if ($tc -ne 0) { Write-SamFail "typecheck failed"; return $tc }
  Write-SamOk "typecheck"

  Write-SamStep "pnpm test"
  $ts = Invoke-SamNative -FilePath "pnpm" -ArgumentList @("test")
  if ($ts -ne 0) { Write-SamFail "tests failed"; return $ts }
  Write-SamOk "tests"

  return (ConvertTo-SamExitCode (Invoke-ActionDoctor))
}

function Invoke-ActionStartUi {
  Write-SamStep ("Start Control Plane")
  if (-not (Test-Path (Join-Path $ProjectRoot "node_modules"))) {
    $ec = ConvertTo-SamExitCode (Invoke-ActionInstallDeps)
    if ($ec -ne 0) { return $ec }
  }
  Ensure-SamEnvFile -ProjectRoot $ProjectRoot
  $task = Join-Path $ProjectRoot "task.ts"
  $seed = Join-Path $ProjectRoot "templates\task.seed.ts"
  if (-not (Test-Path -LiteralPath $task) -and (Test-Path -LiteralPath $seed)) {
    Copy-Item $seed $task
  }
  if (-not $env:CONTROL_PLANE_PORT) { $env:CONTROL_PLANE_PORT = "8787" }
  Write-SamInfo "http://127.0.0.1:$($env:CONTROL_PLANE_PORT)/"
  return (Invoke-SamNative -FilePath "pnpm" -ArgumentList @("run", "ui"))
}

function Invoke-ActionPullModels {
  Write-SamStep ("Pull local models from config/team.json")
  if (-not (Test-SamCommand "ollama")) {
    Write-SamFail ("ollama not in PATH")
    return 1
  }
  $models = Get-SamTeamLocalModels -ProjectRoot $ProjectRoot
  Write-SamInfo ("models: " + ($models -join ", "))
  $failed = 0
  foreach ($m in $models) {
    Write-SamInfo "ollama pull $m"
    $pec = Invoke-SamNative -FilePath "ollama" -ArgumentList @("pull", $m)
    if ($pec -ne 0) {
      Write-SamWarn "pull failed: $m"
      $failed++
    } else {
      Write-SamOk $m
    }
  }
  if ($failed -gt 0) { return 1 }
  return 0
}

function Invoke-ActionDoctor {
  Write-SamStep "pnpm run doctor"
  if (-not (Test-SamCommand "pnpm")) { Write-SamFail "pnpm missing"; return 1 }
  $ec = Invoke-SamNative -FilePath "pnpm" -ArgumentList @("run", "doctor")
  if ($ec -eq 0) { Write-SamOk "doctor PASS" } else { Write-SamFail "doctor reported issues" }
  return $ec
}

function Invoke-ActionHelp {
  Write-SamStep "pnpm run help"
  if (-not (Test-SamCommand "pnpm")) { Write-SamFail "pnpm missing"; return 1 }
  $ec = Invoke-SamNative -FilePath "pnpm" -ArgumentList @("run", "help")
  Write-SamInfo ("Tools manager: Tools\Sam-Harness-Manager.cmd")
  if ($ec -eq 0) {
    Write-SamOk ("Help displayed")
  } else {
    Write-SamFail "help exit $ec"
  }
  return $ec
}

function Invoke-ActionBackup {
  Write-SamStep ("Backup DB + config + .env")
  $outputHome = Ensure-SamOutputHomeDirs -ProjectRoot $ProjectRoot
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $dest = $BackupPath
  if (-not $dest) {
    $dest = Join-Path $outputHome "exports\sam-harness-backup-$stamp.zip"
  }
  $destDir = Split-Path -Parent $dest
  if (-not (Test-Path -LiteralPath $destDir)) {
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
  }

  $stage = Join-Path $env:TEMP ("sam-harness-backup-" + [guid]::NewGuid().ToString("n"))
  New-Item -ItemType Directory -Path $stage -Force | Out-Null
  try {
    $cfg = Join-Path $stage "config"
    New-Item -ItemType Directory -Path $cfg -Force | Out-Null
    $envSrc = Join-Path $ProjectRoot ".env"
    if (Test-Path -LiteralPath $envSrc) {
      Copy-Item $envSrc (Join-Path $stage ".env")
    }
    $team = Join-Path $ProjectRoot "config\team.json"
    if (Test-Path -LiteralPath $team) { Copy-Item $team (Join-Path $cfg "team.json") }
    $hybrid = Join-Path $ProjectRoot "config\hybrid-profile.json"
    if (Test-Path -LiteralPath $hybrid) { Copy-Item $hybrid (Join-Path $cfg "hybrid-profile.json") }
    # copy any json under config/
    Get-ChildItem (Join-Path $ProjectRoot "config") -Filter "*.json" -ErrorAction SilentlyContinue |
      ForEach-Object { Copy-Item $_.FullName (Join-Path $cfg $_.Name) -Force }

    $stateDir = Join-Path $outputHome "state"
    if (Test-Path -LiteralPath $stateDir) {
      $dbStage = Join-Path $stage "state"
      New-Item -ItemType Directory -Path $dbStage -Force | Out-Null
      Get-ChildItem $stateDir -Recurse -Include "*.sqlite","*.sqlite-wal","*.sqlite-shm","*.json" -ErrorAction SilentlyContinue |
        ForEach-Object {
          $rel = $_.FullName.Substring($stateDir.Length).TrimStart("\", "/")
          $target = Join-Path $dbStage $rel
          $td = Split-Path -Parent $target
          if (-not (Test-Path $td)) { New-Item -ItemType Directory -Path $td -Force | Out-Null }
          Copy-Item $_.FullName $target -Force
        }
    }

    if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Force }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $dest)
    Write-SamOk "Backup -> $dest"
    return 0
  } catch {
    Write-SamFail $_.Exception.Message
    return 1
  } finally {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-ActionRestore {
  Write-SamStep ("Restore from zip archive")
  $zip = $RestorePath
  if (-not $zip) { $zip = $BackupPath }
  if (-not $zip -and -not $NonInteractive) {
    $zip = Read-Host ("  Backup zip path")
  }
  if (-not $zip -or -not (Test-Path -LiteralPath $zip)) {
    Write-SamFail ("Backup zip missing")
    return 1
  }
  $outputHome = Ensure-SamOutputHomeDirs -ProjectRoot $ProjectRoot
  $stage = Join-Path $env:TEMP ("sam-harness-restore-" + [guid]::NewGuid().ToString("n"))
  New-Item -ItemType Directory -Path $stage -Force | Out-Null
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $stage)
    $envSrc = Join-Path $stage ".env"
    if (Test-Path -LiteralPath $envSrc) {
      Copy-Item $envSrc (Join-Path $ProjectRoot ".env") -Force
      Write-SamOk "Restored .env"
    }
    $cfgSrc = Join-Path $stage "config"
    if (Test-Path -LiteralPath $cfgSrc) {
      $cfgDst = Join-Path $ProjectRoot "config"
      if (-not (Test-Path $cfgDst)) { New-Item -ItemType Directory -Path $cfgDst -Force | Out-Null }
      Get-ChildItem $cfgSrc -Filter "*.json" | ForEach-Object {
        Copy-Item $_.FullName (Join-Path $cfgDst $_.Name) -Force
        Write-SamOk ("Restored config/" + $_.Name)
      }
    }
    $stateSrc = Join-Path $stage "state"
    if (Test-Path -LiteralPath $stateSrc) {
      $stateDst = Join-Path $outputHome "state"
      if (-not (Test-Path $stateDst)) { New-Item -ItemType Directory -Path $stateDst -Force | Out-Null }
      Copy-Item (Join-Path $stateSrc "*") $stateDst -Recurse -Force
      Write-SamOk "Restored state/ DB files"
    }
    Write-SamStep "pnpm run migrate"
    if (Test-SamCommand "pnpm") {
      [void](Invoke-SamNative -FilePath "pnpm" -ArgumentList @("run", "migrate"))
    }
    Write-SamOk ("Restore complete")
    return 0
  } catch {
    Write-SamFail $_.Exception.Message
    return 1
  } finally {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-ActionRepair {
  Write-SamStep ("Repair installation")
  $ec = ConvertTo-SamExitCode (Invoke-ActionSetupPrereqs)
  if ($ec -ne 0) { return $ec }
  $ec = ConvertTo-SamExitCode (Invoke-ActionInstallDeps)
  if ($ec -ne 0) { return $ec }
  Write-SamStep "pnpm run migrate"
  $mig = Invoke-SamNative -FilePath "pnpm" -ArgumentList @("run", "migrate")
  if ($mig -ne 0) { Write-SamFail "migrate failed"; return $mig }
  Write-SamOk "migrate"
  return (ConvertTo-SamExitCode (Invoke-ActionDoctor))
}

function Invoke-ActionUninstall {
  Write-SamStep ("Uninstall via scripts/install/uninstall.ps1")
  $u = Join-Path $ProjectRoot "scripts\install\uninstall.ps1"
  if (-not (Test-Path -LiteralPath $u)) { Write-SamFail "uninstall.ps1 missing"; return 1 }
  $psArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $u)
  if ($NonInteractive) { $psArgs += "-NonInteractive" }
  $ps51 = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  if (-not (Test-Path -LiteralPath $ps51)) { $ps51 = "powershell" }
  $ec = Invoke-SamNative -FilePath $ps51 -ArgumentList $psArgs
  if ($ec -eq 0) { Write-SamOk "uninstall finished" } else { Write-SamFail "uninstall exit $ec" }
  return $ec
}

function Invoke-ActionViewLogs {
  Write-SamStep ("View recent logs")
  $dirs = @()
  $outputHome = Get-SamOutputHome -ProjectRoot $ProjectRoot
  $dirs += (Join-Path $outputHome "logs")
  $dirs += (Join-Path $ProjectRoot "Tools\logs")
  $found = @()
  foreach ($d in $dirs) {
    if (Test-Path -LiteralPath $d) {
      $found += Get-ChildItem -LiteralPath $d -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending
    }
  }
  if ($found.Count -eq 0) {
    Write-SamWarn ("No log files found")
    Write-SamOk ("view-logs complete (empty)")
    return 0
  }
  $top = $found | Select-Object -First 8
  foreach ($f in $top) {
    Write-Host ("  - {0}  ({1:u})" -f $f.FullName, $f.LastWriteTime) -ForegroundColor Gray
  }
  $latest = $top | Select-Object -First 1
  Write-Host ""
  Write-Host "  ---- tail: $($latest.FullName) ----" -ForegroundColor DarkCyan
  Get-Content -LiteralPath $latest.FullName -Tail 40 -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "  $_"
  }
  Write-SamOk ("latest=" + $latest.Name)
  return 0
}

function Invoke-ActionCleanupLogs {
  Write-SamStep ("Cleanup logs older than 14 days")
  $cutoff = (Get-Date).AddDays(-14)
  $dirs = @()
  $outputHome = Get-SamOutputHome -ProjectRoot $ProjectRoot
  $dirs += (Join-Path $outputHome "logs")
  $dirs += (Join-Path $ProjectRoot "Tools\logs")
  $removed = 0
  foreach ($d in $dirs) {
    if (-not (Test-Path -LiteralPath $d)) { continue }
    Get-ChildItem -LiteralPath $d -File -ErrorAction SilentlyContinue | Where-Object {
      $_.LastWriteTime -lt $cutoff
    } | ForEach-Object {
      Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
      $removed++
    }
  }
  Write-SamOk ("removed=$removed")
  return 0
}

function Invoke-ActionHealth {
  Write-SamStep ("Live health")
  # Doctor result is authoritative; /healthz unreachable is WARN only (UI may be stopped).
  $ec = ConvertTo-SamExitCode (Invoke-ActionDoctor)
  $port = if ($env:CONTROL_PLANE_PORT) { $env:CONTROL_PLANE_PORT } else { "8787" }
  $url = "http://127.0.0.1:$port/healthz"
  Write-SamInfo "GET $url"
  $prevEa = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue
    if ($resp -and $resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300) {
      Write-SamOk "/healthz OK ($($resp.StatusCode))"
    } else {
      Write-SamWarn ("Control Plane not reachable at $url (start-ui)")
    }
  } catch {
    Write-SamWarn ("Control Plane not reachable at $url (start-ui)")
  } finally {
    $ErrorActionPreference = $prevEa
  }
  return $ec
}

# -- entry --
$exitCode = 0
if ($Action) {
  $exitCode = ConvertTo-SamExitCode (Invoke-SamAction -Id $Action.Trim().ToLowerInvariant())
  exit $exitCode
}

while ($true) {
  $items = Show-SamMenu
  $prompt = "  Choose a number"
  $choice = Read-Host $prompt
  $id = Resolve-SamMenuChoice -Choice $choice -Items $items
  if (-not $id) {
    Write-Host ("  Invalid choice") -ForegroundColor Yellow
    continue
  }
  if ($id -eq "exit") {
    Write-Host ("  Goodbye.") -ForegroundColor Green
    exit 0
  }
  $exitCode = ConvertTo-SamExitCode (Invoke-SamAction -Id $id)
  if (-not $NonInteractive) {
    Write-Host ""
    Read-Host ("  Press Enter to return to menu") | Out-Null
  }
}
