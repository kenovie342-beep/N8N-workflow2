# PROJECT_MEMORY

## Done and tested (against real n8n 2.35.7, mock platform APIs, dummy per-account credentials)
* Setup/start/import scripts run on a fresh instance: owner login, UI backend lists all workflows, publishers publish with no credentials attached, re-import never overwrites (verified in the Linux sandbox).
* Core pipeline: due/status gating, ISO + timezone + Sheets-serial dates, `ALL`, disabled/unknown accounts, per-account/per-platform overrides, duplicate prevention via Log, retry/backoff/partial_error, unsupported-format refusals, clear errors for unassigned credential / bad slot / expired token. 11 unit tests + 46 e2e checks.
* Request construction + routing + per-account credential injection verified for all 8 HTTP platforms (Facebook, Instagram, Threads, Reddit, X, Pinterest, Tumblr, TikTok); X media download→upload→tweet; YouTube/LinkedIn download stage and clean failure path.

## NOT verified
* **Any live platform API call** (no credentials here). Request shapes follow the official docs from memory; expect small fixes on first live runs.
* **Google Sheets nodes** (read / update / append) — need a Google credential; column handling is by header name (`autoMapInputData`, match on `id`). Only the logic around them is tested.
* **YouTube + LinkedIn native-node success path** (only the failure path ran).
* **Termux on a phone**: nothing here ran on Android. Fallback = proot-distro Debian.
* Master schedule left **inactive** until you set the Sheets credentials + `spreadsheet_id`.

## Known limits / TODO
* No: Instagram/Facebook carousels, multi-image posts, Reddit image/video, X video (chunked upload), LinkedIn video, Pinterest video, text-only on Instagram/TikTok (API doesn't allow).
* Threads/TikTok tokens don't auto-refresh (generic credential); refresh manually before expiry.
* Instagram/Threads media still “processing” after one 30 s wait ⇒ retried later with a new container (safe, slower).
* 5 account slots per platform (raise with `SM_SLOTS`).
* A crashed run leaves rows in `publishing` (deliberate, avoids double posts): set them back to `ready` after checking the platform.
* Idea: Sheets “Config” tab instead of the Config node; native FB scheduling.
