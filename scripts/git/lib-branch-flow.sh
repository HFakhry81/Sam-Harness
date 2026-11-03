#!/usr/bin/env bash
# Shared branch-flow policy for hooks and CI. English-only ASCII.
# Source this file; do not execute it directly.

# Allowed feature-branch prefixes (head of PRs into staging / local push).
# Cloud Agents use cursor/*; sync/* is for main<->staging maintenance.
BRANCH_FLOW_PREFIX_RE='^(feat|fix|chore|docs|feature|hotfix|refactor|test|ci|build|perf|style|cursor|sync|dependabot)/.+'

# Conventional Commit / PR title (optional scope, optional breaking !).
BRANCH_FLOW_TITLE_RE='^(feat|fix|chore|docs|refactor|test|ci|build|perf|style|revert)(\([^)]+\))?!?: .+'

# Extra titles allowed only for release PRs (staging -> main).
BRANCH_FLOW_RELEASE_TITLE_RE='^(Release|release)([:]| ).+'

branch_flow_is_allowed_branch() {
  local name="$1"
  [[ "$name" =~ $BRANCH_FLOW_PREFIX_RE ]]
}

branch_flow_is_conventional_title() {
  local title="$1"
  [[ "$title" =~ $BRANCH_FLOW_TITLE_RE ]]
}

branch_flow_is_release_title() {
  local title="$1"
  [[ "$title" =~ $BRANCH_FLOW_RELEASE_TITLE_RE ]] || branch_flow_is_conventional_title "$title"
}

branch_flow_print_branch_help() {
  cat >&2 <<'EOF'
[branch-flow] Allowed branch names:
  feat/<name>  fix/<name>  chore/<name>  docs/<name>
  feature/<name>  hotfix/<name>  refactor/<name>
  test/<name>  ci/<name>  build/<name>  perf/<name>  style/<name>
  cursor/<name>  sync/<name>  dependabot/<name>

Start correctly:
  pnpm run git:new-branch -- feat/my-change
  # or: bash scripts/git/new-branch.sh feat/my-change
See CONTRIBUTING.md and docs/GIT_WORKFLOW.md.
EOF
}
