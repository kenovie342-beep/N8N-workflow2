'use strict';
// One builder per stage per platform. Builders only translate the user's supplied fields into official API requests.
// A builder returns one of:
//   { ctl:'req', req:{method,url,qs,body,form,headers,commit}, wait, native, carry }  -> n8n executes it (credential-bound slot node)
//   { ctl:'pass', carry }                                                              -> nothing to do at this stage
//   { ctl:'done', result:{post_id,post_url,note} } | { ctl:'fail', error:{code,message,retryable} }
// `commit:true` marks the request that actually creates the post: a network error there is NOT retried (it may have succeeded).

const base = (j, def, tag) => (j._base ? `${j._base}${tag ? '/' + tag : ''}` : def); // _base is only set by the test harness
const req = (method, url, o = {}) => ({ ctl: 'req', req: { method, url, qs: o.qs, body: o.body, form: o.form, headers: o.headers, commit: !!o.commit }, wait: o.wait || 0, carry: o.carry || {} });
const pass = carry => ({ ctl: 'pass', carry: carry || {} });
const fail = (code, message, retryable = false) => ({ ctl: 'fail', error: { code, message, retryable } });
const done = (result, carry) => ({ ctl: 'done', result, carry: carry || {} });
const msgOf = b => { try { if (!b) return ''; if (typeof b === 'string') return b.slice(0, 300); const m = (b.error && (b.error.message || b.error.error_user_msg || (typeof b.error === 'string' && b.error))) || b.message || b.detail || (b.errors && b.errors[0] && (b.errors[0].message || b.errors[0])) || b.error_description || (b.meta && b.meta.msg) || JSON.stringify(b); return String(typeof m === 'string' ? m : JSON.stringify(m)).slice(0, 300); } catch { return 'unreadable error body'; } };
const AUTH_HELP = 'Access token expired or invalid: reconnect/refresh the credential for this account in n8n.';

