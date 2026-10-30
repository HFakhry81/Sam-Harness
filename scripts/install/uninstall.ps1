#Requires -Version 5.1
<#
.SYNOPSIS
  Sam-Harness uninstall (Windows) — removes startup task + install marker.
  Does not delete SAM_OUTPUT_HOME or node_modules unless -PurgeData / -PurgeDeps.
#>
[CmdletBinding()]
param(
  [switch]$RemoveEnv,
  [switch]$PurgeData,
  [switch]$PurgeDeps,
  [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $ProjectRoot

function Write-Ok([string]$msg) { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn([string]$msg) { Write-Host "  [!!] $msg" -ForegroundColor Yellow }

Write-Host ""
Write-Host "  Sam-Harness uninstall (Windows)" -ForegroundColor Cyan
Write-Host "  Project: $ProjectRoot"
Write-Host ""

$taskName = "SamHarnessControlPlane"
& schtasks /Query /TN $taskName 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
  & schtasks /Delete /TN $taskName /F | Out-Null
  Write-Ok "Removed scheduled task $taskName"
} else {
  Write-Warn "No scheduled task $taskName"
}

$marker = Join-Path $ProjectRoot ".sam-harness-installed"
if (Test-Path $marker) {
  Remove-Item -LiteralPath $marker -Force
  Write-Ok "Removed install marker"
}

if ($RemoveEnv) {
  $envPath = Join-Path $ProjectRoot ".env"
  if (Test-Path $envPath) {
    Remove-Item -LiteralPath $envPath -Force
    Write-Ok "Removed .env"
  }
}

if ($PurgeData) {
  $home = Join-Path $env:USERPROFILE "Documents\Sam-Harness"
  if (Test-Path $home) {
    if (-not $NonInteractive) {
      $c = Read-Host "  Delete $home ? [y/N]"
      if ($c -notmatch '^(y|yes)$') { $PurgeData = $false }
    }
  }
  if ($PurgeData -and (Test-Path $home)) {
    Remove-Item -LiteralPath $home -Recurse -Force
    Write-Ok "Removed $home"
  }
}

if ($PurgeDeps) {
  $nm = Join-Path $ProjectRoot "node_modules"
  if (Test-Path $nm) {
    Remove-Item -LiteralPath $nm -Recurse -Force
    Write-Ok "Removed node_modules"
  }
}

Write-Host ""
Write-Host "  Uninstall complete." -ForegroundColor Green
Write-Host ""
