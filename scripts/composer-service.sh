#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="${COMPOSER_SERVICE_NAME:-composer}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
APP_DIR="${COMPOSER_APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd -P)}"
CONFIG_DIR="${COMPOSER_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/composer}"
DATA_DIR="${COMPOSER_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/composer}"
SYSTEMD_USER_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
ENV_PATH="$CONFIG_DIR/composer.env"
UNIT_PATH="$SYSTEMD_USER_DIR/$SERVICE_NAME.service"
UNIT_TEMPLATE="$APP_DIR/ops/systemd/composer.service.template"
ENV_TEMPLATE="$APP_DIR/ops/composer.env.example"
PORT="${COMPOSER_PORT:-42456}"
HOSTNAME_VALUE="${COMPOSER_HOSTNAME:-127.0.0.1}"

if [[ -z "${XDG_RUNTIME_DIR:-}" && -d "/run/user/$(id -u)" ]]; then
  export XDG_RUNTIME_DIR="/run/user/$(id -u)"
fi

usage() {
  cat <<'EOF'
Usage: scripts/composer-service.sh <command>

Commands:
  install     Install dependencies, build the app, install the user service, enable and start it
  render      Render the user systemd unit without starting the service
  build       Install dependencies with the lockfile and build the app
  start       Start the user service
  stop        Stop the user service
  restart     Restart the user service
  status      Show user service status
  logs        Follow user service logs
  config      Print local config, data, env, and unit paths
  doctor      Check required local tools and files
  uninstall   Disable and remove the user service unit; leaves config and data intact
EOF
}

log() {
  printf '[composer-service] %s\n' "$*"
}

fail() {
  printf '[composer-service] ERROR: %s\n' "$*" >&2
  exit 1
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

pnpm_bin() {
  command -v pnpm || true
}

node_bin() {
  command -v node || true
}

node_bin_dir() {
  local node
  node="$(node_bin)"
  [[ -n "$node" ]] || fail "Missing node on PATH. Load your Node environment before installing the service."
  dirname "$node"
}

random_secret() {
  node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))'
}

ensure_tools() {
  need_command systemctl
  need_command node
  need_command pnpm
}

ensure_user_systemd() {
  systemctl --user status >/dev/null 2>&1 || fail "systemctl --user is unavailable. Ensure the user systemd manager is running."
}

ensure_env_assignment() {
  local key="$1"
  local value="$2"

  if ! grep -Eq "^${key}=.+$" "$ENV_PATH"; then
    printf '%s=%s\n' "$key" "$value" >>"$ENV_PATH"
  fi
}

ensure_env_file() {
  mkdir -p "$CONFIG_DIR" "$DATA_DIR"
  chmod 700 "$CONFIG_DIR" "$DATA_DIR"

  if [[ ! -f "$ENV_PATH" ]]; then
    log "Creating $ENV_PATH"
    install -m 600 /dev/null "$ENV_PATH"
    cat >"$ENV_PATH" <<EOF
# Composer local service config.
# This file is read by the composer user systemd service.
NODE_ENV=production
NEXT_TELEMETRY_DISABLED=1
PORT=$PORT
COMPOSER_HOSTNAME=$HOSTNAME_VALUE
CONNECTOR_STORE_PATH=$DATA_DIR/connectors.json
COMPOSER_CONFIG_DIR=$CONFIG_DIR
COMPOSER_DATA_DIR=$DATA_DIR
CONNECTOR_ENCRYPTION_KEY=$(random_secret)
EOF
    return
  fi

  chmod 600 "$ENV_PATH"

  ensure_env_assignment NODE_ENV production
  ensure_env_assignment NEXT_TELEMETRY_DISABLED 1
  ensure_env_assignment PORT "$PORT"
  ensure_env_assignment COMPOSER_HOSTNAME "$HOSTNAME_VALUE"
  ensure_env_assignment CONNECTOR_STORE_PATH "$DATA_DIR/connectors.json"
  ensure_env_assignment COMPOSER_CONFIG_DIR "$CONFIG_DIR"
  ensure_env_assignment COMPOSER_DATA_DIR "$DATA_DIR"
  ensure_env_assignment CONNECTOR_ENCRYPTION_KEY "$(random_secret)"
}

