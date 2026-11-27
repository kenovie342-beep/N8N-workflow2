'use strict';
const http = require('http');
const BASE = process.env.E2E_BASE; const log = []; let pass = 0, fail = 0;
const ok = (c, name, extra) => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${name}${!c && extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 400) : ''}`); };
// ---- mock platform APIs: records every request, answers like the real ones
const srv = http.createServer((q, s) => { const chunks = []; q.on('data', d => chunks.push(d)); q.on('end', () => {
  const raw = Buffer.concat(chunks); const u = new URL(q.url, 'http://x'); const ct = q.headers['content-type'] || ''; let body = raw.toString('latin1'); if (ct.includes('json')) { try { body = JSON.parse(raw.toString()); } catch { /* keep */ } } else if (ct.includes('urlencoded')) body = Object.fromEntries(new URLSearchParams(raw.toString()));
  const tok = (q.headers.authorization || '').replace(/^Bearer /i, '') || u.searchParams.get('access_token') || ''; const rec = { method: q.method, path: u.pathname, qs: Object.fromEntries(u.searchParams), body, tok, ct, hdr: q.headers }; log.push(rec);
  const J = (code, o) => { s.writeHead(code, { 'Content-Type': 'application/json' }); s.end(JSON.stringify(o)); };
  const p = u.pathname;
  if (tok === 'tok_facebook_3') return J(401, { error: { message: 'Invalid OAuth access token.', type: 'OAuthException', code: 190 } });
  if (tok === 'tok_reddit_2') return J(429, { message: 'Too Many Requests' });
  if (p.endsWith('/clip.mp4') || p.endsWith('/pic.png') || p.endsWith('/pic.jpg')) { s.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return s.end(Buffer.from('FAKEMEDIA')); }
  if (/\/feed$/.test(p)) return J(200, { id: 'PAGE_post1' }); if (/\/photos$/.test(p)) return J(200, { id: 'ph1', post_id: 'PAGE_ph1' }); if (/\/videos$/.test(p)) return J(200, { id: 'vid1' });
  if (/\/media$/.test(p)) return J(200, { id: 'cont1' }); if (/\/media_publish$/.test(p)) return J(200, { id: 'media1' });
  if (p.endsWith('/cont1')) return J(200, { status_code: 'FINISHED' }); if (p.endsWith('/media1')) return J(200, { permalink: 'https://www.instagram.com/p/MEDIA1/' });
  if (/\/threads$/.test(p)) return J(200, { id: 'thc1' }); if (p.endsWith('/thc1')) return J(200, { status: 'FINISHED' }); if (/\/threads_publish$/.test(p)) return J(200, { id: 'thp1' }); if (p.endsWith('/thp1')) return J(200, { permalink: 'https://www.threads.net/@x/post/THP1' });
  if (/\/api\/submit$/.test(p)) return J(200, { json: { errors: [], data: { url: 'https://www.reddit.com/r/test/comments/abc/x/', id: 'abc', name: 't3_abc' } } });
  if (/\/2\/media\/upload$/.test(p)) return J(200, { data: { id: '5551' } }); if (/\/2\/tweets$/.test(p)) return J(200, { data: { id: '999', text: 'x' } });
  if (/\/pins$/.test(p)) return J(201, { id: 'pin1' }); if (/\/blog\/.*\/posts$/.test(p)) return J(201, { meta: { status: 201 }, response: { id: 55, id_string: '55' } });
  if (/video\/init\/$/.test(p) || /content\/init\/$/.test(p)) return J(200, { data: { publish_id: 'pub1' }, error: { code: 'ok' } }); if (/status\/fetch\/$/.test(p)) return J(200, { data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: ['777'] }, error: { code: 'ok' } });
  J(404, { error: { message: 'mock: no route ' + p } }); }); }).listen(0);
const M = () => `http://127.0.0.1:${srv.address().port}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function run(body) { log.length = 0; const r = await fetch(`${BASE}/sm-test-run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base: M(), ...body }).split('__MOCK__').join(M()), signal: AbortSignal.timeout(240000) }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 500) }; } return Array.isArray(j) ? j[0] : j; }
const A = [
  { account_key: 'fb_a', platform: 'facebook', slot: 1, page_id: '111' }, { account_key: 'fb_b', platform: 'facebook', slot: 2, page_id: '222' }, { account_key: 'fb_c', platform: 'facebook', slot: 3, page_id: '333' },
  { account_key: 'ig_a', platform: 'instagram', slot: 1, ig_user_id: 'ig100' }, { account_key: 'th_a', platform: 'threads', slot: 1, threads_user_id: 'th100' },
  { account_key: 'rd_a', platform: 'reddit', slot: 1, subreddit: 'test' }, { account_key: 'rd_b', platform: 'reddit', slot: 2, subreddit: 'other' },
  { account_key: 'x_a', platform: 'x', slot: 1 }, { account_key: 'pin_a', platform: 'pinterest', slot: 1, board_id: 'board9' }, { account_key: 'tb_a', platform: 'tumblr', slot: 1, blog: 'myblog' },
  { account_key: 'tt_a', platform: 'tiktok', slot: 1 }, { account_key: 'yt_a', platform: 'youtube', slot: 1 }, { account_key: 'li_a', platform: 'linkedin', slot: 1, person_id: 'abc123' }, { account_key: 'fb_off', platform: 'facebook', slot: 1, page_id: '9', enabled: 'FALSE' },
];
const NOW = Date.parse('2026-11-26T12:00:00Z'); const cfg = { timezone: 'UTC', max_attempts: 3, max_rows_per_run: 50, append_hashtags: true };
const byKey = (res, k) => (res.results || []).find(r => r.job_id === k); const upd = (res, id) => (res.rowUpdates || []).find(r => r.id === id);
const calls = (re) => log.filter(l => re.test(l.path));
(async () => {
  // 1) multi-account Facebook: per-account content + credential separation
  let r = await run({ now: NOW, config: cfg, accounts: A, log: [], content: [{ id: 'r1', status: 'ready', publish_at: '2026-11-26 11:00', platforms: 'facebook', accounts: 'fb_a,fb_b', caption: 'Hello all', 'caption@fb_b': 'Hello page B', hashtags: '#one #two', link_url: 'https://example.com/post' }] });
  ok(r.results && r.results.length === 2 && r.results.every(x => x.ok), 'facebook: two accounts published through the real workflow', r.results || r);
  const f = calls(/\/feed$/); console.log('   feed bodies:', JSON.stringify(f.map(c => [c.path, c.body])));
  ok(f.length === 2 && f.find(c => c.path === '/111/feed').tok === 'tok_facebook_1' && f.find(c => c.path === '/222/feed').tok === 'tok_facebook_2', 'each account used ITS OWN credential (token 1 -> page 111, token 2 -> page 222)', f.map(c => [c.path, c.tok]));
  ok(f.find(c => c.path === '/111/feed').body.message === 'Hello all\n\n#one #two' && f.find(c => c.path === '/222/feed').body.message === 'Hello page B\n\n#one #two', 'account-specific caption (caption@fb_b) used; supplied hashtags appended verbatim; nothing rewritten');
  ok(upd(r, 'r1') && upd(r, 'r1').status === 'published' && /facebook\/fb_a: OK https:\/\/www.facebook.com\/PAGE_post1/.test(upd(r, 'r1').results), 'row marked published with result URLs', upd(r, 'r1'));
  ok(r.logAppends.length === 2 && r.logAppends.every(l => l.status === 'success' && l.dedupe_key.startsWith('r1|facebook|')), 'log lines written per account');
  // 2) duplicate prevention: same row again with the log from run 1
  const r2 = await run({ now: NOW, config: cfg, accounts: A, log: r.logAppends, content: [{ id: 'r1', status: 'ready', platforms: 'facebook', accounts: 'fb_a,fb_b', caption: 'Hello all' }] });
  ok(log.length === 0 && (r2.jobs || []).length === 0, 'duplicate prevention: nothing is sent again when the log shows success', { calls: log.length });
  ok(upd(r2, 'r1') && upd(r2, 'r1').status === 'published', 'duplicate row is reconciled to published, no API calls');
  // 3) ALL accounts, disabled account skipped; auth error + status handling
  r = await run({ now: NOW, config: cfg, accounts: A, log: [], content: [{ id: 'r3', status: 'ready', platforms: 'facebook', accounts: 'ALL', caption: 'All pages' }] });
  ok(r.results.length === 3 && !r.results.find(x => x.account_key === 'fb_off'), 'ALL = every ENABLED account of the platform (disabled account skipped)', r.results.map(x => x.account_key));
  const bad = byKey(r, 'r3|facebook|fb_c'); ok(bad && !bad.ok && bad.error_code === 'auth_expired' && bad.retryable === false && /reconnect/i.test(bad.error_message), 'expired token (Graph code 190) -> auth_expired, not retried, tells you what to do', bad);
  ok(upd(r, 'r3').status === 'partial_error' && /fb_a: OK/.test(upd(r, 'r3').results), 'one account failing does not hide the successes: row = partial_error', upd(r, 'r3'));
  // 4) retryable failure -> retry with backoff
  r = await run({ now: NOW, config: cfg, accounts: A, log: [], content: [{ id: 'r4', status: 'ready', platforms: 'reddit', accounts: 'rd_a,rd_b', title: 'T', caption: 'body' }] });
  ok(byKey(r, 'r4|reddit|rd_a').ok && !byKey(r, 'r4|reddit|rd_b').ok && byKey(r, 'r4|reddit|rd_b').retryable === true, 'reddit: account A ok, account B rate-limited (429) -> retryable', r.results);
  ok(upd(r, 'r4').status === 'retry' && upd(r, 'r4').attempts === 1 && upd(r, 'r4').next_attempt_at === new Date(NOW + 5 * 60000).toISOString(), 'row -> retry, attempts=1, next attempt in 5 min', upd(r, 'r4'));
  const rd = calls(/api\/submit/).find(c => c.tok === 'tok_reddit_1'); ok(rd && rd.body.sr === 'test' && rd.body.kind === 'self' && rd.body.title === 'T' && rd.body.text === 'body' && rd.hdr['user-agent'], 'reddit: form-encoded self post with subreddit/title/text + User-Agent', rd && rd.body);
  // 5) retry row not yet due is skipped; due retry only re-sends the failed target
  r = await run({ now: NOW, config: cfg, accounts: A, log: [{ dedupe_key: 'r4|reddit|rd_a', status: 'success' }], content: [{ id: 'r4', status: 'retry', next_attempt_at: new Date(NOW - 1000).toISOString(), attempts: 1, platforms: 'reddit', accounts: 'rd_a,rd_b', title: 'T', caption: 'body' }] });
  ok((r.jobs || []).length === 1 && r.jobs[0].account_key === 'rd_b', 'retry re-sends ONLY the account that failed (rd_a already succeeded)', (r.jobs || []).map(j => j.account_key));
  // 6) scheduling + status gating
  r = await run({ now: NOW, config: cfg, accounts: A, log: [], content: [{ id: 's1', status: 'ready', publish_at: '2026-11-26 13:00', platforms: 'facebook', accounts: 'fb_a', caption: 'later' }, { id: 's2', status: 'draft', platforms: 'facebook', accounts: 'fb_a', caption: 'draft' }, { id: 's3', status: '', platforms: 'facebook', accounts: 'fb_a', caption: 'blank' }, { id: 's4', status: 'ready', publish_at: 'garbage', platforms: 'facebook', accounts: 'fb_a', caption: 'x' }] });
  ok(log.length === 0 && (r.jobs || []).length === 0, 'future / draft / blank-status rows publish nothing', { calls: log.length });
  ok(upd(r, 's4') && upd(r, 's4').status === 'error' && /not understood/.test(upd(r, 's4').last_error), 'unparseable publish_at is flagged in the sheet, not guessed', upd(r, 's4'));
  // 7) every platform: request shapes + credentials
  const all = [{ id: 'p1', status: 'ready', platforms: 'instagram,threads,reddit,x,pinterest,tumblr,tiktok,facebook', accounts: 'ig_a,th_a,rd_a,x_a,pin_a,tb_a,tt_a,fb_a', title: 'My title', caption: 'My caption', media_urls: '__MOCK__/pic.png', hashtags: '#tag1' }];
  r = await run({ now: NOW, config: cfg, accounts: A, log: [], content: [{ ...all[0], 'media_urls_reddit': '', link_url_reddit: '', 'format_reddit': 'text' }] });
  const res = k => byKey(r, k) || {}; const names = ['instagram|ig_a', 'threads|th_a', 'reddit|rd_a', 'x|x_a', 'pinterest|pin_a', 'tumblr|tb_a', 'tiktok|tt_a', 'facebook|fb_a'];
  names.forEach(n => { const k = 'p1|' + n; const x = res(k); ok(x.ok, `${n.split('|')[0]}: image post succeeds end-to-end`, x.ok === undefined ? 'no result' : { code: x.error_code, msg: x.error_message }); });
  const ig = calls(/\/ig100\/media$/)[0]; ok(ig && ig.body.image_url === M() + '/pic.png' && ig.body.caption === 'My caption\n\n#tag1' && ig.tok === 'tok_instagram_1', 'instagram: container created with image_url + caption + own token', ig && ig.body);
  ok(calls(/media_publish$/).length === 1 && /instagram.com\/p\/MEDIA1/.test(res('p1|instagram|ig_a').post_url), 'instagram: create -> status -> publish -> permalink flow, permalink returned', res('p1|instagram|ig_a'));
  const th = calls(/\/th100\/threads$/)[0]; ok(th && th.qs.media_type === 'IMAGE' && th.qs.image_url === M() + '/pic.png' && th.tok === 'tok_threads_1' && calls(/threads_publish/).length === 1, 'threads: IMAGE container + publish, access_token from credential', th && th.qs);
  const xt = calls(/\/2\/tweets$/)[0]; const xu = calls(/\/2\/media\/upload$/)[0]; ok(xu && /multipart/.test(xu.ct) && /FAKEMEDIA/.test(String(xu.body)) && xu.tok === 'tok_x_1', 'x: image downloaded then uploaded as multipart with Bearer credential', xu && xu.ct);
  ok(xt && xt.body.media && xt.body.media.media_ids[0] === '5551' && xt.body.text === 'My caption\n\n#tag1', 'x: tweet references uploaded media id', xt && xt.body);
  const pn = calls(/\/pins$/)[0]; ok(pn && pn.body.board_id === 'board9' && pn.body.media_source.url === M() + '/pic.png' && pn.tok === 'tok_pinterest_1', 'pinterest: pin with board + image_url', pn && pn.body);
  const tb = calls(/\/blog\/myblog\/posts$/)[0]; ok(tb && tb.body.content.some(c => c.type === 'image') && tb.body.content.some(c => c.subtype === 'heading1') && tb.body.tags === 'tag1', 'tumblr: NPF blocks (heading + text + image), tags from supplied hashtags', tb && tb.body);
  const tt = calls(/content\/init\/$/)[0]; ok(tt && tt.body.media_type === 'PHOTO' && tt.body.post_info.privacy_level === 'SELF_ONLY' && tt.tok === 'tok_tiktok_1', 'tiktok: PHOTO init with default privacy SELF_ONLY (unaudited-app safe)', tt && tt.body);
  // 8) video formats + unsupported combinations are reported honestly
  r = await run({ now: NOW, config: cfg, accounts: A, log: [], content: [{ id: 'v1', status: 'ready', platforms: 'instagram,threads,facebook,tiktok,x,pinterest,reddit', accounts: 'ig_a,th_a,fb_a,tt_a,x_a,pin_a,rd_a', title: 'V', caption: 'clip', media_urls: '__MOCK__/clip.mp4', subreddit: 'test' }] });
  ['instagram|ig_a', 'threads|th_a', 'facebook|fb_a', 'tiktok|tt_a'].forEach(n => ok(res2(r, 'v1|' + n).ok, `${n.split('|')[0]}: video post succeeds`, res2(r, 'v1|' + n)));
  ok(calls(/\/ig100\/media$/)[0].body.media_type === 'REELS' && calls(/fbvideo\/111\/videos$/)[0].body.file_url && calls(/video\/init\/$/)[0].body.source_info.source === 'PULL_FROM_URL', 'video: IG REELS, FB file_url, TikTok PULL_FROM_URL', null);
  ['x|x_a', 'pinterest|pin_a', 'reddit|rd_a'].forEach(n => { const x = res2(r, 'v1|' + n); ok(!x.ok && x.error_code === 'unsupported' && x.retryable === false, `${n.split('|')[0]}: video not supported -> clear 'unsupported', no API call, no retry`, x); });
  r = await run({ now: NOW, config: cfg, accounts: A, log: [], content: [{ id: 'u1', status: 'ready', platforms: 'instagram,tiktok,facebook', accounts: 'ig_a,tt_a,fb_a', caption: 'text only' }] });
  ok(!res2(r, 'u1|instagram|ig_a').ok && res2(r, 'u1|instagram|ig_a').error_code === 'unsupported' && !res2(r, 'u1|tiktok|tt_a').ok && res2(r, 'u1|facebook|fb_a').ok, 'text-only: Instagram/TikTok refused (media required), Facebook ok');
  // 9) validation problems surface in the sheet
  r = await run({ now: NOW, config: cfg, accounts: A, log: [], content: [{ id: 'e1', status: 'ready', platforms: 'facebook', accounts: 'nope', caption: 'x' }, { id: 'e2', status: 'ready', platforms: 'facebook', accounts: 'fb_a', caption: 'x', media_urls: 'https://x.com/file' }] });
  ok(upd(r, 'e1').status === 'error' && /unknown account "nope"/.test(upd(r, 'e1').results), 'unknown account -> row error with explanation', upd(r, 'e1'));
  ok(upd(r, 'e2').status === 'error' && /set the format column/.test(upd(r, 'e2').results), 'media type not detectable -> asks for the format column instead of guessing', upd(r, 'e2'));
  // 10) native-node platforms: download stage runs; native upload attempted with the slot-1 credential (real Google/LinkedIn endpoints are unreachable here)
  r = await run({ now: NOW, config: cfg, accounts: A, log: [], content: [{ id: 'n1', status: 'ready', platforms: 'youtube,linkedin', accounts: 'yt_a,li_a', title: 'YT', caption: 'c', media_urls: '__MOCK__/clip.mp4', format_linkedin: 'text', media_urls_linkedin: '' }] });
  ok(calls(/clip\.mp4$/).length >= 1, 'youtube: video downloaded by the workflow before the native YouTube upload node', calls(/clip\.mp4/).length);
  const yt = res2(r, 'n1|youtube|yt_a'), li = res2(r, 'n1|linkedin|li_a'); ok(yt && yt.ok === false && yt.error_code && yt.error_message, 'youtube: native upload failure (unreachable here) is reported cleanly, not a crash', yt); ok(li && li.ok === false && li.error_message, 'linkedin: native node failure reported cleanly', li);
  console.log(`\n${pass} passed, ${fail} failed`); srv.close(); process.exit(fail ? 1 : 0);
  function res2(rr, k) { return (rr.results || []).find(x => x.job_id === k) || {}; }
})().catch(e => { console.error('E2E crashed', e); srv.close(); process.exit(2); });
