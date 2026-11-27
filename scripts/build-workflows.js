'use strict';
// Generates importable n8n workflow JSON into workflows/ (and the test pipeline into test/fixtures/).
// All logic lives in lib/*.js (unit-tested) and is embedded into Code nodes; everything else is stock n8n nodes.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..');
const { PLATFORM_SPECS, NAMES } = require('../lib/platforms');
const { PLATFORMS } = require('../lib/sm-core');
const SLOTS = +(process.env.SM_SLOTS || 5);
const strip = s => s.replace(/^'use strict';\n/, '');
const CORE = strip(fs.readFileSync(path.join(root, 'lib/sm-core.js'), 'utf8'));
const pf = fs.readFileSync(path.join(root, 'lib/platforms.js'), 'utf8');
const PRELUDE = pf.slice(pf.indexOf('const base ='), pf.indexOf('// ---------------------------------------------------------------- Facebook'));
const uid = s => { const h = crypto.createHash('md5').update(s).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };
const PWF = p => 'smwf' + String(PLATFORMS.indexOf(p) + 10).padStart(12, '0'); // platform workflow ids
const MASTER_ID = 'smwf000000000001', TEST_ID = 'smwf000000000002';

function mk(id, name) {
  const w = { id, name, nodes: [], connections: {}, active: false, settings: { executionOrder: 'v1' }, pinData: {} };
  const add = (n, x, y) => { n.id = uid(name + '/' + n.name); n.position = [x, y]; w.nodes.push(n); return n.name; };
  const link = (a, b, out = 0) => { w.connections[a] = w.connections[a] || { main: [] }; const m = w.connections[a].main; while (m.length <= out) m.push([]); m[out].push({ node: b, type: 'main', index: 0 }); };
  const node = (name, type, tv, parameters, extra = {}) => ({ name, type, typeVersion: tv, parameters, ...extra });
  const code = (name, js) => node(name, 'n8n-nodes-base.code', 2, { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: js });
  const sw = (name, expr, values, extraOut) => node(name, 'n8n-nodes-base.switch', 3.2, { rules: { values: values.map(v => ({ conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{ leftValue: expr, rightValue: v.value, operator: { type: v.num ? 'number' : 'string', operation: 'equals' } }], combinator: 'and' }, renamedOutput: true, outputKey: String(v.key) })) }, options: extraOut ? { fallbackOutput: 'extra' } : {} });
  return { w, add, link, node, code, sw };
}
const save = (w, file) => fs.writeFileSync(path.join(root, file), JSON.stringify(w, null, 2) + '\n');

