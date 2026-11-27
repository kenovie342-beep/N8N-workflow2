#!/usr/bin/env bash
# One-time setup. Installs the n8n release that matches the pinned source tag (n8n-source/) and writes .env.
# Usage: scripts/setup.sh            (OWNER_EMAIL / OWNER_PASSWORD env vars optionally pre-create the login)
set -euo pipefail
cd "$(dirname "$0")/.."
VER="$(cat .n8n-version)"
command -v node >/dev/null || { echo "Node.js is required (Termux: pkg install nodejs-lts)"; exit 1; }
if [ -z "${N8N_BIN:-}" ]; then
  mkdir -p runtime && cd runtime
  [ -f package.json ] || npm init -y >/dev/null
  if [ ! -x node_modules/.bin/n8n ] || ! node_modules/.bin/n8n --version 2>/dev/null | grep -q "$VER"; then echo "Installing n8n@$VER (this takes several minutes)..."; npm install "n8n@$VER" --no-audit --no-fund; fi
  cd ..
fi
if [ ! -f .env ]; then
  cp .env.example .env
  KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
  sed -i "s|^N8N_ENCRYPTION_KEY=.*|N8N_ENCRYPTION_KEY=$KEY|" .env
  chmod 600 .env; echo "Created .env with a fresh encryption key (BACK THIS UP: without it saved credentials cannot be decrypted)."
fi
if [ -n "${OWNER_EMAIL:-}" ] && [ -n "${OWNER_PASSWORD:-}" ] && ! grep -q '^N8N_INSTANCE_OWNER_PASSWORD_HASH=' .env; then
  HASH="$(NODE_PATH="$PWD/runtime/node_modules" node -e "console.log(require('bcryptjs').hashSync(process.env.OWNER_PASSWORD,10))")"
  { echo "N8N_INSTANCE_OWNER_MANAGED_BY_ENV=true"; echo "N8N_INSTANCE_OWNER_EMAIL=$OWNER_EMAIL"; echo "N8N_INSTANCE_OWNER_FIRST_NAME=Owner"; echo "N8N_INSTANCE_OWNER_LAST_NAME=Admin"; echo "N8N_INSTANCE_OWNER_PASSWORD_HASH='$HASH'"; } >> .env
  echo "Owner login pre-created for $OWNER_EMAIL"
fi
mkdir -p data logs; echo "Setup done. Next: scripts/start-n8n.sh --background   then   scripts/import-workflows.sh"
