#!/usr/bin/env bash
# Sam-Harness one-click install (macOS / Linux) — idempotent.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_ROOT"

NONINTERACTIVE=0
REGISTER_STARTUP=0
SKIP_DEPS=0

usage() {
  cat <<EOF
Usage: $(basename "$0") [--non-interactive] [--register-startup] [--skip-deps]
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --non-interactive|-y) NONINTERACTIVE=1 ;;
    --register-startup) REGISTER_STARTUP=1 ;;
    --skip-deps) SKIP_DEPS=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1"; usage; exit 1 ;;
  esac
  shift
done

step() { printf '  [*] %s\n' "$*"; }
ok() { printf '  [OK] %s\n' "$*"; }
warn() { printf '  [!!] %s\n' "$*"; }
err() { printf '  [XX] %s\n' "$*" >&2; }

echo ""
echo "  ================================================================"
echo "   Sam-Harness  -  One-click install (macOS / Linux)"
echo "   Arabic-first · Control Plane · Hybrid Agency"
echo "  ================================================================"
echo "  Project: $PROJECT_ROOT"
echo ""

# —— Node ——
step "Checking Node.js…"
if ! command -v node >/dev/null 2>&1; then
  warn "Node missing — install Node 20+ LTS then re-run"
  if command -v brew >/dev/null 2>&1; then
    step "brew install node@22…"
    brew install node@22 || true
  fi
fi
if ! command -v node >/dev/null 2>&1; then
  err "Node.js >= 20 required"
  exit 1
fi
ok "Node $(node -v)"

# —— pnpm ——
step "Enabling Corepack / pnpm…"
if command -v corepack >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
  corepack prepare pnpm@11.23.0 --activate >/dev/null 2>&1 || true
fi
if ! command -v pnpm >/dev/null 2>&1; then
  warn "pnpm missing — npm install -g pnpm"
  npm install -g pnpm
fi
ok "pnpm $(pnpm -v)"

LOCALE=ar
NUMERALS=eastern
PORT=8787
if [[ "$NONINTERACTIVE" -eq 0 ]]; then
  read -r -p "  Locale [ar/en] (default ar): " L || true
  [[ -n "${L:-}" ]] && LOCALE="$(echo "$L" | tr '[:upper:]' '[:lower:]')"
  read -r -p "  Numerals [eastern/western] (default eastern): " N || true
  [[ -n "${N:-}" ]] && NUMERALS="$(echo "$N" | tr '[:upper:]' '[:lower:]')"
  read -r -p "  Control Plane port (default 8787): " P || true
  [[ -n "${P:-}" ]] && PORT="$P"
  if [[ "$REGISTER_STARTUP" -eq 0 ]]; then
    read -r -p "  Register user startup service? [y/N]: " S || true
    if [[ "${S:-}" =~ ^(y|yes|ن|نعم)$ ]]; then REGISTER_STARTUP=1; fi
  fi
fi

OUTPUT_HOME="${SAM_OUTPUT_HOME:-$HOME/Documents/Sam-Harness}"

set_env_key() {
  local file="$1" key="$2" value="$3"
  if grep -qE "^${key}=" "$file" 2>/dev/null; then
    # portable sed in-place
    if sed --version >/dev/null 2>&1; then
      sed -i -E "s|^${key}=.*|${key}=${value}|" "$file"
    else
      sed -i '' -E "s|^${key}=.*|${key}=${value}|" "$file"
    fi
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

step "Creating .env from .env.example (idempotent)…"
if [[ ! -f .env.example ]]; then
  err ".env.example missing"
  exit 1
fi
if [[ ! -f .env ]]; then
  cp .env.example .env
  ok "Created .env"
else
  ok ".env already exists (preserving values)"
fi
set_env_key .env SAM_LOCALE "$LOCALE"
set_env_key .env SAM_UI_LOCALE "$LOCALE"
set_env_key .env SAM_CONTENT_LOCALE "$LOCALE"
set_env_key .env SAM_NUMERALS "$NUMERALS"
set_env_key .env SAM_EGYPTIAN_FRIENDLY "1"
set_env_key .env CONTROL_PLANE_PORT "$PORT"
set_env_key .env SAM_OUTPUT_HOME "$OUTPUT_HOME"
ok "Locale=$LOCALE numerals=$NUMERALS port=$PORT"

step "Ensuring SAM_OUTPUT_HOME…"
mkdir -p "$OUTPUT_HOME"/{reports,documents,exports,runs,memory,temp,state}
ok "$OUTPUT_HOME"

if [[ ! -f task.ts && -f templates/task.seed.ts ]]; then
  cp templates/task.seed.ts task.ts
  ok "Seeded task.ts"
fi

if [[ "$SKIP_DEPS" -eq 0 ]]; then
  step "pnpm install…"
  pnpm install
  ok "Dependencies installed"
else
  warn "Skipped pnpm install"
fi

# —— optional startup ——
if [[ "$REGISTER_STARTUP" -eq 1 ]]; then
  step "Registering user startup…"
  if [[ "$(uname -s)" == "Darwin" ]]; then
    PLIST="$HOME/Library/LaunchAgents/com.upnexa.sam-harness.plist"
    mkdir -p "$(dirname "$PLIST")"
    cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.upnexa.sam-harness</string>
  <key>WorkingDirectory</key><string>${PROJECT_ROOT}</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(command -v pnpm)</string>
    <string>run</string>
    <string>ui</string>
  </array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
PLIST
    launchctl unload "$PLIST" 2>/dev/null || true
    launchctl load "$PLIST" 2>/dev/null || true
    ok "LaunchAgent $PLIST"
  else
    UNIT_DIR="$HOME/.config/systemd/user"
    mkdir -p "$UNIT_DIR"
    UNIT="$UNIT_DIR/sam-harness.service"
    cat >"$UNIT" <<UNIT
[Unit]
Description=Sam-Harness Control Plane
After=network.target

[Service]
Type=simple
WorkingDirectory=${PROJECT_ROOT}
ExecStart=$(command -v pnpm) run ui
Restart=on-failure

[Install]
WantedBy=default.target
UNIT
    if command -v systemctl >/dev/null 2>&1; then
      systemctl --user daemon-reload || true
      systemctl --user enable --now sam-harness.service || warn "systemctl enable failed (session bus?)"
      ok "systemd user unit sam-harness.service"
    else
      warn "systemctl not available — unit written to $UNIT"
    fi
  fi
fi

cat >.sam-harness-installed <<JSON
{
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "platform": "$(uname -s)",
  "outputHome": "${OUTPUT_HOME}",
  "locale": "${LOCALE}",
  "startup": ${REGISTER_STARTUP}
}
JSON
ok "Wrote install marker"

step "Running doctor…"
pnpm run doctor
DOCTOR=$?

echo ""
echo "  Install complete. Next:"
echo "    pnpm run ui"
echo "    pnpm run doctor"
echo "  Uninstall: bash scripts/install/uninstall.sh"
echo ""
exit "$DOCTOR"
