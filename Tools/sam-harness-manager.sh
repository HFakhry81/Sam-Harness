#!/usr/bin/env bash
# Sam-Harness unified Tools manager (Ubuntu / macOS).
# Usage:
#   ./sam-harness-manager.sh
#   ./sam-harness-manager.sh --action update --non-interactive
set -euo pipefail

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/sam-harness-common.sh
source "$TOOLS_DIR/lib/sam-harness-common.sh"

PROJECT_ROOT="$(cd "$TOOLS_DIR/.." && pwd)"
cd "$PROJECT_ROOT"
export PROJECT_ROOT TOOLS_DIR

ACTION=""
LANG_OPT=""
NONINTERACTIVE=0
CLONE_URL="https://github.com/HFakhry81/Sam-Harness"
BACKUP_PATH=""
RESTORE_PATH=""

usage() {
  cat <<EOF
Usage: $(basename "$0") [--action ID] [--non-interactive]
                        [--clone-url URL] [--backup-path PATH] [--restore-path PATH]

Actions (see Tools/lib/actions.manifest):
  install setup-prereqs install-deps update build-check start-ui pull-models
  doctor help backup restore repair uninstall view-logs cleanup-logs health exit
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --action|-Action|-a) ACTION="${2:-}"; shift ;;
    --lang|-Lang) LANG_OPT="${2:-}"; shift ;;  # ignored (English-only)
    --non-interactive|-NonInteractive|-y) NONINTERACTIVE=1 ;;
    --clone-url) CLONE_URL="${2:-}"; shift ;;
    --backup-path|-BackupPath) BACKUP_PATH="${2:-}"; shift ;;
    --restore-path|-RestorePath) RESTORE_PATH="${2:-}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1"; usage; exit 1 ;;
  esac
  shift
done

sam_set_lang en  # English-only (-Lang/--lang ignored)

# Ensure UTF-8 locale when possible
export LANG="${LANG:-en_US.UTF-8}"
export LC_ALL="${LC_ALL:-$LANG}"

show_menu() {
  sam_banner "Main menu"
  echo -e "  ${C_GRAY}Project: ${PROJECT_ROOT}${C_RESET}"
  echo ""
  local rows=(
    "1|install|Install on a new machine"
    "2|setup-prereqs|Setup prerequisites"
    "3|install-deps|Install dependencies (pnpm)"
    "4|update|Update (git + install + migrate + doctor)"
    "5|build-check|Build/check (typecheck + tests + doctor)"
    "6|start-ui|Start Control Plane UI"
    "7|pull-models|Pull Ollama models (from team.json)"
    "8|doctor|Doctor — health check"
    "9|help|Help (pnpm help)"
    "10|backup|Backup (DB + config + .env)"
    "11|restore|Restore from backup"
    "12|repair|Repair (deps + migrate + doctor)"
    "13|uninstall|Uninstall"
    "14|view-logs|View logs"
    "15|cleanup-logs|Cleanup logs"
    "16|health|Live health (doctor + /healthz)"
    "0|exit|Exit"
  )
  local row n id label
  for row in "${rows[@]}"; do
    IFS='|' read -r n id label <<<"$row"
    printf '   [%2s]  %s\n' "$n" "$label"
  done
  echo ""
}

resolve_choice() {
  local c="$1"
  c="$(echo "$c" | tr -d '[:space:]')"
  case "$c" in
    1) echo install ;;
    2) echo setup-prereqs ;;
    3) echo install-deps ;;
    4) echo update ;;
    5) echo build-check ;;
    6) echo start-ui ;;
    7) echo pull-models ;;
    8) echo doctor ;;
    9) echo help ;;
    10) echo backup ;;
    11) echo restore ;;
    12) echo repair ;;
    13) echo uninstall ;;
    14) echo view-logs ;;
    15) echo cleanup-logs ;;
    16) echo health ;;
    0|q|Q|exit) echo exit ;;
    *)
      if sam_manifest_actions | grep -qx "$c"; then
        echo "$c"
      else
        echo ""
      fi
      ;;
  esac
}