// ------------------------------------------------------------------ platform workflows
function slotHttp(spec, kind, name) {
  const generic = spec.cred.auth === 'generic'; const ct = kind.ctype || 'json';
  const p = { method: '={{ $json.req.method }}', url: '={{ $json.req.url }}', authentication: generic ? 'genericCredentialType' : 'predefinedCredentialType', [generic ? 'genericAuthType' : 'nodeCredentialType']: spec.cred.type,
    sendQuery: true, specifyQuery: 'json', jsonQuery: '={{ JSON.stringify($json.req.qs || {}) }}', sendHeaders: true, specifyHeaders: 'json', jsonHeaders: '={{ JSON.stringify($json.req.headers || {}) }}', options: { response: { response: { fullResponse: true, neverError: true, responseFormat: 'autodetect' } }, timeout: 120000 } };
  if (kind.get) p.sendBody = false;
  else if (ct === 'json') Object.assign(p, { sendBody: true, contentType: 'json', specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.req.body || {}) }}' });
  else if (ct === 'form') Object.assign(p, { sendBody: true, contentType: 'form-urlencoded', specifyBody: 'string', body: '={{ $json.req.form }}' });
  else if (ct === 'multipart') Object.assign(p, { sendBody: true, contentType: 'multipart-form-data', bodyParameters: { parameters: [{ parameterType: 'formBinaryData', name: 'media', inputDataFieldName: 'data' }, { name: 'media_category', value: '={{ $json.req.body.media_category }}' }] } });
  return { name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, parameters: p, onError: 'continueRegularOutput' };
}
function nativeNode(kind, name) {
  if (kind.node === 'youtube') return { name, type: 'n8n-nodes-base.youTube', typeVersion: 1, onError: 'continueRegularOutput', parameters: { resource: 'video', operation: 'upload', title: '={{ $json.native.title }}', regionCode: 'US', categoryId: '={{ $json.native.categoryId }}', binaryProperty: 'data', options: { description: '={{ $json.native.description }}', privacyStatus: '={{ $json.native.privacyStatus }}', tags: '={{ $json.native.tags }}', selfDeclaredMadeForKids: '={{ $json.native.madeForKids }}', notifySubscribers: false } } };
  return { name, type: 'n8n-nodes-base.linkedIn', typeVersion: 1, onError: 'continueRegularOutput', parameters: { resource: 'post', operation: 'create', postAs: '={{ $json.native.postAs }}', person: '={{ $json.native.person }}', organization: '={{ $json.native.organization }}', text: '={{ $json.native.text }}', shareMediaCategory: '={{ $json.native.shareMediaCategory }}', binaryPropertyName: 'data', additionalFields: { description: '={{ $json.native.description }}', originalUrl: '={{ $json.native.originalUrl }}', title: '={{ $json.native.title }}', visibility: '={{ $json.native.visibility }}' } } };
}
function platformWorkflow(p) {
  const spec = PLATFORM_SPECS[p]; const label = NAMES[p]; const { w, add, link, node, code, sw } = mk(PWF(p), `SM ${String(PLATFORMS.indexOf(p) + 1).padStart(2, '0')} ${label} Publisher`);
  const K = spec.stages.length - 1; const X = 230;
  const trig = add(node('Execute Workflow Trigger', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, { inputSource: 'passthrough' }), 0, 0);
  const prep = add(code('Prepare', "const j = $input.first().json; return [{ json: { ctl: 'start', job: j } }];"), X, 0);
  link(trig, prep);
  const result = add(code('Result', `const it = $input.first().json; const job = it.job || {};
const base = { job_id: job.job_id, row_id: job.row_id, platform: job.platform, account_key: job.account_key };
if (it.ctl === 'done') return [{ json: { ...base, ok: true, post_id: String((it.result && it.result.post_id) || ''), post_url: (it.result && it.result.post_url) || '', note: (it.result && it.result.note) || '' } }];
const e = it.ctl === 'fail' ? it.error : { code: 'internal', message: 'unexpected state ' + it.ctl, retryable: false };
return [{ json: { ...base, ok: false, error_code: e.code, error_message: e.message, retryable: !!e.retryable } }];`), X * (3 + K * 5), 380);
  let x = X * 2;
  for (let k = 0; k <= K; k++) {
    const stageSrc = spec.stages[k].toString(); const y = 0;
    const b = add(code(`Build ${k}`, `${PRELUDE}
const job = $('Prepare').first().json.job; const inp = $input.first().json; const bin = $input.first().binary;
const last = ${k === 0 ? '{ carry: {} }' : `$('Build ${k - 1}').first().json`};
const prev = ${k === 0 ? 'null' : "(inp.ctl === 'pass' ? inp.prev : inp)"};
const out = (${stageSrc})(job, prev, last);
if (out.ctl === 'pass') out.prev = prev;
out.carry = Object.assign({}, last.carry || {}, out.carry || {});
const res = { json: { ...out, job, slot: job.slot } }; if (bin) res.binary = bin; return [res];`), x, y);
    if (k === 0) link(prep, b);
    if (k === K) { link(b, result); break; }
    const kind = spec.kinds[k]; const nextB = `Build ${k + 1}`;
    const route = add(sw(`Route ${k}`, '={{ $json.ctl }}', [{ value: 'req', key: 'req' }, { value: 'pass', key: 'pass' }], true), x + X, y); link(b, route);
    link(route, `Build ${k + 1}`, 1) /* pass */; link(route, result, 2) /* done / fail */;
    const wait = add(node(`Wait ${k}`, 'n8n-nodes-base.wait', 1.1, { resume: 'timeInterval', amount: '={{ $json.wait || 0 }}', unit: 'seconds' }), x + X * 2, y - 140); link(route, wait, 0);
    if (kind.t === 'plain') {
      const f = add({ name: `Fetch ${k}`, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, onError: 'continueRegularOutput', parameters: { method: 'GET', url: '={{ $json.req.url }}', options: { response: { response: { responseFormat: 'file', outputPropertyName: 'data' } }, timeout: 300000 } } }, x + X * 3, y - 140);
      link(wait, f); link(f, nextB); x += X * 4; continue;
    }
    const slotSw = add(sw(`Slot ${k}`, '={{ $json.slot }}', Array.from({ length: SLOTS }, (_, i) => ({ value: i + 1, key: `slot ${i + 1}`, num: true })), true), x + X * 3, y - 140); link(wait, slotSw);
    const noSlot = add(code(`No slot ${k}`, "const it = $input.first().json; return [{ json: { ctl: 'fail', job: it.job, error: { code: 'no_credential_slot', message: 'Account \"' + it.job.account_key + '\" has slot ' + it.job.slot + ', but this workflow only has slots 1-" + SLOTS + ". Set a valid slot in the Accounts sheet.', retryable: false } } }];"), x + X * 4, y + 200);
    link(slotSw, noSlot, SLOTS); link(noSlot, result);
    for (let s = 1; s <= SLOTS; s++) {
      const nd = kind.t === 'native' ? nativeNode(kind, `Slot ${s} (${label} account ${s})`) : slotHttp(spec, kind, `Slot ${s} (${label} account ${s}) S${k + 1}`);
      if (kind.t === 'native') nd.name = `Slot ${s} (${label} account ${s})`;
      add(nd, x + X * 4, y - 300 + s * 90); link(slotSw, nd.name, s - 1); link(nd.name, nextB);
    }
    x += X * 5;
  }
  return w;
}

