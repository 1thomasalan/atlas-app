#!/bin/zsh

APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-4173}"
URL="http://127.0.0.1:${PORT}"
LOG_FILE="/tmp/atlas-app-${UID}.log"
SERVICE="com.atlas.app"
NODE="$(command -v node)"

dashboard_ready() {
  curl --silent --fail "$URL/api/dashboard" >/dev/null 2>&1
}

if ! dashboard_ready; then
  launchctl remove "$SERVICE" >/dev/null 2>&1
  launchctl submit -l "$SERVICE" -o "$LOG_FILE" -e "$LOG_FILE" -- \
    "$NODE" "$APP_ROOT/server.js"

  for attempt in {1..50}; do
    dashboard_ready && break
    sleep 0.1
  done
fi

if ! dashboard_ready; then
  echo "Atlas Dashboard could not start."
  echo "See $LOG_FILE for details."
  read "?Press Return to close."
  exit 1
fi

open "$URL"