action_install() {
  sam_step "Fresh-machine install (delegate to scripts/install)"
  local is_repo=0
  if [[ -f "$PROJECT_ROOT/package.json" ]] && grep -q '"name"[[:space:]]*:[[:space:]]*"Sam-Harness"' "$PROJECT_ROOT/package.json"; then
    is_repo=1
  fi
  if [[ "$is_repo" -eq 0 ]]; then
    sam_warn "Current folder is not Sam-Harness — attempting clone"
    if ! command -v git >/dev/null 2>&1; then
      sam_fail "git missing"; return 1
    fi
    local parent target
    parent="$(dirname "$PROJECT_ROOT")"
    target="$parent/Sam-Harness"
    if [[ ! -d "$target" ]]; then
      sam_info "git clone $CLONE_URL → $target"
      git clone "$CLONE_URL" "$target"
    fi
    PROJECT_ROOT="$target"
    export PROJECT_ROOT
    cd "$PROJECT_ROOT"
  fi
  local installer="$PROJECT_ROOT/scripts/install/install.sh"
  if [[ ! -f "$installer" ]]; then
    sam_fail "scripts/install/install.sh missing"; return 1
  fi
  local args=()
  if [[ "$NONINTERACTIVE" -eq 1 ]]; then args+=(--non-interactive); fi
  sam_info "→ bash $installer ${args[*]:-}"
  bash "$installer" "${args[@]+"${args[@]}"}"
  local ec=$?
  if [[ $ec -eq 0 ]]; then sam_ok "Install finished"; else sam_fail "install.sh exit $ec"; fi
  return $ec
}

action_setup_prereqs() {
  sam_step "Check Git / Node / pnpm / Ollama"
  if ! command -v git >/dev/null 2>&1; then
    sam_warn "Git missing"
    if command -v apt-get >/dev/null 2>&1; then
      sam_info "sudo apt-get install -y git"
      sudo apt-get install -y git || true
    elif command -v brew >/dev/null 2>&1; then
      brew install git || true
    fi
  fi
  if command -v git >/dev/null 2>&1; then sam_ok "$(git --version)"; else sam_fail "Git not in PATH"; fi

  if ! command -v node >/dev/null 2>&1; then
    sam_warn "Node missing — install Node 20+ LTS"
    if command -v brew >/dev/null 2>&1; then
      brew install node@22 || true
    fi
  fi
  if command -v node >/dev/null 2>&1; then sam_ok "Node $(node -v)"; else sam_fail "Node >= 20 required"; return 1; fi

  local pnpm_ver
  pnpm_ver="$(sam_pinned_pnpm)"
  sam_step "Corepack / pnpm@${pnpm_ver}"
  if command -v corepack >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 || true
    corepack prepare "pnpm@${pnpm_ver}" --activate >/dev/null 2>&1 || true
  fi
  if ! command -v pnpm >/dev/null 2>&1; then
    sam_warn "pnpm missing — npm install -g pnpm"
    npm install -g pnpm
  fi
  if command -v pnpm >/dev/null 2>&1; then sam_ok "pnpm $(pnpm -v)"; else sam_fail "pnpm missing"; return 1; fi

  if command -v ollama >/dev/null 2>&1; then
    sam_ok "Ollama CLI found"
  else
    sam_warn "Ollama not found — https://ollama.com/download"
  fi

  sam_step ".env + SAM_OUTPUT_HOME"
  sam_ensure_env
  sam_ensure_output_home

  if [[ ! -f "$PROJECT_ROOT/task.ts" && -f "$PROJECT_ROOT/templates/task.seed.ts" ]]; then
    cp "$PROJECT_ROOT/templates/task.seed.ts" "$PROJECT_ROOT/task.ts"
    sam_ok "Seeded task.ts"
  fi

  if [[ "$SAM_HARNESS_FAIL" -gt 0 ]]; then return 1; fi
  return 0
}

action_install_deps() {
  sam_step "pnpm install"
  if ! command -v pnpm >/dev/null 2>&1; then
    sam_fail "pnpm missing — run setup-prereqs first"
    return 1
  fi
  pnpm install
  local ec=$?
  if [[ $ec -eq 0 ]]; then sam_ok "Dependencies installed"; else sam_fail "pnpm install failed"; fi
  return $ec
}