// null when prev is a 2xx response, else {code,message,retryable}
function httpError(prev, last) {
  const commit = !!(last && last.req && last.req.commit);
  if (!prev) return { code: 'no_response', message: 'no response from previous step', retryable: false };
  if (prev.error) { const m = String((prev.error && (prev.error.message || prev.error)) || 'network error').slice(0, 300); return /credential/i.test(m) ? { code: 'config_error', message: m + ' (assign a credential to this account\'s slot node in the platform workflow)', retryable: false } : { code: 'network_error', message: m, retryable: !commit }; }
  const s = prev.statusCode; if (s >= 200 && s < 300) return null;
  const m = msgOf(prev.body); const raw = JSON.stringify(prev.body || '');
  if (s === 401 || (s >= 400 && s < 500 && /"code":\s*190|invalid_token|expired|OAuthException|Invalid OAuth/i.test(raw))) return { code: 'auth_expired', message: `${AUTH_HELP} (${m})`, retryable: false };
  if (s === 429) return { code: 'rate_limited', message: m || 'rate limited', retryable: true };
  if (s >= 500) return { code: 'server_error', message: m || `HTTP ${s}`, retryable: !commit };
  if (s === 403) return { code: 'forbidden', message: `Not permitted (missing scope/permission or app approval?): ${m}`, retryable: false };
  return { code: 'api_rejected', message: `HTTP ${s}: ${m}`, retryable: false };
}
const failFrom = e => ({ ctl: 'fail', error: e });
const one = (j, what) => (j.media_urls.length === 1 ? null : fail('unsupported', `${what}: exactly one media URL is supported per post (got ${j.media_urls.length})`));
const unsupported = (p, f) => fail('unsupported', `${p} does not support ${f} posts through this workflow`);
const needP = (j, k, hint) => (j.params[k] ? null : fail('missing_param', `"${k}" is required for this account ${hint || '(set it in the Accounts sheet or the content row)'}`));
const mime = u => { const m = /\.([a-z0-9]{2,4})(?:[?#].*)?$/i.exec(u); const e = m ? m[1].toLowerCase() : ''; return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/mp4', webm: 'video/webm' }[e] || 'application/octet-stream'; };
const bare = s => String(s || '').replace(/^#/, '');

// ---------------------------------------------------------------- Facebook (Pages)
const facebook = { cred: { auth: 'predefined', type: 'facebookGraphApi' }, kinds: [{ t: 'slot' }], stages: [
  j => { const m = needP(j, 'page_id', '(Facebook Page ID)'); if (m) return m; const B = base(j, 'https://graph.facebook.com/v21.0'), pg = j.params.page_id;
    if (j.format === 'text' || j.format === 'link') { if (!j.text && !j.link_url) return fail('empty_post', 'no caption or link to post'); const body = { message: j.text }; if (j.link_url) body.link = j.link_url; return req('POST', `${B}/${pg}/feed`, { body, commit: true }); }
    const o = one(j, 'Facebook'); if (o) return o;
    if (j.format === 'image') return req('POST', `${B}/${pg}/photos`, { body: { url: j.media_urls[0], caption: j.text }, commit: true });
    return req('POST', `${base(j, 'https://graph-video.facebook.com/v21.0', 'fbvideo')}/${pg}/videos`, { body: { file_url: j.media_urls[0], description: j.text, title: j.title || undefined }, commit: true }); },
  (j, prev, last) => { const e = httpError(prev, last); if (e) return failFrom(e); const id = prev.body.post_id || prev.body.id; return done({ post_id: id, post_url: `https://www.facebook.com/${id}` }); },
] };

// ---------------------------------------------------------------- Instagram (Graph API; media required)
const instagram = { cred: { auth: 'predefined', type: 'facebookGraphApi' }, kinds: [{ t: 'slot' }, { t: 'slot', get: true }, { t: 'slot' }, { t: 'slot', get: true }], stages: [
  j => { const m = needP(j, 'ig_user_id', '(Instagram Business account ID)'); if (m) return m; if (j.format === 'text' || j.format === 'link') return unsupported('Instagram', j.format + '-only'); const o = one(j, 'Instagram'); if (o) return o; const B = base(j, 'https://graph.facebook.com/v21.0');
    const body = j.format === 'image' ? { image_url: j.media_urls[0], caption: j.text } : { media_type: 'REELS', video_url: j.media_urls[0], caption: j.text, share_to_feed: true };
    return req('POST', `${B}/${j.params.ig_user_id}/media`, { body, carry: { video: j.format === 'video' } }); },
  (j, prev, last) => { const e = httpError(prev, last); if (e) return failFrom(e); const cid = prev.body.id; return req('GET', `${base(j, 'https://graph.facebook.com/v21.0')}/${cid}`, { qs: { fields: 'status_code' }, wait: last.carry.video ? 30 : 3, carry: { ...last.carry, creation_id: cid } }); },
  (j, prev, last) => { const e = httpError(prev, last); if (e) return failFrom(e); const sc = prev.body.status_code;
    if (sc === 'IN_PROGRESS') return fail('media_processing', 'Instagram is still processing the media; will retry later', true);
    if (sc !== 'FINISHED') return fail('media_rejected', `Instagram media status: ${sc}`);
    return req('POST', `${base(j, 'https://graph.facebook.com/v21.0')}/${j.params.ig_user_id}/media_publish`, { body: { creation_id: last.carry.creation_id }, commit: true, carry: last.carry }); },
  (j, prev, last) => { const e = httpError(prev, last); if (e) return failFrom(e); const mid = prev.body.id; return req('GET', `${base(j, 'https://graph.facebook.com/v21.0')}/${mid}`, { qs: { fields: 'permalink' }, carry: { ...last.carry, media_id: mid } }); },
  (j, prev, last) => done({ post_id: last.carry.media_id, post_url: prev && prev.statusCode >= 200 && prev.statusCode < 300 && prev.body ? prev.body.permalink : '', note: prev && prev.statusCode >= 300 ? 'published; permalink unavailable' : undefined }),
] };

// ---------------------------------------------------------------- Threads (graph.threads.net)
const threads = { cred: { auth: 'generic', type: 'httpQueryAuth' }, kinds: [{ t: 'slot' }, { t: 'slot', get: true }, { t: 'slot' }, { t: 'slot', get: true }], stages: [
  j => { if (j.format === 'image' || j.format === 'video') { const o = one(j, 'Threads'); if (o) return o; }
    if (j.text.length > 500) return fail('text_too_long', `Threads allows 500 characters; the supplied text has ${j.text.length}. Shorten it in the sheet (it is never truncated automatically).`);
    const uid = j.params.threads_user_id || 'me'; const qs = { text: j.text || undefined }; let media = 'TEXT';
    if (j.format === 'image') { media = 'IMAGE'; qs.image_url = j.media_urls[0]; } else if (j.format === 'video') { media = 'VIDEO'; qs.video_url = j.media_urls[0]; } else if (j.link_url) qs.link_attachment = j.link_url;
    if (media === 'TEXT' && !j.text) return fail('empty_post', 'no text to post'); qs.media_type = media;
    return req('POST', `${base(j, 'https://graph.threads.net/v1.0')}/${uid}/threads`, { qs, carry: { media } }); },
  (j, prev, last) => { const e = httpError(prev, last); if (e) return failFrom(e); const cid = prev.body.id; const c = { ...last.carry, creation_id: cid };
    if (c.media === 'TEXT') return { ctl: 'pass', carry: c };
    return req('GET', `${base(j, 'https://graph.threads.net/v1.0')}/${cid}`, { qs: { fields: 'status,error_message' }, wait: c.media === 'VIDEO' ? 30 : 5, carry: c }); },
  (j, prev, last) => { const c = last.carry; if (c.media !== 'TEXT') { const e = httpError(prev, last); if (e) return failFrom(e); const st = prev.body.status; if (st === 'IN_PROGRESS') return fail('media_processing', 'Threads is still processing the media; will retry later', true); if (st !== 'FINISHED') return fail('media_rejected', `Threads media status: ${st} ${prev.body.error_message || ''}`); }
    return req('POST', `${base(j, 'https://graph.threads.net/v1.0')}/${j.params.threads_user_id || 'me'}/threads_publish`, { qs: { creation_id: c.creation_id }, commit: true, carry: c }); },
  (j, prev, last) => { const e = httpError(prev, last); if (e) return failFrom(e); const id = prev.body.id; return req('GET', `${base(j, 'https://graph.threads.net/v1.0')}/${id}`, { qs: { fields: 'permalink' }, carry: { ...last.carry, media_id: id } }); },
  (j, prev, last) => done({ post_id: last.carry.media_id, post_url: prev && prev.statusCode >= 200 && prev.statusCode < 300 && prev.body ? prev.body.permalink : '', note: prev && prev.statusCode >= 300 ? 'published; permalink unavailable' : undefined }),
] };

// ---------------------------------------------------------------- Reddit (text + link posts)
const reddit = { cred: { auth: 'predefined', type: 'redditOAuth2Api' }, kinds: [{ t: 'slot', ctype: 'form' }], stages: [
  j => { if (j.format === 'image' || j.format === 'video') return unsupported('Reddit', j.format); const m = needP(j, 'subreddit', '(subreddit name, without r/)'); if (m) return m; if (!j.title) return fail('missing_param', 'Reddit needs a title (the "title" column)');
    const f = { api_type: 'json', sr: j.params.subreddit.replace(/^\/?r\//i, ''), title: j.title, resubmit: /^(true|yes|1)$/i.test(j.params.resubmit || '') ? 'true' : 'false' };
    if (j.params.flair_id) f.flair_id = j.params.flair_id;
    if (j.format === 'link') { f.kind = 'link'; f.url = j.link_url; } else { f.kind = 'self'; f.text = j.text; }
    return req('POST', `${base(j, 'https://oauth.reddit.com')}/api/submit`, { form: Object.keys(f).filter(k => f[k] !== undefined).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(f[k])).join('&'), headers: { 'User-Agent': 'n8n-social-automation/1.0' }, commit: true }); },
  (j, prev, last) => { const e = httpError(prev, last); if (e) return failFrom(e); const errs = prev.body && prev.body.json && prev.body.json.errors;
    if (errs && errs.length) { const c = String(errs[0][0]); return fail('reddit_' + c.toLowerCase(), `${c}: ${errs[0][1] || ''}`, c === 'RATELIMIT'); }
    const d = prev.body.json.data; return done({ post_id: d.name || d.id, post_url: d.url }); },
] };

// ---------------------------------------------------------------- X (text, link, one image)
const x = { cred: { auth: 'predefined', type: 'twitterOAuth2Api' }, kinds: [{ t: 'plain' }, { t: 'slot', ctype: 'multipart' }, { t: 'slot' }], stages: [
  j => { if (j.format === 'video') return unsupported('X', 'video (needs chunked media upload, not implemented)'); if (j.format === 'image') { const o = one(j, 'X'); if (o) return o; return req('GET', j.media_urls[0], { carry: { image: true } }); } return pass({}); },
  (j, prev, last) => { if (!last.carry.image) return pass(last.carry); if (!prev || prev.error) return fail('media_download_failed', `could not download ${j.media_urls[0]}: ${prev && prev.error ? (prev.error.message || prev.error) : 'no data'}`, true);
    return req('POST', `${base(j, 'https://api.x.com')}/2/media/upload`, { qs: undefined, carry: last.carry, body: { media_category: 'tweet_image' } }); },
  (j, prev, last) => { let media; if (last.carry.image) { const e = httpError(prev, last); if (e) return failFrom(e); const id = prev.body && prev.body.data && prev.body.data.id; if (!id) return fail('media_upload_failed', 'X did not return a media id'); media = { media_ids: [String(id)] }; }
    const text = [j.text, j.format === 'link' ? j.link_url : ''].filter(Boolean).join(' '); if (!text && !media) return fail('empty_post', 'no text to post');
    return req('POST', `${base(j, 'https://api.x.com')}/2/tweets`, { body: Object.assign({ text: text || undefined }, media ? { media } : {}), commit: true }); },
  (j, prev, last) => { const e = httpError(prev, last); if (e) return failFrom(e); const id = prev.body.data.id; return done({ post_id: id, post_url: `https://x.com/i/web/status/${id}` }); },
] };

// ---------------------------------------------------------------- Pinterest (image pins)
const pinterest = { cred: { auth: 'generic', type: 'oAuth2Api' }, kinds: [{ t: 'slot' }], stages: [
  j => { if (j.format !== 'image') return unsupported('Pinterest', j.format + ' (image pins only here)'); const m = needP(j, 'board_id', '(Pinterest board ID)'); if (m) return m; const o = one(j, 'Pinterest'); if (o) return o;
    return req('POST', `${base(j, 'https://api.pinterest.com/v5')}/pins`, { body: { board_id: j.params.board_id, title: j.title || undefined, description: j.description || j.text || undefined, link: j.link_url || undefined, alt_text: j.params.alt_text || undefined, media_source: { source_type: 'image_url', url: j.media_urls[0] } }, commit: true }); },
  (j, prev, last) => { const e = httpError(prev, last); if (e) return failFrom(e); return done({ post_id: prev.body.id, post_url: `https://www.pinterest.com/pin/${prev.body.id}/` }); },
] };

// ---------------------------------------------------------------- Tumblr (NPF: text, link, image, video by URL)
const tumblr = { cred: { auth: 'generic', type: 'oAuth2Api' }, kinds: [{ t: 'slot' }], stages: [
  j => { const m = needP(j, 'blog', '(blog name, e.g. myblog or myblog.tumblr.com)'); if (m) return m; const content = [];
    if (j.title) content.push({ type: 'text', subtype: 'heading1', text: j.title }); if (j.text) content.push({ type: 'text', text: j.text });
    if (j.format === 'link' && j.link_url) content.push({ type: 'link', url: j.link_url });
    if (j.format === 'image') j.media_urls.forEach(u => content.push({ type: 'image', media: [{ type: mime(u), url: u }] }));
    if (j.format === 'video') j.media_urls.forEach(u => content.push({ type: 'video', media: { type: mime(u), url: u } }));
    if (!content.length) return fail('empty_post', 'nothing to post'); const tags = (j.params.tags || j.hashtags || '').split(/[,\s]+/).map(bare).filter(Boolean).join(',');
    const blog = j.params.blog.replace(/^https?:\/\//, '').replace(/\/$/, ''); return req('POST', `${base(j, 'https://api.tumblr.com/v2')}/blog/${blog}/posts`, { body: { content, state: j.params.state || 'published', tags: tags || undefined }, commit: true, carry: { blog: blog.includes('.') ? blog : blog + '.tumblr.com' } }); },
  (j, prev, last) => { const e = httpError(prev, last); if (e) return failFrom(e); const id = prev.body.response && (prev.body.response.id_string || prev.body.response.id); return done({ post_id: String(id), post_url: `https://${last.carry.blog}/post/${id}` }); },
] };

// ---------------------------------------------------------------- TikTok (Content Posting API, PULL_FROM_URL)
const tiktok = { cred: { auth: 'generic', type: 'httpBearerAuth' }, kinds: [{ t: 'slot' }, { t: 'slot' }], stages: [
  j => { if (j.format === 'text' || j.format === 'link') return unsupported('TikTok', j.format); const B = base(j, 'https://open.tiktokapis.com/v2'); const priv = j.params.privacy_level || 'SELF_ONLY'; const hdr = { 'Content-Type': 'application/json; charset=UTF-8' };
    if (j.format === 'video') { const o = one(j, 'TikTok'); if (o) return o; return req('POST', `${B}/post/publish/video/init/`, { headers: hdr, body: { post_info: { title: j.text || j.title, privacy_level: priv }, source_info: { source: 'PULL_FROM_URL', video_url: j.media_urls[0] } }, commit: true }); }
    const title = j.title || j.text; if (title.length > 90) return fail('title_too_long', `TikTok photo titles are limited to 90 characters (got ${title.length}); set a shorter "title".`);
    return req('POST', `${B}/post/publish/content/init/`, { headers: hdr, body: { media_type: 'PHOTO', post_mode: 'DIRECT_POST', post_info: { title, description: j.description || j.text, privacy_level: priv }, source_info: { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: j.media_urls } }, commit: true }); },
  (j, prev, last) => { const e = httpError(prev, last); if (e) return failFrom(e); const err = prev.body && prev.body.error; if (err && err.code && err.code !== 'ok') return fail('tiktok_' + err.code, err.message || err.code); const pid = prev.body.data.publish_id;
    return req('POST', `${base(j, 'https://open.tiktokapis.com/v2')}/post/publish/status/fetch/`, { headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: { publish_id: pid }, wait: 15, carry: { publish_id: pid } }); },
  (j, prev, last) => { const pid = last.carry.publish_id; const st = prev && prev.body && prev.body.data && prev.body.data.status;
    if (st === 'FAILED') return fail('tiktok_publish_failed', `TikTok reported failure: ${prev.body.data.fail_reason || 'unknown'}`);
    if (st === 'PUBLISH_COMPLETE') { const ids = prev.body.data.publicaly_available_post_id || prev.body.data.publicly_available_post_id || []; return done({ post_id: String(ids[0] || pid), post_url: '' }); }
    return done({ post_id: pid, post_url: '', note: `accepted by TikTok, still processing (status ${st || 'unknown'}); not re-submitted to avoid a duplicate` }); },
] };

// ---------------------------------------------------------------- YouTube (native node uploads the file)
const youtube = { cred: { auth: 'native', type: 'youTubeOAuth2Api' }, kinds: [{ t: 'plain' }, { t: 'native', node: 'youtube' }], stages: [
  j => { if (j.format !== 'video') return unsupported('YouTube', j.format); const o = one(j, 'YouTube'); if (o) return o; if (!j.title) return fail('missing_param', 'YouTube needs a title (the "title" column)'); return req('GET', j.media_urls[0], { carry: {} }); },
  (j, prev, last) => { if (!prev || prev.error) return fail('media_download_failed', `could not download ${j.media_urls[0]}: ${prev && prev.error ? (prev.error.message || prev.error) : 'no data'}`, true);
    return { ctl: 'req', req: { method: 'NATIVE', commit: true }, wait: 0, carry: {}, native: { title: j.title, description: j.description || j.text, privacyStatus: j.params.privacy || 'private', tags: j.params.tags || '', categoryId: j.params.category_id || '22', madeForKids: /^(true|yes|1)$/i.test(j.params.made_for_kids || '') } }; },
  (j, prev, last) => { if (!prev || prev.error) { const m = String((prev && prev.error && (prev.error.message || prev.error)) || 'no response'); return fail(/401|credential|token/i.test(m) ? 'auth_expired' : 'upload_failed', m.slice(0, 300), false); } return done({ post_id: prev.id, post_url: `https://youtu.be/${prev.id}` }); },
] };

// ---------------------------------------------------------------- LinkedIn (native node: text, article, image)
const linkedin = { cred: { auth: 'native', type: 'linkedInOAuth2Api' }, kinds: [{ t: 'plain' }, { t: 'native', node: 'linkedin' }], stages: [
  j => { if (j.format === 'video') return unsupported('LinkedIn', 'video'); if (j.format === 'image') { const o = one(j, 'LinkedIn'); if (o) return o; return req('GET', j.media_urls[0], {}); } return pass({}); },
  (j, prev, last) => { if (j.format === 'image' && (!prev || prev.error)) return fail('media_download_failed', `could not download ${j.media_urls[0]}`, true);
    const asOrg = (j.params.post_as || 'person') === 'organization'; if (asOrg ? !j.params.organization_id : !j.params.person_id) return fail('missing_param', asOrg ? '"organization_id" is required for organization posts' : '"person_id" (LinkedIn member id) is required');
    if (!j.text && j.format !== 'link') return fail('empty_post', 'no text to post');
    return { ctl: 'req', req: { method: 'NATIVE', commit: true }, wait: 0, carry: {}, native: { postAs: asOrg ? 'organization' : 'person', person: j.params.person_id || '', organization: j.params.organization_id || '', text: j.text || j.link_url, shareMediaCategory: j.format === 'image' ? 'IMAGE' : j.format === 'link' ? 'ARTICLE' : 'NONE', originalUrl: j.link_url || '', title: j.title || '', description: j.description || '', visibility: j.params.visibility || 'PUBLIC' } }; },
  (j, prev, last) => { if (!prev || prev.error) { const m = String((prev && prev.error && (prev.error.message || prev.error)) || 'no response'); return fail(/401|credential|token/i.test(m) ? 'auth_expired' : 'linkedin_error', m.slice(0, 300), /429|5\d\d/.test(m) ? false : false); } const id = prev.id || prev.urn || (prev.data && prev.data.id) || ''; return done({ post_id: String(id), post_url: id ? `https://www.linkedin.com/feed/update/${id}` : '' }); },
] };

const PLATFORM_SPECS = { reddit, facebook, instagram, youtube, x, linkedin, threads, pinterest, tumblr, tiktok };
const NAMES = { reddit: 'Reddit', facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', x: 'X', linkedin: 'LinkedIn', threads: 'Threads', pinterest: 'Pinterest', tumblr: 'Tumblr', tiktok: 'TikTok' };
if (typeof module !== 'undefined' && module.exports) module.exports = { PLATFORM_SPECS, NAMES, httpError };
