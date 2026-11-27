# n8n Social Automation
Stock n8n + generated workflows: Google Sheets → 10 platforms, many accounts each. See `BLUEPRINT.md` (design, sheet format, approvals), `AGENTS.md` (OpenCode), `PROJECT_MEMORY.md` (status).
```
git clone --recurse-submodules <this repo> && cd <repo>
scripts/setup.sh && scripts/start-n8n.sh --background   # open http://localhost:5678, create the owner (or set OWNER_EMAIL/OWNER_PASSWORD before setup)
scripts/start-n8n.sh stop && scripts/import-workflows.sh && scripts/start-n8n.sh --background
```
