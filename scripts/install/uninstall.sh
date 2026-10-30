#!/usr/bin/env bash
# Sam-Harness uninstall (macOS / Linux)
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_ROOT"

REMOVE_ENV=0
PURGE_DATA=0
PURGE_DEPS=0
NONINTERACTIVE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --remove-env) REMOVE_ENV=1 ;;
    --purge-data) PURGE_DATA=1 ;;
    --purge-deps) PURGE_DEPS=1 ;;
    --non-interactive|-y) NONINTERACTIVE=1 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
  shift
done

ok() { printf '  [OK] %s\n' "$*"; }
warn() { printf '  [!!] %s\n' "$*"; }

echo ""
echo "  Sam-Harness uninstall"
echo "  Project: $PROJECT_ROOT"
echo ""

if [[ "$(uname -s)" == "Darwin" ]]; then
  PLIST="$HOME/Library/LaunchAgents/com.upnexa.sam-harness.plist"
  if [[ -f "$PLIST" ]]; then
    launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    ok "Removed LaunchAgent"
  else
    warn "No LaunchAgent"
  fi
else
  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user disable --now sam-harness.service 2>/dev/null || true
  fi
  UNIT="$HOME/.config/systemd/user/sam-harness.service"
  if [[ -f "$UNIT" ]]; then
    rm -f "$UNIT"
    ok "Removed systemd user unit"
  else
    warn "No systemd user unit"
  fi
fi

if [[ -f .sam-harness-installed ]]; then
  rm -f .sam-harness-installed
  ok "Removed install marker"
fi

if [[ "$REMOVE_ENV" -eq 1 && -f .env ]]; then
  rm -f .env
  ok "Removed .env"
fi

OUTPUT_HOME="${SAM_OUTPUT_HOME:-$HOME/Documents/Sam-Harness}"
if [[ "$PURGE_DATA" -eq 1 && -d "$OUTPUT_HOME" ]]; then
  if [[ "$NONINTERACTIVE" -eq 0 ]]; then
    read -r -p "  Delete $OUTPUT_HOME ? [y/N]: " C || true
    if [[ ! "${C:-}" =~ ^(y|yes)$ ]]; then PURGE_DATA=0; fi
  fi
  if [[ "$PURGE_DATA" -eq 1 ]]; then
    rm -rf "$OUTPUT_HOME"
    ok "Removed $OUTPUT_HOME"
  fi
fi

if [[ "$PURGE_DEPS" -eq 1 && -d node_modules ]]; then
  rm -rf node_modules
  ok "Removed node_modules"
fi

echo ""
echo "  Uninstall complete."
echo ""