action_update() {
  sam_step "Safe update of current branch"
  if ! command -v git >/dev/null 2>&1; then sam_fail "git missing"; return 1; fi

  local dirty
  dirty="$(git status --porcelain || true)"
  if [[ -n "$dirty" ]]; then
    sam_fail "Dirty working tree — refusing update. Commit or stash first."
    sam_info "$dirty"
    return 1
  fi
  sam_ok "Working tree clean"

  local branch
  branch="$(git rev-parse --abbrev-ref HEAD)"
  sam_info "branch=$branch"
  if [[ "$branch" == "HEAD" ]]; then
    sam_fail "detached HEAD — refusing pull"
    return 1
  fi

  sam_step "git pull --ff-only origin $branch"
  if ! git pull --ff-only "origin" "$branch"; then
    sam_warn "ff-only origin failed — trying git pull --ff-only"
    if ! git pull --ff-only; then
      sam_fail "git pull failed"
      return 1
    fi
  fi
  sam_ok "git pull OK"

  action_install_deps || return $?

  sam_step "pnpm run migrate"
  pnpm run migrate || { sam_fail "migrate failed"; return 1; }
  sam_ok "migrate OK"

  action_doctor
}

action_build_check() {
  if ! command -v pnpm >/dev/null 2>&1; then sam_fail "pnpm missing"; return 1; fi
  sam_step "pnpm run typecheck"
  pnpm run typecheck || { sam_fail "typecheck failed"; return 1; }
  sam_ok "typecheck"
  sam_step "pnpm test"
  pnpm test || { sam_fail "tests failed"; return 1; }
  sam_ok "tests"
  action_doctor
}

action_start_ui() {
  sam_step "Start Control Plane"
  if [[ ! -d "$PROJECT_ROOT/node_modules" ]]; then
    action_install_deps || return $?
  fi
  sam_ensure_env
  if [[ ! -f "$PROJECT_ROOT/task.ts" && -f "$PROJECT_ROOT/templates/task.seed.ts" ]]; then
    cp "$PROJECT_ROOT/templates/task.seed.ts" "$PROJECT_ROOT/task.ts"
  fi
  export CONTROL_PLANE_PORT="${CONTROL_PLANE_PORT:-8787}"
  sam_info "http://127.0.0.1:${CONTROL_PLANE_PORT}/"
  pnpm run ui
}

action_pull_models() {
  sam_step "Pull local models from config/team.json"
  if ! command -v ollama >/dev/null 2>&1; then
    sam_fail "ollama not in PATH"
    return 1
  fi
  local m failed=0
  local models=()
  while IFS= read -r m; do
    [[ -n "$m" ]] && models+=("$m")
  done < <(sam_team_local_models)
  sam_info "models: ${models[*]}"
  for m in "${models[@]}"; do
    [[ -z "$m" ]] && continue
    sam_info "ollama pull $m"
    if ollama pull "$m"; then
      sam_ok "$m"
    else
      sam_warn "pull failed: $m"
      failed=$((failed + 1))
    fi
  done
  if [[ $failed -gt 0 ]]; then return 1; fi
  return 0
}

action_doctor() {
  sam_step "pnpm run doctor"
  if ! command -v pnpm >/dev/null 2>&1; then sam_fail "pnpm missing"; return 1; fi
  if pnpm run doctor; then
    sam_ok "doctor PASS"
    return 0
  fi
  sam_fail "doctor reported issues"
  return 1
}

action_help() {
  sam_step "pnpm run help"
  if ! command -v pnpm >/dev/null 2>&1; then sam_fail "pnpm missing"; return 1; fi
  pnpm run help || true
  sam_info "Tools manager: Tools/sam-harness-manager.sh"
  return 0
}

