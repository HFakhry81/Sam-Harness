#Requires -Version 5.1
<#
.SYNOPSIS
  Open a pull request into staging with the GitHub CLI.

.PARAMETER Title
  Optional PR title (Conventional Commits). Default: derived from branch name.

.PARAMETER Body
  Optional PR body. Default: points reviewers at CONTRIBUTING.md.

.EXAMPLE
  powershell -File scripts\git\open-pr.ps1 -Title "feat: add branch-flow guard"
#>
[CmdletBinding()]
param(
  [string]$Title = "",
  [string]$Body = ""
)
$ErrorActionPreference = "Stop"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $ProjectRoot

function Fail([string]$msg) {
  Write-Host "[branch-flow] FAIL: $msg" -ForegroundColor Red
  exit 1
}
function Ok([string]$msg) { Write-Host "[branch-flow] OK: $msg" -ForegroundColor Green }

$gh = Get-Command gh -ErrorAction SilentlyContinue
if (-not $gh) {
  Fail "GitHub CLI (gh) not found. Install: https://cli.github.com/"
}

$branch = (& git rev-parse --abbrev-ref HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or -not $branch -or $branch -eq "HEAD") {
  Fail "Could not resolve current branch."
}
if ($branch -eq "main" -or $branch -eq "staging") {
  Fail "Refuse to open a PR from '$branch'. Create a feature branch first (pnpm run git:new-branch)."
}

$allowed = '^(feat|fix|chore|docs|feature|hotfix|refactor|test|ci|build|perf|style|cursor|sync|dependabot)/.+'
if ($branch -notmatch $allowed) {
  Fail "Branch '$branch' is not an allowed name. See CONTRIBUTING.md."
}

if (-not $Title) {
  $slug = ($branch -replace '^[^/]+/', '' -replace '[-_]+', ' ')
  $prefix = ($branch -split '/')[0]
  if ($prefix -eq "feature") { $prefix = "feat" }
  if ($prefix -eq "cursor") { $prefix = "chore" }
  if ($prefix -eq "sync") { $prefix = "chore" }
  if ($prefix -eq "dependabot") { $prefix = "chore" }
  if ($prefix -eq "hotfix") { $prefix = "fix" }
  $Title = "${prefix}: $slug"
}

$titleOk = $Title -match '^(feat|fix|chore|docs|refactor|test|ci|build|perf|style|revert)(\([^)]+\))?!?: .+'
if (-not $titleOk) {
  Fail "PR title must be Conventional Commits, e.g. 'feat: add X'. Got: $Title"
}

if (-not $Body) {
  $Body = @"
## Summary
- (fill in)

## Workflow
- Base: ``staging`` (required)
- See CONTRIBUTING.md / docs/GIT_WORKFLOW.md
"@
}

Write-Host "[branch-flow] Pushing $branch to origin..."
& git push -u origin $branch
if ($LASTEXITCODE -ne 0) {
  Fail @"
git push failed.
If you see 'protected branch' you tried to push main/staging — use a feature branch.
If gh/git auth fails with Write permission errors:
  - Classic PAT needs 'repo' scope
  - Fine-grained PAT needs Contents + Pull requests (read/write) on this repo
  - Or: gh auth login  (ensure the correct account)
"@
}

Write-Host "[branch-flow] Creating PR into staging..."
& gh pr create --base staging --head $branch --title $Title --body $Body
if ($LASTEXITCODE -ne 0) {
  Fail @"
gh pr create failed.
Common causes:
  - Wrong GitHub account: gh auth status
  - Token missing scopes: classic 'repo'; fine-grained Contents + Pull requests R/W
  - Needs Write permission on the repo
"@
}

Ok "Opened PR into staging"
& gh pr view --web
