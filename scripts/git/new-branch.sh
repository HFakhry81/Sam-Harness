#!/usr/bin/env bash
# Create a feature branch from the latest origin/staging.
# Usage: bash scripts/git/new-branch.sh feat/my-change
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
# shellcheck source=lib-branch-flow.sh
source "$ROOT/scripts/git/lib-branch-flow.sh"

NAME="${1:-}"
if [[ -z "$NAME" ]]; then
  echo "[branch-flow] Usage: $0 <branch-name>" >&2
  echo "  Example: $0 feat/add-hooks" >&2
  branch_flow_print_branch_help
  exit 1
fi

if ! branch_flow_is_allowed_branch "$NAME"; then
  echo "[branch-flow] FAIL: Branch name '$NAME' is not allowed." >&2
  branch_flow_print_branch_help
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "[branch-flow] FAIL: Working tree is dirty. Commit or stash first." >&2
  exit 1
fi

echo "[branch-flow] Fetching origin/staging..."
git fetch origin staging
git checkout -B "$NAME" origin/staging
echo "[branch-flow] OK: On branch $NAME (from origin/staging)"
echo "Next: make commits, then: pnpm run git:open-pr"
echo "  or: bash scripts/git/open-pr.sh"
