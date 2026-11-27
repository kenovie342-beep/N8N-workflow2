#!/usr/bin/env bash
# Saves the workflows as they are in n8n right now (including edits made in the browser) to exports/. Credential secrets are never exported.
set -euo pipefail
cd "$(dirname "$0")/.."; set -a; . ./.env; set +a; export N8N_USER_FOLDER="$(cd "${N8N_USER_FOLDER:-./data}" && pwd)"
mkdir -p exports; "${N8N_BIN:-$PWD/runtime/node_modules/.bin/n8n}" export:workflow --all --separate --output=exports/ 2>&1 | grep -iE "success|error" || true
