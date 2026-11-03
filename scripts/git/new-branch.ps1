#Requires -Version 5.1
<#
.SYNOPSIS
  Create a feature branch from the latest origin/staging.

.PARAMETER Name
  Branch name, e.g. feat/add-hooks or fix/ci-windows.

.EXAMPLE
  powershell -File scripts\git\new-branch.ps1 -Name feat/add-hooks
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Name
)
$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $ProjectRoot

function Fail([string]$msg) {
  Write-Host "[branch-flow] FAIL: $msg" -ForegroundColor Red
  exit 1
}
function Ok([string]$msg) { Write-Host "[branch-flow] OK: $msg" -ForegroundColor Green }

$allowed = '^(feat|fix|chore|docs|feature|hotfix|refactor|test|ci|build|perf|style|cursor|sync|dependabot)/.+'
if ($Name -notmatch $allowed) {
  Fail "Branch name '$Name' is not allowed. Use feat/..., fix/..., chore/..., docs/..., or cursor/..."
}

$status = & git status --porcelain
if ($LASTEXITCODE -ne 0) { Fail "git status failed" }
if ($status) {
  Fail "Working tree is dirty. Commit or stash first."
}

Write-Host "[branch-flow] Fetching origin/staging..."
& git fetch origin staging
if ($LASTEXITCODE -ne 0) { Fail "git fetch origin staging failed" }

& git checkout -B $Name origin/staging
if ($LASTEXITCODE -ne 0) { Fail "git checkout -B $Name origin/staging failed" }

Ok "On branch $Name (from origin/staging)"
Write-Host "Next: make commits, then: pnpm run git:open-pr"
Write-Host "  or: powershell -File scripts\git\open-pr.ps1"
