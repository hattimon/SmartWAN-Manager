#!/usr/bin/env sh
set -eu

START_PORT="${SMARTWAN_PANEL_PORT:-8888}"
PORT="$START_PORT"

port_busy() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn | awk '{print $4}' | grep -Eq "[:.]$1$"
    return $?
  fi
  if command -v netstat >/dev/null 2>&1; then
    netstat -ltn | awk '{print $4}' | grep -Eq "[:.]$1$"
    return $?
  fi
  return 1
}

while port_busy "$PORT"; do
  PORT=$((PORT + 1))
done

export SMARTWAN_PANEL_PORT="$PORT"
echo "Starting SmartWAN Manager on host port $SMARTWAN_PANEL_PORT"
docker compose up -d --build
echo "Open: http://$(hostname -I 2>/dev/null | awk '{print $1}'):$SMARTWAN_PANEL_PORT"
