#!/usr/bin/env bash
# Usage: scripts/start-n8n.sh [--background] | stop | status
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Run scripts/setup.sh first"; exit 1; }
set -a; . ./.env; set +a
export N8N_USER_FOLDER="$(cd "${N8N_USER_FOLDER:-./data}" 2>/dev/null && pwd || (mkdir -p "${N8N_USER_FOLDER:-./data}" && cd "${N8N_USER_FOLDER:-./data}" && pwd))"
export N8N_LISTEN_ADDRESS="${N8N_LISTEN_ADDRESS:-127.0.0.1}" N8N_DIAGNOSTICS_ENABLED=false N8N_VERSION_NOTIFICATIONS_ENABLED=false N8N_RUNNERS_ENABLED=true N8N_SECURE_COOKIE="${N8N_SECURE_COOKIE:-false}"
N8N="${N8N_BIN:-$PWD/runtime/node_modules/.bin/n8n}"; PID=n8n.pid
case "${1:-}" in
  stop) [ -f $PID ] && kill "$(cat $PID)" 2>/dev/null && rm -f $PID && echo stopped || echo "not running"; exit 0;;
  status) [ -f $PID ] && kill -0 "$(cat $PID)" 2>/dev/null && echo "running (pid $(cat $PID)) at http://localhost:${N8N_PORT:-5678}" || echo "not running"; exit 0;;
esac
command -v termux-wake-lock >/dev/null && termux-wake-lock || true   # keep Termux alive with the screen off
if [ "${1:-}" = "--background" ]; then mkdir -p logs; nohup "$N8N" start > logs/n8n.log 2>&1 & echo $! > $PID; echo "n8n starting in background (pid $!), log: logs/n8n.log -> http://localhost:${N8N_PORT:-5678}"; else exec "$N8N" start; fi
