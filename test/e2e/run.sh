#!/usr/bin/env bash
# Throwaway real n8n + mock platform APIs. Usage: N8N_BIN=/path/to/n8n test/e2e/run.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; N8N="${N8N_BIN:-n8n}"; PORT="${E2E_PORT:-5711}"
T="$(mktemp -d)"; export N8N_USER_FOLDER="$T/n8n" HOME="$T/home"; mkdir -p "$HOME"
export N8N_DIAGNOSTICS_ENABLED=false N8N_VERSION_NOTIFICATIONS_ENABLED=false N8N_PERSONALIZATION_ENABLED=false N8N_PORT=$PORT N8N_RUNNERS_BROKER_PORT=$((PORT+1)) N8N_LISTEN_ADDRESS=127.0.0.1
NM="$(cd "$(dirname "$N8N")/.." && pwd)"
export N8N_INSTANCE_OWNER_MANAGED_BY_ENV=true N8N_INSTANCE_OWNER_EMAIL=e2e@example.com N8N_INSTANCE_OWNER_FIRST_NAME=E2E N8N_INSTANCE_OWNER_LAST_NAME=Test
export N8N_INSTANCE_OWNER_PASSWORD_HASH="$(NODE_PATH="$NM" node -e "console.log(require('bcryptjs').hashSync('E2eTest12345',10))")"
wait_up() { for i in $(seq 1 60); do sleep 2; curl -s -o /dev/null -m 3 "localhost:$PORT/healthz" && break; done; sleep 3; }
"$N8N" start > "$T/n8n0.log" 2>&1 & S0=$!; wait_up; kill $S0; wait $S0 2>/dev/null; sleep 2
node "$ROOT/test/e2e/prepare.js" "$ROOT" "$T/wf" || exit 3
"$N8N" import:credentials --input="$T/wf/creds.json" 2>&1 | grep -iE "success|error"
for f in "$T"/wf/[0-9]*-publisher.json "$T/wf/test-pipeline.json" "$T/wf/00-master.json"; do "$N8N" import:workflow --input="$f" 2>&1 | grep -iE "error|fail"; done
for id in smwf000000000002 $(seq -f "smwf%012g" 10 19); do "$N8N" publish:workflow --id=$id 2>&1 | grep -iE "error|fail"; done
"$N8N" start > "$T/n8n.log" 2>&1 & SRV=$!; trap 'kill $SRV 2>/dev/null' EXIT; wait_up
for i in $(seq 1 30); do curl -s -o /dev/null -m 3 -X POST "localhost:$PORT/webhook/sm-test-run" -H 'Content-Type: application/json' -d '{}' -w '%{http_code}' | grep -qv 404 && break; sleep 2; done
E2E_BASE="http://127.0.0.1:$PORT/webhook" node "$ROOT/test/e2e/e2e.js"; RC=$?
[ $RC -ne 0 ] && { echo "--- n8n log tail ---"; grep -vE "confluence|Strapi|getaddrinfo|MCP registry|^\s+at " "$T/n8n.log" | tail -25; }
exit $RC
