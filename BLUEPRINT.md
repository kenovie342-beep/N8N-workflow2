# Blueprint

**One stock n8n (2.35.7) + generated workflows.** n8n's frontend, engine, credentials and database are untouched; the official source is pinned as a git submodule (`n8n-source/`, tag `n8n@2.35.7`) so OpenCode can read it. The runnable build is the matching npm release (`scripts/setup.sh`): building the monorepo on a phone is impractical and the release is the same code.

```
Google Sheet (Content | Accounts | Log)
        │  every 5 min (Schedule) or Manual
SM 00 Master ── Config ► Read x3 ► Build jobs ► lock rows (status=publishing) ► Run platform ► Finalize ► update rows + append Log
                                                                   │ (Execute Workflow, one job at a time)
        ┌────────┬─────────┬─────────┬────────┬───┴──┬──────────┬─────────┬──────────┬────────┬────────┐
     Reddit  Facebook  Instagram  YouTube     X   LinkedIn   Threads  Pinterest   Tumblr   TikTok     (SM 01..10)
```
All decision logic is plain tested JS in `lib/` (`sm-core.js` rows→jobs→row updates; `platforms.js` one request-builder per platform stage). `scripts/build-workflows.js` embeds it into Code nodes and writes `workflows/*.json`. Everything else is stock nodes: Google Sheets, Schedule, Switch, Wait, HTTP Request (+ native YouTube / LinkedIn nodes), Execute Workflow.

## Google Sheet (templates in `templates/*.csv`; headers are case-insensitive)
**Content** — one row per post. `id` (unique, required), `status` (**ready**/scheduled/pending/retry are processed; blank/draft/paused are ignored), `publish_at` (`2026-12-01 09:00` in the Config timezone, or ISO with offset; blank = now), `platforms` (`facebook;instagram` or `ALL`), `accounts` (`fb_main,ig_brand`, `ALL` or blank = every enabled account of those platforms), `format` (auto|text|image|video|link; auto uses the media_urls extension and **never guesses** – ambiguous URLs need `format`), `title`, `caption`, `description`, `hashtags`, `media_urls` (public URLs, comma/semicolon separated), `link_url`, plus platform params (`subreddit`, `privacy`, `tags`, `board_id`, `blog`, …).
Per-platform / per-account overrides work for **any** column: `caption_instagram`, `caption@fb_main`. Precedence: `field@account` > `field_platform` > `field` > the Accounts-sheet default.
Written back by n8n: `status` (publishing → published | retry | partial_error | error), `attempts`, `next_attempt_at`, `results`, `last_error`, `published_urls`, `updated_at`. **Create these columns** (they are in the template).
Text sent = your `caption` + blank line + your `hashtags` (nothing rewritten, nothing invented; `append_hashtags=false` in Config turns the append off).

**Accounts** — `account_key` (unique), `platform`, `slot` (1–5), `enabled`, plus per-account defaults (`page_id`, `ig_user_id`, `subreddit`, `person_id`, `board_id`, `blog`, …).
**Log** — one line per attempt (`dedupe_key`=`rowid|platform|account`, status success/failed, URL, error).

## Multiple accounts = credential slots
n8n binds a credential to a node, so each publisher workflow has **5 pre-wired slot nodes** (“Slot 1 (Facebook account 1)” …), one credential each. Add an account: create the credential in n8n (normal UI), pick it on the next free slot node, add one Accounts row with that `slot`. No workflow rebuild. More than 5: `SM_SLOTS=10 npm run build` then `scripts/import-workflows.sh --force` (re-assign credentials afterwards). OAuth2 credentials refresh their own tokens.

## Reliability
* **No duplicates**: Log success for `rowid|platform|account` ⇒ never re-sent; rows are set to `publishing` before dispatch (an overlapping run skips them); a crash leaves `publishing` for a human, never a re-post; the call that creates a post is never auto-retried after a timeout/5xx (it may have posted).
* **Retries**: 429, network error or 5xx on a *non-publishing* step ⇒ `retry`, backoff 5/15/60 min, max 3 attempts, only the failed accounts are re-sent. Auth/permission/validation errors ⇒ not retried, with the reason in `results` (expired token says to reconnect the credential).
* **Honest refusals**: unsupported combinations return `unsupported` (no API call), e.g. text-only to Instagram/TikTok.

## What each platform workflow does (official APIs)
| Platform | Credential type | text | link | image | video | Notes / approvals |
|---|---|---|---|---|---|---|
| Facebook Pages | Facebook Graph API (Page token) | ✔ | ✔ | ✔ 1 | ✔ URL | `pages_manage_posts`; App Review for non-admins |
| Instagram | Facebook Graph API | ✖ | ✖ | ✔ 1 | ✔ Reels | IG Business/Creator linked to a Page; `instagram_content_publish`; media URL must be public |
| Threads | HTTP Query Auth (`access_token`) | ✔ ≤500 | ✔ | ✔ 1 | ✔ 1 | `threads_content_publish`; 60-day token, refresh manually |
| Reddit | Reddit OAuth2 | ✔ | ✔ | ✖ | ✖ | needs `subreddit` + `title`; Reddit API access terms apply |
| X | X OAuth2 | ✔ | ✔ | ✔ 1 | ✖ | needs API plan with write access; scopes `tweet.write media.write users.read offline.access` |
| LinkedIn | LinkedIn OAuth2 (native node) | ✔ | ✔ article | ✔ 1 | ✖ | `w_member_social` (org posts need Community Management API approval) |
| YouTube | YouTube OAuth2 (native node) | ✖ | ✖ | ✖ | ✔ | unverified API projects upload as **private**; default `privacy` = private; upload quota ≈ 6/day on default quota |
| Pinterest | generic OAuth2 | ✖ | ✖ | ✔ pin | ✖ | `board_id` required; “Trial” apps can’t publish to production until Standard access |
| Tumblr | generic OAuth2 | ✔ | ✔ | ✔ | ✔ URL | NPF format; video-by-URL per docs, unverified |
| TikTok | Bearer token | ✖ | ✖ | ✔ photo | ✔ | `video.publish`; unaudited apps post **private only** (`SELF_ONLY` default); PULL_FROM_URL needs a verified URL prefix; token lasts 24 h and must be refreshed manually |

Credential setup values for the generic OAuth2 ones — Pinterest: auth `https://www.pinterest.com/oauth/`, token `https://api.pinterest.com/v5/oauth/token`, scopes `pins:write boards:read`, authentication *Header*. Tumblr: auth `https://www.tumblr.com/oauth2/authorize`, token `https://api.tumblr.com/v2/oauth2/token`, scopes `write offline_access`. TikTok cannot use n8n's generic OAuth2 (it needs `client_key`), hence the manual Bearer token.

## Storage / server move
SQLite in `data/` (persists across restarts). `N8N_ENCRYPTION_KEY` in `.env` encrypts credentials — **back it up**. To move to a server: same key, `DB_TYPE=postgresdb` (see `.env.example`), copy `data/`, or `n8n export:*`/`import:*`. The schedule then runs while the phone is off.

## Termux
Untested on a phone. n8n 2.x needs Node ≥ 20 and native modules; if `npm install` fails in plain Termux, use `pkg install proot-distro && proot-distro install debian` and run everything inside Debian (glibc), same scripts.
