#!/usr/bin/env bash
# Push the current feature branch and open a PR into staging.
# Usage: bash scripts/git/open-pr.sh ["feat: title"] ["optional body"]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
# shellcheck source=lib-branch-flow.sh
source "$ROOT/scripts/git/lib-branch-flow.sh"

TITLE="${1:-}"
BODY="${2:-}"

if ! command -v gh >/dev/null 2>&1; then
  echo "[branch-flow] FAIL: GitHub CLI (gh) not found. Install: https://cli.github.com/" >&2
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" == "HEAD" ]]; then
  echo "[branch-flow] FAIL: Detached HEAD; check out a feature branch." >&2
  exit 1
fi
if [[ "$BRANCH" == "main" || "$BRANCH" == "staging" ]]; then
  echo "[branch-flow] FAIL: Refuse to open a PR from '$BRANCH'." >&2
  echo "  Create a feature branch first: pnpm run git:new-branch -- feat/my-change" >&2
  exit 1
fi
if ! branch_flow_is_allowed_branch "$BRANCH"; then
  echo "[branch-flow] FAIL: Branch '$BRANCH' is not an allowed name." >&2
  branch_flow_print_branch_help
  exit 1
fi

if [[ -z "$TITLE" ]]; then
  prefix="${BRANCH%%/*}"
  slug="${BRANCH#*/}"
  slug="${slug//[-_]/ }"
  case "$prefix" in
    feature) prefix=feat ;;
    cursor|sync|dependabot) prefix=chore ;;
    hotfix) prefix=fix ;;
  esac
  TITLE="${prefix}: ${slug}"
fi

if ! branch_flow_is_conventional_title "$TITLE"; then
  echo "[branch-flow] FAIL: PR title must be Conventional Commits, e.g. 'feat: add X'." >&2
  echo "  Got: $TITLE" >&2
  exit 1
fi

if [[ -z "$BODY" ]]; then
  BODY="$(cat <<'EOF'
## Summary
- (fill in)

## Workflow
- Base: `staging` (required)
- See CONTRIBUTING.md / docs/GIT_WORKFLOW.md
EOF
)"
fi

echo "[branch-flow] Pushing $BRANCH to origin..."
if ! git push -u origin "$BRANCH"; then
  cat >&2 <<'EOF'
[branch-flow] FAIL: git push failed.
If you see 'protected branch' you tried to push main/staging — use a feature branch.
If auth fails with Write permission errors:
  - Classic PAT needs 'repo' scope
  - Fine-grained PAT needs Contents + Pull requests (read/write) on this repo
  - Or: gh auth login  (ensure the correct account)
EOF
  exit 1
fi

echo "[branch-flow] Creating PR into staging..."
if ! gh pr create --base staging --head "$BRANCH" --title "$TITLE" --body "$BODY"; then
  cat >&2 <<'EOF'
[branch-flow] FAIL: gh pr create failed.
Common causes:
  - Wrong GitHub account: gh auth status
  - Token missing scopes: classic 'repo'; fine-grained Contents + Pull requests R/W
  - Needs Write permission on the repo
EOF
  exit 1
fi

echo "[branch-flow] OK: Opened PR into staging"
gh pr view --json url --jq .url 2>/dev/null || true
