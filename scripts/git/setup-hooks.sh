#!/usr/bin/env bash
# Enable versioned git hooks for this clone (core.hooksPath=.githooks).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[branch-flow] setup-hooks: skip (not a git work tree)"
  exit 0
fi
if [[ ! -d .githooks ]]; then
  echo "[branch-flow] setup-hooks: .githooks missing" >&2
  exit 1
fi
git config core.hooksPath .githooks
echo "[branch-flow] setup-hooks: core.hooksPath=.githooks"
echo "[branch-flow] Hooks: pre-push (block main/staging + bad names), commit-msg (conventional)"
