#Requires -Version 5.1
<#
.SYNOPSIS
  Enable versioned git hooks (core.hooksPath=.githooks).
#>
[CmdletBinding()]
param()
$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $ProjectRoot

function Write-Info([string]$msg) { Write-Host "[branch-flow] $msg" }

$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) {
  Write-Info "setup-hooks: skip (git not found)"
  exit 0
}

$inside = & git rev-parse --is-inside-work-tree 2>$null
if ($LASTEXITCODE -ne 0 -or "$inside".Trim() -ne "true") {
  Write-Info "setup-hooks: skip (not a git work tree)"
  exit 0
}

if (-not (Test-Path -LiteralPath ".githooks")) {
  Write-Host "[branch-flow] setup-hooks: .githooks missing" -ForegroundColor Red
  exit 1
}

& git config core.hooksPath .githooks
if ($LASTEXITCODE -ne 0) {
  Write-Host "[branch-flow] setup-hooks: git config failed" -ForegroundColor Red
  exit $LASTEXITCODE
}
Write-Info "setup-hooks: core.hooksPath=.githooks"
Write-Info "Hooks: pre-push (block main/staging + bad names), commit-msg (conventional)"