action_backup() {
  sam_step "Backup DB + config + .env"
  sam_ensure_output_home
  local home stamp dest stage
  home="$(sam_output_home)"
  stamp="$(date +%Y%m%d-%H%M%S)"
  dest="${BACKUP_PATH:-$home/exports/sam-harness-backup-$stamp.zip}"
  mkdir -p "$(dirname "$dest")"
  stage="$(mktemp -d)"
  mkdir -p "$stage/config" "$stage/state"
  [[ -f "$PROJECT_ROOT/.env" ]] && cp "$PROJECT_ROOT/.env" "$stage/.env"
  if [[ -d "$PROJECT_ROOT/config" ]]; then
    cp -f "$PROJECT_ROOT/config/"*.json "$stage/config/" 2>/dev/null || true
  fi
  if [[ -d "$home/state" ]]; then
    # copy sqlite + json under state
    (cd "$home/state" && find . -type f \( -name '*.sqlite' -o -name '*.sqlite-wal' -o -name '*.sqlite-shm' -o -name '*.json' \) -print0 2>/dev/null |
      tar -cf - --null -T - 2>/dev/null | (cd "$stage/state" && tar -xf - 2>/dev/null)) || \
      cp -a "$home/state/." "$stage/state/" 2>/dev/null || true
  fi
  if command -v zip >/dev/null 2>&1; then
    (cd "$stage" && zip -qr "$dest" .)
  else
    (cd "$stage" && tar -czf "${dest%.zip}.tar.gz" .)
    dest="${dest%.zip}.tar.gz"
  fi
  rm -rf "$stage"
  sam_ok "Backup → $dest"
  return 0
}

action_restore() {
  sam_step "Restore from archive"
  local zip="${RESTORE_PATH:-${BACKUP_PATH:-}}"
  if [[ -z "$zip" && "$NONINTERACTIVE" -eq 0 ]]; then
    read -r -p "  Backup archive path: " zip || true
  fi
  if [[ -z "$zip" || ! -f "$zip" ]]; then
    sam_fail "Backup archive missing"
    return 1
  fi
  sam_ensure_output_home
  local home stage
  home="$(sam_output_home)"
  stage="$(mktemp -d)"
  case "$zip" in
    *.zip)
      if command -v unzip >/dev/null 2>&1; then unzip -q "$zip" -d "$stage"
      else sam_fail "unzip missing"; rm -rf "$stage"; return 1; fi
      ;;
    *.tar.gz|*.tgz) tar -xzf "$zip" -C "$stage" ;;
    *) sam_fail "unsupported archive"; rm -rf "$stage"; return 1 ;;
  esac
  [[ -f "$stage/.env" ]] && cp -f "$stage/.env" "$PROJECT_ROOT/.env" && sam_ok "Restored .env"
  if [[ -d "$stage/config" ]]; then
    mkdir -p "$PROJECT_ROOT/config"
    cp -f "$stage/config/"*.json "$PROJECT_ROOT/config/" 2>/dev/null || true
    sam_ok "Restored config/"
  fi
  if [[ -d "$stage/state" ]]; then
    mkdir -p "$home/state"
    cp -a "$stage/state/." "$home/state/"
    sam_ok "Restored state/"
  fi
  rm -rf "$stage"
  if command -v pnpm >/dev/null 2>&1; then
    sam_step "pnpm run migrate"
    pnpm run migrate || true
  fi
  sam_ok "Restore complete"
  return 0
}

action_repair() {
  sam_step "Repair installation"
  action_setup_prereqs || return $?
  action_install_deps || return $?
  sam_step "pnpm run migrate"
  pnpm run migrate || { sam_fail "migrate failed"; return 1; }
  sam_ok "migrate"
  action_doctor
}

action_uninstall() {
  sam_step "Uninstall via scripts/install/uninstall.sh"
  local u="$PROJECT_ROOT/scripts/install/uninstall.sh"
  if [[ ! -f "$u" ]]; then sam_fail "uninstall.sh missing"; return 1; fi
  local args=()
  if [[ "$NONINTERACTIVE" -eq 1 ]]; then args+=(--non-interactive); fi
  bash "$u" "${args[@]+"${args[@]}"}"
  local ec=$?
  if [[ $ec -eq 0 ]]; then sam_ok "uninstall finished"; else sam_fail "uninstall exit $ec"; fi
  return $ec
}

