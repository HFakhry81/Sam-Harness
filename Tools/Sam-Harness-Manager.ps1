#Requires -Version 5.1
<#
.SYNOPSIS
  Sam-Harness unified Tools manager (Windows).

.PARAMETER Action
  Non-interactive action id (see Tools/lib/actions.manifest).

.PARAMETER Lang
  UI language: ar (default) or en.

.PARAMETER NonInteractive
  Skip prompts (for CI / automation).

.PARAMETER CloneUrl
  Git clone URL when installing on a fresh machine without a checkout.

.PARAMETER BackupPath
  Zip path for backup/restore.

.EXAMPLE
  .\Sam-Harness-Manager.ps1
  .\Sam-Harness-Manager.ps1 -Action update -Lang en -NonInteractive
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
if ($Lang) { Set-SamLang $Lang }
elseif ($env:SAM_TOOLS_LANG) { Set-SamLang $env:SAM_TOOLS_LANG }
else { Set-SamLang "ar" }

$ProjectRoot = Resolve-Path (Join-Path $ToolsDir "..") | Select-Object -ExpandProperty Path
Set-Location $ProjectRoot

function Show-SamMenu {
  Write-SamBanner -Subtitle (T -Ar "القائمة الرئيسية" -En "Main menu")
  Write-Host ("  Project: $ProjectRoot") -ForegroundColor DarkGray
  Write-Host ("  Lang: $($script:SamHarnessLang)  |  " + (T -Ar "اضغط L لتبديل اللغة" -En "Press L to toggle language")) -ForegroundColor DarkGray
  Write-Host ""
  $items = @(
    @{ N = "1";  Id = "install";        Ar = "تثبيت على جهاز جديد";           En = "Install on a new machine" },
    @{ N = "2";  Id = "setup-prereqs";   Ar = "إعداد المتطلبات";               En = "Setup prerequisites" },
    @{ N = "3";  Id = "install-deps";    Ar = "تثبيت الاعتماديات (pnpm)";      En = "Install dependencies (pnpm)" },
    @{ N = "4";  Id = "update";         Ar = "تحديث (git + install + migrate + doctor)"; En = "Update (git + install + migrate + doctor)" },
    @{ N = "5";  Id = "build-check";    Ar = "بناء/فحص (typecheck + tests + doctor)"; En = "Build/check (typecheck + tests + doctor)" },
    @{ N = "6";  Id = "start-ui";       Ar = "تشغيل واجهة Control Plane";     En = "Start Control Plane UI" },
    @{ N = "7";  Id = "pull-models";    Ar = "سحب نماذج Ollama (من team.json)"; En = "Pull Ollama models (from team.json)" },
    @{ N = "8";  Id = "doctor";         Ar = "Doctor — فحص الصحة";            En = "Doctor — health check" },
    @{ N = "9";  Id = "help";           Ar = "المساعدة (pnpm help)";           En = "Help (pnpm help)" },
    @{ N = "10"; Id = "backup";         Ar = "نسخة احتياطية (DB + config + .env)"; En = "Backup (DB + config + .env)" },
    @{ N = "11"; Id = "restore";        Ar = "استعادة من نسخة";                En = "Restore from backup" },
    @{ N = "12"; Id = "repair";         Ar = "إصلاح (deps + migrate + doctor)"; En = "Repair (deps + migrate + doctor)" },
    @{ N = "13"; Id = "uninstall";      Ar = "إلغاء التثبيت";                  En = "Uninstall" },
    @{ N = "14"; Id = "view-logs";      Ar = "عرض السجلات";                    En = "View logs" },
    @{ N = "15"; Id = "cleanup-logs";   Ar = "تنظيف السجلات";                  En = "Cleanup logs" },
    @{ N = "16"; Id = "health";         Ar = "فحص حي (doctor + /healthz)";     En = "Live health (doctor + /healthz)" },
    @{ N = "0";  Id = "exit";           Ar = "خروج";                           En = "Exit" }
  )
  foreach ($it in $items) {
    $label = if ($script:SamHarnessLang -eq "en") { $it.En } else { $it.Ar }
    Write-Host ("   [{0,2}]  {1}" -f $it.N, $label)
  }
  Write-Host ""
  return $items
}

