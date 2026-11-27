# AGENTS.md — instructions for OpenCode and other coding agents

Goal: multi-account social publishing on **stock n8n**, content from Google Sheets. Read `BLUEPRINT.md` first. Do not build dashboards, services or a second workflow engine; use n8n.

## Commands (repo root)
```
git clone --recurse-submodules <repo>      # n8n-source/ = official n8n @ n8n@2.35.7 (read-only reference)
scripts/setup.sh                            # installs matching n8n into runtime/, creates .env (encryption key). OWNER_EMAIL/OWNER_PASSWORD env => login pre-created
scripts/start-n8n.sh --background | stop | status      # UI: http://localhost:5678 (log: logs/n8n.log)
scripts/import-workflows.sh [--force]       # run with n8n STOPPED. Skips existing workflows (protects credential assignments)
scripts/export-workflows.sh                 # saves UI edits to exports/ (no secrets)
npm test                                    # unit tests (fast)
npm run test:e2e                            # real n8n + mock platform APIs; N8N_BIN=/path/to/n8n (needs bcryptjs next to it)
```
## Talking to the running n8n (localhost only)
* Browser UI and you share one DB (`data/`). CLI: `runtime/node_modules/.bin/n8n list:workflow | export:workflow | import:workflow | publish:workflow` (stop n8n first for writes; restart to apply).
* REST/Public API: create an API key in the UI (Settings → n8n API) and call `http://localhost:5678/api/v1/workflows|executions` with header `X-N8N-API-KEY`. Use it to read failed executions (`/executions?status=error&includeData=true`).
* n8n runs its own schedules; you are never needed for publishing to keep working.

## Where things live / how to change them
* Logic: `lib/sm-core.js` (Sheet rows → jobs → row updates), `lib/platforms.js` (one request builder per platform stage). **Edit these, then `npm run build`** — `workflows/*.json` are generated; don't hand-edit them (UI edits → `export-workflows.sh`).
* Add a platform: add a spec to `lib/platforms.js` (`kinds` = HTTP/native stages, `stages` = builders, last one finalizes), add its name to `PLATFORMS` in `lib/sm-core.js`, add routing key (`PWF`) is automatic, add mock routes + cases to `test/e2e/e2e.js`, run both test suites.
* Add an account: credential in UI → free slot node → row in Accounts sheet. No code.
## Rules
* Never rewrite/generate user content (captions, hashtags, media). Sheets decide; we execute.
* Never commit `.env`, `data/`, tokens. Never print credentials.
* Never auto-retry the request that creates a post after a timeout/5xx (duplicate risk) — see `commit:true` in `platforms.js`.
* Don't claim a platform works live unless tested live. The e2e suite proves request shapes, routing, credentials-per-account and error handling against a mock; real APIs need real credentials/approvals.
* The test pipeline (`SM TEST Pipeline`) is test-only: keep it out of production instances.
