#!/usr/bin/env bash
# Shared helpers for Sam-Harness Tools (bash - Ubuntu/macOS).
# shellcheck shell=bash

SAM_HARNESS_LANG="en"
SAM_HARNESS_LOG_FILE=""
SAM_HARNESS_START_EPOCH="$(date +%s)"
SAM_HARNESS_STEP=0
SAM_HARNESS_OK=0
SAM_HARNESS_WARN=0
SAM_HARNESS_FAIL=0

# Colors (ANSI) - disable when not a TTY
if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_RESET=$'\033[0m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_RED=$'\033[31m'
  C_CYAN=$'\033[36m'
  C_GRAY=$'\033[90m'
  C_WHITE=$'\033[97m'
  C_DCYAN=$'\033[36m'
else
  C_RESET=""; C_GREEN=""; C_YELLOW=""; C_RED=""; C_CYAN=""; C_GRAY=""; C_WHITE=""; C_DCYAN=""
fi

sam_tools_dir() {
  # When sourced from manager: TOOLS_DIR is set by caller
  if [[ -n "${TOOLS_DIR:-}" ]]; then
    printf '%s\n' "$TOOLS_DIR"
  else
    local here
    here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    printf '%s\n' "$(cd "$here/.." && pwd)"
  fi
}

sam_project_root() {
  if [[ -n "${PROJECT_ROOT:-}" ]]; then
    printf '%s\n' "$PROJECT_ROOT"
    return
  fi
  local tools
  tools="$(sam_tools_dir)"
  printf '%s\n' "$(cd "$tools/.." && pwd)"
}

sam_output_home() {
  local root
  root="$(sam_project_root)"
  if [[ -n "${SAM_OUTPUT_HOME:-}" ]]; then
    printf '%s\n' "$SAM_OUTPUT_HOME"
    return
  fi
  if [[ -f "$root/.env" ]]; then
    local v
    v="$(grep -E '^[[:space:]]*SAM_OUTPUT_HOME=' "$root/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs || true)"
    if [[ -n "${v:-}" ]]; then
      printf '%s\n' "$v"
      return
    fi
  fi
  printf '%s\n' "${HOME}/Documents/Sam-Harness"
}

sam_logs_dir() {
  local home root fallback
  home="$(sam_output_home)"
  root="$(sam_project_root)"
  fallback="$root/Tools/logs"
  if [[ -d "$home/logs" ]]; then
    printf '%s\n' "$home/logs"
  else
    mkdir -p "$fallback"
    printf '%s\n' "$fallback"
  fi
}

sam_set_lang() {
  # No-op: Tools console is English-only.
  :
}

t() {
  # Backward-compat: ignore Arabic arg; print English.
  printf '%s
' "${2:-$1}"
}

sam_log() {
  if [[ -n "$SAM_HARNESS_LOG_FILE" ]]; then
    printf '%s\n' "$*" >>"$SAM_HARNESS_LOG_FILE"
  fi
}

sam_init_logging() {
  local action="$1"
  local logs stamp safe
  logs="$(sam_logs_dir)"
  mkdir -p "$logs"
  # also ensure output home logs if possible
  mkdir -p "$(sam_output_home)/logs" 2>/dev/null || true
  if [[ -d "$(sam_output_home)/logs" ]]; then
    logs="$(sam_output_home)/logs"
  fi
  stamp="$(date +%Y%m%d-%H%M%S)"
  safe="$(printf '%s' "$action" | tr -c 'A-Za-z0-9_-' '_')"
  SAM_HARNESS_LOG_FILE="$logs/manager-${safe}-${stamp}.log"
  SAM_HARNESS_START_EPOCH="$(date +%s)"
  SAM_HARNESS_STEP=0
  SAM_HARNESS_OK=0
  SAM_HARNESS_WARN=0
  SAM_HARNESS_FAIL=0
  printf 'Sam-Harness Manager log | %s | %s\n' "$action" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$SAM_HARNESS_LOG_FILE"
  printf '%s\n' "$SAM_HARNESS_LOG_FILE"
}

sam_banner() {
  local sub="${1:-}"
  echo ""
  echo -e "  ${C_DCYAN}================================================================${C_RESET}"
  echo -e "   ${C_WHITE}Sam-Harness Manager${C_RESET}"
  echo -e "   ${C_GRAY}Control Plane | Hybrid Agency | Phases 0-9${C_RESET}"
  if [[ -n "$sub" ]]; then
    echo -e "   ${C_CYAN}${sub}${C_RESET}"
  fi
  echo -e "  ${C_DCYAN}================================================================${C_RESET}"
  echo ""
}