function Resolve-SamMenuChoice {
  param([string]$Choice, $Items)
  $c = $Choice.Trim()
  if ($c -match '^(l|L|ع)$') { return "__toggle_lang__" }
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
    switch ($Id) {
      "install"        { $code = Invoke-ActionInstall }
      "setup-prereqs"  { $code = Invoke-ActionSetupPrereqs }
      "install-deps"   { $code = Invoke-ActionInstallDeps }
      "update"         { $code = Invoke-ActionUpdate }
      "build-check"    { $code = Invoke-ActionBuildCheck }
      "start-ui"       { $code = Invoke-ActionStartUi }
      "pull-models"    { $code = Invoke-ActionPullModels }
      "doctor"         { $code = Invoke-ActionDoctor }
      "help"           { $code = Invoke-ActionHelp }
      "backup"         { $code = Invoke-ActionBackup }
      "restore"        { $code = Invoke-ActionRestore }
      "repair"         { $code = Invoke-ActionRepair }
      "uninstall"      { $code = Invoke-ActionUninstall }
      "view-logs"      { $code = Invoke-ActionViewLogs }
      "cleanup-logs"   { $code = Invoke-ActionCleanupLogs }
      "health"         { $code = Invoke-ActionHealth }
      default {
        Write-SamFail (T -Ar "إجراء غير معروف: $Id" -En "Unknown action: $Id")
        $code = 2
      }
    }
  } catch {
    Write-SamFail $_.Exception.Message
    $code = 1
  }

  if ($code -ne 0 -and $script:SamHarnessFail -eq 0) {
    Write-SamFail (T -Ar "انتهى بفشل (exit $code)" -En "Finished with failure (exit $code)")
  }
  Write-SamSummary -ExitCode $code
  return $code
}

