#!/usr/bin/env bash

# gunicornctl.sh - Manage Gunicorn service for Salon POS FastAPI backend
#
# Usage examples (run as root/sudo on the server):
#   ./gunicornctl.sh install            # write systemd unit and enable service
#   ./gunicornctl.sh start              # start service
#   ./gunicornctl.sh stop               # stop service
#   ./gunicornctl.sh restart            # restart service
#   ./gunicornctl.sh reload             # graceful reload (HUP)
#   ./gunicornctl.sh status             # status
#   ./gunicornctl.sh logs               # show logs (journald)
#   ./gunicornctl.sh tail               # follow logs
#   ./gunicornctl.sh enable|disable     # auto-start on boot
#   ./gunicornctl.sh uninstall          # stop/disable/remove unit (keeps code)
#
# Configuration: Override via environment variables or edit defaults below.

set -euo pipefail

# --- Defaults (override with env) ---
SERVICE_NAME=${SERVICE_NAME:-salon-pos-backend}
APP_DIR=${APP_DIR:-/www/wwwroot/hub.techiesmagnifier.com/salon_fastapi}
VENV_BIN=${VENV_BIN:-"$APP_DIR/venv/bin"}
APP_MODULE=${APP_MODULE:-fastapi_backend.main}
APP_CALLABLE=${APP_CALLABLE:-app}
BIND_ADDR=${BIND_ADDR:-127.0.0.1}
BIND_PORT=${BIND_PORT:-8000}
WORKERS=${WORKERS:-2}
TIMEOUT=${TIMEOUT:-120}
KEEP_ALIVE=${KEEP_ALIVE:-2}
MAX_REQUESTS=${MAX_REQUESTS:-1000}
MAX_REQUESTS_JITTER=${MAX_REQUESTS_JITTER:-50}
SVC_USER=${SVC_USER:-www-data}
SVC_GROUP=${SVC_GROUP:-www-data}
ENV_FILE=${ENV_FILE:-"$APP_DIR/fastapi_backend/.env"}
UNIT_PATH=/etc/systemd/system/"$SERVICE_NAME".service

GUNICORN_BIN="$VENV_BIN/gunicorn"

info() { echo -e "\033[1;32m[INFO]\033[0m $*"; }
warn() { echo -e "\033[1;33m[WARN]\033[0m $*"; }
err()  { echo -e "\033[1;31m[ERR ]\033[0m $*" 1>&2; }

require_root() {
  if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
    err "Please run as root (use sudo)."
    exit 1
  fi
}

check_systemd() {
  if ! command -v systemctl >/dev/null 2>&1; then
    err "systemctl not found. This script requires systemd."
    exit 1
  fi
}

write_unit() {
  require_root
  check_systemd

  if [[ ! -x "$GUNICORN_BIN" ]]; then
    warn "Gunicorn not found at $GUNICORN_BIN. Ensure your venv is created and gunicorn installed."
  fi

  if [[ ! -d "$APP_DIR" ]]; then
    err "APP_DIR does not exist: $APP_DIR"
    exit 1
  fi

  cat > "$UNIT_PATH" <<EOF
[Unit]
Description=Salon POS FastAPI Backend (Gunicorn)
After=network.target

[Service]
Type=notify
User=$SVC_USER
Group=$SVC_GROUP
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$GUNICORN_BIN $APP_MODULE:$APP_CALLABLE \
  --bind $BIND_ADDR:$BIND_PORT \
  --workers $WORKERS \
  --worker-class uvicorn.workers.UvicornWorker \
  --timeout $TIMEOUT \
  --keep-alive $KEEP_ALIVE \
  --max-requests $MAX_REQUESTS \
  --max-requests-jitter $MAX_REQUESTS_JITTER
ExecReload=/bin/kill -s HUP \$MAINPID
Restart=always
RestartSec=10 

[Install]
WantedBy=multi-user.target
EOF

  info "Wrote unit: $UNIT_PATH"
  systemctl daemon-reload
}

do_install() {
  write_unit
  systemctl enable "$SERVICE_NAME"
  info "Enabled service $SERVICE_NAME"
}

do_uninstall() {
  require_root
  check_systemd
  systemctl stop "$SERVICE_NAME" || true
  systemctl disable "$SERVICE_NAME" || true
  rm -f "$UNIT_PATH"
  systemctl daemon-reload
  info "Removed unit $UNIT_PATH"
}

do_start()   { require_root; systemctl start   "$SERVICE_NAME"; }
do_stop()    { require_root; systemctl stop    "$SERVICE_NAME"; }
do_restart() { require_root; systemctl restart "$SERVICE_NAME"; }
do_reload()  { require_root; systemctl reload  "$SERVICE_NAME" || systemctl kill -s HUP "$SERVICE_NAME"; }
do_status()  { systemctl status "$SERVICE_NAME" --no-pager; }
do_enable()  { require_root; systemctl enable  "$SERVICE_NAME"; }
do_disable() { require_root; systemctl disable "$SERVICE_NAME"; }
do_logs()    { journalctl -u "$SERVICE_NAME" --no-pager -n 200; }
do_tail()    { journalctl -u "$SERVICE_NAME" -f; }

usage() {
  cat <<USAGE
gunicornctl.sh - Manage Gunicorn systemd service

Commands:
  install     Write unit file and enable service (does not start)
  uninstall   Stop/disable and remove unit file
  start       Start the service
  stop        Stop the service
  restart     Restart the service
  reload      Graceful reload (HUP)
  status      Show service status
  logs        Show recent logs (journald)
  tail        Follow logs
  enable      Enable auto-start on boot
  disable     Disable auto-start

Environment overrides:
  SERVICE_NAME, APP_DIR, VENV_BIN, APP_MODULE, APP_CALLABLE, BIND_ADDR, BIND_PORT,
  WORKERS, TIMEOUT, KEEP_ALIVE, MAX_REQUESTS, MAX_REQUESTS_JITTER, SVC_USER, SVC_GROUP, ENV_FILE

Examples:
  sudo SERVICE_NAME=salon-pos-backend \
       APP_DIR=/www/wwwroot/hub.techiesmagnifier.com/salon_fastapi \
       VENV_BIN=/www/wwwroot/hub.techiesmagnifier.com/salon_fastapi/venv/bin \
       ./gunicornctl.sh install

  sudo ./gunicornctl.sh start
  sudo ./gunicornctl.sh status
USAGE
}

cmd=${1:-}
case "$cmd" in
  install)   do_install ;;
  uninstall) do_uninstall ;;
  start)     do_start ;;
  stop)      do_stop ;;
  restart)   do_restart ;;
  reload)    do_reload ;;
  status)    do_status ;;
  logs)      do_logs ;;
  tail)      do_tail ;;
  enable)    do_enable ;;
  disable)   do_disable ;;
  -h|--help|help|"") usage ;;
  *) err "Unknown command: $cmd"; usage; exit 1 ;;
esac

exit 0