render_unit_text() {
  local pnpm node_dir unit
  pnpm="$(pnpm_bin)"
  [[ -n "$pnpm" ]] || fail "Missing pnpm on PATH."
  node_dir="$(node_bin_dir)"
  [[ -f "$UNIT_TEMPLATE" ]] || fail "Missing unit template: $UNIT_TEMPLATE"

  unit="$(<"$UNIT_TEMPLATE")"
  unit="${unit//__APP_DIR__/$APP_DIR}"
  unit="${unit//__CONFIG_DIR__/$CONFIG_DIR}"
  unit="${unit//__DATA_DIR__/$DATA_DIR}"
  unit="${unit//__ENV_PATH__/$ENV_PATH}"
  unit="${unit//__NODE_BIN_DIR__/$node_dir}"
  unit="${unit//__PNPM_BIN__/$pnpm}"
  unit="${unit//__SERVICE_NAME__/$SERVICE_NAME}"
  printf '%s\n' "$unit"
}

render_unit() {
  ensure_tools
  ensure_env_file
  mkdir -p "$SYSTEMD_USER_DIR"
  render_unit_text >"$UNIT_PATH"
  log "Rendered $UNIT_PATH"
}

build_app() {
  ensure_tools
  cd "$APP_DIR"
  pnpm install --frozen-lockfile
  pnpm build
}

install_service() {
  ensure_tools
  ensure_user_systemd
  build_app
  render_unit
  systemctl --user daemon-reload
  systemctl --user enable --now "$SERVICE_NAME.service"
  log "Installed and started $SERVICE_NAME.service"
  log "Config: $ENV_PATH"
  log "Data: $DATA_DIR"
}

show_config() {
  cat <<EOF
service: $SERVICE_NAME.service
app_dir: $APP_DIR
config_dir: $CONFIG_DIR
data_dir: $DATA_DIR
env_file: $ENV_PATH
unit_file: $UNIT_PATH
env_template: $ENV_TEMPLATE
unit_template: $UNIT_TEMPLATE
EOF
}

doctor() {
  ensure_tools
  ensure_user_systemd
  [[ -f "$APP_DIR/package.json" ]] || fail "Missing $APP_DIR/package.json"
  [[ -f "$UNIT_TEMPLATE" ]] || fail "Missing $UNIT_TEMPLATE"
  [[ -f "$ENV_TEMPLATE" ]] || fail "Missing $ENV_TEMPLATE"
  log "pnpm: $(pnpm_bin)"
  log "node: $(node_bin)"
  log "systemd user manager: ok"
  show_config
}

case "${1:-}" in
  install)
    install_service
    ;;
  render)
    render_unit
    ;;
  build)
    build_app
    ;;
  start)
    systemctl --user start "$SERVICE_NAME.service"
    ;;
  stop)
    systemctl --user stop "$SERVICE_NAME.service"
    ;;
  restart)
    systemctl --user restart "$SERVICE_NAME.service"
    ;;
  status)
    systemctl --user status "$SERVICE_NAME.service" --no-pager
    ;;
  logs)
    journalctl --user-unit "$SERVICE_NAME.service" -n 200 -f
    ;;
  config)
    show_config
    ;;
  doctor)
    doctor
    ;;
  uninstall)
    systemctl --user disable --now "$SERVICE_NAME.service" || true
    rm -f "$UNIT_PATH"
    systemctl --user daemon-reload
    log "Removed $UNIT_PATH. Config and data were left intact."
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    usage >&2
    fail "Unknown command: $1"
    ;;
esac
