#Requires -Version 5.1
<#
.SYNOPSIS
  Sam-Harness one-click install (Windows) — idempotent.

.DESCRIPTION
  Checks/installs Node + pnpm (winget / Corepack), installs deps, creates .env
  from .env.example with optional prompts, sets up SAM_OUTPUT_HOME under
  Documents\Sam-Harness, optionally registers a logon scheduled task, runs doctor.

.PARAMETER NonInteractive
  Skip prompts; use defaults (locale=ar, eastern numerals for app config).

.PARAMETER RegisterStartup
  Register ONLOGON scheduled task for Control Plane UI.

.PARAMETER SkipDeps
  Skip pnpm install (useful when deps already present).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install\install.ps1
#>
[CmdletBinding()]
param(
  [switch]$NonInteractive,
  [switch]$RegisterStartup,
  [switch]$SkipDeps
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $ProjectRoot

function Write-Step([string]$msg) { Write-Host "  [*] $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg) { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "  [!!] $msg" -ForegroundColor Yellow }
function Write-Err([string]$msg) { Write-Host "  [XX] $msg" -ForegroundColor Red }

Write-Host ""
Write-Host "  ================================================================" -ForegroundColor DarkCyan
Write-Host "   Sam-Harness  -  One-click install (Windows)" -ForegroundColor White
Write-Host "   Control Plane · Hybrid Agency" -ForegroundColor Gray
Write-Host "  ================================================================" -ForegroundColor DarkCyan
Write-Host "  Project: $ProjectRoot"
Write-Host ""

# —— Node ——
Write-Step "Checking Node.js…"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Warn "Node not in PATH — trying winget OpenJS.NodeJS.LTS"
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    & winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  } else {
    Write-Err "winget missing. Install Node 20+ LTS manually, then re-run."
    exit 1
  }
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
              [System.Environment]::GetEnvironmentVariable("Path", "User")
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Write-Err "Node still missing — open a new terminal after install."
    exit 1
  }
}
$nodeVer = & node -v
Write-Ok "Node $nodeVer"

# —— pnpm via Corepack ——
Write-Step "Enabling Corepack / pnpm…"
try { & corepack enable 2>$null } catch { }
try { & corepack prepare pnpm@11.23.0 --activate } catch {
  Write-Warn "corepack prepare failed — trying npm i -g pnpm"
  & npm install -g pnpm
}
$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpm) {
  Write-Err "pnpm not available"
  exit 1
}
Write-Ok "pnpm $(pnpm -v)"

# —— Prompts / .env ——
$locale = "ar"
$numerals = "eastern"
$port = "8787"
if (-not $NonInteractive) {
  $l = Read-Host "  Locale [ar/en] (default ar)"
  if ($l) { $locale = $l.Trim().ToLower() }
  $n = Read-Host "  Numerals [eastern/western] (default eastern)"
  if ($n) { $numerals = $n.Trim().ToLower() }
  $p = Read-Host "  Control Plane port (default 8787)"
  if ($p) { $port = $p.Trim() }
  if (-not $RegisterStartup) {
    $s = Read-Host "  Register startup task? [y/N]"
    if ($s -match '^(y|yes)$') { $RegisterStartup = $true }
  }
}

Write-Step "Creating .env from .env.example (idempotent)…"
$envPath = Join-Path $ProjectRoot ".env"
$examplePath = Join-Path $ProjectRoot ".env.example"
if (-not (Test-Path $examplePath)) {
  Write-Err ".env.example missing"
  exit 1
}
if (-not (Test-Path $envPath)) {
  Copy-Item $examplePath $envPath
  Write-Ok "Created .env"
} else {
  Write-Ok ".env already exists (preserving values)"
}

function Set-EnvKey([string]$file, [string]$key, [string]$value) {
  $content = Get-Content -LiteralPath $file -Raw -ErrorAction Stop
  $re = "(?m)^$([regex]::Escape($key))=.*$"
  if ($content -match $re) {
    $content = [regex]::Replace($content, $re, "$key=$value")
  } else {
    if (-not $content.EndsWith("`n")) { $content += "`n" }
    $content += "$key=$value`n"
  }
  # UTF-8 without BOM for cross-platform .env
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($file, $content, $utf8)
}

$outputHome = Join-Path $env:USERPROFILE "Documents\Sam-Harness"
Set-EnvKey $envPath "SAM_LOCALE" $locale
Set-EnvKey $envPath "SAM_UI_LOCALE" $locale
Set-EnvKey $envPath "SAM_CONTENT_LOCALE" $locale
Set-EnvKey $envPath "SAM_NUMERALS" $numerals
Set-EnvKey $envPath "SAM_EGYPTIAN_FRIENDLY" "1"
Set-EnvKey $envPath "CONTROL_PLANE_PORT" $port
Set-EnvKey $envPath "SAM_OUTPUT_HOME" $outputHome
Write-Ok "Locale=$locale numerals=$numerals port=$port"

# —— Output home ——
Write-Step "Ensuring SAM_OUTPUT_HOME…"
@(
  $outputHome,
  (Join-Path $outputHome "reports"),
  (Join-Path $outputHome "documents"),
  (Join-Path $outputHome "exports"),
  (Join-Path $outputHome "runs"),
  (Join-Path $outputHome "memory"),
  (Join-Path $outputHome "temp"),
  (Join-Path $outputHome "state")
) | ForEach-Object {
  if (-not (Test-Path $_)) { New-Item -ItemType Directory -Path $_ | Out-Null }
}
Write-Ok $outputHome

# —— task.ts seed ——
$taskPath = Join-Path $ProjectRoot "task.ts"
$seedPath = Join-Path $ProjectRoot "templates\task.seed.ts"
if (-not (Test-Path $taskPath) -and (Test-Path $seedPath)) {
  Copy-Item $seedPath $taskPath
  Write-Ok "Seeded task.ts"
}

# —— deps ——
if (-not $SkipDeps) {
  Write-Step "pnpm install…"
  & pnpm install
  if ($LASTEXITCODE -ne 0) { Write-Err "pnpm install failed"; exit $LASTEXITCODE }
  Write-Ok "Dependencies installed"
} else {
  Write-Warn "Skipped pnpm install"
}

# —— startup ——
$taskName = "SamHarnessControlPlane"
if ($RegisterStartup) {
  Write-Step "Registering scheduled task $taskName…"
  $tr = "cmd /c `"cd /d `"$ProjectRoot`" && pnpm run ui`""
  & schtasks /Create /TN $taskName /TR $tr /SC ONLOGON /RL LIMITED /F | Out-Null
  Write-Ok "Scheduled task registered"
}

# —— marker ——
$marker = Join-Path $ProjectRoot ".sam-harness-installed"
@{
  installedAt = (Get-Date).ToString("o")
  platform = "win32"
  outputHome = $outputHome
  locale = $locale
  startup = [bool]$RegisterStartup
} | ConvertTo-Json | Set-Content -LiteralPath $marker -Encoding UTF8
Write-Ok "Wrote install marker"

# —— doctor ——
Write-Step "Running doctor…"
& pnpm run doctor
$doctorCode = $LASTEXITCODE

Write-Host ""
Write-Host "  Install complete. Next:" -ForegroundColor Green
Write-Host "    pnpm run ui          → Control Plane"
Write-Host "    pnpm run doctor      → re-check"
Write-Host "    SamHarness.bat       → launcher menu"
Write-Host "  Uninstall: powershell -File scripts\install\uninstall.ps1"
Write-Host ""
exit $doctorCode
