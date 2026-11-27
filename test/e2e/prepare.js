'use strict';
// Test-only: binds DUMMY credentials (tok_<platform>_<slot>) to every slot node so the real credential injection can be verified against a mock server.
const fs = require('fs'), path = require('path');
const { PLATFORM_SPECS } = require('../../lib/platforms'); const { PLATFORMS } = require('../../lib/sm-core');
const [,, root, outDir] = process.argv; const SLOTS = +(process.env.SM_SLOTS || 5);
fs.mkdirSync(outDir, { recursive: true }); const creds = [];
const oauth = (tok) => ({ grantType: 'authorizationCode', authUrl: 'https://example.invalid/auth', accessTokenUrl: 'https://example.invalid/token', clientId: 'x', clientSecret: 'y', scope: 'x', authQueryParameters: '', authentication: 'header', oauthTokenData: { access_token: tok, token_type: 'bearer' } });
const dataFor = (type, tok) => ({ facebookGraphApi: { accessToken: tok }, httpQueryAuth: { name: 'access_token', value: tok }, httpBearerAuth: { token: tok } }[type] || oauth(tok));
fs.readdirSync(path.join(root, 'workflows')).filter(f => /^\d+-.*-publisher\.json$/.test(f)).forEach(f => {
  const w = JSON.parse(fs.readFileSync(path.join(root, 'workflows', f), 'utf8')); const p = PLATFORMS.find(x => f.includes(`-${x}-publisher`)); const type = PLATFORM_SPECS[p].cred.type;
  w.nodes.forEach(n => { const m = /^Slot (\d+) \(/.exec(n.name); if (!m) return; const s = +m[1]; if (s > 3) return; const id = `tc${p}${s}`.padEnd(16, '0').slice(0, 16); n.credentials = { [type]: { id, name: `${p} account ${s}` } }; if (!creds.find(c => c.id === id)) creds.push({ id, name: `${p} account ${s}`, type, data: dataFor(type, `tok_${p}_${s}`) }); });
  fs.writeFileSync(path.join(outDir, f), JSON.stringify(w));
});
fs.copyFileSync(path.join(root, 'test/fixtures/test-pipeline.json'), path.join(outDir, 'test-pipeline.json')); fs.copyFileSync(path.join(root, 'workflows/00-master-google-sheets.json'), path.join(outDir, '00-master.json'));
fs.writeFileSync(path.join(outDir, 'creds.json'), JSON.stringify(creds)); console.log('bound', creds.length, 'dummy credentials');