sam_info()  { echo -e "  ${C_CYAN}[INFO]${C_RESET} $*"; sam_log "[INFO] $*"; }
sam_ok()    { SAM_HARNESS_OK=$((SAM_HARNESS_OK + 1)); echo -e "  ${C_GREEN}[OK]${C_RESET}   $*"; sam_log "[OK] $*"; }
sam_warn()  { SAM_HARNESS_WARN=$((SAM_HARNESS_WARN + 1)); echo -e "  ${C_YELLOW}[WARN]${C_RESET} $*"; sam_log "[WARN] $*"; }
sam_fail()  { SAM_HARNESS_FAIL=$((SAM_HARNESS_FAIL + 1)); echo -e "  ${C_RED}[FAIL]${C_RESET} $*" >&2; sam_log "[FAIL] $*"; }
sam_step()  {
  SAM_HARNESS_STEP=$((SAM_HARNESS_STEP + 1))
  echo ""
  echo -e "  ${C_CYAN}[${SAM_HARNESS_STEP}]${C_RESET} $*"
  sam_log "[STEP ${SAM_HARNESS_STEP}] $*"
}

sam_summary() {
  local code="${1:-0}"
  local now elapsed
  now="$(date +%s)"
  elapsed=$((now - SAM_HARNESS_START_EPOCH))
  echo ""
  echo -e "  ${C_GRAY}----------------------------------------------------------------${C_RESET}"
  echo "  Summary: OK=${SAM_HARNESS_OK}  WARN=${SAM_HARNESS_WARN}  FAIL=${SAM_HARNESS_FAIL}  time=${elapsed}s  exit=${code}"
  if [[ -n "$SAM_HARNESS_LOG_FILE" ]]; then
    echo -e "  ${C_GRAY}log: ${SAM_HARNESS_LOG_FILE}${C_RESET}"
  fi
  echo -e "  ${C_GRAY}----------------------------------------------------------------${C_RESET}"
  echo ""
  sam_log "SUMMARY ok=${SAM_HARNESS_OK} warn=${SAM_HARNESS_WARN} fail=${SAM_HARNESS_FAIL} exit=${code} secs=${elapsed}"
}

sam_pinned_pnpm() {
  local root pkg
  root="$(sam_project_root)"
  pkg="$root/package.json"
  if [[ -f "$pkg" ]] && grep -qE '"packageManager"[[:space:]]*:[[:space:]]*"pnpm@' "$pkg"; then
    sed -nE 's/.*"packageManager"[[:space:]]*:[[:space:]]*"pnpm@([^"]+)".*/\1/p' "$pkg" | head -1
    return
  fi
  printf '%s\n' "11.23.0"
}

sam_team_local_models() {
  local root path
  root="$(sam_project_root)"
  path="$root/config/team.json"
  if [[ ! -f "$path" ]]; then
    printf '%s\n' "qwen2.5-coder:1.5b" "gemma3:1b" "qwen2.5:1.5b"
    return
  fi
  if command -v node >/dev/null 2>&1; then
    node -e '
      const fs=require("fs");
      const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
      const s=new Set();
      for (const r of (j.roles||[])) {
        const m=r && r.models && r.models.local;
        if (m && String(m).trim()) s.add(String(m).trim());
      }
      for (const m of s) console.log(m);
    ' "$path" 2>/dev/null && return
  fi
  # fallback grep
  grep -oE '"local"[[:space:]]*:[[:space:]]*"[^"]+"' "$path" | sed -E 's/.*"([^"]+)"/\1/' | sort -u
}

sam_manifest_actions() {
  local tools man
  tools="$(sam_tools_dir)"
  man="$tools/lib/actions.manifest"
  if [[ -f "$man" ]]; then
    grep -vE '^\s*(#|$)' "$man" || true
  fi
}

sam_ensure_env() {
  local root
  root="$(sam_project_root)"
  if [[ ! -f "$root/.env" ]]; then
    if [[ -f "$root/.env.example" ]]; then
      cp "$root/.env.example" "$root/.env"
      sam_ok "Created .env from .env.example"
    else
      sam_warn ".env.example missing"
    fi
  else
    sam_ok ".env already present"
  fi
}

sam_ensure_output_home() {
  local home
  home="$(sam_output_home)"
  mkdir -p "$home"/{reports,documents,exports,runs,memory,temp,state,logs}
  export SAM_OUTPUT_HOME="$home"
  sam_ok "SAM_OUTPUT_HOME -> $home"
}
