#!/usr/bin/env bash
# Validate a pull request against the Sam-Harness branch flow.
# Usage (CI): BASE_REF=main HEAD_REF=staging PR_TITLE="chore: release" bash scripts/git/check-pr-flow.sh
# Exit 0 = pass, 1 = fail. English-only ASCII.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=lib-branch-flow.sh
source "$ROOT/scripts/git/lib-branch-flow.sh"

BASE_REF="${BASE_REF:-${GITHUB_BASE_REF:-}}"
HEAD_REF="${HEAD_REF:-${GITHUB_HEAD_REF:-}}"
PR_TITLE="${PR_TITLE:-}"

if [[ -z "$BASE_REF" || -z "$HEAD_REF" ]]; then
  echo "[branch-flow] ERROR: BASE_REF and HEAD_REF are required." >&2
  exit 1
fi

fail() {
  echo "[branch-flow] FAIL: $*" >&2
  exit 1
}

ok() {
  echo "[branch-flow] OK: $*"
}

echo "[branch-flow] Checking PR  $HEAD_REF  ->  $BASE_REF"
if [[ -n "$PR_TITLE" ]]; then
  echo "[branch-flow] Title: $PR_TITLE"
fi

case "$BASE_REF" in
  main)
    if [[ "$HEAD_REF" != "staging" ]]; then
      fail "PRs into main must come from staging (got head='$HEAD_REF').
  Open a release PR: staging -> main.
  Feature work must PR into staging first. See CONTRIBUTING.md."
    fi
    ok "Release PR head is staging."
    if [[ -n "$PR_TITLE" ]]; then
      if ! branch_flow_is_release_title "$PR_TITLE"; then
        fail "Release PR title must be conventional (e.g. 'chore: release staging to main')
  or start with 'Release: ...'. Got: $PR_TITLE"
      fi
      ok "Release PR title accepted."
    fi
    ;;
  staging)
    if [[ "$HEAD_REF" == "main" || "$HEAD_REF" == "staging" ]]; then
      fail "PRs into staging must use a feature branch (got head='$HEAD_REF')."
    fi
    if ! branch_flow_is_allowed_branch "$HEAD_REF"; then
      echo "[branch-flow] FAIL: Branch '$HEAD_REF' does not match the required naming pattern." >&2
      branch_flow_print_branch_help
      exit 1
    fi
    ok "Feature branch name '$HEAD_REF' is allowed."
    if [[ -n "$PR_TITLE" ]]; then
      if ! branch_flow_is_conventional_title "$PR_TITLE"; then
        fail "PR title must follow Conventional Commits, e.g.:
  feat: add X
  fix(ui): correct Y
  chore: bump deps
Got: $PR_TITLE"
      fi
      ok "PR title is conventional."
    fi
    ;;
  *)
    ok "Base '$BASE_REF' is not main/staging; no branch-flow rules applied."
    ;;
esac

echo "[branch-flow] All checks passed."
exit 0
