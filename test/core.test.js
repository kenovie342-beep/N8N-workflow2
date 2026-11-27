'use strict';
const test = require('node:test'), assert = require('node:assert');
const C = require('../lib/sm-core'); const { PLATFORM_SPECS, httpError } = require('../lib/platforms');
const NOW = Date.parse('2026-11-26T12:00:00Z');
const acc = [{ account_key: 'fb1', platform: 'facebook', slot: '1', page_id: '1' }, { account_key: 'fb2', platform: 'facebook', slot: '2', page_id: '2' }, { account_key: 'ig1', platform: 'instagram', slot: '1', ig_user_id: '9', enabled: 'FALSE' }];
const run = (content, o = {}) => C.buildJobs({ now: NOW, config: o.config || {}, accounts: o.accounts || acc, log: o.log || [], content });
test('time: ISO offsets, wall time in the configured timezone, sheet serials, junk', () => {
  assert.equal(C.parseWhen('2026-11-26T10:00:00Z', 'UTC'), Date.parse('2026-11-26T10:00:00Z'));
  assert.equal(C.parseWhen('2026-11-26 10:00', 'Africa/Lagos'), Date.parse('2026-11-26T09:00:00Z'));
  assert.equal(C.parseWhen('2026-07-01 09:00', 'America/New_York'), Date.parse('2026-07-01T13:00:00Z'));
  assert.equal(C.parseWhen('46352.5', 'UTC'), Date.parse('2026-11-26T12:00:00Z'));
  assert.equal(C.parseWhen('', 'UTC'), null); assert.ok(Number.isNaN(C.parseWhen('next tuesday', 'UTC')));
});
test('field precedence: field@account > field_platform > field > Accounts default', () => {
  const row = C.lowerKeys({ caption: 'base', caption_facebook: 'fbcap', 'caption@fb2': 'acct' });
  assert.equal(C.field(row, 'caption', 'facebook', 'fb2', {}), 'acct'); assert.equal(C.field(row, 'caption', 'facebook', 'fb1', {}), 'fbcap'); assert.equal(C.field(row, 'caption', 'x', 'x1', {}), 'base'); assert.equal(C.field(row, 'subreddit', 'reddit', 'r', { subreddit: 'def' }), 'def');
});
test('content is never rewritten: text = caption + supplied hashtags only', () => {
  const j = run([{ id: '1', status: 'ready', platforms: 'facebook', accounts: 'fb1', caption: ' Hello  there ', hashtags: 'no hash tags' }]).jobs[0]; assert.equal(j.text, 'Hello  there\n\nno hash tags');
  assert.equal(run([{ id: '1', status: 'ready', platforms: 'facebook', accounts: 'fb1', caption: 'c', hashtags: '#a' }], { config: { append_hashtags: false } }).jobs[0].text, 'c');
});
test('targets: ALL = enabled accounts only; unknown/disabled/mismatched accounts are reported', () => {
  assert.deepEqual(run([{ id: '1', status: 'ready', platforms: 'all', accounts: 'all', caption: 'x' }]).jobs.map(j => j.account_key), ['fb1', 'fb2']);
  const r = run([{ id: '1', status: 'ready', platforms: 'facebook', accounts: 'nope,ig1', caption: 'x' }]); assert.equal(r.jobs.length, 0); assert.match(r.rowState['1'].problems.join(), /unknown account "nope"/); assert.match(r.rowState['1'].problems.join(), /disabled|ig1/);
  assert.deepEqual(run([{ id: '1', status: 'ready', accounts: 'fb2', caption: 'x' }]).jobs.map(j => j.platform), ['facebook']);
});
test('eligibility: only ready/scheduled/pending/retry, due, unique id, bad dates flagged', () => {
  const r = run([{ id: 'a', status: 'draft', platforms: 'facebook', caption: 'x' }, { id: 'b', status: 'ready', publish_at: '2027-01-01', platforms: 'facebook', caption: 'x' }, { id: 'c', status: 'ready', publish_at: 'zzz', platforms: 'facebook', caption: 'x' }, { id: 'd', status: 'ready', platforms: 'facebook', caption: 'x' }, { id: 'd', status: 'ready', platforms: 'facebook', caption: 'dup' }, { status: 'ready', caption: 'noid' }]);
  assert.deepEqual(r.jobs.map(j => j.row_id), ['d', 'd']); assert.equal(r.skipped.find(s => s.id === 'c').flag, 'bad_date'); assert.match(r.skipped.map(s => s.reason).join('|'), /duplicate id/);
});
test('duplicate prevention + max rows per run', () => {
  const r = run([{ id: '1', status: 'ready', platforms: 'facebook', accounts: 'fb1,fb2', caption: 'x' }], { log: [{ dedupe_key: '1|facebook|fb1', status: 'success' }, { dedupe_key: '1|facebook|fb2', status: 'failed' }] }); assert.deepEqual(r.jobs.map(j => j.account_key), ['fb2']);
  assert.equal(run([1, 2, 3].map(i => ({ id: String(i), status: 'ready', platforms: 'facebook', accounts: 'fb1', caption: 'x' })), { config: { max_rows_per_run: 2 } }).jobs.length, 2);
});
test('format detection never guesses', () => {
  assert.equal(C.detectFormat('', ['a.mp4'], '').format, 'video'); assert.equal(C.detectFormat('', ['a.jpg', 'b.png'], '').format, 'image'); assert.equal(C.detectFormat('', [], 'http://x').format, 'link'); assert.equal(C.detectFormat('', [], '').format, 'text');
  assert.ok(C.detectFormat('', ['http://x/file'], '').error); assert.equal(C.detectFormat('video', ['http://x/file'], '').format, 'video');
});
test('finalize: published / retry+backoff / partial_error / error, log lines', () => {
  const j = run([{ id: '1', status: 'ready', platforms: 'facebook', accounts: 'fb1,fb2', caption: 'x' }]); const ok = { job_id: '1|facebook|fb1', ok: true, post_url: 'u' }, rl = { job_id: '1|facebook|fb2', ok: false, error_code: 'rate_limited', error_message: 'm', retryable: true }, bad = { ...rl, retryable: false };
  const f = (results, attempts = 0) => C.finalize({ rowState: { 1: { ...j.rowState['1'], attempts } }, results, now: NOW, config: {} });
  assert.equal(f([ok, { ...ok, job_id: '1|facebook|fb2' }]).rowUpdates[0].status, 'published');
  const r = f([ok, rl]); assert.equal(r.rowUpdates[0].status, 'retry'); assert.equal(r.rowUpdates[0].next_attempt_at, new Date(NOW + 5 * 60000).toISOString()); assert.equal(r.logAppends.length, 2);
  assert.equal(f([ok, rl], 2).rowUpdates[0].status, 'partial_error'); assert.equal(f([ok, bad]).rowUpdates[0].status, 'partial_error'); assert.equal(f([bad, bad]).rowUpdates[0].status, 'error');
  assert.equal(f([]).rowUpdates[0].status, 'error');
});
const job = (p, over = {}) => ({ job_id: 'k', platform: p, format: 'image', title: 'T', caption: 'c', text: 'c', description: '', link_url: '', media_urls: ['http://x/a.png'], params: { page_id: '1', ig_user_id: '2', board_id: 'b', blog: 'bb', subreddit: 'sr' }, ...over });
test('every platform builds a first request or a clear refusal', () => {
  for (const p of Object.keys(PLATFORM_SPECS)) for (const f of ['text', 'image', 'video']) { const o = PLATFORM_SPECS[p].stages[0](job(p, { format: f, media_urls: f === 'text' ? [] : ['http://x/a.' + (f === 'video' ? 'mp4' : 'png')] }), null, { carry: {} }); assert.ok(['req', 'pass', 'fail'].includes(o.ctl), `${p}/${f}`); if (o.ctl === 'fail') assert.ok(o.error.message.length > 10); }
});
test('unsupported combos are refused, not faked', () => {
  const f = (p, fmt, urls) => PLATFORM_SPECS[p].stages[0](job(p, { format: fmt, media_urls: urls || [] }), null, { carry: {} });
  assert.equal(f('instagram', 'text').error.code, 'unsupported'); assert.equal(f('tiktok', 'text').error.code, 'unsupported'); assert.equal(f('x', 'video', ['http://x/a.mp4']).error.code, 'unsupported'); assert.equal(f('reddit', 'image', ['http://x/a.png']).error.code, 'unsupported'); assert.equal(f('facebook', 'image', ['a', 'b']).error.code, 'unsupported');
  assert.equal(PLATFORM_SPECS.threads.stages[0](job('threads', { format: 'text', text: 'x'.repeat(501), media_urls: [] }), null, { carry: {} }).error.code, 'text_too_long');
});
test('http error classification: auth, rate limit, server error vs commit step', () => {
  assert.equal(httpError({ statusCode: 401, body: {} }).code, 'auth_expired'); assert.equal(httpError({ statusCode: 400, body: { error: { code: 190, message: 'x' } } }).code, 'auth_expired'); assert.equal(httpError({ statusCode: 429, body: {} }).retryable, true);
  assert.equal(httpError({ statusCode: 500, body: {} }, { req: { commit: false } }).retryable, true); assert.equal(httpError({ statusCode: 500, body: {} }, { req: { commit: true } }).retryable, false, 'a 5xx on the publishing call may have posted: never auto-retry');
  assert.equal(httpError({ error: { message: 'timeout' } }, { req: { commit: true } }).retryable, false); assert.equal(httpError({ statusCode: 403, body: { message: 'nope' } }).code, 'forbidden'); assert.equal(httpError({ statusCode: 200 }), null);
});
