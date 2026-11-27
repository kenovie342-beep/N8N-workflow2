#!/usr/bin/env bash
# Builds and imports the social workflows into n8n (same database the browser UI uses).
# SAFE BY DEFAULT: workflows that already exist are skipped, so your credential assignments are never overwritten. Use --force to overwrite.
# Run with n8n STOPPED (scripts/start-n8n.sh stop), then start it again.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
export N8N_USER_FOLDER="$(cd "${N8N_USER_FOLDER:-./data}" && pwd)" N8N_DIAGNOSTICS_ENABLED=false
N8N="${N8N_BIN:-$PWD/runtime/node_modules/.bin/n8n}"; FORCE="${1:-}"
node scripts/build-workflows.js
EXISTING="$("$N8N" list:workflow 2>/dev/null || true)"
for f in workflows/*.json; do
  ID="$(node -e "console.log(require('./$f').id)")"; NAME="$(node -e "console.log(require('./$f').name)")"
  if echo "$EXISTING" | grep -q "^$ID|" && [ "$FORCE" != "--force" ]; then echo "skip (exists): $NAME"; continue; fi
  "$N8N" import:workflow --input="$f" 2>&1 | grep -iE "success|error" | sed "s|^|$NAME: |"
  # platform publishers must be published so the master can call them; the master stays inactive until you add Google credentials
  case "$f" in workflows/00-*) ;; *) "$N8N" publish:workflow --id="$ID" >/dev/null 2>&1 && echo "  published" || echo "  !! could not publish $NAME - open it in n8n and click Publish";; esac
done
echo "Done. Start n8n, then: open http://localhost:${N8N_PORT:-5678} -> set credentials (see BLUEPRINT.md), edit the Config node in 'SM 00 Master', Publish it."
