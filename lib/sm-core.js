'use strict';
// Pure logic for the Sheets -> platforms pipeline. Embedded verbatim into n8n Code nodes by scripts/build-workflows.js.
// It never writes or rewrites content: it only selects, routes, concatenates the user's own fields and records results.

const PLATFORMS = ['reddit', 'facebook', 'instagram', 'youtube', 'x', 'linkedin', 'threads', 'pinterest', 'tumblr', 'tiktok'];
const ELIGIBLE = ['ready', 'scheduled', 'pending', 'retry'];
const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv'], IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
const DEFAULTS = { timezone: 'UTC', max_attempts: 3, backoff_minutes: [5, 15, 60], append_hashtags: true, max_rows_per_run: 20 };

const norm = v => (v === undefined || v === null ? '' : String(v).trim());
const csv = v => norm(v).split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
const truthy = (v, def) => { const s = norm(v).toLowerCase(); return s === '' ? def : !['false', '0', 'no', 'off', 'disabled'].includes(s); };
const lowerKeys = o => { const r = {}; Object.keys(o || {}).forEach(k => { r[String(k).trim().toLowerCase()] = o[k]; }); return r; };

// ---- time -------------------------------------------------------------------
function tzOffsetMs(ms, tz) {
  const p = {}; new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}
function wallToUtc(y, mo, d, h, mi, s, tz) { const g = Date.UTC(y, mo - 1, d, h, mi, s); let r = g - tzOffsetMs(g, tz); r = g - tzOffsetMs(r, tz); return r; }
// Accepts ISO with offset/Z, "YYYY-MM-DD[ T]HH:mm[:ss]" or a date (wall time in tz), or a Sheets serial number.
function parseWhen(v, tz) {
  const s = norm(v); if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s) && +s > 20000 && +s < 80000) { const ms = Math.round((+s - 25569) * 86400000); const d = new Date(ms); return wallToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), tz); }
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(s) && /\d{4}-\d{2}-\d{2}[T ]\d/.test(s)) { const t = Date.parse(s.replace(' ', 'T')); return isNaN(t) ? NaN : t; }
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m) return wallToUtc(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), tz);
  return NaN;
}