// ------------------------------------------------------------------ master / test pipeline
function pipeline(id, name, test) {
  const { w, add, link, node, code, sw } = mk(id, name); const X = 240;
  const exec = { source: 'database', workflowId: { __rl: true, mode: 'id', value: '={{ $json._wf }}' }, mode: 'each', options: { waitForSubWorkflow: true } };
  let head;
  if (test) {
    head = add(node('Webhook', 'n8n-nodes-base.webhook', 2, { httpMethod: 'POST', path: 'sm-test-run', responseMode: 'lastNode', options: {} }, { webhookId: uid('smtest') }), 0, 0);
    const b = add(code('Build', `${CORE}
const body = $input.first().json.body || {};
const res = buildJobs({ content: body.content, accounts: body.accounts, log: body.log, now: body.now || Date.now(), config: body.config });
return [{ json: { ...res, config: body.config || {}, _base: body.base || '', now: body.now || Date.now() } }];`), X, 0); link(head, b);
    head = 'Build';
  } else {
    const t1 = add(node('Every 5 minutes', 'n8n-nodes-base.scheduleTrigger', 1.2, { rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } }), 0, -120);
    const t2 = add(node('Manual Trigger', 'n8n-nodes-base.manualTrigger', 1, {}), 0, 120);
    const cfg = add(node('Config', 'n8n-nodes-base.set', 3.4, { assignments: { assignments: [
      { id: uid('c1'), name: 'spreadsheet_id', value: '', type: 'string' }, { id: uid('c2'), name: 'content_sheet', value: 'Content', type: 'string' }, { id: uid('c3'), name: 'accounts_sheet', value: 'Accounts', type: 'string' }, { id: uid('c4'), name: 'log_sheet', value: 'Log', type: 'string' },
      { id: uid('c5'), name: 'timezone', value: 'UTC', type: 'string' }, { id: uid('c6'), name: 'max_attempts', value: 3, type: 'number' }, { id: uid('c7'), name: 'max_rows_per_run', value: 20, type: 'number' }, { id: uid('c8'), name: 'append_hashtags', value: true, type: 'boolean' }] }, options: {} }), X, 0);
    link(t1, cfg); link(t2, cfg);
    const sheet = (name, sheetExpr, op, extra = {}, xx, yy) => add({ name, type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, parameters: Object.assign({ resource: 'sheet', operation: op, documentId: { __rl: true, mode: 'id', value: "={{ $('Config').first().json.spreadsheet_id }}" }, sheetName: { __rl: true, mode: 'name', value: sheetExpr }, options: {} }, extra), ...(op === 'read' ? { executeOnce: true, alwaysOutputData: true } : {}) }, xx, yy);
    const r1 = sheet('Read Content', "={{ $('Config').first().json.content_sheet }}", 'read', {}, X * 2, 0), r2 = sheet('Read Accounts', "={{ $('Config').first().json.accounts_sheet }}", 'read', {}, X * 3, 0), r3 = sheet('Read Log', "={{ $('Config').first().json.log_sheet }}", 'read', {}, X * 4, 0);
    link(cfg, r1); link(r1, r2); link(r2, r3);
    const b = add(code('Build', `${CORE}
const cfg = $('Config').first().json;
if (!cfg.spreadsheet_id) throw new Error('Set spreadsheet_id in the Config node first');
const rows = n => $(n).all().map(i => i.json).filter(r => Object.values(r).some(v => String(v).trim() !== ''));
const res = buildJobs({ content: rows('Read Content'), accounts: rows('Read Accounts'), log: rows('Read Log'), now: Date.now(), config: cfg });
return [{ json: { ...res, config: cfg, now: Date.now() } }];`), X * 5, 0); link(r3, b); head = 'Build';
  }
  const xb = X * (test ? 2 : 6);
  const iff = add(node('Any jobs?', 'n8n-nodes-base.if', 2, { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' }, conditions: [{ id: uid('anyjobs' + id), leftValue: '={{ $json.jobs.length }}', rightValue: 0, operator: { type: 'number', operation: 'gt' } }], combinator: 'and' }, options: {} }), xb, 0); link(head, iff);
  let afterLock;
  if (test) afterLock = null; else {
    const split = add(code('Lock rows: list', "return $('Build').first().json.preUpdates.map(u => ({ json: u }));"), xb + X, -160);
    const lock = add({ name: 'Lock rows (status=publishing)', type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, parameters: { resource: 'sheet', operation: 'update', documentId: { __rl: true, mode: 'id', value: "={{ $('Config').first().json.spreadsheet_id }}" }, sheetName: { __rl: true, mode: 'name', value: "={{ $('Config').first().json.content_sheet }}" }, columns: { mappingMode: 'autoMapInputData', value: null, matchingColumns: ['id'], schema: [] }, options: {} } }, xb + X * 2, -160);
    link(iff, split, 0); link(split, lock); afterLock = lock;
  }
  const jobs = add(code('Jobs', `const b = $('Build').first().json; const WF = ${JSON.stringify(Object.fromEntries(PLATFORMS.map(p => [p, PWF(p)])))};
return b.jobs.map(j => ({ json: { ...j, _wf: WF[j.platform], _base: b._base || undefined } }));`), xb + X * (test ? 1 : 3), -160);
  if (test) link(iff, jobs, 0); else link(afterLock, jobs);
  const run = add({ name: 'Run platform workflow', type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, parameters: exec, onError: 'continueRegularOutput' }, xb + X * (test ? 2 : 4), -160); link(jobs, run);
  const fin = add(code('Finalize', `${CORE}
const b = $('Build').first().json;
let jobs = []; try { jobs = $('Jobs').all().map(i => i.json); } catch (e) { jobs = []; }
const out = jobs.length ? $input.all().map(i => i.json) : [];
const results = jobs.map((j, i) => { const r = out[i] || {}; if (typeof r.ok !== 'boolean') return { job_id: j.job_id, ok: false, error_code: 'workflow_error', error_message: String((r.error && (r.error.message || r.error.description || JSON.stringify(r.error))) || 'platform workflow returned nothing').slice(0, 300), retryable: false }; return r; });
const f = finalize({ rowState: b.rowState, results, now: b.now || Date.now(), config: b.config });
const bad = (b.skipped || []).filter(s => s.flag === 'bad_date').map(s => ({ id: s.id, status: 'error', last_error: s.reason, updated_at: new Date().toISOString() }));
return [{ json: { rowUpdates: f.rowUpdates.concat(bad), logAppends: f.logAppends, results, jobs, skipped: b.skipped } }];`), xb + X * (test ? 3 : 5), 0);
  link(run, fin); link(iff, fin, 1);
  if (!test) {
    const ru = add(code('Row updates: list', "return $input.first().json.rowUpdates.map(u => ({ json: u }));"), xb + X * 6, -100), ll = add(code('Log lines: list', "return $input.first().json.logAppends.map(u => ({ json: u }));"), xb + X * 6, 120);
    const upd = add({ name: 'Update Content rows', type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, parameters: { resource: 'sheet', operation: 'update', documentId: { __rl: true, mode: 'id', value: "={{ $('Config').first().json.spreadsheet_id }}" }, sheetName: { __rl: true, mode: 'name', value: "={{ $('Config').first().json.content_sheet }}" }, columns: { mappingMode: 'autoMapInputData', value: null, matchingColumns: ['id'], schema: [] }, options: {} } }, xb + X * 7, -100);
    const app = add({ name: 'Append to Log', type: 'n8n-nodes-base.googleSheets', typeVersion: 4.7, parameters: { resource: 'sheet', operation: 'append', documentId: { __rl: true, mode: 'id', value: "={{ $('Config').first().json.spreadsheet_id }}" }, sheetName: { __rl: true, mode: 'name', value: "={{ $('Config').first().json.log_sheet }}" }, columns: { mappingMode: 'autoMapInputData', value: null, matchingColumns: [], schema: [] }, options: {} } }, xb + X * 7, 120);
    link(fin, ru); link(fin, ll); link(ru, upd); link(ll, app);
  }
  return w;
}

fs.mkdirSync(path.join(root, 'workflows'), { recursive: true }); fs.mkdirSync(path.join(root, 'test/fixtures'), { recursive: true });
PLATFORMS.forEach(p => save(platformWorkflow(p), `workflows/${PLATFORMS.indexOf(p) + 10}-${p}-publisher.json`));
save(pipeline(MASTER_ID, 'SM 00 Master (Google Sheets to Platforms)', false), 'workflows/00-master-google-sheets.json');
save(pipeline(TEST_ID, 'SM TEST Pipeline (no Sheets)', true), 'test/fixtures/test-pipeline.json');
console.log('built', fs.readdirSync(path.join(root, 'workflows')).length, 'workflows');