function Invoke-ActionInstall {
  Write-SamStep (T -Ar "تثبيت على جهاز جديد (تفويض إلى scripts/install)" -En "Fresh-machine install (delegate to scripts/install)")
  $pkg = Join-Path $ProjectRoot "package.json"
  $isRepo = $false
  if (Test-Path -LiteralPath $pkg) {
    $raw = Get-Content -LiteralPath $pkg -Raw -Encoding UTF8
    if ($raw -match '"name"\s*:\s*"Sam-Harness"') { $isRepo = $true }
  }

  if (-not $isRepo) {
    Write-SamWarn (T -Ar "المجلد الحالي ليس Sam-Harness — محاولة الاستنساخ" -En "Current folder is not Sam-Harness — attempting clone")
    if (-not (Test-SamCommand "git")) {
      Write-SamFail "git missing"
      return 1
    }
    $parent = Split-Path -Parent $ProjectRoot
    $target = Join-Path $parent "Sam-Harness"
    if (-not (Test-Path -LiteralPath $target)) {
      Write-SamInfo "git clone $CloneUrl → $target"
      & git clone $CloneUrl $target
      if ($LASTEXITCODE -ne 0) { Write-SamFail "git clone failed"; return $LASTEXITCODE }
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
  $installerArgs = @()
  if ($NonInteractive) { $installerArgs += "-NonInteractive" }
  Write-SamInfo "→ $installer $($installerArgs -join ' ')"
  $ps51 = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  if (-not (Test-Path -LiteralPath $ps51)) { $ps51 = "powershell" }
  & $ps51 -NoProfile -ExecutionPolicy Bypass -File $installer @installerArgs
  $ec = [int]$LASTEXITCODE
  if ($ec -eq 0) { Write-SamOk (T -Ar "التثبيت اكتمل" -En "Install finished") }
  else { Write-SamFail "install.ps1 exit $ec" }
  return $ec
}

function Invoke-ActionSetupPrereqs {
  Write-SamStep (T -Ar "التحقق من Git / Node / pnpm / Ollama" -En "Check Git / Node / pnpm / Ollama")

  if (-not (Test-SamCommand "git")) {
    Write-SamWarn "Git missing — trying winget"
    if (Test-SamCommand "winget") {
      & winget install -e --id Git.Git --accept-package-agreements --accept-source-agreements
      $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                  [System.Environment]::GetEnvironmentVariable("Path", "User")
    }
  }
  if (Test-SamCommand "git") { Write-SamOk (& git --version) } else { Write-SamFail "Git not in PATH" }

  if (-not (Test-SamCommand "node")) {
    Write-SamWarn "Node missing — trying winget OpenJS.NodeJS.LTS"
    if (Test-SamCommand "winget") {
      & winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
      $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                  [System.Environment]::GetEnvironmentVariable("Path", "User")
    }
  }
  if (Test-SamCommand "node") { Write-SamOk ("Node " + (& node -v)) } else { Write-SamFail "Node >= 20 required"; return 1 }

  $pnpmVer = Get-SamPinnedPnpm -ProjectRoot $ProjectRoot
  Write-SamStep "Corepack / pnpm@$pnpmVer"
  try { & corepack enable 2>$null } catch { }
  try { & corepack prepare "pnpm@$pnpmVer" --activate } catch {
    Write-SamWarn "corepack prepare failed — npm i -g pnpm"
    & npm install -g pnpm
  }
  if (Test-SamCommand "pnpm") { Write-SamOk ("pnpm " + (& pnpm -v)) } else { Write-SamFail "pnpm missing"; return 1 }

  if (Test-SamCommand "ollama") {
    Write-SamOk "Ollama CLI found"
  } else {
    Write-SamWarn (T -Ar "Ollama غير موجود — https://ollama.com/download أو winget install Ollama.Ollama" -En "Ollama not found — https://ollama.com/download or winget install Ollama.Ollama")
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
    Write-SamFail (T -Ar "pnpm مفقود — شغّل setup-prereqs أولاً" -En "pnpm missing — run setup-prereqs first")
    return 1
  }
  & pnpm install
  $ec = [int]$LASTEXITCODE
  if ($ec -eq 0) { Write-SamOk "Dependencies installed" } else { Write-SamFail "pnpm install failed" }
  return $ec
}

function Invoke-ActionUpdate {
  Write-SamStep (T -Ar "تحديث آمن للفرع الحالي" -En "Safe update of current branch")
  if (-not (Test-SamCommand "git")) { Write-SamFail "git missing"; return 1 }

  $dirty = & git status --porcelain
  if ($dirty) {
    Write-SamFail (T -Ar "شجرة العمل غير نظيفة — ارفض التحديث. احفظ/التزم التغييرات أولاً." -En "Dirty working tree — refusing update. Commit or stash first.")
    Write-SamInfo ($dirty -join "`n")
    return 1
  }
  Write-SamOk (T -Ar "شجرة العمل نظيفة" -En "Working tree clean")

  $branch = (& git rev-parse --abbrev-ref HEAD).Trim()
  Write-SamInfo "branch=$branch"
  if ($branch -eq "HEAD") {
    Write-SamFail (T -Ar "detached HEAD — ارفض السحب" -En "detached HEAD — refusing pull")
    return 1
  }

  Write-SamStep "git pull --ff-only origin $branch"
  & git pull --ff-only origin $branch
  if ($LASTEXITCODE -ne 0) {
    Write-SamWarn "ff-only failed — trying git pull --ff-only"
    & git pull --ff-only
    if ($LASTEXITCODE -ne 0) {
      Write-SamFail "git pull failed"
      return $LASTEXITCODE
    }
  }
  Write-SamOk "git pull OK"

  $ec = Invoke-ActionInstallDeps
  if ($ec -ne 0) { return $ec }

  Write-SamStep "pnpm run migrate"
  & pnpm run migrate
  if ($LASTEXITCODE -ne 0) { Write-SamFail "migrate failed"; return $LASTEXITCODE }
  Write-SamOk "migrate OK"

  return (Invoke-ActionDoctor)
}

function Invoke-ActionBuildCheck {
  if (-not (Test-SamCommand "pnpm")) { Write-SamFail "pnpm missing"; return 1 }
  Write-SamStep "pnpm run typecheck"
  & pnpm run typecheck
  if ($LASTEXITCODE -ne 0) { Write-SamFail "typecheck failed"; return $LASTEXITCODE }
  Write-SamOk "typecheck"

  Write-SamStep "pnpm test"
  & pnpm test
  if ($LASTEXITCODE -ne 0) { Write-SamFail "tests failed"; return $LASTEXITCODE }
  Write-SamOk "tests"

  return (Invoke-ActionDoctor)
}

function Invoke-ActionStartUi {
  Write-SamStep (T -Ar "تشغيل Control Plane" -En "Start Control Plane")
  if (-not (Test-Path (Join-Path $ProjectRoot "node_modules"))) {
    $ec = Invoke-ActionInstallDeps
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
  & pnpm run ui
  return [int]$LASTEXITCODE
}

function Invoke-ActionPullModels {
  Write-SamStep (T -Ar "سحب النماذج المحلية من config/team.json" -En "Pull local models from config/team.json")
  if (-not (Test-SamCommand "ollama")) {
    Write-SamFail (T -Ar "ollama غير موجود في PATH" -En "ollama not in PATH")
    return 1
  }
  $models = Get-SamTeamLocalModels -ProjectRoot $ProjectRoot
  Write-SamInfo ("models: " + ($models -join ", "))
  $failed = 0
  foreach ($m in $models) {
    Write-SamInfo "ollama pull $m"
    & ollama pull $m
    if ($LASTEXITCODE -ne 0) {
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
  & pnpm run doctor
  $ec = [int]$LASTEXITCODE
  if ($ec -eq 0) { Write-SamOk "doctor PASS" } else { Write-SamFail "doctor reported issues" }
  return $ec
}

function Invoke-ActionHelp {
  Write-SamStep "pnpm run help"
  if (-not (Test-SamCommand "pnpm")) { Write-SamFail "pnpm missing"; return 1 }
  & pnpm run help
  Write-SamInfo (T -Ar "مدير الأدوات: Tools\Sam-Harness-Manager.cmd" -En "Tools manager: Tools\Sam-Harness-Manager.cmd")
  return [int]$LASTEXITCODE
}

function Invoke-ActionBackup {
  Write-SamStep (T -Ar "نسخ احتياطي لقاعدة البيانات والإعدادات" -En "Backup DB + config + .env")
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
    Write-SamOk "Backup → $dest"
    return 0
  } catch {
    Write-SamFail $_.Exception.Message
    return 1
  } finally {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-ActionRestore {
  Write-SamStep (T -Ar "استعادة من أرشيف zip" -En "Restore from zip archive")
  $zip = $RestorePath
  if (-not $zip) { $zip = $BackupPath }
  if (-not $zip -and -not $NonInteractive) {
    $zip = Read-Host (T -Ar "  مسار ملف النسخة (.zip)" -En "  Backup zip path")
  }
  if (-not $zip -or -not (Test-Path -LiteralPath $zip)) {
    Write-SamFail (T -Ar "ملف النسخة مفقود" -En "Backup zip missing")
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
    if (Test-SamCommand "pnpm") { & pnpm run migrate }
    Write-SamOk (T -Ar "الاستعادة اكتملت" -En "Restore complete")
    return 0
  } catch {
    Write-SamFail $_.Exception.Message
    return 1
  } finally {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-ActionRepair {
  Write-SamStep (T -Ar "إصلاح التثبيت" -En "Repair installation")
  $ec = Invoke-ActionSetupPrereqs
  if ($ec -ne 0) { return $ec }
  $ec = Invoke-ActionInstallDeps
  if ($ec -ne 0) { return $ec }
  Write-SamStep "pnpm run migrate"
  & pnpm run migrate
  if ($LASTEXITCODE -ne 0) { Write-SamFail "migrate failed"; return $LASTEXITCODE }
  Write-SamOk "migrate"
  return (Invoke-ActionDoctor)
}

function Invoke-ActionUninstall {
  Write-SamStep (T -Ar "إلغاء التثبيت عبر scripts/install/uninstall.ps1" -En "Uninstall via scripts/install/uninstall.ps1")
  $u = Join-Path $ProjectRoot "scripts\install\uninstall.ps1"
  if (-not (Test-Path -LiteralPath $u)) { Write-SamFail "uninstall.ps1 missing"; return 1 }
  $uninstallArgs = @()
  if ($NonInteractive) { $uninstallArgs += "-NonInteractive" }
  $ps51 = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  if (-not (Test-Path -LiteralPath $ps51)) { $ps51 = "powershell" }
  & $ps51 -NoProfile -ExecutionPolicy Bypass -File $u @uninstallArgs
  $ec = [int]$LASTEXITCODE
  if ($ec -eq 0) { Write-SamOk "uninstall finished" } else { Write-SamFail "uninstall exit $ec" }
  return $ec
}

function Invoke-ActionViewLogs {
  Write-SamStep (T -Ar "عرض أحدث السجلات" -En "View recent logs")
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
    Write-SamWarn (T -Ar "لا توجد ملفات سجل" -En "No log files found")
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
  Write-SamStep (T -Ar "تنظيف السجلات الأقدم من 14 يوماً" -En "Cleanup logs older than 14 days")
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
  Write-SamStep (T -Ar "فحص حي" -En "Live health")
  $ec = Invoke-ActionDoctor
  $port = if ($env:CONTROL_PLANE_PORT) { $env:CONTROL_PLANE_PORT } else { "8787" }
  $url = "http://127.0.0.1:$port/healthz"
  Write-SamInfo "GET $url"
  try {
    $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300) {
      Write-SamOk "/healthz OK ($($resp.StatusCode))"
    } else {
      Write-SamWarn "/healthz status $($resp.StatusCode)"
    }
  } catch {
    Write-SamWarn (T -Ar "Control Plane غير متاح على $url (شغّل start-ui)" -En "Control Plane not reachable at $url (start-ui)")
  }
  return $ec
}

# —— entry ——
$exitCode = 0
if ($Action) {
  $exitCode = Invoke-SamAction -Id $Action.Trim().ToLowerInvariant()
  exit $exitCode
}

while ($true) {
  $items = Show-SamMenu
  $prompt = T -Ar "  اختر رقمًا (أو L للغة)" -En "  Choose a number (or L for language)"
  $choice = Read-Host $prompt
  $id = Resolve-SamMenuChoice -Choice $choice -Items $items
  if ($id -eq "__toggle_lang__") {
    if ($script:SamHarnessLang -eq "ar") { Set-SamLang "en" } else { Set-SamLang "ar" }
    continue
  }
  if (-not $id) {
    Write-Host (T -Ar "  اختيار غير صالح" -En "  Invalid choice") -ForegroundColor Yellow
    continue
  }
  if ($id -eq "exit") {
    Write-Host (T -Ar "  إلى اللقاء." -En "  Goodbye.") -ForegroundColor Green
    exit 0
  }
  $exitCode = Invoke-SamAction -Id $id
  if (-not $NonInteractive) {
    Write-Host ""
    Read-Host (T -Ar "  اضغط Enter للعودة للقائمة" -En "  Press Enter to return to menu") | Out-Null
  }
}