// ---- field resolution: field@account > field_platform > field > Accounts-sheet default ----
function field(row, name, platform, account, acct) {
  for (const k of [`${name}@${account}`, `${name}_${platform}`, name]) { if (norm(row[k]) !== '') return norm(row[k]); }
  return acct && norm(acct[name]) !== '' ? norm(acct[name]) : '';
}
function extOf(u) { const m = /\.([a-z0-9]{2,4})(?:[?#].*)?$/i.exec(u); return m ? m[1].toLowerCase() : ''; }
function detectFormat(explicit, urls, link) {
  const e = norm(explicit).toLowerCase();
  if (e && e !== 'auto') return ['text', 'image', 'video', 'link'].includes(e) ? { format: e } : { error: `format "${e}" is not text|image|video|link|auto` };
  if (urls.length) {
    const ex = urls.map(extOf);
    if (ex.some(x => VIDEO_EXT.includes(x))) return { format: 'video' };
    if (ex.every(x => IMAGE_EXT.includes(x))) return { format: 'image' };
    return { error: 'cannot tell if media_urls are images or video from the file extension; set the format column' };
  }
  return { format: link ? 'link' : 'text' };
}
const dedupeKey = (id, platform, account) => `${id}|${platform}|${account}`;

// ---- jobs -----------------------------------------------------------------------
// input: { content:[row], accounts:[row], log:[row], now:ms, config }
function buildJobs(input) {
  const cfg = Object.assign({}, DEFAULTS, input.config || {}); const now = input.now;
  const accounts = {}; (input.accounts || []).forEach(r => { r = lowerKeys(r); const k = norm(r.account_key).toLowerCase(); if (k) accounts[k] = r; });
  const done = new Set(); (input.log || []).forEach(r => { r = lowerKeys(r); if (norm(r.status).toLowerCase() === 'success') done.add(norm(r.dedupe_key)); });
  const jobs = [], rowState = {}, skipped = [], seen = new Set(); let taken = 0;
  for (const raw of input.content || []) {
    const row = lowerKeys(raw); const id = norm(row.id);
    if (!id) { skipped.push({ id: '', reason: 'row has no id' }); continue; }
    if (seen.has(id)) { skipped.push({ id, reason: 'duplicate id in sheet; every row needs a unique id' }); continue; } seen.add(id);
    const status = norm(row.status).toLowerCase();
    if (!ELIGIBLE.includes(status)) { skipped.push({ id, reason: `status "${status || '(blank)'}" is not ready/scheduled/pending/retry` }); continue; }
    const when = parseWhen(row.publish_at, cfg.timezone);
    if (Number.isNaN(when)) { skipped.push({ id, reason: `publish_at "${norm(row.publish_at)}" not understood`, flag: 'bad_date' }); continue; }
    if (when !== null && when > now) { skipped.push({ id, reason: 'not due yet' }); continue; }
    if (status === 'retry' && norm(row.next_attempt_at)) { const na = parseWhen(row.next_attempt_at, 'UTC'); if (na && na > now) { skipped.push({ id, reason: 'waiting for retry backoff' }); continue; } }
    if (taken >= cfg.max_rows_per_run) { skipped.push({ id, reason: 'over max_rows_per_run; next run' }); continue; }
    taken++;
    // targets
    let plats = csv(row.platforms).map(s => s.toLowerCase()), accs = csv(row.accounts).map(s => s.toLowerCase());
    const all = x => x.length === 1 && x[0] === 'all';
    const enabled = Object.keys(accounts).filter(k => truthy(accounts[k].enabled, true));
    let targets = []; const problems = [];
    if (!plats.length && !accs.length) problems.push('no platforms or accounts given');
    if (all(plats)) plats = PLATFORMS.filter(p => enabled.some(k => norm(accounts[k].platform).toLowerCase() === p));
    if (!plats.length && accs.length && !all(accs)) plats = [...new Set(accs.map(k => norm((accounts[k] || {}).platform).toLowerCase()).filter(Boolean))];
    plats.forEach(p => { if (!PLATFORMS.includes(p)) problems.push(`unknown platform "${p}"`); });
    if (all(accs) || !accs.length) plats.filter(p => PLATFORMS.includes(p)).forEach(p => enabled.filter(k => norm(accounts[k].platform).toLowerCase() === p).forEach(k => targets.push([p, k])));
    else accs.forEach(k => {
      const a = accounts[k];
      if (!a) { problems.push(`unknown account "${k}" (not in the Accounts sheet)`); return; }
      if (!truthy(a.enabled, true)) { problems.push(`account "${k}" is disabled`); return; }
      const p = norm(a.platform).toLowerCase();
      if (plats.length && !plats.includes(p)) { problems.push(`account "${k}" is a ${p} account but platforms is ${plats.join('/')}`); return; }
      targets.push([p, k]);
    });
    if (!targets.length && !problems.length) problems.push('no enabled account matches the requested platforms');
    const state = { attempts: +norm(row.attempts) || 0, targets: [], problems };
    targets.forEach(([p, k]) => {
      const key = dedupeKey(id, p, k); const acct = accounts[k];
      if (done.has(key)) { state.targets.push({ key, platform: p, account: k, state: 'already_done' }); return; }
      const get = n => field(row, n, p, k, acct);
      const urls = csv(get('media_urls')); const link = get('link_url'); const f = detectFormat(get('format'), urls, link);
      const base = { key, platform: p, account: k };
      if (f.error) { state.targets.push({ ...base, state: 'invalid', error: { code: 'bad_format', message: f.error, retryable: false } }); return; }
      const caption = get('caption'), tags = get('hashtags');
      const params = {}; Object.keys(row).forEach(c => { if (!/^(id|status|publish_at|platforms|accounts|attempts|next_attempt_at|results|last_error|published_urls|updated_at)$/.test(c) && !c.includes('@')) { const m = /^(.*)_(reddit|facebook|instagram|youtube|x|linkedin|threads|pinterest|tumblr|tiktok)$/.exec(c); if (!m) params[c] = get(c); else if (m[2] === p) params[m[1]] = get(m[1]); } });
      Object.keys(acct).forEach(c => { if (params[c] === undefined || params[c] === '') params[c] = norm(acct[c]); });
      const job = { job_id: key, row_id: id, platform: p, account_key: k, slot: parseInt(acct.slot, 10) || 0, format: f.format, title: get('title'), caption, description: get('description'), hashtags: tags, link_url: link, media_urls: urls, text: [caption, cfg.append_hashtags && tags ? tags : ''].filter(Boolean).join('\n\n'), params };
      state.targets.push({ ...base, state: 'job' }); jobs.push(job);
    });
    rowState[id] = state;
  }
  return { jobs, rowState, skipped, preUpdates: Object.keys(rowState).filter(id => rowState[id].targets.some(t => t.state === 'job')).map(id => ({ id, status: 'publishing', updated_at: new Date(now).toISOString() })) };
}

// ---- results -> row updates + log lines ------------------------------------------------------
function backoffMinutes(cfg, attempts) { const b = cfg.backoff_minutes || DEFAULTS.backoff_minutes; return b[Math.min(attempts, b.length) - 1] || b[b.length - 1]; }
function finalize(input) {
  const cfg = Object.assign({}, DEFAULTS, input.config || {}); const now = input.now; const iso = new Date(now).toISOString();
  const byKey = {}; (input.results || []).forEach(r => { byKey[r.job_id] = r; });
  const rowUpdates = [], logAppends = [];
  Object.keys(input.rowState || {}).forEach(id => {
    const st = input.rowState[id]; const lines = []; const urls = []; let okAll = true, retryable = false, anyOk = false, lastErr = '', ran = false;
    st.problems.forEach(p => { okAll = false; lastErr = p; lines.push(`PROBLEM: ${p}`); });
    st.targets.forEach(t => {
      if (t.state === 'already_done') { anyOk = true; lines.push(`${t.platform}/${t.account}: already published (skipped)`); return; }
      const r = t.state === 'invalid' ? { ok: false, error_code: t.error.code, error_message: t.error.message, retryable: false } : byKey[t.key] || { ok: false, error_code: 'no_result', error_message: 'no result returned by the platform workflow (check execution history)', retryable: false };
      ran = true;
      logAppends.push({ dedupe_key: t.key, time: iso, row_id: id, platform: t.platform, account_key: t.account, status: r.ok ? 'success' : 'failed', post_id: r.post_id || '', post_url: r.post_url || '', error_code: r.error_code || '', error_message: String(r.error_message || '').slice(0, 500), attempt: (st.attempts || 0) + 1 });
      if (r.ok) { anyOk = true; if (r.post_url) urls.push(r.post_url); lines.push(`${t.platform}/${t.account}: OK ${r.post_url || r.post_id || ''}${r.note ? ' (' + r.note + ')' : ''}`); }
      else { okAll = false; if (r.retryable) retryable = true; lastErr = `${t.platform}/${t.account}: ${r.error_code}: ${r.error_message}`; lines.push(`${t.platform}/${t.account}: FAIL${r.retryable ? ' (will retry)' : ''} ${r.error_code}: ${r.error_message}`); }
    });
    const attempts = (st.attempts || 0) + (ran ? 1 : 0);
    let status, next = '';
    if (okAll) status = 'published';
    else if (retryable && attempts < cfg.max_attempts) { status = 'retry'; next = new Date(now + backoffMinutes(cfg, attempts) * 60000).toISOString(); }
    else status = anyOk ? 'partial_error' : 'error';
    rowUpdates.push({ id, status, attempts, next_attempt_at: next, results: lines.join('\n').slice(0, 4000), last_error: okAll ? '' : lastErr.slice(0, 500), published_urls: urls.join('\n'), updated_at: iso });
  });
  return { rowUpdates, logAppends };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { PLATFORMS, DEFAULTS, parseWhen, field, detectFormat, buildJobs, finalize, dedupeKey, norm, csv, lowerKeys };