action_view_logs() {
  sam_step "View recent logs"
  local home logs_tools
  home="$(sam_output_home)/logs"
  logs_tools="$PROJECT_ROOT/Tools/logs"
  local files=()
  local f
  for f in "$home"/* "$logs_tools"/*; do
    [[ -f "$f" ]] && files+=("$f")
  done
  if [[ ${#files[@]} -eq 0 ]]; then
    sam_warn "No log files found"
    return 0
  fi
  # sort by mtime (portable; avoid mapfile for macOS bash 3.2)
  local latest="" sorted_line
  while IFS= read -r sorted_line; do
    [[ -z "$sorted_line" ]] && continue
    echo -e "  ${C_GRAY}- $sorted_line${C_RESET}"
    [[ -z "$latest" ]] && latest="$sorted_line"
  done < <(ls -1t "${files[@]}" 2>/dev/null | head -8)
  if [[ -n "$latest" ]]; then
    echo ""
    echo -e "  ${C_CYAN}---- tail: $latest ----${C_RESET}"
    tail -n 40 "$latest" | sed 's/^/  /'
    sam_ok "latest=$(basename "$latest")"
  fi
  return 0
}

action_cleanup_logs() {
  sam_step "Cleanup logs older than 14 days"
  local home="$PROJECT_ROOT"
  local removed=0
  local d
  for d in "$(sam_output_home)/logs" "$home/Tools/logs"; do
    [[ -d "$d" ]] || continue
    local f
    while IFS= read -r -d '' f; do
      rm -f "$f"
      removed=$((removed + 1))
    done < <(find "$d" -type f -mtime +14 -print0 2>/dev/null)
  done
  sam_ok "removed=$removed"
  return 0
}

action_health() {
  sam_step "Live health"
  local ec=0
  action_doctor || ec=$?
  local port="${CONTROL_PLANE_PORT:-8787}"
  local url="http://127.0.0.1:${port}/healthz"
  sam_info "GET $url"
  if command -v curl >/dev/null 2>&1; then
    if curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then
      sam_ok "/healthz OK"
    else
      sam_warn "Control Plane not reachable at $url (start-ui)"
    fi
  else
    sam_warn "curl missing — skipped /healthz"
  fi
  return $ec
}

invoke_action() {
  local id="$1"
  [[ -z "$id" || "$id" == "exit" ]] && return 0
  sam_init_logging "$id" >/dev/null
  sam_banner "$id"
  sam_info "cwd=$PROJECT_ROOT"
  local code=0
  case "$id" in
    install) action_install || code=$? ;;
    setup-prereqs) action_setup_prereqs || code=$? ;;
    install-deps) action_install_deps || code=$? ;;
    update) action_update || code=$? ;;
    build-check) action_build_check || code=$? ;;
    start-ui) action_start_ui || code=$? ;;
    pull-models) action_pull_models || code=$? ;;
    doctor) action_doctor || code=$? ;;
    help) action_help || code=$? ;;
    backup) action_backup || code=$? ;;
    restore) action_restore || code=$? ;;
    repair) action_repair || code=$? ;;
    uninstall) action_uninstall || code=$? ;;
    view-logs) action_view_logs || code=$? ;;
    cleanup-logs) action_cleanup_logs || code=$? ;;
    health) action_health || code=$? ;;
    *) sam_fail "Unknown action: $id"; code=2 ;;
  esac
  if [[ $code -ne 0 && $SAM_HARNESS_FAIL -eq 0 ]]; then
    sam_fail "Finished with failure (exit $code)"
  fi
  sam_summary "$code"
  return $code
}

# —— entry ——
if [[ -n "$ACTION" ]]; then
  id="$(echo "$ACTION" | tr '[:upper:]' '[:lower:]')"
  invoke_action "$id"
  exit $?
fi

while true; do
  show_menu
  prompt="  Choose a number"
  read -r -p "${prompt}: " choice || true
  id="$(resolve_choice "${choice:-}")"
  if [[ -z "$id" ]]; then
    echo -e "  ${C_YELLOW}Invalid choice${C_RESET}"
    continue
  fi
  if [[ "$id" == "exit" ]]; then
    echo -e "  ${C_GREEN}Goodbye.${C_RESET}"
    exit 0
  fi
  set +e
  invoke_action "$id"
  set -e
  if [[ "$NONINTERACTIVE" -eq 0 ]]; then
    echo ""
    read -r -p "  Press Enter to return to menu: " _ || true
  fi
done
